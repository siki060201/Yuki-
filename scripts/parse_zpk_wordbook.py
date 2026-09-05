#!/usr/bin/env python3
"""Extract vocabulary metadata from local .zpk packages into portable datasets.

The script only reads the source packages. It does not upload data or extract
large image/audio assets. The JSONL output is intended for later D1 import.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any


TEXT_FIELDS = (
    "word",
    "accent",
    "mean_cn",
    "mean_en",
    "sentence",
    "sentence_trans",
    "sentence_phrase",
    "word_etyma",
    "image_file",
    "word_audio",
    "sentence_audio",
)
NUMBER_FIELDS = ("topic_id", "word_level_id", "tag_id")
CSV_FIELDS = ("word", *TEXT_FIELDS[1:], *NUMBER_FIELDS, "source_count", "source_files")


def decode_json_string(value: str) -> str:
    """Decode JSON escapes while retaining malformed source strings safely."""
    try:
        return json.loads(f'"{value}"')
    except json.JSONDecodeError:
        return value.replace(r"\\", "\\").replace(r'\"', '"')


def extract_string_field(text: str, field: str) -> str:
    pattern = re.compile(rf'"{re.escape(field)}"\s*:\s*"((?:\\.|[^"\\])*)"')
    match = pattern.search(text)
    return decode_json_string(match.group(1)) if match else ""


def extract_number_field(text: str, field: str) -> int | None:
    match = re.search(rf'"{re.escape(field)}"\s*:\s*(-?\d+)', text)
    return int(match.group(1)) if match else None


def read_package(path: Path) -> dict[str, Any] | None:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="ignore")
    record: dict[str, Any] = {field: extract_string_field(text, field) for field in TEXT_FIELDS}
    record.update({field: extract_number_field(text, field) for field in NUMBER_FIELDS})
    word = re.sub(r"\s+", " ", record["word"].strip()).lower()
    if not word or len(word) > 120:
        return None
    record["word"] = word
    return record


def completeness(record: dict[str, Any]) -> int:
    return sum(bool(record.get(field)) for field in TEXT_FIELDS[1:])


def merge_records(existing: dict[str, Any], candidate: dict[str, Any], source: str) -> None:
    existing["source_count"] += 1
    existing["source_files"].append(source)
    if completeness(candidate) > completeness(existing):
        for field in (*TEXT_FIELDS[1:], *NUMBER_FIELDS):
            if candidate.get(field) not in (None, ""):
                existing[field] = candidate[field]
        return
    for field in (*TEXT_FIELDS[1:], *NUMBER_FIELDS):
        if existing.get(field) in (None, "") and candidate.get(field) not in (None, ""):
            existing[field] = candidate[field]


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse local .zpk vocabulary packages into JSONL and CSV.")
    parser.add_argument("--input", type=Path, default=Path("词数和解析器/2176"), help="A .zpk file or directory containing .zpk files.")
    parser.add_argument("--output", type=Path, default=Path("词书解析输出"), help="Directory for generated files.")
    parser.add_argument("--limit", type=int, default=0, help="Only parse the first N packages. Useful for testing.")
    return parser.parse_args()


def find_packages(input_path: Path) -> tuple[Path, list[Path]]:
    if input_path.is_file() and input_path.suffix.lower() == ".zpk":
        return input_path.parent, [input_path]
    if input_path.is_dir():
        return input_path, sorted(input_path.rglob("*.zpk"))
    return input_path, []


def main() -> int:
    args = parse_arguments()
    input_path = args.input.resolve()
    output_dir = args.output.resolve()
    input_dir, packages = find_packages(input_path)
    if args.limit:
        packages = packages[: args.limit]
    if not packages:
        print("没有找到 .zpk 文件。", file=sys.stderr)
        return 2

    output_dir.mkdir(parents=True, exist_ok=True)
    words: dict[str, dict[str, Any]] = {}
    skipped: list[dict[str, str]] = []
    source_groups: defaultdict[str, int] = defaultdict(int)

    print(f"开始解析 {len(packages):,} 个词包…")
    for index, package in enumerate(packages, start=1):
        relative_path = package.relative_to(input_dir).as_posix()
        try:
            record = read_package(package)
        except OSError as error:
            skipped.append({"file": relative_path, "reason": str(error)})
            continue

        if not record:
            skipped.append({"file": relative_path, "reason": "未找到有效单词字段"})
            continue

        source_groups[str(record.get("word_level_id") or "unknown")] += 1
        record["source_count"] = 1
        record["source_files"] = [relative_path]
        if record["word"] in words:
            merge_records(words[record["word"]], record, relative_path)
        else:
            words[record["word"]] = record

        if index % 100 == 0 or index == len(packages):
            print(f"  已处理 {index:,}/{len(packages):,} 个，得到 {len(words):,} 个去重词条")

    records = sorted(words.values(), key=lambda item: item["word"])
    jsonl_path = output_dir / "wordbook.jsonl"
    csv_path = output_dir / "wordbook.csv"
    report_path = output_dir / "report.json"
    skipped_path = output_dir / "skipped.jsonl"
    upload_path = output_dir / "lexora-wordbook-upload.zip"

    with jsonl_path.open("w", encoding="utf-8", newline="") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")

    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            row = dict(record)
            row["source_files"] = ";".join(record["source_files"])
            writer.writerow(row)

    with skipped_path.open("w", encoding="utf-8", newline="") as handle:
        for item in skipped:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    report = {
        "input_directory": str(input_dir),
        "parsed_packages": len(packages),
        "unique_words": len(records),
        "skipped_packages": len(skipped),
        "word_level_counts": dict(sorted(source_groups.items())),
        "outputs": {"jsonl": str(jsonl_path), "csv": str(csv_path), "report": str(report_path), "upload_bundle": str(upload_path)},
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with zipfile.ZipFile(upload_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(jsonl_path, arcname="wordbook.jsonl")
        archive.write(report_path, arcname="report.json")

    print("\n完成。")
    print(f"去重词条：{len(records):,}")
    print(f"JSONL：{jsonl_path}")
    print(f"CSV：{csv_path}")
    print(f"报告：{report_path}")
    print(f"上传包：{upload_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

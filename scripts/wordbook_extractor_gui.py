#!/usr/bin/env python3
"""A local GUI launcher for the .zpk wordbook extractor."""

from __future__ import annotations

import queue
import subprocess
import sys
import threading
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


PROJECT_ROOT = Path(__file__).resolve().parent.parent
PARSER = PROJECT_ROOT / "scripts" / "parse_zpk_wordbook.py"
DEFAULT_INPUT = PROJECT_ROOT / "词数和解析器" / "2176"
DEFAULT_OUTPUT = PROJECT_ROOT / "词书解析输出"


class ExtractorApp(tk.Tk):
    def __init__(self, initial_input: str = "") -> None:
        super().__init__()
        self.title("Lexora 词书本地解析")
        self.minsize(680, 480)
        self.configure(bg="#101522")
        self.events: queue.Queue[tuple[str, str | int]] = queue.Queue()
        self.process: subprocess.Popen[str] | None = None
        self.input_path = tk.StringVar(value=initial_input or str(DEFAULT_INPUT))
        self.status = tk.StringVar(value="选择词包文件夹后开始解析。")
        self._build()
        self.after(100, self._read_events)

    def _build(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background="#101522")
        style.configure("TLabel", background="#101522", foreground="#e8ecff")
        style.configure("Muted.TLabel", foreground="#9fa9c4")
        style.configure("TButton", padding=(12, 8))
        style.configure("Accent.TButton", background="#5965e8", foreground="#ffffff")
        style.map("Accent.TButton", background=[("active", "#6d78ff")])

        container = ttk.Frame(self, padding=24)
        container.pack(fill="both", expand=True)
        ttk.Label(container, text="词书本地解析", font=("Microsoft YaHei", 19, "bold")).pack(anchor="w")
        ttk.Label(
            container,
            text="完全离线运行：不会调用 AI、不会消耗 token、不会上传原始词包。",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(5, 22))

        ttk.Label(container, text="词包文件夹或 .zpk 文件").pack(anchor="w")
        path_row = ttk.Frame(container)
        path_row.pack(fill="x", pady=(7, 16))
        ttk.Entry(path_row, textvariable=self.input_path).pack(side="left", fill="x", expand=True)
        ttk.Button(path_row, text="选择文件夹", command=self._choose_directory).pack(side="left", padx=(8, 0))
        ttk.Button(path_row, text="选择文件", command=self._choose_file).pack(side="left", padx=(8, 0))

        action_row = ttk.Frame(container)
        action_row.pack(fill="x")
        self.start_button = ttk.Button(action_row, text="开始自动提取", style="Accent.TButton", command=self._start)
        self.start_button.pack(side="left")
        ttk.Button(action_row, text="打开输出目录", command=self._open_output).pack(side="left", padx=(8, 0))

        self.progress = ttk.Progressbar(container, mode="indeterminate")
        self.progress.pack(fill="x", pady=(20, 8))
        ttk.Label(container, textvariable=self.status, style="Muted.TLabel").pack(anchor="w")

        self.log = tk.Text(
            container,
            height=15,
            wrap="word",
            bg="#0b0f19",
            fg="#dce3fa",
            insertbackground="#ffffff",
            relief="flat",
            padx=12,
            pady=12,
        )
        self.log.pack(fill="both", expand=True, pady=(16, 0))
        self.log.insert("end", "准备就绪。\n")
        self.log.configure(state="disabled")

    def _choose_directory(self) -> None:
        selected = filedialog.askdirectory(initialdir=self.input_path.get() or str(PROJECT_ROOT), title="选择包含 .zpk 的文件夹")
        if selected:
            self.input_path.set(selected)

    def _choose_file(self) -> None:
        selected = filedialog.askopenfilename(initialdir=self.input_path.get() or str(PROJECT_ROOT), title="选择 .zpk 词包", filetypes=[("ZPK 词包", "*.zpk")])
        if selected:
            self.input_path.set(selected)

    def _append_log(self, text: str) -> None:
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _start(self) -> None:
        input_path = Path(self.input_path.get().strip())
        if not input_path.exists():
            messagebox.showerror("无法开始", "请选择存在的词包文件夹或 .zpk 文件。")
            return
        if self.process:
            return

        self.start_button.configure(state="disabled")
        self.progress.start(10)
        self.status.set("正在本地解析，请保持窗口打开。")
        self._append_log(f"\n开始解析：{input_path}\n")
        command = [sys.executable, "-X", "utf8", str(PARSER), "--input", str(input_path), "--output", str(DEFAULT_OUTPUT)]
        thread = threading.Thread(target=self._run_parser, args=(command,), daemon=True)
        thread.start()

    def _run_parser(self, command: list[str]) -> None:
        try:
            self.process = subprocess.Popen(command, cwd=PROJECT_ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
            assert self.process.stdout
            for line in self.process.stdout:
                self.events.put(("log", line))
            self.events.put(("finished", self.process.wait()))
        except OSError as error:
            self.events.put(("log", f"启动失败：{error}\n"))
            self.events.put(("finished", 1))

    def _read_events(self) -> None:
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self._append_log(str(value))
                elif kind == "finished":
                    self.process = None
                    self.progress.stop()
                    self.start_button.configure(state="normal")
                    if value == 0:
                        self.status.set("解析完成。请上传“lexora-wordbook-upload.zip”。")
                        messagebox.showinfo("解析完成", f"请上传：\n{DEFAULT_OUTPUT / 'lexora-wordbook-upload.zip'}")
                    else:
                        self.status.set("解析失败，请查看下方日志。")
        except queue.Empty:
            pass
        self.after(100, self._read_events)

    def _open_output(self) -> None:
        DEFAULT_OUTPUT.mkdir(parents=True, exist_ok=True)
        subprocess.run(["explorer", str(DEFAULT_OUTPUT)], check=False)


def main() -> None:
    initial_input = sys.argv[1] if len(sys.argv) > 1 else ""
    ExtractorApp(initial_input).mainloop()


if __name__ == "__main__":
    main()

import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

rmSync("public", { recursive: true, force: true });
mkdirSync("public", { recursive: true });
cpSync("index.html", "public/index.html");
if (existsSync("assets")) cpSync("assets", "public/assets", { recursive: true });
if (existsSync("js")) cpSync("js", "public/js", { recursive: true });
if (existsSync("css")) cpSync("css", "public/css", { recursive: true });
if (existsSync("wordbook_cet4.json")) cpSync("wordbook_cet4.json", "public/wordbook_cet4.json");
if (existsSync("词书解析输出/wordbook.jsonl")) {
  mkdirSync("public/词书解析输出", { recursive: true });
  cpSync("词书解析输出/wordbook.jsonl", "public/词书解析输出/wordbook.jsonl");
}
console.log("Build complete: public directory prepared.");

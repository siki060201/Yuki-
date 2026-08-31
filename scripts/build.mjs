import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

rmSync("public", { recursive: true, force: true });
mkdirSync("public", { recursive: true });
cpSync("index.html", "public/index.html");
if (existsSync("assets")) cpSync("assets", "public/assets", { recursive: true });

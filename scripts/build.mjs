import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("public", { recursive: true, force: true });
mkdirSync("public", { recursive: true });
cpSync("index.html", "public/index.html");

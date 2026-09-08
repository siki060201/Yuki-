/**
 * scripts/build.mjs · 把站点产物整理进 public/（Cloudflare Workers Assets 目录）
 * 只复制运行时需要的文件：不带词书源数据、不带解析脚本。
 */
import { cpSync, mkdirSync, rmSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = ['index.html', 'manifest.webmanifest', 'sw.js'];
const dirs = ['css', 'js', 'assets'];

for (const f of files) if (existsSync(f)) cpSync(f, join(OUT, f));
for (const d of dirs) if (existsSync(d)) cpSync(d, join(OUT, d), { recursive: true });

function sizeOf(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((a, f) => a + sizeOf(join(p, f)), 0);
}
console.log(`Build complete → ${OUT}/  (${(sizeOf(OUT) / 1024 / 1024).toFixed(1)} MB)`);

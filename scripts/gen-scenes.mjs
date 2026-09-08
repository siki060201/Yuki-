/**
 * scripts/gen-scenes.mjs · 批量生成场景背景图（Flux via pollinations，无需 key）
 *   node scripts/gen-scenes.mjs [只生成这些 key...]
 * 输出到 assets/scenes/，1920x1080。
 */
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { generateImage } from '../.agents/skills/image-generator/scripts/generate.mjs';

const BASE = 'cinematic photograph, cozy academia aesthetic, warm inviting atmosphere, shallow depth of field, soft volumetric light, rich detail, 8k, no people, no text, no letters, no watermark, no logo';

export const SCENES = [
  { key: 'night-study', prompt: `dark wooden desk in a quiet study at night, single brass desk lamp glowing warm amber, open old books and a ceramic mug of tea with steam, tall bookshelves fading into shadow, deep teal and gold color grading, ${BASE}` },
  { key: 'day-study', prompt: `bright airy study room in late morning, sunlight streaming through wooden blinds onto an oak desk, open notebook and fountain pen, green potted plants, warm cream and honey tones, ${BASE}` },
  { key: 'rain-night', prompt: `view of a rain-streaked window at night from inside a warm study, blurred city lights bokeh beyond the glass, water droplets running down the pane, desk lamp reflection, moody blue and amber, ${BASE}` },
  { key: 'rain-day', prompt: `rainy afternoon seen through a window from a bright cozy room, raindrops on glass, soft grey daylight, green wet garden blurred outside, pale linen and sage tones, ${BASE}` },
  { key: 'fire-night', prompt: `stone fireplace with glowing orange embers and gentle flames in a dark cozy library, worn leather armchair, wool blanket, warm firelight flickering on bookshelves, deep amber and umber, ${BASE}` },
  { key: 'sea-night', prompt: `calm moonlit ocean at night seen from a wooden terrace, gentle rolling waves with soft foam, silver moon reflection on water, dark indigo sky with faint stars, ${BASE}` },
  { key: 'sea-day', prompt: `serene turquoise sea at golden hour from a quiet beach, gentle waves, warm sunlight sparkling on water, soft pastel sky, ${BASE}` },
  { key: 'forest-day', prompt: `sunlit deciduous forest in early morning, thin god rays through green canopy, mossy ground, gentle mist between tree trunks, fresh emerald and gold, ${BASE}` },
  { key: 'cafe-night', prompt: `quiet corner of a warm dimly lit cafe at night, marble table with a latte and an open book, brass pendant lamps, blurred bar in background, amber and walnut tones, ${BASE}` },
  { key: 'cafe-day', prompt: `sunny window seat in a calm scandinavian cafe, cappuccino and notebook on light wood table, plants, soft morning daylight, cream and oat tones, ${BASE}` },
  { key: 'focus-night', prompt: `extremely minimal dark abstract background, soft radial glow of warm amber light in the centre fading into near black, subtle film grain, gentle bokeh particles, calm and meditative, ${BASE}` },
  { key: 'focus-day', prompt: `extremely minimal light abstract background, soft warm cream gradient with a faint golden glow, subtle paper texture, calm and airy, ${BASE}` },
];

const OUT = 'assets/scenes';
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const list = only.length ? SCENES.filter(s => only.includes(s.key)) : SCENES;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

for (const scene of list) {
  const out = `${OUT}/${scene.key}.jpg`;
  if (existsSync(out) && statSync(out).size > 80_000 && !only.length) {
    console.log('skip (exists)', scene.key);
    continue;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await generateImage(scene.prompt, out, 1920, 1080);
      const size = statSync(out).size;
      if (size < 40_000) throw new Error(`too small (${size} bytes)`);
      console.log(`✓ ${scene.key}  ${(size / 1024).toFixed(0)} KB`);
      break;
    } catch (e) {
      console.warn(`  attempt ${attempt} failed for ${scene.key}: ${e.message}`);
      if (attempt === 3) console.error(`✗ ${scene.key} 生成失败`);
      await sleep(3000);
    }
  }
  await sleep(1500);
}
console.log('done');

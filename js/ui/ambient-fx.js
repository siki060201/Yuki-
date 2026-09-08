/**
 * ui/ambient-fx.js · 环境音对应的画面动效
 *
 * 一层全屏 canvas，铺在背景图之上、界面内容之下。
 * 跟随当前环境音自动切换：
 *   rain 斜落雨丝 + 玻璃水痕 + 地面涟漪 · waves 起伏浪光 · fire 炉火光晕与火星
 *   forest 光斑与飘叶 · cafe 浮尘 · night 流萤与星点
 *
 * 省电：页面隐藏、窗口失焦、prefers-reduced-motion 时停止渲染；无音景时不占资源。
 */

import * as Audio from '../core/audio.js';

let canvas = null;
let ctx = null;
let raf = 0;
let kind = 'none';
let w = 0, h = 0, dpr = 1;
let last = 0;
let running = false;
let intensity = 1;      // 跟随音量，音量越大动效越明显
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

// 各音景的粒子集合
let drops = [];
let streaks = [];
let ripples = [];
let sparks = [];
let leaves = [];
let motes = [];
let fireflies = [];
let waveT = 0;

const rand = (a, b) => a + Math.random() * (b - a);

function isLight() { return document.documentElement.dataset.theme === 'light'; }

function ensureCanvas() {
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.className = 'ambient-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild?.nextSibling || null);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize, { passive: true });
  return canvas;
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  seed();
}

// ---------------------------------------------------------------- 初始化粒子
function seed() {
  const area = Math.max(1, (w * h) / (1440 * 900));
  drops = []; streaks = []; ripples = []; sparks = []; leaves = []; motes = []; fireflies = [];

  if (kind === 'rain') {
    const n = Math.round(420 * area);
    for (let i = 0; i < n; i++) {
      drops.push({
        x: rand(-0.1 * w, 1.1 * w), y: rand(-h, h),
        len: rand(16, 46), speed: rand(820, 1750), thick: rand(0.7, 1.9), a: rand(0.24, 0.62),
      });
    }
    const s = Math.round(22 * area);
    for (let i = 0; i < s; i++) {
      streaks.push({ x: rand(0, w), y: rand(0, h), len: rand(40, 160), speed: rand(18, 60), r: rand(1.2, 3), a: rand(0.05, 0.16), wobble: rand(0, 6.28) });
    }
  } else if (kind === 'fire') {
    const n = Math.round(46 * area);
    for (let i = 0; i < n; i++) sparks.push(newSpark());
  } else if (kind === 'forest') {
    const n = Math.round(16 * area);
    for (let i = 0; i < n; i++) leaves.push(newLeaf());
    const m = Math.round(28 * area);
    for (let i = 0; i < m; i++) motes.push({ x: rand(0, w), y: rand(0, h), r: rand(0.6, 2.2), a: rand(0.05, 0.2), vx: rand(-6, 6), vy: rand(-4, 8), t: rand(0, 6.28) });
  } else if (kind === 'cafe') {
    const m = Math.round(52 * area);
    for (let i = 0; i < m; i++) motes.push({ x: rand(0, w), y: rand(0, h), r: rand(0.5, 1.8), a: rand(0.04, 0.16), vx: rand(-5, 5), vy: rand(-8, -1), t: rand(0, 6.28) });
  } else if (kind === 'night') {
    const n = Math.round(11 * area);
    for (let i = 0; i < n; i++) fireflies.push({ x: rand(0, w), y: rand(h * 0.25, h), t: rand(0, 6.28), phase: rand(0.25, 0.7), r: rand(1.4, 2.8), vx: rand(-14, 14), vy: rand(-10, 10) });
    const m = Math.round(60 * area);
    for (let i = 0; i < m; i++) motes.push({ x: rand(0, w), y: rand(0, h * 0.6), r: rand(0.4, 1.1), a: rand(0.1, 0.5), vx: 0, vy: 0, t: rand(0, 6.28) });
  }
}

function newSpark() {
  return { x: rand(0, w), y: h + rand(0, 60), vy: rand(-70, -22), vx: rand(-16, 16), r: rand(0.7, 2.1), life: 0, max: rand(1.6, 4.2), t: rand(0, 6.28) };
}
function newLeaf() {
  return { x: rand(0, w), y: rand(-h * 0.3, h), vy: rand(14, 34), vx: rand(-14, 14), r: rand(3, 7), rot: rand(0, 6.28), spin: rand(-1.4, 1.4), a: rand(0.10, 0.26) };
}

// ---------------------------------------------------------------- 各音景绘制
function drawRain(dt) {
  const light = isLight();
  ctx.save();
  ctx.strokeStyle = light ? 'rgba(120, 138, 168, 0.55)' : 'rgba(196, 216, 255, 0.62)';
  ctx.lineCap = 'round';
  const skew = 0.26;
  for (const d of drops) {
    d.y += d.speed * dt * intensity;
    d.x += d.speed * dt * skew * intensity;
    if (d.y > h + 40) { d.y = rand(-120, -10); d.x = rand(-0.1 * w, 1.1 * w); }
    ctx.globalAlpha = d.a * intensity;
    ctx.lineWidth = d.thick;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - d.len * skew, d.y - d.len);
    ctx.stroke();
  }
  // 玻璃上缓慢下滑的水痕
  ctx.strokeStyle = light ? 'rgba(150, 168, 196, 0.5)' : 'rgba(210, 228, 255, 0.5)';
  for (const s of streaks) {
    s.wobble += dt * 1.6;
    s.y += s.speed * dt * intensity;
    s.x += Math.sin(s.wobble) * 6 * dt;
    if (s.y - s.len > h) { s.y = rand(-160, -20); s.x = rand(0, w); s.len = rand(40, 160); }
    ctx.globalAlpha = s.a * intensity;
    ctx.lineWidth = s.r;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(s.x + Math.sin(s.wobble) * 4, s.y - s.len * 0.5, s.x, s.y - s.len);
    ctx.stroke();
    // 水痕头部的小水珠
    ctx.globalAlpha = s.a * 1.6 * intensity;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 1.4, 0, 6.2832);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
  // 底部涟漪
  if (Math.random() < dt * 14 * intensity) {
    ripples.push({ x: rand(0, w), y: rand(h * 0.82, h * 0.99), r: 1, max: rand(14, 40), a: rand(0.1, 0.26) });
  }
  ctx.strokeStyle = light ? 'rgba(130, 148, 178, 1)' : 'rgba(200, 220, 255, 1)';
  for (let i = ripples.length - 1; i >= 0; i--) {
    const r = ripples[i];
    r.r += dt * 34;
    r.a *= 1 - dt * 1.5;
    if (r.r > r.max || r.a < 0.01) { ripples.splice(i, 1); continue; }
    ctx.globalAlpha = r.a * intensity;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.r, r.r * 0.32, 0, 0, 6.2832);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWaves(dt) {
  waveT += dt;
  const light = isLight();
  ctx.save();
  const baseY = h * 0.78;
  for (let layer = 0; layer < 3; layer++) {
    const amp = (10 + layer * 9) * intensity;
    const speed = 0.5 + layer * 0.24;
    const yOff = baseY + layer * h * 0.07;
    const alpha = (light ? 0.10 : 0.14) - layer * 0.025;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 12) {
      const y = yOff
        + Math.sin(x / (220 + layer * 90) + waveT * speed) * amp
        + Math.sin(x / (70 + layer * 30) - waveT * speed * 1.7) * amp * 0.32;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, yOff - amp, 0, h);
    grad.addColorStop(0, light ? `rgba(255,255,255,${alpha + 0.06})` : `rgba(180, 214, 255, ${alpha + 0.05})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.globalAlpha = 1;
    ctx.fill();
    // 浪脊的白沫线
    ctx.strokeStyle = light ? 'rgba(255,255,255,0.45)' : 'rgba(226, 240, 255, 0.35)';
    ctx.globalAlpha = (0.5 - layer * 0.14) * intensity;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 12) {
      const y = yOff
        + Math.sin(x / (220 + layer * 90) + waveT * speed) * amp
        + Math.sin(x / (70 + layer * 30) - waveT * speed * 1.7) * amp * 0.32;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawFire(dt) {
  ctx.save();
  // 底部呼吸光晕
  const pulse = 0.72 + Math.sin(performance.now() / 620) * 0.13 + Math.sin(performance.now() / 210) * 0.05;
  const grad = ctx.createRadialGradient(w / 2, h * 1.06, 0, w / 2, h * 1.06, Math.max(w, h) * 0.62);
  grad.addColorStop(0, `rgba(255, 168, 72, ${0.24 * pulse * intensity})`);
  grad.addColorStop(0.42, `rgba(226, 118, 40, ${0.10 * pulse * intensity})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // 上升火星
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life += dt;
    s.t += dt * 3;
    s.y += s.vy * dt * intensity;
    s.x += (s.vx + Math.sin(s.t) * 12) * dt;
    s.vy *= 1 - dt * 0.22;
    if (s.life > s.max || s.y < -20) { sparks[i] = newSpark(); continue; }
    const k = 1 - s.life / s.max;
    ctx.globalAlpha = Math.max(0, k * 0.85) * intensity;
    ctx.fillStyle = `rgb(255, ${Math.round(150 + 90 * k)}, ${Math.round(50 + 40 * k)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * (0.5 + k * 0.8), 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();
}

function drawForest(dt) {
  const light = isLight();
  ctx.save();
  // 树影间晃动的光斑
  const t = performance.now() / 1000;
  for (let i = 0; i < 4; i++) {
    const x = w * (0.16 + i * 0.23) + Math.sin(t * 0.28 + i) * 42;
    const y = h * (0.12 + (i % 2) * 0.16) + Math.cos(t * 0.22 + i) * 26;
    const r = Math.max(w, h) * (0.12 + (i % 3) * 0.035);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = (light ? 0.09 : 0.07) * intensity * (0.7 + Math.sin(t * 0.5 + i) * 0.3);
    g.addColorStop(0, `rgba(255, 244, 196, ${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  // 飘落的叶
  for (const l of leaves) {
    l.y += l.vy * dt * intensity;
    l.x += (l.vx + Math.sin(l.y / 60) * 16) * dt;
    l.rot += l.spin * dt;
    if (l.y > h + 30) { l.y = rand(-80, -10); l.x = rand(0, w); }
    ctx.globalAlpha = l.a * intensity;
    ctx.fillStyle = light ? 'rgba(148, 128, 62, 1)' : 'rgba(206, 186, 118, 1)';
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, l.r, l.r * 0.42, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();
  }
  drawMotes(dt, light ? 'rgba(120, 110, 70, 1)' : 'rgba(230, 228, 200, 1)');
  ctx.restore();
}

function drawMotes(dt, color) {
  ctx.fillStyle = color;
  for (const m of motes) {
    m.t += dt;
    m.x += (m.vx + Math.sin(m.t * 0.7) * 4) * dt;
    m.y += m.vy * dt;
    if (m.y < -10) m.y = h + 10;
    if (m.y > h + 10) m.y = -10;
    if (m.x < -10) m.x = w + 10;
    if (m.x > w + 10) m.x = -10;
    ctx.globalAlpha = m.a * (0.6 + Math.sin(m.t * 1.4) * 0.4) * intensity;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, 6.2832);
    ctx.fill();
  }
}

function drawCafe(dt) {
  const light = isLight();
  ctx.save();
  const t = performance.now() / 1000;
  const x = w * 0.78 + Math.sin(t * 0.2) * 20;
  const y = h * 0.18;
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.4);
  g.addColorStop(0, `rgba(255, 206, 132, ${(light ? 0.10 : 0.13) * intensity})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawMotes(dt, light ? 'rgba(140, 110, 70, 1)' : 'rgba(255, 226, 180, 1)');
  ctx.restore();
}

function drawNight(dt) {
  ctx.save();
  // 星点
  ctx.fillStyle = 'rgba(226, 236, 255, 1)';
  for (const m of motes) {
    m.t += dt * 0.8;
    ctx.globalAlpha = m.a * (0.45 + Math.sin(m.t * 1.1 + m.x) * 0.55) * intensity;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, 6.2832);
    ctx.fill();
  }
  // 流萤
  for (const f of fireflies) {
    f.t += dt * f.phase;
    f.x += (f.vx + Math.sin(f.t * 1.3) * 18) * dt;
    f.y += (f.vy + Math.cos(f.t) * 12) * dt;
    if (f.x < -20) f.x = w + 20; if (f.x > w + 20) f.x = -20;
    if (f.y < h * 0.15) f.y = h * 0.15; if (f.y > h + 20) f.y = h * 0.3;
    const glow = Math.max(0, Math.sin(f.t * 1.7));
    if (glow < 0.02) continue;
    ctx.globalAlpha = glow * 0.8 * intensity;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
    g.addColorStop(0, 'rgba(206, 255, 158, 0.95)');
    g.addColorStop(0.35, 'rgba(176, 240, 120, 0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * 7, 0, 6.2832);
    ctx.fill();
  }
  ctx.restore();
}

const painters = { rain: drawRain, waves: drawWaves, fire: drawFire, forest: drawForest, cafe: drawCafe, night: drawNight };

// ---------------------------------------------------------------- 循环
function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
  last = now;
  ctx.clearRect(0, 0, w, h);
  painters[kind]?.(dt);
  raf = requestAnimationFrame(frame);
}

function start() {
  if (running || kind === 'none' || reduceMotion) return;
  ensureCanvas();
  running = true;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function stop(clear = true) {
  running = false;
  cancelAnimationFrame(raf);
  if (clear && ctx) ctx.clearRect(0, 0, w, h);
}

export function setKind(next) {
  kind = painters[next] ? next : 'none';
  if (kind === 'none') {
    stop();
    canvas?.classList.remove('is-on');
    return;
  }
  ensureCanvas();
  seed();
  canvas.classList.add('is-on');
  if (!document.hidden) start();
}

export function setIntensity(volume) {
  // 音量 0 时动效也停，避免"没声音却在下雨"
  intensity = Math.max(0.25, Math.min(1.35, 0.35 + Number(volume || 0) * 1.0));
  if (Number(volume) <= 0.001) { stop(); canvas?.classList.remove('is-on'); }
  else if (kind !== 'none') { canvas?.classList.add('is-on'); if (!document.hidden) start(); }
}

export function init() {
  if (reduceMotion) return;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(false); else if (kind !== 'none') start();
  });
  Audio.onAmbientChange(({ kind: k, volume }) => {
    setIntensity(volume);
    setKind(k);
  });
  setKind(Audio.getAmbient());
  setIntensity(Audio.getAmbientVolume());
}

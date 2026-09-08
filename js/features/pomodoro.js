/**
 * features/pomodoro.js · 番茄钟
 *
 * - 专注 / 短休息 / 长休息三段循环，时长均可自定义
 * - 开始后进入沉浸专注模式：全屏只剩倒计时，界面其余部分淡出
 * - 计时基于目标时间戳（不受后台标签节流影响）
 * - 每天的专注秒数、休息秒数、完成轮数写入日志，首页与统计页可看
 */

import { $, $$, refreshIcons, refreshIconsNow, toast } from '../ui/dom.js';
import { storage } from '../core/storage.js';
import { todayKey } from '../core/srs.js';
import * as Audio from '../core/audio.js';

const PHASE = { focus: 'focus', short: 'short', long: 'long' };
const PHASE_LABEL = { focus: '专注', short: '短休息', long: '长休息' };

const state = {
  phase: PHASE.focus,
  totalSec: 25 * 60,
  leftSec: 25 * 60,
  endAt: 0,
  running: false,
  round: 1,
  immersive: false,
  ticker: null,
  accum: 0,        // 未落盘的秒数
  lastFlush: 0,
};

let stage = null;
const subscribers = new Set();

function settings() { return storage.getSettings(); }

function phaseMinutes(phase = state.phase) {
  const s = settings();
  if (phase === PHASE.short) return Math.max(1, s.breakMinutes || 5);
  if (phase === PHASE.long) return Math.max(1, s.longBreakMinutes || 15);
  return Math.max(1, s.pomodoroMinutes || 25);
}

export function todayStats(key = todayKey()) {
  const day = storage.getLog()[key] || {};
  return { focusSec: day.focusSec || 0, breakSec: day.breakSec || 0, pomos: day.pomos || 0 };
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分钟`;
  return `${s} 秒`;
}

const mmss = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- 统计落盘
function flush(force = false) {
  if (state.accum < 1 && !force) return;
  const whole = Math.floor(state.accum);
  if (whole < 1) return;
  state.accum -= whole;
  const field = state.phase === PHASE.focus ? 'focusSec' : 'breakSec';
  storage.bumpLog(todayKey(), { [field]: whole });
  window.dispatchEvent(new CustomEvent('pomodoro-stats'));
}

// ---------------------------------------------------------------- 状态机
function setPhase(phase, { autoStart = false } = {}) {
  flush(true);
  state.phase = phase;
  state.totalSec = phaseMinutes(phase) * 60;
  state.leftSec = state.totalSec;
  state.endAt = 0;
  stopTicker();
  state.running = false;
  if (autoStart) start();
  else render();
}

function stopTicker() {
  if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
}

function tick() {
  const now = Date.now();
  const left = Math.max(0, (state.endAt - now) / 1000);
  const delta = Math.max(0, state.leftSec - left);
  state.accum += delta;
  state.leftSec = left;
  if (now - state.lastFlush > 15000) { flush(); state.lastFlush = now; }
  if (left <= 0.05) { complete(); return; }
  render();
}

export function start() {
  if (state.running) return;
  Audio.unlock();
  state.running = true;
  state.endAt = Date.now() + state.leftSec * 1000;
  state.lastFlush = Date.now();
  stopTicker();
  state.ticker = setInterval(tick, 250);
  render();
  notify();
}

export function pause() {
  if (!state.running) return;
  flush(true);
  state.running = false;
  stopTicker();
  render();
  notify();
}

export function toggle() {
  if (state.running) pause();
  else { start(); if (state.phase === PHASE.focus) enterImmersive(); }
}

export function reset() {
  flush(true);
  stopTicker();
  state.running = false;
  state.leftSec = state.totalSec;
  state.endAt = 0;
  render();
  notify();
}

/** 跳到下一阶段（不计入完成轮数） */
export function skip() {
  const next = state.phase === PHASE.focus ? nextBreakPhase() : PHASE.focus;
  if (state.phase !== PHASE.focus) state.round++;
  setPhase(next);
  toast(`已切到${PHASE_LABEL[next]}`, 'info', 1600);
  notify();
}

function nextBreakPhase() {
  const every = Math.max(2, settings().longBreakEvery || 4);
  return state.round % every === 0 ? PHASE.long : PHASE.short;
}

function complete() {
  flush(true);
  stopTicker();
  state.running = false;
  state.leftSec = 0;
  render();

  if (state.phase === PHASE.focus) {
    storage.bumpLog(todayKey(), { pomos: 1 });
    window.dispatchEvent(new CustomEvent('pomodoro-stats'));
    Audio.chime(true);
    const next = nextBreakPhase();
    const mins = phaseMinutes(next);
    toast(`🍅 第 ${state.round} 轮专注完成，${PHASE_LABEL[next]} ${mins} 分钟`, 'success', 4200);
    setPhase(next, { autoStart: true });
    celebrate();
  } else {
    Audio.chime(false);
    state.round++;
    toast('休息结束，开始下一轮专注', 'info', 3200);
    setPhase(PHASE.focus);
  }
  notify();
}

// ---------------------------------------------------------------- 沉浸模式
export function enterImmersive() {
  ensureStage();
  if (state.immersive) return;
  state.immersive = true;
  document.body.classList.add('is-immersive');
  document.body.dataset.focus = 'on';
  stage.hidden = false;
  requestAnimationFrame(() => stage.classList.add('is-open'));
  render();
  notify();
}

export function exitImmersive() {
  if (!state.immersive) return;
  state.immersive = false;
  document.body.classList.remove('is-immersive');
  delete document.body.dataset.focus;
  stage?.classList.remove('is-open');
  setTimeout(() => { if (stage && !state.immersive) stage.hidden = true; }, 420);
  notify();
}

export function isImmersive() { return state.immersive; }
export function isRunning() { return state.running; }
export function snapshot() {
  return { phase: state.phase, label: PHASE_LABEL[state.phase], leftSec: state.leftSec, totalSec: state.totalSec, running: state.running, round: state.round, immersive: state.immersive, text: mmss(state.leftSec) };
}

export function onChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
function notify() {
  const snap = snapshot();
  subscribers.forEach(fn => { try { fn(snap); } catch {} });
}

// ---------------------------------------------------------------- 全屏舞台
function ensureStage() {
  if (stage) return stage;
  stage = document.createElement('section');
  stage.className = 'focus-stage';
  stage.hidden = true;
  stage.setAttribute('aria-label', '专注模式');
  stage.innerHTML = `
    <div class="focus-inner">
      <p class="focus-phase"><span id="focus-phase-text">专注中</span><em id="focus-round">第 1 轮</em></p>
      <div class="focus-dial">
        <svg viewBox="0 0 240 240" aria-hidden="true">
          <circle class="focus-dial-bg" cx="120" cy="120" r="110"></circle>
          <circle class="focus-dial-fg" id="focus-dial-fg" cx="120" cy="120" r="110"></circle>
        </svg>
        <div class="focus-time mono" id="focus-time">25:00</div>
      </div>
      <div class="focus-controls">
        <button class="focus-btn primary" id="focus-toggle"><i data-lucide="pause"></i><span>暂停</span></button>
        <button class="focus-btn" id="focus-reset" title="重置本段"><i data-lucide="rotate-ccw"></i></button>
        <button class="focus-btn" id="focus-skip" title="跳到下一段"><i data-lucide="skip-forward"></i></button>
        <button class="focus-btn" id="focus-exit" title="退出全屏（计时继续）"><i data-lucide="minimize-2"></i></button>
      </div>
      <div class="focus-ambient" id="focus-ambient"></div>
      <p class="focus-today" id="focus-today"></p>
      <p class="focus-hint">空格 暂停/继续 · Esc 退出全屏（计时继续）</p>
    </div>`;
  document.body.append(stage);

  stage.querySelector('#focus-toggle').addEventListener('click', () => toggle());
  stage.querySelector('#focus-reset').addEventListener('click', () => reset());
  stage.querySelector('#focus-skip').addEventListener('click', () => skip());
  stage.querySelector('#focus-exit').addEventListener('click', () => exitImmersive());
  renderAmbientBar(stage.querySelector('#focus-ambient'));
  refreshIconsNow(stage);
  return stage;
}

/** 完成一轮时的庆祝动画 */
function celebrate() {
  if (!state.immersive || !stage) return;
  const burst = document.createElement('div');
  burst.className = 'focus-burst';
  stage.querySelector('.focus-inner')?.append(burst);
  setTimeout(() => burst.remove(), 1400);
}

// ---------------------------------------------------------------- 环境声条（专注页与首页共用）
export function renderAmbientBar(container, { compact = false } = {}) {
  if (!container) return;
  const kinds = ['none', ...Audio.getAmbientKinds()];
  container.classList.add('ambient-bar');
  container.innerHTML = `
    <div class="ambient-btns">
      ${kinds.map(k => {
        const meta = Audio.AMBIENT_META[k];
        return `<button type="button" data-ambient="${k}" title="${meta.label}"><i data-lucide="${meta.icon}"></i>${compact ? '' : `<span>${meta.label}</span>`}</button>`;
      }).join('')}
    </div>
    <label class="ambient-volume">
      <i data-lucide="volume-2"></i>
      <input type="range" min="0" max="100" step="1" aria-label="环境声音量" />
      <em class="mono">70</em>
    </label>`;

  const sync = () => {
    const cur = Audio.getAmbient();
    container.querySelectorAll('[data-ambient]').forEach(b => b.classList.toggle('is-active', b.dataset.ambient === cur));
    const vol = Math.round(Audio.getAmbientVolume() * 100);
    const range = container.querySelector('input[type=range]');
    const num = container.querySelector('em');
    if (range && document.activeElement !== range) range.value = vol;
    if (num) num.textContent = vol;
    const icon = container.querySelector('.ambient-volume i');
    if (icon) {
      const name = vol === 0 ? 'volume-x' : vol < 45 ? 'volume-1' : 'volume-2';
      if (icon.dataset.lucide !== name) { icon.dataset.lucide = name; icon.setAttribute('data-lucide', name); refreshIcons(container); }
    }
  };

  container.querySelectorAll('[data-ambient]').forEach(btn => {
    btn.addEventListener('click', () => {
      Audio.unlock();
      const kind = btn.dataset.ambient;
      Audio.playAmbient(kind);
      storage.saveSettings({ ambient: kind });
      if (kind !== 'none' && Audio.getAmbientVolume() < 0.05) {
        Audio.setAmbientVolume(0.6);
        storage.saveSettings({ ambientVolume: 0.6 });
      }
      sync();
      if (kind !== 'none') toast(`${Audio.AMBIENT_META[kind].label} 已开启`, 'info', 1400);
    });
  });
  const range = container.querySelector('input[type=range]');
  range.addEventListener('input', () => {
    const v = Number(range.value) / 100;
    Audio.setAmbientVolume(v);
    sync();
  });
  range.addEventListener('change', () => storage.saveSettings({ ambientVolume: Number(range.value) / 100 }));

  Audio.onAmbientChange(sync);
  sync();
  refreshIconsNow(container);
  return sync;
}

// ---------------------------------------------------------------- 渲染
function render() {
  const pct = state.totalSec ? (state.totalSec - state.leftSec) / state.totalSec : 0;
  const text = mmss(state.leftSec);
  document.title = state.running ? `${text} · ${PHASE_LABEL[state.phase]} · Yuki 自习室` : 'Yuki 自习室';

  // 全屏舞台
  if (stage) {
    const t = stage.querySelector('#focus-time');
    if (t) t.textContent = text;
    const ph = stage.querySelector('#focus-phase-text');
    if (ph) ph.textContent = state.running ? `${PHASE_LABEL[state.phase]}中` : `${PHASE_LABEL[state.phase]} · 已暂停`;
    const rd = stage.querySelector('#focus-round');
    if (rd) rd.textContent = `第 ${state.round} 轮`;
    const dial = stage.querySelector('#focus-dial-fg');
    if (dial) {
      const circ = 2 * Math.PI * 110;
      dial.style.strokeDasharray = String(circ);
      dial.style.strokeDashoffset = String(circ * (1 - pct));
    }
    const btn = stage.querySelector('#focus-toggle');
    if (btn) {
      const icon = state.running ? 'pause' : 'play';
      const label = state.running ? '暂停' : (state.leftSec < state.totalSec ? '继续' : '开始');
      if (btn.dataset.mode !== icon) {
        btn.dataset.mode = icon;
        btn.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
        refreshIconsNow(btn);
      } else {
        const span = btn.querySelector('span');
        if (span && span.textContent !== label) span.textContent = label;
      }
    }
    const today = stage.querySelector('#focus-today');
    if (today) {
      const s = todayStats();
      today.textContent = `今日已专注 ${formatDuration(s.focusSec)} · 休息 ${formatDuration(s.breakSec)} · 完成 ${s.pomos} 轮`;
    }
    stage.dataset.phase = state.phase;
  }

  window.dispatchEvent(new CustomEvent('pomodoro-tick', { detail: snapshot() }));
}

// ---------------------------------------------------------------- 初始化
export function init() {
  const s = settings();
  state.totalSec = state.leftSec = Math.max(1, s.pomodoroMinutes || 25) * 60;

  document.addEventListener('keydown', (e) => {
    if (!state.immersive) return;
    const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (e.key === 'Escape') { e.preventDefault(); exitImmersive(); }
    else if (e.code === 'Space' && !typing) { e.preventDefault(); toggle(); }
  });

  window.addEventListener('beforeunload', () => flush(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); else if (state.running) tick(); });
  window.addEventListener('settings-changed', () => {
    // 时长设置变化时，未运行的阶段立即采用新值
    if (!state.running) {
      const next = phaseMinutes() * 60;
      if (next !== state.totalSec) { state.totalSec = next; state.leftSec = next; render(); notify(); }
    }
  });

  render();
}

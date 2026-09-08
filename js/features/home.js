/**
 * features/home.js · 今日首页：今日任务 + 番茄钟 + 环境音景 + 最近记录
 */

import { $, $$, escapeHtml, refreshIcons, toast, weekdayCn } from '../ui/dom.js';
import { switchView } from '../ui/router.js';
import { openWordSheet } from '../ui/overlay.js';
import { storage } from '../core/storage.js';
import * as Audio from '../core/audio.js';
import * as Engine from './study-engine.js';
import * as Learn from './learn.js';
import * as Pomodoro from './pomodoro.js';

let root = null;

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了，注意休息';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function template() {
  return `
  <div class="home-hero">
    <div class="home-hero-text">
      <p class="eyebrow" id="home-date"></p>
      <h2 class="serif" id="home-greeting"></h2>
      <p class="muted" id="home-lede"></p>
    </div>
    <div class="ring-card panel">
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-bg" cx="60" cy="60" r="52"></circle>
        <circle class="ring-fg" id="ring-fg" cx="60" cy="60" r="52"></circle>
      </svg>
      <div class="ring-center">
        <strong id="ring-pct">0%</strong>
        <span>今日完成</span>
      </div>
    </div>
  </div>

  <div class="home-grid">
    <section class="panel task-card" id="task-review">
      <div class="task-icon gold"><i data-lucide="rotate-ccw"></i></div>
      <div class="task-body">
        <p class="eyebrow">到期复习</p>
        <h3><span id="home-due">0</span> <small>词</small></h3>
        <p class="muted small" id="home-due-desc"></p>
      </div>
      <button class="btn btn-primary" id="btn-start-review"><span>开始复习</span><i data-lucide="arrow-right"></i></button>
    </section>

    <section class="panel task-card" id="task-new">
      <div class="task-icon blue"><i data-lucide="sparkles"></i></div>
      <div class="task-body">
        <p class="eyebrow">今日新词</p>
        <h3><span id="home-new-done">0</span> <small>/ <span id="home-new-goal">20</span></small></h3>
        <p class="muted small" id="home-new-desc"></p>
      </div>
      <button class="btn btn-soft" id="btn-start-new"><span>学新词</span><i data-lucide="arrow-right"></i></button>
    </section>

    <section class="panel stat-strip">
      <div class="stat"><i data-lucide="flame"></i><div><strong id="home-streak">0</strong><span>连续天数</span></div></div>
      <div class="stat"><i data-lucide="library"></i><div><strong id="home-total">0</strong><span>累计学习</span></div></div>
      <div class="stat"><i data-lucide="shield-check"></i><div><strong id="home-mature">0</strong><span>已牢记</span></div></div>
      <div class="stat is-link" id="home-wrong-stat"><i data-lucide="flag"></i><div><strong id="home-wrong">0</strong><span>错词本</span></div></div>
    </section>

    <section class="panel pomodoro" id="pomo-card">
      <header class="panel-head">
        <div><p class="eyebrow">专注</p><h3 id="pomo-state">准备开始</h3></div>
        <span class="pill" id="pomo-round">第 1 轮</span>
      </header>

      <div class="pomo-main">
        <div class="pomo-time mono" id="pomo-time">25:00</div>
        <div class="progress-track"><div class="progress-fill gold" id="pomo-fill"></div></div>
      </div>

      <div class="pomo-controls">
        <button class="btn btn-primary" id="pomo-start"><i data-lucide="play"></i><span>开始专注</span></button>
        <button class="btn btn-soft btn-sm" id="pomo-expand" title="进入全屏专注"><i data-lucide="maximize-2"></i><span>全屏</span></button>
        <button class="icon-btn" id="pomo-reset" title="重置"><i data-lucide="rotate-ccw"></i></button>
        <button class="icon-btn" id="pomo-skip" title="跳到下一段"><i data-lucide="skip-forward"></i></button>
      </div>

      <div class="pomo-durations">
        <label><span>专注</span><input id="pomo-min-focus" type="number" min="1" max="180" inputmode="numeric" /><em>分</em></label>
        <label><span>短休</span><input id="pomo-min-short" type="number" min="1" max="60" inputmode="numeric" /><em>分</em></label>
        <label><span>长休</span><input id="pomo-min-long" type="number" min="1" max="90" inputmode="numeric" /><em>分</em></label>
        <label><span>每</span><input id="pomo-every" type="number" min="2" max="12" inputmode="numeric" /><em>轮长休</em></label>
      </div>

      <div class="pomo-today" id="pomo-today"></div>
      <div id="home-ambient"></div>
    </section>

    <section class="panel ai-banner">
      <div class="ai-banner-icon"><i data-lucide="sparkles"></i></div>
      <div>
        <h3>AI 助教</h3>
        <p class="muted small">词源拆解 · 长难句精读 · 口语陪练。背词时点「问 AI」，会自动带上当前单词。</p>
      </div>
      <button class="btn btn-soft" data-view-target="chat"><span>开始对话</span><i data-lucide="arrow-right"></i></button>
    </section>

    <section class="panel recent">
      <header class="panel-head"><div><p class="eyebrow">最近</p><h3>学习记录</h3></div><button class="btn btn-ghost btn-sm" data-view-target="stats"><span>全部</span><i data-lucide="chevron-right"></i></button></header>
      <ul class="recent-list" id="recent-list"></ul>
    </section>
  </div>`;
}

export function render() {
  if (!root) return;
  const s = Engine.getTodaySummary();
  const m = Engine.getMaturityStats();
  const now = new Date();
  $('#home-date', root).textContent = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdayCn(now)}`;
  $('#home-greeting', root).textContent = `${greeting()}${storage.getCloudAuth().username ? '，' + storage.getCloudAuth().username : ''}`;

  const target = s.due + s.reviewDone + s.dailyNew;
  const doneCount = s.reviewDone + s.newDone;
  const pct = target ? Math.min(100, Math.round((doneCount / target) * 100)) : 0;
  $('#ring-pct', root).textContent = `${pct}%`;
  const ring = $('#ring-fg', root);
  const circ = 2 * Math.PI * 52;
  ring.style.strokeDasharray = `${circ}`;
  ring.style.strokeDashoffset = `${circ * (1 - pct / 100)}`;

  $('#home-lede', root).textContent = s.due > 0
    ? `有 ${s.due} 个词今天到期，先复习再学新词效果最好。`
    : s.newRemaining > 0 ? `复习已清空，今天还可以学 ${s.newRemaining} 个新词。` : '今天的任务都完成了，可以去阅读室或者休息一下。';

  $('#home-due', root).textContent = s.due;
  $('#home-due-desc', root).textContent = s.due ? '按记忆曲线，这些词今天最容易忘' : `今天没有到期的词${s.reviewDone ? `，已复习 ${s.reviewDone} 个` : ''}`;
  $('#btn-start-review', root).disabled = s.due === 0;
  $('#home-new-done', root).textContent = s.newDone;
  $('#home-new-goal', root).textContent = s.dailyNew;
  $('#home-new-desc', root).textContent = s.newRemaining ? `还差 ${s.newRemaining} 个达成今日目标` : '今日新词目标已达成 🎉';
  $('#home-streak', root).textContent = s.streak;
  $('#home-total', root).textContent = m.total;
  $('#home-mature', root).textContent = m.mature;
  $('#home-wrong', root).textContent = s.wrong;

  renderPomoStats();

  const list = $('#recent-list', root);
  const sessions = storage.getSessions().slice(0, 5);
  list.innerHTML = sessions.length ? sessions.map(x => `
    <li class="recent-item" data-id="${escapeHtml(x.id)}">
      <span class="recent-icon"><i data-lucide="${x.type === 'reading' ? 'book-open-text' : 'layers'}"></i></span>
      <div><strong>${escapeHtml(x.title || '学习记录')}</strong><small>${escapeHtml(x.date || '')} · ${(x.words || []).length} 词${x.accuracy != null ? ` · 一遍过 ${x.accuracy}%` : ''}</small></div>
      <i data-lucide="chevron-right" class="muted"></i>
    </li>`).join('') : '<li class="empty-line muted">还没有记录，从上面开始第一轮吧。</li>';
  list.querySelectorAll('[data-id]').forEach(li => li.addEventListener('click', () => {
    const sess = storage.getSession(li.dataset.id);
    if (!sess) return;
    if (sess.type === 'reading') { window.dispatchEvent(new CustomEvent('reading-open', { detail: { id: sess.id } })); switchView('reading'); }
    else if (sess.words?.length) openWordSheet(sess.words[0]);
  }));
  refreshIcons(root);
}

function renderPomoStats() {
  const box = $('#pomo-today', root);
  if (!box) return;
  const t = Pomodoro.todayStats();
  box.innerHTML = `
    <div class="pomo-stat"><i data-lucide="timer"></i><div><strong>${Pomodoro.formatDuration(t.focusSec)}</strong><span>今日专注</span></div></div>
    <div class="pomo-stat"><i data-lucide="coffee"></i><div><strong>${Pomodoro.formatDuration(t.breakSec)}</strong><span>今日休息</span></div></div>
    <div class="pomo-stat"><i data-lucide="check-check"></i><div><strong>${t.pomos}</strong><span>完成轮数</span></div></div>`;
  refreshIcons(box);
}

function renderPomoCard(snap = Pomodoro.snapshot()) {
  if (!root) return;
  const timeEl = $('#pomo-time', root);
  if (!timeEl) return;
  timeEl.textContent = snap.text;
  $('#pomo-state', root).textContent = snap.running ? `${snap.label}中` : (snap.leftSec < snap.totalSec ? `${snap.label} · 已暂停` : `准备${snap.label}`);
  $('#pomo-round', root).textContent = `第 ${snap.round} 轮`;
  const pct = snap.totalSec ? ((snap.totalSec - snap.leftSec) / snap.totalSec) * 100 : 0;
  $('#pomo-fill', root).style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const btn = $('#pomo-start', root);
  const icon = snap.running ? 'pause' : 'play';
  const label = snap.running ? '暂停' : (snap.leftSec < snap.totalSec ? '继续' : `开始${snap.phase === 'focus' ? '专注' : '休息'}`);
  if (btn.dataset.mode !== icon + label) {
    btn.dataset.mode = icon + label;
    btn.innerHTML = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    refreshIcons(btn);
  }
  $('#pomo-card', root).classList.toggle('is-running', snap.running);
  $('#pomo-card', root).dataset.phase = snap.phase;
}

function bindPomodoro() {
  const fields = {
    'pomo-min-focus': 'pomodoroMinutes',
    'pomo-min-short': 'breakMinutes',
    'pomo-min-long': 'longBreakMinutes',
    'pomo-every': 'longBreakEvery',
  };
  const limits = { pomodoroMinutes: [1, 180], breakMinutes: [1, 60], longBreakMinutes: [1, 90], longBreakEvery: [2, 12] };
  const s = storage.getSettings();
  for (const [id, key] of Object.entries(fields)) {
    const input = $('#' + id, root);
    input.value = s[key];
    input.addEventListener('change', () => {
      const [min, max] = limits[key];
      const v = Math.max(min, Math.min(max, parseInt(input.value, 10) || min));
      input.value = v;
      storage.saveSettings({ [key]: v });
      window.dispatchEvent(new CustomEvent('settings-changed'));
      toast(`${key === 'longBreakEvery' ? '长休息间隔' : '时长'}已更新`, 'info', 1400);
    });
  }

  $('#pomo-start', root).addEventListener('click', () => {
    const wasRunning = Pomodoro.isRunning();
    Pomodoro.toggle();
    if (!wasRunning) Pomodoro.enterImmersive();
  });
  $('#pomo-expand', root).addEventListener('click', () => Pomodoro.enterImmersive());
  $('#pomo-reset', root).addEventListener('click', () => Pomodoro.reset());
  $('#pomo-skip', root).addEventListener('click', () => Pomodoro.skip());

  Pomodoro.renderAmbientBar($('#home-ambient', root));
  Pomodoro.onChange(renderPomoCard);
  window.addEventListener('pomodoro-tick', (e) => renderPomoCard(e.detail));
  window.addEventListener('pomodoro-stats', renderPomoStats);
  renderPomoCard();
}

export function init(container) {
  root = container;
  root.innerHTML = template();
  bindPomodoro();
  $('#btn-start-review', root).addEventListener('click', () => Learn.start('review'));
  $('#btn-start-new', root).addEventListener('click', () => Learn.start('new'));
  $('#home-wrong-stat', root).addEventListener('click', () => Learn.start('wrong'));
  $$('[data-view-target]', root).forEach(b => b.addEventListener('click', () => switchView(b.dataset.viewTarget)));
  window.addEventListener('study-progress', render);
  window.addEventListener('data-changed', render);
  render();
}

export function onShow() { render(); }

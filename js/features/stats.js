/**
 * features/stats.js · 统计：概览、14 天趋势、热力图、月历与记录、错词榜、掌握度分布
 */

import { $, $$, escapeHtml, refreshIcons, formatDateCn } from '../ui/dom.js';
import { openWordSheet } from '../ui/overlay.js';
import { switchView } from '../ui/router.js';
import { storage } from '../core/storage.js';
import { todayKey } from '../core/srs.js';
import * as Engine from './study-engine.js';
import * as Learn from './learn.js';

let root = null;
let month = new Date();
let selectedDate = '';

function template() {
  return `
  <div class="stats-tiles" id="st-tiles"></div>
  <div class="stats-grid">
    <section class="panel span-2">
      <header class="panel-head"><div><p class="eyebrow">最近 14 天</p><h3>学习趋势</h3></div><div class="legend"><span><i class="sw sw-gold"></i>新词</span><span><i class="sw sw-blue"></i>复习</span></div></header>
      <div class="bars" id="st-bars"></div>
    </section>
    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">掌握度</p><h3>词汇分布</h3></div></header>
      <div class="maturity" id="st-maturity"></div>
      <header class="panel-head mt"><div><p class="eyebrow">未来 7 天</p><h3>预计到期</h3></div></header>
      <div class="upcoming" id="st-upcoming"></div>
    </section>
    <section class="panel span-2">
      <header class="panel-head"><div><p class="eyebrow">最近 14 天</p><h3>专注与休息</h3></div><div class="legend"><span><i class="sw sw-gold"></i>专注</span><span><i class="sw sw-green"></i>休息</span></div></header>
      <div class="bars" id="st-focus-bars"></div>
    </section>
    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">番茄钟</p><h3>累计专注</h3></div></header>
      <div class="focus-totals" id="st-focus-totals"></div>
    </section>
    <section class="panel span-3">
      <header class="panel-head"><div><p class="eyebrow">最近 20 周</p><h3>打卡热力图</h3></div><span class="muted small" id="st-heat-total"></span></header>
      <div class="heatmap-wrap"><div class="heatmap" id="st-heatmap"></div></div>
    </section>
    <section class="panel span-2">
      <header class="panel-head">
        <button class="icon-btn" id="st-prev" title="上个月"><i data-lucide="chevron-left"></i></button>
        <h3 id="st-month"></h3>
        <button class="icon-btn" id="st-next" title="下个月"><i data-lucide="chevron-right"></i></button>
      </header>
      <div class="cal-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
      <div class="cal-grid" id="st-cal"></div>
      <div class="archive-head" id="st-archive-head"></div>
      <ul class="archive" id="st-archive"></ul>
    </section>
    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">错词榜</p><h3>最常忘记</h3></div><button class="btn btn-ghost btn-sm" id="st-wrong-go"><span>去攻克</span><i data-lucide="arrow-right"></i></button></header>
      <ol class="wrong-list" id="st-wrong"></ol>
    </section>
  </div>`;
}

function renderTiles() {
  const s = Engine.getTodaySummary();
  const m = Engine.getMaturityStats();
  const log = Object.values(storage.getLog());
  const totalReviews = log.reduce((a, d) => a + (d.total || 0), 0);
  const totalAgain = log.reduce((a, d) => a + (d.again || 0), 0);
  const acc = totalReviews ? Math.round(((totalReviews - totalAgain) / totalReviews) * 100) : 0;
  const tiles = [
    { icon: 'library', label: '累计学习', value: m.total, sub: `词库共 ${m.total + m.new} 词` },
    { icon: 'shield-check', label: '已牢记', value: m.mature, sub: '间隔 ≥ 21 天' },
    { icon: 'flame', label: '连续天数', value: s.streak, sub: s.total ? '今天已打卡' : '今天还没学' },
    { icon: 'target', label: '总体正确率', value: `${acc}%`, sub: `${totalReviews} 次评分` },
    { icon: 'rotate-ccw', label: '今日到期', value: s.due, sub: `已复习 ${s.reviewDone}` },
    { icon: 'flag', label: '错词本', value: s.wrong, sub: '评过「忘了」的词' },
  ];
  $('#st-tiles', root).innerHTML = tiles.map(t => `<div class="panel tile-card"><i data-lucide="${t.icon}"></i><div><span>${t.label}</span><strong>${t.value}</strong><small>${t.sub}</small></div></div>`).join('');
}

function renderBars() {
  const data = Engine.getRecentLog(14);
  const max = Math.max(1, ...data.map(d => d.new + d.review));
  $('#st-bars', root).innerHTML = data.map(d => {
    const nh = (d.new / max) * 100, rh = (d.review / max) * 100;
    const [, mm, dd] = d.date.split('-');
    return `<div class="bar" title="${d.date} · 新词 ${d.new} · 复习 ${d.review}"><div class="bar-stack"><i class="seg seg-blue" style="height:${rh}%"></i><i class="seg seg-gold" style="height:${nh}%"></i></div><span>${Number(dd)}${dd === '01' || d === data[0] ? `<br>${Number(mm)}月` : ''}</span></div>`;
  }).join('');
}

function renderFocus() {
  const data = Engine.getRecentLog(14);
  const maxMin = Math.max(25, ...data.map(d => ((d.focusSec || 0) + (d.breakSec || 0)) / 60));
  $('#st-focus-bars', root).innerHTML = data.map(d => {
    const fm = (d.focusSec || 0) / 60;
    const bm = (d.breakSec || 0) / 60;
    const [, mm, dd] = d.date.split('-');
    return `<div class="bar" title="${d.date} · 专注 ${Math.round(fm)} 分 · 休息 ${Math.round(bm)} 分 · ${d.pomos || 0} 轮"><div class="bar-stack"><i class="seg seg-green" style="height:${(bm / maxMin) * 100}%"></i><i class="seg seg-gold" style="height:${(fm / maxMin) * 100}%"></i></div><span>${Number(dd)}</span></div>`;
  }).join('');

  const log = Object.values(storage.getLog());
  const focusSec = log.reduce((a, d) => a + (d.focusSec || 0), 0);
  const breakSec = log.reduce((a, d) => a + (d.breakSec || 0), 0);
  const pomos = log.reduce((a, d) => a + (d.pomos || 0), 0);
  const today = log.length ? (storage.getLog()[todayKey()] || {}) : {};
  const fmt = (s) => {
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  };
  $('#st-focus-totals', root).innerHTML = `
    <div class="ft-row"><span>今日专注</span><strong>${fmt(today.focusSec || 0)}</strong></div>
    <div class="ft-row"><span>今日休息</span><strong>${fmt(today.breakSec || 0)}</strong></div>
    <div class="ft-row"><span>今日轮数</span><strong>${today.pomos || 0}</strong></div>
    <div class="ft-divider"></div>
    <div class="ft-row"><span>累计专注</span><strong class="gold">${fmt(focusSec)}</strong></div>
    <div class="ft-row"><span>累计休息</span><strong>${fmt(breakSec)}</strong></div>
    <div class="ft-row"><span>累计轮数</span><strong>${pomos}</strong></div>`;
}

function renderMaturity() {
  const m = Engine.getMaturityStats();
  const total = Math.max(1, m.total);
  const rows = [
    ['mature', '已牢记', m.mature], ['young', '记忆中', m.young], ['learning', '学习中', m.learning],
  ];
  $('#st-maturity', root).innerHTML = `
    <div class="maturity-bar">${rows.map(([k, , v]) => `<i class="m-${k}" style="width:${(v / total) * 100}%"></i>`).join('')}</div>
    <ul>${rows.map(([k, label, v]) => `<li><i class="sw m-${k}"></i><span>${label}</span><strong>${v}</strong></li>`).join('')}<li><i class="sw m-new"></i><span>未学习</span><strong>${m.new}</strong></li></ul>`;
  const up = Engine.getUpcomingDue(7);
  const upMax = Math.max(1, ...up);
  const names = ['今天', '明天', '后天'];
  $('#st-upcoming', root).innerHTML = up.map((n, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return `<div class="up-col" title="${todayKey(d)} · ${n} 词"><i style="height:${Math.max(4, (n / upMax) * 100)}%"></i><strong>${n}</strong><span>${names[i] || `${d.getMonth() + 1}/${d.getDate()}`}</span></div>`;
  }).join('');
}

function renderHeatmap() {
  const log = storage.getLog();
  const weeks = 20;
  const today = new Date();
  const end = new Date(today); end.setDate(today.getDate() + (7 - ((today.getDay() + 6) % 7) - 1)); // 本周日
  const start = new Date(end); start.setDate(end.getDate() - weeks * 7 + 1);
  const max = Math.max(1, ...Object.values(log).map(d => d.total || 0));
  let cells = '';
  let total = 0;
  const months = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const k = todayKey(d);
    const v = log[k]?.total || 0;
    total += v;
    const level = v === 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4));
    const future = d > today;
    if (d.getDate() === 1) months.push({ col: Math.floor(i / 7), label: `${d.getMonth() + 1}月` });
    cells += `<i class="hm-cell l${level} ${future ? 'is-future' : ''}" title="${k} · ${v} 次"></i>`;
  }
  $('#st-heatmap', root).innerHTML = `<div class="hm-months">${months.map(m => `<span style="grid-column:${m.col + 1}">${m.label}</span>`).join('')}</div><div class="hm-grid">${cells}</div>`;
  $('#st-heat-total', root).textContent = `${weeks} 周共 ${total} 次评分`;
}

function renderCalendar() {
  const sessions = storage.getSessions();
  const log = storage.getLog();
  const y = month.getFullYear(), m = month.getMonth();
  $('#st-month', root).textContent = `${y} 年 ${m + 1} 月`;
  const byDate = {};
  for (const s of sessions) if (s.date) (byDate[s.date] ||= []).push(s);
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const tk = todayKey();
  let html = '';
  for (let i = 0; i < offset; i++) html += '<i class="cal-blank"></i>';
  for (let d = 1; d <= days; d++) {
    const k = todayKey(new Date(y, m, d));
    const n = (byDate[k]?.length || 0) + (log[k]?.total ? 1 : 0);
    html += `<button type="button" class="cal-day ${n ? 'has' : ''} ${k === tk ? 'is-today' : ''} ${k === selectedDate ? 'is-selected' : ''}" data-date="${k}" ${n ? '' : 'disabled'} title="${k}${log[k] ? ` · 新词 ${log[k].new} · 复习 ${log[k].review}` : ''}"><span>${d}</span>${n ? '<i></i>' : ''}</button>`;
  }
  $('#st-cal', root).innerHTML = html;
  $$('#st-cal [data-date]', root).forEach(b => b.addEventListener('click', () => { selectedDate = selectedDate === b.dataset.date ? '' : b.dataset.date; renderCalendar(); }));
  renderArchive(selectedDate ? (byDate[selectedDate] || []) : sessions.slice(0, 12));
}

function renderArchive(list) {
  const head = $('#st-archive-head', root);
  const log = storage.getLog();
  if (selectedDate) {
    const d = log[selectedDate];
    head.innerHTML = `<span>${formatDateCn(selectedDate)}${d ? ` · 新词 ${d.new} · 复习 ${d.review} · 忘了 ${d.again}` : ''}</span><button class="btn btn-ghost btn-sm" id="st-archive-reset">查看全部</button>`;
    $('#st-archive-reset', root).addEventListener('click', () => { selectedDate = ''; renderCalendar(); });
  } else head.innerHTML = '<span class="muted small">最近记录 · 点日历上的日期筛选</span>';

  const ul = $('#st-archive', root);
  ul.innerHTML = list.length ? list.map(s => `
    <li class="archive-item" data-id="${escapeHtml(s.id)}">
      <span class="recent-icon"><i data-lucide="${s.type === 'reading' ? 'book-open-text' : 'layers'}"></i></span>
      <div><strong>${escapeHtml(s.title || '学习记录')}</strong><small>${escapeHtml(s.date || '')} · ${(s.words || []).length} 词${s.accuracy != null ? ` · 一遍过 ${s.accuracy}%` : ''}${s.source ? ` · ${escapeHtml(s.source)}` : ''}</small></div>
      <div class="archive-words">${(s.words || []).slice(0, 6).map(w => `<button type="button" class="chip chip-mini" data-w="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('')}${(s.words || []).length > 6 ? `<span class="muted small">+${s.words.length - 6}</span>` : ''}</div>
    </li>`).join('') : '<li class="empty-line muted">这一天没有记录。</li>';
  ul.querySelectorAll('[data-w]').forEach(c => c.addEventListener('click', (e) => { e.stopPropagation(); openWordSheet(c.dataset.w); }));
  ul.querySelectorAll('.archive-item').forEach(li => li.addEventListener('click', () => {
    const s = storage.getSession(li.dataset.id);
    if (s?.type === 'reading') { window.dispatchEvent(new CustomEvent('reading-open', { detail: { id: s.id } })); switchView('reading'); }
  }));
  refreshIcons(ul);
}

function renderWrong() {
  const list = Engine.getWrongEntries(10);
  $('#st-wrong', root).innerHTML = list.length ? list.map(e => `<li data-w="${escapeHtml(e.word)}"><strong>${escapeHtml(e.word)}</strong><small>${escapeHtml(e.item.def || '')}</small><span class="pill pill-danger">忘 ${e.card.l} 次</span></li>`).join('') : '<li class="empty-line muted">还没有错词，继续保持。</li>';
  $$('#st-wrong [data-w]', root).forEach(li => li.addEventListener('click', () => openWordSheet(li.dataset.w)));
  $('#st-wrong-go', root).hidden = !list.length;
}

export function render() {
  if (!root) return;
  renderTiles(); renderBars(); renderFocus(); renderMaturity(); renderHeatmap(); renderCalendar(); renderWrong();
  refreshIcons(root);
}

export function init(container) {
  root = container;
  root.innerHTML = template();
  $('#st-prev', root).addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); selectedDate = ''; renderCalendar(); });
  $('#st-next', root).addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); selectedDate = ''; renderCalendar(); });
  $('#st-wrong-go', root).addEventListener('click', () => Learn.start('wrong'));
  window.addEventListener('data-changed', () => { if (document.body.dataset.view === 'stats') render(); });
  window.addEventListener('pomodoro-stats', () => { if (document.body.dataset.view === 'stats') renderFocus(); });
}

export function onShow() { render(); }

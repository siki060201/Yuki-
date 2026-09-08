/**
 * features/learn.js · 背词工作台
 * 模式：今日复习 / 学新词 / 错词本 / 自选组 / 随机
 * 输入：拼写 / 心算 / 听写
 */

import { $, $$, escapeHtml, refreshIcons, toast, clozeSentence, highlightWord } from '../ui/dom.js';
import { switchView, currentView } from '../ui/router.js';
import { openWordSheet, hasOpenOverlay } from '../ui/overlay.js';
import { storage } from '../core/storage.js';
import * as Lexicon from '../core/lexicon.js';
import * as Audio from '../core/audio.js';
import * as Sync from '../core/sync.js';
import { todayKey } from '../core/srs.js';
import * as Engine from './study-engine.js';

const MODE_LABEL = { review: '今日复习', new: '学新词', wrong: '错词本', group: '自选组', random: '随机抽词' };

const state = {
  mode: 'review',
  inputMode: 'spell',
  groupIndex: 0,
  queue: [],          // 本轮待处理条目
  roundWords: [],     // 本轮全部条目（用于侧栏）
  done: new Set(),
  current: null,
  revealed: false,
  stats: { ratings: 0, again: 0, correctSpell: 0, spellAttempts: 0 },
  startedAt: 0,
  switchedAt: 0,
  finished: false,
  submitting: false,
};

let root = null;

// ---------------- 模板 ----------------
function template() {
  return `
  <div class="learn-layout">
    <div class="learn-main">
      <section class="panel learn-toolbar">
        <div class="mode-tabs" role="tablist" aria-label="学习模式">
          <button class="mode-tab" data-mode="review"><i data-lucide="rotate-ccw"></i><span>今日复习</span><em id="mode-due-count">0</em></button>
          <button class="mode-tab" data-mode="new"><i data-lucide="sparkles"></i><span>学新词</span></button>
          <button class="mode-tab" data-mode="wrong"><i data-lucide="flag"></i><span>错词本</span><em id="mode-wrong-count">0</em></button>
          <button class="mode-tab" data-mode="group"><i data-lucide="list-ordered"></i><span>自选组</span></button>
          <button class="mode-tab" data-mode="random"><i data-lucide="shuffle"></i><span>随机</span></button>
        </div>
        <div class="toolbar-right">
          <label class="group-picker" id="group-picker" hidden>
            <span>第</span><select id="group-select"></select><span>组</span>
          </label>
          <div class="segmented" role="group" aria-label="作答方式">
            <button data-input="spell" title="看释义拼写"><i data-lucide="keyboard"></i><span>拼写</span></button>
            <button data-input="recall" title="心算默背后翻牌"><i data-lucide="brain"></i><span>心算</span></button>
            <button data-input="dictation" title="只听发音拼写"><i data-lucide="ear"></i><span>听写</span></button>
          </div>
        </div>
      </section>

      <section class="flash-stage" id="flash-stage">
        <article class="panel flashcard" id="flashcard">
          <header class="flash-head">
            <span class="flash-counter mono" id="flash-counter">—</span>
            <div class="flash-head-right">
              <span class="pill" id="flash-mode-pill">今日复习</span>
              <button class="icon-btn compact" id="auto-audio-toggle" title="翻牌自动朗读"><i data-lucide="volume-2"></i></button>
            </div>
          </header>

          <div class="flash-front" id="flash-front">
            <div class="recall-cue">
              <span class="block-label" id="cue-label">回忆线索 · 中文释义</span>
              <h3 class="recall-def" id="cue-def">—</h3>
              <p class="recall-cloze" id="cue-cloze"></p>
              <button class="dictation-play" id="dictation-play" hidden><i data-lucide="volume-2"></i><span>再听一遍</span><kbd>R</kbd></button>
            </div>
            <div class="answer-zone">
              <div class="spell-wrap" id="spell-wrap">
                <input class="spell-input" id="spell-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="输入英文单词，回车判定" />
              </div>
              <p class="answer-hint" id="answer-hint"></p>
            </div>
            <button class="reveal-btn" id="reveal-btn"><i data-lucide="eye"></i><span>查看答案</span><kbd>Enter</kbd></button>
          </div>

          <div class="flash-back" id="flash-back" hidden>
            <div class="word-hero">
              <div>
                <h2 class="word-big serif" id="ans-word">—</h2>
                <div class="word-sub">
                  <span class="mono" id="ans-ipa"></span>
                  <button class="icon-btn compact" id="ans-speak" title="朗读 (R)"><i data-lucide="volume-2"></i></button>
                  <span class="pill" id="ans-pos"></span>
                </div>
              </div>
              <button class="btn btn-soft btn-sm" id="ans-ask"><i data-lucide="sparkles"></i><span>问 AI</span></button>
            </div>
            <div class="detail-grid">
              <div class="detail full"><span class="block-label">释义</span><p id="ans-def"></p></div>
              <div class="detail full" id="ans-mne-wrap"><span class="block-label">记忆钩子</span><p id="ans-mne"></p></div>
              <div class="detail full"><span class="block-label">例句</span><p id="ans-sen"></p><p class="muted small" id="ans-trans"></p></div>
            </div>
            <div class="rating-deck">
              <button class="rate rate-again" data-rating="again"><strong>忘了</strong><small id="pv-again">稍后</small><kbd>1</kbd></button>
              <button class="rate rate-hard" data-rating="hard"><strong>模糊</strong><small id="pv-hard"></small><kbd>2</kbd></button>
              <button class="rate rate-good" data-rating="good"><strong>记住</strong><small id="pv-good"></small><kbd>3</kbd></button>
              <button class="rate rate-easy" data-rating="easy"><strong>秒杀</strong><small id="pv-easy"></small><kbd>4</kbd></button>
            </div>
          </div>
        </article>

        <article class="panel flash-empty" id="flash-empty" hidden>
          <div class="empty-illus"><i data-lucide="coffee"></i></div>
          <h3 id="empty-title">今天的复习已经清空</h3>
          <p class="muted" id="empty-desc">可以去学几组新词，或者休息一下。</p>
          <div class="btn-row" id="empty-actions"></div>
        </article>

        <article class="panel flash-summary" id="flash-summary" hidden>
          <div class="summary-trophy">🎉</div>
          <h3>本轮完成</h3>
          <p class="muted" id="summary-sub"></p>
          <div class="summary-tiles">
            <div class="tile"><span>词数</span><strong id="sum-count">0</strong></div>
            <div class="tile"><span>一遍过</span><strong id="sum-rate">0%</strong></div>
            <div class="tile"><span>用时</span><strong id="sum-time">0:00</strong></div>
            <div class="tile"><span>连续</span><strong id="sum-streak">0 天</strong></div>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="sum-again"><i data-lucide="rotate-ccw"></i><span>再来一轮</span></button>
            <button class="btn btn-soft" id="sum-reading"><i data-lucide="book-open-text"></i><span>用这些词生成短文</span></button>
            <button class="btn btn-ghost" id="sum-home"><i data-lucide="home"></i><span>回到今日</span></button>
          </div>
        </article>
      </section>
    </div>

    <aside class="learn-side">
      <section class="panel">
        <header class="panel-head">
          <div><p class="eyebrow">本轮词单</p><h3>进度</h3></div>
          <span class="accent-stat" id="queue-progress">0 / 0</span>
        </header>
        <div class="progress-track"><div class="progress-fill" id="queue-fill"></div></div>
        <ol class="queue-list" id="queue-list"></ol>
      </section>
      <section class="panel">
        <header class="panel-head"><div><p class="eyebrow">节奏</p><h3>本周</h3></div><span class="accent-stat" id="week-done">0/7</span></header>
        <div class="week-strip" id="week-strip"></div>
      </section>
      <section class="panel shortcuts">
        <header class="panel-head"><div><p class="eyebrow">快捷键</p><h3>全键盘操作</h3></div></header>
        <ul class="kbd-list">
          <li><kbd>Enter</kbd><span>判定 / 翻牌 / 记住</span></li>
          <li><kbd>Space</kbd><span>翻牌</span></li>
          <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>忘了 · 模糊 · 记住 · 秒杀</span></li>
          <li><kbd>R</kbd><span>朗读</span></li>
          <li><kbd>Tab</kbd><span>切换作答方式</span></li>
        </ul>
      </section>
    </aside>
  </div>`;
}

// ---------------- 队列构建 ----------------
function buildQueue() {
  const settings = storage.getSettings();
  const size = settings.groupSize;
  let entries = [];
  state.finished = false;

  if (state.mode === 'review') {
    entries = Engine.getDueEntries().slice(0, Math.max(size, 30));
  } else if (state.mode === 'new') {
    const summary = Engine.getTodaySummary();
    const want = Math.max(size, Math.min(summary.newRemaining || size, 50));
    const { entries: e } = Engine.getNewEntries(want);
    entries = e;
  } else if (state.mode === 'wrong') {
    entries = Engine.getWrongEntries(size);
  } else if (state.mode === 'group') {
    entries = Engine.getGroupEntries(state.groupIndex, size);
  } else if (state.mode === 'random') {
    entries = Engine.getRandomNewEntries(size);
  }

  state.roundWords = entries.map(e => ({ ...e, relearn: false, reviewCounted: false }));
  state.queue = [...state.roundWords];
  state.done = new Set();
  state.stats = { ratings: 0, again: 0, correctSpell: 0, spellAttempts: 0 };
  state.startedAt = Date.now();
  state.current = null;
  state.revealed = false;

  $('#flash-summary', root).hidden = true;
  if (!state.queue.length) {
    showEmpty();
  } else {
    $('#flash-empty', root).hidden = true;
    $('#flashcard', root).hidden = false;
    nextCard();
  }
  renderSidebar();
  renderModeCounts();
}

function showEmpty() {
  $('#flashcard', root).hidden = true;
  const empty = $('#flash-empty', root);
  empty.hidden = false;
  const title = $('#empty-title', root);
  const desc = $('#empty-desc', root);
  const actions = $('#empty-actions', root);
  const summary = Engine.getTodaySummary();
  if (state.mode === 'review') {
    title.textContent = summary.total ? '今天的复习已经清空 ✨' : '还没有需要复习的词';
    desc.textContent = summary.newRemaining > 0 ? `今日新词还剩 ${summary.newRemaining} 个，趁热打铁？` : '今天的新词目标也完成了，休息一下吧。';
    actions.innerHTML = `<button class="btn btn-primary" data-go="new"><i data-lucide="sparkles"></i><span>学新词</span></button>${summary.wrong ? '<button class="btn btn-soft" data-go="wrong"><i data-lucide="flag"></i><span>刷错词本</span></button>' : ''}`;
  } else if (state.mode === 'wrong') {
    title.textContent = '错词本是空的';
    desc.textContent = '评「忘了」的词会自动收进这里，方便集中攻克。';
    actions.innerHTML = `<button class="btn btn-primary" data-go="review"><i data-lucide="rotate-ccw"></i><span>去复习</span></button>`;
  } else if (state.mode === 'new') {
    title.textContent = '词库里的词都学过了 🎓';
    desc.textContent = '真了不起。可以用随机模式再抽一遍巩固。';
    actions.innerHTML = `<button class="btn btn-primary" data-go="random"><i data-lucide="shuffle"></i><span>随机抽词</span></button>`;
  } else {
    title.textContent = '这一组没有词';
    desc.textContent = '换一组试试。';
    actions.innerHTML = `<button class="btn btn-primary" data-go="review"><i data-lucide="rotate-ccw"></i><span>去复习</span></button>`;
  }
  actions.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.go)));
  refreshIcons(empty);
}

// ---------------- 渲染 ----------------
function nextCard() {
  state.submitting = false;
  if (!state.queue.length) { finishRound(); return; }
  state.current = state.queue[0];
  state.revealed = false;
  state.switchedAt = Date.now();

  const { item } = state.current;
  const done = state.done.size;
  const total = state.roundWords.length;
  $('#flash-counter', root).textContent = `${done + 1} / ${total}`;
  $('#flash-mode-pill', root).textContent = state.current.relearn ? '重学' : (!state.current.card || state.current.card.s === 'learning' ? `${MODE_LABEL[state.mode]} · 新词` : `${MODE_LABEL[state.mode]} · 复习`);

  const cueLabel = $('#cue-label', root);
  const cueDef = $('#cue-def', root);
  const cueCloze = $('#cue-cloze', root);
  const dictBtn = $('#dictation-play', root);
  const spellWrap = $('#spell-wrap', root);
  const hint = $('#answer-hint', root);
  const revealBtn = $('#reveal-btn', root);
  const input = $('#spell-input', root);

  if (state.inputMode === 'dictation') {
    cueLabel.textContent = '听写 · 只听发音';
    cueDef.textContent = '';
    cueDef.hidden = true;
    cueCloze.hidden = true;
    dictBtn.hidden = false;
    spellWrap.hidden = false;
    hint.textContent = '听发音，写出单词。想不起来直接回车看答案。';
    revealBtn.querySelector('span').textContent = '看答案';
    setTimeout(() => Audio.speak(item.word), 200);
  } else {
    cueDef.hidden = false;
    cueLabel.textContent = '回忆线索 · 中文释义';
    cueDef.textContent = item.def || '请回忆这个单词';
    dictBtn.hidden = true;
    if (item.sen) { cueCloze.hidden = false; cueCloze.innerHTML = clozeSentence(item.sen, item.word); } else cueCloze.hidden = true;
    if (state.inputMode === 'spell') {
      spellWrap.hidden = false;
      hint.textContent = '拼出单词后回车判定；留空回车直接看答案。';
      revealBtn.querySelector('span').textContent = '想不起来，看答案';
    } else {
      spellWrap.hidden = true;
      hint.textContent = '先在心里默背拼写与释义，再翻牌核对。';
      revealBtn.querySelector('span').textContent = '翻牌';
    }
  }

  input.value = '';
  input.classList.remove('is-right', 'is-wrong');
  $('#flashcard', root).classList.remove('is-revealed');
  $('#flash-front', root).hidden = false;
  $('#flash-back', root).hidden = true;

  if (state.inputMode !== 'recall') setTimeout(() => input.focus({ preventScroll: true }), 60);
  renderSidebar();
  refreshIcons();
}

function reveal() {
  if (state.revealed || !state.current) return;
  if (Date.now() - state.switchedAt < 120) return;
  state.revealed = true;
  state.submitting = false;
  const { item, card } = state.current;
  $('#spell-input', root).blur();

  $('#ans-word', root).textContent = item.word;
  $('#ans-ipa', root).textContent = item.ipa || '';
  $('#ans-pos', root).textContent = item.pos || '';
  $('#ans-pos', root).hidden = !item.pos;
  $('#ans-def', root).textContent = item.def || '';
  const mneWrap = $('#ans-mne-wrap', root);
  mneWrap.hidden = !item.mne;
  $('#ans-mne', root).textContent = item.mne || '';
  $('#ans-sen', root).innerHTML = item.sen ? highlightWord(item.sen, item.word) : '<span class="muted">暂无例句</span>';
  $('#ans-trans', root).textContent = item.trans || '';

  const pv = Engine.previewFor(state.current);
  $('#pv-again', root).textContent = pv.again;
  $('#pv-hard', root).textContent = pv.hard;
  $('#pv-good', root).textContent = pv.good;
  $('#pv-easy', root).textContent = pv.easy;

  $('#flashcard', root).classList.add('is-revealed');
  $('#flash-front', root).hidden = true;
  $('#flash-back', root).hidden = false;
  if (storage.getSettings().autoAudio && state.inputMode !== 'dictation') Audio.speak(item.word);
  refreshIcons();
}

function rate(rating) {
  if (!state.current || !state.revealed) return;
  const entry = state.queue.shift();
  const { requeue } = Engine.rateEntry(entry, rating);
  state.stats.ratings++;
  if (rating === 'again') state.stats.again++;

  if (requeue) {
    state.queue.push(entry);
    Audio.beep(false);
    toast(rating === 'again' ? '稍后会再出现一次' : '标记为模糊，本轮末尾再来', 'info', 1400);
  } else {
    state.done.add(entry.word);
    Audio.beep(true);
  }
  Sync.autoSave(4000);
  window.dispatchEvent(new CustomEvent('study-progress'));
  nextCard();
}

function submitSpelling() {
  if (state.revealed) { rate('good'); return; }
  if (state.submitting || !state.current) return;
  const input = $('#spell-input', root);
  const val = input.value.trim().toLowerCase();
  if (!val) { reveal(); return; }
  state.submitting = true;
  state.stats.spellAttempts++;
  const ok = val === state.current.item.word.toLowerCase();
  input.classList.remove('is-right', 'is-wrong');
  void input.offsetWidth;
  input.classList.add(ok ? 'is-right' : 'is-wrong');
  if (ok) { state.stats.correctSpell++; toast('拼写正确 ✓', 'success', 1200); Audio.beep(true); }
  else { toast(`正确拼写：${state.current.item.word}`, 'error', 1800); Audio.beep(false); }
  setTimeout(() => { state.submitting = false; reveal(); }, ok ? 320 : 700);
}

function finishRound() {
  state.finished = true;
  state.current = null;
  $('#flashcard', root).hidden = true;
  $('#flash-empty', root).hidden = true;
  const sum = $('#flash-summary', root);
  sum.hidden = false;

  const total = state.roundWords.length;
  const rate = state.stats.ratings ? Math.round(((state.stats.ratings - state.stats.again) / state.stats.ratings) * 100) : 100;
  const secs = Math.round((Date.now() - state.startedAt) / 1000);
  $('#sum-count', root).textContent = total;
  $('#sum-rate', root).textContent = `${rate}%`;
  $('#sum-time', root).textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  const today = todayKey();
  storage.saveSession({
    type: 'study', date: today,
    title: `${MODE_LABEL[state.mode]} · ${total} 词`,
    words: state.roundWords.map(e => e.word),
    source: MODE_LABEL[state.mode] + (state.mode === 'group' ? ` 第 ${state.groupIndex + 1} 组` : ''),
    accuracy: rate, durationSec: secs,
    createdAt: new Date().toISOString(),
  });
  const streak = Engine.computeStreak();
  $('#sum-streak', root).textContent = `${streak} 天`;
  $('#summary-sub', root).textContent = state.mode === 'review' ? '复习完成，记忆曲线已更新。' : '这些词已进入复习计划，明天开始按间隔回来找你。';
  Sync.autoSave(1500);
  window.dispatchEvent(new CustomEvent('study-progress'));
  renderSidebar();
  renderModeCounts();
  refreshIcons();
}

function renderSidebar() {
  const list = $('#queue-list', root);
  const total = state.roundWords.length;
  const done = state.done.size;
  $('#queue-progress', root).textContent = `${done} / ${total}`;
  $('#queue-fill', root).style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  if (!list) return;
  list.innerHTML = state.roundWords.map((e, i) => {
    const isDone = state.done.has(e.word);
    const isCur = state.current && state.current.word === e.word && !state.finished;
    const cls = isDone ? 'is-done' : isCur ? 'is-current' : 'is-pending';
    const label = isDone || state.finished ? escapeHtml(e.word) : isCur ? '正在回忆…' : `单词 ${String(i + 1).padStart(2, '0')}`;
    const sub = isDone || state.finished ? escapeHtml(e.item.def || '') : isCur ? '先想，再翻牌' : '待回忆';
    return `<li class="queue-item ${cls}" ${isDone || state.finished ? `data-word="${escapeHtml(e.word)}"` : ''}><span class="q-index">${i + 1}</span><div><strong>${label}</strong><small>${sub}</small></div>${isDone ? '<i data-lucide="check"></i>' : ''}</li>`;
  }).join('');
  list.querySelectorAll('[data-word]').forEach(li => li.addEventListener('click', () => openWordSheet(li.dataset.word)));
  renderWeekStrip();
  refreshIcons(list);
}

function renderWeekStrip() {
  const strip = $('#week-strip', root);
  const counter = $('#week-done', root);
  if (!strip) return;
  const log = storage.getLog();
  const today = new Date();
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const names = ['一', '二', '三', '四', '五', '六', '日'];
  const tk = todayKey(today);
  let done = 0;
  strip.innerHTML = names.map((n, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const k = todayKey(d);
    const hit = (log[k]?.total || 0) > 0;
    if (hit) done++;
    return `<div class="week-day ${hit ? 'is-hit' : ''} ${k === tk ? 'is-today' : ''}" title="${k}${hit ? ` · ${log[k].total} 次` : ''}"><span>${n}</span><i></i></div>`;
  }).join('');
  if (counter) counter.textContent = `${done}/7`;
}

function renderModeCounts() {
  const due = Engine.countDue();
  const wrong = Engine.countWrong();
  const dueEl = $('#mode-due-count', root); if (dueEl) { dueEl.textContent = due; dueEl.hidden = !due; }
  const wrongEl = $('#mode-wrong-count', root); if (wrongEl) { wrongEl.textContent = wrong; wrongEl.hidden = !wrong; }
  const badge = $('#nav-due-badge'); if (badge) { badge.textContent = due; badge.hidden = !due; }
}

function renderGroupSelect() {
  const sel = $('#group-select', root);
  if (!sel) return;
  const size = storage.getSettings().groupSize;
  const total = Lexicon.groupCount(size);
  const cards = storage.getCards();
  let html = '';
  for (let i = 0; i < total; i++) {
    const words = Lexicon.getGroup(i, size);
    const learned = words.filter(w => cards[w.word.toLowerCase()]).length;
    html += `<option value="${i}" ${i === state.groupIndex ? 'selected' : ''}>${i + 1} · ${escapeHtml(words[0]?.word || '')}…${learned ? ` (${learned}/${words.length})` : ''}</option>`;
  }
  sel.innerHTML = html;
}

// ---------------- 交互 ----------------
function setMode(mode) {
  state.mode = mode;
  $$('.mode-tab', root).forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
  $('#group-picker', root).hidden = mode !== 'group';
  if (mode === 'group') renderGroupSelect();
  buildQueue();
}

function setInputMode(mode, { persist = true } = {}) {
  state.inputMode = mode;
  $$('.segmented [data-input]', root).forEach(b => b.classList.toggle('is-active', b.dataset.input === mode));
  if (persist) storage.saveSettings({ inputMode: mode });
  // 保持当前词不变，只重绘正面的作答形态
  if (state.current && !state.revealed) nextCard();
}

function bind() {
  $$('.mode-tab', root).forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('.segmented [data-input]', root).forEach(b => b.addEventListener('click', () => setInputMode(b.dataset.input)));
  $('#group-select', root).addEventListener('change', (e) => { state.groupIndex = Number(e.target.value) || 0; buildQueue(); });
  $('#reveal-btn', root).addEventListener('click', () => {
    if (state.inputMode !== 'recall' && $('#spell-input', root).value.trim()) submitSpelling(); else reveal();
  });
  $('#spell-input', root).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submitSpelling(); }
  });
  $$('.rate', root).forEach(b => b.addEventListener('click', () => rate(b.dataset.rating)));
  $('#ans-speak', root).addEventListener('click', () => state.current && Audio.speak(state.current.item.word));
  $('#dictation-play', root).addEventListener('click', () => state.current && Audio.speak(state.current.item.word));
  $('#ans-ask', root).addEventListener('click', () => {
    if (!state.current) return;
    const { item } = state.current;
    window.dispatchEvent(new CustomEvent('ask-ai', { detail: { prompt: `我正在背单词 "${item.word}"（${item.def}）。请用中文帮我：1) 拆解词根词缀或给一个好记的联想；2) 列出 3 个高频搭配；3) 指出最容易混淆的近义词并辨析；4) 再造 2 个四六级难度的例句。` } }));
  });
  $('#auto-audio-toggle', root).addEventListener('click', () => {
    const next = !storage.getSettings().autoAudio;
    storage.saveSettings({ autoAudio: next });
    $('#auto-audio-toggle', root).classList.toggle('is-active', next);
    toast(next ? '翻牌后自动朗读：开' : '自动朗读：关', 'info', 1400);
  });
  $('#sum-again', root).addEventListener('click', () => buildQueue());
  $('#sum-home', root).addEventListener('click', () => switchView('home'));
  $('#sum-reading', root).addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('reading-fill', { detail: { words: state.roundWords.map(e => e.word) } }));
    switchView('reading');
  });

  document.addEventListener('keydown', onKeydown);
  window.addEventListener('enqueue-word', (e) => {
    Engine.enqueueWord(e.detail.word);
    toast(`「${e.detail.word}」已加入今日学习队列`, 'success');
    renderModeCounts();
  });
  window.addEventListener('settings-changed', () => {
    $('#auto-audio-toggle', root)?.classList.toggle('is-active', storage.getSettings().autoAudio);
    if (state.mode === 'group') renderGroupSelect();
  });
}

function onKeydown(e) {
  if (currentView() !== 'learn' || hasOpenOverlay()) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
  const isSpellInput = active && active.id === 'spell-input';
  if (inInput && !isSpellInput) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    const order = ['spell', 'recall', 'dictation'];
    setInputMode(order[(order.indexOf(state.inputMode) + 1) % order.length]);
    toast(`作答方式：${{ spell: '拼写', recall: '心算', dictation: '听写' }[state.inputMode]}`, 'info', 1200);
    return;
  }
  if (state.finished) {
    if (e.key === 'Enter') { e.preventDefault(); buildQueue(); }
    return;
  }
  if (!state.current) return;
  if (e.key.toLowerCase() === 'r' && !isSpellInput) { e.preventDefault(); Audio.speak(state.current.item.word); return; }

  if (state.revealed) {
    const map = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
    if (map[e.key]) { e.preventDefault(); rate(map[e.key]); }
    else if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); rate('good'); }
    return;
  }
  if (isSpellInput) return; // 输入框自己处理 Enter
  if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); reveal(); }
}

// ---------------- 对外 ----------------
export async function init(container) {
  root = container;
  root.innerHTML = template();
  await Lexicon.loadLexicon();
  const settings = storage.getSettings();
  state.inputMode = ['spell', 'recall', 'dictation'].includes(settings.inputMode) ? settings.inputMode : 'spell';
  $$('.segmented [data-input]', root).forEach(b => b.classList.toggle('is-active', b.dataset.input === state.inputMode));
  $('#auto-audio-toggle', root).classList.toggle('is-active', settings.autoAudio);
  bind();
  renderModeCounts();
  renderWeekStrip();
  refreshIcons(root);
}

let started = false;
let pendingMode = null;

export function onShow() {
  if (pendingMode) {
    const m = pendingMode;
    pendingMode = null;
    started = true;
    setMode(m);
    return;
  }
  if (!started) {
    started = true;
    setMode(Engine.countDue() > 0 ? 'review' : 'new');
    return;
  }
  renderModeCounts();
  renderWeekStrip();
  if (!state.finished && state.current && state.inputMode !== 'recall' && !state.revealed) $('#spell-input', root)?.focus({ preventScroll: true });
}

/** 从首页等处直接进入某模式 */
export function start(mode) {
  pendingMode = mode;
  if (currentView() === 'learn') onShow(); else switchView('learn');
}

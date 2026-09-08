/**
 * main.js · 应用入口
 */

import { $, $$, refreshIcons, toast, refreshIconsNow } from './ui/dom.js';
import { initRouter, onShow, switchView, currentView } from './ui/router.js';
import { initTheme } from './ui/theme.js';
import { openModal, hasOpenOverlay, openWordSheet } from './ui/overlay.js';
import { storage } from './core/storage.js';
import * as Sync from './core/sync.js';
import * as Audio from './core/audio.js';
import * as Lexicon from './core/lexicon.js';
import * as Engine from './features/study-engine.js';
import * as Home from './features/home.js';
import * as Learn from './features/learn.js';
import * as Reading from './features/reading.js';
import * as Chat from './features/chat.js';
import * as Stats from './features/stats.js';
import * as Settings from './features/settings.js';

function renderSyncChip(state = Sync.getState()) {
  const chip = $('#sync-chip');
  const text = $('#sync-chip-text');
  if (!chip) return;
  const auth = Sync.getAuth();
  chip.dataset.state = state;
  const label = { synced: auth.username ? `已同步 · ${auth.username}` : '已同步', syncing: '同步中…', error: '同步异常', offline: auth.token ? '离线' : '登录同步' }[state] || '登录同步';
  if (text) text.textContent = label;
  chip.title = state === 'error' ? '点击查看/重试' : auth.token ? '云同步' : '登录后可多设备同步';
}

function renderStreak() {
  const el = $('#streak-count');
  if (el) el.textContent = Engine.computeStreak();
  const badge = $('#nav-due-badge');
  if (badge) { const n = Engine.countDue(); badge.textContent = n; badge.hidden = !n; }
}

function openShortcuts() {
  openModal({
    eyebrow: '快捷键', title: '全键盘操作', size: 'sm',
    body: `<ul class="kbd-list big">
      <li><kbd>1</kbd>~<kbd>6</kbd><span>切换页面：今日 · 背词 · 阅读 · 助教 · 统计 · 设置</span></li>
      <li><kbd>Enter</kbd><span>背词：判定拼写 / 翻牌 / 记住</span></li>
      <li><kbd>Space</kbd><span>背词：翻牌</span></li>
      <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>翻牌后评分：忘了 · 模糊 · 记住 · 秒杀</span></li>
      <li><kbd>R</kbd><span>朗读当前单词</span></li>
      <li><kbd>Tab</kbd><span>切换 拼写 / 心算 / 听写</span></li>
      <li><kbd>/</kbd><span>快速查词</span></li>
      <li><kbd>?</kbd><span>打开本面板</span></li>
      <li><kbd>Esc</kbd><span>关闭弹层</span></li>
    </ul>`,
  });
}

function openQuickLookup() {
  const m = openModal({
    eyebrow: '查词', title: '词库速查', size: 'sm',
    body: `<input class="lookup-input" id="lookup-input" type="text" placeholder="输入英文或中文释义…" autocomplete="off" autocapitalize="off" spellcheck="false" /><ul class="lookup-list" id="lookup-list"></ul>`,
  });
  if (!m) return;
  const input = m.el.querySelector('#lookup-input');
  const list = m.el.querySelector('#lookup-list');
  const render = () => {
    const q = input.value.trim();
    const hits = q ? Lexicon.search(q, 12) : [];
    list.innerHTML = hits.map(h => `<li data-w="${h.word}"><strong>${h.word}</strong><span class="mono muted">${h.ipa || ''}</span><small>${h.def || ''}</small></li>`).join('') || (q ? '<li class="empty-line muted">词库里没有找到，可以问 AI 助教</li>' : '');
    list.querySelectorAll('[data-w]').forEach(li => li.addEventListener('click', () => { m.close(); openWordSheet(li.dataset.w); }));
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector('[data-w]');
      if (first) { m.close(); openWordSheet(first.dataset.w); }
      else if (input.value.trim()) { m.close(); window.dispatchEvent(new CustomEvent('ask-ai', { detail: { prompt: `请帮我讲透这个单词或短语：${input.value.trim()}` } })); }
    }
  });
  setTimeout(() => input.focus(), 50);
}

function bindGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const active = document.activeElement;
    const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
    if (e.key === '?' && !typing) { e.preventDefault(); openShortcuts(); return; }
    if (e.key === '/' && !typing && !hasOpenOverlay()) { e.preventDefault(); openQuickLookup(); return; }
    if (typing || hasOpenOverlay()) return;
    // 数字切页仅在非背词页生效（背词页数字用于评分）
    if (currentView() !== 'learn' && /^[1-6]$/.test(e.key)) {
      const views = ['home', 'learn', 'reading', 'chat', 'stats', 'settings'];
      switchView(views[Number(e.key) - 1]);
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) toast('有新版本，刷新页面即可更新', 'info', 4000);
      });
    });
  }).catch(() => {});
}

async function boot() {
  initTheme();
  refreshIconsNow();

  const containers = {
    home: $('#view-home'), learn: $('#view-learn'), reading: $('#view-reading'),
    chat: $('#view-chat'), stats: $('#view-stats'), settings: $('#view-settings'),
  };

  // 首页与设置不依赖词库，先渲染；词库加载后再挂其余模块
  Home.init(containers.home);
  Settings.init(containers.settings);
  Chat.init(containers.chat);
  Stats.init(containers.stats);
  onShow('home', Home.onShow);
  onShow('settings', Settings.onShow);
  onShow('chat', Chat.onShow);
  onShow('stats', Stats.onShow);

  const lexiconReady = Lexicon.loadLexicon().then(async () => {
    await Learn.init(containers.learn);
    await Reading.init(containers.reading);
    onShow('learn', Learn.onShow);
    onShow('reading', Reading.onShow);
    Home.render();
    if (currentView() === 'learn') Learn.onShow();
    if (currentView() === 'reading') Reading.onShow();
    document.body.classList.remove('is-loading');
  });

  initRouter();
  bindGlobalKeys();

  $('#help-btn')?.addEventListener('click', openShortcuts);
  $('#lookup-btn')?.addEventListener('click', openQuickLookup);
  $('#sync-chip')?.addEventListener('click', () => Settings.openAuthModal());

  Sync.onStateChange((state, detail) => {
    renderSyncChip(state);
    if (state === 'synced' && detail?.message?.startsWith('同步完成')) {
      window.dispatchEvent(new CustomEvent('data-changed'));
      window.dispatchEvent(new CustomEvent('study-progress'));
    }
    if (state === 'error' && detail?.error) console.warn('[sync]', detail.error);
  });
  Sync.init();
  renderSyncChip();
  renderStreak();
  window.addEventListener('study-progress', renderStreak);
  window.addEventListener('data-changed', renderStreak);

  // 恢复上次的环境声偏好只作为按钮状态，不自动播放（浏览器策略要求用户交互）
  const ambient = storage.getSettings().ambient;
  if (ambient && ambient !== 'none') $$('[data-ambient]').forEach(b => b.classList.toggle('is-active', b.dataset.ambient === ambient));

  registerServiceWorker();
  await lexiconReady;
  console.info('[Yuki] ready ·', Lexicon.size(), 'words');
}

boot().catch(err => {
  console.error(err);
  document.body.classList.remove('is-loading');
  toast('初始化失败：' + (err.message || err), 'error', 6000);
});

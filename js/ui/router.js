/**
 * ui/router.js · 视图切换（hash 路由，可前进后退）
 */

import { $, $$, refreshIcons } from './dom.js';

export const VIEW_META = {
  home:     { eyebrow: 'TODAY · 今日',          title: '今天，从这里开始' },
  learn:    { eyebrow: 'ACTIVE RECALL · 背词',   title: '先回忆，再翻牌' },
  reading:  { eyebrow: 'CONTEXT · 阅读室',      title: '在真实语境里与单词重逢' },
  chat:     { eyebrow: 'AI TUTOR · 助教',        title: '有问题，随时问' },
  stats:    { eyebrow: 'ARCHIVE · 统计',         title: '看见自己的坚持' },
  settings: { eyebrow: 'PREFERENCES · 设置',     title: '模型、账号与偏好' },
};

const handlers = new Map();
let current = '';

export function onShow(view, fn) { handlers.set(view, fn); }
export function currentView() { return current; }

export function switchView(view, { pushHash = true } = {}) {
  if (!VIEW_META[view]) view = 'home';
  const changed = current !== view;
  current = view;

  $$('.view').forEach(v => {
    const active = v.dataset.view === view;
    v.classList.toggle('is-active', active);
    if (active) v.removeAttribute('hidden'); else v.setAttribute('hidden', '');
  });
  $$('[data-view-target]').forEach(b => b.classList.toggle('is-active', b.dataset.viewTarget === view));

  const meta = VIEW_META[view];
  const eyebrow = $('#page-eyebrow');
  const title = $('#page-title');
  if (eyebrow) eyebrow.textContent = meta.eyebrow;
  if (title) title.textContent = meta.title;
  document.body.dataset.view = view;

  if (pushHash && location.hash !== `#${view}`) {
    history.pushState(null, '', `#${view}`);
  }
  if (changed) window.scrollTo({ top: 0, behavior: 'smooth' });
  handlers.get(view)?.();
  refreshIcons();
  window.dispatchEvent(new CustomEvent('viewchange', { detail: { view } }));
}

export function initRouter() {
  $$('[data-view-target]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.viewTarget));
  });
  window.addEventListener('popstate', () => switchView(location.hash.replace('#', '') || 'home', { pushHash: false }));
  switchView(location.hash.replace('#', '') || 'home', { pushHash: false });
}

/**
 * ui/theme.js · 主题：夜读黑金 / 日光纸墨
 */

import { storage } from '../core/storage.js';
import { refreshIcons } from './dom.js';

export function applyTheme(theme, { persist = true } = {}) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f3eee6' : '#0f1013');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.innerHTML = `<i data-lucide="${t === 'light' ? 'moon-star' : 'sun'}"></i>`;
    btn.title = t === 'light' ? '切换到夜读模式' : '切换到日光模式';
    refreshIcons(btn);
  }
  if (persist) storage.saveSettings({ theme: t });
  return t;
}

export function initTheme() {
  const saved = storage.getSettings().theme;
  applyTheme(saved || 'dark', { persist: false });
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });
}

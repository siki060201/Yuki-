/**
 * ui/overlay.js · 词卡抽屉 / 通用弹窗 / 确认框
 */

import { $, escapeHtml, refreshIconsNow, highlightWord } from './dom.js';
import * as Audio from '../core/audio.js';
import * as Lexicon from '../core/lexicon.js';
import { storage } from '../core/storage.js';
import { maturity, formatInterval } from '../core/srs.js';

const openStack = [];

function lockScroll(lock) {
  document.body.classList.toggle('has-overlay', lock);
}

function mountOverlay(kind, innerHtml, { onClose } = {}) {
  const root = $('#overlay-root');
  if (!root) return null;
  const wrap = document.createElement('div');
  wrap.className = `overlay overlay-${kind}`;
  wrap.innerHTML = `<div class="overlay-backdrop"></div><div class="overlay-panel" role="dialog" aria-modal="true">${innerHtml}</div>`;
  root.append(wrap);
  // 先强制一次回流让初始样式生效，再同步加类名触发过渡（不依赖 rAF，后台标签页也能打开）
  void wrap.getBoundingClientRect();
  wrap.classList.add('is-open');
  lockScroll(true);

  const close = () => {
    if (!wrap.isConnected) return;
    wrap.classList.remove('is-open');
    setTimeout(() => wrap.remove(), 260);
    const i = openStack.indexOf(handle);
    if (i >= 0) openStack.splice(i, 1);
    if (!openStack.length) lockScroll(false);
    onClose?.();
  };
  const handle = { el: wrap, close };
  openStack.push(handle);
  wrap.querySelector('.overlay-backdrop').addEventListener('click', close);
  wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  refreshIconsNow(wrap);
  return handle;
}

export function closeTopOverlay() {
  const top = openStack[openStack.length - 1];
  if (top) { top.close(); return true; }
  return false;
}

export function hasOpenOverlay() { return openStack.length > 0; }

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTopOverlay();
});

/** 单词详情抽屉 */
export function openWordSheet(wordOrDetail, contextSentence = '') {
  const detail = typeof wordOrDetail === 'string' ? Lexicon.toDetail(wordOrDetail) : { ...Lexicon.toDetail(wordOrDetail.word), ...wordOrDetail };
  const word = detail.word || '';
  const card = storage.getCard(word);
  const level = maturity(card);
  const levelLabel = { new: '未学习', learning: '学习中', young: '记忆中', mature: '已牢记' }[level];
  const ctx = contextSentence || detail.sentence || '';
  const def = detail.definition || detail.def || '暂无释义';
  const pos = detail.partOfSpeech || detail.pos || '';

  const panel = mountOverlay('sheet', `
    <div class="sheet-grip"></div>
    <header class="sheet-head">
      <div>
        <p class="eyebrow">单词卡</p>
        <h2 class="sheet-word serif">${escapeHtml(word)}</h2>
        <div class="sheet-meta">
          ${detail.ipa ? `<span class="mono">${escapeHtml(detail.ipa)}</span>` : ''}
          ${pos ? `<span class="pill">${escapeHtml(pos)}</span>` : ''}
          <span class="pill pill-${level}">${levelLabel}${card && card.s === 'review' ? ` · 间隔 ${formatInterval(card.i)}` : ''}</span>
        </div>
      </div>
      <div class="sheet-actions">
        <button class="icon-btn" data-speak title="朗读"><i data-lucide="volume-2"></i></button>
        <button class="icon-btn" data-close title="关闭"><i data-lucide="x"></i></button>
      </div>
    </header>
    <p class="sheet-def">${escapeHtml(def)}</p>
    ${ctx ? `<section class="sheet-block"><span class="block-label">语境</span><p class="sheet-sentence">${highlightWord(ctx, word)}</p>${detail.translation && ctx === detail.sentence ? `<p class="sheet-trans">${escapeHtml(detail.translation)}</p>` : ''}</section>` : ''}
    ${detail.explanation ? `<section class="sheet-block"><span class="block-label">记忆钩子</span><p>${escapeHtml(detail.explanation)}</p></section>` : ''}
    <footer class="sheet-foot">
      <button class="btn btn-soft" data-ask><i data-lucide="sparkles"></i><span>问 AI 助教</span></button>
      ${card ? `<span class="muted small">复习 ${card.r} 次 · 遗忘 ${card.l} 次</span>` : `<button class="btn btn-ghost" data-add><i data-lucide="plus"></i><span>加入学习队列</span></button>`}
    </footer>
  `);
  if (!panel) return;
  panel.el.querySelector('[data-speak]')?.addEventListener('click', () => Audio.speak(word));
  panel.el.querySelector('[data-ask]')?.addEventListener('click', () => {
    panel.close();
    window.dispatchEvent(new CustomEvent('ask-ai', { detail: { prompt: `请帮我深入讲解单词 "${word}"（${def}）：词源或词根、常见搭配、易混近义词，并给出 2 个地道例句。${ctx ? `\n\n它出现在这句话里：${ctx}` : ''}` } }));
  });
  panel.el.querySelector('[data-add]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('enqueue-word', { detail: { word } }));
    panel.close();
  });
  return panel;
}

/** 通用弹窗 */
export function openModal({ title, eyebrow = '', body = '', footer = '', size = 'md', onClose }) {
  return mountOverlay(`modal modal-${size}`, `
    <header class="modal-head">
      <div>${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}<h2>${escapeHtml(title)}</h2></div>
      <button class="icon-btn" data-close title="关闭"><i data-lucide="x"></i></button>
    </header>
    <div class="modal-body">${body}</div>
    ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
  `, { onClose });
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确定', danger = false }) {
  return new Promise(resolve => {
    let decided = false;
    const m = openModal({
      title,
      size: 'sm',
      body: `<p class="modal-message">${escapeHtml(message)}</p>`,
      footer: `<button class="btn btn-ghost" data-close>取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText)}</button>`,
      onClose: () => { if (!decided) resolve(false); },
    });
    m?.el.querySelector('[data-confirm]')?.addEventListener('click', () => { decided = true; resolve(true); m.close(); });
  });
}

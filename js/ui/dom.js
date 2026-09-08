/**
 * ui/dom.js · DOM 小工具、图标刷新、Toast
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function escapeRegExp(v) {
  return String(v ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ''), '');
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let iconTimer = null;
export function refreshIcons(root) {
  // 合并同一帧内的多次调用
  if (iconTimer) return;
  iconTimer = requestAnimationFrame(() => {
    iconTimer = null;
    try { window.lucide?.createIcons?.(root ? { root } : undefined); } catch {}
  });
}

export function refreshIconsNow(root) {
  try { window.lucide?.createIcons?.(root ? { root } : undefined); } catch {}
}

let toastTimer = null;
export function toast(message, type = 'info', duration = 2600) {
  const box = $('#toast');
  if (!box) return;
  const icon = { success: 'check-circle-2', error: 'alert-circle', warning: 'alert-triangle', info: 'info' }[type] || 'info';
  box.innerHTML = `<i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span>`;
  box.className = `toast toast-${type} is-visible`;
  refreshIconsNow(box);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-visible'), duration);
}

export function formatDateCn(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${m} 月 ${d} 日`;
}

export function weekdayCn(date = new Date()) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

export function download(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** 把句子中的目标词（含词形变化）包成高亮 */
export function highlightWord(sentence, word, className = 'hl') {
  if (!sentence) return '';
  const safe = escapeHtml(sentence);
  if (!word) return safe;
  const re = new RegExp(`\\b(${escapeRegExp(word)}[a-z]*)\\b`, 'gi');
  return safe.replace(re, `<mark class="${className}">$1</mark>`);
}

/** 完形填空：目标词替换成空槽 */
export function clozeSentence(sentence, word) {
  if (!sentence) return '';
  const safe = escapeHtml(sentence);
  const re = new RegExp(`\\b${escapeRegExp(word)}[a-z]*\\b`, 'gi');
  return safe.replace(re, '<span class="cloze"></span>');
}

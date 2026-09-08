/**
 * features/reading.js · AI 语境阅读室
 */

import { $, $$, escapeHtml, escapeRegExp, refreshIcons, toast, download, copyText } from '../ui/dom.js';
import { openWordSheet, confirmDialog } from '../ui/overlay.js';
import { storage } from '../core/storage.js';
import * as Lexicon from '../core/lexicon.js';
import * as Api from '../core/api.js';
import * as Sync from '../core/sync.js';
import * as Engine from './study-engine.js';

let root = null;
let activeId = '';
let abortCtrl = null;

function template() {
  return `
  <div class="reading-layout">
    <aside class="reading-side">
      <section class="panel">
        <header class="panel-head"><div><p class="eyebrow">生成器</p><h3>目标单词</h3></div><span class="accent-stat" id="rd-count">0 个</span></header>
        <div class="chip-input" id="rd-chips">
          <input id="rd-input" type="text" placeholder="输入单词，空格 / 逗号 / 回车分隔" autocomplete="off" autocapitalize="off" spellcheck="false" />
        </div>
        <div class="btn-row wrap">
          <button class="btn btn-ghost btn-sm" id="rd-fill-today"><i data-lucide="calendar-check"></i><span>今天学过的词</span></button>
          <button class="btn btn-ghost btn-sm" id="rd-fill-wrong"><i data-lucide="flag"></i><span>错词本</span></button>
          <button class="btn btn-ghost btn-sm" id="rd-clear"><i data-lucide="eraser"></i><span>清空</span></button>
        </div>
        <div class="form-grid">
          <label class="field"><span>题材</span><select id="rd-genre"><option>日常故事</option><option>科技观察</option><option>科幻小说</option><option>新闻评论</option><option>商业洞察</option></select></label>
          <label class="field"><span>难度</span><select id="rd-level"><option>四级</option><option>六级</option><option>专升本</option><option>考研</option><option>雅思托福</option></select></label>
          <label class="field"><span>篇幅</span><select id="rd-length"><option value="80">80 词 · 速读</option><option value="120" selected>120 词 · 标准</option><option value="180">180 词 · 丰富</option><option value="250">250 词 · 长文</option></select></label>
        </div>
        <button class="btn btn-primary btn-block" id="rd-generate"><i data-lucide="wand-sparkles"></i><span>生成情境短文</span></button>
        <p class="muted small" id="rd-note"></p>
      </section>
      <section class="panel">
        <header class="panel-head"><div><p class="eyebrow">书架</p><h3>历史短文</h3></div><span class="accent-stat" id="rd-lib-count">0 篇</span></header>
        <ul class="library" id="rd-library"></ul>
      </section>
    </aside>

    <section class="reading-main">
      <article class="panel reader" id="reader">
        <header class="reader-top">
          <span class="pill" id="rd-source">示例短文</span>
          <div class="btn-row">
            <button class="icon-btn" id="rd-speak" title="朗读全文"><i data-lucide="volume-2"></i></button>
            <button class="icon-btn" id="rd-copy" title="复制"><i data-lucide="copy"></i></button>
            <button class="icon-btn" id="rd-export" title="导出 TXT"><i data-lucide="download"></i></button>
            <button class="icon-btn" id="rd-delete" title="删除这篇" hidden><i data-lucide="trash-2"></i></button>
          </div>
        </header>
        <div class="reader-heading">
          <p class="eyebrow" id="rd-date"></p>
          <h2 class="serif" id="rd-title">Welcome to the Reading Room</h2>
          <p class="muted small" id="rd-meta"></p>
        </div>
        <div class="article" id="rd-body"></div>
        <footer class="reader-foot" id="rd-foot" hidden>
          <div class="word-chips" id="rd-word-chips"></div>
          <div class="btn-row">
            <button class="btn btn-soft btn-sm" id="rd-enqueue"><i data-lucide="plus"></i><span>把这些词加入学习队列</span></button>
            <button class="btn btn-soft btn-sm" id="rd-ask"><i data-lucide="sparkles"></i><span>让 AI 精读这篇</span></button>
          </div>
        </footer>
      </article>
    </section>
  </div>`;
}

// ---------- 单词 chips ----------
let words = [];
function renderChips() {
  const box = $('#rd-chips', root);
  box.querySelectorAll('.chip').forEach(c => c.remove());
  const input = $('#rd-input', root);
  words.forEach(w => {
    const chip = document.createElement('span');
    chip.className = 'chip' + (Lexicon.lookup(w) ? '' : ' chip-unknown');
    chip.innerHTML = `${escapeHtml(w)}<button type="button" aria-label="移除" data-w="${escapeHtml(w)}"><i data-lucide="x"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => { words = words.filter(x => x !== w); renderChips(); });
    box.insertBefore(chip, input);
  });
  $('#rd-count', root).textContent = `${words.length} 个`;
  input.placeholder = words.length ? '' : '输入单词，空格 / 逗号 / 回车分隔';
  refreshIcons(box);
}
function addWords(list) {
  for (const w of list) if (w && !words.includes(w) && words.length < 24) words.push(w);
  renderChips();
}
function setWords(list) { words = []; addWords(list); }

// ---------- 渲染文章 ----------
function wordPattern(w) {
  const e = escapeRegExp(w);
  if (w.endsWith('e')) return `${e.slice(0, -1)}(?:e|es|ed|ing)?`;
  if (w.endsWith('y') && !/[aeiou]y$/.test(w)) return `(?:${e}|${e.slice(0, -1)}(?:ies|ied|ying))`;
  return `${e}(?:s|es|ed|ing|ly|er|est)?`;
}

function renderArticle(session) {
  const body = $('#rd-body', root);
  $('#rd-title', root).textContent = session.title || 'Reading';
  $('#rd-source', root).textContent = session.source || '短文';
  $('#rd-date', root).textContent = session.date || '';
  const wc = (session.body || '').split(/\s+/).filter(Boolean).length;
  $('#rd-meta', root).textContent = `${session.difficulty || ''} · ${session.genre || ''} · ${wc} 词 · 约 ${Math.max(1, Math.ceil(wc / 140))} 分钟`;
  $('#rd-delete', root).hidden = !session.id || session.id === 'demo';

  const targets = (session.words || []).filter(Boolean).sort((a, b) => b.length - a.length);
  let text = escapeHtml(session.body || '');
  if (targets.length) {
    const re = new RegExp(`\\b(${targets.map(wordPattern).join('|')})\\b`, 'gi');
    text = text.replace(re, (m) => {
      const low = m.toLowerCase();
      const base = targets.find(t => low === t || low.startsWith(t.slice(0, Math.max(3, t.length - 2)))) || low;
      return `<button type="button" class="hl-word" data-base="${escapeHtml(base)}">${m}</button>`;
    });
  }
  body.innerHTML = text.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  body.querySelectorAll('.hl-word').forEach(btn => btn.addEventListener('click', () => {
    const base = btn.dataset.base;
    const p = btn.closest('p')?.textContent || '';
    const sentence = p.split(/(?<=[.?!])\s+/).find(s => s.toLowerCase().includes(btn.textContent.toLowerCase())) || p;
    const def = (session.definitions || []).find(d => String(d.word).toLowerCase() === base) || {};
    openWordSheet({ ...Lexicon.toDetail(base), ...def, word: base }, sentence);
  }));

  const foot = $('#rd-foot', root);
  foot.hidden = !targets.length;
  $('#rd-word-chips', root).innerHTML = targets.map(w => `<button type="button" class="chip chip-click" data-w="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join('');
  $$('#rd-word-chips [data-w]', root).forEach(c => c.addEventListener('click', () => {
    const def = (session.definitions || []).find(d => String(d.word).toLowerCase() === c.dataset.w) || {};
    openWordSheet({ ...Lexicon.toDetail(c.dataset.w), ...def, word: c.dataset.w });
  }));
  refreshIcons(root);
}

function currentSession() {
  return activeId ? storage.getSession(activeId) : null;
}

function renderLibrary() {
  const list = $('#rd-library', root);
  const readings = storage.getSessions().filter(s => s.type === 'reading');
  $('#rd-lib-count', root).textContent = `${readings.length} 篇`;
  list.innerHTML = readings.length ? readings.map(s => `
    <li class="library-item ${s.id === activeId ? 'is-active' : ''}" data-id="${escapeHtml(s.id)}">
      <div><strong>${escapeHtml(s.title || '未命名')}</strong><small>${escapeHtml(s.date || '')} · ${(s.words || []).length} 词 · ${escapeHtml(s.genre || '')}</small></div>
      <i data-lucide="chevron-right"></i>
    </li>`).join('') : '<li class="empty-line muted">生成的短文会收进这里。</li>';
  list.querySelectorAll('[data-id]').forEach(li => li.addEventListener('click', () => open(li.dataset.id)));
  refreshIcons(list);
}

function open(id) {
  const s = storage.getSession(id);
  if (!s) return;
  activeId = id;
  renderArticle(s);
  renderLibrary();
}

function showDemo() {
  const demo = Api.createOfflineReading(['resilient', 'catalyst', 'subtle', 'emerge'], '日常故事', '四级', 120);
  demo.id = 'demo';
  demo.source = '示例短文';
  demo.title = 'The Quiet Catalyst';
  activeId = '';
  renderArticle(demo);
}

// ---------- 生成 ----------
async function generate() {
  if (!words.length) { toast('请先输入至少一个单词', 'warning'); return; }
  const btn = $('#rd-generate', root);
  const note = $('#rd-note', root);
  const genre = $('#rd-genre', root).value;
  const difficulty = $('#rd-level', root).value;
  const targetWordCount = Number($('#rd-length', root).value) || 120;
  const settings = storage.getSettings();

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>AI 正在织入生词…</span>';
  refreshIcons(btn);
  abortCtrl = new AbortController();

  let session = null;
  let usedFallback = '';
  if (!settings.apiKey?.trim()) {
    usedFallback = '未配置 API Key，已用词库例句生成离线短文。到「设置」填写密钥即可启用 AI 生成。';
  } else {
    try {
      session = await Api.generateReading({ words: [...words], genre, difficulty, targetWordCount }, settings, { signal: abortCtrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') { resetBtn(); return; }
      usedFallback = `AI 生成失败（${e.message}），已回退为离线短文。`;
    }
  }
  if (!session) session = Api.createOfflineReading([...words], genre, difficulty, targetWordCount);

  const saved = storage.saveSession(session);
  activeId = saved.id;
  renderArticle(saved);
  renderLibrary();
  note.textContent = usedFallback;
  toast(usedFallback ? '已生成离线短文' : '短文已生成，点击高亮词可查词', usedFallback ? 'warning' : 'success');
  Sync.autoSave(1500);
  window.dispatchEvent(new CustomEvent('data-changed'));
  resetBtn();

  function resetBtn() {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="wand-sparkles"></i><span>生成情境短文</span>';
    refreshIcons(btn);
  }
}

function articleText() {
  const title = $('#rd-title', root).textContent;
  const meta = $('#rd-meta', root).textContent;
  const ps = $$('#rd-body p', root).map(p => p.textContent.trim()).filter(Boolean);
  return `${title}\n${meta}\n\n${ps.join('\n\n')}`;
}

function bind() {
  const input = $('#rd-input', root);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ' || e.key === '，') {
      const parsed = Api.parseWords(input.value);
      if (parsed.length) { e.preventDefault(); addWords(parsed); input.value = ''; }
      else if (e.key === 'Enter') e.preventDefault();
    } else if (e.key === 'Backspace' && !input.value && words.length) {
      words.pop(); renderChips();
    }
  });
  input.addEventListener('blur', () => { const p = Api.parseWords(input.value); if (p.length) { addWords(p); input.value = ''; } });
  input.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text') || '';
    const parsed = Api.parseWords(text);
    if (parsed.length > 1) { e.preventDefault(); addWords(parsed); }
  });
  $('#rd-chips', root).addEventListener('click', (e) => { if (e.target === e.currentTarget) input.focus(); });

  $('#rd-clear', root).addEventListener('click', () => { setWords([]); input.value = ''; });
  $('#rd-fill-today', root).addEventListener('click', () => {
    const today = Api.getToday();
    const todays = storage.getSessions().filter(s => s.type === 'study' && s.date === today).flatMap(s => s.words || []);
    if (!todays.length) { toast('今天还没有背词记录', 'info'); return; }
    setWords([...new Set(todays)].slice(0, 24));
  });
  $('#rd-fill-wrong', root).addEventListener('click', () => {
    const wrong = Engine.getWrongEntries(12).map(e => e.word);
    if (!wrong.length) { toast('错词本是空的', 'info'); return; }
    setWords(wrong);
  });
  $('#rd-generate', root).addEventListener('click', generate);

  $('#rd-copy', root).addEventListener('click', async () => toast(await copyText(articleText()) ? '已复制短文' : '复制失败', 'success'));
  $('#rd-export', root).addEventListener('click', () => {
    const title = $('#rd-title', root).textContent.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'reading';
    download(`${title}.txt`, articleText());
  });
  $('#rd-speak', root).addEventListener('click', () => {
    const ps = $$('#rd-body p', root).map(p => p.textContent.trim()).join(' ');
    import('../core/audio.js').then(A => A.speak(ps, { rate: 0.95 }));
  });
  $('#rd-delete', root).addEventListener('click', async () => {
    const s = currentSession();
    if (!s) return;
    if (!(await confirmDialog({ title: '删除这篇短文？', message: `「${s.title}」将从书架移除，不可恢复。`, confirmText: '删除', danger: true }))) return;
    storage.deleteSession(s.id);
    activeId = '';
    const rest = storage.getSessions().filter(x => x.type === 'reading');
    if (rest.length) open(rest[0].id); else { showDemo(); renderLibrary(); }
    Sync.autoSave(1500);
    toast('已删除', 'info');
  });
  $('#rd-enqueue', root).addEventListener('click', () => {
    const s = currentSession();
    const list = s?.words || words;
    let added = 0;
    for (const w of list) if (!storage.getCard(w)) { Engine.enqueueWord(w); added++; }
    toast(added ? `已加入 ${added} 个新词到今日队列` : '这些词都已经在学习计划里了', added ? 'success' : 'info');
    window.dispatchEvent(new CustomEvent('study-progress'));
  });
  $('#rd-ask', root).addEventListener('click', () => {
    const text = articleText();
    window.dispatchEvent(new CustomEvent('ask-ai', { detail: { prompt: `请帮我精读下面这篇短文：先用中文概括主旨，再逐段挑出 3~5 个最值得学的长难句或搭配做拆解（结构、译文、为什么地道），最后针对目标词 ${words.join(', ')} 各出一道填空题。\n\n${text}` } }));
  });

  window.addEventListener('reading-fill', (e) => { setWords(e.detail.words || []); toast(`已填入 ${words.length} 个词，点「生成」即可`, 'info'); });
  window.addEventListener('reading-open', (e) => open(e.detail.id));
  window.addEventListener('data-changed', () => renderLibrary());
}

export async function init(container) {
  root = container;
  root.innerHTML = template();
  await Lexicon.loadLexicon();
  bind();
  setWords(['resilient', 'catalyst', 'subtle', 'emerge']);
  const readings = storage.getSessions().filter(s => s.type === 'reading');
  if (readings.length) open(readings[0].id); else showDemo();
  renderLibrary();
  refreshIcons(root);
}

export function onShow() {
  renderLibrary();
}

/**
 * features/settings.js · 设置：模型接口 / 学习偏好 / 外观 / 账号与同步 / 数据
 */

import { $, $$, escapeHtml, refreshIcons, toast, download } from '../ui/dom.js';
import { openModal, confirmDialog } from '../ui/overlay.js';
import { storage, DEFAULT_SETTINGS } from '../core/storage.js';
import * as Api from '../core/api.js';
import * as Sync from '../core/sync.js';
import { applyTheme } from '../ui/theme.js';

let root = null;

const PROVIDERS = [
  { name: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', hint: '免费额度多，模型丰富' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1', hint: 'gpt-4o-mini 性价比高' },
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', hint: 'deepseek-chat' },
  { name: '阿里 DashScope', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', hint: 'qwen-plus / qwen-turbo' },
  { name: '硅基流动', url: 'https://api.siliconflow.cn/v1', hint: '国内可直连' },
  { name: 'Moonshot', url: 'https://api.moonshot.cn/v1', hint: 'moonshot-v1-8k' },
];

function template() {
  return `
  <div class="settings-grid">
    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">模型接口</p><h3>AI 服务（阅读室与助教共用）</h3></div></header>
      <div class="provider-row">${PROVIDERS.map(p => `<button type="button" class="chip chip-click" data-provider="${p.url}" title="${p.hint}">${p.name}</button>`).join('')}</div>
      <form id="api-form" class="form-stack" autocomplete="off">
        <label class="field"><span>接口地址 Base URL</span><input id="api-base" type="url" placeholder="https://api.openai.com/v1" /><small>OpenAI 兼容格式，不要带 /chat/completions</small></label>
        <label class="field"><span>访问密钥 API Key</span>
          <span class="input-with-btns">
            <input id="api-key" type="password" placeholder="sk-…（只保存在本机，不会上传）" autocomplete="off" />
            <button type="button" class="icon-btn compact" id="api-key-eye" title="显示/隐藏"><i data-lucide="eye"></i></button>
            <button type="button" class="icon-btn compact" id="api-key-paste" title="从剪贴板粘贴"><i data-lucide="clipboard-paste"></i></button>
          </span>
        </label>
        <label class="field"><span>模型名称 Model</span>
          <span class="input-with-btns">
            <input id="api-model" type="text" list="api-model-list" placeholder="点「检测模型」自动列出，或手动输入" />
            <datalist id="api-model-list"></datalist>
            <button type="button" class="btn btn-soft btn-sm" id="api-detect"><i data-lucide="radar"></i><span>检测模型</span></button>
          </span>
          <small id="api-detect-note"></small>
        </label>
        <div class="btn-row end">
          <button type="button" class="btn btn-ghost" id="api-test"><i data-lucide="message-circle"></i><span>发一句试试</span></button>
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>保存</span></button>
        </div>
      </form>
    </section>

    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">学习偏好</p><h3>节奏与作答</h3></div></header>
      <div class="form-stack">
        <label class="field"><span>每日新词目标</span><div class="range-row"><input type="range" id="pref-daily" min="5" max="60" step="5" /><strong id="pref-daily-val">20</strong></div></label>
        <label class="field"><span>每组词数</span><div class="range-row"><input type="range" id="pref-group" min="5" max="30" step="5" /><strong id="pref-group-val">10</strong></div></label>
        <div class="field"><span>默认作答方式</span>
          <div class="segmented" id="pref-input"><button data-v="spell"><i data-lucide="keyboard"></i><span>拼写</span></button><button data-v="recall"><i data-lucide="brain"></i><span>心算</span></button><button data-v="dictation"><i data-lucide="ear"></i><span>听写</span></button></div>
        </div>
        <label class="switch-row"><span>翻牌后自动朗读</span><input type="checkbox" id="pref-audio" /><i class="switch"></i></label>
      </div>
      <header class="panel-head mt"><div><p class="eyebrow">外观</p><h3>主题</h3></div></header>
      <div class="theme-row">
        <button type="button" class="theme-card" data-theme-pick="dark"><i class="theme-swatch dark"></i><span>夜读 · 黑金</span></button>
        <button type="button" class="theme-card" data-theme-pick="light"><i class="theme-swatch light"></i><span>日光 · 纸墨</span></button>
      </div>
    </section>

    <section class="panel" id="account-panel">
      <header class="panel-head"><div><p class="eyebrow">账号与同步</p><h3>多设备同步</h3></div><span class="pill" id="acct-state">未登录</span></header>
      <div id="acct-body"></div>
    </section>

    <section class="panel">
      <header class="panel-head"><div><p class="eyebrow">数据</p><h3>备份与恢复</h3></div></header>
      <p class="muted small">导出的 JSON 包含学习记录、单词记忆状态与偏好，不包含 API 密钥。</p>
      <div class="btn-row wrap mt">
        <button type="button" class="btn btn-soft" id="data-export"><i data-lucide="download"></i><span>导出备份</span></button>
        <button type="button" class="btn btn-soft" id="data-import"><i data-lucide="upload"></i><span>导入并合并</span></button>
        <button type="button" class="btn btn-ghost" id="data-replace"><i data-lucide="database-backup"></i><span>用备份覆盖</span></button>
        <input type="file" id="data-file" accept=".json,application/json" hidden />
      </div>
      <div class="danger-zone">
        <div><strong>清空全部本地数据</strong><small class="muted">删除本机所有学习记录与记忆状态（云端不受影响）</small></div>
        <button type="button" class="btn btn-danger btn-sm" id="data-reset">清空</button>
      </div>
      <header class="panel-head mt"><div><p class="eyebrow">关于</p><h3>Yuki 自习室 2.0</h3></div></header>
      <p class="muted small">主动回忆 · 间隔重复 · AI 语境阅读。开源 MIT，图标来自 <a href="https://lucide.dev" target="_blank" rel="noopener">Lucide</a>。</p>
    </section>
  </div>`;
}

// ---------- 账号面板 ----------
let authTab = 'login';
function renderAccount() {
  const box = $('#acct-body', root);
  const auth = storage.getCloudAuth();
  const stateEl = $('#acct-state', root);
  if (auth.token) {
    stateEl.textContent = `已登录 · ${auth.username}`;
    stateEl.className = 'pill pill-ok';
    box.innerHTML = `
      <div class="acct-card">
        <div class="avatar">${escapeHtml((auth.username || 'U')[0].toUpperCase())}</div>
        <div><strong>${escapeHtml(auth.username)}</strong><small class="muted">${auth.lastSyncTime ? `上次同步 ${new Date(auth.lastSyncTime).toLocaleString('zh-CN', { hour12: false })}` : '尚未同步'}</small><small class="muted">${escapeHtml(auth.serverUrl || '')}</small></div>
      </div>
      <div class="btn-row wrap">
        <button type="button" class="btn btn-primary" id="acct-sync"><i data-lucide="refresh-cw"></i><span>立即同步</span></button>
        <button type="button" class="btn btn-ghost" id="acct-logout"><i data-lucide="log-out"></i><span>退出登录</span></button>
      </div>
      <p class="muted small">学习动作后会自动静默上传；登录另一台设备会自动合并。</p>`;
    $('#acct-sync', root).addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await Sync.syncNow(); toast('同步完成', 'success'); window.dispatchEvent(new CustomEvent('data-changed')); }
      catch (err) { toast(`同步失败：${err.message}`, 'error'); }
      finally { b.disabled = false; renderAccount(); }
    });
    $('#acct-logout', root).addEventListener('click', async () => { await Sync.logout(); toast('已退出，本地数据保留', 'info'); renderAccount(); });
  } else {
    stateEl.textContent = '未登录'; stateEl.className = 'pill';
    box.innerHTML = authFormHtml();
    bindAuthForm(box);
  }
  refreshIcons(box);
}

function authFormHtml() {
  return `
    <div class="tabs"><button type="button" class="tab ${authTab === 'login' ? 'is-active' : ''}" data-tab="login">登录</button><button type="button" class="tab ${authTab === 'register' ? 'is-active' : ''}" data-tab="register">注册</button></div>
    <form class="form-stack auth-form" autocomplete="on">
      <label class="field"><span>用户名</span><input name="username" type="text" autocomplete="username" placeholder="2~24 位字母、数字或中文" required /></label>
      <label class="field"><span>密码</span><input name="password" type="password" autocomplete="${authTab === 'register' ? 'new-password' : 'current-password'}" placeholder="至少 6 位" required minlength="6" /></label>
      <details class="adv"><summary>高级：自定义同步服务器</summary><label class="field"><span>服务器地址</span><input name="server" type="url" placeholder="${escapeHtml(Sync.defaultServerUrl())}" /></label></details>
      <button type="submit" class="btn btn-primary btn-block"><i data-lucide="${authTab === 'register' ? 'user-plus' : 'log-in'}"></i><span>${authTab === 'register' ? '注册并上传数据' : '登录并同步'}</span></button>
      <p class="muted small">密码在浏览器内经 20 万轮 PBKDF2 派生后再传输，服务器不会收到明文。</p>
    </form>`;
}

function bindAuthForm(box, onDone) {
  box.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { authTab = t.dataset.tab; box.innerHTML = authFormHtml(); bindAuthForm(box, onDone); refreshIcons(box); }));
  const form = box.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>连接云端…</span>'; refreshIcons(btn);
    try {
      if (authTab === 'register') await Sync.register(fd.get('username'), fd.get('password'), fd.get('server'));
      else await Sync.login(fd.get('username'), fd.get('password'), fd.get('server'));
      toast(authTab === 'register' ? '注册成功，数据已上传' : '登录成功，数据已合并', 'success');
      window.dispatchEvent(new CustomEvent('data-changed'));
      renderAccount();
      onDone?.();
    } catch (err) {
      toast(err.message || '连接失败', 'error', 3600);
      btn.disabled = false; btn.innerHTML = `<i data-lucide="${authTab === 'register' ? 'user-plus' : 'log-in'}"></i><span>${authTab === 'register' ? '注册并上传数据' : '登录并同步'}</span>`; refreshIcons(btn);
    }
  });
}

/** 侧栏云同步按钮打开的弹窗 */
export function openAuthModal() {
  const auth = storage.getCloudAuth();
  if (auth.token) {
    const m = openModal({ eyebrow: '云同步', title: auth.username, size: 'sm', body: `<p class="muted">${auth.lastSyncTime ? `上次同步 ${new Date(auth.lastSyncTime).toLocaleString('zh-CN', { hour12: false })}` : '尚未同步'}</p>`, footer: `<button class="btn btn-ghost" data-logout><i data-lucide="log-out"></i><span>退出</span></button><button class="btn btn-primary" data-sync><i data-lucide="refresh-cw"></i><span>立即同步</span></button>` });
    m.el.querySelector('[data-sync]').addEventListener('click', async (e) => { e.currentTarget.disabled = true; try { await Sync.syncNow(); toast('同步完成', 'success'); window.dispatchEvent(new CustomEvent('data-changed')); m.close(); } catch (err) { toast(`同步失败：${err.message}`, 'error'); e.currentTarget.disabled = false; } });
    m.el.querySelector('[data-logout]').addEventListener('click', async () => { await Sync.logout(); toast('已退出', 'info'); m.close(); renderAccount(); });
    return;
  }
  const m = openModal({ eyebrow: '云同步', title: '登录或注册', size: 'sm', body: '<div id="auth-modal-body"></div>' });
  const body = m.el.querySelector('#auth-modal-body');
  body.innerHTML = authFormHtml();
  bindAuthForm(body, () => m.close());
  refreshIcons(body);
}

// ---------- 绑定 ----------
function loadForm() {
  const s = storage.getSettings();
  $('#api-base', root).value = s.baseUrl || '';
  $('#api-key', root).value = s.apiKey || '';
  $('#api-model', root).value = s.model || '';
  $('#pref-daily', root).value = s.dailyNew; $('#pref-daily-val', root).textContent = s.dailyNew;
  $('#pref-group', root).value = s.groupSize; $('#pref-group-val', root).textContent = s.groupSize;
  $('#pref-audio', root).checked = !!s.autoAudio;
  $$('#pref-input [data-v]', root).forEach(b => b.classList.toggle('is-active', b.dataset.v === s.inputMode));
  $$('.theme-card', root).forEach(b => b.classList.toggle('is-active', b.dataset.themePick === (s.theme || 'dark')));
  $$('[data-provider]', root).forEach(b => b.classList.toggle('is-active', b.dataset.provider === Api.normaliseBaseUrl(s.baseUrl)));
}

function saveApi() {
  const patch = { baseUrl: Api.normaliseBaseUrl($('#api-base', root).value), apiKey: $('#api-key', root).value.trim(), model: $('#api-model', root).value.trim() };
  storage.saveSettings(patch);
  window.dispatchEvent(new CustomEvent('settings-changed'));
  return patch;
}

function bind() {
  $$('[data-provider]', root).forEach(b => b.addEventListener('click', () => { $('#api-base', root).value = b.dataset.provider; $$('[data-provider]', root).forEach(x => x.classList.toggle('is-active', x === b)); }));
  $('#api-key-eye', root).addEventListener('click', () => { const i = $('#api-key', root); i.type = i.type === 'password' ? 'text' : 'password'; $('#api-key-eye i', root).setAttribute('data-lucide', i.type === 'password' ? 'eye' : 'eye-off'); refreshIcons(root); });
  $('#api-key-paste', root).addEventListener('click', async () => { try { const t = await navigator.clipboard.readText(); if (t) { $('#api-key', root).value = t.trim(); toast('已粘贴', 'success', 1200); } } catch { toast('浏览器未授权读取剪贴板，请手动粘贴', 'warning'); } });

  $('#api-detect', root).addEventListener('click', async (e) => {
    const b = e.currentTarget; const note = $('#api-detect-note', root);
    b.disabled = true; b.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>检测中</span>'; refreshIcons(b);
    try {
      const { models } = await Api.detectModels({ baseUrl: $('#api-base', root).value, apiKey: $('#api-key', root).value });
      $('#api-model-list', root).innerHTML = models.map(m => `<option value="${escapeHtml(m)}"></option>`).join('');
      note.textContent = `检测到 ${models.length} 个模型，点击模型输入框即可选择`;
      if (!$('#api-model', root).value) {
        const guess = models.find(m => /gpt-4o-mini|deepseek-chat|qwen-plus|llama-3\.\d|mistral/i.test(m)) || models[0];
        $('#api-model', root).value = guess;
      }
      toast(`检测到 ${models.length} 个可用模型`, 'success');
    } catch (err) { note.textContent = err.message; toast(err.message, 'error', 3600); }
    finally { b.disabled = false; b.innerHTML = '<i data-lucide="radar"></i><span>检测模型</span>'; refreshIcons(b); }
  });

  $('#api-test', root).addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const settings = saveApi();
    b.disabled = true; b.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>发送中</span>'; refreshIcons(b);
    try {
      const reply = await Api.chatCompletion(settings, [{ role: 'user', content: '用一句话英文加中文翻译鼓励一位正在背单词的学生。' }], { maxTokens: 120 });
      openModal({ eyebrow: '连接成功', title: settings.model, size: 'sm', body: `<blockquote class="reply">${escapeHtml(reply || '（空回复）')}</blockquote>` });
    } catch (err) { toast(err.message, 'error', 4000); }
    finally { b.disabled = false; b.innerHTML = '<i data-lucide="message-circle"></i><span>发一句试试</span>'; refreshIcons(b); }
  });

  $('#api-form', root).addEventListener('submit', (e) => { e.preventDefault(); saveApi(); toast('已保存，阅读室与助教即刻生效', 'success'); });

  const daily = $('#pref-daily', root), group = $('#pref-group', root);
  daily.addEventListener('input', () => $('#pref-daily-val', root).textContent = daily.value);
  daily.addEventListener('change', () => { storage.saveSettings({ dailyNew: Number(daily.value) }); window.dispatchEvent(new CustomEvent('settings-changed')); window.dispatchEvent(new CustomEvent('study-progress')); });
  group.addEventListener('input', () => $('#pref-group-val', root).textContent = group.value);
  group.addEventListener('change', () => { storage.saveSettings({ groupSize: Number(group.value) }); window.dispatchEvent(new CustomEvent('settings-changed')); });
  $$('#pref-input [data-v]', root).forEach(b => b.addEventListener('click', () => { storage.saveSettings({ inputMode: b.dataset.v }); $$('#pref-input [data-v]', root).forEach(x => x.classList.toggle('is-active', x === b)); window.dispatchEvent(new CustomEvent('settings-changed')); }));
  $('#pref-audio', root).addEventListener('change', (e) => { storage.saveSettings({ autoAudio: e.target.checked }); window.dispatchEvent(new CustomEvent('settings-changed')); });
  $$('.theme-card', root).forEach(b => b.addEventListener('click', () => { applyTheme(b.dataset.themePick); $$('.theme-card', root).forEach(x => x.classList.toggle('is-active', x === b)); }));

  $('#data-export', root).addEventListener('click', () => {
    const data = storage.exportForSync();
    download(`yuki-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    toast('已导出备份', 'success');
  });
  const file = $('#data-file', root);
  let importMode = 'merge';
  $('#data-import', root).addEventListener('click', () => { importMode = 'merge'; file.click(); });
  $('#data-replace', root).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '用备份覆盖本机数据？', message: '本机现有的学习记录与记忆状态会被备份文件替换。', confirmText: '覆盖', danger: true }))) return;
    importMode = 'replace'; file.click();
  });
  file.addEventListener('change', () => {
    const f = file.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        const ok = importMode === 'replace' ? storage.importReplace(json) : storage.importMerge(json);
        if (!ok) throw new Error('格式不匹配');
        toast(importMode === 'replace' ? '已用备份覆盖' : '已合并导入', 'success');
        window.dispatchEvent(new CustomEvent('data-changed'));
        window.dispatchEvent(new CustomEvent('study-progress'));
        Sync.autoSave(1500);
        loadForm();
      } catch (err) { toast(`导入失败：${err.message}`, 'error'); }
      file.value = '';
    };
    reader.readAsText(f);
  });
  $('#data-reset', root).addEventListener('click', async () => {
    if (!(await confirmDialog({ title: '清空全部本地数据？', message: '所有学习记录、记忆状态与设置都会被删除，此操作不可恢复。若已登录，云端数据不受影响。', confirmText: '清空', danger: true }))) return;
    const auth = storage.getCloudAuth();
    storage.resetAll();
    storage.saveCloudAuth(auth);
    storage.saveSettings({ theme: DEFAULT_SETTINGS.theme });
    toast('已清空', 'info');
    window.dispatchEvent(new CustomEvent('data-changed'));
    window.dispatchEvent(new CustomEvent('study-progress'));
    loadForm();
  });

  Sync.onStateChange(() => renderAccount());
}

export function init(container) {
  root = container;
  root.innerHTML = template();
  loadForm();
  bind();
  renderAccount();
  refreshIcons(root);
}

export function onShow() { loadForm(); renderAccount(); }

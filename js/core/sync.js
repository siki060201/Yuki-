/**
 * core/sync.js · 账号与云同步
 *  - 密码在浏览器端经 PBKDF2 派生后再发送（见 crypto.js），服务端永远拿不到明文
 *  - 旧版账号首次登录自动升级
 *  - Token 30 天有效；退出登录会在服务端吊销
 */

import { storage } from './storage.js';
import { deriveAuthKey } from './crypto.js';

let state = 'offline'; // offline | syncing | synced | error
const listeners = new Set();
let autoTimer = null;

function setState(next, detail = {}) {
  state = next;
  listeners.forEach(fn => { try { fn(state, detail); } catch {} });
}

export function onStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function getState() { return state; }
export function getAuth() { return storage.getCloudAuth(); }
export function isLoggedIn() { return Boolean(storage.getCloudAuth().token); }

function cleanUrl(url) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = (/localhost|127\.0\.0\.1/.test(u) ? 'http://' : 'https://') + u;
  return u;
}

export function defaultServerUrl() {
  const auth = storage.getCloudAuth();
  if (auth.serverUrl) return cleanUrl(auth.serverUrl);
  const { origin, port, protocol } = window.location;
  if (protocol.startsWith('http')) {
    // 常见静态开发端口 → 本地同步服务
    if (['5500', '5173', '8000', '8080', '4173'].includes(port)) return 'http://localhost:3000';
    return origin;
  }
  return 'http://localhost:3000';
}

async function request(endpoint, { method = 'GET', body, serverUrl, timeout = 15000 } = {}) {
  const base = cleanUrl(serverUrl || defaultServerUrl());
  if (!base) throw new Error('未配置云端服务器地址');
  const auth = storage.getCloudAuth();
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`${base}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('网络请求超时，请检查服务器连接');
    throw new Error('无法连接云端服务器');
  }
  clearTimeout(timer);

  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error(res.status === 404 ? '服务器上没有同步接口（请确认已部署 Worker）' : `服务器返回异常 (${res.status})`);
  }
  const json = await res.json();
  if (!res.ok || json.error) {
    const err = new Error(json.error || json.message || `请求失败 (${res.status})`);
    err.code = json.code;
    err.status = res.status;
    if (res.status === 401 && auth.token && !endpoint.startsWith('/api/auth/')) {
      // 凭证过期：清理本地登录态
      storage.saveCloudAuth({ token: '', lastSyncTime: '' });
      setState('offline', { message: '登录已过期' });
    }
    throw err;
  }
  return json;
}

function validate(username, password) {
  const u = String(username || '').trim();
  if (!u || !password) throw new Error('请完整填写账号与密码');
  if (!/^[A-Za-z0-9_\-一-龥]{2,24}$/.test(u)) throw new Error('用户名需为 2~24 位字母、数字、下划线或中文');
  if (String(password).length < 6) throw new Error('密码至少 6 位');
  return u;
}

export async function register(username, password, serverUrl) {
  const u = validate(username, password);
  const server = cleanUrl(serverUrl || defaultServerUrl());
  setState('syncing', { message: '正在注册...' });
  try {
    const authKey = await deriveAuthKey(u, password);
    const res = await request('/api/auth/register', { method: 'POST', body: { username: u, authKey }, serverUrl: server });
    storage.saveCloudAuth({ serverUrl: server, token: res.token, username: res.username || u.toLowerCase(), lastSyncTime: '' });
    await pushData();
    setState('synced', { message: '注册成功，数据已上传' });
    return res;
  } catch (e) {
    setState('error', { error: e.message });
    throw e;
  }
}

export async function login(username, password, serverUrl) {
  const u = validate(username, password);
  const server = cleanUrl(serverUrl || defaultServerUrl());
  setState('syncing', { message: '正在登录...' });
  try {
    const authKey = await deriveAuthKey(u, password);
    let res;
    try {
      res = await request('/api/auth/login', { method: 'POST', body: { username: u, authKey }, serverUrl: server });
    } catch (e) {
      if (e.code !== 'LEGACY_UPGRADE') throw e;
      // 旧版账号：补一次明文完成安全升级（仅此一次，之后只用 authKey）
      res = await request('/api/auth/login', { method: 'POST', body: { username: u, authKey, password }, serverUrl: server });
    }
    storage.saveCloudAuth({ serverUrl: server, token: res.token, username: res.username || u.toLowerCase(), lastSyncTime: '' });
    await syncNow();
    return res;
  } catch (e) {
    setState('error', { error: e.message });
    throw e;
  }
}

export async function logout() {
  const auth = storage.getCloudAuth();
  if (auth.token) {
    try { await request('/api/auth/logout', { method: 'POST' }); } catch {}
  }
  storage.saveCloudAuth({ token: '', username: '', lastSyncTime: '' });
  setState('offline', { message: '已退出登录' });
}

export async function pushData() {
  const auth = storage.getCloudAuth();
  if (!auth.token) return null;
  const res = await request('/api/sync/push', { method: 'POST', body: { data: storage.exportForSync(), clientUpdatedAt: new Date().toISOString() } });
  storage.saveCloudAuth({ lastSyncTime: res.syncedAt || new Date().toISOString() });
  return res;
}

export async function pullData() {
  const auth = storage.getCloudAuth();
  if (!auth.token) return null;
  const res = await request('/api/sync/pull');
  if (res.data && typeof res.data === 'object') storage.importMerge(res.data);
  return res;
}

export async function syncNow() {
  const auth = storage.getCloudAuth();
  if (!auth.token) { setState('offline'); return; }
  setState('syncing', { message: '正在同步...' });
  try {
    await pullData();
    await pushData();
    setState('synced', { message: `同步完成 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
  } catch (e) {
    setState(storage.getCloudAuth().token ? 'error' : 'offline', { error: e.message });
    throw e;
  }
}

/** 学习动作后延迟静默上传 */
export function autoSave(delay = 1500) {
  if (!storage.getCloudAuth().token) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    pushData().then(() => setState('synced')).catch(e => { console.warn('[sync] 自动上传失败', e); setState('error', { error: e.message }); });
  }, delay);
}

export function init() {
  const auth = storage.getCloudAuth();
  if (auth.token && auth.serverUrl) {
    setState('synced');
    setTimeout(() => syncNow().catch(() => {}), 1200);
  } else {
    setState('offline');
  }
  window.addEventListener('online', () => { if (storage.getCloudAuth().token) syncNow().catch(() => {}); });
}

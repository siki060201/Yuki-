/**
 * core/storage.js · 本地数据层（localStorage，v2 结构）
 *
 * {
 *   version: 2,
 *   settings:  { baseUrl, model, apiKey, theme, inputMode, autoAudio, groupSize, dailyNew, pomodoroMinutes }
 *   cloudAuth: { serverUrl, token, username, lastSyncTime }
 *   sessions:  [ { id, type:'study'|'reading', date, title, words, ... } ]   学习/阅读历史
 *   cards:     { word: SRS 卡片 }                                            单词级记忆状态
 *   log:       { 'YYYY-MM-DD': { new, review, again, total } }               每日学习日志
 *   cursor:    { newIndex }                                                  顺序学新词的进度
 * }
 *
 * 旧版 (lexora.browser-data.v1) 首次读取时自动迁移：历史打卡词全部转成复习卡。
 */

import { todayKey, addDays, daysBetween } from './srs.js';

const KEY_V2 = 'yuki.data.v2';
const KEY_V1 = 'lexora.browser-data.v1';
const THEME_KEY = 'lexora.theme';

export const DEFAULT_SETTINGS = {
  baseUrl: 'https://integrate.api.nvidia.com/v1',
  model: '',
  apiKey: '',
  theme: 'dark',
  inputMode: 'spell',      // spell | recall | dictation
  autoAudio: false,
  groupSize: 10,
  dailyNew: 20,
  pomodoroMinutes: 25,
  ambient: 'none',
};

function emptyData() {
  return {
    version: 2,
    settings: { ...DEFAULT_SETTINGS },
    cloudAuth: { serverUrl: '', token: '', username: '', lastSyncTime: '' },
    sessions: [],
    cards: {},
    log: {},
    cursor: { newIndex: 0 },
  };
}

let cache = null;
const listeners = new Set();

function createId() {
  return globalThis.crypto?.randomUUID?.() || `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseSession(s, index = 0) {
  const id = String(s?.id || `legacy-${s?.date || 'unknown'}-${s?.createdAt || index}`);
  const type = s?.type || (s?.genre === '背词打卡' ? 'study' : 'reading');
  return { ...s, id, type };
}

function sortSessions(list) {
  return [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

/** 把旧版打卡历史转成单词卡：越久以前学的，间隔越长，且到期日不早于今天 */
function seedCardsFromSessions(sessions, cards, today) {
  for (const s of sessions) {
    if (s.type !== 'study' || !s.date) continue;
    const age = Math.max(0, daysBetween(s.date, today));
    for (const w of s.words || []) {
      const key = String(w || '').toLowerCase().trim();
      if (!key || cards[key]) continue;
      const interval = Math.max(1, Math.min(30, Math.round(age / 2) || 1));
      let due = addDays(s.date, interval);
      if (due < today) due = today;
      cards[key] = { s: 'review', e: 2.5, i: interval, due, r: 1, l: 0, c: 1, last: `${s.date}T12:00:00.000Z` };
    }
  }
  return cards;
}

function migrateV1(v1) {
  const data = emptyData();
  data.settings = { ...data.settings, ...(v1.settings || {}) };
  if (typeof v1.dailyGoal === 'number') data.settings.dailyNew = v1.dailyGoal;
  data.cloudAuth = { ...data.cloudAuth, ...(v1.cloudAuth || {}) };
  data.sessions = sortSessions((v1.sessions || []).map(normaliseSession));
  data.cards = seedCardsFromSessions(data.sessions, {}, todayKey());
  for (const s of data.sessions) {
    if (s.type !== 'study' || !s.date) continue;
    const n = (s.words || []).length;
    const day = data.log[s.date] || { new: 0, review: 0, again: 0, total: 0 };
    day.new += n; day.total += n;
    data.log[s.date] = day;
  }
  return data;
}

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      cache = {
        ...emptyData(),
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        cloudAuth: { ...emptyData().cloudAuth, ...(parsed.cloudAuth || {}) },
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normaliseSession) : [],
        cards: parsed.cards && typeof parsed.cards === 'object' ? parsed.cards : {},
        log: parsed.log && typeof parsed.log === 'object' ? parsed.log : {},
        cursor: { newIndex: 0, ...(parsed.cursor || {}) },
      };
      return cache;
    }
    const legacy = localStorage.getItem(KEY_V1);
    if (legacy) {
      cache = migrateV1(JSON.parse(legacy));
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme) cache.settings.theme = savedTheme;
      write(cache);
      console.info('[storage] 已从 v1 迁移学习数据：', cache.sessions.length, '条记录，', Object.keys(cache.cards).length, '张单词卡');
      return cache;
    }
  } catch (e) {
    console.warn('[storage] 读取失败，使用空数据', e);
  }
  cache = emptyData();
  return cache;
}

function write(data) {
  cache = data;
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(data));
  } catch (e) {
    console.warn('[storage] 写入失败（可能是配额不足）', e);
  }
  listeners.forEach(fn => { try { fn(data); } catch {} });
}

function mutate(fn) {
  const data = read();
  const result = fn(data);
  write(data);
  return result;
}

export const storage = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // ---- 设置 ----
  getSettings() { return { ...read().settings }; },
  saveSettings(patch) { return mutate(d => { d.settings = { ...d.settings, ...patch }; return { ...d.settings }; }); },

  // ---- 云端账号 ----
  getCloudAuth() { return { ...read().cloudAuth }; },
  saveCloudAuth(patch) { return mutate(d => { d.cloudAuth = { ...d.cloudAuth, ...patch }; return { ...d.cloudAuth }; }); },

  // ---- 历史记录 ----
  getSessions() { return sortSessions(read().sessions); },
  getSessionsForDate(date) { return sortSessions(read().sessions.filter(s => s.date === date)); },
  getSession(id) { return read().sessions.find(s => s.id === id) || null; },
  saveSession(session) {
    return mutate(d => {
      const saved = normaliseSession({ ...session, id: session.id || createId(), createdAt: session.createdAt || new Date().toISOString() });
      const idx = d.sessions.findIndex(s => s.id === saved.id);
      if (idx >= 0) d.sessions[idx] = saved; else d.sessions.push(saved);
      return saved;
    });
  },
  deleteSession(id) { return mutate(d => { d.sessions = d.sessions.filter(s => s.id !== id); return true; }); },

  // ---- 单词卡 ----
  getCards() { return { ...read().cards }; },
  getCard(word) { return read().cards[String(word).toLowerCase()] || null; },
  saveCard(word, card) { return mutate(d => { d.cards[String(word).toLowerCase()] = card; return card; }); },
  saveCards(map) { return mutate(d => { Object.assign(d.cards, map); return true; }); },
  removeCard(word) { return mutate(d => { delete d.cards[String(word).toLowerCase()]; return true; }); },

  // ---- 每日日志 ----
  getLog() { return { ...read().log }; },
  bumpLog(dateKey, patch) {
    return mutate(d => {
      const day = d.log[dateKey] || { new: 0, review: 0, again: 0, total: 0 };
      for (const k of Object.keys(patch)) day[k] = (day[k] || 0) + (patch[k] || 0);
      d.log[dateKey] = day;
      return day;
    });
  },

  // ---- 顺序学新词游标 ----
  getCursor() { return { ...read().cursor }; },
  setCursor(patch) { return mutate(d => { d.cursor = { ...d.cursor, ...patch }; return d.cursor; }); },

  // ---- 导出 / 导入 ----
  exportAll() { return JSON.parse(JSON.stringify(read())); },

  /** 用于云同步的载荷：不含密钥与登录凭证 */
  exportForSync() {
    const d = read();
    const { apiKey, ...settings } = d.settings;
    return { version: 2, settings, sessions: d.sessions, cards: d.cards, log: d.log, cursor: d.cursor, exportedAt: new Date().toISOString() };
  },

  /** 合并导入：记录按 id 去重，卡片按最近复习时间取新，日志逐日取大 */
  importMerge(incoming) {
    if (!incoming || typeof incoming !== 'object') return false;
    const src = incoming.version === 2 ? incoming : migrateV1(incoming);
    return mutate(d => {
      const settings = { ...(src.settings || {}) };
      if (!String(settings.apiKey || '').trim()) delete settings.apiKey;
      if (!settings.theme) delete settings.theme;
      d.settings = { ...d.settings, ...settings };

      const map = new Map(d.sessions.map(s => [s.id, s]));
      for (const raw of src.sessions || []) {
        const s = normaliseSession(raw);
        const exist = map.get(s.id);
        if (!exist || String(s.createdAt || '') > String(exist.createdAt || '')) map.set(s.id, s);
      }
      d.sessions = sortSessions([...map.values()]);

      for (const [word, card] of Object.entries(src.cards || {})) {
        const exist = d.cards[word];
        if (!exist || String(card.last || '') > String(exist.last || '')) d.cards[word] = card;
      }

      for (const [date, day] of Object.entries(src.log || {})) {
        const exist = d.log[date] || { new: 0, review: 0, again: 0, total: 0 };
        d.log[date] = { new: Math.max(exist.new, day.new || 0), review: Math.max(exist.review, day.review || 0), again: Math.max(exist.again, day.again || 0), total: Math.max(exist.total, day.total || 0) };
      }

      d.cursor.newIndex = Math.max(d.cursor.newIndex || 0, src.cursor?.newIndex || 0);
      return true;
    });
  },

  /** 覆盖导入（备份恢复） */
  importReplace(incoming) {
    if (!incoming || typeof incoming !== 'object') return false;
    const src = incoming.version === 2 ? incoming : migrateV1(incoming);
    const current = read();
    write({ ...emptyData(), ...src, settings: { ...DEFAULT_SETTINGS, ...(src.settings || {}), apiKey: src.settings?.apiKey || current.settings.apiKey }, cloudAuth: current.cloudAuth });
    return true;
  },

  resetAll() { write(emptyData()); },
};

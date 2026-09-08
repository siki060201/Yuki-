/**
 * core/lexicon.js · 词库访问层
 * 词库本体 (js/data/lexicon.js, ~1.1MB) 采用动态 import 延迟加载，首屏不阻塞。
 */

let list = [];
let index = new Map();
let loadPromise = null;

export function loadLexicon() {
  if (!loadPromise) {
    loadPromise = import('../data/lexicon.js').then(mod => {
      list = Array.isArray(mod.default) ? mod.default : [];
      index = new Map();
      list.forEach((item, i) => index.set(String(item.word).toLowerCase(), i));
      return list;
    });
  }
  return loadPromise;
}

export function isLoaded() { return list.length > 0; }
export function getAll() { return list; }
export function size() { return list.length; }
export function getByIndex(i) { return list[i] || null; }

export function lookup(word) {
  const i = index.get(String(word || '').trim().toLowerCase());
  return i === undefined ? null : list[i];
}

/** 统一成阅读室/词卡使用的详细结构 */
export function toDetail(word) {
  const w = String(word || '').trim().toLowerCase();
  const hit = lookup(w);
  if (hit) {
    return {
      word: hit.word,
      ipa: hit.ipa || '',
      partOfSpeech: hit.pos || '',
      definition: hit.def || '',
      explanation: hit.mne || '',
      sentence: hit.sen || '',
      translation: hit.trans || '',
    };
  }
  return { word: w, ipa: '', partOfSpeech: '', definition: '', explanation: '', sentence: '', translation: '' };
}

/** 顺序分组 */
export function getGroup(groupIndex, groupSize) {
  const start = groupIndex * groupSize;
  return list.slice(start, start + groupSize);
}

export function groupCount(groupSize) {
  return Math.max(1, Math.ceil(list.length / groupSize));
}

/** 前缀搜索（设置页/词库浏览用） */
export function search(query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const item of list) {
    if (item.word.toLowerCase().startsWith(q) || (item.def && item.def.includes(q))) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}

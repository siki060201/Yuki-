/**
 * features/study-engine.js · 学习队列与记忆状态的业务层
 * 把 SRS 调度、词库、存储串起来，供背词页 / 首页 / 统计页共用。
 */

import { storage } from '../core/storage.js';
import * as Lexicon from '../core/lexicon.js';
import { schedule, newCard, todayKey, isDue, maturity, retention, previewIntervals, daysBetween } from '../core/srs.js';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 词库条目 + 卡片 → 学习条目 */
function toEntry(item, card) {
  return { item, word: item.word, card: card || null };
}

function itemFor(word) {
  return Lexicon.lookup(word) || { word, ipa: '', pos: '', def: '', sen: '', trans: '', mne: '' };
}

/** 今日到期（含尚在学习中的卡） */
export function getDueEntries(today = todayKey()) {
  const cards = storage.getCards();
  const due = [];
  for (const [word, card] of Object.entries(cards)) {
    if (isDue(card, today)) due.push(toEntry(itemFor(word), card));
  }
  // 最久未复习的优先，其余打散
  due.sort((a, b) => a.card.due.localeCompare(b.card.due) || (retention(a.card, today) - retention(b.card, today)));
  return due;
}

export function countDue(today = todayKey()) {
  const cards = storage.getCards();
  let n = 0;
  for (const c of Object.values(cards)) if (isDue(c, today)) n++;
  return n;
}

/** 顺序学新词：从游标开始，跳过已有卡片的词 */
export function getNewEntries(count) {
  const cards = storage.getCards();
  const all = Lexicon.getAll();
  const { newIndex = 0 } = storage.getCursor();
  const out = [];
  let i = newIndex;
  for (; i < all.length && out.length < count; i++) {
    const item = all[i];
    if (!cards[item.word.toLowerCase()]) out.push(toEntry(item, null));
  }
  return { entries: out, nextIndex: i };
}

export function getRandomNewEntries(count) {
  const cards = storage.getCards();
  const pool = Lexicon.getAll().filter(it => !cards[it.word.toLowerCase()]);
  return shuffle(pool).slice(0, count).map(it => toEntry(it, null));
}

export function getGroupEntries(groupIndex, groupSize) {
  const cards = storage.getCards();
  return Lexicon.getGroup(groupIndex, groupSize).map(it => toEntry(it, cards[it.word.toLowerCase()] || null));
}

/** 错词本：遗忘次数最多、记忆保留率最低的优先 */
export function getWrongEntries(limit = Infinity, today = todayKey()) {
  const cards = storage.getCards();
  const list = Object.entries(cards)
    .filter(([, c]) => c.l > 0)
    .sort((a, b) => (b[1].l - a[1].l) || (retention(a[1], today) - retention(b[1], today)))
    .slice(0, limit)
    .map(([w, c]) => toEntry(itemFor(w), c));
  return list;
}

export function countWrong() {
  return Object.values(storage.getCards()).filter(c => c.l > 0).length;
}

/** 把一个词加入学习队列（今日到期的学习卡） */
export function enqueueWord(word) {
  const key = String(word || '').toLowerCase().trim();
  if (!key) return null;
  if (storage.getCard(key)) return storage.getCard(key);
  const card = newCard(todayKey());
  storage.saveCard(key, card);
  return card;
}

/**
 * 会话内评分。
 *  - 新词（learning）：again/hard 留在本轮队列，good/easy 毕业并调度
 *  - 复习卡：立即调度；again 额外进入本轮「重学」，重学后的 good 不再改动调度
 */
export function rateEntry(entry, rating, today = todayKey()) {
  const wasNew = !entry.card || entry.card.s === 'learning';
  let card = entry.card || newCard(today);
  let requeue = false;
  let counted = { total: 1, again: rating === 'again' ? 1 : 0, new: 0, review: 0 };

  if (entry.relearn) {
    if (rating === 'again') { card = schedule(card, 'again', today); requeue = true; }
    // 其他评分：本轮重学完成，不再调度
  } else if (wasNew) {
    if (rating === 'again') { card = schedule(card, 'again', today); requeue = true; }
    else if (rating === 'hard') { requeue = true; card = { ...card, r: card.r + 1, last: new Date().toISOString() }; }
    else { card = schedule(card, rating, today); counted.new = 1; }
  } else {
    if (!entry.reviewCounted) { counted.review = 1; entry.reviewCounted = true; }
    card = schedule(card, rating, today);
    if (rating === 'again') { requeue = true; entry.relearn = true; }
  }

  storage.saveCard(entry.word, card);
  storage.bumpLog(today, counted);
  entry.card = card;
  return { card, requeue, wasNew };
}

/** 评分按钮预告文案 */
export function previewFor(entry, today = todayKey()) {
  const learning = !entry.card || entry.card.s === 'learning';
  if (entry.relearn) return { again: '稍后', hard: '完成', good: '完成', easy: '完成' };
  if (learning) {
    const p = previewIntervals(entry.card || newCard(today), today);
    return { again: '稍后', hard: '稍后', good: p.good, easy: p.easy };
  }
  return previewIntervals(entry.card, today);
}

/** 连续学习天数（允许今天还没学） */
export function computeStreak(today = todayKey()) {
  const log = storage.getLog();
  const active = new Set(Object.entries(log).filter(([, d]) => (d.total || 0) > 0).map(([k]) => k));
  for (const s of storage.getSessions()) if (s.date) active.add(s.date);
  let streak = 0;
  let cursor = today;
  if (!active.has(cursor)) {
    const d = new Date(cursor + 'T12:00:00'); d.setDate(d.getDate() - 1);
    cursor = todayKey(d);
    if (!active.has(cursor)) return 0;
  }
  while (active.has(cursor)) {
    streak++;
    const d = new Date(cursor + 'T12:00:00'); d.setDate(d.getDate() - 1);
    cursor = todayKey(d);
  }
  return streak;
}

export function getTodaySummary(today = todayKey()) {
  const settings = storage.getSettings();
  const log = storage.getLog()[today] || { new: 0, review: 0, again: 0, total: 0 };
  return {
    today,
    due: countDue(today),
    newDone: log.new,
    reviewDone: log.review,
    again: log.again,
    total: log.total,
    dailyNew: settings.dailyNew,
    newRemaining: Math.max(0, settings.dailyNew - log.new),
    streak: computeStreak(today),
    wrong: countWrong(),
  };
}

export function getMaturityStats() {
  const cards = Object.values(storage.getCards());
  const out = { new: 0, learning: 0, young: 0, mature: 0, total: cards.length };
  for (const c of cards) out[maturity(c)]++;
  out.new = Math.max(0, Lexicon.size() - cards.length);
  return out;
}

/** 最近 N 天日志（含空日） */
export function getRecentLog(days = 14, today = todayKey()) {
  const log = storage.getLog();
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - i);
    const k = todayKey(d);
    out.push({ date: k, ...(log[k] || { new: 0, review: 0, again: 0, total: 0 }) });
  }
  return out;
}

/** 未来 7 天预计到期 */
export function getUpcomingDue(days = 7, today = todayKey()) {
  const cards = Object.values(storage.getCards());
  const out = Array.from({ length: days }, () => 0);
  for (const c of cards) {
    const diff = daysBetween(today, c.due);
    if (diff >= 0 && diff < days) out[diff]++;
    else if (diff < 0) out[0]++;
  }
  return out;
}

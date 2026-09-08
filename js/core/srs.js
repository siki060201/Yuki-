/**
 * core/srs.js · 间隔重复调度（SM-2 改良版）
 *
 * 每个单词一张卡：
 *   s    状态 'learning' | 'review'
 *   e    难度系数 ease（1.3 ~ 3.0，初始 2.5）
 *   i    当前间隔（天）
 *   due  下次到期日 'YYYY-MM-DD'
 *   r    复习次数     l  遗忘次数（lapses）    c  连续答对次数
 *   last 上次复习时间 ISO
 *
 * 评分：again(忘了) / hard(模糊) / good(掌握) / easy(秒杀)
 */

export const RATINGS = ['again', 'hard', 'good', 'easy'];
const MAX_INTERVAL = 365;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;

export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function addDays(dateKey, days) {
  const d = new Date(dateKey + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

export function daysBetween(fromKey, toKey) {
  const a = new Date(fromKey + 'T12:00:00');
  const b = new Date(toKey + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

export function newCard(today = todayKey()) {
  return { s: 'learning', e: 2.5, i: 0, due: today, r: 0, l: 0, c: 0, last: '' };
}

/** 计算评分后的新卡片状态（纯函数，不修改入参） */
export function schedule(card, rating, today = todayKey()) {
  const c = { ...(card || newCard(today)) };
  const wasLearning = c.s === 'learning';
  c.r += 1;
  c.last = new Date().toISOString();

  switch (rating) {
    case 'again':
      c.l += 1;
      c.c = 0;
      c.e = Math.max(MIN_EASE, c.e - 0.2);
      c.i = 0;
      c.s = 'learning';
      c.due = today;
      break;
    case 'hard':
      c.e = Math.max(MIN_EASE, c.e - 0.15);
      if (wasLearning) {
        c.i = 1;
        c.s = 'review';
        c.c = 0;
      } else {
        c.i = Math.min(MAX_INTERVAL, Math.max(c.i + 1, Math.round(c.i * 1.2)));
      }
      c.due = addDays(today, c.i);
      break;
    case 'good':
      c.c += 1;
      if (wasLearning) {
        c.i = c.l > 0 ? 1 : (c.c >= 2 ? 3 : 1);
        c.s = 'review';
      } else {
        c.i = Math.min(MAX_INTERVAL, Math.max(c.i + 1, Math.round(c.i * c.e)));
      }
      c.due = addDays(today, c.i);
      break;
    case 'easy': {
      c.c += 1;
      const oldEase = c.e;
      c.e = Math.min(MAX_EASE, c.e + 0.15);
      if (wasLearning) {
        c.i = 4;
        c.s = 'review';
      } else {
        // 至少比「记住」多一天，保证四个评分的间隔严格递增
        const goodInterval = Math.max(c.i + 1, Math.round(c.i * oldEase));
        c.i = Math.min(MAX_INTERVAL, Math.max(goodInterval + 1, Math.round(c.i * c.e * 1.3)));
      }
      c.due = addDays(today, c.i);
      break;
    }
    default:
      return c;
  }
  return c;
}

/** 各评分对应的下次出现时间（用于按钮上的预告） */
export function previewIntervals(card, today = todayKey()) {
  const out = {};
  for (const r of RATINGS) {
    const next = schedule(card, r, today);
    out[r] = next.i === 0 ? '稍后' : formatInterval(next.i);
  }
  return out;
}

export function formatInterval(days) {
  if (days <= 0) return '今天';
  if (days < 30) return `${days} 天`;
  if (days < 365) return `${Math.round(days / 30)} 个月`;
  return `${(days / 365).toFixed(1)} 年`;
}

/** 是否到期 */
export function isDue(card, today = todayKey()) {
  return !!card && card.due <= today;
}

/** 掌握度分级：new / learning / young / mature */
export function maturity(card) {
  if (!card) return 'new';
  if (card.s === 'learning') return 'learning';
  return card.i >= 21 ? 'mature' : 'young';
}

/** 记忆保留率估算（用于统计展示）：R = e^(-t/S)，S 与间隔正相关 */
export function retention(card, today = todayKey()) {
  if (!card || !card.last) return 0;
  const elapsed = Math.max(0, daysBetween(card.last.slice(0, 10), today));
  const stability = Math.max(1, card.i) * 1.2;
  return Math.exp(-elapsed / stability);
}

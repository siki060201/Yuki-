/**
 * core/api.js · 模型接口（OpenAI 兼容）
 *  - 线上 HTTPS 环境自动走 Worker 同源代理 (/api/*)，规避浏览器 CORS
 *  - 本地开发直连
 *  - 提供：检测模型 / 生成情境短文 / 流式对话
 */

import * as Lexicon from './lexicon.js';

export function normaliseBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|models)$/i, '');
}

export function useProxy() {
  const { protocol, hostname } = window.location;
  return protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(hostname);
}

export function requestModelApi(baseUrl, path, options = {}) {
  if (!useProxy()) return fetch(`${baseUrl}${path}`, options);
  const headers = new Headers(options.headers || {});
  headers.set('X-Lexora-Upstream', baseUrl);
  return fetch(`/api${path}`, { ...options, headers });
}

function requireSettings(settings) {
  const baseUrl = normaliseBaseUrl(settings?.baseUrl);
  const apiKey = String(settings?.apiKey || '').trim();
  const model = String(settings?.model || '').trim();
  return { baseUrl, apiKey, model };
}

async function readErrorMessage(response) {
  try {
    const text = await response.text();
    try {
      const j = JSON.parse(text);
      return j.error?.message || j.error || j.message || text.slice(0, 200);
    } catch { return text.slice(0, 200); }
  } catch { return ''; }
}

function connectionHint() {
  return useProxy()
    ? '请检查接口地址是否为公网 https 地址，以及 Worker 是否已部署最新版本。'
    : '本地直连被浏览器跨域策略拦截时，部署到 Cloudflare 后会自动通过同源代理连接。';
}

// ---------- 模型列表 ----------
export async function detectModels(settings) {
  const { baseUrl, apiKey } = requireSettings(settings);
  if (!baseUrl || !apiKey) throw new Error('请先填写接口地址和访问密钥');

  let res;
  try {
    res = await requestModelApi(baseUrl, '/models', { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new Error(`无法读取模型列表。${connectionHint()}`);
  }
  if (!res.ok) throw new Error(`模型检测失败（${res.status}）：${await readErrorMessage(res) || '请检查接口地址、密钥与权限'}`);

  let payload;
  try { payload = await res.json(); } catch { throw new Error('接口已响应，但模型列表不是有效 JSON'); }
  const candidates = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : [];
  const seen = new Set();
  const models = candidates
    .map(item => typeof item === 'string' ? item : item?.id || item?.model || item?.name)
    .map(s => String(s || '').trim())
    .filter(s => s && !seen.has(s) && seen.add(s))
    .sort((a, b) => a.localeCompare(b));
  if (!models.length) throw new Error('接口连接正常，但没有返回可选择的模型');
  return { baseUrl, models };
}

// ---------- 通用对话（非流式） ----------
export async function chatCompletion(settings, messages, { temperature = 0.4, maxTokens = 1200, signal } = {}) {
  const { baseUrl, apiKey, model } = requireSettings(settings);
  if (!apiKey) throw new Error('请先在设置中填写访问密钥');
  if (!baseUrl || !model) throw new Error('请先在设置中填写接口地址与模型名称');

  let res;
  try {
    res = await requestModelApi(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`无法连接模型服务。${connectionHint()}`);
  }
  if (!res.ok) throw new Error(`模型请求失败（${res.status}）：${await readErrorMessage(res) || '请检查密钥、模型名称与配额'}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ---------- 流式对话 ----------
export async function streamChat(settings, messages, { temperature = 0.7, signal, onDelta } = {}) {
  const { baseUrl, apiKey, model } = requireSettings(settings);
  if (!apiKey) throw new Error('请先在设置中填写访问密钥');
  if (!baseUrl || !model) throw new Error('请先在设置中填写接口地址与模型名称');

  let res;
  try {
    res = await requestModelApi(baseUrl, '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages, temperature, stream: true }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(`无法连接模型服务。${connectionHint()}`);
  }
  if (!res.ok) throw new Error(`请求失败（${res.status}）：${await readErrorMessage(res) || res.statusText}`);

  const type = res.headers.get('content-type') || '';
  if (!res.body || type.includes('application/json')) {
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    onDelta?.(text, text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? '';
        if (delta) { full += delta; onDelta?.(delta, full); }
      } catch { /* 忽略半截片段 */ }
    }
  }
  return full;
}

// ---------- 阅读短文 ----------
export function parseWords(input) {
  const matches = String(input || '').match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || [];
  const stop = /^(the|and|or|in|on|at|to|a|an|of|for|is|it|by|as)$/i;
  const clean = matches.map(w => w.toLowerCase()).filter(w => w.length > 1 && !stop.test(w));
  return [...new Set(clean)].slice(0, 24);
}

export function getToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const GENRE_META = {
  '日常故事': { title: ['A Quiet Morning of Small Discoveries', 'Notes from a Rainy Afternoon', 'The Art of Starting Over'], open: 'On a gentle morning, steam rose slowly from a warm cup on the desk, and the day opened with unhurried attention.', close: 'By evening, nothing dramatic had happened, yet each ordinary moment had quietly left its mark.' },
  '科技观察': { title: ['Patterns in Modern Discovery', 'How Small Steps Bring Progress', 'The Logic of Innovation'], open: 'In an era when technology evolves at an unprecedented pace, real breakthroughs rarely arrive overnight.', close: 'Progress, it turns out, is less a leap than a long series of careful observations.' },
  '科幻小说': { title: ['Echoes in the Starlit City', 'Beyond the Silent Orbit', 'Chronicles of the New Dawn'], open: 'Far across the twilight expanse of the orbital station, the hum of the engines filled the empty study.', close: 'Outside the viewport, a new star rose, and the long night finally began to end.' },
  '新闻评论': { title: ['A Community Moving Forward', 'Rethinking the Path Ahead', 'Voices of Growth and Renewal'], open: 'Recent developments remind us that meaningful change rarely arrives with loud announcements; it begins with ordinary choices.', close: 'Whether these efforts endure will depend not on headlines, but on the patience of the people behind them.' },
  '商业洞察': { title: ['Building Sustainable Momentum', 'From Insight to Execution', 'Navigating Uncharted Markets'], open: 'Every long-term endeavor requires not only ambitious vision but also the patience to notice gradual improvement.', close: 'In the end, the organizations that last are those that learn faster than they grow.' },
};

function titleCase(w) { return w ? w[0].toUpperCase() + w.slice(1) : 'Word'; }

/** 离线短文引擎：优先使用词库中的真实例句串成段落，而不是套模板拼句 */
export function createOfflineReading(words, genre = '日常故事', difficulty = '四级', targetWordCount = 120) {
  const safeWords = words.length ? words : ['resilient', 'catalyst', 'subtle', 'emerge'];
  const meta = GENRE_META[genre] || GENRE_META['日常故事'];
  const definitions = safeWords.map(w => Lexicon.toDetail(w));

  const sentences = safeWords.map((w, i) => {
    const hit = Lexicon.lookup(w);
    if (hit?.sen) return hit.sen.trim().replace(/\s+/g, ' ');
    const fallbacks = [
      `Learning to stay ${w} during unexpected difficulties helps people see opportunity where others notice only obstacles.`,
      `A single thoughtful conversation can become a true ${w}, igniting enthusiasm across an entire team.`,
      `The change was ${w} at first, yet attentive minds could perceive that something real was taking place.`,
      `With patience through the quiet hours, a fresh understanding began to ${w}.`,
    ];
    return fallbacks[i % fallbacks.length];
  });

  const perParagraph = Math.max(2, Math.ceil(sentences.length / (targetWordCount >= 180 ? 3 : 2)));
  const paragraphs = [meta.open];
  for (let i = 0; i < sentences.length; i += perParagraph) paragraphs.push(sentences.slice(i, i + perParagraph).join(' '));
  paragraphs.push(meta.close);

  return {
    id: `reading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'reading',
    date: getToday(),
    title: meta.title[Math.floor(Math.random() * meta.title.length)],
    body: paragraphs.join('\n\n'),
    words: safeWords,
    genre, difficulty, targetWordCount,
    source: '离线例句串读',
    createdAt: new Date().toISOString(),
    definitions,
  };
}

function extractJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('模型没有返回有效的 JSON 结构');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function generateReading(params, settings, { signal } = {}) {
  const targetWordCount = Math.min(300, Math.max(80, Number(params.targetWordCount) || 120));
  const prompt = `Return ONLY compact valid JSON without markdown fences. Write an authentic, coherent English article of about ${targetWordCount} words for Chinese ${params.difficulty} level learners in the "${params.genre}" genre. Naturally incorporate every target word at least once: ${params.words.join(', ')}. Schema: {"title":"string","body":"paragraphs separated by \\n\\n","definitions":[{"word":"string","ipa":"string","partOfSpeech":"中文词性","definition":"简洁中文释义","explanation":"一句中文点拨：搭配、辨析或记忆钩子"}]}`;

  const content = await chatCompletion(settings, [{ role: 'user', content: prompt }], {
    temperature: 0.4,
    maxTokens: Math.min(2200, Math.max(600, Math.ceil(targetWordCount * 2) + params.words.length * 80)),
    signal,
  });
  const payload = extractJson(content);
  const byWord = new Map((Array.isArray(payload.definitions) ? payload.definitions : []).map(d => [String(d.word || '').toLowerCase(), d]));

  const session = {
    id: `reading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'reading',
    date: getToday(),
    title: String(payload.title || `${titleCase(params.words[0])} in Focus`).slice(0, 90),
    body: String(payload.body || '').trim(),
    words: params.words,
    genre: params.genre,
    difficulty: params.difficulty,
    targetWordCount,
    source: 'AI 生成',
    createdAt: new Date().toISOString(),
    definitions: params.words.map(word => {
      const local = Lexicon.toDetail(word);
      const ai = byWord.get(word.toLowerCase()) || {};
      return {
        word,
        ipa: ai.ipa || local.ipa,
        partOfSpeech: ai.partOfSpeech || local.partOfSpeech,
        definition: ai.definition || local.definition,
        explanation: ai.explanation || local.explanation,
        sentence: local.sentence,
        translation: local.translation,
      };
    }),
  };
  if (!session.body) throw new Error('模型未返回短文内容');
  return session;
}

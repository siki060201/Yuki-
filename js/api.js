(() => {
const FALLBACK_LEXICON = {
  resilient: { ipa: "/rɪˈzɪliənt/", partOfSpeech: "形容词", definition: "有韧性的；能恢复的", explanation: "形容人在压力、变化或挫折后仍能迅速调整并继续前进。" },
  catalyst: { ipa: "/ˈkætəlɪst/", partOfSpeech: "名词", definition: "催化剂；促成变化的人或事", explanation: "原义指化学催化剂，也常指推动改变的关键因素。" },
  subtle: { ipa: "/ˈsʌt(ə)l/", partOfSpeech: "形容词", definition: "微妙的；不易察觉的", explanation: "强调差异、信号或影响很轻微，需要留意才能发现。" },
  emerge: { ipa: "/ɪˈmɜːdʒ/", partOfSpeech: "动词", definition: "出现；浮现；显露", explanation: "表示从不明显或被遮蔽的状态中逐渐显现。" },
};

const genreOpenings = {
  "科技观察": "In a small research studio, a team watched a new pattern take shape across their data.",
  "科幻小说": "At the edge of a quiet orbital city, the morning lights switched on one by one.",
  "日常故事": "On a rainy morning, a student opened a notebook before the first train arrived.",
  "新闻评论": "A recent local report showed how a single practical decision can influence an entire community.",
};

const DIFFICULTY_VOCABULARY_RULES = {
  "四级": "the CET-4 core vocabulary range; prefer common, high-frequency English",
  "六级": "the CET-6 core vocabulary range, including CET-4 vocabulary; avoid rarer academic test vocabulary",
  "专升本": "the Chinese college-to-undergraduate examination core vocabulary range; use common general English and avoid CET-6 or postgraduate-level vocabulary",
  "研究生考试": "the Chinese postgraduate entrance examination core vocabulary range; avoid specialist, GRE, TOEFL, and rare academic vocabulary outside that syllabus",
};

function titleCase(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Word";
}

function fallbackDefinition(word) {
  const known = FALLBACK_LEXICON[word.toLowerCase()];
  if (known) return { word, ...known };
  return {
    word,
    ipa: `/${word}/`,
    partOfSpeech: "词性待定",
    definition: "待 AI 补充释义",
    explanation: "连接模型后，Lexora 会为这个单词生成音标、词性和语境解释。",
  };
}

function parseWords(input) {
  return [...new Set(
    String(input || "")
      .split(/[，,;；\n\t]+/)
      .map((item) => item.trim().replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, ""))
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  )].slice(0, 24);
}

function getToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function createDemoSession(words, genre = "科技观察", difficulty = "四级", targetWordCount = 120) {
  const safeWords = words.length ? words : ["resilient", "catalyst", "subtle", "emerge"];
  const sentences = safeWords.map((word, index) => {
    const label = titleCase(word);
    const options = [
      `${label} became the word the team used when the first result did not match their expectations.`,
      `A small decision acted as a ${word}, giving the group a reason to test an unfamiliar idea.`,
      `The change was ${word} at first, visible only in the way people began to ask better questions.`,
      `Over time, a clearer direction started to ${word}, connecting individual observations into a useful story.`,
    ];
    return options[index % options.length];
  });
  const body = [
    genreOpenings[genre] || genreOpenings["科技观察"],
    "Their work was not dramatic. It was a habit of noticing, revising, and returning to the same question with more care.",
    ...sentences,
    "By the end of the week, the team understood that progress often begins quietly: not with certainty, but with attention and a willingness to learn from what appears next.",
  ].join("\n\n");

  return {
    date: getToday(),
    title: "The Quiet Catalyst",
    body,
    words: safeWords,
    genre,
    difficulty,
    targetWordCount,
    source: "本地演示",
    createdAt: new Date().toISOString(),
    definitions: safeWords.map(fallbackDefinition),
  };
}

function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("模型没有返回可解析的数据。");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normaliseModelResult(payload, params) {
  const definitions = Array.isArray(payload.definitions) ? payload.definitions : [];
  const byWord = new Map(definitions.map((item) => [String(item.word || "").toLowerCase(), item]));
  return {
    date: getToday(),
    title: String(payload.title || "Today's Reading").slice(0, 80),
    body: String(payload.body || "").trim(),
    words: params.words,
    genre: params.genre,
    difficulty: params.difficulty,
    targetWordCount: params.targetWordCount,
    source: "AI 生成",
    createdAt: new Date().toISOString(),
    definitions: params.words.map((word) => ({
      ...fallbackDefinition(word),
      ...(byWord.get(word.toLowerCase()) || {}),
      word,
    })),
  };
}

function normaliseBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|models)$/i, "");
}

function useAppProxy() {
  const { protocol, hostname } = window.location;
  return protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(hostname);
}

async function requestModelApi(baseUrl, path, options = {}) {
  if (!useAppProxy()) return fetch(`${baseUrl}${path}`, options);
  const headers = new Headers(options.headers);
  headers.set("X-Lexora-Upstream", baseUrl);
  return fetch(`/api${path}`, { ...options, headers });
}

function getModelsFromPayload(payload) {
  const candidates = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];
  const seen = new Set();
  return candidates
    .map((item) => typeof item === "string" ? item : item?.id || item?.model || item?.name)
    .map((item) => String(item || "").trim())
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .sort((a, b) => a.localeCompare(b));
}

async function detectModels(settings) {
  const baseUrl = normaliseBaseUrl(settings?.baseUrl);
  const apiKey = String(settings?.apiKey || "").trim();
  if (!baseUrl || !apiKey) throw new Error("请先填写接口地址和访问密钥。");

  let response;
  try {
    response = await requestModelApi(baseUrl, "/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    const hint = useAppProxy()
      ? "无法访问 Cloudflare 代理。请检查站点部署是否完成。"
      : "接口未允许当前静态页面跨域访问（CORS）。部署到 Cloudflare 后会自动通过同源代理连接。";
    throw new Error(`无法读取模型列表。${hint}`);
  }
  if (!response.ok) throw new Error(`模型检测失败（${response.status}）。请检查接口地址、访问密钥和服务商权限。`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("接口已响应，但模型列表不是有效 JSON。");
  }
  const models = getModelsFromPayload(payload);
  if (!models.length) throw new Error("接口连接正常，但没有返回可选择的模型。请确认该接口支持 GET /models。");
  return { baseUrl, models };
}

async function generateReading(params, settings) {
  const targetWordCount = Math.min(250, Math.max(80, Number(params.targetWordCount) || 120));
  if (!settings.apiKey?.trim()) return createDemoSession(params.words, params.genre, params.difficulty, targetWordCount);

  const baseUrl = normaliseBaseUrl(settings.baseUrl);
  if (!baseUrl || !settings.model?.trim()) throw new Error("请先在设置中填写接口地址和模型名称。");
  const vocabularyRule = DIFFICULTY_VOCABULARY_RULES[params.difficulty] || DIFFICULTY_VOCABULARY_RULES["四级"];
  const prompt = `Return ONLY compact valid JSON, without markdown. Write a natural English reading of about ${targetWordCount} words for Chinese ${params.difficulty} students in the ${params.genre} genre. Keep within 10% of the requested length. Controlled vocabulary is mandatory: the vocabulary ceiling is ${params.difficulty}, defined as ${vocabularyRule}. Target words are the only exception: include every target word exactly as written even if it is outside the selected level. Every other content word in the title and body must stay within the selected vocabulary range; ordinary grammar and function words are allowed. Do not introduce words above or outside this level. Before responding, silently audit the title and body and replace every out-of-level non-target word with a simpler approved ${params.difficulty} alternative. JSON: {"title":"string","body":"paragraphs separated by \\n\\n","definitions":[{"word":"string","ipa":"string","partOfSpeech":"Chinese label","definition":"concise Chinese definition","explanation":"Chinese explanation under 24 characters"}]}. Target words: ${params.words.join(", ")}.`;
  const maxTokens = Math.min(1800, Math.max(480, Math.ceil(targetWordCount * 1.8) + params.words.length * 70));
  let response;
  try {
    response = await requestModelApi(baseUrl, "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({ model: settings.model.trim(), temperature: 0.2, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
    });
  } catch {
    const hint = useAppProxy()
      ? "请检查 Cloudflare 部署和上游接口地址。"
      : "部署到 Cloudflare 后会自动通过同源代理连接，避免浏览器跨域限制。";
    throw new Error(`无法连接模型服务。${hint}`);
  }
  if (!response.ok) throw new Error(`模型请求失败（${response.status}）。请检查密钥、模型名称和服务商限制。`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const session = normaliseModelResult(extractJson(content), params);
  if (!session.body) throw new Error("模型未返回短文内容。");
  return session;
}

window.LexoraApi = { createDemoSession, detectModels, generateReading, getToday, parseWords };
})();

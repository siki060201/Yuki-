(() => {
const FALLBACK_LEXICON = {
  resilient: { ipa: "/rɪˈzɪliənt/", partOfSpeech: "形容词", definition: "有韧性的；能恢复的", explanation: "形容人在压力、变化或挫折后仍能迅速调整并继续前进。" },
  catalyst: { ipa: "/ˈkætəlɪst/", partOfSpeech: "名词", definition: "催化剂；促成变化的人或事", explanation: "原义指化学催化剂，也常指推动改变的关键因素。" },
  subtle: { ipa: "/ˈsʌt(ə)l/", partOfSpeech: "形容词", definition: "微妙的；不易察觉的", explanation: "强调差异、信号或影响很轻微，需要留意才能发现。" },
  emerge: { ipa: "/ɪˈmɜːdʒ/", partOfSpeech: "动词", definition: "出现；浮现；显露", explanation: "表示从不明显或被遮蔽的状态中逐渐显现。" },
};

function titleCase(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : "Word";
}

// 本地核心词库查表，优先匹配项目自带的400个精选核心词
function lookupLexicon(word) {
  const w = String(word || "").trim().toLowerCase();
  const rawList = Array.isArray(window.LEXORA_EMBEDDED_LEXICON) ? window.LEXORA_EMBEDDED_LEXICON : [];
  const hit = rawList.find((item) => String(item.word || "").toLowerCase() === w);
  if (hit) {
    return {
      word: hit.word,
      ipa: hit.ipa || `/${hit.word}/`,
      partOfSpeech: hit.pos || "重点词",
      definition: hit.def || hit.definition || "核心释义",
      explanation: hit.mne || (hit.sen ? `例: ${hit.sen}` : "高频核心词汇"),
      sentence: hit.sen || "",
    };
  }

  const fb = FALLBACK_LEXICON[w];
  if (fb) return { word: w, ...fb };

  return {
    word: w,
    ipa: `/${w}/`,
    partOfSpeech: "重点词",
    definition: "语境重点词汇",
    explanation: "结合短文语境深入理解与记忆。",
  };
}

// 智能分词引擎：支持空格、逗号、分号、换行，并自动剔除混杂的中文注释与符号
function parseWords(input) {
  const raw = String(input || "");
  // 正则提取所有合法的纯英文单词（支持连字符如 state-of-the-art）
  const matches = raw.match(/[A-Za-z]+(?:[-'][A-Za-z]+)*/g) || [];
  const clean = matches
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 1 && !/^(the|and|or|in|on|at|to|a|an|of|for|is|it|by|as)$/i.test(w));
  return [...new Set(clean)].slice(0, 24);
}

function getToday() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

// 动态多题材短文生成引擎（离线/Fallback 模式，绝不死锁固定短文）
function createDemoSession(words, genre = "日常故事", difficulty = "四级", targetWordCount = 120) {
  const safeWords = words.length ? words : ["resilient", "catalyst", "subtle", "emerge"];
  const definitions = safeWords.map(lookupLexicon);

  const titles = {
    "科技观察": [
      `The Science of ${titleCase(safeWords[0])}`,
      `Patterns in Modern Discovery`,
      `The Logic of Innovation`,
      `How Small Steps Bring Progress`
    ],
    "科幻小说": [
      `Echoes in the Starlit City`,
      `Beyond the Silent Orbit`,
      `Chronicles of the New Dawn`,
      `The Voyage to Horizons Unknown`
    ],
    "日常故事": [
      `Morning Thoughts at the Wooden Desk`,
      `The Art of Starting Over`,
      `A Quiet Moment of Learning`,
      `Notes from a Rainy Afternoon`
    ],
    "新闻评论": [
      `A Community Moving Forward`,
      `The True Measure of Practical Change`,
      `Rethinking the Path Ahead`,
      `Voices of Growth and Renewal`
    ],
    "商业洞察": [
      `Building Sustainable Momentum`,
      `The Anatomy of Modern Decisions`,
      `Navigating Uncharted Markets`,
      `From Insight to Execution`
    ]
  };

  const titleList = titles[genre] || titles["日常故事"];
  const title = titleList[Math.floor(Math.random() * titleList.length)];

  // 题材自然开篇
  const openings = {
    "科技观察": "In an era where technology evolves at an unprecedented pace, researchers often find that real breakthroughs do not happen overnight.",
    "科幻小说": "Far across the tranquil twilight expanse of the orbital station, the quiet hum of the atmospheric engines filled the vast study.",
    "日常故事": "On a gentle, sunlit morning, the steam rose slowly from a warm ceramic cup on the oak desk, inviting a period of uninterrupted contemplation.",
    "新闻评论": "Recent developments across our cities remind us that meaningful transformation rarely arrives with loud announcements; it begins in ordinary choices.",
    "商业洞察": "Every long-term endeavor requires not only ambitious vision but also the patience to recognize gradual improvements day by day."
  };

  // 动态将用户输入的单词自然编织到句子中
  const sentences = safeWords.map((word, i) => {
    const W = titleCase(word);
    const patterns = [
      `Learning to remain ${word} during unexpected difficulties allows individuals to see opportunity where others notice only obstacle.`,
      `A single thoughtful conversation can become a true ${word}, igniting enthusiasm across the entire team.`,
      `The effect was remarkably ${word} at the beginning, yet observant minds could perceive the genuine change taking place.`,
      `When patience is maintained through the quiet hours, fresh understanding begins to ${word} naturally.`,
      `Recognizing the value of each ${word} element helps bridge the gap between initial theory and concrete realization.`,
      `Through persistent practice, one's ability to master ${word} ideas develops into second nature.`
    ];
    return patterns[i % patterns.length];
  });

  // 段落结构化组合
  const p1 = openings[genre] || openings["日常故事"];
  const p2 = sentences.slice(0, Math.ceil(sentences.length / 2)).join(" ");
  const p3 = sentences.slice(Math.ceil(sentences.length / 2)).join(" ");
  const p4 = "Ultimately, the habit of steady reflection and purposeful focus shapes our capacity to grow, proving that every deep effort leaves an enduring mark.";

  const bodyParagraphs = [p1, p2, p3, p4].filter(Boolean);
  const body = bodyParagraphs.join("\n\n");

  return {
    id: `reading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: getToday(),
    title,
    body,
    words: safeWords,
    genre,
    difficulty,
    targetWordCount,
    source: "精选情境短文",
    createdAt: new Date().toISOString(),
    definitions,
  };
}

function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("模型没有返回有效的数据结构。");
  const slice = cleaned.slice(start, end + 1);
  return JSON.parse(slice);
}

function normaliseModelResult(payload, params) {
  const rawDefs = Array.isArray(payload.definitions) ? payload.definitions : [];
  const byWord = new Map(rawDefs.map((item) => [String(item.word || "").toLowerCase(), item]));

  return {
    id: `reading-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: getToday(),
    title: String(payload.title || `${titleCase(params.words[0] || 'Insight')} in Focus`).slice(0, 80),
    body: String(payload.body || "").trim(),
    words: params.words,
    genre: params.genre,
    difficulty: params.difficulty,
    targetWordCount: params.targetWordCount,
    source: "AI 深度生成",
    createdAt: new Date().toISOString(),
    definitions: params.words.map((word) => {
      const local = lookupLexicon(word);
      const aiDef = byWord.get(word.toLowerCase()) || {};
      return {
        ...local,
        ...aiDef,
        word,
        ipa: aiDef.ipa || local.ipa,
        partOfSpeech: aiDef.partOfSpeech || local.partOfSpeech,
        definition: aiDef.definition || local.definition,
        explanation: aiDef.explanation || local.explanation,
      };
    }),
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

  const prompt = `Return ONLY compact valid JSON, without markdown code fences. Write an authentic, coherent English article of about ${targetWordCount} words suited for Chinese ${params.difficulty} level students in the ${params.genre} genre. You MUST naturally incorporate the following target words: ${params.words.join(", ")}. In the JSON response, provide a fitting title, body with paragraphs separated by \\n\\n, and a definitions array containing each target word's phonetic IPA, partOfSpeech (in Chinese), concise Chinese definition, and a short explanation. JSON schema: {"title":"string","body":"string","definitions":[{"word":"string","ipa":"string","partOfSpeech":"string","definition":"string","explanation":"string"}]}`;

  const maxTokens = Math.min(1800, Math.max(480, Math.ceil(targetWordCount * 1.8) + params.words.length * 70));
  let response;
  try {
    response = await requestModelApi(baseUrl, "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({ model: settings.model.trim(), temperature: 0.3, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
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

window.LexoraApi = { createDemoSession, detectModels, generateReading, getToday, parseWords, lookupLexicon };
})();


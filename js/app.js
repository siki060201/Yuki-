(() => {
const { createDemoSession, detectModels, generateReading, getToday, parseWords } = window.LexoraApi;
const { storage } = window.LexoraStorage;
const { closeManual, closeWordSheet, elements, openManual, openWordSheet, refreshIcons, renderCalendar, renderHistory, renderReading, renderReadingDirectory, renderRhythm, renderWordInput, setGenerating, showToast, switchView } = window.LexoraUI;

const initialWords = ["resilient", "catalyst", "subtle", "emerge"];
let activeDate = getToday();
let activeSession = storage.getSessionsForDate(activeDate)[0] || createDemoSession(initialWords);
let activeWords = activeSession.words?.length ? activeSession.words : initialWords;
let calendarMonth = new Date();
const WORD_EXTRACTION_PROMPT = [
  "请从我接下来发送的单词本图片或文字中提取英文单词。",
  "只输出可直接粘贴到 Lexora 的纯单词清单：每行一个英文单词，全部小写并去重。",
  "保留单词中的连字符或撇号；忽略中文释义、音标、例句、编号、词性、页码和其他说明。",
  "不要使用 Markdown、表格、标题、序号、代码块或任何额外解释。",
  "每次最多输出 24 个单词；超过时优先输出前的 24 个。",
].join("\n");

function renderAll() {
  const sessions = storage.getSessions();
  const dailySessions = storage.getSessionsForDate(activeDate);
  renderWordInput(activeWords);
  renderReading(activeSession);
  renderReadingDirectory(dailySessions, activeDate, activeSession.id);
  renderRhythm(sessions);
  renderHistory(sessions);
  renderCalendar(sessions, calendarMonth);
}

function syncInput(words = activeWords) {
  activeWords = words;
  elements.wordInput.value = activeWords.join(", ");
  renderWordInput(activeWords);
}

function loadSettingsForm() {
  const settings = storage.getSettings();
  document.querySelector("#api-base-url").value = settings.baseUrl;
  populateModelSelect([], settings.model);
  document.querySelector("#api-key").value = settings.apiKey;
}

function populateModelSelect(models, preferredModel = "") {
  const select = document.querySelector("#api-model");
  const availableModels = [...new Set(models.map((model) => String(model || "").trim()).filter(Boolean))];
  if (preferredModel && !availableModels.includes(preferredModel)) availableModels.unshift(preferredModel);
  select.replaceChildren();

  if (!availableModels.length) {
    const placeholder = new Option("请先点击“检测模型”", "");
    placeholder.disabled = true;
    placeholder.selected = true;
    select.add(placeholder);
    select.disabled = true;
    return "";
  }

  availableModels.forEach((model) => select.add(new Option(model, model)));
  select.disabled = false;
  select.value = availableModels.includes(preferredModel) ? preferredModel : availableModels[0];
  return select.value;
}

function saveSettingsFromForm() {
  const settings = {
    baseUrl: document.querySelector("#api-base-url").value.trim(),
    model: document.querySelector("#api-model").value.trim(),
    apiKey: document.querySelector("#api-key").value.trim(),
  };
  storage.saveSettings(settings);
  return settings;
}

function serialiseCurrentSession() {
  return `${activeSession.title}\n${"=".repeat(activeSession.title.length)}\n\n${activeSession.body}\n\n词表\n${activeSession.definitions.map((item) => `${item.word} ${item.ipa || ""}\n${item.definition || ""}`).join("\n\n")}\n\n题材：${activeSession.genre} · 难度：${activeSession.difficulty}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function pasteApiKey() {
  const input = document.querySelector("#api-key");
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
    const key = (await navigator.clipboard.readText()).trim();
    if (!key) {
      showToast("剪贴板里没有可粘贴的密钥。 ");
      return;
    }
    input.value = key;
    input.focus();
    showToast("密钥已粘贴，请点击保存设置。 ");
  } catch {
    input.focus();
    showToast("无法读取剪贴板，请允许粘贴权限或手动粘贴。 ");
  }
}

async function copySession() {
  await copyText(serialiseCurrentSession());
  showToast("已复制短文和词表。");
}

async function copyExtractionPrompt() {
  await copyText(WORD_EXTRACTION_PROMPT);
  showToast("提取单词提示词已复制。");
}

function exportSession() {
  const blob = new Blob([serialiseCurrentSession()], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `lexora-${activeSession.date}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("TXT 文件已准备下载。");
}

async function generate() {
  activeWords = parseWords(elements.wordInput.value);
  if (!activeWords.length) {
    showToast("先输入至少一个英文单词。 ");
    elements.wordInput.focus();
    return;
  }
  syncInput(activeWords);
  const params = { words: activeWords, genre: elements.genre.value, difficulty: elements.difficulty.value, targetWordCount: Number(elements.articleLength.value) };
  setGenerating(true);
  try {
    const session = await generateReading(params, storage.getSettings());
    activeSession = storage.saveSession(session);
    activeDate = activeSession.date;
    renderAll();
    showToast(session.source === "本地演示" ? "已生成本地演示短文。连接模型后可生成真实 AI 内容。" : "AI 短文已生成并归档。");
  } catch (error) {
    showToast(error.message || "生成失败，请稍后再试。");
  } finally {
    setGenerating(false);
  }
}

function applySession(session) {
  activeSession = session;
  activeDate = session.date;
  activeWords = session.words;
  syncInput(activeWords);
  elements.genre.value = session.genre;
  elements.difficulty.value = session.difficulty;
  elements.articleLength.value = String(session.targetWordCount || 120);
  renderAll();
}

function loadSession(id) {
  const session = storage.getSession(id);
  if (!session) return;
  applySession(session);
  switchView("learn");
  showToast(`已打开《${session.title}》。`);
}

function loadDate(date) {
  const sessions = storage.getSessionsForDate(date);
  if (!sessions.length) return;
  applySession(sessions[0]);
  switchView("learn");
  showToast(`已打开 ${date} 的 ${sessions.length} 篇短文。`);
}

function startNewReading() {
  activeDate = getToday();
  const todaySessions = storage.getSessionsForDate(activeDate);
  activeSession = todaySessions[0] || createDemoSession(
    initialWords,
    elements.genre.value,
    elements.difficulty.value,
    Number(elements.articleLength.value),
  );
  activeWords = [];
  syncInput([]);
  renderAll();
  elements.wordInput.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
  showToast("已新建短文，输入单词后生成。");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.viewTarget) { switchView(target.dataset.viewTarget); return; }
    if (target.dataset.removeWord) { syncInput(activeWords.filter((word) => word !== target.dataset.removeWord)); return; }
    if (target.dataset.loadSession) { loadSession(target.dataset.loadSession); return; }
    if (target.dataset.loadDate) { loadDate(target.dataset.loadDate); return; }
    if (target.classList.contains("word-highlight")) { openWordSheet(target.dataset.word, activeSession); }
  });

  elements.wordInput.addEventListener("input", () => {
    activeWords = parseWords(elements.wordInput.value);
    renderWordInput(activeWords);
  });
  document.querySelector("#clear-words").addEventListener("click", () => syncInput([]));
  document.querySelector("#new-reading-button").addEventListener("click", startNewReading);
  document.querySelector("#generate-button").addEventListener("click", generate);
  document.querySelector("#copy-extraction-prompt").addEventListener("click", copyExtractionPrompt);
  document.querySelector("#copy-button").addEventListener("click", copySession);
  document.querySelector("#export-button").addEventListener("click", exportSession);
  document.querySelector("#close-sheet").addEventListener("click", closeWordSheet);
  elements.sheetBackdrop.addEventListener("click", closeWordSheet);
  document.querySelector("#open-manual").addEventListener("click", openManual);
  document.querySelector("#close-manual").addEventListener("click", closeManual);
  elements.manualBackdrop.addEventListener("click", closeManual);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeWordSheet(); closeManual(); } });

  document.querySelector("#calendar-prev").addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(storage.getSessions(), calendarMonth); });
  document.querySelector("#calendar-next").addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(storage.getSessions(), calendarMonth); });

  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    saveSettingsFromForm();
    showToast("设置已保存在当前浏览器。 ");
  });
  document.querySelector("#toggle-api-key").addEventListener("click", () => {
    const input = document.querySelector("#api-key");
    input.type = input.type === "password" ? "text" : "password";
    document.querySelector("#toggle-api-key").innerHTML = input.type === "password" ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
    refreshIcons();
  });
  document.querySelector("#paste-api-key").addEventListener("click", pasteApiKey);
  document.querySelector("#test-connection").addEventListener("click", async () => {
    const button = document.querySelector("#test-connection");
    const settings = saveSettingsFromForm();
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle" class="is-spinning"></i><span>正在检测</span>';
    refreshIcons();
    try {
      const result = await detectModels(settings);
      document.querySelector("#api-base-url").value = result.baseUrl;
      const selectedModel = populateModelSelect(result.models, settings.model);
      storage.saveSettings({ ...settings, baseUrl: result.baseUrl, model: selectedModel });
      showToast(`已检测到 ${result.models.length} 个模型，请在下拉框中选择。`);
    } catch (error) {
      showToast(error.message || "连接失败。 ");
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="plug-zap"></i><span>检测模型</span>';
      refreshIcons();
    }
  });
}

function init() {
  syncInput(activeWords);
  loadSettingsForm();
  renderAll();
  bindEvents();
  refreshIcons();
}

init();
})();

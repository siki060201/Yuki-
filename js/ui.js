(() => {
const $ = (selector) => document.querySelector(selector);

const elements = {
  pageTitle: $("#page-title"),
  pageKicker: $("#page-kicker"),
  wordInput: $("#word-input"),
  wordChips: $("#word-chips"),
  wordCount: $("#word-count"),
  genre: $("#genre-select"),
  difficulty: $("#difficulty-select"),
  articleLength: $("#article-length-select"),
  articleSource: $("#article-source"),
  articleDate: $("#article-date"),
  articleTitle: $("#article-title"),
  articleMeta: $("#article-meta"),
  articleBody: $("#article-body"),
  streakCount: $("#streak-count"),
  weekCompleted: $("#week-completed"),
  weekStrip: $("#week-strip"),
  readingDirectoryDate: $("#reading-directory-date"),
  readingDirectoryCount: $("#reading-directory-count"),
  readingDirectory: $("#reading-directory"),
  historyList: $("#history-list"),
  calendarLabel: $("#calendar-label"),
  calendarGrid: $("#calendar-grid"),
  archiveSummary: $("#archive-summary"),
  archiveList: $("#archive-list"),
  sheet: $("#word-sheet"),
  sheetBackdrop: $("#sheet-backdrop"),
  sheetWord: $("#sheet-word"),
  sheetIpa: $("#sheet-ipa"),
  sheetPart: $("#sheet-part"),
  sheetDefinition: $("#sheet-definition"),
  sheetContext: $("#sheet-context"),
  sheetExplanation: $("#sheet-explanation"),
  manual: $("#manual-sheet"),
  manualBackdrop: $("#manual-backdrop"),
  toast: $("#toast"),
};

let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function formatDate(date, options = { month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat("zh-CN", options).format(new Date(`${date}T12:00:00`));
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function createHighlightedHtml(text, words) {
  const usable = words.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!usable.length) return escapeHtml(text);
  const escapedWords = usable.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`\\b(${escapedWords.join("|")})\\b`, "gi");
  let last = 0;
  let html = "";
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(last, match.index));
    html += `<button class="word-highlight" type="button" data-word="${escapeHtml(match[0].toLowerCase())}">${escapeHtml(match[0])}</button>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

function sentenceForWord(body, word) {
  const sentence = body.split(/(?<=[.!?])\s+/).find((item) => item.toLowerCase().includes(word.toLowerCase()));
  return sentence || body.split("\n").find(Boolean) || "在短文中点击单词，查看它的用法。";
}

function refreshIcons() {
  window.lucide?.createIcons?.();
}

function renderWordInput(words) {
  elements.wordCount.textContent = `${words.length} 个`;
  elements.wordChips.innerHTML = words.map((word) => `<span class="word-chip">${escapeHtml(word)}<button type="button" data-remove-word="${escapeHtml(word)}" title="移除 ${escapeHtml(word)}" aria-label="移除 ${escapeHtml(word)}"><i data-lucide="x"></i></button></span>`).join("");
  refreshIcons();
}

function renderReading(session) {
  elements.articleSource.textContent = session.source;
  elements.articleDate.textContent = session.date === new Date().toISOString().slice(0, 10) ? "今日短文" : `历史记录 · ${session.date}`;
  elements.articleTitle.textContent = session.title;
  elements.articleMeta.textContent = `${session.difficulty} · ${session.words.length} 个词 · ${Math.max(1, Math.ceil(session.body.split(/\s+/).filter(Boolean).length / 150))} 分钟`;
  elements.articleBody.innerHTML = session.body.split(/\n{2,}/).map((paragraph) => `<p>${createHighlightedHtml(paragraph, session.words)}</p>`).join("");
}

function renderReadingDirectory(sessions, date, activeSessionId) {
  const isToday = date === formatKey(new Date());
  elements.readingDirectoryDate.textContent = isToday ? "今日目录" : `${formatDate(date, { year: "numeric", month: "long", day: "numeric" })}目录`;
  elements.readingDirectoryCount.textContent = `${sessions.length} 篇`;
  elements.readingDirectory.innerHTML = sessions.length
    ? sessions.map((session) => {
      const details = [formatTime(session.createdAt), `${session.words.length} 个词`].filter(Boolean).join(" · ");
      return `<button type="button" class="reading-directory-item ${session.id === activeSessionId ? "is-active" : ""}" data-load-session="${escapeHtml(session.id)}"><strong>${escapeHtml(session.title)}</strong><span>${details}</span></button>`;
    }).join("")
    : '<p class="history-empty">当前日期还没有短文。</p>';
}

function mondayOf(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(12, 0, 0, 0);
  return result;
}

function formatKey(date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function calculateStreak(sessions) {
  const dates = new Set(sessions.map((session) => session.date));
  let cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (!dates.has(formatKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (dates.has(formatKey(cursor))) { count += 1; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

function renderRhythm(sessions) {
  const sessionDates = new Set(sessions.map((session) => session.date));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = mondayOf(today);
  const labels = ["一", "二", "三", "四", "五", "六", "日"];
  let complete = 0;
  elements.weekStrip.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = formatKey(date);
    const isDone = sessionDates.has(key);
    if (isDone) complete += 1;
    const isToday = key === formatKey(today);
    return `<div class="week-day ${isDone ? "is-complete" : ""} ${isToday ? "is-today" : ""}"><span>${labels[index]}</span><span class="week-dot">${isDone ? '<i data-lucide="check"></i>' : date.getDate()}</span></div>`;
  }).join("");
  elements.weekCompleted.textContent = `${complete}/7`;
  elements.streakCount.textContent = calculateStreak(sessions);
  refreshIcons();
}

function renderHistory(sessions) {
  const recent = sessions.slice(0, 4);
  elements.historyList.innerHTML = recent.length
    ? recent.map((session) => `<button type="button" class="history-item" data-load-session="${escapeHtml(session.id)}"><strong>${escapeHtml(session.title)}</strong><span>${formatDate(session.date)} · ${session.words.length} 个词</span></button>`).join("")
    : '<p class="history-empty">完成一次学习后，记录会出现在这里。</p>';
}

function renderCalendar(sessions, monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const sessionsByDate = new Map();
  sessions.forEach((session) => sessionsByDate.set(session.date, (sessionsByDate.get(session.date) || 0) + 1));
  const first = new Date(year, month, 1);
  const dayOffset = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = formatKey(new Date());
  elements.calendarLabel.textContent = `${year} 年 ${month + 1} 月`;
  const blanks = Array.from({ length: dayOffset }, () => '<div class="calendar-day is-blank"></div>');
  const dayButtons = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month, day, 12);
    const key = formatKey(date);
    const count = sessionsByDate.get(key) || 0;
    return `<button type="button" class="calendar-day ${count ? "has-session" : ""} ${key === today ? "is-today" : ""}" ${count ? `data-load-date="${key}" title="打开 ${key} 的 ${count} 篇短文"` : "disabled"}>${day}</button>`;
  });
  elements.calendarGrid.innerHTML = [...blanks, ...dayButtons].join("");
  const totalWords = sessions.reduce((sum, session) => sum + session.words.length, 0);
  elements.archiveSummary.innerHTML = `<span class="summary-chip">${sessions.length} 次学习</span><span class="summary-chip">${totalWords} 个单词</span>`;
  elements.archiveList.innerHTML = sessions.length
    ? sessions.map((session) => `<button type="button" class="archive-item" data-load-session="${escapeHtml(session.id)}"><strong>${escapeHtml(session.title)}</strong><span>${formatDate(session.date, { year: "numeric", month: "long", day: "numeric" })} · ${escapeHtml(session.genre)} · ${session.words.length} 个词</span></button>`).join("")
    : '<p class="history-empty">还没有归档。生成第一篇短文后会自动记录。</p>';
}

function openWordSheet(word, session) {
  const definition = session.definitions.find((item) => item.word.toLowerCase() === word.toLowerCase()) || { word, ipa: `/${word}/`, partOfSpeech: "词性待定", definition: "暂无释义", explanation: "请连接模型后重新生成。" };
  elements.sheetWord.textContent = definition.word;
  elements.sheetIpa.textContent = definition.ipa || "—";
  elements.sheetPart.textContent = definition.partOfSpeech || "词性待定";
  elements.sheetDefinition.textContent = definition.definition || "暂无释义";
  elements.sheetContext.textContent = sentenceForWord(session.body, word);
  elements.sheetExplanation.textContent = definition.explanation || "在短文语境中观察这个词的具体含义。";
  elements.sheetBackdrop.hidden = false;
  elements.sheet.hidden = false;
  requestAnimationFrame(() => elements.sheet.querySelector(".icon-button").focus());
}

function closeWordSheet() {
  elements.sheet.hidden = true;
  elements.sheetBackdrop.hidden = true;
}

function openManual() {
  elements.manualBackdrop.hidden = false;
  elements.manual.hidden = false;
  requestAnimationFrame(() => document.querySelector("#close-manual").focus());
}

function closeManual() {
  elements.manual.hidden = true;
  elements.manualBackdrop.hidden = true;
}

function switchView(view) {
  const labels = { learn: ["持续学习", "今日学习"], calendar: ["学习档案", "学习日历"], settings: ["本机模型", "模型设置"] };
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
  document.querySelectorAll("[data-view-target]").forEach((item) => item.classList.toggle("is-active", item.dataset.viewTarget === view));
  [elements.pageKicker.textContent, elements.pageTitle.textContent] = labels[view];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setGenerating(isGenerating) {
  const button = document.querySelector("#generate-button");
  button.disabled = isGenerating;
  button.innerHTML = isGenerating ? '<i data-lucide="loader-circle" class="is-spinning"></i><span>正在生成…</span>' : '<i data-lucide="wand-sparkles"></i><span>生成今日短文</span>';
  refreshIcons();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3300);
}

window.LexoraUI = {
  closeManual,
  closeWordSheet,
  elements,
  openManual,
  openWordSheet,
  refreshIcons,
  renderCalendar,
  renderHistory,
  renderReading,
  renderReadingDirectory,
  renderRhythm,
  renderWordInput,
  setGenerating,
  showToast,
  switchView,
};
})();

(() => {
const STORAGE_KEY = "lexora.browser-data.v1";

const defaultData = {
  settings: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "",
    apiKey: "",
  },
  sessions: [],
};

function createSessionId() {
  return globalThis.crypto?.randomUUID?.() || `reading-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normaliseSession(session, index) {
  const fallbackId = `legacy-${session?.date || "unknown"}-${session?.createdAt || index}`;
  return { ...session, id: String(session?.id || fallbackId) };
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function read() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return structuredClone(defaultData);
    const parsed = JSON.parse(saved);
    return {
      ...structuredClone(defaultData),
      ...parsed,
      settings: { ...defaultData.settings, ...(parsed.settings || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normaliseSession) : [],
    };
  } catch {
    return structuredClone(defaultData);
  }
}

function write(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

const storage = {
  getSettings() {
    return read().settings;
  },

  saveSettings(settings) {
    const data = read();
    data.settings = { ...data.settings, ...settings };
    write(data);
    return data.settings;
  },

  getSessions() {
    return sortSessions(read().sessions);
  },

  getSessionsForDate(date) {
    return sortSessions(read().sessions.filter((session) => session.date === date));
  },

  getSession(id) {
    return read().sessions.find((session) => session.id === id) || null;
  },

  saveSession(session) {
    const data = read();
    const savedSession = normaliseSession({ ...session, id: session.id || createSessionId() }, data.sessions.length);
    const index = data.sessions.findIndex((item) => item.id === savedSession.id);
    if (index >= 0) data.sessions[index] = savedSession;
    else data.sessions.push(savedSession);
    write(data);
    return savedSession;
  },
};

window.LexoraStorage = { storage };
})();

(() => {
const STORAGE_KEY = "lexora.browser-data.v1";

const defaultData = {
  settings: {
    baseUrl: "https://integrate.api.nvidia.com/v1",
    model: "",
    apiKey: "",
  },
  dailyGoal: 20,
  cloudAuth: {
    serverUrl: "",
    token: "",
    username: "",
    lastSyncTime: ""
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
      dailyGoal: typeof parsed.dailyGoal === 'number' && parsed.dailyGoal > 0 ? parsed.dailyGoal : 20,
      cloudAuth: { ...defaultData.cloudAuth, ...(parsed.cloudAuth || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normaliseSession) : [],
    };
  } catch {
    return structuredClone(defaultData);
  }
}

function write(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getShiftedDate(baseDateStr, daysDelta = -1) {
  const d = baseDateStr ? new Date(baseDateStr + 'T12:00:00') : new Date();
  d.setDate(d.getDate() + daysDelta);
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${day}`;
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

  getDailyGoal() {
    return read().dailyGoal || 20;
  },

  setDailyGoal(goal) {
    const data = read();
    const g = Math.max(3, Math.min(100, parseInt(goal, 10) || 20));
    data.dailyGoal = g;
    write(data);
    return g;
  },

  getCloudAuth() {
    return read().cloudAuth || {};
  },

  saveCloudAuth(auth) {
    const data = read();
    data.cloudAuth = { ...data.cloudAuth, ...auth };
    write(data);
    return data.cloudAuth;
  },

  getSessions() {
    return sortSessions(read().sessions);
  },

  getSessionsForDate(date) {
    return sortSessions(read().sessions.filter((session) => session.date === date));
  },

  // 获取指定日期的背词记录词汇（去重）
  getTodayLearnedWords(dateStr) {
    const today = dateStr || new Date().toISOString().slice(0, 10);
    const sessions = this.getSessionsForDate(today);
    const wordSet = new Set();
    const wordDetails = [];

    sessions.filter(s => s.type === 'study' || s.genre === '背词打卡').forEach(s => {
      (s.words || []).forEach(w => {
        if (w && !wordSet.has(w.toLowerCase())) {
          wordSet.add(w.toLowerCase());
          const defObj = (s.definitions || []).find(d => d.word.toLowerCase() === w.toLowerCase());
          wordDetails.push(defObj || { word: w });
        }
      });
    });

    return {
      count: wordSet.size,
      words: Array.from(wordSet),
      details: wordDetails
    };
  },

  // 获取昨日学习词汇（按艾宾浩斯曲线，若昨日无记录则智能向前回溯至多3天）
  getYesterdayWords(todayStr) {
    const today = todayStr || new Date().toISOString().slice(0, 10);
    let targetDate = getShiftedDate(today, -1);
    let sessions = this.getSessionsForDate(targetDate);

    // 如果昨天刚好没打卡，尝试回溯前天或前3天
    if (!sessions.some(s => s.type === 'study' || s.genre === '背词打卡')) {
      for (let delta = -2; delta >= -3; delta--) {
        const d = getShiftedDate(today, delta);
        const check = this.getSessionsForDate(d);
        if (check.some(s => s.type === 'study' || s.genre === '背词打卡')) {
          targetDate = d;
          sessions = check;
          break;
        }
      }
    }

    const wordMap = new Map();
    sessions.filter(s => s.type === 'study' || s.genre === '背词打卡').forEach(s => {
      (s.words || []).forEach(w => {
        if (w && !wordMap.has(w.toLowerCase())) {
          const defObj = (s.definitions || []).find(d => d.word.toLowerCase() === w.toLowerCase());
          wordMap.set(w.toLowerCase(), defObj || { word: w });
        }
      });
    });

    return {
      date: targetDate,
      count: wordMap.size,
      words: Array.from(wordMap.values())
    };
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

  // 全量导出本地数据（用于云端同步或手动备份）
  exportAllData() {
    return read();
  },

  // 全量/合并导入数据
  importAllData(incomingData, mergeMode = 'merge') {
    if (!incomingData || typeof incomingData !== 'object') return false;
    const current = read();
    let newSessions = [];

    if (mergeMode === 'overwrite') {
      newSessions = Array.isArray(incomingData.sessions) ? incomingData.sessions.map(normaliseSession) : [];
    } else {
      // 智能时间戳合并
      const existingMap = new Map(current.sessions.map(s => [s.id, s]));
      (incomingData.sessions || []).forEach(item => {
        const norm = normaliseSession(item);
        if (!existingMap.has(norm.id)) {
          existingMap.set(norm.id, norm);
        } else {
          // 以更新的 createdAt 或更新的内容为准
          const exist = existingMap.get(norm.id);
          if ((norm.createdAt || '') > (exist.createdAt || '')) {
            existingMap.set(norm.id, norm);
          }
        }
      });
      newSessions = Array.from(existingMap.values());
    }

    const merged = {
      ...current,
      dailyGoal: incomingData.dailyGoal || current.dailyGoal,
      settings: { ...current.settings, ...(incomingData.settings || {}) },
      sessions: sortSessions(newSessions)
    };

    write(merged);
    return true;
  }
};

window.LexoraStorage = { storage };
})();

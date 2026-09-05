// js/sync.js · Lexora 多端云同步与用户鉴权通信引擎
(() => {
  const { storage } = window.LexoraStorage || {};

  let syncState = 'offline'; // 'offline' | 'syncing' | 'synced' | 'error'
  let syncListeners = [];

  function notifySyncChange(detail = {}) {
    syncListeners.forEach(fn => {
      try { fn(syncState, detail); } catch (e) {}
    });
    window.dispatchEvent(new CustomEvent('cloudsyncstatechange', { detail: { state: syncState, ...detail } }));
  }

  function onSyncStateChange(fn) {
    if (typeof fn === 'function') syncListeners.push(fn);
  }

  function cleanUrl(url) {
    let u = (url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) {
      if (u.includes('localhost') || u.includes('127.0.0.1') || u.includes(':3000') || u.includes(':8080')) {
        u = 'http://' + u;
      } else {
        u = 'https://' + u;
      }
    }
    return u;
  }

  function getDefaultServerUrl() {
    const auth = storage?.getCloudAuth() || {};
    const settings = storage?.getSettings() || {};
    if (auth.serverUrl) return cleanUrl(auth.serverUrl);
    if (settings.syncServerUrl) return cleanUrl(settings.syncServerUrl);
    if (typeof window !== 'undefined' && window.location?.origin && window.location.origin.startsWith('http')) {
      const port = window.location.port;
      if (['8080', '5500', '5173', '8000'].includes(port)) {
        return 'http://localhost:3000';
      }
      return window.location.origin;
    }
    return 'http://localhost:3000';
  }

  async function request(endpoint, options = {}, serverUrl = null) {
    const baseUrl = cleanUrl(serverUrl || getDefaultServerUrl());
    if (!baseUrl) throw new Error('未配置云端服务器地址');

    const auth = storage?.getCloudAuth() || {};
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (auth.token) {
      headers['Authorization'] = 'Bearer ' + auth.token;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
      const res = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal
      });
      clearTimeout(timeout);

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(text || `服务器返回状态异常 (${res.status})`);
      }

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || json.message || `请求失败 (${res.status})`);
      }
      return json;
    } catch (err) {
      clearTimeout(timeout);
      // 本地静态开发环境 (如 8080/5500) 自动回退尝试本地专用同步端口 3000
      if (!serverUrl && (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) && !baseUrl.includes(':3000')) {
        try {
          return await request(endpoint, options, 'http://localhost:3000');
        } catch (fallbackErr) {}
      }
      if (err.name === 'AbortError') {
        throw new Error('网络请求超时，请检查服务器连接');
      }
      throw err;
    }
  }

  // 1. 用户登录：仅需账号和密码，自动完成云端数据保存与合并
  async function login(username, password, serverUrl = null) {
    // 兼容历史传参顺序 (serverUrl, username, password)
    let u = username, p = password, s = serverUrl;
    if (typeof p === 'string' && typeof s === 'string' && (u.includes('http') || u.includes('/') || u.includes(':'))) {
      s = username;
      u = password;
      p = serverUrl;
    }
    const finalServer = cleanUrl(s || getDefaultServerUrl());
    if (!u || !p) throw new Error('请完整填写账号与密码');

    syncState = 'syncing';
    notifySyncChange({ message: '正在登录账号...' });

    try {
      const res = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p })
      }, finalServer);

      const authData = {
        serverUrl: finalServer,
        token: res.token,
        username: res.username || u,
        lastSyncTime: new Date().toISOString()
      };
      storage?.saveCloudAuth(authData);

      // 登录后自动触发双向同步：云端和本地数据自动合并保存
      await syncNow();

      syncState = 'synced';
      notifySyncChange({ message: '登录成功，账号数据已自动保存至云端' });
      return { success: true, username: authData.username };
    } catch (e) {
      syncState = 'error';
      notifySyncChange({ error: e.message });
      throw e;
    }
  }

  // 2. 账号注册：仅需账号和密码，自动将当前数据上传保存至云端
  async function register(username, password, serverUrl = null) {
    let u = username, p = password, s = serverUrl;
    if (typeof p === 'string' && typeof s === 'string' && (u.includes('http') || u.includes('/') || u.includes(':'))) {
      s = username;
      u = password;
      p = serverUrl;
    }
    const finalServer = cleanUrl(s || getDefaultServerUrl());
    if (!u || !p) throw new Error('请完整填写账号与密码');

    syncState = 'syncing';
    notifySyncChange({ message: '正在注册云端账号...' });

    try {
      const res = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: u, password: p })
      }, finalServer);

      const authData = {
        serverUrl: finalServer,
        token: res.token,
        username: res.username || u,
        lastSyncTime: new Date().toISOString()
      };
      storage?.saveCloudAuth(authData);

      // 注册后自动把当前本地学习数据推送到云端初始化保存
      await pushData();

      syncState = 'synced';
      notifySyncChange({ message: '注册成功，数据已自动保存至云端' });
      return { success: true, username: authData.username };
    } catch (e) {
      syncState = 'error';
      notifySyncChange({ error: e.message });
      throw e;
    }
  }

  // 3. 退出登录
  function logout() {
    const prev = storage?.getCloudAuth() || {};
    storage?.saveCloudAuth({
      serverUrl: prev.serverUrl || '',
      token: '',
      username: '',
      lastSyncTime: ''
    });
    syncState = 'offline';
    notifySyncChange({ message: '已切换为本地离线模式' });
  }

  // 4. 推送本地数据到云端
  async function pushData() {
    const auth = storage?.getCloudAuth() || {};
    if (!auth.token || !auth.serverUrl) return;

    const localPayload = storage?.exportAllData() || {};
    const res = await request('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify({
        data: localPayload,
        clientUpdatedAt: new Date().toISOString()
      })
    });

    const now = res.syncedAt || new Date().toISOString();
    storage?.saveCloudAuth({ lastSyncTime: now });
    return res;
  }

  // 5. 从云端拉取并智能合并
  async function pullData() {
    const auth = storage?.getCloudAuth() || {};
    if (!auth.token || !auth.serverUrl) return;

    const res = await request('/api/sync/pull', { method: 'GET' });
    if (res.data) {
      storage?.importAllData(res.data, 'merge');
    }
    return res;
  }

  // 6. 双向智能合并同步
  async function syncNow() {
    const auth = storage?.getCloudAuth() || {};
    if (!auth.token || !auth.serverUrl) {
      syncState = 'offline';
      notifySyncChange();
      return;
    }

    syncState = 'syncing';
    notifySyncChange({ message: '正在同步云端数据...' });

    try {
      // 先拉取云端合并本地，再将合并后的全集推给云端，实现双向一致
      await pullData();
      await pushData();

      syncState = 'synced';
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      notifySyncChange({ message: `同步完成 (${nowStr})` });
    } catch (e) {
      syncState = 'error';
      notifySyncChange({ error: e.message });
      console.warn('Cloud Sync Error:', e);
      throw e;
    }
  }

  let autoSaveTimer = null;
  function autoSave(delay = 1200) {
    const auth = storage?.getCloudAuth() || {};
    if (!auth.token) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      pushData().catch(e => console.warn('自动同步数据至云端失败:', e));
    }, delay);
  }

  // 初始化检查
  function init() {
    const auth = storage?.getCloudAuth() || {};
    if (auth.token && auth.serverUrl) {
      syncState = 'synced';
      setTimeout(() => {
        syncNow().catch(() => {});
      }, 1500);
    } else {
      syncState = 'offline';
    }
    notifySyncChange();
  }

  window.LexoraSync = {
    login,
    register,
    logout,
    pushData,
    pullData,
    syncNow,
    autoSave,
    isLoggedIn: () => Boolean(storage?.getCloudAuth()?.token),
    onSyncStateChange,
    getState: () => syncState,
    getAuth: () => storage?.getCloudAuth() || {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

/**
 * server/cloudflare-worker.js · Yuki 自习室 云端服务 (Cloudflare Workers + KV)
 *
 * 职责
 *  1. 静态站点托管 (ASSETS 绑定)
 *  2. 账号体系：注册 / 登录 / 退出，Token 30 天自动过期，登录失败限流
 *  3. 学习数据推拉同步 (KV)
 *  4. 模型接口同源代理：/api/models、/api/chat/completions
 *     浏览器直连第三方模型接口会被 CORS 拦截，前端用 X-Lexora-Upstream 指定上游，Worker 转发。
 *
 * 密码方案（服务端零重计算，兼顾免费版 10ms CPU 限制）
 *  - 浏览器端先做 PBKDF2-SHA256(password, "yuki:" + username, 200000 轮) 得到 authKey
 *  - 服务端只存 SHA-256(随机盐 + authKey)，盐每用户独立
 *  - 数据库泄露后离线破解每次尝试都要付出 20 万轮 PBKDF2 的代价
 *  - 旧版 (SHA-256 + 固定盐) 账号首次登录时自动升级到新方案
 *
 * 环境变量（可选）
 *  - PROXY_ALLOWED_HOSTS  逗号分隔的上游域名白名单；不设则允许任意公网 https 域名
 */

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const LOGIN_FAIL_LIMIT = 12;
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;
const SYNC_BODY_LIMIT = 2 * 1024 * 1024;
const PROXY_BODY_LIMIT = 256 * 1024;
const LEGACY_SALT = '_lexora_salt_2026';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Lexora-Upstream',
  'Access-Control-Max-Age': '86400',
};

const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normaliseUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidUsername(u) {
  return /^[a-z0-9_\-一-龥]{2,24}$/.test(u);
}

function isValidAuthKey(k) {
  return /^[a-f0-9]{64}$/i.test(String(k || ''));
}

function isPrivateHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (env.ASSETS && !path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    const error = (msg, status = 400, extra = {}) => json({ error: msg, ...extra }, status);

    // ---------- 模型接口代理 ----------
    if (path === '/api/models' || path === '/api/chat/completions') {
      return proxyModelRequest(request, path, env, error);
    }

    const KV = env.LEXORA_KV;
    if (!KV) return error('未绑定 LEXORA_KV 命名空间，请在 Cloudflare Worker 设置中绑定 KV', 500);

    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    async function readJson(limit = SYNC_BODY_LIMIT) {
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > limit) throw new Error('请求体过大');
      const text = await request.text();
      if (text.length > limit) throw new Error('请求体过大');
      return text ? JSON.parse(text) : {};
    }

    async function failCount(ip) {
      return Number(await KV.get(`rl:${ip}`)) || 0;
    }
    async function recordFailure(ip) {
      const n = (await failCount(ip)) + 1;
      await KV.put(`rl:${ip}`, String(n), { expirationTtl: LOGIN_FAIL_WINDOW_SECONDS });
    }

    async function issueToken(username) {
      const token = randomHex(24);
      await KV.put(`token:${token}`, username, { expirationTtl: TOKEN_TTL_SECONDS });
      return token;
    }

    async function storeCredential(user, authKey) {
      user.salt = randomHex(16);
      user.hash = await sha256Hex(user.salt + authKey);
      user.scheme = 'pbkdf2-client-v1';
      delete user.pwdHash;
      delete user.token;
      return user;
    }

    try {
      // ---------- 注册 ----------
      if (path === '/api/auth/register' && request.method === 'POST') {
        if ((await failCount(clientIp)) >= LOGIN_FAIL_LIMIT) return error('操作过于频繁，请 15 分钟后再试', 429);
        const body = await readJson(16 * 1024);
        const u = normaliseUsername(body.username);
        if (!isValidUsername(u)) return error('用户名需为 2~24 位字母、数字、下划线或中文');
        if (!isValidAuthKey(body.authKey)) return error('客户端凭证格式无效，请刷新页面重试');

        if (await KV.get(`user:${u}`)) return error('该用户名已被占用');

        const user = await storeCredential({ username: u, createdAt: new Date().toISOString() }, body.authKey);
        await KV.put(`user:${u}`, JSON.stringify(user));
        const token = await issueToken(u);
        return json({ success: true, token, username: u, expiresIn: TOKEN_TTL_SECONDS });
      }

      // ---------- 登录 ----------
      if (path === '/api/auth/login' && request.method === 'POST') {
        if ((await failCount(clientIp)) >= LOGIN_FAIL_LIMIT) return error('登录失败次数过多，请 15 分钟后再试', 429);
        const body = await readJson(16 * 1024);
        const u = normaliseUsername(body.username);
        const user = u ? await KV.get(`user:${u}`, 'json') : null;
        if (!user) {
          await recordFailure(clientIp);
          return error('用户不存在或密码错误', 401);
        }

        let ok = false;
        if (user.scheme === 'pbkdf2-client-v1') {
          if (!isValidAuthKey(body.authKey)) return error('客户端凭证格式无效，请刷新页面重试');
          ok = timingSafeEqual(await sha256Hex(user.salt + body.authKey), user.hash);
        } else if (user.pwdHash) {
          // 旧版账号：需要一次明文密码完成升级
          if (typeof body.password !== 'string') {
            return error('账号需要升级安全方案', 409, { code: 'LEGACY_UPGRADE' });
          }
          ok = timingSafeEqual(await sha256Hex(body.password + LEGACY_SALT), user.pwdHash);
          if (ok) {
            if (!isValidAuthKey(body.authKey)) return error('客户端凭证格式无效，请刷新页面重试');
            await storeCredential(user, body.authKey);
            user.upgradedAt = new Date().toISOString();
            await KV.put(`user:${u}`, JSON.stringify(user));
          }
        }

        if (!ok) {
          await recordFailure(clientIp);
          return error('用户不存在或密码错误', 401);
        }

        const token = await issueToken(u);
        return json({ success: true, token, username: u, expiresIn: TOKEN_TTL_SECONDS });
      }

      // ---------- 以下接口需登录 ----------
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!token) return error('未登录', 401);
      // 新版 token 为 48 位 hex；旧版 UUID token（曾随仓库泄漏）一律视为失效，需重新登录
      if (!/^[a-f0-9]{48}$/.test(token)) return error('登录已过期，请重新登录', 401);
      const username = await KV.get(`token:${token}`);
      if (!username) return error('登录已过期，请重新登录', 401);

      if (path === '/api/auth/logout' && request.method === 'POST') {
        await KV.delete(`token:${token}`);
        return json({ success: true });
      }

      if (path === '/api/sync/pull' && request.method === 'GET') {
        const record = await KV.get(`data:${username}`, 'json');
        return json({
          success: true,
          data: record?.data || null,
          updatedAt: record?.updatedAt || null,
          pulledAt: new Date().toISOString(),
        });
      }

      if (path === '/api/sync/push' && request.method === 'POST') {
        const body = await readJson(SYNC_BODY_LIMIT);
        const data = body.data && typeof body.data === 'object' ? body.data : {};
        // 服务端兜底：绝不落盘任何密钥或凭证字段
        if (data.settings) delete data.settings.apiKey;
        delete data.cloudAuth;
        const now = new Date().toISOString();
        await KV.put(`data:${username}`, JSON.stringify({ data, updatedAt: now }));
        return json({ success: true, syncedAt: now });
      }

      return error('接口不存在', 404);
    } catch (e) {
      const msg = e?.message || '服务器内部错误';
      return error(msg, msg === '请求体过大' ? 413 : 500);
    }
  },
};

async function proxyModelRequest(request, path, env, error) {
  const upstream = (request.headers.get('X-Lexora-Upstream') || '').trim();
  if (!upstream) return error('缺少上游接口地址 (X-Lexora-Upstream)');

  let target;
  try {
    target = new URL(upstream.replace(/\/+$/, '') + path.slice('/api'.length));
  } catch {
    return error('上游接口地址无效，请在设置中检查 Base URL');
  }
  if (target.protocol !== 'https:') return error('上游接口必须是 https 地址');
  if (isPrivateHost(target.hostname)) return error('不允许代理到内网或本机地址', 403);

  const allowList = String(env.PROXY_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowList.length && !allowList.some(h => target.hostname === h || target.hostname.endsWith('.' + h))) {
    return error('该上游域名不在允许列表中', 403);
  }

  const method = request.method.toUpperCase();
  if (!['GET', 'POST'].includes(method)) return error('不支持的请求方法', 405);

  let body;
  if (method === 'POST') {
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > PROXY_BODY_LIMIT) return error('请求体过大', 413);
    body = await request.text();
    if (body.length > PROXY_BODY_LIMIT) return error('请求体过大', 413);
  }

  const headers = new Headers();
  for (const name of ['Authorization', 'Content-Type', 'Accept']) {
    const v = request.headers.get(name);
    if (v) headers.set(name, v);
  }
  headers.set('User-Agent', 'YukiStudyRoom/2.0 (+cloudflare-worker)');

  let upstreamRes;
  try {
    upstreamRes = await fetch(target.toString(), { method, headers, body });
  } catch (e) {
    return error(`无法连接上游模型接口：${e.message || '网络异常'}`, 502);
  }

  const respHeaders = new Headers(CORS_HEADERS);
  const type = upstreamRes.headers.get('Content-Type');
  if (type) respHeaders.set('Content-Type', type);
  respHeaders.set('Cache-Control', 'no-store');
  respHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: respHeaders });
}

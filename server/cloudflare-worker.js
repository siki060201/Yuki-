/**
 * server/cloudflare-worker.js
 * 
 * Cloudflare Worker 极简云端同步服务端
 * 支持：用户注册、登录密码校验（SHA-256）、数据推拉同步（基于 Cloudflare KV）
 * 
 * 部署指引：
 * 1. 登录 Cloudflare Dashboard -> Workers & Pages -> Create Worker
 * 2. 将本文件全部代码复制粘贴到 Worker 编辑器中
 * 3. 在 Worker 的 Settings -> Variables -> KV Namespace Bindings 中，
 *    绑定一个名为 LEXORA_KV 的 KV 命名空间
 * 4. 点击 Deploy 部署即可！将生成的 worker 域名填入 YUKI 登录面板。
 */

export default {
  async fetch(request, env, ctx) {
    // 统一 CORS 跨域响应头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const json = (data, status = 200) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    };

    const error = (msg, status = 400) => json({ error: msg }, status);

    // 辅助：哈希密码
    async function hashPassword(pwd) {
      const msgBuffer = new TextEncoder().encode(pwd + '_lexora_salt_2026');
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 辅助：从 Header 提取 Token
    function getToken() {
      const auth = request.headers.get('Authorization') || '';
      if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
      return null;
    }

    // 如果配置了 ASSETS 静态资源托管且请求非 /api/* 接口，直接由 ASSETS 提供静态文件服务
    if (env.ASSETS && !path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const KV = env.LEXORA_KV;
    if (!KV) {
      return error('未检测到 LEXORA_KV 命名空间绑定，请在 Cloudflare Worker 设置中绑定 KV (变量名: LEXORA_KV)', 500);
    }

    try {
      // 1. 注册接口: POST /api/auth/register
      if (path === '/api/auth/register' && request.method === 'POST') {
        const { username, password } = await request.json();
        if (!username || !password) return error('用户名和密码不能为空');
        const u = username.trim().toLowerCase();
        if (u.length < 2) return error('用户名至少2个字符');
        if (password.length < 4) return error('密码至少4位');

        const existing = await KV.get(`user:${u}`, 'json');
        if (existing) return error('该用户名已被占用');

        const pwdHash = await hashPassword(password);
        const token = crypto.randomUUID();
        const userObj = {
          username: u,
          pwdHash,
          token,
          createdAt: new Date().toISOString()
        };

        await KV.put(`user:${u}`, JSON.stringify(userObj));
        await KV.put(`token:${token}`, u);

        return json({ success: true, token, username: u });
      }

      // 2. 登录接口: POST /api/auth/login
      if (path === '/api/auth/login' && request.method === 'POST') {
        const { username, password } = await request.json();
        if (!username || !password) return error('用户名和密码不能为空');
        const u = username.trim().toLowerCase();

        const user = await KV.get(`user:${u}`, 'json');
        if (!user) return error('用户不存在或密码错误', 401);

        const pwdHash = await hashPassword(password);
        if (user.pwdHash !== pwdHash) return error('用户不存在或密码错误', 401);

        const token = crypto.randomUUID();
        user.token = token;
        await KV.put(`user:${u}`, JSON.stringify(user));
        await KV.put(`token:${token}`, u);

        return json({ success: true, token, username: u });
      }

      // 验证鉴权
      const token = getToken();
      if (!token) return error('未授权，请先登录', 401);
      const username = await KV.get(`token:${token}`);
      if (!username) return error('登录凭证已过期或无效，请重新登录', 401);

      // 3. 拉取数据: GET /api/sync/pull
      if (path === '/api/sync/pull' && request.method === 'GET') {
        const data = await KV.get(`data:${username}`, 'json');
        return json({
          success: true,
          data: data || { sessions: [], dailyGoal: 20 },
          pulledAt: new Date().toISOString()
        });
      }

      // 4. 推送数据: POST /api/sync/push
      if (path === '/api/sync/push' && request.method === 'POST') {
        const body = await request.json();
        const incomingData = body.data || {};
        const now = new Date().toISOString();

        await KV.put(`data:${username}`, JSON.stringify(incomingData));
        return json({
          success: true,
          syncedAt: now
        });
      }

      return error('Not Found', 404);
    } catch (e) {
      return error(e.message || 'Worker Internal Server Error', 500);
    }
  }
};

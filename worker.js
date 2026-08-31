const API_ROUTES = {
  "/api/models": { method: "GET", upstreamPath: "/models" },
  "/api/chat/completions": { method: "POST", upstreamPath: "/chat/completions" },
};

function json(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store" },
  });
}

function normaliseUpstream(value) {
  let upstream;
  try {
    upstream = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  if (upstream.protocol !== "https:" || upstream.username || upstream.password) return null;
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(upstream.hostname)) return null;
  return upstream.toString().replace(/\/+$/, "").replace(/\/(?:chat\/completions|models)$/i, "");
}

async function proxyRequest(request, route) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== requestUrl.origin) return json("Cross-origin proxy requests are not allowed.", 403);

  if (request.method !== route.method) return json("Method not allowed.", 405);
  const upstream = normaliseUpstream(request.headers.get("X-Lexora-Upstream"));
  if (!upstream) return json("A valid HTTPS upstream endpoint is required.", 400);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json("An upstream authorization header is required.", 401);

  const headers = new Headers({
    Authorization: authorization,
    Accept: "application/json",
  });
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(`${upstream}${route.upstreamPath}`, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
    });
  } catch {
    return json("The upstream endpoint could not be reached.", 502);
  }

  const responseHeaders = new Headers();
  const responseContentType = upstreamResponse.headers.get("Content-Type");
  if (responseContentType) responseHeaders.set("Content-Type", responseContentType);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = API_ROUTES[url.pathname];
    if (route) return proxyRequest(request, route);

    const response = await env.ASSETS.fetch(request);
    if (url.pathname !== "/" && url.pathname !== "/index.html") return response;

    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, max-age=0");
    headers.set("Clear-Site-Data", '"cache"');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

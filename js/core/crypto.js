/**
 * core/crypto.js · 浏览器端密码派生
 * authKey = PBKDF2-SHA256(password, "yuki:" + username, 200000 轮) → 64 位 hex
 * 服务端只保存 SHA-256(随机盐 + authKey)，永远拿不到明文密码。
 */

export const AUTH_KEY_ITERATIONS = 200000;

const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

export function hasSecureCrypto() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

export async function deriveAuthKey(username, password) {
  if (!hasSecureCrypto()) {
    throw new Error('当前环境不支持安全加密（需通过 HTTPS 或 localhost 访问）');
  }
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('yuki:' + String(username).trim().toLowerCase()), iterations: AUTH_KEY_ITERATIONS },
    baseKey,
    256,
  );
  return toHex(bits);
}

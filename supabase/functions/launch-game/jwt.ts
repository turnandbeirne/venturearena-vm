// Minimal HS256 JWT sign/verify for the game adapter (no external deps)
const enc = new TextEncoder()
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uStr = (s: string) => b64u(enc.encode(s))
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + (4 - s.length % 4) % 4, '=')), c => c.charCodeAt(0))

async function key(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage)
}
export async function sign(payload: Record<string, unknown>, secret: string, ttlSeconds = 7200) {
  const header = b64uStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64uStr(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSeconds }))
  const sig = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), enc.encode(`${header}.${body}`))
  return `${header}.${body}.${b64u(sig)}`
}
export async function verify<T = Record<string, unknown>>(token: string, secret: string): Promise<T> {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) throw new Error('malformed token')
  const ok = await crypto.subtle.verify('HMAC', await key(secret, ['verify']), fromB64u(s), enc.encode(`${h}.${b}`))
  if (!ok) throw new Error('bad signature')
  const payload = JSON.parse(new TextDecoder().decode(fromB64u(b)))
  if (payload.exp && payload.exp < Date.now() / 1000) throw new Error('token expired')
  return payload as T
}

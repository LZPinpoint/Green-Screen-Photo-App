// Same format as cloud/src/id.ts: 128 random bits, base62, 22 chars.
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const SHARE_ID_RE = /^[0-9A-Za-z]{22}$/

export function newShareId(rand: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  let n = 0n
  for (const b of rand(16)) n = (n << 8n) | BigInt(b)
  let out = ''
  while (out.length < 22) { out = ALPHABET[Number(n % 62n)] + out; n /= 62n }
  return out
}

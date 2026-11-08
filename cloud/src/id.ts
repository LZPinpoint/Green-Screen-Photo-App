const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const ID_LENGTH = 22 // 62^22 > 2^128
export const ID_RE = /^[0-9A-Za-z]{22}$/

/** 128 random bits encoded as 22 base62 chars. `rand` is injectable for tests. */
export function newId(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = rand(16)
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let out = ''
  while (out.length < ID_LENGTH) { out = ALPHABET[Number(n % 62n)] + out; n /= 62n }
  return out
}

export function isValidId(id: string): boolean { return ID_RE.test(id) }

export function newKey(prefix: string): string {
  return `${prefix}_${newId()}${newId()}`
}

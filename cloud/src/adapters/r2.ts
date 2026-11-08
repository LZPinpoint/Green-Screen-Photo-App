import type { BlobStore } from '../types'

// Minimal structural types so we don't need @cloudflare/workers-types.
export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>
  delete(key: string): Promise<void>
}

export class R2BlobStore implements BlobStore {
  constructor(private bucket: R2BucketLike) {}
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.bucket.put(key, bytes, { httpMetadata: { contentType } })
  }
  async get(key: string) {
    const o = await this.bucket.get(key)
    if (!o) return null
    return { bytes: new Uint8Array(await o.arrayBuffer()), contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' }
  }
  async delete(key: string) { await this.bucket.delete(key) }
}

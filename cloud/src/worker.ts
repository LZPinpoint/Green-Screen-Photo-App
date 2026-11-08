// Cloudflare Worker entry. Everything real lives in app.ts; this only wires adapters.
import { handle, runRetention } from './app'
import { D1Db, type D1Like } from './adapters/d1'
import { SystemClock } from './adapters/memory'
import { R2BlobStore, type R2BucketLike } from './adapters/r2'
import { configFromEnv } from './context'
import { LogEmailProvider, ResendProvider } from './email/providers'
import type { AppContext, Env } from './types'

interface WorkerEnv extends Env { DB: D1Like; BLOBS: R2BucketLike }

function build(env: WorkerEnv): AppContext {
  const config = configFromEnv(env)
  return {
    blobs: new R2BlobStore(env.BLOBS),
    db: new D1Db(env.DB),
    email: env.RESEND_API_KEY ? new ResendProvider(env.RESEND_API_KEY, config.emailFrom) : new LogEmailProvider(),
    clock: new SystemClock(),
    config,
  }
}

export default {
  fetch(req: Request, env: WorkerEnv): Promise<Response> { return handle(build(env), req) },
  async scheduled(_event: unknown, env: WorkerEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(runRetention(build(env)).then((r) => console.log('retention', JSON.stringify(r))))
  },
}

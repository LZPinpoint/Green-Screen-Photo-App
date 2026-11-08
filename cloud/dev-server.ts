// Zero-account dev / self-host server: plain node http + file blobs + JSON-file DB + emails printed to console.
//   npm run dev        (inside cloud/)
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'
import { handle, runRetention } from './src/app'
import { FileBlobStore } from './src/adapters/file-blob'
import { MemoryDb, SystemClock } from './src/adapters/memory'
import { configFromEnv } from './src/context'
import { sha256Hex } from './src/crypto'
import { LogEmailProvider, ResendProvider } from './src/email/providers'
import type { AppContext, EmailProvider } from './src/types'

export interface DevServerOptions {
  port?: number            // 0 = random
  dataDir?: string | null  // null = no persistence for the db (blobs then go to a temp dir under .dev)
  host?: string
  email?: EmailProvider
  quiet?: boolean
  trustProxy?: boolean
  config?: Partial<ReturnType<typeof configFromEnv>>
}
export interface DevServer {
  server: Server; url: string; ctx: AppContext; close(): Promise<void>
  demo: { venueId: string; apiKey: string; adminKey: string }
  email: EmailProvider
}

export async function startDevServer(opts: DevServerOptions = {}): Promise<DevServer> {
  const dataDir = resolve(opts.dataDir ?? join('.dev', 'data'))
  mkdirSync(dataDir, { recursive: true })
  const db = new MemoryDb()
  const dbFile = join(dataDir, 'db.json')
  try { db.load(JSON.parse(readFileSync(dbFile, 'utf8'))) } catch { /* fresh */ }
  let timer: NodeJS.Timeout | undefined
  if (opts.dataDir !== null) {
    db.onChange = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { writeFileSync(dbFile + '.tmp', JSON.stringify(db.snapshot())); renameSync(dbFile + '.tmp', dbFile) }, 100)
    }
  }
  const env = process.env
  const config = {
    ...configFromEnv({ SIGNING_SECRET: env.SIGNING_SECRET ?? 'dev-only-signing-secret-change-me', ADMIN_KEY: env.ADMIN_KEY ?? 'admin_dev', EMAIL_FROM: env.EMAIL_FROM, PUBLIC_BASE_URL: env.PUBLIC_BASE_URL }),
    ...opts.config,
  }
  const email = opts.email ?? (env.RESEND_API_KEY ? new ResendProvider(env.RESEND_API_KEY, config.emailFrom) : new LogEmailProvider(opts.quiet ? () => {} : undefined))
  const ctx: AppContext = { blobs: new FileBlobStore(join(dataDir, 'blobs')), db, email, clock: new SystemClock(), config }

  const demo = { venueId: 'demo', apiKey: 'bk_dev_demo', adminKey: 'vk_dev_demo' }
  const existing = await db.getVenue(demo.venueId)
  await db.putVenue({
    id: demo.venueId, name: existing?.name ?? 'Museum of Imagination', welcomeText: existing?.welcomeText ?? 'thanks for stepping into the picture. here is your photo!',
    apiKeyHash: await sha256Hex(demo.apiKey), adminKeyHash: await sha256Hex(demo.adminKey),
    retentionDays: existing?.retentionDays ?? 30, optinRetentionDays: existing?.optinRetentionDays ?? 365, createdAt: existing?.createdAt ?? Date.now(),
  })

  const server = createServer(async (req, res) => {
    try {
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
      // Only trust proxy-supplied client IPs when explicitly told to (e.g. behind caddy/nginx).
      if (!(opts.trustProxy ?? env.TRUST_PROXY === '1')) { headers.delete('x-forwarded-for'); headers.set('cf-connecting-ip', req.socket.remoteAddress ?? 'unknown') }
      const origin = `http://${req.headers.host ?? 'localhost'}`
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      const request = new Request(origin + (req.url ?? '/'), {
        method: req.method, headers, ...(hasBody ? { body: Readable.toWeb(req as IncomingMessage) as ReadableStream, duplex: 'half' } : {}),
      } as RequestInit)
      const out = await handle(ctx, request)
      res.writeHead(out.status, Object.fromEntries(out.headers))
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await out.arrayBuffer()))
    } catch (e) {
      console.error(e); if (!res.headersSent) res.writeHead(500); res.end()
    }
  })
  await new Promise<void>((ok) => server.listen(opts.port ?? 8787, opts.host ?? '127.0.0.1', ok))
  const addr = server.address() as { port: number }
  const url = `http://127.0.0.1:${addr.port}`
  const sweep = setInterval(() => { runRetention(ctx).catch(console.error) }, 3_600_000)
  sweep.unref()
  return {
    server, url, ctx, demo, email,
    close: () => new Promise<void>((ok) => { clearInterval(sweep); clearTimeout(timer); server.closeAllConnections?.(); server.close(() => ok()) }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787)
  startDevServer({ port }).then((d) => {
    console.log(`imagine booth cloud (dev) listening on ${d.url}`)
    console.log(`  venue id : ${d.demo.venueId}`)
    console.log(`  api key  : ${d.demo.apiKey}   (booth uploads: Authorization: Bearer ...)`)
    console.log(`  admin key: ${d.demo.adminKey}   (csv export / purge)`)
    console.log(`  data dir : .dev/data   emails: ${d.email.name === 'log' ? 'printed here (set RESEND_API_KEY to really send)' : d.email.name}`)
  })
}

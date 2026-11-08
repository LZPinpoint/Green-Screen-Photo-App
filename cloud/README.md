# imagine booth cloud

Guest delivery for imagine booth: QR code -> branded gallery page, optional email delivery with consent capture,
social sharing. A Cloudflare Worker (R2 for photos, D1 for metadata), **or** the same code on plain node.
Everything external sits behind an interface (`BlobStore`, `Db`, `EmailProvider`, `Clock`), so the whole thing runs and tests with zero accounts.

```
src/app.ts          all handlers (pure: Request -> Response over adapters)
src/adapters/       memory, file-blob, r2, d1
src/email/          LogEmailProvider, ResendProvider, SmtpProvider (stub), branded template
src/html/           server-rendered gallery + message pages (inline CSS, nonce'd script)
src/worker.ts       Cloudflare entry (fetch + scheduled)
dev-server.ts       node http server: file blobs + JSON db + emails printed to console
schema.sql          D1 schema
```

## Try it now (no accounts)
```
cd cloud && npm install && npm run dev
```
Prints a demo venue (`demo`, booth key `bk_dev_demo`, admin key `vk_dev_demo`) and listens on :8787 (`PORT=...` to change).
Data lives in `cloud/.dev/data`. Emails are printed to the console. Point the booth at `http://<this-machine>:8787`.
The dev server reuses the exact same handlers as the Worker.

## API
| Method + path | Auth | Notes |
|---|---|---|
| `PUT /api/v1/venues/:id` `{name, welcomeText?, retentionDays?, optinRetentionDays?, rotateKeys?}` | `ADMIN_KEY` | creates/updates a venue; returns `apiKey` + `adminKey` **once** (stored hashed) |
| `POST /api/v1/sessions` `{venueId, createdAt, scene, layout, id?}` | venue key | -> `{id, uploadUrl, thumbUrl, guestUrl}`. `id` optional: client-proposed 22-char base62, accepted if unused (idempotent retry returns 200) |
| `PUT /api/v1/sessions/:id/image` / `/thumb` | venue key | `image/jpeg` or `image/png`, magic bytes checked, 15 MB cap (thumb 2 MB), idempotent |
| `GET /g/:id` | none | gallery page. `/g/:id/image`, `/g/:id/thumb`, `/g/:id/download` (attachment) |
| `POST /api/v1/sessions/:id/email` `{email, consent, marketingOptIn}` | none (id is the capability) | needs `consent:true`; rate limited (10/h/IP, 5/h/photo); 5 min resend cooldown |
| `DELETE /g/:id` (`x-delete-token`) / `GET+POST /g/:id/delete` | signed token in page | guest delete (no-JS form too) |
| `GET/POST /u/:id/:hash?t=` | signed token | unsubscribe confirm / do |
| `GET /api/v1/venues/:id/optins.csv` | venue admin key or `ADMIN_KEY` | marketing opt-ins only |
| `POST /api/v1/venues/:id/purge` `{all:true}` or `{olderThanDays}` or `{sessionIds}` | admin key | staff erasure |
| scheduled | cron | deletes sessions past retention (blobs + rows + non-marketing emails), marketing opt-ins past `optinRetentionDays` |

IDs are 128-bit random, base62, 22 chars; the link is the access control (like an unlisted share link).

## Env vars / secrets
| Name | Where | Purpose |
|---|---|---|
| `SIGNING_SECRET` (>=16 chars) | secret | HMAC for delete/unsubscribe tokens and email hashing. **Required** |
| `ADMIN_KEY` | secret | global admin: create venues, export/purge any venue |
| `RESEND_API_KEY` | secret | optional; without it emails are only logged |
| `PUBLIC_BASE_URL` | var | public origin used in emails/og tags; defaults to request origin |
| `EMAIL_FROM` | var | e.g. `imagine <photos@yourdomain.org>` (must be a domain verified at your email provider) |
| `PORT`, `TRUST_PROXY=1` | dev-server | listen port; trust `x-forwarded-for` when behind a reverse proxy |

## Deploy on Cloudflare (free plan)
Prereqs: free Cloudflare account, node 20+.
```
cd cloud && npm install
npx wrangler login
npx wrangler r2 bucket create imagine-booth-photos
npx wrangler d1 create imagine-booth            # copy the database_id into wrangler.toml
npm run db:init                                 # applies schema.sql to the remote D1
npx wrangler secret put SIGNING_SECRET          # paste: openssl rand -hex 32
npx wrangler secret put ADMIN_KEY               # paste: openssl rand -hex 24
npx wrangler secret put RESEND_API_KEY          # optional
# edit wrangler.toml: PUBLIC_BASE_URL (your workers.dev URL or custom domain), EMAIL_FROM
npm run deploy
# create your venue (prints the booth key once):
curl -X PUT https://<your-worker>/api/v1/venues/my-museum -H "authorization: Bearer $ADMIN_KEY" \
  -H 'content-type: application/json' -d '{"name":"My Museum","welcomeText":"thanks for visiting!"}'
```
In the booth admin settings enter base URL, venue id, and the booth key. The cron trigger in `wrangler.toml` runs the retention purge daily.
If your account has R2 enabled you may need to add a payment method even for the free allowance; check the R2 pricing page.

### Cost notes (re-verify before relying on any number)
Cloudflare's free tier has historically included: Workers ~100k requests/day, D1 a few GB and millions of reads/day, R2 ~10 GB storage with no egress fees.
Resend's free tier has historically allowed on the order of 100 emails/day. At ~1-3 MB per photo, 10 GB holds several thousand photos, and 30-day retention keeps usage bounded.
**These limits change; check the current Cloudflare and Resend pricing pages before launch.** Nothing here locks you in: see below.

## Self-host with node instead
The dev server is production-capable for small venues: `cd cloud && SIGNING_SECRET=$(openssl rand -hex 32) ADMIN_KEY=... PUBLIC_BASE_URL=https://photos.example.org TRUST_PROXY=1 npm run dev`
behind Caddy/nginx for TLS. Blobs go to `.dev/data/blobs`, metadata to `.dev/data/db.json` (single process; a JSON file, not a database, so fine for thousands of photos, not millions).
Emails: set `RESEND_API_KEY`, or implement `SmtpProvider.send` with nodemailer. Note: the dev venue keys (`bk_dev_demo`) are public knowledge; create your own venue via the admin API and change/delete `demo`.

## Tests
From the repo root: `npx vitest run tests/cloud tests/share`. `d1.test.ts` runs the real SQL against node:sqlite (node 22+).

## Privacy
See `docs/PRIVACY.md` (needs legal review: children, GDPR, COPPA).

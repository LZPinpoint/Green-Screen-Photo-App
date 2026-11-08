import type { EmailMessage, EmailProvider } from '../types'

/** Prints emails (dev / zero-account mode) and remembers them for tests. */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log'
  readonly sent: EmailMessage[] = []
  constructor(private sink: (line: string) => void = (l) => console.log(l)) {}
  async send(msg: EmailMessage) {
    this.sent.push(msg)
    this.sink(`\n--- email (not really sent) ---\nto: ${msg.to}\nsubject: ${msg.subject}\n\n${msg.text}\n-------------------------------\n`)
  }
}

/** Resend (https://resend.com): plain fetch, free tier ~100 emails/day (re-verify). Key comes from env. */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend'
  constructor(private apiKey: string, private defaultFrom: string, private fetchImpl: typeof fetch = fetch) {}
  async send(msg: EmailMessage) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: msg.from ?? this.defaultFrom, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
    })
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  }
}

/**
 * SmtpProvider (stub). Cloudflare Workers cannot open raw SMTP sockets via fetch, so this is meant for the
 * node self-host path: implement `send` with nodemailer (MIT) or any SMTP client, e.g.
 *
 *   import nodemailer from 'nodemailer'
 *   const t = nodemailer.createTransport({ host, port, auth: { user, pass } })
 *   await t.sendMail({ from, to, subject, text, html, headers })
 *
 * Left unimplemented on purpose to keep the project dependency-free.
 */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp'
  constructor(readonly opts: { host: string; port: number; user?: string; pass?: string }) {}
  async send(_msg: EmailMessage): Promise<void> {
    throw new Error('SmtpProvider is a stub: wire nodemailer here (see comment) or use ResendProvider')
  }
}

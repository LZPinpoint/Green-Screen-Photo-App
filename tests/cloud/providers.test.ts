import { describe, expect, it, vi } from 'vitest'
import { LogEmailProvider, ResendProvider, SmtpProvider } from '../../cloud/src/email/providers'
import { renderEmail } from '../../cloud/src/email/template'

const msg = { to: 'a@b.co', subject: 's', text: 't', html: '<p>h</p>', headers: { 'List-Unsubscribe': '<x>' } }

describe('email providers', () => {
  it('ResendProvider posts to api.resend.com with bearer key', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }))
    await new ResendProvider('re_key', 'imagine <p@x.org>', f as any).send(msg)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as any).authorization).toBe('Bearer re_key')
    expect(JSON.parse(init.body as string)).toMatchObject({ from: 'imagine <p@x.org>', to: ['a@b.co'], subject: 's', headers: { 'List-Unsubscribe': '<x>' } })
  })
  it('ResendProvider throws on http errors', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 422 }))
    await expect(new ResendProvider('k', 'f', f as any).send(msg)).rejects.toThrow(/422/)
  })
  it('LogEmailProvider prints and records', async () => {
    const lines: string[] = []; const p = new LogEmailProvider((l) => lines.push(l))
    await p.send(msg); expect(p.sent).toHaveLength(1); expect(lines[0]).toContain('a@b.co')
  })
  it('SmtpProvider is a documented stub', async () => {
    await expect(new SmtpProvider({ host: 'h', port: 25 }).send(msg)).rejects.toThrow(/stub/)
  })
  it('template is lowercase, branded, escapes the venue', () => {
    const e = renderEmail({ venueName: '<b>Zoo</b>', guestUrl: 'https://x/g/1', unsubscribeUrl: 'https://x/u/1', expiresText: 'may 1, 2026' })
    expect(e.html).not.toContain('<b>Zoo'); expect(e.html).toContain('#B80021'); expect(e.text).toContain('https://x/u/1')
    expect(e.subject).toBe('your photo from <b>zoo</b>')
  })
})

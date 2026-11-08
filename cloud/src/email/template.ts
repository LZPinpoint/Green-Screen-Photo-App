import { esc } from '../html/util'

export interface EmailParams { venueName: string; guestUrl: string; unsubscribeUrl: string; expiresText: string }

export function renderEmail(p: EmailParams): { subject: string; text: string; html: string } {
  const subject = `your photo from ${p.venueName.toLowerCase()}`
  const text =
`imagine.

your photo from ${p.venueName.toLowerCase()} is ready.

view and download it here:
${p.guestUrl}

it is available until ${p.expiresText}.

you are getting this one email because you asked for your photo.
stop emails / remove my address: ${p.unsubscribeUrl}
`
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#181818;font-family:Poppins,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#fff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#181818"><tr><td align="center" style="padding:0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="background:#B80021;height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 24px 8px;font-size:22px;font-weight:700;letter-spacing:-0.5px">imagine<span style="color:#B80021">.</span></td></tr>
<tr><td style="padding:8px 24px 0;font-size:26px;line-height:1.2;font-weight:700">your photo is ready.</td></tr>
<tr><td style="padding:12px 24px 0;font-size:16px;line-height:1.5;color:#e6e6e6">from ${esc(p.venueName.toLowerCase())}. view it, download it in full resolution, or share it with friends.</td></tr>
<tr><td style="padding:24px"><a href="${esc(p.guestUrl)}" style="display:inline-block;background:#B80021;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:999px">see my photo</a></td></tr>
<tr><td style="padding:0 24px;font-size:14px;color:#c9c9c9">available until ${esc(p.expiresText)}.</td></tr>
<tr><td style="padding:28px 24px 32px;font-size:12px;line-height:1.6;color:#b0b0b0">you are getting this email because you asked for your photo.<br><a href="${esc(p.unsubscribeUrl)}" style="color:#d0d0d0">stop emails / remove my address</a></td></tr>
</table></td></tr></table></body></html>`
  return { subject, text, html }
}

import { esc } from './util'

export const CSS = `
:root{--red:#B80021;--bg:#181818;--panel:#242424;--line:#3d3d3d;--fg:#fff;--muted:#c9c9c9}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:Poppins,"Helvetica Neue",Helvetica,Arial,sans-serif;line-height:1.5;min-height:100vh;display:flex;flex-direction:column}
.bar{background:var(--red);height:10px}
header{max-width:760px;width:100%;margin:0 auto;padding:20px 20px 0;display:flex;align-items:center;justify-content:space-between;gap:12px}
.wordmark{font-weight:700;font-size:24px;letter-spacing:-.04em;text-decoration:none;color:var(--fg)}
.wordmark i{font-style:normal;color:var(--red);font-size:1.4em;line-height:0}
main a:not(.btn){color:#fff;text-decoration:underline}
.venue{font-size:14px;color:var(--muted);text-align:right}
main{max-width:760px;width:100%;margin:0 auto;padding:16px 20px 40px;flex:1}
h1{font-size:clamp(26px,6vw,40px);line-height:1.1;margin:12px 0 8px;letter-spacing:-.03em}
p.lead{margin:0 0 20px;color:var(--muted);font-size:17px}
.photo{display:block;width:100%;height:auto;max-height:78vh;object-fit:contain;border-radius:32px;background:var(--panel)}
.pending{border-radius:32px;background:var(--panel);padding:56px 24px;text-align:center;color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 24px;border-radius:999px;border:2px solid var(--line);background:var(--panel);color:var(--fg);font-weight:600;font-size:16px;line-height:1.2;font-family:inherit;text-decoration:none;cursor:pointer}
.btn:hover{border-color:#777}
.btn.primary{background:var(--red);border-color:var(--red)}
.btn.primary:hover{background:#d3002a;border-color:#d3002a}
.btn.block{display:flex;width:100%}
a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #fff;outline-offset:3px}
.actions{margin:20px 0 8px}
h2{font-size:18px;margin:28px 0 12px;letter-spacing:-.02em}
.share{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:0;padding:0;list-style:none}
.share li{display:contents}
@media(min-width:560px){.share{grid-template-columns:repeat(3,1fr)}}
details.email{margin-top:12px;border:2px solid var(--line);border-radius:28px;background:var(--panel);padding:4px 20px}
details.email summary{cursor:pointer;font-weight:600;min-height:48px;display:flex;align-items:center}
details.email form{padding:4px 0 20px;display:grid;gap:14px}
label.f{display:block;font-size:14px;color:var(--muted)}
input[type=email]{width:100%;min-height:48px;margin-top:6px;border-radius:999px;border:2px solid var(--line);background:var(--bg);color:var(--fg);padding:10px 18px;font:inherit;font-size:16px}
.chk{display:flex;gap:12px;align-items:flex-start;font-size:14px;color:var(--muted)}
.chk input{width:22px;height:22px;margin-top:2px;flex:none;accent-color:var(--red)}
.status{min-height:1.5em;font-size:15px}
.status.err{color:#ffb3bf}.status.ok{color:#b8f5c8}
footer{max-width:760px;width:100%;margin:0 auto;padding:20px 20px 36px;font-size:14px;color:var(--muted);border-top:1px solid #2c2c2c}
footer a{color:#e8e8e8}
footer p{margin:6px 0}
.hp{position:absolute;left:-9999px}
`

export interface PageOpts {
  title: string
  description?: string
  nonce: string
  body: string
  venueName?: string
  head?: string
  noindex?: boolean
}

export function page(o: PageOpts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
${o.description ? `<meta name="description" content="${esc(o.description)}">` : ''}
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#B80021">
${o.head ?? ''}
<style nonce="${o.nonce}">${CSS}</style>
</head>
<body>
<div class="bar" role="presentation"></div>
<header>
<a class="wordmark" href="#" aria-label="imagine">imagine<i>.</i></a>
${o.venueName ? `<div class="venue">${esc(o.venueName.toLowerCase())}</div>` : ''}
</header>
${o.body}
</body>
</html>`
}

/** Plain message page (confirm delete, errors, ...). */
export function messagePage(nonce: string, title: string, bodyHtml: string): string {
  return page({
    title: `${title} · imagine`, nonce,
    body: `<main><h1>${esc(title)}</h1>${bodyHtml}</main>`,
  })
}

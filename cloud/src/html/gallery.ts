import { esc, formatDate } from './util'
import { page } from './layout'
import type { SessionRow, Venue } from '../types'

const js = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export interface GalleryOpts {
  venue: Venue
  session: SessionRow
  baseUrl: string
  deleteToken: string
  nonce: string
  consentVersion: string
}

export function renderGallery(o: GalleryOpts): string {
  const { venue, session, baseUrl, nonce } = o
  const id = session.id
  const pageUrl = `${baseUrl}/g/${id}`
  const imgUrl = `${baseUrl}/g/${id}/image`
  const ogImg = session.hasThumb ? `${baseUrl}/g/${id}/thumb` : imgUrl
  const venueName = venue.name
  const alt = `your photo from ${venueName.toLowerCase()}${session.scene ? `, in the ${session.scene.toLowerCase()} scene` : ''}`
  const expires = formatDate(session.expiresAt)
  const text = `my photo from ${venueName.toLowerCase()}`
  const u = encodeURIComponent
  const head = `
<link rel="canonical" href="${esc(pageUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="imagine">
<meta property="og:title" content="${esc(text)}">
<meta property="og:description" content="${esc(venue.welcomeText || 'made with imagine')}">
<meta property="og:url" content="${esc(pageUrl)}">
${session.hasImage ? `<meta property="og:image" content="${esc(ogImg)}">
<meta property="og:image:alt" content="${esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(text)}">
<meta name="twitter:description" content="${esc(venue.welcomeText || 'made with imagine')}">
<meta name="twitter:image" content="${esc(ogImg)}">
<meta name="twitter:image:alt" content="${esc(alt)}">` : '<meta http-equiv="refresh" content="10">'}`

  const photo = session.hasImage
    ? `<img class="photo" src="/g/${id}/image" alt="${esc(alt)}" decoding="async" fetchpriority="high">`
    : `<div class="pending" role="status"><p>your photo is on its way.</p><p>this page refreshes by itself. you can also come back in a minute.</p></div>`

  const share = session.hasImage ? `
<h2 id="share-h">share it</h2>
<ul class="share" aria-labelledby="share-h">
<li><button type="button" class="btn primary" id="native-share" hidden>share&hellip;</button></li>
<li><a class="btn" rel="noopener noreferrer" target="_blank" href="https://www.facebook.com/sharer/sharer.php?u=${u(pageUrl)}">facebook</a></li>
<li><a class="btn" rel="noopener noreferrer" target="_blank" href="https://twitter.com/intent/tweet?text=${u(text)}&amp;url=${u(pageUrl)}">x</a></li>
<li><a class="btn" rel="noopener noreferrer" target="_blank" href="https://wa.me/?text=${u(text + ' ' + pageUrl)}">whatsapp</a></li>
<li><a class="btn" rel="noopener noreferrer" target="_blank" href="https://www.pinterest.com/pin/create/button/?url=${u(pageUrl)}&amp;media=${u(imgUrl)}&amp;description=${u(text)}">pinterest</a></li>
<li><button type="button" class="btn" id="copy-link" data-url="${esc(pageUrl)}">copy link</button></li>
</ul>` : ''

  const emailForm = `
<details class="email" id="email-box">
<summary>email me my photo</summary>
<form id="email-form" method="post" action="/api/v1/sessions/${id}/email" novalidate>
<label class="f">your email<input type="email" name="email" id="email" autocomplete="email" inputmode="email" required></label>
<input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<label class="chk"><input type="checkbox" name="consent" id="consent" value="1" required><span>yes, send my photo link to this address. i agree to ${esc(venueName.toLowerCase())} using my email for this one message. <a href="#privacy">details</a></span></label>
<label class="chk"><input type="checkbox" name="marketingOptIn" id="marketing" value="1"><span>optional: also keep me posted with news from ${esc(venueName.toLowerCase())}. i can stop any time.</span></label>
<input type="hidden" name="consentVersion" value="${esc(o.consentVersion)}">
<button class="btn primary block" type="submit">send it</button>
<div class="status" id="email-status" role="status" aria-live="polite"></div>
</form>
</details>`

  const script = `
(function(){
var $=function(i){return document.getElementById(i)};
var url=${js(pageUrl)},img=${js(imgUrl)},title=${js(text)};
var ns=$('native-share');
if(ns&&navigator.share){ns.hidden=false;ns.addEventListener('click',async function(){
 try{
  var r=await fetch(img);var b=await r.blob();
  var f=new File([b],'imagine-photo.'+(b.type==='image/png'?'png':'jpg'),{type:b.type});
  if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:title,url:url});return}
 }catch(e){if(e&&e.name==='AbortError')return}
 try{await navigator.share({title:title,url:url})}catch(e){}
})}
var cp=$('copy-link');
if(cp){cp.addEventListener('click',async function(){
 try{await navigator.clipboard.writeText(url);cp.textContent='copied!'}catch(e){window.prompt('copy this link',url)}
 setTimeout(function(){cp.textContent='copy link'},2000)})}
var f=$('email-form');
if(f){var st=$('email-status'),busy=false;
 f.addEventListener('submit',async function(e){
  e.preventDefault();if(busy)return;
  st.className='status';
  if(!$('email').value||!$('email').checkValidity()){st.className='status err';st.textContent='please enter a valid email address.';$('email').focus();return}
  if(!$('consent').checked){st.className='status err';st.textContent='please tick the box so we may send your photo.';return}
  busy=true;var btn=f.querySelector('button[type=submit]');btn.disabled=true;
  try{
   var r=await fetch(f.action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:$('email').value,consent:true,marketingOptIn:$('marketing').checked,website:f.elements.website.value})});
   var j=await r.json().catch(function(){return{}});
   if(r.ok){st.className='status ok';st.textContent=j.duplicate?'we already sent that one. check your inbox (and spam).':'sent! check your inbox (and spam).'}
   else{st.className='status err';st.textContent=j.error==='rate_limited'?'too many tries. please wait a bit and try again.':(j.message||'sorry, that did not work.')}
  }catch(err){st.className='status err';st.textContent='no connection. please try again.'}
  busy=false;btn.disabled=false;
 })}
})();`

  const body = `
<main>
<h1>${esc(venueName.toLowerCase())}</h1>
<p class="lead">${esc((venue.welcomeText || 'here is your photo.').toLowerCase())}</p>
${photo}
${session.hasImage ? `<div class="actions"><a class="btn primary block" href="/g/${id}/download" download>download full resolution</a></div>` : ''}
${share}
${session.hasImage ? emailForm : ''}
</main>
<footer>
<p>available until ${esc(expires)}. after that it is deleted for good.</p>
<p id="privacy">no tracking, no ads, no cookies. we keep your photo only to show it to you. an email address is used only for what you tick above.</p>
<p><a href="/g/${id}/delete?t=${esc(o.deleteToken)}">delete my photo</a></p>
</footer>
<script nonce="${nonce}">${script}</script>`

  return page({
    title: `${text} · imagine`, description: venue.welcomeText || 'made with imagine', nonce, venueName, head, body,
  })
}

# Privacy notes: digital delivery (cloud/)

> **NEEDS LEGAL REVIEW.** This is an engineering description of what the software does and a checklist of
> things to decide, not legal advice. Visitors include children, so have counsel (and the venue's data
> protection officer, if any) review before going live in any jurisdiction.

## What is collected and why
| Data | Where | Why | Default lifetime |
|---|---|---|---|
| Photo (composite) + optional thumbnail | R2 / local blobs | show the guest their photo | venue `retentionDays` (default 30), then deleted |
| Session row: venue, scene, layout, timestamps, image size | D1 | render gallery, expiry | same as photo |
| Email hash (HMAC with server secret) + consent version/time + marketing flag | D1 `optins` | double-submit protection, proof of consent, unsubscribe | deleted with the photo unless marketing opt-in |
| Email address in plaintext | D1 `optins` | **only if** the guest ticked the separate, unticked-by-default marketing box | `optinRetentionDays` (default 365) or until unsubscribe / guest deletes photo |
| Rate-limit counters (keyed by IP, session) | D1 `rate_limits` | abuse prevention | 1 hour window |

Not collected: no cookies, no analytics, no third-party scripts/fonts/images, no names, no device fingerprints.
Gallery pages send `noindex` and `Referrer-Policy: no-referrer`, and a strict CSP (no inline script without nonce).
Emails are sent by the configured provider (Resend, or your own SMTP); that provider becomes a processor and needs a DPA.

## Guest controls
- **Delete my photo**: link on every gallery page (signed token). Deletes blobs, session row and every email record tied to it.
- **Unsubscribe**: link in every email (also `List-Unsubscribe` one-click). Deletes the stored address.
- **Expiry**: shown on the page ("available until ...").
- **Staff**: `POST /api/v1/venues/:id/purge` (admin key) for erasure requests; `optins.csv` export contains marketing opt-ins only.

## Consent design
- Sending the photo link requires a ticked consent box (`consent:true`, server-enforced). Consent text version is stored (`consentVersion`, currently `v1`). Bump `consentVersion` in config when wording changes.
- Marketing is a **separate, optional, pre-unticked** box. Without it the address is not stored in plaintext.

## COPPA / GDPR (and similar) checklist, for counsel
- **COPPA (US, under 13):** the email form collects a child's personal information if a child types their address. Options: (a) do not offer email on kiosks in child-focused venues, rely on QR only; (b) require "i am 13 or older / a parent is helping" attestation before the form; (c) obtain verifiable parental consent. The software does not verify age. Photos of identifiable children are also personal information.
- **GDPR / UK GDPR:** lawful basis (consent for marketing; consent or legitimate interest for delivery), Art. 13 notice (link a full privacy notice from the booth and gallery; `#privacy` footer is a summary only), controller identity (the venue), processors (Cloudflare, email provider), retention (see above), data subject rights (delete/unsubscribe built in, access/portability by staff request), children's consent age varies by member state (13-16).
- **Cross-border:** Cloudflare R2 location hint / D1 jurisdiction should match venue obligations.
- **Biometrics:** the booth does no face recognition. Keep it that way; many laws (e.g. Illinois BIPA) treat face geometry as biometric data.
- **Signage:** post a notice at the booth saying photos may be uploaded if the guest scans the QR / asks for email.
- **Security:** keys stored hashed, tokens HMAC-signed, uploads size/type checked. Still needed operationally: rotate keys when staff leave (`PUT /venues/:id` with `rotateKeys:true`), keep `SIGNING_SECRET` secret (rotating it invalidates outstanding delete/unsubscribe links), set up breach-response contacts.
- **Marketing compliance:** CAN-SPAM / CASL / PECR require sender identity and working unsubscribe. The email template has the unsubscribe link; add the venue's postal address to the template if required.
- **Photo upload to social media:** share buttons only open the platform's own share page with the gallery link; nothing is posted by us.

# imagine booth — project state & handoff

_Last updated 2026-11-12. Read this first when resuming. Companion docs: `PLAN.md`, `HARDWARE.md`, `TEST-PLAN.md`, `STAFF-GUIDE.md`, `WEB-DEMO.md`, `PRIVACY.md`, `cloud/README.md`._

## What this is
Green-screen photo software for museums, exhibits and events, themed for **Imagine** (theimagineteam.com: red `#B80021`,
near-black `#181818`, white, all-lowercase copy, very rounded corners, geometric font — Poppins fallback; Axiforma is paid, not bundled).
**Primary use = staff-operated:** an attendant lines a party up in front of a green screen and captures them; the app keys,
composites onto a scene, prints (dye-sub 4x6 etc.) and optionally gives a QR/gallery/email. **Self-serve kiosk** is the optional second mode.

## Hard requirements from the owner
- **Free or as cheap as possible without hurting quality.** Every dependency permissive (MIT/Apache/BSD/LGPL-as-subprocess). No paid APIs, no per-use fees.
  Rejected: `@imgly/background-removal-node` (AGPL). Fonts: no paid fonts.
- Owner already owns the camera (DSLR/mirrorless) and a dye-sub printer; media cost is known/accepted.
- Digital delivery wanted: QR on print/screen, branded guest gallery page, email (opt-in list), social share buttons. SMS skipped (costs money; QR covers it).
- Only email sending costs money; free tier first (Resend), swappable provider.

## Architecture (Electron + Vite + React + TypeScript)
| Path | What |
|---|---|
| `src/shared/types.ts` | **The contract.** KeyParams (incl. `stage`), VenueSettings (`mode` staff/kiosk, `staff`, `share`), BoothAPI (IPC surface), Session. Change deliberately. |
| `src/core/` | Pure image logic: `chromaKey` (YCbCr **chroma-only** distance), spill, `stage` garbage matte, GLSL live preview, `composeScene`, `layoutSheet` (300dpi sizes), own QR generator. |
| `src/main/` | Electron main: camera drivers (gphoto2 / digiCamControl / simulated), printing (Electron silent print + `virtual-pdf` fallback, retry queue), JSON store (settings/sessions/library), AI cutout (onnxruntime-node + bundled u2netp), ShareService/ShareQueue (offline-first upload), second-screen window. |
| `src/preload/` | `window.booth` bridge. |
| `src/renderer/staff/` | **Staff console** (lineup, capture, queue/tickets A001…, scene strip, burst-of-3, detail panel, `#/display` guest screen via BroadcastChannel). Keying runs in a Web Worker. |
| `src/renderer/kiosk/` | Self-serve guest flow incl. share step (QR + on-screen-keyboard email). |
| `src/renderer/admin/` | PIN-gated (default PIN `1234`): dashboard, green screen (+stage handles), hardware, scenes, layouts, sharing, settings, test lab. |
| `src/renderer/keying/` | `autoKey` decision logic (chroma / ai / hybrid), `autoStage`, matte post-processing, web-demo AI engine (onnxruntime-web). |
| `src/renderer/mockBooth.ts` | In-browser `window.booth` for the public web demo. |
| `cloud/` | Cloudflare Worker (R2+D1) gallery/email/opt-ins backend + node dev server; free-tier friendly; **never deployed yet**. |

**Keying decision (auto mode):** green backdrop present and fills frame → chroma only (fast, ~1.3 s capture→ready). Edges not green → `autoStage` trims
(never the bottom edge). Leftover blobs → **hybrid** = chroma alpha × dilated AI alpha. No green → **AI** (≈5–6 s). AI engine: desktop = main-process
onnxruntime-node; web demo = onnxruntime-web in a worker (16 MB lazy download, web build only — must stay out of the installers).

## Live deployments / accounts
- **Repo:** https://github.com/LZPinpoint/Green-Screen-Photo-App (public). Default branch `main`. Branches `staff-mode`, `ai-cutout-stage` are already merged (safe to delete).
- **Web demo:** https://imagine-booth-demo.vercel.app — Vercel project `imagine-booth-demo`, team **Goodsuits** (`goodsuits-team`). The team also owns unrelated projects (`goodsuits`, `goodsuits-dashboard`) — **never touch them.**
- **Installers:** GitHub Actions `build.yml` (tests → Windows x64, mac arm64 on `macos-15`, mac x64 on `macos-15-intel`, Linux AppImage). Unsigned.
  Latest green run on `main` commit `4c3c1f2` (all four builds). Draft release `v0.1.0` exists but its tag/title has a stray trailing period (`v0.1.0.`) — owner to fix in the GitHub UI or delete. **`v0.1.1` not cut yet** (owner runs the workflow, types `v0.1.1` in the release box, no trailing period).

## How to redeploy the web demo
1. `cd src/renderer && npx vite build` → `dist-web/` (delete it afterwards; it's git-ignored).
2. Copy `dist-web/*` into a **fresh folder named `imagine-booth-demo`** with a `vercel.json` (`cleanUrls`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self)`); keep its `.vercel/` link (project `imagine-booth-demo`, team `goodsuits-team`).
3. `npx vercel deploy --prod --yes --scope goodsuits-team`. Login is a device flow the **owner must approve** with the Vercel account that owns the Goodsuits team; run `vercel login` in the **background** (a foreground process dies and the code expires). The Vercel MCP connector can't practically upload a 16 MB bundle.
4. Verify: `/ort/*.wasm` served as `application/wasm`, `/models/u2netp.onnx` 200, run a playwright smoke test.

## Rules learned the hard way
- **Repo is public:** scan for secrets before every push; never commit photos of people (testers' screenshots live only outside the repo); commits are authored as the GitHub noreply identity, not a personal email.
- Claude sessions here **can push branches but not tags, and cannot create/edit releases** (HTTP 403) and `gh` GraphQL is blocked. Releases are made by the owner via the workflow's `release_tag` input.
- Don't dismiss/interrupt while sub-sessions run — an interrupt cancelled four of them once. Ask sub-sessions to write files incrementally; always re-run tests/builds yourself, don't trust reports.
- Verify claims visually (playwright screenshots) — an early misreading assumed testers had no green screen; they did, but the screen didn't fill the camera view.
- macOS runners: the dmg step can fail with `hdiutil … resource busy` (CI kills XProtect + retries); build each mac arch on its own runner (native `sharp`/`onnxruntime` binaries are per-arch).

## Verified vs not verified
**Verified here:** 224 unit/integration tests, typecheck, builds on all 4 platforms, packaged Linux app launched under xvfb with real IPC (session → composite → virtual print), staff capture flow in real Electron, live web demo incl. in-browser AI cutout.
**NOT verified (no hardware / no OS access):** real DSLR tethering, real dye-sub printing, Windows/macOS installers launching, second-screen `#/display` window inside Electron (BroadcastChannel across `file://` windows), cloud Worker on real Cloudflare, real email send, ONNX model speed on real laptops.

## Known gaps / backlog (priority order)
1. **Hardware test pass** by the owner (see `TEST-PLAN.md`); feed results back.
2. **DSLR live preview missing** — only webcam/simulated give live lineup. Options: webcam beside the lens, HDMI capture dongle (appears as a webcam), or implement gphoto2 `--capture-preview` (`CameraDriver.liveFrame?` already exists in the contract; unverifiable without a camera).
3. **Grey screen request** (reason not yet known — ask why: spill? green clothing? aesthetics?). The chroma keyer ignores brightness, so grey (zero chroma) would key out any neutral colour. Today grey works only via AI mode (soft hair edges, ~6 s). Proper fix = **clean-plate difference key** (capture empty backdrop, key by difference, refine with AI); moderate effort, needs fixed camera + stable light.
4. No real `session.delete` (retake/delete only hides + marks `test`).
5. Scenes are generated placeholders — replace with Imagine exhibit artwork.
6. Legal review of `PRIVACY.md` / consent wording (COPPA/GDPR; kids at museums); deploy `cloud/` + create a venue key when digital delivery goes live.
7. Code signing (optional, paid): Windows cert / Apple developer account.
8. Polish: action versions (Node 20 deprecation warnings), admin keyed preview doesn't show hybrid/AI result, `electron-builder` icons are a placeholder.
9. Perf target: capture→ready <1.5 s (measured 1.3–1.9 s on a slow VM; re-measure on real laptop).

## Open questions for the owner
- Why a grey screen? (decides clean-plate vs blue screen vs AI-only)
- Results of re-testing the demo with the same testers/setup (leftover wall/ceiling gone? hints shown? AI latency on phones?)
- Build DSLR live view and/or clean-plate mode now, or wait for the hardware test?

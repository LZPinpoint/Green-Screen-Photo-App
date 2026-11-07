# imagine booth — build plan

**What it is:** guest steps in front of a green screen → camera captures → green removed → guest picks a scene
(dinosaur hall, space, ancient egypt…) → composite → print 4x6 on a dye-sub printer (+ optional QR/email).

## How the hardware works (plain english)
- **Camera:** webcams show up to the browser (`getUserMedia`). DSLR/mirrorless are "tethered": USB cable, PC tells the
  camera to shoot and pulls the JPEG back. Tools: `gphoto2` (mac/linux), `digiCamControl` (windows). We wrap both behind `CameraDriver`.
- **Printer:** dye-sub printers (DNP/Mitsubishi/HiTi) install a driver and appear as an ordinary OS printer. We print
  the finished image at exact paper size (4x6 = 1200x1800px @300dpi) through Electron. No special SDK needed.
- **Green removal:** chroma key (distance in YCbCr/HSV from the sampled green, soft edge, spill suppression) — fast, live preview.
  AI cutout is the fallback when lighting is bad.

## Architecture
Electron + Vite + React + TS. `src/shared/types.ts` is the contract. Pure image logic lives in `src/core` (testable in node).
- `src/core/keying`  — chroma key, spill, matte cleanup (ImageData in → ImageData out) + WebGL preview shader
- `src/core/compose` — place keyed subject on scene, frame overlay, print-layout sheets (1-up, 2x6 strip, 4-up)
- `src/main/camera`  — webcam passthrough, gphoto2 driver, digiCamControl driver, simulated driver
- `src/main/printer` — list printers, silent print at size, virtual PDF printer for testing
- `src/main/store`   — settings, sessions, library on disk (JSON + files under userData), stats, AI cutout
- `src/renderer/kiosk` — guest flow: idle → start → countdown → review → pick scene → preview → print → thanks
- `src/renderer/admin` — pin-gated: camera/printer setup, green-screen calibration, scenes, layouts, stats, hardware test

## Phases
| # | Phase | Output | Who |
|---|-------|--------|-----|
| 0 | Contracts, scaffold, theme | this repo | done |
| 1 | Keying engine + compositor + layouts | `src/core`, unit tests | agent A |
| 2 | Camera + printer + store/IPC | `src/main`, `src/preload` | agent B |
| 3 | Kiosk guest UI | `src/renderer/kiosk` | agent C |
| 4 | Admin UI + calibration + stats | `src/renderer/admin` | agent D |
| 5 | Integration, typecheck, e2e with simulated hardware | green CI | integrator |
| 6 | Real-hardware test (see TEST-PLAN.md) | signed-off checklist | you |
| 7 | Package installers (win/mac) | `npm run dist` | integrator |

## Later (not in v1)
Cloud gallery/QR download, email/SMS, multi-venue dashboard, GIF/boom, custom scenes per exhibit, licensing.

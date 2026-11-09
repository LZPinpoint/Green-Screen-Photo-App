# imagine booth — hardware & install notes

## Cameras
Three ways to shoot, all behind the same UI:
| Camera | How | Notes |
|---|---|---|
| Webcam | browser `getUserMedia` in the renderer | permission auto-granted in the app |
| DSLR / mirrorless (mac, linux) | `gphoto2` command line tool | tethered over USB |
| DSLR / mirrorless (windows) | digiCamControl `CameraControlCmd.exe` | tethered over USB |
| Simulated | built in | green backdrop + silhouette; use for demos/tests |

### gphoto2
- **macOS:** `brew install gphoto2`. macOS grabs cameras for Photos/PTPCamera; kill it first: `killall PTPCamera` (or `pkill -f "Image Capture"`). Re-run if the camera "disappears".
- **Debian/Ubuntu:** `sudo apt install gphoto2`. Add your user to the `plugdev` group, or install udev rules (`libgphoto2-6` ships them). Unplug/replug after.
- **Fedora:** `sudo dnf install gphoto2`. **Arch:** `sudo pacman -S gphoto2`.
- **Windows:** not supported by us; use digiCamControl.
- Verify: `gphoto2 --auto-detect` lists your body; `gphoto2 --capture-image-and-download` writes a JPEG.
- Camera settings: set the body to **PTP / "PC connection"** mode (not mass storage), **JPEG (Large, Fine)**, manual exposure + manual white balance (green screen needs constant light), auto-power-off **off**, lens AF on or manual-focused. Fully charged battery or a dummy-battery AC adapter.
- Override binary location with env `GPHOTO2_PATH`.
- The app runs `gphoto2 [--port usb:001,004] --capture-image-and-download --stdout` and reads the JPEG from stdout. 3 attempts with backoff; on repeated failure the CameraManager disconnects/reconnects once.

### digiCamControl (Windows)
- Install from https://digicamcontrol.com (default path `C:\Program Files (x86)\digiCamControl\`). The app uses `CameraControlCmd.exe`:
  `CameraControlCmd.exe /filename <tmp.jpg> /capture`; list with `/list`.
- Custom install dir: env `DIGICAMCONTROL_PATH` = full path to `CameraControlCmd.exe`.
- Open the digiCamControl GUI once to confirm your model is supported and that it shows live view; **close the GUI before running the booth** (it holds the camera).
- Canon bodies: if EOS Utility is installed, quit it (it also holds the camera).

## Printers
Dye-sub printers install as normal OS printers; the app prints silently through Electron at exact paper size (`@page` margin 0, 300 dpi: 4x6 = 1200x1800).
- **DNP (DS-RX1HS, DS620, DS820, QW410):** install the DNP driver. In *Printing Preferences* set the paper to the size you print most (4x6 / 5x7 / 6x8) and **disable "Print with borders / Fit to page"; set Quality to Fine; Matte/Glossy as desired**. The 2x6 strip is normally printed as a 4x6 sheet cut in half by the printer's "2-inch cut" option: select that media (`PC 4x6 (2 inch cut)`) when you use the `strip-2x6` layout.
- **Mitsubishi (CP-D70DW, CP-D80DW, CP-M1):** install the Mitsubishi driver; media: 4x6 / 5x7 / 6x8; set *Sharpness* to Standard, *Overcoat* matte or glossy.
- **HiTi (P525L, P510):** install the HiTi driver; set the same media size and remove any margins.
- Choose the printer in Admin → Printer. If none is chosen (or it is unplugged) prints go to the **virtual PDF printer**: PNG + PDF files in `<userData>/prints/`.
- The app images are always composed at the paper's aspect; the driver must not scale again. Do a test print and measure borders.
- Max prints per session is enforced in the main process; failed jobs retry 3 times, then a `failed` status event is sent to the UI.

## Where data lives
`<userData>` (Windows `%APPDATA%\imagine booth`, macOS `~/Library/Application Support/imagine booth`, Linux `~/.config/imagine booth`): `settings.json`, `library.json`, `backgrounds/`, `frames/`, `sessions/<id>/{raw,keyed,composite}`, `prints/`, `logs/`, `models/`.
`settings.json` also accepts `retentionDays` (default 30, `0` = keep forever): a daily job deletes session image files older than that (session metadata/stats are kept).

## AI cutout model
Runs on `onnxruntime-node` with a permissive model, lazy-loaded on first use. A bundled **u2netp.onnx** is in `resources/models/`. To use a better model, drop one of these into `<userData>/models/` (or set `BOOTH_CUTOUT_MODEL=<path>`):
- `modnet.onnx` — MODNet photographic portrait matting (Apache-2.0), input 512x512, best for people. Example source: https://huggingface.co/Xenova/modnet (`onnx/model.onnx`).
- `u2net.onnx` — U-2-Net full (Apache-2.0), input 320x320: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx
- `u2netp.onnx` — U-2-Net portable (Apache-2.0), already bundled.
Order tried: `modnet.onnx`, `u2net.onnx`, `u2netp.onnx`. If no model loads or inference errors, a sharp-based border-colour chroma matte is used (still works on a clean green screen).
**Never add `@imgly/background-removal-node` (AGPL-3.0).**

### When the ai cutout is used (key mode `auto`, the default)
1. The green key runs first, on the part of the picture that is really green screen (the *stage*, found automatically when `key.stage` is not set; set it by hand in *admin → green screen → stage*).
2. **No green backdrop** in the picture (under ~15% of the stage border is green) or a **poor key** (almost nothing / almost everything removed, very ragged edges) -> the whole picture is cut out with the ai model instead.
3. **Leftovers at the edges** that margin-trimming can't remove (a wall patch in one corner, a dark box): the ai matte is used as a garbage matte (`final alpha = green-key alpha x dilated ai alpha`), so the clean green-key edges around the guest are kept.
4. A screen that fills the frame never runs the ai (fast path, no extra time). If the ai is missing, fails or takes more than 8 s the green-key result is used and the reason is shown (review screen / queue item).
`chroma` = never ai, `ai` = always ai. The live preview shows a hint when the camera sees past the screen or sees no green at all.

### Web demo
The public web demo runs the same u2netp model in the browser with `onnxruntime-web` (MIT, wasm, single thread), self-hosted: `ort/ort-wasm-simd-threaded.{wasm,mjs}` and `models/u2netp.onnx` are copied into `dist-web/` by `src/renderer/vite.config.ts` (not into the Electron build). It loads lazily the first time a visitor has no green screen (about 16 MB once, then cached for offline use); a cutout takes about 2-4 s on a laptop.

## Dependency licenses (project rule: free + permissive)
| Package | License |
|---|---|
| electron, electron-vite, vite, vitest, react, typescript | MIT / Apache-2.0 |
| sharp | Apache-2.0 (bundles libvips, LGPL-3.0, dynamically linked) |
| onnxruntime-node | MIT |
| U-2-Net / u2netp model | Apache-2.0 |
| MODNet model (optional) | Apache-2.0 |
| gphoto2 (external tool, not bundled) | GPL/LGPL (libgphoto2 LGPL-2.1) |
| digiCamControl (external tool, not bundled) | MIT |

## Common failures
| Symptom | Fix |
|---|---|
| "No camera found" (gphoto2) | camera off/asleep, not in PTP mode, cable is charge-only, another app owns it (PTPCamera, Photos, EOS Utility, digiCamControl GUI), missing udev rules |
| "Could not claim the USB device" / busy | same as above; `killall PTPCamera gvfsd-gphoto2 gvfs-gphoto2-volume-monitor`; unplug/replug |
| capture times out | camera in video mode, lens can't focus (set manual focus), low battery |
| `gphoto2 not installed` | install per OS above or set `GPHOTO2_PATH` |
| photos nearly black/white | set manual exposure on the body; auto modes drift and break keying |
| green halo / bad key | even lighting on the screen, subject 1.5 m+ from it; re-calibrate in Admin |
| prints scaled/with borders | driver is set to fit-to-page/borders; select the exact media size and disable borders |
| print goes to PDF folder | no printer selected in Admin or the selected printer is unplugged (see `logs/`) |
| webcam black in kiosk | OS camera permission for the app (macOS: System Settings → Privacy → Camera) |
| AI cutout falls back to chroma | model missing/failed to load; see `logs/booth-*.log` |
Logs: `<userData>/logs/booth-YYYY-MM-DD.log`.

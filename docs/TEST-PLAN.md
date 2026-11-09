# What you need to test this

## Shopping list
- **Green screen:** chroma-green fabric/paper ~6x8ft, wrinkle-free (muslin or pop-up). Matte, not shiny.
- **Lighting:** 2 soft lights on the screen (even, no shadows) + 1 key light on the subject, ~6ft from screen to subject (reduces green spill).
- **Camera:** your DSLR/mirrorless + USB cable (data, not charge-only), AC dummy battery recommended, set to Manual, JPEG, fixed WB, fixed focus.
  Canon/Nikon/Sony supported by gphoto2 (mac/linux). On Windows install digiCamControl.
- **Printer:** DNP DS620/DS-RX1HS, Mitsubishi CP-D70, or HiTi — install the vendor driver, load 4x6 media, print the vendor test page first.
- **Computer:** Win10/11 or macOS, 16GB RAM, USB 3 ports. Touchscreen optional (mouse works).
- Optional: stand/tripod, 24" touchscreen monitor.

## Test levels
1. **No hardware (now):** `npm test` (keying/compose/layout unit tests), `npm run dev` with Simulated camera + PDF virtual printer.
2. **Webcam + green sheet:** calibrate in Admin → Green screen. Check edges on hair, glasses, green clothing.
3. **DSLR:** Admin → Hardware → Test capture. Time capture→preview (target < 3 s).
4. **Printer:** Admin → Hardware → Test print. Verify size, borders, color, no crop. 4x6 = 1200x1800.
5. **Soak:** 100 sessions back-to-back, unplug camera/printer mid-session, out-of-paper, power-cycle. App must recover and never lose a session.
6. **Pilot:** one real exhibit day with staff observer.

## Acceptance checklist
- [ ] Guest completes flow untouched in < 60 s
- [ ] Idle timeout returns to start, no previous guest's photo visible
- [ ] Key quality OK on 5 varied people (hair, glasses, dark skin, white shirt, green-ish shirt)
- [ ] DSLR capture works after USB replug
- [ ] Print matches preview, correct size, copy limit enforced
- [ ] Works offline (wifi off)
- [ ] Admin PIN blocks guests; settings persist across restart
- [ ] Stats count matches actual prints

### No green screen / ai cutout (key mode `auto`)
- [ ] Stand in a normal room with NO green screen: live view shows the plain camera plus "no green screen detected — we'll cut you out with ai after the photo"; after the photo the review says "cutting you out…" then "cut out with ai", and the guest is cleanly separated (hair, glasses, shoulders)
- [ ] Two people side by side (selfie distance) and a phone-portrait frame are both cut out without holes in dark clothes
- [ ] Real green screen that fills the frame: no ai step, capture -> ready time unchanged (staff queue never shows "cutting you out…")
- [ ] Camera sees past the screen (wall in a corner, ceiling band, dark box): live view says "your green screen doesn't fill the picture on the top/left…"; the finished picture has no rectangular leftovers (stage trim and/or ai garbage matte); admin *detect stage* + drag handles keep the margins after restart
- [ ] Rename `resources/models/u2netp.onnx` temporarily: photos still finish (green key fallback) and the review/queue says the ai was unavailable
- [ ] Web demo (phone, no green screen): first cutout shows "getting ready (first time only)…", later ones are faster, and the demo works offline after the first load
- [ ] Demo badge never covers retake / buttons at 390x844 and 1080x1920 (kiosk) or 1024x768 / 1440x900 (staff)

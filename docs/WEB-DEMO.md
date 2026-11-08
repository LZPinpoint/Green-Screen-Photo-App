# web demo (no electron, no backend)

Opening the renderer in a plain browser installs an in-memory `window.booth` (`src/renderer/mockBooth.ts`) and shows a small
"demo mode" badge. Webcam via `getUserMedia` when allowed, otherwise an animated drawn green-screen person; scenes and
frames are generated on canvas; settings live in `localStorage`; "printing" pops the finished sheet out of a virtual printer.

## run locally
    cd src/renderer && npx vite          # dev server (config: src/renderer/vite.config.ts)

## build for hosting
    cd src/renderer && npx vite build    # writes ../../dist-web (relative base, any static host / sub-path works)
    npx vite preview --outDir ../../dist-web

Deploy `dist-web/` to any static host (Vercel, Netlify, GitHub Pages). `getUserMedia` needs https (or localhost).
Staff access: tap the top-left corner 5 times within 3s, PIN `1234` (demo default).

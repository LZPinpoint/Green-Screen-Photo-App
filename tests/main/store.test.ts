import { describe, expect, it } from 'vitest'
import { readFile, readdir, stat, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { DEFAULT_SETTINGS } from '../../src/shared/types'
import { SettingsStore } from '../../src/main/store/settings'
import { SessionStore } from '../../src/main/store/sessions'
import { LibraryStore } from '../../src/main/store/library'
import { writeJsonAtomic, readJson } from '../../src/main/util'
import { tmp, cleanupTmp, pngDataUrl } from './helpers'
cleanupTmp()

describe('atomic json', () => {
  it('writes atomically, no tmp left, corrupt -> fallback + .corrupt copy', async () => {
    const d = await tmp(); const f = join(d, 'a.json')
    await writeJsonAtomic(f, { a: 1 })
    expect(await readJson(f, null)).toEqual({ a: 1 })
    expect((await readdir(d)).filter(n => n.endsWith('.tmp'))).toEqual([])
    const { writeFile } = await import('node:fs/promises')
    await writeFile(f, '{bad')
    expect(await readJson(f, { z: 1 })).toEqual({ z: 1 })
    expect((await readdir(d)).some(n => n.includes('.corrupt-'))).toBe(true)
  })
})

describe('settings', () => {
  it('merges defaults, nested key/brand, persists', async () => {
    const d = await tmp()
    const s = new SettingsStore(d)
    expect((await s.get()).venueName).toBe(DEFAULT_SETTINGS.venueName)
    const out = await s.set({ venueName: 'Franklin', key: { similarity: 0.7 } as never, brand: { accent: '#000' } })
    expect(out.key.keyColor).toEqual(DEFAULT_SETTINGS.key.keyColor)
    expect(out.key.similarity).toBe(0.7)
    const again = await new SettingsStore(d).get()
    expect(again.venueName).toBe('Franklin')
    expect(again.retentionDays).toBe(30)
  })
  it('old partial file is merged with new defaults', async () => {
    const d = await tmp()
    await writeJsonAtomic(join(d, 'settings.json'), { venueName: 'Old' })
    const s = await new SettingsStore(d).get()
    expect(s.venueName).toBe('Old'); expect(s.maxPrintsPerSession).toBe(2)
  })
})

describe('sessions', () => {
  it('start/saveShot/saveComposite/list/stats', async () => {
    const d = await tmp()
    const st = new SessionStore(d)
    const s = await st.start()
    const s2 = await st.saveShot(s.id, await pngDataUrl())
    expect(s2.shots).toHaveLength(1)
    await stat(join(d, s2.shots[0].raw))
    await st.saveKeyed(s.id, 0, await pngDataUrl())
    const s3 = await st.saveComposite(s.id, await pngDataUrl())
    await stat(join(d, s3.composite!))
    await st.patch(s.id, { sceneId: 'space' })
    await st.update(s.id, x => { x.printed += 2 })
    const sum = await st.stats()
    expect(sum.sessions).toBe(1); expect(sum.prints).toBe(2); expect(sum.byScene).toEqual({ space: 1 })
    expect(Object.values(sum.byDay)).toEqual([1])
    expect((await st.list(5))[0].id).toBe(s.id)
    expect(await st.get('../etc')).toBeUndefined()
  })
  it('purges old session files but keeps stats', async () => {
    const d = await tmp()
    let now = Date.now() - 40 * 86_400_000
    const st = new SessionStore(d, () => now)
    const old = await st.start(); await st.saveShot(old.id, await pngDataUrl()); await st.patch(old.id, { sceneId: 'ocean' })
    now = Date.now()
    const fresh = await st.start(); await st.saveShot(fresh.id, await pngDataUrl())
    expect(await st.purgeOlderThan(0)).toBe(0)
    expect(await st.purgeOlderThan(30)).toBe(1)
    expect(await readdir(join(d, 'sessions', old.id))).toEqual(['session.json'])
    expect((await st.get(fresh.id))!.shots).toHaveLength(1)
    expect((await st.stats()).byScene).toEqual({ ocean: 1 })
    void utimes
  })
})

describe('library', () => {
  it('seeds 4 layouts, 6 scenes with real images, 1 frame', async () => {
    const d = await tmp()
    const lib = new LibraryStore(d)
    expect((await lib.layouts()).map(l => l.id)).toEqual(['classic-4x6', 'strip-2x6', 'grid-4up-5x7', 'wide-6x8'])
    const scenes = await lib.scenes()
    expect(scenes.map(s => s.id)).toEqual(['dinosaurs', 'space', 'ancient-egypt', 'ocean', 'art-gallery', 'city-skyline'])
    for (const s of scenes) {
      const url = await lib.imageUrl(s.file)
      const meta = await sharp(Buffer.from(url.split(',')[1], 'base64')).metadata()
      expect(meta.width).toBe(1800)
    }
    expect((await lib.frames())).toHaveLength(1)
    expect(await lib.imageUrl('space.thumb.jpg')).toMatch(/^data:image\/jpeg/)
  })
  it('does not reseed after persisted; save/delete scene; traversal blocked', async () => {
    const d = await tmp()
    const lib = new LibraryStore(d)
    const base = (await lib.scenes())[0]
    await lib.saveScene({ ...base, id: 'mine', name: 'Mine' }, await pngDataUrl(800, 500))
    expect((await new LibraryStore(d).scenes())).toHaveLength(7)
    await lib.deleteScene('mine')
    const lib2 = new LibraryStore(d)
    expect(await lib2.scenes()).toHaveLength(6)
    await expect(lib2.imageUrl('backgrounds/mine.jpg')).rejects.toThrow()
    await expect(lib2.imageUrl('../../etc/passwd')).rejects.toThrow()
    expect(await readFile(join(d, 'library.json'), 'utf8')).toContain('classic-4x6')
  })
})

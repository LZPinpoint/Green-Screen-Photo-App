import { describe, expect, it, vi } from 'vitest'
import { parseAutoDetect, captureArgs, classifyError, GPhoto2Camera } from '../../src/main/camera/gphoto2'
import { parseList, captureArgs as dccArgs, resolveDigiCamPath, DigiCamControlCamera } from '../../src/main/camera/digicam'
import { CameraManager } from '../../src/main/camera/manager'
import { SimulatedCamera } from '../../src/main/camera/simulated'
import type { Runner } from '../../src/main/camera/exec'
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmp, cleanupTmp } from './helpers'
cleanupTmp()

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
const ok = (stdout: Buffer | string, code = 0) => ({ code, stdout: Buffer.from(stdout), stderr: '', timedOut: false })
const noSleep = async () => undefined

describe('gphoto2', () => {
  it('parses --auto-detect', () => {
    const out = 'Model                          Port\n----------------------------------------------------------\nCanon EOS 700D                 usb:001,004\nNikon DSC D750 (PTP mode)      usb:001,010\n'
    expect(parseAutoDetect(out)).toEqual([
      { id: 'gphoto2:usb:001,004', label: 'Canon EOS 700D', kind: 'dslr' },
      { id: 'gphoto2:usb:001,010', label: 'Nikon DSC D750 (PTP mode)', kind: 'dslr' }
    ])
    expect(parseAutoDetect('Model Port\n-----\n')).toEqual([])
  })
  it('builds capture args', () => {
    expect(captureArgs()).toEqual(['--capture-image-and-download', '--stdout'])
    expect(captureArgs('usb:001,004')).toEqual(['--port', 'usb:001,004', '--capture-image-and-download', '--stdout'])
  })
  it('classifies errors', () => {
    expect(classifyError('*** Error: No camera found. ***')).toBe('no-device')
    expect(classifyError('Could not claim the USB device')).toBe('busy')
    expect(classifyError('weird')).toBe('failed')
  })
  it('captures with port after connect, retries on busy', async () => {
    const calls: string[][] = []
    let n = 0
    const run: Runner = vi.fn(async (_c, args) => {
      calls.push(args)
      if (args[0] === '--auto-detect') return ok('Model Port\n------\nCanon EOS 700D                 usb:001,004\n')
      return ++n === 1 ? { code: 1, stdout: Buffer.alloc(0), stderr: 'Could not claim the USB device', timedOut: false } : ok(JPEG)
    })
    const cam = new GPhoto2Camera({ run, sleep: noSleep })
    await cam.connect('gphoto2:usb:001,004')
    expect((await cam.capture()).equals(JPEG)).toBe(true)
    expect(calls.filter(a => a[0] === '--port')).toHaveLength(2)
  })
  it('does not retry no-device and maps ENOENT to not-installed', async () => {
    const run: Runner = vi.fn(async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: '*** Error: No camera found. ***', timedOut: false }))
    await expect(new GPhoto2Camera({ run, sleep: noSleep }).capture()).rejects.toMatchObject({ code: 'no-device' })
    expect(run).toHaveBeenCalledTimes(1)
    const enoent: Runner = async () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }) }
    await expect(new GPhoto2Camera({ run: enoent }).capture()).rejects.toMatchObject({ code: 'not-installed' })
    expect(await new GPhoto2Camera({ run: enoent }).list()).toEqual([])
  })
})

describe('digiCamControl', () => {
  it('args/path/list', () => {
    expect(dccArgs('C:\\t\\a.jpg')).toEqual(['/filename', 'C:\\t\\a.jpg', '/capture'])
    expect(resolveDigiCamPath('X.exe')).toBe('X.exe')
    expect(resolveDigiCamPath(undefined, () => false)).toContain('digiCamControl')
    expect(parseList('1: Canon EOS 700D\nNo camera found\n')).toEqual([{ id: 'digicam:Canon EOS 700D', label: 'Canon EOS 700D', kind: 'dslr' }])
  })
  it('captures the file the tool writes', async () => {
    const root = await tmp()
    const run: Runner = async (_c, args) => { await writeFile(args[args.indexOf('/filename') + 1], JPEG); return ok('') }
    const cam = new DigiCamControlCamera({ exe: 'dcc.exe', run, tmpRoot: root, sleep: noSleep })
    expect((await cam.capture()).equals(JPEG)).toBe(true)
  })
  it('fails after retries when no image', async () => {
    const root = await tmp(); await mkdir(root, { recursive: true })
    const run = vi.fn<Runner>(async () => ok('busy'))
    await expect(new DigiCamControlCamera({ exe: 'dcc.exe', run, tmpRoot: root, sleep: noSleep }).capture()).rejects.toMatchObject({ code: 'busy' })
    expect(run).toHaveBeenCalledTimes(3)
  })
})

describe('SimulatedCamera + manager', () => {
  it('renders a green jpeg', async () => {
    const cam = new SimulatedCamera({ width: 300, height: 200 })
    await cam.connect('simulated:0')
    const buf = await cam.capture()
    const m = await sharp(buf).metadata()
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 300, 200])
    const { data } = await sharp(buf).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    expect(data[1]).toBeGreaterThan(data[0] + 40)
  })
  it('routes, lists webcam marker, and reconnects on failed capture', async () => {
    const sim = new SimulatedCamera({ width: 100, height: 100 })
    let fail = true
    const flaky = { kind: 'dslr' as const, list: async () => [{ id: 'x:1', label: 'X', kind: 'dslr' as const }], connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), capture: vi.fn(async () => { if (fail) { fail = false; throw new Error('boom') } return JPEG }) }
    const m = new CameraManager({ simulated: sim, dslr: [flaky] })
    const list = await m.list()
    expect(list.map(d => d.id)).toEqual(['webcam:default', 'simulated:0', 'x:1'])
    await expect(m.capture()).rejects.toMatchObject({ code: 'not-connected' })
    await m.connect('x:1')
    expect((await m.capture()).equals(JPEG)).toBe(true)
    expect(flaky.connect).toHaveBeenCalledTimes(2)
    await expect(m.connect('nope:1')).rejects.toThrow()
  })
})

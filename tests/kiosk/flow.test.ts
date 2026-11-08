import { describe, it, expect } from 'vitest'
import { flowReducer, initialFlow, type FlowAction, type FlowState } from '../../src/renderer/kiosk/flow'

const run = (s: FlowState, ...a: FlowAction[]) => a.reduce(flowReducer, s)

describe('kiosk flow', () => {
  it('walks the happy path for a 1-up sheet', () => {
    const s = run(initialFlow(1, 2),
      { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'continue' },
      { type: 'pickScene', id: 'dino' }, { type: 'toPreview' }, { type: 'setCopies', copies: 2 },
      { type: 'print' }, { type: 'printOk' })
    expect(s.screen).toBe('thanks')
    expect(s.copies).toBe(2)
    expect(s.sceneId).toBe('dino')
  })
  it('collects several shots for multi-up layouts', () => {
    let s = run(initialFlow(3), { type: 'touch' }, { type: 'consent' }, { type: 'captured' })
    expect(s.screen).toBe('review')
    s = run(s, { type: 'continue' })
    expect(s.screen).toBe('pose')
    s = run(s, { type: 'captured' }, { type: 'continue' }, { type: 'captured' }, { type: 'continue' })
    expect(s.screen).toBe('scenes')
    expect(s.shots).toBe(3)
  })
  it('retake drops the latest shot', () => {
    const s = run(initialFlow(2), { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'retake' })
    expect(s.screen).toBe('pose')
    expect(s.shots).toBe(0)
  })
  it('cannot preview without a scene, and copies are limited', () => {
    let s = run(initialFlow(1, 2), { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'continue' })
    expect(run(s, { type: 'toPreview' }).screen).toBe('scenes')
    s = run(s, { type: 'pickScene', id: 'a' }, { type: 'toPreview' }, { type: 'setCopies', copies: 9 })
    expect(s.copies).toBe(2)
    expect(run(s, { type: 'setCopies', copies: 0 }).copies).toBe(1)
  })
  it('print failure keeps the session and can retry or recover', () => {
    let s = run(initialFlow(1), { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'continue' },
      { type: 'pickScene', id: 'a' }, { type: 'toPreview' }, { type: 'print' }, { type: 'printFail', error: 'offline' })
    expect(s.screen).toBe('printing')
    expect(s.printError).toBe('offline')
    expect(s.sceneId).toBe('a')
    s = run(s, { type: 'print' })
    expect(s.printError).toBeUndefined()
    expect(s.screen).toBe('printing')
  })
  it('idle timeout resets, but not during an active print', () => {
    let s = run(initialFlow(1), { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'timeout' })
    expect(s.screen).toBe('idle')
    expect(s.shots).toBe(0)
    expect(s.epoch).toBe(1)
    s = run(initialFlow(1), { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'continue' },
      { type: 'pickScene', id: 'a' }, { type: 'toPreview' }, { type: 'print' }, { type: 'timeout' })
    expect(s.screen).toBe('printing')
  })
  it('back navigation', () => {
    let s = run(initialFlow(1), { type: 'touch' }, { type: 'back' })
    expect(s.screen).toBe('idle')
    s = run(initialFlow(1), { type: 'touch' }, { type: 'consent' }, { type: 'back' })
    expect(s.screen).toBe('welcome')
  })
  it('ignores out-of-order actions', () => {
    expect(run(initialFlow(1), { type: 'captured' }).screen).toBe('idle')
    expect(run(initialFlow(1), { type: 'print' }).screen).toBe('idle')
  })
  it('configure clamps copies', () => {
    const s = run(initialFlow(1, 3), { type: 'touch' }, { type: 'configure', maxCopies: 1 })
    expect(s.maxCopies).toBe(1)
  })
  describe('share step', () => {
    const toPrinting = (shareEnabled: boolean) => run(initialFlow(1, 2), { type: 'configure', shareEnabled },
      { type: 'touch' }, { type: 'consent' }, { type: 'captured' }, { type: 'continue' },
      { type: 'pickScene', id: 'a' }, { type: 'toPreview' }, { type: 'print' })
    it('printOk goes to share when enabled, thanks otherwise', () => {
      expect(run(toPrinting(true), { type: 'printOk' }).screen).toBe('share')
      expect(run(toPrinting(false), { type: 'printOk' }).screen).toBe('thanks')
    })
    it('share -> thanks on done or skip, ignored elsewhere', () => {
      const s = run(toPrinting(true), { type: 'printOk' })
      expect(run(s, { type: 'done' }).screen).toBe('thanks')
      expect(run(s, { type: 'skip' }).screen).toBe('thanks')
      expect(run(toPrinting(true), { type: 'done' }).screen).toBe('printing')
    })
    it('timeout on share wipes to idle and keeps shareEnabled', () => {
      const s = run(toPrinting(true), { type: 'printOk' }, { type: 'timeout' })
      expect(s.screen).toBe('idle')
      expect(s.shareEnabled).toBe(true)
      expect(s.sceneId).toBeUndefined()
      expect(s.epoch).toBe(1)
    })
    it('print failure never reaches share', () => {
      expect(run(toPrinting(true), { type: 'printFail', error: 'x' }).screen).toBe('printing')
    })
  })
})

import { join } from 'node:path'
import { DEFAULT_KEY, DEFAULT_SETTINGS, type VenueSettings } from '@shared/types'
import { Mutex, readJson, writeJsonAtomic } from '../util'

/** Main-process-only extension of VenueSettings (types.ts is frozen). Stored in the same settings.json. */
export interface StoredSettings extends VenueSettings {
  /** Delete session image files older than this many days. 0 = keep forever. Default 30. */
  retentionDays?: number
}
export const DEFAULT_RETENTION_DAYS = 30

export function mergeSettings(base: StoredSettings, patch: Partial<StoredSettings> | undefined): StoredSettings {
  const p = patch ?? {}
  return {
    ...base, ...p,
    key: { ...base.key, ...(p.key ?? {}) },
    brand: { ...base.brand, ...(p.brand ?? {}) },
    staff: { ...(base.staff as object), ...(p.staff ?? {}) } as StoredSettings['staff']
  }
}

export class SettingsStore {
  private cache?: StoredSettings
  private readonly mutex = new Mutex()
  private readonly file: string
  constructor(dataDir: string) { this.file = join(dataDir, 'settings.json') }

  async get(): Promise<StoredSettings> {
    if (!this.cache) {
      const defaults: StoredSettings = { ...DEFAULT_SETTINGS, key: { ...DEFAULT_KEY }, brand: { ...DEFAULT_SETTINGS.brand }, retentionDays: DEFAULT_RETENTION_DAYS }
      this.cache = mergeSettings(defaults, await readJson<Partial<StoredSettings>>(this.file, {}))
    }
    return structuredClone(this.cache)
  }

  set(patch: Partial<StoredSettings>): Promise<StoredSettings> {
    return this.mutex.run(async () => {
      const next = mergeSettings(await this.get(), patch)
      await writeJsonAtomic(this.file, next)
      this.cache = next
      return structuredClone(next)
    })
  }
}

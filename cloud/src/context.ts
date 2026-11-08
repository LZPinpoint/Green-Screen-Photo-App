import { DEFAULT_CONFIG } from './app'
import type { AppConfig, Env } from './types'

export function configFromEnv(env: Env): AppConfig {
  if (!env.SIGNING_SECRET || env.SIGNING_SECRET.length < 16) throw new Error('SIGNING_SECRET (>=16 chars) is required')
  return {
    ...DEFAULT_CONFIG,
    signingSecret: env.SIGNING_SECRET,
    adminKey: env.ADMIN_KEY,
    baseUrl: env.PUBLIC_BASE_URL || undefined,
    emailFrom: env.EMAIL_FROM || DEFAULT_CONFIG.emailFrom,
  }
}

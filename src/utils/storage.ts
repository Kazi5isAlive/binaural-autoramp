import type { SessionConfig } from '../types'
import { MAX_SAVED_CONFIGS, STORAGE_KEY } from '../types'

export function loadConfigs(): SessionConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SessionConfig[]
    return Array.isArray(parsed) ? parsed.slice(0, MAX_SAVED_CONFIGS) : []
  } catch {
    return []
  }
}

export function saveConfigs(configs: SessionConfig[]): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(configs.slice(0, MAX_SAVED_CONFIGS))
  )
}

export function upsertConfig(
  configs: SessionConfig[],
  config: SessionConfig
): SessionConfig[] {
  const idx = configs.findIndex((c) => c.name === config.name)
  let next: SessionConfig[]
  if (idx >= 0) {
    next = [...configs]
    next[idx] = config
  } else if (configs.length >= MAX_SAVED_CONFIGS) {
    next = [...configs.slice(0, MAX_SAVED_CONFIGS - 1), config]
  } else {
    next = [...configs, config]
  }
  saveConfigs(next)
  return next
}

export function deleteConfig(
  configs: SessionConfig[],
  name: string
): SessionConfig[] {
  const next = configs.filter((c) => c.name !== name)
  saveConfigs(next)
  return next
}

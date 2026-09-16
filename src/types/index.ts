export type MeditatorLevel = 'good' | 'fair' | 'poor'
export type Phase = 'idle' | 'ramp-in' | 'hold' | 'ramp-out' | 'done' | 'paused'

export interface SessionConfig {
  name: string
  meditatorLevel: MeditatorLevel
  targetHz: number
  baseHz: number
  stepDurationSec: number
  holdDurationSec: number
  volume: number
}

export interface ScheduleStep {
  beatHz: number
  durationSec: number
  phase: 'ramp-in' | 'hold' | 'ramp-out'
}

export interface SessionState {
  phase: Phase
  currentBeatHz: number
  stepIndex: number
  totalSteps: number
  stepRemainingSec: number
  totalRemainingSec: number
  totalElapsedSec: number
  totalDurationSec: number
  isRunning: boolean
  isPaused: boolean
}

export const TARGET_PRESETS = [4, 3.8, 3.75] as const

/** Absolute UI / clamp range for custom base (carrier) frequency */
export const BASE_HZ_MIN = 50
export const BASE_HZ_MAX = 16000

/**
 * Carrier presets grouped Low / Mid / High.
 * High (8–16 kHz) may be inaudible as pure tones for many adults;
 * the binaural beat still forms from the interaural difference.
 */
export const BASE_PRESET_GROUPS: ReadonlyArray<{
  label: string
  presets: readonly number[]
}> = [
  { label: 'Low', presets: [100, 500] },
  { label: 'Mid', presets: [2000, 5000] },
  { label: 'High', presets: [8000, 10000, 12000, 13000, 14000, 15000, 16000] },
]

/** Flat list of all preset carriers (kept for convenience / legacy checks) */
export const BASE_PRESETS = BASE_PRESET_GROUPS.flatMap((g) => [...g.presets]) as readonly number[]

export const RAMP_OUT_TARGET = 18 // beta ~15-20 Hz
export const RAMP_OUT_STEP_FACTOR = 0.4 // steeper = shorter steps
export const MAX_SAVED_CONFIGS = 5
export const STORAGE_KEY = 'binaural-autoramp-configs'

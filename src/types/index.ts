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
export const BASE_PRESETS = [100, 500, 2000, 5000] as const
export const RAMP_OUT_TARGET = 18 // beta ~15-20 Hz
export const RAMP_OUT_STEP_FACTOR = 0.4 // steeper = shorter steps
export const MAX_SAVED_CONFIGS = 5
export const STORAGE_KEY = 'binaural-autoramp-configs'

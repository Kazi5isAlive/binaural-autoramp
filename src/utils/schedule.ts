import type { MeditatorLevel, ScheduleStep, SessionConfig } from '../types'
import {
  BEAT_HZ_MAX,
  BEAT_HZ_MIN,
  RAMP_OUT_STEP_FACTOR,
} from '../types'

/** Preset ramp-in start for meditator level (used when picking Good/Fair/Poor). */
export function presetRampInStartHz(level: MeditatorLevel, targetHz: number): number {
  switch (level) {
    case 'good':
      return targetHz
    case 'fair':
      return 8
    case 'poor':
      return 12
  }
}

/** Effective ramp-in start used by the schedule builder. */
function clampBeatHz(raw: number, fallback: number): number {
  const value = Number.isFinite(raw) ? raw : fallback
  return Math.min(BEAT_HZ_MAX, Math.max(BEAT_HZ_MIN, value))
}

function roundBeatHz(value: number): number {
  return Number(value.toFixed(2))
}

/** Effective From value; the range fields are the schedule source of truth. */
export function resolveRampInStartHz(config: SessionConfig): number {
  const targetHz = clampBeatHz(config.targetHz, 4)
  return Math.max(targetHz, clampBeatHz(config.rampInStartHz, targetHz))
}

/** Effective Out-to value; legacy saved configs default to their From value. */
export function resolveRampOutTargetHz(config: SessionConfig): number {
  const targetHz = clampBeatHz(config.targetHz, 4)
  return Math.max(targetHz, clampBeatHz(config.rampOutTargetHz, config.rampInStartHz))
}

/**
 * Build full auto-ramp schedule: From → To → hold → Out-to.
 * The range controls are explicit: each leg advances in 1 Hz steps, preserving
 * fractional endpoints such as 3.8 or 3.75.
 */
export function buildSchedule(config: SessionConfig): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  const targetHz = clampBeatHz(config.targetHz, 4)
  const startHz = resolveRampInStartHz(config)
  const outTargetHz = resolveRampOutTargetHz(config)

  // --- Ramp In: From down to To ---
  if (startHz <= targetHz + 0.001) {
    steps.push({
      beatHz: targetHz,
      durationSec: Math.min(15, config.stepDurationSec),
      phase: 'ramp-in',
    })
  } else {
    let current = roundBeatHz(startHz)
    steps.push({ beatHz: current, durationSec: config.stepDurationSec, phase: 'ramp-in' })
    while (current - 1 > targetHz + 0.001) {
      current = roundBeatHz(current - 1)
      steps.push({ beatHz: current, durationSec: config.stepDurationSec, phase: 'ramp-in' })
    }
    if (Math.abs(current - targetHz) > 0.001) {
      steps.push({ beatHz: targetHz, durationSec: config.stepDurationSec, phase: 'ramp-in' })
    }
  }

  // --- Hold at To ---
  steps.push({
    beatHz: targetHz,
    durationSec: config.holdDurationSec,
    phase: 'hold',
  })

  // --- Ramp Out: To up to the explicit Out-to value ---
  const outStepDur = Math.max(
    Math.min(10, config.stepDurationSec),
    Math.round(config.stepDurationSec * RAMP_OUT_STEP_FACTOR)
  )
  if (outTargetHz > targetHz + 0.001) {
    let outHz = roundBeatHz(targetHz + 1)
    while (outHz < outTargetHz - 0.001) {
      steps.push({ beatHz: outHz, durationSec: outStepDur, phase: 'ramp-out' })
      outHz = roundBeatHz(outHz + 1)
    }
    steps.push({ beatHz: outTargetHz, durationSec: outStepDur, phase: 'ramp-out' })
  }

  return steps
}

export function totalDuration(steps: ScheduleStep[]): number {
  return steps.reduce((sum, s) => sum + s.durationSec, 0)
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

export function formatHz(hz: number): string {
  if (Number.isInteger(hz)) return String(hz)
  return parseFloat(hz.toFixed(2)).toString()
}

/** Compact schedule string like "8→7→…→4 · hold · 5→…→8" */
export function formatScheduleSummary(steps: ScheduleStep[]): string {
  const rampIn = steps.filter((s) => s.phase === 'ramp-in').map((s) => formatHz(s.beatHz))
  const rampOut = steps.filter((s) => s.phase === 'ramp-out').map((s) => formatHz(s.beatHz))
  const hold = steps.find((s) => s.phase === 'hold')
  const down =
    rampIn.length <= 4
      ? rampIn.join('→')
      : `${rampIn.slice(0, 2).join('→')}→…→${rampIn[rampIn.length - 1]}`
  const up =
    rampOut.length <= 4
      ? rampOut.join('→')
      : `${rampOut.slice(0, 2).join('→')}→…→${rampOut[rampOut.length - 1]}`
  const holdPart = hold ? `hold ${formatHz(hold.beatHz)}` : 'hold'
  return `${down} · ${holdPart} · ${up}`
}

export const DEFAULT_CONFIG: SessionConfig = {
  name: 'Default',
  meditatorLevel: 'good',
  rampInStartHz: 4,
  targetHz: 4,
  rampOutTargetHz: 4,
  baseHz: 12000,
  stepDurationSec: 45,
  holdDurationSec: 45 * 60,
  volume: 0.35,
}

/**
 * One-click short session: start at 8 Hz, step down to 4, hold, climb back up.
 * Hear the full down→up valley in a few minutes.
 */
export const QUICK_DEMO_CONFIG: SessionConfig = {
  name: 'Quick Demo',
  meditatorLevel: 'fair',
  rampInStartHz: 8,
  targetHz: 4,
  rampOutTargetHz: 8,
  baseHz: 12000,
  stepDurationSec: 8,
  holdDurationSec: 60,
  volume: 0.4,
}

/** Normalize legacy saved configs and add the explicit Out-to range value. */
export function normalizeConfig(raw: Partial<SessionConfig> & Pick<SessionConfig, 'name'>): SessionConfig {
  const level = raw.meditatorLevel ?? DEFAULT_CONFIG.meditatorLevel
  const targetHz = raw.targetHz ?? DEFAULT_CONFIG.targetHz
  const rampInStartHz =
    typeof raw.rampInStartHz === 'number' && Number.isFinite(raw.rampInStartHz)
      ? raw.rampInStartHz
      : presetRampInStartHz(level, targetHz)
  const rampOutTargetHz =
    typeof raw.rampOutTargetHz === 'number' && Number.isFinite(raw.rampOutTargetHz)
      ? raw.rampOutTargetHz
      : rampInStartHz
  return {
    name: raw.name || 'Config',
    meditatorLevel: level,
    rampInStartHz,
    targetHz,
    rampOutTargetHz,
    baseHz: raw.baseHz ?? DEFAULT_CONFIG.baseHz,
    stepDurationSec: raw.stepDurationSec ?? DEFAULT_CONFIG.stepDurationSec,
    holdDurationSec: raw.holdDurationSec ?? DEFAULT_CONFIG.holdDurationSec,
    volume: raw.volume ?? DEFAULT_CONFIG.volume,
  }
}

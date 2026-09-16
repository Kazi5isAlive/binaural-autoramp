import type { MeditatorLevel, ScheduleStep, SessionConfig } from '../types'
import {
  RAMP_IN_START_MAX,
  RAMP_IN_START_MIN,
  RAMP_OUT_TARGET,
  RAMP_OUT_STEP_FACTOR,
} from '../types'

/** Preset ramp-in start for meditator level (used when picking Good/Fair/Poor). */
export function presetRampInStartHz(level: MeditatorLevel, targetHz: number): number {
  switch (level) {
    case 'good':
      return targetHz
    case 'fair':
      return 10
    case 'poor':
      return 20
  }
}

/** Effective ramp-in start used by the schedule builder. */
export function resolveRampInStartHz(config: SessionConfig): number {
  if (config.meditatorLevel === 'good') return config.targetHz
  const raw = Number.isFinite(config.rampInStartHz)
    ? config.rampInStartHz
    : presetRampInStartHz(config.meditatorLevel, config.targetHz)
  const clamped = Math.min(
    RAMP_IN_START_MAX,
    Math.max(RAMP_IN_START_MIN, Math.round(raw))
  )
  return Math.max(clamped, Math.ceil(config.targetHz))
}

/**
 * Build full auto-ramp schedule: ramp-in → hold → ramp-out.
 * Steps down from ramp-in start to target, holds, then climbs toward ~18 Hz beta.
 */
export function buildSchedule(config: SessionConfig): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  const { meditatorLevel, targetHz, stepDurationSec, holdDurationSec } = config
  const startHz = resolveRampInStartHz(config)

  // --- Ramp In ---
  if (meditatorLevel === 'good' || startHz <= targetHz + 0.001) {
    steps.push({
      beatHz: targetHz,
      durationSec: Math.min(15, stepDurationSec),
      phase: 'ramp-in',
    })
  } else {
    let current = Math.round(startHz)
    while (current > targetHz + 0.05) {
      steps.push({
        beatHz: current,
        durationSec: stepDurationSec,
        phase: 'ramp-in',
      })
      current -= 1
    }
    steps.push({
      beatHz: targetHz,
      durationSec: stepDurationSec,
      phase: 'ramp-in',
    })
  }

  // --- Hold at target ---
  steps.push({
    beatHz: targetHz,
    durationSec: holdDurationSec,
    phase: 'hold',
  })

  // --- Ramp Out: steeper (shorter steps) back toward beta ---
  // Allow shorter out-steps when step duration is already short (e.g. Quick Demo)
  const outStepDur = Math.max(
    Math.min(10, stepDurationSec),
    Math.round(stepDurationSec * RAMP_OUT_STEP_FACTOR)
  )
  let outHz = Math.ceil(targetHz + 0.01)
  while (outHz <= RAMP_OUT_TARGET) {
    steps.push({
      beatHz: outHz,
      durationSec: outStepDur,
      phase: 'ramp-out',
    })
    outHz += 1
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

/** Compact schedule string like "20→19→…→4 · hold · 5→…→18" */
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
  meditatorLevel: 'poor',
  rampInStartHz: 20,
  targetHz: 4,
  baseHz: 100,
  stepDurationSec: 45,
  holdDurationSec: 45 * 60,
  volume: 0.35,
}

/**
 * One-click short session: start ~20 Hz (beta), step down to 4, hold, climb back up.
 * Hear the full down→up valley in a few minutes.
 */
export const QUICK_DEMO_CONFIG: SessionConfig = {
  name: 'Quick Demo',
  meditatorLevel: 'poor',
  rampInStartHz: 20,
  targetHz: 4,
  baseHz: 200,
  stepDurationSec: 8,
  holdDurationSec: 60,
  volume: 0.4,
}

/** Normalize legacy saved configs missing rampInStartHz */
export function normalizeConfig(raw: Partial<SessionConfig> & Pick<SessionConfig, 'name'>): SessionConfig {
  const level = raw.meditatorLevel ?? DEFAULT_CONFIG.meditatorLevel
  const targetHz = raw.targetHz ?? DEFAULT_CONFIG.targetHz
  const rampInStartHz =
    typeof raw.rampInStartHz === 'number' && Number.isFinite(raw.rampInStartHz)
      ? raw.rampInStartHz
      : presetRampInStartHz(level, targetHz)
  return {
    name: raw.name || 'Config',
    meditatorLevel: level,
    rampInStartHz,
    targetHz,
    baseHz: raw.baseHz ?? DEFAULT_CONFIG.baseHz,
    stepDurationSec: raw.stepDurationSec ?? DEFAULT_CONFIG.stepDurationSec,
    holdDurationSec: raw.holdDurationSec ?? DEFAULT_CONFIG.holdDurationSec,
    volume: raw.volume ?? DEFAULT_CONFIG.volume,
  }
}

import type { MeditatorLevel, ScheduleStep, SessionConfig } from '../types'
import { RAMP_OUT_TARGET, RAMP_OUT_STEP_FACTOR } from '../types'

/** Starting beat Hz for ramp-in by meditator level */
export function rampInStartHz(level: MeditatorLevel, targetHz: number): number {
  switch (level) {
    case 'good':
      return targetHz // little/no ramp-in — go to target immediately
    case 'fair':
      return 10
    case 'poor':
      return 20
  }
}

/**
 * Build full auto-ramp schedule: ramp-in → hold → ramp-out.
 * Fair: 10→9→…→target; Poor: 20→19→…→target; Good: straight to target.
 * Ramp-out is steeper (shorter steps) back toward ~18 Hz beta.
 */
export function buildSchedule(config: SessionConfig): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  const { meditatorLevel, targetHz, stepDurationSec, holdDurationSec } = config
  const startHz = rampInStartHz(meditatorLevel, targetHz)

  // --- Ramp In ---
  if (meditatorLevel === 'good' || startHz <= targetHz + 0.001) {
    // Immediate settle at target (brief), then hold handles the long stay
    steps.push({
      beatHz: targetHz,
      durationSec: Math.min(15, stepDurationSec),
      phase: 'ramp-in',
    })
  } else {
    // Integer steps down from startHz toward target (inclusive of integers above target)
    let current = Math.round(startHz)
    while (current > targetHz + 0.05) {
      steps.push({
        beatHz: current,
        durationSec: stepDurationSec,
        phase: 'ramp-in',
      })
      current -= 1
    }
    // Final ramp-in step lands on exact target
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
  const outStepDur = Math.max(10, Math.round(stepDurationSec * RAMP_OUT_STEP_FACTOR))
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

export const DEFAULT_CONFIG: SessionConfig = {
  name: 'Default',
  meditatorLevel: 'fair',
  targetHz: 4,
  baseHz: 100,
  stepDurationSec: 60,
  holdDurationSec: 45 * 60,
  volume: 0.35,
}

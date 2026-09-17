import type {
  CarrierCue,
  ScheduleStep,
  SessionConfig,
  StepPhase,
} from '../types'
import {
  BEAT_HZ_MAX,
  BEAT_HZ_MIN,
  RAMP_OUT_STEP_FACTOR,
  STEP_DURATION_MAX,
  STEP_DURATION_MIN,
} from '../types'

function clampBeatHz(raw: number, fallback: number): number {
  const value = Number.isFinite(raw) ? raw : fallback
  return Math.min(BEAT_HZ_MAX, Math.max(BEAT_HZ_MIN, value))
}

function roundBeatHz(value: number): number {
  return Number(value.toFixed(2))
}

function clampStepDuration(sec: number): number {
  const v = Number.isFinite(sec) ? sec : 45
  return Math.min(STEP_DURATION_MAX, Math.max(STEP_DURATION_MIN, Math.round(v)))
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

export const CLASSIC_CARRIER_SCHEDULE: CarrierCue[] = [
  { baseHz: 512, atPhase: 'entry' },
  { baseHz: 256, atPhase: 'hold' },
  { baseHz: 128, atPhase: 'deep-hold' },
]

/** Default hero preset — Classic Deep Session. */
export const DEFAULT_CONFIG: SessionConfig = {
  name: 'Classic Deep Session',
  programId: 'classic-deep',
  rampInStartHz: 10,
  targetHz: 4,
  rampOutTargetHz: 10,
  entryMode: 'stepped',
  stepDurationSec: 45,
  glideDurationSec: 6 * 60,
  holdDurationSec: 30 * 60,
  wakeEnabled: true,
  wakeIntervalSec: 5 * 60,
  wakeHz: 8,
  wakeDurationSec: 30,
  dipEnabled: true,
  dipMode: 'every-n-minutes',
  dipEveryNWakes: 3,
  dipIntervalSec: 15 * 60,
  dipHz: 2,
  dipDurationSec: 90,
  carrierMode: 'classic',
  baseHz: 512,
  carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE],
  exitMode: 'short-ramp',
  volume: 0.35,
  jetEnabled: true,
  jetMix: 0.2,
}

/** Less-experienced entry (20→4) variant of the classic program. */
export const CLASSIC_DEEP_LESS_EXPERIENCED: SessionConfig = {
  ...DEFAULT_CONFIG,
  name: 'Classic Deep · longer entry',
  rampInStartHz: 20,
  rampOutTargetHz: 10,
}

/**
 * Short hearable demo of the full program shape (entry, wake, dip, exit).
 * Durations compressed so you can verify the path quickly.
 */
export const QUICK_DEMO_CONFIG: SessionConfig = {
  name: 'Quick Demo',
  programId: 'classic-deep',
  rampInStartHz: 10,
  targetHz: 4,
  rampOutTargetHz: 10,
  entryMode: 'stepped',
  stepDurationSec: 30,
  glideDurationSec: 60,
  holdDurationSec: 4 * 60,
  wakeEnabled: true,
  wakeIntervalSec: 90,
  wakeHz: 8,
  wakeDurationSec: 20,
  dipEnabled: true,
  dipMode: 'every-n-wakes',
  dipEveryNWakes: 2,
  dipIntervalSec: 120,
  dipHz: 2,
  dipDurationSec: 30,
  carrierMode: 'classic',
  baseHz: 512,
  carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE],
  exitMode: 'short-ramp',
  volume: 0.4,
  jetEnabled: true,
  jetMix: 0.2,
}

/** Manual / high-carrier alternate — fixed 12 kHz carrier, simple path. */
export const HIGH_CARRIER_CONFIG: SessionConfig = {
  ...DEFAULT_CONFIG,
  name: 'High Carrier Hold',
  programId: 'manual',
  carrierMode: 'high',
  baseHz: 12000,
  carrierSchedule: [],
  wakeEnabled: false,
  dipEnabled: false,
  exitMode: 'gentle-stop',
  rampOutTargetHz: 4,
}

function resolveCarrierTimeline(
  config: SessionConfig,
  entryDurationSec: number,
  holdDurationSec: number,
  totalDurationSec: number
): Array<{ atTimeSec: number; baseHz: number }> {
  if (config.carrierMode === 'fixed' || config.carrierMode === 'high') {
    return [{ atTimeSec: 0, baseHz: config.baseHz }]
  }

  const cues =
    config.carrierSchedule?.length > 0
      ? config.carrierSchedule
      : CLASSIC_CARRIER_SCHEDULE

  const deepHoldAt = entryDurationSec + Math.min(
    holdDurationSec * 0.33,
    Math.max(10 * 60, holdDurationSec * 0.25)
  )

  const resolved: Array<{ atTimeSec: number; baseHz: number }> = []
  for (const cue of cues) {
    let at = cue.atTimeSec
    if (at == null) {
      switch (cue.atPhase) {
        case 'entry':
          at = 0
          break
        case 'hold':
          at = entryDurationSec
          break
        case 'deep-hold':
          at = deepHoldAt
          break
        case 'exit':
          at = entryDurationSec + holdDurationSec
          break
        default:
          at = 0
      }
    }
    resolved.push({
      atTimeSec: Math.max(0, Math.min(at, totalDurationSec)),
      baseHz: Math.max(50, cue.baseHz),
    })
  }

  if (resolved.length === 0) {
    resolved.push({ atTimeSec: 0, baseHz: config.baseHz || 512 })
  }

  resolved.sort((a, b) => a.atTimeSec - b.atTimeSec)
  // Ensure t=0 has a carrier
  if (resolved[0].atTimeSec > 0) {
    resolved.unshift({ atTimeSec: 0, baseHz: resolved[0].baseHz })
  }
  return resolved
}

function carrierAt(
  timeline: Array<{ atTimeSec: number; baseHz: number }>,
  t: number
): number {
  let base = timeline[0]?.baseHz ?? 512
  for (const cue of timeline) {
    if (cue.atTimeSec <= t + 0.001) base = cue.baseHz
    else break
  }
  return base
}

function pushStep(
  steps: ScheduleStep[],
  beatHz: number,
  durationSec: number,
  phase: StepPhase,
  baseHz: number,
  label?: string
): void {
  if (durationSec <= 0.001) return
  steps.push({
    beatHz: roundBeatHz(beatHz),
    durationSec: Math.round(durationSec * 100) / 100,
    phase,
    baseHz,
    label,
  })
}

function buildEntrySteps(
  config: SessionConfig,
  startHz: number,
  targetHz: number,
  carrierTimeline: Array<{ atTimeSec: number; baseHz: number }>
): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  let t = 0

  if (config.entryMode === 'smooth-glide' && startHz > targetHz + 0.001) {
    const glideSec = Math.max(60, config.glideDurationSec || 360)
    const span = startHz - targetHz
    // ~0.1 Hz micro-steps across the glide
    const n = Math.max(10, Math.round(span * 10))
    const dt = glideSec / n
    for (let i = 0; i <= n; i++) {
      const hz = roundBeatHz(startHz - (span * i) / n)
      pushStep(steps, hz, dt, 'ramp-in', carrierAt(carrierTimeline, t), 'Entry glide')
      t += dt
    }
    return steps
  }

  const stepDur = clampStepDuration(config.stepDurationSec)
  if (startHz <= targetHz + 0.001) {
    pushStep(steps, targetHz, Math.min(15, stepDur), 'ramp-in', carrierAt(carrierTimeline, 0), 'Entry')
    return steps
  }

  let current = roundBeatHz(startHz)
  pushStep(steps, current, stepDur, 'ramp-in', carrierAt(carrierTimeline, t), 'Entry')
  t += stepDur
  while (current - 1 > targetHz + 0.001) {
    current = roundBeatHz(current - 1)
    pushStep(steps, current, stepDur, 'ramp-in', carrierAt(carrierTimeline, t), 'Entry')
    t += stepDur
  }
  if (Math.abs(current - targetHz) > 0.001) {
    pushStep(steps, targetHz, stepDur, 'ramp-in', carrierAt(carrierTimeline, t), 'Entry')
  }
  return steps
}

interface HoldEvent {
  atSec: number
  kind: 'wake' | 'dip'
  hz: number
  durationSec: number
}

function buildHoldEvents(config: SessionConfig, holdDurationSec: number): HoldEvent[] {
  const events: HoldEvent[] = []
  if (holdDurationSec <= 0) return events

  const wakeInterval = Math.max(60, config.wakeIntervalSec || 300)
  const wakeDur = Math.max(5, config.wakeDurationSec || 30)
  const wakeHz = clampBeatHz(config.wakeHz ?? 8, 8)
  const dipDur = Math.max(10, config.dipDurationSec || 90)
  const dipHz = clampBeatHz(config.dipHz ?? 2, 2)

  if (config.wakeEnabled) {
    let wakeIndex = 0
    for (let at = wakeInterval; at + wakeDur <= holdDurationSec + 0.5; at += wakeInterval) {
      wakeIndex += 1
      const isDipInstead =
        config.dipEnabled &&
        config.dipMode === 'every-n-wakes' &&
        config.dipEveryNWakes > 0 &&
        wakeIndex % config.dipEveryNWakes === 0

      if (isDipInstead) {
        if (at + dipDur <= holdDurationSec + 0.5) {
          events.push({ atSec: at, kind: 'dip', hz: dipHz, durationSec: dipDur })
        }
      } else {
        events.push({ atSec: at, kind: 'wake', hz: wakeHz, durationSec: wakeDur })
      }
    }
  }

  if (config.dipEnabled && config.dipMode === 'every-n-minutes') {
    const dipInterval = Math.max(60, config.dipIntervalSec || 15 * 60)
    for (let at = dipInterval; at + dipDur <= holdDurationSec + 0.5; at += dipInterval) {
      // Prefer dip if it collides with a wake (± half wake interval slack)
      const collision = events.findIndex(
        (e) => Math.abs(e.atSec - at) < Math.min(wakeInterval, dipInterval) * 0.4
      )
      if (collision >= 0) {
        events[collision] = { atSec: at, kind: 'dip', hz: dipHz, durationSec: dipDur }
      } else {
        events.push({ atSec: at, kind: 'dip', hz: dipHz, durationSec: dipDur })
      }
    }
  }

  events.sort((a, b) => a.atSec - b.atSec)
  // Deduplicate exact times (dip wins)
  const deduped: HoldEvent[] = []
  for (const ev of events) {
    const last = deduped[deduped.length - 1]
    if (last && Math.abs(last.atSec - ev.atSec) < 1) {
      if (ev.kind === 'dip') deduped[deduped.length - 1] = ev
    } else {
      deduped.push(ev)
    }
  }
  return deduped
}

function buildHoldSteps(
  config: SessionConfig,
  targetHz: number,
  holdDurationSec: number,
  entryDurationSec: number,
  carrierTimeline: Array<{ atTimeSec: number; baseHz: number }>
): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  const events = buildHoldEvents(config, holdDurationSec)
  let cursor = 0

  const absCarrier = (holdLocalT: number) =>
    carrierAt(carrierTimeline, entryDurationSec + holdLocalT)

  for (const ev of events) {
    if (ev.atSec > cursor + 0.05) {
      pushStep(
        steps,
        targetHz,
        ev.atSec - cursor,
        'hold',
        absCarrier(cursor),
        'Hold'
      )
      cursor = ev.atSec
    }
    const phase: StepPhase = ev.kind === 'wake' ? 'wake' : 'dip'
    const label =
      ev.kind === 'wake'
        ? `Wake ${formatHz(ev.hz)} Hz`
        : `Deep ${formatHz(ev.hz)} Hz`
    pushStep(steps, ev.hz, ev.durationSec, phase, absCarrier(cursor), label)
    cursor += ev.durationSec
  }

  if (cursor < holdDurationSec - 0.05) {
    pushStep(
      steps,
      targetHz,
      holdDurationSec - cursor,
      'hold',
      absCarrier(cursor),
      'Hold'
    )
  } else if (steps.length === 0) {
    pushStep(steps, targetHz, holdDurationSec, 'hold', absCarrier(0), 'Hold')
  }

  return steps
}

function buildExitSteps(
  config: SessionConfig,
  targetHz: number,
  outTargetHz: number,
  startTimeSec: number,
  carrierTimeline: Array<{ atTimeSec: number; baseHz: number }>
): ScheduleStep[] {
  const steps: ScheduleStep[] = []
  if (config.exitMode === 'gentle-stop') return steps

  const stepDur = Math.max(
    Math.min(10, config.stepDurationSec),
    Math.round(clampStepDuration(config.stepDurationSec) * RAMP_OUT_STEP_FACTOR)
  )

  let t = startTimeSec

  if (config.exitMode === 'short-ramp') {
    // Compact exit: target → mid → out (e.g. 4 → 8 → 10)
    const mid = roundBeatHz((targetHz + outTargetHz) / 2)
    const waypoints = [mid, outTargetHz].filter(
      (hz, i, arr) => hz > targetHz + 0.05 && (i === 0 || Math.abs(hz - arr[i - 1]) > 0.05)
    )
    // Prefer classic 4→8→10 shape when defaults match
    const classic =
      Math.abs(targetHz - 4) < 0.05 && Math.abs(outTargetHz - 10) < 0.05
        ? [8, 10]
        : waypoints
    for (const hz of classic) {
      pushStep(
        steps,
        hz,
        stepDur,
        'ramp-out',
        carrierAt(carrierTimeline, t),
        'Exit'
      )
      t += stepDur
    }
    return steps
  }

  // full-ramp: 1 Hz steps up
  if (outTargetHz > targetHz + 0.001) {
    let outHz = roundBeatHz(targetHz + 1)
    while (outHz < outTargetHz - 0.001) {
      pushStep(steps, outHz, stepDur, 'ramp-out', carrierAt(carrierTimeline, t), 'Exit')
      t += stepDur
      outHz = roundBeatHz(outHz + 1)
    }
    pushStep(
      steps,
      outTargetHz,
      stepDur,
      'ramp-out',
      carrierAt(carrierTimeline, t),
      'Exit'
    )
  }
  return steps
}

/**
 * Build full auto-ramp schedule:
 * Entry (stepped or glide) → Hold with interleaved wake pulses & deep dips → Exit.
 * Each step carries the active carrier (baseHz). Carrier ≠ beat.
 */
export function buildSchedule(config: SessionConfig): ScheduleStep[] {
  const targetHz = clampBeatHz(config.targetHz, 4)
  const startHz = resolveRampInStartHz(config)
  const outTargetHz = resolveRampOutTargetHz(config)
  const holdDurationSec = Math.max(0, config.holdDurationSec)

  // Provisional entry duration for carrier phase markers
  const stepDur = clampStepDuration(config.stepDurationSec)
  let provisionalEntry = 0
  if (config.entryMode === 'smooth-glide' && startHz > targetHz + 0.001) {
    provisionalEntry = Math.max(60, config.glideDurationSec || 360)
  } else if (startHz <= targetHz + 0.001) {
    provisionalEntry = Math.min(15, stepDur)
  } else {
    const span = Math.ceil(startHz - targetHz)
    provisionalEntry = (span + (Number.isInteger(startHz - targetHz) ? 0 : 1)) * stepDur
    // Count steps like the builder: start + each -1 until target
    let n = 1
    let c = startHz
    while (c - 1 > targetHz + 0.001) {
      c -= 1
      n += 1
    }
    if (Math.abs(c - targetHz) > 0.001) n += 1
    provisionalEntry = n * stepDur
  }

  const provisionalTotal =
    provisionalEntry +
    holdDurationSec +
    (config.exitMode === 'gentle-stop' ? 0 : 3 * stepDur)

  const carrierTimeline = resolveCarrierTimeline(
    config,
    provisionalEntry,
    holdDurationSec,
    provisionalTotal
  )

  const entry = buildEntrySteps(config, startHz, targetHz, carrierTimeline)
  const entryDurationSec = totalDuration(entry)
  // Rebuild carrier with accurate entry length
  const carrierTimelineFinal = resolveCarrierTimeline(
    config,
    entryDurationSec,
    holdDurationSec,
    entryDurationSec + holdDurationSec + 180
  )

  // Re-stamp entry carriers with final timeline
  let tStamp = 0
  for (const step of entry) {
    step.baseHz = carrierAt(carrierTimelineFinal, tStamp)
    tStamp += step.durationSec
  }

  const hold = buildHoldSteps(
    config,
    targetHz,
    holdDurationSec,
    entryDurationSec,
    carrierTimelineFinal
  )
  const afterHold = entryDurationSec + holdDurationSec
  const exit = buildExitSteps(
    config,
    targetHz,
    outTargetHz,
    afterHold,
    carrierTimelineFinal
  )

  return [...entry, ...hold, ...exit]
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

export function formatBaseLabel(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz` : `${hz} Hz`
}

/** Compact schedule string including wake/dip markers. */
export function formatScheduleSummary(steps: ScheduleStep[]): string {
  const rampIn = steps.filter((s) => s.phase === 'ramp-in').map((s) => formatHz(s.beatHz))
  const rampOut = steps.filter((s) => s.phase === 'ramp-out').map((s) => formatHz(s.beatHz))
  const wakes = steps.filter((s) => s.phase === 'wake').length
  const dips = steps.filter((s) => s.phase === 'dip').length
  const holdSteps = steps.filter((s) => s.phase === 'hold')
  const holdHz = holdSteps[0]?.beatHz

  const down =
    rampIn.length === 0
      ? '—'
      : rampIn.length <= 4
        ? rampIn.join('→')
        : `${rampIn.slice(0, 2).join('→')}→…→${rampIn[rampIn.length - 1]}`
  const up =
    rampOut.length === 0
      ? 'stop'
      : rampOut.length <= 4
        ? rampOut.join('→')
        : `${rampOut.slice(0, 2).join('→')}→…→${rampOut[rampOut.length - 1]}`

  const holdPart =
    holdHz != null
      ? `hold ${formatHz(holdHz)}${wakes ? ` · ${wakes} wake` : ''}${dips ? ` · ${dips} dip` : ''}`
      : 'hold'
  return `${down} · ${holdPart} · ${up}`
}

/** Next interesting event label after stepIndex (wake / dip / exit / done). */
export function upcomingEventLabel(steps: ScheduleStep[], stepIndex: number): string {
  for (let i = stepIndex + 1; i < steps.length; i++) {
    const s = steps[i]
    if (s.phase === 'wake') return `Wake ${formatHz(s.beatHz)} Hz in ${formatDuration(timeUntil(steps, stepIndex, i))}`
    if (s.phase === 'dip') return `Deep ${formatHz(s.beatHz)} Hz in ${formatDuration(timeUntil(steps, stepIndex, i))}`
    if (s.phase === 'ramp-out') return `Exit ramp in ${formatDuration(timeUntil(steps, stepIndex, i))}`
  }
  if (stepIndex >= 0 && stepIndex < steps.length - 1) {
    return `Next: ${steps[stepIndex + 1].label ?? steps[stepIndex + 1].phase}`
  }
  return stepIndex >= steps.length - 1 ? 'Session end' : ''
}

function timeUntil(steps: ScheduleStep[], fromIndex: number, toIndex: number): number {
  // Approximate: remaining of current unknown; sum full steps between
  let sec = 0
  for (let i = fromIndex + 1; i < toIndex; i++) sec += steps[i].durationSec
  return sec
}

/** Human phase name for the monitor badge. */
export function phaseDisplayName(phase: string): string {
  switch (phase) {
    case 'ramp-in':
      return 'Entry'
    case 'hold':
      return 'Hold'
    case 'wake':
      return 'Wake'
    case 'dip':
      return 'Deep'
    case 'ramp-out':
      return 'Exit'
    case 'done':
      return 'Done'
    case 'paused':
      return 'Paused'
    default:
      return 'Ready'
  }
}

/** Normalize legacy saved configs to the classic-session shape. */
export function normalizeConfig(
  raw: Partial<SessionConfig> & Pick<SessionConfig, 'name'>
): SessionConfig {
  const base = DEFAULT_CONFIG
  const rampInStartHz =
    typeof raw.rampInStartHz === 'number' && Number.isFinite(raw.rampInStartHz)
      ? raw.rampInStartHz
      : base.rampInStartHz
  const targetHz = raw.targetHz ?? base.targetHz
  const rampOutTargetHz =
    typeof raw.rampOutTargetHz === 'number' && Number.isFinite(raw.rampOutTargetHz)
      ? raw.rampOutTargetHz
      : rampInStartHz

  // Legacy meditatorLevel → entry start
  const legacy = raw as Partial<SessionConfig> & { meditatorLevel?: string }
  let resolvedStart = rampInStartHz
  if (
    legacy.meditatorLevel &&
    (raw.rampInStartHz == null || !Number.isFinite(raw.rampInStartHz))
  ) {
    if (legacy.meditatorLevel === 'poor') resolvedStart = 12
    else if (legacy.meditatorLevel === 'fair') resolvedStart = 8
    else resolvedStart = targetHz
  }

  const carrierMode =
    raw.carrierMode ??
    (raw.baseHz != null && raw.baseHz >= 8000 ? 'high' : base.carrierMode)

  return {
    name: raw.name || 'Config',
    programId: raw.programId ?? 'manual',
    rampInStartHz: resolvedStart,
    targetHz,
    rampOutTargetHz,
    entryMode: raw.entryMode ?? 'stepped',
    stepDurationSec: raw.stepDurationSec ?? base.stepDurationSec,
    glideDurationSec: raw.glideDurationSec ?? base.glideDurationSec,
    holdDurationSec: raw.holdDurationSec ?? base.holdDurationSec,
    wakeEnabled: raw.wakeEnabled ?? false,
    wakeIntervalSec: raw.wakeIntervalSec ?? base.wakeIntervalSec,
    wakeHz: raw.wakeHz ?? base.wakeHz,
    wakeDurationSec: raw.wakeDurationSec ?? base.wakeDurationSec,
    dipEnabled: raw.dipEnabled ?? false,
    dipMode: raw.dipMode ?? base.dipMode,
    dipEveryNWakes: raw.dipEveryNWakes ?? base.dipEveryNWakes,
    dipIntervalSec: raw.dipIntervalSec ?? base.dipIntervalSec,
    dipHz: raw.dipHz ?? base.dipHz,
    dipDurationSec: raw.dipDurationSec ?? base.dipDurationSec,
    carrierMode,
    baseHz: raw.baseHz ?? (carrierMode === 'classic' ? 512 : base.baseHz),
    carrierSchedule:
      raw.carrierSchedule && raw.carrierSchedule.length > 0
        ? raw.carrierSchedule
        : carrierMode === 'classic'
          ? [...CLASSIC_CARRIER_SCHEDULE]
          : [],
    exitMode: raw.exitMode ?? (rampOutTargetHz > targetHz + 0.05 ? 'full-ramp' : 'gentle-stop'),
    volume: raw.volume ?? base.volume,
    jetEnabled: raw.jetEnabled ?? base.jetEnabled,
    jetMix:
      typeof raw.jetMix === 'number' && Number.isFinite(raw.jetMix)
        ? Math.min(1, Math.max(0, raw.jetMix))
        : base.jetMix,
  }
}

/** One-click load of the Classic Deep Session hero preset. */
export function loadClassicDeep(experienced = true): SessionConfig {
  return experienced
    ? { ...DEFAULT_CONFIG, carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE] }
    : {
        ...CLASSIC_DEEP_LESS_EXPERIENCED,
        carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE],
      }
}

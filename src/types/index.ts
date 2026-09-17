export type StepPhase = 'ramp-in' | 'hold' | 'wake' | 'dip' | 'ramp-out'
export type Phase = 'idle' | StepPhase | 'done' | 'paused'

/** How the entry beat descends to the hold target. */
export type EntryMode = 'stepped' | 'smooth-glide'

/** Carrier automation vs a single fixed base. */
export type CarrierMode = 'classic' | 'high' | 'fixed'

/** How to leave the hold. */
export type ExitMode = 'gentle-stop' | 'short-ramp' | 'full-ramp'

/** Dip cadence relative to wake pulses or wall-clock. */
export type DipMode = 'every-n-wakes' | 'every-n-minutes'

/**
 * Carrier cue — carrier ≠ beat.
 * `atTimeSec` is absolute session time; `atPhase` resolves when the schedule is built.
 */
export interface CarrierCue {
  baseHz: number
  atTimeSec?: number
  atPhase?: 'entry' | 'hold' | 'deep-hold' | 'exit'
}

export interface SessionConfig {
  name: string
  /** Hero program vs freeform manual tweaks (same engine). */
  programId: 'classic-deep' | 'manual'

  /** Entry ramp start beat (experienced ~10, less-experienced ~20). */
  rampInStartHz: number
  /** Hold / valley beat frequency. */
  targetHz: number
  /** Exit ramp end beat (when exitMode ramps up). */
  rampOutTargetHz: number
  entryMode: EntryMode
  /** Seconds per 1 Hz entry step (30–180). Ignored for smooth-glide. */
  stepDurationSec: number
  /** Smooth glide duration when entryMode is smooth-glide (default 360). */
  glideDurationSec: number

  /** Main hold length at targetHz. */
  holdDurationSec: number

  wakeEnabled: boolean
  /** Seconds between wake pulse starts during hold. */
  wakeIntervalSec: number
  wakeHz: number
  wakeDurationSec: number

  dipEnabled: boolean
  dipMode: DipMode
  /** When dipMode is every-n-wakes (e.g. 3 = every 3rd wake becomes a dip). */
  dipEveryNWakes: number
  /** When dipMode is every-n-minutes. */
  dipIntervalSec: number
  dipHz: number
  dipDurationSec: number

  carrierMode: CarrierMode
  /**
   * Fixed / high-mode carrier. Classic mode uses carrierSchedule instead,
   * but baseHz still seeds the first cue if the schedule is empty.
   */
  baseHz: number
  /** Classic carrier automation: 512 → 256 → 128 by default. */
  carrierSchedule: CarrierCue[]

  exitMode: ExitMode
  volume: number
  /**
   * Tone softness / warmth (0–1). Same beat + carrier Hz; softer = gentler
   * lowpass + slightly lower perceived level. Default leans warm.
   */
  toneSoftness: number

  /** Jet-engine ambient bed (identical stereo — no competing beat). */
  jetEnabled: boolean
  /** 0–1 user mix; engine also enforces a max noise-to-carrier ratio. */
  jetMix: number

  /**
   * Optional isochronic clicks/pulses — same in both ears (true isochronic,
   * not a second binaural). Layers with binaural + jet; independent mix.
   */
  isoEnabled: boolean
  /** 0–1 user mix; keep soft by default. Engine caps vs carrier. */
  isoMix: number
  /** Primary: follow current binaural beat Hz. Override: fixed pulse rate. */
  isoRateMode: 'follow-beat' | 'fixed'
  /** Used when isoRateMode is fixed (e.g. 15 / 20 Hz drill). */
  isoFixedHz: number
}

export interface ScheduleStep {
  beatHz: number
  durationSec: number
  phase: StepPhase
  /** Carrier (base) in effect for this step. Carrier ≠ beat. */
  baseHz: number
  label?: string
}

export interface SessionState {
  phase: Phase
  currentBeatHz: number
  currentBaseHz: number
  stepIndex: number
  totalSteps: number
  stepRemainingSec: number
  totalRemainingSec: number
  totalElapsedSec: number
  totalDurationSec: number
  isRunning: boolean
  isPaused: boolean
  /** Short label for the next wake/dip/exit after the current step. */
  upcomingLabel: string
}

export const TARGET_PRESETS = [4, 3.8, 3.75] as const

/** Absolute UI / clamp range for custom base (carrier) frequency */
export const BASE_HZ_MIN = 50
export const BASE_HZ_MAX = 16000

/** Beat-frequency range controls (separate from the carrier/base frequency). */
export const BEAT_HZ_MIN = 0.5
export const BEAT_HZ_MAX = 40
export const BEAT_HZ_STEP = 0.05

/**
 * Carrier presets grouped Low / Mid / High.
 * High (8–16 kHz) may be inaudible as pure tones for many adults;
 * the binaural beat still forms from the interaural difference.
 */
export const BASE_PRESET_GROUPS: ReadonlyArray<{
  label: string
  presets: readonly number[]
}> = [
  { label: 'Low', presets: [100, 128, 256, 500, 512] },
  { label: 'Mid', presets: [2000, 5000] },
  { label: 'High', presets: [8000, 10000, 12000, 13000, 14000, 15000, 16000] },
]

/** Flat list of all preset carriers (kept for convenience / legacy checks) */
export const BASE_PRESETS = BASE_PRESET_GROUPS.flatMap((g) => [...g.presets]) as readonly number[]

export const RAMP_OUT_STEP_FACTOR = 0.4 // steeper = shorter steps
export const MAX_SAVED_CONFIGS = 5
export const STORAGE_KEY = 'binaural-autoramp-configs'

export const STEP_DURATION_MIN = 30
export const STEP_DURATION_MAX = 180
export const HOLD_DURATION_MIN = 20 * 60
export const HOLD_DURATION_MAX = 90 * 60

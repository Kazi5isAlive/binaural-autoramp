import { useEffect, useMemo, useState } from 'react'
import { BeatPathChart } from './components/BeatPathChart'
import { useAutoRamp } from './hooks/useAutoRamp'
import type { CarrierMode, ExitMode, SessionConfig } from './types'
import {
  BASE_HZ_MAX,
  BASE_HZ_MIN,
  BASE_PRESET_GROUPS,
  BEAT_HZ_MAX,
  BEAT_HZ_MIN,
  BEAT_HZ_STEP,
  HOLD_DURATION_MAX,
  HOLD_DURATION_MIN,
  MAX_SAVED_CONFIGS,
  STEP_DURATION_MAX,
  STEP_DURATION_MIN,
  TARGET_PRESETS,
} from './types'
import {
  CLASSIC_CARRIER_SCHEDULE,
  DEFAULT_CONFIG,
  formatBaseLabel,
  formatDuration,
  formatHz,
  formatScheduleSummary,
  HIGH_CARRIER_CONFIG,
  loadClassicDeep,
  phaseDisplayName,
  QUICK_DEMO_CONFIG,
  totalDuration,
} from './utils/schedule'
import {
  deleteConfig,
  loadConfigs,
  upsertConfig,
} from './utils/storage'
import './index.css'

function clampBaseHz(hz: number): number {
  if (!Number.isFinite(hz)) return BASE_HZ_MIN
  return Math.min(BASE_HZ_MAX, Math.max(BASE_HZ_MIN, Math.round(hz)))
}

function clampBeatHz(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_CONFIG.targetHz
  return Math.min(BEAT_HZ_MAX, Math.max(BEAT_HZ_MIN, Number(hz.toFixed(2))))
}

function phaseStatusCopy(
  phase: string,
  currentBeatHz: number,
  targetHz: number,
  wakeHz: number,
  dipHz: number
): string {
  switch (phase) {
    case 'ramp-in':
      return `Entry · ${formatHz(currentBeatHz)} Hz → heading to ${formatHz(targetHz)} Hz`
    case 'hold':
      return `Hold at ${formatHz(targetHz)} Hz`
    case 'wake':
      return `Wake pulse · ${formatHz(currentBeatHz)} Hz (default ${formatHz(wakeHz)})`
    case 'dip':
      return `Deep dip · ${formatHz(currentBeatHz)} Hz (default ${formatHz(dipHz)})`
    case 'ramp-out':
      return `Exit · ${formatHz(currentBeatHz)} Hz`
    case 'done':
      return 'Session complete'
    case 'paused':
      return 'Paused'
    default:
      return 'Classic Deep Session · load & Start Auto-Ramp'
  }
}

export default function App() {
  const {
    state,
    start,
    pause,
    resume,
    stop,
    setVolume,
    setToneSoftness,
    setJetEnabled,
    setJetMix,
    previewSchedule,
  } = useAutoRamp()

  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState<SessionConfig[]>([])
  const [saveName, setSaveName] = useState('')
  const [customBaseDraft, setCustomBaseDraft] = useState(String(DEFAULT_CONFIG.baseHz))
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const sessionActive =
    state.isRunning || state.phase === 'done' || state.phase === 'paused'

  useEffect(() => {
    setSaved(loadConfigs())
  }, [])

  const schedule = useMemo(() => previewSchedule(config), [config, previewSchedule])
  const estTotal = useMemo(() => totalDuration(schedule), [schedule])

  const progressPct =
    state.totalDurationSec > 0
      ? Math.min(100, (state.totalElapsedSec / state.totalDurationSec) * 100)
      : 0

  const currentStepDuration =
    schedule[state.stepIndex]?.durationSec ?? config.stepDurationSec
  const stepProgress =
    sessionActive && currentStepDuration > 0
      ? 1 - state.stepRemainingSec / currentStepDuration
      : 0

  const update = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value, programId: 'manual' }))
    if (key === 'baseHz') setCustomBaseDraft(String(value as number))
  }

  const patch = (partial: Partial<SessionConfig>, asProgram = false) => {
    setConfig((c) => ({
      ...c,
      ...partial,
      programId: asProgram ? (partial.programId ?? 'classic-deep') : 'manual',
    }))
    if (partial.baseHz != null) setCustomBaseDraft(String(partial.baseHz))
  }

  const applyCustomBase = (raw: string) => {
    const clamped = clampBaseHz(Number(raw))
    setCustomBaseDraft(String(clamped))
    setConfig((c) => ({ ...c, baseHz: clamped, programId: 'manual' }))
  }

  const handleStart = async () => {
    await start(config)
  }

  const applyClassic = (experienced: boolean) => {
    if (state.isRunning || state.isPaused) return
    const next = loadClassicDeep(experienced)
    setConfig(next)
    setCustomBaseDraft(String(next.baseHz))
  }

  const applyQuickDemo = () => {
    if (state.isRunning || state.isPaused) return
    setConfig({ ...QUICK_DEMO_CONFIG, carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE] })
    setCustomBaseDraft(String(QUICK_DEMO_CONFIG.baseHz))
  }

  const applyHighCarrier = () => {
    if (state.isRunning || state.isPaused) return
    setConfig({ ...HIGH_CARRIER_CONFIG })
    setCustomBaseDraft(String(HIGH_CARRIER_CONFIG.baseHz))
  }

  const setCarrierMode = (mode: CarrierMode) => {
    if (mode === 'classic') {
      patch(
        {
          carrierMode: 'classic',
          baseHz: 512,
          carrierSchedule: [...CLASSIC_CARRIER_SCHEDULE],
        },
        true
      )
    } else if (mode === 'high') {
      patch({
        carrierMode: 'high',
        baseHz: 12000,
        carrierSchedule: [],
      })
    } else {
      patch({
        carrierMode: 'fixed',
        carrierSchedule: [],
      })
    }
  }

  const handleSave = () => {
    const name = saveName.trim() || `Config ${saved.length + 1}`
    const next = upsertConfig(saved, { ...config, name })
    setSaved(next)
    setSaveName('')
  }

  const handleLoad = (c: SessionConfig) => {
    if (state.isRunning) return
    setConfig({ ...c })
    setCustomBaseDraft(String(c.baseHz))
  }

  const handleDelete = (name: string) => {
    setSaved(deleteConfig(saved, name))
  }

  const locked = state.isRunning || state.isPaused

  const wakeCount = schedule.filter((s) => s.phase === 'wake').length
  const dipCount = schedule.filter((s) => s.phase === 'dip').length
  const displayCarrier =
    sessionActive && state.currentBaseHz > 0
      ? state.currentBaseHz
      : schedule[0]?.baseHz ?? config.baseHz

  const badgePhase =
    state.phase === 'wake'
      ? 'wake'
      : state.phase === 'dip'
        ? 'dip'
        : state.phase

  return (
    <div className="app">
      <header className="app-header">
        <h1>kazi5isalive Auto-Ramp</h1>
        <p className="tagline">Session programs · binaural beat ≠ carrier</p>
      </header>

      <div className="headphones-banner" role="status">
        <span className="icon" aria-hidden>
          🎧
        </span>
        <span>
          <strong>Stereo headphones required.</strong> Left ear = carrier (base);
          right ear = carrier + beat. Beat is the difference; carrier is the tone pair.
        </span>
      </div>

      {/* Hero program */}
      <section className={`card hero-card ${locked ? 'locked' : ''}`}>
        <div className="hero-badge">Session program</div>
        <h2 className="hero-title">Classic Deep Session</h2>
        <p className="hero-blurb">
          One Start runs the full path: entry ramp → long hold at 4 Hz with periodic
          wake pulses (↑8 Hz) and deep dips (↓2 Hz) → optional exit. Carrier steps
          512 → 256 → 128 Hz separately from the beat.
        </p>
        <ul className="hero-specs">
          <li>
            <strong>Entry</strong> 10→4 (or 20→4) · {formatDuration(config.stepDurationSec)}/step
          </li>
          <li>
            <strong>Hold</strong> {formatDuration(config.holdDurationSec)} at {formatHz(config.targetHz)} Hz
          </li>
          <li>
            <strong>Wake</strong> every {formatDuration(config.wakeIntervalSec)} · {formatHz(config.wakeHz)} Hz ×{' '}
            {formatDuration(config.wakeDurationSec)}
          </li>
          <li>
            <strong>Dip</strong> every {formatDuration(config.dipIntervalSec)} · {formatHz(config.dipHz)} Hz ×{' '}
            {formatDuration(config.dipDurationSec)}
          </li>
          <li>
            <strong>Carrier</strong> 512 → 256 → 128 Hz (not the beat)
          </li>
        </ul>
        <div className="hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={locked}
            onClick={() => applyClassic(true)}
          >
            Load Classic (10→4)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onClick={() => applyClassic(false)}
          >
            Longer entry (20→4)
          </button>
          <button
            type="button"
            className="btn btn-demo"
            disabled={locked}
            onClick={applyQuickDemo}
            title="Compressed classic shape for a quick listen"
          >
            Quick Demo
          </button>
        </div>
        <p className="hint" style={{ marginTop: '0.75rem' }}>
          Loaded preset · est. <strong className="accent">{formatDuration(estTotal)}</strong>
          {' · '}
          {wakeCount} wakes · {dipCount} dips · {formatScheduleSummary(schedule)}
        </p>
      </section>

      {/* Live session monitor */}
      <section className="card monitor" aria-live="polite">
        <h2>Session</h2>
        <div className={`phase-badge ${badgePhase}`}>
          {phaseDisplayName(
            state.phase === 'wake'
              ? 'wake'
              : state.phase === 'dip'
                ? 'dip'
                : state.phase
          )}
          {state.phase === 'wake' && config.wakeHz !== 8
            ? ` · ${formatHz(state.currentBeatHz)}`
            : ''}
          {state.phase === 'dip' && config.dipHz !== 2
            ? ` · ${formatHz(state.currentBeatHz)}`
            : ''}
        </div>

        <p className="phase-status">
          {phaseStatusCopy(
            state.phase,
            state.currentBeatHz,
            config.targetHz,
            config.wakeHz,
            config.dipHz
          )}
        </p>

        {(state.isRunning || state.phase === 'done' || state.phase === 'paused') && (
          <>
            <div className="live-metrics">
              <div className="beat-display">
                {formatHz(state.currentBeatHz)}
                <span className="unit">Hz beat</span>
              </div>
              <div className="carrier-display">
                {formatBaseLabel(displayCarrier)}
                <span className="unit">carrier</span>
              </div>
            </div>
            <div className="countdown">
              Step{' '}
              <strong>
                {Math.min(state.stepIndex + 1, state.totalSteps)}/{state.totalSteps}
              </strong>
              {' · '}
              Remaining this step:{' '}
              <strong>{formatDuration(state.stepRemainingSec)}</strong>
            </div>
            {state.upcomingLabel && (
              <p className="upcoming">{state.upcomingLabel}</p>
            )}
            <div className="progress-bar" role="progressbar" aria-valuenow={progressPct}>
              <div className="fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="progress-meta">
              <span>{formatDuration(state.totalElapsedSec)}</span>
              <span>{formatDuration(state.totalRemainingSec)} left</span>
            </div>
          </>
        )}

        {!sessionActive && state.phase === 'idle' && (
          <p className="idle-blurb">
            Load <strong>Classic Deep Session</strong> above, then hit Start. Est.{' '}
            <strong className="accent">{formatDuration(estTotal)}</strong>
          </p>
        )}

        <div className="controls">
          {!state.isRunning && state.phase !== 'paused' && (
            <button className="btn btn-primary" onClick={handleStart}>
              {state.phase === 'done' ? 'Start Again' : 'Start Auto-Ramp'}
            </button>
          )}
          {state.isRunning && !state.isPaused && (
            <>
              <button className="btn btn-secondary" onClick={() => pause()}>
                Pause
              </button>
              <button className="btn btn-danger" onClick={() => stop()}>
                Stop
              </button>
            </>
          )}
          {state.isPaused && (
            <>
              <button className="btn btn-primary" onClick={() => resume()}>
                Resume
              </button>
              <button className="btn btn-danger" onClick={() => stop()}>
                Stop
              </button>
            </>
          )}
          {state.phase === 'done' && (
            <button className="btn btn-secondary" onClick={() => stop()}>
              Reset
            </button>
          )}
        </div>
      </section>

      {/* Beat path visualization */}
      <section className="card">
        <h2>Beat path</h2>
        <BeatPathChart
          schedule={schedule}
          stepIndex={sessionActive ? state.stepIndex : -1}
          stepProgress={stepProgress}
          isActive={sessionActive && state.phase !== 'done'}
        />
        <p className="hint path-hint">
          Hold shows upward wake spikes and downward deep dips. Carrier changes are
          separate from this beat path.
        </p>
      </section>

      {/* Schedule list */}
      <section className="card">
        <button
          type="button"
          className="schedule-toggle"
          onClick={() => setScheduleOpen((o) => !o)}
          aria-expanded={scheduleOpen}
        >
          <h2>Schedule steps</h2>
          <span className="schedule-toggle-meta">
            {schedule.length} steps · {formatScheduleSummary(schedule)} ·{' '}
            {scheduleOpen ? '▾' : '▸'}
          </span>
        </button>
        {scheduleOpen && (
          <div className="schedule-chips" role="list">
            {schedule.map((step, i) => {
              const isCurrent = sessionActive && i === state.stepIndex
              const isPast = sessionActive && i < state.stepIndex
              return (
                <span
                  key={`${step.phase}-${i}-${step.beatHz}`}
                  role="listitem"
                  className={`schedule-chip phase-${step.phase}${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}`}
                  title={`${step.phase}: ${formatHz(step.beatHz)} Hz beat · carrier ${formatBaseLabel(step.baseHz)} · ${formatDuration(step.durationSec)}`}
                >
                  {formatHz(step.beatHz)}
                  {(step.phase === 'wake' || step.phase === 'dip') && (
                    <em className="chip-tag">{step.phase}</em>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </section>

      {/* Program timing */}
      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Entry & hold</h2>
        <div className="field">
          <label>Entry start (beat Hz)</label>
          <div className="segmented">
            {[10, 20].map((hz) => (
              <button
                key={hz}
                type="button"
                className={config.rampInStartHz === hz ? 'active' : ''}
                disabled={locked}
                onClick={() =>
                  patch({
                    rampInStartHz: hz,
                    rampOutTargetHz: Math.max(config.rampOutTargetHz, hz > 10 ? 10 : config.rampOutTargetHz),
                  })
                }
              >
                {hz} → {formatHz(config.targetHz)}
              </button>
            ))}
            <button
              type="button"
              className={
                config.rampInStartHz !== 10 && config.rampInStartHz !== 20 ? 'active' : ''
              }
              disabled={locked}
              onClick={() => patch({ rampInStartHz: clampBeatHz(config.rampInStartHz) })}
            >
              Custom
            </button>
          </div>
        </div>
        <div className="range-fields">
          <div className="range-field">
            <label htmlFor="beat-from">From (Hz)</label>
            <input
              id="beat-from"
              type="number"
              min={BEAT_HZ_MIN}
              max={BEAT_HZ_MAX}
              step={BEAT_HZ_STEP}
              value={config.rampInStartHz}
              disabled={locked}
              onChange={(e) =>
                patch({
                  rampInStartHz: Math.max(clampBeatHz(Number(e.target.value)), config.targetHz),
                })
              }
            />
            <span>entry start</span>
          </div>
          <div className="range-field">
            <label htmlFor="beat-to">Hold (Hz)</label>
            <input
              id="beat-to"
              type="number"
              min={BEAT_HZ_MIN}
              max={BEAT_HZ_MAX}
              step={BEAT_HZ_STEP}
              value={config.targetHz}
              disabled={locked}
              onChange={(e) => {
                const toHz = clampBeatHz(Number(e.target.value))
                patch({
                  targetHz: toHz,
                  rampInStartHz: Math.max(config.rampInStartHz, toHz),
                  rampOutTargetHz: Math.max(config.rampOutTargetHz, toHz),
                })
              }}
            />
            <span>valley</span>
          </div>
          <div className="range-field">
            <label htmlFor="beat-out-to">Exit to (Hz)</label>
            <input
              id="beat-out-to"
              type="number"
              min={BEAT_HZ_MIN}
              max={BEAT_HZ_MAX}
              step={BEAT_HZ_STEP}
              value={config.rampOutTargetHz}
              disabled={locked}
              onChange={(e) =>
                patch({
                  rampOutTargetHz: Math.max(clampBeatHz(Number(e.target.value)), config.targetHz),
                })
              }
            />
            <span>ramp-out end</span>
          </div>
        </div>
        <div className="field range-presets">
          <label>Hold presets</label>
          <div className="segmented">
            {TARGET_PRESETS.map((hz) => (
              <button
                key={hz}
                type="button"
                className={config.targetHz === hz ? 'active' : ''}
                disabled={locked}
                onClick={() =>
                  patch({
                    targetHz: hz,
                    rampInStartHz: Math.max(config.rampInStartHz, hz),
                    rampOutTargetHz: Math.max(config.rampOutTargetHz, hz),
                  })
                }
              >
                {formatHz(hz)} Hz
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Entry mode</label>
          <div className="segmented">
            <button
              type="button"
              className={config.entryMode === 'stepped' ? 'active' : ''}
              disabled={locked}
              onClick={() => patch({ entryMode: 'stepped' })}
            >
              Stepped (1 Hz)
            </button>
            <button
              type="button"
              className={config.entryMode === 'smooth-glide' ? 'active' : ''}
              disabled={locked}
              onClick={() => patch({ entryMode: 'smooth-glide', glideDurationSec: 6 * 60 })}
            >
              Smooth 6-min glide
            </button>
          </div>
        </div>
        <div className="field">
          <label>Step duration (entry)</label>
          <div className="slider-row">
            <input
              type="range"
              min={STEP_DURATION_MIN}
              max={STEP_DURATION_MAX}
              step={5}
              value={config.stepDurationSec}
              disabled={locked || config.entryMode === 'smooth-glide'}
              onChange={(e) => patch({ stepDurationSec: Number(e.target.value) })}
            />
            <span className="value">{formatDuration(config.stepDurationSec)}</span>
          </div>
          <p className="hint">30 s – 3 min per 1 Hz step (default ~45–60 s).</p>
        </div>
        <div className="field">
          <label>Hold length</label>
          <div className="slider-row">
            <input
              type="range"
              min={HOLD_DURATION_MIN}
              max={HOLD_DURATION_MAX}
              step={60}
              value={Math.min(HOLD_DURATION_MAX, Math.max(HOLD_DURATION_MIN, config.holdDurationSec))}
              disabled={locked}
              onChange={(e) => patch({ holdDurationSec: Number(e.target.value) })}
            />
            <span className="value">{formatDuration(config.holdDurationSec)}</span>
          </div>
          <p className="hint">20–90 min at hold beat (default 30).</p>
        </div>
      </section>

      {/* Wake & dip */}
      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Wake pulses & deep dips</h2>
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.wakeEnabled}
              disabled={locked}
              onChange={(e) => patch({ wakeEnabled: e.target.checked })}
            />
            Wake pulses during hold (4 → {formatHz(config.wakeHz)} → 4)
          </label>
        </div>
        {config.wakeEnabled && (
          <>
            <div className="field">
              <label>Wake interval</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={60}
                  max={15 * 60}
                  step={30}
                  value={config.wakeIntervalSec}
                  disabled={locked}
                  onChange={(e) => patch({ wakeIntervalSec: Number(e.target.value) })}
                />
                <span className="value">{formatDuration(config.wakeIntervalSec)}</span>
              </div>
            </div>
            <div className="field">
              <label>Wake beat (Hz)</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={5}
                  max={12}
                  step={0.5}
                  value={config.wakeHz}
                  disabled={locked}
                  onChange={(e) => patch({ wakeHz: Number(e.target.value) })}
                />
                <span className="value">{formatHz(config.wakeHz)} Hz</span>
              </div>
            </div>
            <div className="field">
              <label>Wake duration</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={config.wakeDurationSec}
                  disabled={locked}
                  onChange={(e) => patch({ wakeDurationSec: Number(e.target.value) })}
                />
                <span className="value">{formatDuration(config.wakeDurationSec)}</span>
              </div>
            </div>
          </>
        )}
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.dipEnabled}
              disabled={locked}
              onChange={(e) => patch({ dipEnabled: e.target.checked })}
            />
            Deep dips during hold (4 → {formatHz(config.dipHz)} → 4)
          </label>
        </div>
        {config.dipEnabled && (
          <>
            <div className="field">
              <label>Dip cadence</label>
              <div className="segmented">
                <button
                  type="button"
                  className={config.dipMode === 'every-n-minutes' ? 'active' : ''}
                  disabled={locked}
                  onClick={() => patch({ dipMode: 'every-n-minutes' })}
                >
                  Every N minutes
                </button>
                <button
                  type="button"
                  className={config.dipMode === 'every-n-wakes' ? 'active' : ''}
                  disabled={locked}
                  onClick={() => patch({ dipMode: 'every-n-wakes' })}
                >
                  Every Nth wake
                </button>
              </div>
            </div>
            {config.dipMode === 'every-n-minutes' ? (
              <div className="field">
                <label>Dip interval</label>
                <div className="slider-row">
                  <input
                    type="range"
                    min={5 * 60}
                    max={30 * 60}
                    step={60}
                    value={config.dipIntervalSec}
                    disabled={locked}
                    onChange={(e) => patch({ dipIntervalSec: Number(e.target.value) })}
                  />
                  <span className="value">{formatDuration(config.dipIntervalSec)}</span>
                </div>
              </div>
            ) : (
              <div className="field">
                <label>Every Nth wake becomes a dip</label>
                <div className="slider-row">
                  <input
                    type="range"
                    min={2}
                    max={5}
                    step={1}
                    value={config.dipEveryNWakes}
                    disabled={locked}
                    onChange={(e) => patch({ dipEveryNWakes: Number(e.target.value) })}
                  />
                  <span className="value">every {config.dipEveryNWakes}</span>
                </div>
              </div>
            )}
            <div className="field">
              <label>Dip beat (Hz)</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={1}
                  max={3.5}
                  step={0.25}
                  value={config.dipHz}
                  disabled={locked}
                  onChange={(e) => patch({ dipHz: Number(e.target.value) })}
                />
                <span className="value">{formatHz(config.dipHz)} Hz</span>
              </div>
            </div>
            <div className="field">
              <label>Dip duration</label>
              <div className="slider-row">
                <input
                  type="range"
                  min={30}
                  max={120}
                  step={5}
                  value={config.dipDurationSec}
                  disabled={locked}
                  onChange={(e) => patch({ dipDurationSec: Number(e.target.value) })}
                />
                <span className="value">{formatDuration(config.dipDurationSec)}</span>
              </div>
              <p className="hint">Typically 60–90 s at the deep beat.</p>
            </div>
          </>
        )}
      </section>

      {/* Carrier */}
      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Carrier (base) — not the beat</h2>
        <p className="range-description">
          Carrier is the tone pair under the beat. Left = carrier; right = carrier + beat.
          Classic Deep Session automates 512 → 256 → 128 Hz across the session. High
          (12–14 kHz) remains available as an alternate mode.
        </p>
        <div className="field">
          <label>Carrier mode</label>
          <div className="segmented">
            {(
              [
                ['classic', 'Classic 512/256/128'],
                ['high', 'High 12–14 kHz'],
                ['fixed', 'Fixed'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={config.carrierMode === mode ? 'active' : ''}
                disabled={locked}
                onClick={() => setCarrierMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {config.carrierMode === 'classic' && (
          <div className="carrier-schedule-preview">
            {CLASSIC_CARRIER_SCHEDULE.map((cue) => (
              <span key={`${cue.baseHz}-${cue.atPhase}`} className="carrier-cue">
                {formatBaseLabel(cue.baseHz)}
                <em>{cue.atPhase}</em>
              </span>
            ))}
          </div>
        )}
        {config.carrierMode === 'high' && (
          <>
            <div className="field carrier-high-band">
              <label>High carrier presets</label>
              <div className="segmented">
                {[12000, 13000, 14000].map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    className={config.baseHz === hz ? 'active' : ''}
                    disabled={locked}
                    onClick={() => update('baseHz', hz)}
                  >
                    {formatBaseLabel(hz)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field carrier-band-picker">
              <label htmlFor="high-carrier-band">12–14 kHz band</label>
              <input
                id="high-carrier-band"
                type="range"
                min={12000}
                max={14000}
                step={100}
                value={Math.min(14000, Math.max(12000, config.baseHz))}
                disabled={locked}
                onChange={(e) => update('baseHz', Number(e.target.value))}
              />
              <div className="carrier-band-values">
                <span>12 kHz</span>
                <strong>{formatBaseLabel(Math.min(14000, Math.max(12000, config.baseHz)))}</strong>
                <span>14 kHz</span>
              </div>
            </div>
          </>
        )}
        {(config.carrierMode === 'fixed' || advancedOpen) && (
          <div className="field">
            <label>Carrier base (Hz)</label>
            <div className="base-groups">
              {BASE_PRESET_GROUPS.map((group) => (
                <div key={group.label} className="base-group">
                  <div className="base-group-label">{group.label}</div>
                  <div className="segmented">
                    {group.presets.map((hz) => (
                      <button
                        key={hz}
                        type="button"
                        className={config.baseHz === hz ? 'active' : ''}
                        disabled={locked}
                        onClick={() => {
                          update('baseHz', hz)
                          if (config.carrierMode === 'classic') {
                            patch({ carrierMode: 'fixed', baseHz: hz, carrierSchedule: [] })
                          }
                        }}
                      >
                        {formatBaseLabel(hz)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="custom-base-row">
              <label htmlFor="custom-base-hz">Custom base (Hz)</label>
              <input
                id="custom-base-hz"
                type="number"
                min={BASE_HZ_MIN}
                max={BASE_HZ_MAX}
                step={1}
                value={customBaseDraft}
                disabled={locked}
                onChange={(e) => setCustomBaseDraft(e.target.value)}
                onBlur={(e) => applyCustomBase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
              />
              <span className="custom-base-range">
                {BASE_HZ_MIN}–{BASE_HZ_MAX} Hz
              </span>
            </div>
          </div>
        )}
        <button
          type="button"
          className="linkish"
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? 'Hide' : 'Show'} manual carrier presets
        </button>
        <div className="field" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onClick={applyHighCarrier}
          >
            Load high-carrier alternate
          </button>
        </div>
      </section>

      {/* Exit */}
      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Exit</h2>
        <div className="segmented">
          {(
            [
              ['gentle-stop', 'Gentle stop at hold'],
              ['short-ramp', 'Short ramp (e.g. 4→8→10)'],
              ['full-ramp', 'Full step-up'],
            ] as Array<[ExitMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={config.exitMode === mode ? 'active' : ''}
              disabled={locked}
              onClick={() => patch({ exitMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: '0.5rem' }}>
          Short ramp is shorter than entry. Full ramp climbs 1 Hz at a time to Exit to.
        </p>
      </section>

      <section className="card">
        <h2>Volume & tone</h2>
        <div className="field">
          <label>Carrier volume</label>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.volume}
              onChange={(e) => {
                const v = Number(e.target.value)
                setConfig((c) => ({ ...c, volume: v }))
                if (state.isRunning) setVolume(v)
              }}
            />
            <span className="value">{Math.round(config.volume * 100)}%</span>
          </div>
          <p className="hint">
            Default is quieter. Keep comfortable — soft is fine. Avoid ear fatigue.
          </p>
        </div>
        <div className="field">
          <label>Tone softness</label>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.toneSoftness ?? 0.7}
              onChange={(e) => {
                const v = Number(e.target.value)
                setConfig((c) => ({ ...c, toneSoftness: v }))
                if (state.isRunning) setToneSoftness(v)
              }}
            />
            <span className="value">
              {Math.round((config.toneSoftness ?? 0.7) * 100)}%
            </span>
          </div>
          <p className="hint">
            Same beat &amp; carrier Hz — warmer lowpass and gentler level. Default
            leans soft; lower for a brighter sine.
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Jet engine noise</h2>
        <div className="field">
          <label className="check-row">
            <input
              type="checkbox"
              checked={config.jetEnabled}
              onChange={(e) => {
                const on = e.target.checked
                setConfig((c) => ({ ...c, jetEnabled: on }))
                if (state.isRunning) setJetEnabled(on)
              }}
            />
            Jet engine ambient bed
          </label>
          <p className="hint">
            Continuous stereo bed (never restarts mid-session). Beat stays in the
            pure tones; noise slowly ducks in deep hold.
          </p>
        </div>
        {config.jetEnabled && (
          <div className="field">
            <label>Jet mix / intensity</label>
            <div className="slider-row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={config.jetMix}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setConfig((c) => ({ ...c, jetMix: v }))
                  if (state.isRunning) setJetMix(v)
                }}
              />
              <span className="value">{Math.round(config.jetMix * 100)}%</span>
            </div>
            <p className="hint">
              Default ~20%. Slow multi-second swells only — no gaps. Hard-capped so
              noise never drowns the carriers.
            </p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Saved Configurations ({saved.length}/{MAX_SAVED_CONFIGS})</h2>
        <p className="hint" style={{ marginBottom: '0.75rem' }}>
          Save named presets for longer experiments.
        </p>
        {saved.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No saved configs yet.
          </p>
        )}
        <div className="config-list">
          {saved.map((c) => (
            <div key={c.name} className="config-item">
              <div>
                <div className="name">{c.name}</div>
                <div className="meta">
                  {formatHz(c.rampInStartHz)}→{formatHz(c.targetHz)} · hold{' '}
                  {formatDuration(c.holdDurationSec)} ·{' '}
                  {c.carrierMode === 'classic'
                    ? 'carrier auto'
                    : formatBaseLabel(c.baseHz)}
                </div>
              </div>
              <button
                type="button"
                className="small"
                disabled={locked}
                onClick={() => handleLoad(c)}
              >
                Load
              </button>
              <button
                type="button"
                className="small delete"
                onClick={() => handleDelete(c.name)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
        <div className="save-row">
          <input
            type="text"
            placeholder="Config name…"
            maxLength={40}
            value={saveName}
            disabled={locked}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={locked}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </section>

      <p className="note">
        These are <em>training wheels</em>. Eventually practice focus without beats —
        use them to learn the territory, then go free.
        <br />
        <span className="byline">kazi5isalive</span>
      </p>
    </div>
  )
}

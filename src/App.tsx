import { useEffect, useMemo, useState } from 'react'
import { BeatPathChart } from './components/BeatPathChart'
import { useAutoRamp } from './hooks/useAutoRamp'
import type { MeditatorLevel, SessionConfig } from './types'
import {
  BASE_HZ_MAX,
  BASE_HZ_MIN,
  BASE_PRESET_GROUPS,
  MAX_SAVED_CONFIGS,
  RAMP_IN_START_MAX,
  RAMP_IN_START_MIN,
  TARGET_PRESETS,
} from './types'
import {
  DEFAULT_CONFIG,
  formatDuration,
  formatHz,
  formatScheduleSummary,
  presetRampInStartHz,
  QUICK_DEMO_CONFIG,
  totalDuration,
} from './utils/schedule'
import {
  deleteConfig,
  loadConfigs,
  upsertConfig,
} from './utils/storage'
import './index.css'

function phaseStatusCopy(
  phase: string,
  currentBeatHz: number,
  targetHz: number
): string {
  switch (phase) {
    case 'ramp-in':
      return `Stepping DOWN · ${formatHz(currentBeatHz)} Hz → heading to ${formatHz(targetHz)} Hz`
    case 'hold':
      return `HOLD at ${formatHz(targetHz)} Hz`
    case 'ramp-out':
      return `Climbing UP · ${formatHz(currentBeatHz)} Hz → toward beta`
    case 'done':
      return 'Journey complete · down → hold → up'
    case 'paused':
      return 'Paused'
    default:
      return 'Ready · beta → theta → beta'
  }
}

function levelLabel(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair · start 10 (alpha)'
    case 'poor':
      return 'Poor · start 20 (beta)'
  }
}

function levelHint(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Little/no ramp-in — go to target immediately'
    case 'fair':
      return 'Start at 10 Hz (alpha) and step down to target'
    case 'poor':
      return 'Start at 20 Hz (beta) and step down to target'
  }
}

function formatBaseLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`
}

function clampBaseHz(hz: number): number {
  if (!Number.isFinite(hz)) return BASE_HZ_MIN
  return Math.min(BASE_HZ_MAX, Math.max(BASE_HZ_MIN, Math.round(hz)))
}

export default function App() {
  const { state, start, pause, resume, stop, setVolume, previewSchedule } =
    useAutoRamp()

  const [config, setConfig] = useState<SessionConfig>(DEFAULT_CONFIG)
  const [saved, setSaved] = useState<SessionConfig[]>([])
  const [saveName, setSaveName] = useState('')
  const [customBaseDraft, setCustomBaseDraft] = useState(String(DEFAULT_CONFIG.baseHz))
  const [scheduleOpen, setScheduleOpen] = useState(true)

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

  const activeTargetHz =
    sessionActive && state.isRunning
      ? config.targetHz
      : config.targetHz

  const update = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }))
    if (key === 'baseHz') setCustomBaseDraft(String(value as number))
  }

  const setMeditatorLevel = (level: MeditatorLevel) => {
    setConfig((c) => ({
      ...c,
      meditatorLevel: level,
      rampInStartHz: presetRampInStartHz(level, c.targetHz),
    }))
  }

  const applyCustomBase = (raw: string) => {
    const clamped = clampBaseHz(Number(raw))
    setCustomBaseDraft(String(clamped))
    setConfig((c) => ({ ...c, baseHz: clamped }))
  }

  const handleStart = async () => {
    await start(config)
  }

  const applyQuickDemo = () => {
    if (state.isRunning || state.isPaused) return
    setConfig({ ...QUICK_DEMO_CONFIG })
    setCustomBaseDraft(String(QUICK_DEMO_CONFIG.baseHz))
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>kazi5isalive Auto-Ramp</h1>
        <p className="tagline">
          Binaural beat trainer — press Start, it ramps down then up by itself
        </p>
      </header>

      <div className="headphones-banner" role="status">
        <span className="icon" aria-hidden>
          🎧
        </span>
        <span>
          <strong>Stereo headphones required.</strong> Left ear = base frequency;
          right ear = base + beat. Use wired or reliable wireless stereo.
        </span>
      </div>

      {/* Live session monitor */}
      <section className="card monitor" aria-live="polite">
        <h2>Session</h2>
        <div className={`phase-badge ${state.phase}`}>
          {state.phase === 'ramp-in'
            ? 'Ramp In · DOWN'
            : state.phase === 'hold'
              ? 'Hold'
              : state.phase === 'ramp-out'
                ? 'Ramp Out · UP'
                : state.phase === 'done'
                  ? 'Done'
                  : state.phase === 'paused'
                    ? 'Paused'
                    : 'Ready'}
        </div>

        <p className="phase-status">
          {phaseStatusCopy(state.phase, state.currentBeatHz, activeTargetHz)}
        </p>

        {(state.isRunning || state.phase === 'done' || state.phase === 'paused') && (
          <>
            <div className="beat-display">
              {formatHz(state.currentBeatHz)}
              <span className="unit">Hz beat</span>
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
            Configure below, or hit <strong>Quick Demo</strong> to hear the full
            down→up journey in a few minutes. Est.{' '}
            <strong className="accent">{formatDuration(estTotal)}</strong>
          </p>
        )}

        <div className="controls">
          {!state.isRunning && state.phase !== 'paused' && (
            <>
              <button className="btn btn-primary" onClick={handleStart}>
                {state.phase === 'done' ? 'Start Again' : 'Start Auto-Ramp'}
              </button>
              <button
                type="button"
                className="btn btn-demo"
                disabled={locked}
                onClick={applyQuickDemo}
                title="Load short Poor/20 Hz→4 Hz→beta session"
              >
                Quick Demo
              </button>
            </>
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

        {!sessionActive && (
          <p className="demo-hint">
            <strong>Quick Demo</strong> = start 20 Hz → down to 4 Hz → hold ~1 min →
            climb to ~18 Hz (short steps so you can hear it).
          </p>
        )}
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
          Valley shape: ramp in (down to theta) → hold → ramp out (up to beta).
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
            {formatScheduleSummary(schedule)} · {scheduleOpen ? '▾' : '▸'}
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
                  title={`${step.phase}: ${formatHz(step.beatHz)} Hz · ${formatDuration(step.durationSec)}`}
                >
                  {formatHz(step.beatHz)}
                </span>
              )
            })}
          </div>
        )}
      </section>

      {/* Configuration — locked while running */}
      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Meditator Preset</h2>
        <div className="field">
          <div className="segmented meditator-segmented" role="group" aria-label="Meditator level">
            {(['good', 'fair', 'poor'] as MeditatorLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={config.meditatorLevel === level ? 'active' : ''}
                disabled={locked}
                onClick={() => setMeditatorLevel(level)}
              >
                {levelLabel(level)}
              </button>
            ))}
          </div>
          <p className="hint">{levelHint(config.meditatorLevel)}</p>
        </div>
        {config.meditatorLevel !== 'good' && (
          <div className="field">
            <label htmlFor="ramp-in-start">Ramp-in start (Hz)</label>
            <div className="slider-row">
              <input
                id="ramp-in-start"
                type="range"
                min={RAMP_IN_START_MIN}
                max={RAMP_IN_START_MAX}
                step={1}
                value={config.rampInStartHz}
                disabled={locked}
                onChange={(e) => update('rampInStartHz', Number(e.target.value))}
              />
              <span className="value">{config.rampInStartHz} Hz</span>
            </div>
            <p className="hint">
              Auto-ramp steps down from this beat to target in 1 Hz steps (
              {RAMP_IN_START_MIN}–{RAMP_IN_START_MAX} Hz). Default 20 = beta start.
            </p>
          </div>
        )}
      </section>

      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Frequencies</h2>
        <div className="field">
          <label>Target beat (theta)</label>
          <div className="segmented">
            {TARGET_PRESETS.map((hz) => (
              <button
                key={hz}
                type="button"
                className={config.targetHz === hz ? 'active' : ''}
                disabled={locked}
                onClick={() => {
                  setConfig((c) => ({
                    ...c,
                    targetHz: hz,
                    rampInStartHz:
                      c.meditatorLevel === 'good'
                        ? hz
                        : Math.max(c.rampInStartHz, Math.ceil(hz)),
                  }))
                }}
              >
                {formatHz(hz)} Hz
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Base frequency (carrier)</label>
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
                      onClick={() => update('baseHz', hz)}
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
          <p className="hint">
            To clearly hear the beat rise and fall, try base <strong>100–500 Hz</strong>{' '}
            first. High carriers (8–16 kHz) may be hard to hear as tones — the beat still
            forms, but Mid/Low make the down→up journey easier to perceive.
          </p>
        </div>
      </section>

      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Timing</h2>
        <div className="field">
          <label>Step duration (ramp-in)</label>
          <div className="slider-row">
            <input
              type="range"
              min={5}
              max={180}
              step={1}
              value={config.stepDurationSec}
              disabled={locked}
              onChange={(e) => update('stepDurationSec', Number(e.target.value))}
            />
            <span className="value">{formatDuration(config.stepDurationSec)}</span>
          </div>
          <p className="hint">
            5 s – 3 min per 1 Hz step. Ramp-out uses shorter steps automatically.
            Use ~8–15 s for a quick hearable demo.
          </p>
        </div>
        <div className="field">
          <label>Hold at target</label>
          <div className="slider-row">
            <input
              type="range"
              min={30}
              max={2 * 60 * 60}
              step={30}
              value={config.holdDurationSec}
              disabled={locked}
              onChange={(e) => update('holdDurationSec', Number(e.target.value))}
            />
            <span className="value">{formatDuration(config.holdDurationSec)}</span>
          </div>
          <p className="hint">30 s – 2 hr at target theta. Full sessions often use 30–60 min.</p>
        </div>
        <div className="schedule-preview">
          Auto schedule: {schedule.filter((s) => s.phase === 'ramp-in').length} ramp-in ·{' '}
          1 hold · {schedule.filter((s) => s.phase === 'ramp-out').length} ramp-out · total{' '}
          {formatDuration(estTotal)}
        </div>
      </section>

      <section className="card">
        <h2>Volume</h2>
        <div className="field">
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={config.volume}
              onChange={(e) => {
                const v = Number(e.target.value)
                update('volume', v)
                if (state.isRunning) setVolume(v)
              }}
            />
            <span className="value">{Math.round(config.volume * 100)}%</span>
          </div>
          <p className="hint">Keep comfortable — soft is fine. Avoid ear fatigue.</p>
        </div>
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
                  {levelLabel(c.meditatorLevel)} · start {c.rampInStartHz} →{' '}
                  {formatHz(c.targetHz)} Hz · base {formatBaseLabel(c.baseHz)} · hold{' '}
                  {formatDuration(c.holdDurationSec)}
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

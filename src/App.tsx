import { useEffect, useMemo, useState } from 'react'
import { BeatPathChart } from './components/BeatPathChart'
import { useAutoRamp } from './hooks/useAutoRamp'
import type { MeditatorLevel, SessionConfig } from './types'
import {
  BASE_HZ_MAX,
  BASE_HZ_MIN,
  BASE_PRESET_GROUPS,
  BEAT_HZ_MAX,
  BEAT_HZ_MIN,
  BEAT_HZ_STEP,
  MAX_SAVED_CONFIGS,
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
      return `Climbing UP · ${formatHz(currentBeatHz)} Hz → toward Out to`
    case 'done':
      return 'Journey complete · down → hold → up'
    case 'paused':
      return 'Paused'
    default:
      return 'Ready · From → To → Out to'
  }
}

function levelLabel(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair · optional 8 Hz'
    case 'poor':
      return 'Poor · optional 12 Hz'
  }
}

function levelHint(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Little/no ramp-in — go to target immediately'
    case 'fair':
      return 'Start at 8 Hz and step down to target'
    case 'poor':
      return 'Start at 12 Hz and step down to target'
  }
}

function formatBaseLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`
}

function clampBaseHz(hz: number): number {
  if (!Number.isFinite(hz)) return BASE_HZ_MIN
  return Math.min(BASE_HZ_MAX, Math.max(BASE_HZ_MIN, Math.round(hz)))
}

function clampBeatHz(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_CONFIG.targetHz
  return Math.min(BEAT_HZ_MAX, Math.max(BEAT_HZ_MIN, Number(hz.toFixed(2))))
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

  const updateBeatRange = (key: 'rampInStartHz' | 'targetHz' | 'rampOutTargetHz', raw: number) => {
    const value = clampBeatHz(raw)
    setConfig((c) => {
      if (key === 'rampInStartHz') {
        const fromHz = Math.max(value, c.targetHz)
        const outToHz = c.rampOutTargetHz === c.rampInStartHz
          ? fromHz
          : Math.max(c.rampOutTargetHz, c.targetHz)
        return { ...c, rampInStartHz: fromHz, rampOutTargetHz: outToHz }
      }
      if (key === 'targetHz') {
        const toHz = Math.min(value, c.rampInStartHz)
        const outToHz = c.rampOutTargetHz === c.targetHz
          ? toHz
          : Math.max(c.rampOutTargetHz, toHz)
        return { ...c, targetHz: toHz, rampOutTargetHz: outToHz }
      }
      return { ...c, rampOutTargetHz: Math.max(value, c.targetHz) }
    })
  }

  const setMeditatorLevel = (level: MeditatorLevel) => {
    setConfig((c) => {
      const fromHz = presetRampInStartHz(level, c.targetHz)
      const outToHz = c.rampOutTargetHz === c.rampInStartHz
        ? fromHz
        : Math.max(c.rampOutTargetHz, c.targetHz)
      return { ...c, meditatorLevel: level, rampInStartHz: fromHz, rampOutTargetHz: outToHz }
    })
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
                title="Load short 8 Hz→4 Hz→8 Hz session"
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
            <strong>Quick Demo</strong> = start 8 Hz → down to 4 Hz → hold ~1 min →
            climb to 8 Hz (short steps so you can hear it).
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
          Valley shape: ramp in (down to To) → hold → ramp out (up to Out to).
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
        <p className="hint">
          Good keeps the beat fixed at To. Fair and Poor add an optional brainwave-band
          ramp before the hold; adjust the range below as needed.
        </p>
      </section>

      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Beat range (brainwave difference)</h2>
        <p className="range-description">
          This is the left/right frequency difference: From → To, hold at To, then ramp
          toward Out to. The carrier tones are set separately below.
        </p>
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
              onChange={(e) => updateBeatRange('rampInStartHz', Number(e.target.value))}
            />
            <span>ramp-in start</span>
          </div>
          <div className="range-field">
            <label htmlFor="beat-to">To (Hz)</label>
            <input
              id="beat-to"
              type="number"
              min={BEAT_HZ_MIN}
              max={BEAT_HZ_MAX}
              step={BEAT_HZ_STEP}
              value={config.targetHz}
              disabled={locked}
              onChange={(e) => updateBeatRange('targetHz', Number(e.target.value))}
            />
            <span>valley / hold</span>
          </div>
          <div className="range-field">
            <label htmlFor="beat-out-to">Out to (Hz)</label>
            <input
              id="beat-out-to"
              type="number"
              min={BEAT_HZ_MIN}
              max={BEAT_HZ_MAX}
              step={BEAT_HZ_STEP}
              value={config.rampOutTargetHz}
              disabled={locked}
              onChange={(e) => updateBeatRange('rampOutTargetHz', Number(e.target.value))}
            />
            <span>ramp-out end</span>
          </div>
        </div>
        <div className="field range-presets">
          <label>To presets</label>
          <div className="segmented">
            {TARGET_PRESETS.map((hz) => (
              <button
                key={hz}
                type="button"
                className={config.targetHz === hz ? 'active' : ''}
                disabled={locked}
                onClick={() => updateBeatRange('targetHz', hz)}
              >
                {formatHz(hz)} Hz
              </button>
            ))}
          </div>
        </div>
        <p className="hint">
          Auto-ramp advances in 1 Hz steps and preserves fractional endpoints such as 3.8
          and 3.75. Default is a fixed 4 Hz beat; choose Fair/Poor or set From/Out to for
          an optional ramp.
        </p>
      </section>

      <section className={`card ${locked ? 'locked' : ''}`}>
        <h2>Carrier range</h2>
        <p className="range-description">
          Carrier (binaural tones): left ear = base; right ear = base + the beat above.
          Choose the carrier here, with high carriers emphasized.
        </p>
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
            <button
              type="button"
              className={config.baseHz >= 12000 && config.baseHz <= 14000 ? 'active' : ''}
              disabled={locked}
              onClick={() => update('baseHz', 12000)}
            >
              12–14 kHz band
            </button>
          </div>
        </div>
        <div className="field carrier-band-picker">
          <label htmlFor="high-carrier-band">12–14 kHz band picker</label>
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
          <div className="carrier-band-values"><span>12 kHz</span><strong>{formatBaseLabel(Math.min(14000, Math.max(12000, config.baseHz)))}</strong><span>14 kHz</span></div>
        </div>
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
                  {levelLabel(c.meditatorLevel)} · {formatHz(c.rampInStartHz)} →{' '}
                  {formatHz(c.targetHz)} → {formatHz(c.rampOutTargetHz)} Hz · base {formatBaseLabel(c.baseHz)} · hold{' '}
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

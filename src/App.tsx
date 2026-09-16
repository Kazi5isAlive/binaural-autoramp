import { useEffect, useMemo, useState } from 'react'
import { useAutoRamp } from './hooks/useAutoRamp'
import type { MeditatorLevel, SessionConfig } from './types'
import {
  BASE_HZ_MAX,
  BASE_HZ_MIN,
  BASE_PRESET_GROUPS,
  MAX_SAVED_CONFIGS,
  TARGET_PRESETS,
} from './types'
import { DEFAULT_CONFIG, formatDuration, formatHz, totalDuration } from './utils/schedule'
import {
  deleteConfig,
  loadConfigs,
  upsertConfig,
} from './utils/storage'
import './index.css'

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'ramp-in':
      return 'Ramp In'
    case 'hold':
      return 'Hold'
    case 'ramp-out':
      return 'Ramp Out'
    case 'done':
      return 'Done'
    case 'paused':
      return 'Paused'
    default:
      return 'Ready'
  }
}

function levelLabel(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Good'
    case 'fair':
      return 'Fair'
    case 'poor':
      return 'Poor'
  }
}

function levelHint(level: MeditatorLevel): string {
  switch (level) {
    case 'good':
      return 'Little/no ramp-in — go to target immediately'
    case 'fair':
      return 'Auto step 10 → 9 → … → target (1 Hz)'
    case 'poor':
      return 'Auto step 20 → 19 → … → target (1 Hz)'
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

  const update = <K extends keyof SessionConfig>(key: K, value: SessionConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }))
    if (key === 'baseHz') setCustomBaseDraft(String(value as number))
  }

  const applyCustomBase = (raw: string) => {
    const clamped = clampBaseHz(Number(raw))
    setCustomBaseDraft(String(clamped))
    setConfig((c) => ({ ...c, baseHz: clamped }))
  }

  const handleStart = async () => {
    await start(config)
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Binaural Auto-Ramp</h1>
        <p className="tagline">
          Tom Campbell / My Big TOE–style trainer — press Start, it runs itself
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
          {phaseLabel(state.phase)}
        </div>

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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Configure presets below, then hit <strong>Start Auto-Ramp</strong>.
            Estimated total: <strong style={{ color: 'var(--accent)' }}>{formatDuration(estTotal)}</strong>
          </p>
        )}

        <div className="controls">
          {!state.isRunning && state.phase !== 'paused' && (
            <button
              className="btn btn-primary"
              onClick={handleStart}
              disabled={state.phase === 'done' ? false : false}
            >
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

      {/* Configuration — locked while running */}
      <section className={`card ${state.isRunning || state.isPaused ? 'locked' : ''}`}>
        <h2>Meditator Preset</h2>
        <div className="field">
          <div className="segmented" role="group" aria-label="Meditator level">
            {(['good', 'fair', 'poor'] as MeditatorLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={config.meditatorLevel === level ? 'active' : ''}
                disabled={state.isRunning || state.isPaused}
                onClick={() => update('meditatorLevel', level)}
              >
                {levelLabel(level)}
              </button>
            ))}
          </div>
          <p className="hint">{levelHint(config.meditatorLevel)}</p>
        </div>
      </section>

      <section className={`card ${state.isRunning || state.isPaused ? 'locked' : ''}`}>
        <h2>Frequencies</h2>
        <div className="field">
          <label>Target beat (theta)</label>
          <div className="segmented">
            {TARGET_PRESETS.map((hz) => (
              <button
                key={hz}
                type="button"
                className={config.targetHz === hz ? 'active' : ''}
                disabled={state.isRunning || state.isPaused}
                onClick={() => update('targetHz', hz)}
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
                      disabled={state.isRunning || state.isPaused}
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
              disabled={state.isRunning || state.isPaused}
              onChange={(e) => setCustomBaseDraft(e.target.value)}
              onBlur={(e) => applyCustomBase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
            />
            <span className="custom-base-range">
              {BASE_HZ_MIN}–{BASE_HZ_MAX} Hz
            </span>
          </div>
          <p className="hint">
            Try Mid first, then High. Carriers at 12–16 kHz are often inaudible as
            pure tones for adults, but the beat still forms from the left/right
            difference if both tones play. Lower bases are often preferred by males;
            higher by females — experiment.
          </p>
        </div>
      </section>

      <section className={`card ${state.isRunning || state.isPaused ? 'locked' : ''}`}>
        <h2>Timing</h2>
        <div className="field">
          <label>Step duration (ramp-in)</label>
          <div className="slider-row">
            <input
              type="range"
              min={30}
              max={180}
              step={5}
              value={config.stepDurationSec}
              disabled={state.isRunning || state.isPaused}
              onChange={(e) => update('stepDurationSec', Number(e.target.value))}
            />
            <span className="value">{formatDuration(config.stepDurationSec)}</span>
          </div>
          <p className="hint">30 s – 3 min per 1 Hz step. Ramp-out uses shorter steps automatically.</p>
        </div>
        <div className="field">
          <label>Hold at target</label>
          <div className="slider-row">
            <input
              type="range"
              min={30 * 60}
              max={2 * 60 * 60}
              step={60}
              value={config.holdDurationSec}
              disabled={state.isRunning || state.isPaused}
              onChange={(e) => update('holdDurationSec', Number(e.target.value))}
            />
            <span className="value">{formatDuration(config.holdDurationSec)}</span>
          </div>
          <p className="hint">30 min – 2 hr at target theta.</p>
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
          Save named presets for Campbell-style month-long experiments.
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
                  {levelLabel(c.meditatorLevel)} · {formatHz(c.targetHz)} Hz · base{' '}
                  {formatBaseLabel(c.baseHz)} · hold {formatDuration(c.holdDurationSec)}
                </div>
              </div>
              <button
                type="button"
                className="small"
                disabled={state.isRunning || state.isPaused}
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
            disabled={state.isRunning || state.isPaused}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={state.isRunning || state.isPaused}
            onClick={handleSave}
          >
            Save
          </button>
        </div>
      </section>

      <p className="note">
        These are <em>training wheels</em>. The goal is eventually to reach and
        hold focus without binaural beats — use them to learn the territory, then
        practice free.
      </p>
    </div>
  )
}

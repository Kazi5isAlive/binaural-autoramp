import { useMemo } from 'react'
import type { ScheduleStep, StepPhase } from '../types'
import { formatHz } from '../utils/schedule'

interface BeatPathChartProps {
  schedule: ScheduleStep[]
  /** Current step index while running; -1 when idle */
  stepIndex: number
  /** 0–1 progress within the current step */
  stepProgress: number
  isActive: boolean
}

const W = 640
const H = 220
const PAD = { top: 28, right: 16, bottom: 40, left: 40 }

function phaseColor(phase: StepPhase): string {
  switch (phase) {
    case 'ramp-in':
      return 'var(--phase-in)'
    case 'hold':
      return 'var(--phase-hold)'
    case 'wake':
      return 'var(--phase-wake)'
    case 'dip':
      return 'var(--phase-dip)'
    case 'ramp-out':
      return 'var(--phase-out)'
  }
}

function phaseBandFill(phase: StepPhase): string {
  switch (phase) {
    case 'ramp-in':
      return 'rgba(122, 162, 247, 0.08)'
    case 'hold':
      return 'rgba(110, 231, 197, 0.06)'
    case 'wake':
      return 'rgba(240, 180, 41, 0.14)'
    case 'dip':
      return 'rgba(125, 211, 252, 0.14)'
    case 'ramp-out':
      return 'rgba(199, 146, 234, 0.08)'
  }
}

function shortPhaseLabel(phase: StepPhase): string {
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
  }
}

export function BeatPathChart({
  schedule,
  stepIndex,
  stepProgress,
  isActive,
}: BeatPathChartProps) {
  const layout = useMemo(() => {
    if (schedule.length === 0) return null

    const totalSec = schedule.reduce((s, step) => s + step.durationSec, 0)
    const maxHz = Math.max(...schedule.map((s) => s.beatHz), 10)
    const minHz = Math.min(...schedule.map((s) => s.beatHz), 0)
    const yMin = Math.max(0, Math.floor(minHz) - 1)
    const yMax = Math.ceil(maxHz) + 1

    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom

    const xAt = (t: number) => PAD.left + (t / totalSec) * plotW
    const yAt = (hz: number) =>
      PAD.top + plotH - ((hz - yMin) / (yMax - yMin)) * plotH

    const segments: Array<{
      step: ScheduleStep
      index: number
      t0: number
      t1: number
      x0: number
      x1: number
      y: number
    }> = []
    let t = 0
    schedule.forEach((step, index) => {
      const t0 = t
      const t1 = t + step.durationSec
      segments.push({
        step,
        index,
        t0,
        t1,
        x0: xAt(t0),
        x1: xAt(t1),
        y: yAt(step.beatHz),
      })
      t = t1
    })

    const stepPath = segments
      .map((seg, i) => {
        const cmd = i === 0 ? `M ${seg.x0} ${seg.y}` : `L ${seg.x0} ${seg.y}`
        return `${cmd} L ${seg.x1} ${seg.y}`
      })
      .join(' ')

    // Merge consecutive identical phases for band labels (hold chunks merge)
    const phaseBands: Array<{
      phase: StepPhase
      label: string
      x0: number
      x1: number
      id: number
    }> = []
    for (const seg of segments) {
      const last = phaseBands[phaseBands.length - 1]
      // Don't merge wake/dip — each spike is its own band
      const mergeable =
        last &&
        last.phase === seg.step.phase &&
        (seg.step.phase === 'hold' ||
          seg.step.phase === 'ramp-in' ||
          seg.step.phase === 'ramp-out')
      if (mergeable) {
        last.x1 = seg.x1
      } else {
        phaseBands.push({
          phase: seg.step.phase,
          label: shortPhaseLabel(seg.step.phase),
          x0: seg.x0,
          x1: seg.x1,
          id: phaseBands.length,
        })
      }
    }

    const yTicks: number[] = []
    for (let hz = yMin; hz <= yMax; hz += 2) yTicks.push(hz)

    let playT = 0
    if (isActive && stepIndex >= 0 && stepIndex < segments.length) {
      const seg = segments[stepIndex]
      playT = seg.t0 + Math.min(1, Math.max(0, stepProgress)) * (seg.t1 - seg.t0)
    }

    // Macro bands for bottom labels: Entry / Hold / Exit
    const macroBands: Array<{ label: string; x0: number; x1: number }> = []
    const firstHold = segments.find((s) => s.step.phase === 'hold' || s.step.phase === 'wake' || s.step.phase === 'dip')
    const firstExit = segments.find((s) => s.step.phase === 'ramp-out')
    const entrySegs = segments.filter((s) => s.step.phase === 'ramp-in')
    if (entrySegs.length) {
      macroBands.push({
        label: 'Entry',
        x0: entrySegs[0].x0,
        x1: entrySegs[entrySegs.length - 1].x1,
      })
    }
    if (firstHold) {
      const holdEnd = firstExit ? firstExit.x0 : segments[segments.length - 1].x1
      macroBands.push({ label: 'Hold · wakes ↑ · dips ↓', x0: firstHold.x0, x1: holdEnd })
    }
    if (firstExit) {
      macroBands.push({
        label: 'Exit',
        x0: firstExit.x0,
        x1: segments[segments.length - 1].x1,
      })
    }

    return {
      totalSec,
      yMin,
      yMax,
      xAt,
      yAt,
      segments,
      stepPath,
      phaseBands,
      macroBands,
      yTicks,
      playX: isActive ? xAt(playT) : null,
      plotW,
      plotH,
    }
  }, [schedule, stepIndex, stepProgress, isActive])

  if (!layout || schedule.length === 0) {
    return (
      <div className="beat-path empty">
        <p>No schedule yet</p>
      </div>
    )
  }

  const {
    segments,
    stepPath,
    phaseBands,
    macroBands,
    yTicks,
    yAt,
    playX,
    yMin,
    yMax,
  } = layout

  const currentSeg =
    isActive && stepIndex >= 0 && stepIndex < segments.length
      ? segments[stepIndex]
      : null

  // Only draw dots for non-tiny hold crumbs / all event spikes
  const visibleDots = segments.filter((seg) => {
    if (seg.step.phase === 'wake' || seg.step.phase === 'dip') return true
    if (seg.step.phase === 'ramp-in' || seg.step.phase === 'ramp-out') return true
    // hold: only if relatively wide
    return seg.x1 - seg.x0 > 4
  })

  return (
    <div className="beat-path">
      <div className="beat-path-title">Beat path · entry → hold (spikes & dips) → exit</div>
      <svg
        className="beat-path-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Beat frequency over time with wake spikes and deep dips during hold"
      >
        {phaseBands.map((band) => (
          <rect
            key={`band-${band.id}`}
            x={band.x0}
            y={PAD.top}
            width={Math.max(0, band.x1 - band.x0)}
            height={layout.plotH}
            fill={phaseBandFill(band.phase)}
          />
        ))}

        {yTicks.map((hz) => (
          <g key={hz}>
            <line
              x1={PAD.left}
              y1={yAt(hz)}
              x2={W - PAD.right}
              y2={yAt(hz)}
              stroke="var(--border)"
              strokeWidth={hz === 0 ? 0 : 1}
              opacity={0.5}
            />
            <text
              x={PAD.left - 6}
              y={yAt(hz) + 3}
              textAnchor="end"
              className="beat-path-axis"
            >
              {hz}
            </text>
          </g>
        ))}

        <path
          d={stepPath}
          fill="none"
          stroke="url(#beatGradient)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {visibleDots.map((seg) => {
          const isCurrent = currentSeg?.index === seg.index
          const isPast = isActive && seg.index < stepIndex
          const isEvent = seg.step.phase === 'wake' || seg.step.phase === 'dip'
          return (
            <circle
              key={seg.index}
              cx={(seg.x0 + seg.x1) / 2}
              cy={seg.y}
              r={isCurrent ? 5 : isEvent ? 3.5 : 2.5}
              fill={phaseColor(seg.step.phase)}
              opacity={isPast ? 0.45 : 1}
              className={isCurrent ? 'beat-path-dot current' : 'beat-path-dot'}
            />
          )
        })}

        {currentSeg && (
          <rect
            x={currentSeg.x0}
            y={PAD.top}
            width={Math.max(1, currentSeg.x1 - currentSeg.x0)}
            height={layout.plotH}
            fill="none"
            stroke={phaseColor(currentSeg.step.phase)}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            opacity={0.9}
          />
        )}

        {playX != null && (
          <g>
            <line
              x1={playX}
              y1={PAD.top - 4}
              x2={playX}
              y2={H - PAD.bottom + 4}
              stroke="var(--accent)"
              strokeWidth={2}
            />
            <polygon
              points={`${playX - 5},${PAD.top - 4} ${playX + 5},${PAD.top - 4} ${playX},${PAD.top + 4}`}
              fill="var(--accent)"
            />
          </g>
        )}

        {macroBands.map((band, i) => {
          const mid = (band.x0 + band.x1) / 2
          const wideEnough = band.x1 - band.x0 > 50
          return (
            <text
              key={`macro-${i}`}
              x={mid}
              y={H - 12}
              textAnchor="middle"
              className="beat-path-phase-label"
            >
              {wideEnough ? band.label : band.label.split(' ')[0]}
            </text>
          )
        })}

        <text
          x={PAD.left - 6}
          y={PAD.top - 10}
          textAnchor="end"
          className="beat-path-axis"
        >
          Hz
        </text>

        <defs>
          <linearGradient id="beatGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--phase-in)" />
            <stop offset="35%" stopColor="var(--phase-hold)" />
            <stop offset="55%" stopColor="var(--phase-wake)" />
            <stop offset="75%" stopColor="var(--phase-dip)" />
            <stop offset="100%" stopColor="var(--phase-out)" />
          </linearGradient>
        </defs>

        <title>{`Beat ${yMin}–${yMax} Hz with wake spikes and deep dips`}</title>
      </svg>

      {currentSeg && (
        <div className="beat-path-now">
          Now: <strong>{formatHz(currentSeg.step.beatHz)} Hz</strong>
          <span className={`dot phase-${currentSeg.step.phase}`} />
          {currentSeg.step.phase === 'ramp-in' && 'entry'}
          {currentSeg.step.phase === 'hold' && 'holding'}
          {currentSeg.step.phase === 'wake' && 'wake pulse'}
          {currentSeg.step.phase === 'dip' && 'deep dip'}
          {currentSeg.step.phase === 'ramp-out' && 'exit'}
          <span className="carrier-inline">
            · carrier {currentSeg.step.baseHz >= 1000
              ? `${currentSeg.step.baseHz / 1000} kHz`
              : `${currentSeg.step.baseHz} Hz`}
          </span>
        </div>
      )}
    </div>
  )
}

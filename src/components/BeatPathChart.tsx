import { useMemo } from 'react'
import type { ScheduleStep } from '../types'
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
const H = 200
const PAD = { top: 28, right: 16, bottom: 36, left: 40 }

function phaseColor(phase: ScheduleStep['phase']): string {
  switch (phase) {
    case 'ramp-in':
      return 'var(--phase-in)'
    case 'hold':
      return 'var(--phase-hold)'
    case 'ramp-out':
      return 'var(--phase-out)'
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
    const maxHz = Math.max(...schedule.map((s) => s.beatHz), 18)
    const minHz = Math.min(...schedule.map((s) => s.beatHz), 0)
    const yMin = Math.max(0, Math.floor(minHz) - 1)
    const yMax = Math.ceil(maxHz) + 1

    const plotW = W - PAD.left - PAD.right
    const plotH = H - PAD.top - PAD.bottom

    const xAt = (t: number) => PAD.left + (t / totalSec) * plotW
    const yAt = (hz: number) =>
      PAD.top + plotH - ((hz - yMin) / (yMax - yMin)) * plotH

    // Step segments with start/end times
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

    // Polyline through midpoints of each step (valley shape)
    const points = segments
      .map((seg) => {
        const midX = (seg.x0 + seg.x1) / 2
        return `${midX},${seg.y}`
      })
      .join(' ')

    // Also build a step-function path (horizontal per step)
    const stepPath = segments
      .map((seg, i) => {
        const cmd = i === 0 ? `M ${seg.x0} ${seg.y}` : `L ${seg.x0} ${seg.y}`
        return `${cmd} L ${seg.x1} ${seg.y}`
      })
      .join(' ')

    // Phase band boundaries
    const phaseBands: Array<{
      phase: ScheduleStep['phase']
      label: string
      x0: number
      x1: number
    }> = []
    for (const seg of segments) {
      const last = phaseBands[phaseBands.length - 1]
      if (last && last.phase === seg.step.phase) {
        last.x1 = seg.x1
      } else {
        const label =
          seg.step.phase === 'ramp-in'
            ? 'Ramp in (down to theta)'
            : seg.step.phase === 'hold'
              ? 'Hold'
              : 'Ramp out (up to beta)'
        phaseBands.push({
          phase: seg.step.phase,
          label,
          x0: seg.x0,
          x1: seg.x1,
        })
      }
    }

    // Y-axis ticks
    const yTicks: number[] = []
    for (let hz = yMin; hz <= yMax; hz += 2) yTicks.push(hz)
    if (!yTicks.includes(Math.round(minHz))) {
      /* keep sparse */
    }

    // Playhead time
    let playT = 0
    if (isActive && stepIndex >= 0 && stepIndex < segments.length) {
      const seg = segments[stepIndex]
      playT = seg.t0 + Math.min(1, Math.max(0, stepProgress)) * (seg.t1 - seg.t0)
    }

    return {
      totalSec,
      yMin,
      yMax,
      xAt,
      yAt,
      segments,
      points,
      stepPath,
      phaseBands,
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

  return (
    <div className="beat-path">
      <div className="beat-path-title">Beat path · down → hold → up</div>
      <svg
        className="beat-path-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Beat frequency over time: ramps down to target, holds, then climbs toward beta"
      >
        {/* Phase background bands */}
        {phaseBands.map((band) => (
          <rect
            key={band.phase}
            x={band.x0}
            y={PAD.top}
            width={Math.max(0, band.x1 - band.x0)}
            height={layout.plotH}
            fill={
              band.phase === 'ramp-in'
                ? 'rgba(122, 162, 247, 0.08)'
                : band.phase === 'hold'
                  ? 'rgba(110, 231, 197, 0.08)'
                  : 'rgba(199, 146, 234, 0.08)'
            }
          />
        ))}

        {/* Grid lines */}
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

        {/* Step path */}
        <path
          d={stepPath}
          fill="none"
          stroke="url(#beatGradient)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Step dots */}
        {segments.map((seg) => {
          const isCurrent = currentSeg?.index === seg.index
          const isPast = isActive && seg.index < stepIndex
          return (
            <circle
              key={seg.index}
              cx={(seg.x0 + seg.x1) / 2}
              cy={seg.y}
              r={isCurrent ? 5 : 2.5}
              fill={phaseColor(seg.step.phase)}
              opacity={isPast ? 0.45 : 1}
              className={isCurrent ? 'beat-path-dot current' : 'beat-path-dot'}
            />
          )
        })}

        {/* Current step highlight bar */}
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

        {/* Playhead */}
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

        {/* Phase labels */}
        {phaseBands.map((band) => {
          const mid = (band.x0 + band.x1) / 2
          const wideEnough = band.x1 - band.x0 > 70
          return (
            <text
              key={`label-${band.phase}`}
              x={mid}
              y={H - 10}
              textAnchor="middle"
              className={`beat-path-phase-label phase-${band.phase}`}
            >
              {wideEnough
                ? band.label
                : band.phase === 'ramp-in'
                  ? '↓ Ramp in'
                  : band.phase === 'hold'
                    ? 'Hold'
                    : '↑ Ramp out'}
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
            <stop offset="45%" stopColor="var(--phase-hold)" />
            <stop offset="100%" stopColor="var(--phase-out)" />
          </linearGradient>
        </defs>

        {/* Invisible use of yMin/yMax to satisfy lint if needed */}
        <title>{`Beat ${yMin}–${yMax} Hz valley`}</title>
      </svg>

      {currentSeg && (
        <div className="beat-path-now">
          Now: <strong>{formatHz(currentSeg.step.beatHz)} Hz</strong>
          <span className={`dot phase-${currentSeg.step.phase}`} />
          {currentSeg.step.phase === 'ramp-in' && 'descending'}
          {currentSeg.step.phase === 'hold' && 'holding'}
          {currentSeg.step.phase === 'ramp-out' && 'ascending'}
        </div>
      )}
    </div>
  )
}

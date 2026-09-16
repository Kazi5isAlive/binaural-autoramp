import { useCallback, useEffect, useRef, useState } from 'react'
import { BinauralEngine } from '../audio/BinauralEngine'
import type { Phase, ScheduleStep, SessionConfig, SessionState } from '../types'
import {
  buildSchedule,
  formatDuration,
  formatHz,
  totalDuration,
} from '../utils/schedule'

const idleState: SessionState = {
  phase: 'idle',
  currentBeatHz: 0,
  currentBaseHz: 0,
  stepIndex: 0,
  totalSteps: 0,
  stepRemainingSec: 0,
  totalRemainingSec: 0,
  totalElapsedSec: 0,
  totalDurationSec: 0,
  isRunning: false,
  isPaused: false,
  upcomingLabel: '',
}

function computeUpcoming(
  schedule: ScheduleStep[],
  stepIndex: number,
  stepRemainingSec: number
): string {
  for (let i = stepIndex + 1; i < schedule.length; i++) {
    let until = stepRemainingSec
    for (let j = stepIndex + 1; j < i; j++) until += schedule[j].durationSec
    const s = schedule[i]
    if (s.phase === 'wake') {
      return `Wake ${formatHz(s.beatHz)} Hz in ${formatDuration(until)}`
    }
    if (s.phase === 'dip') {
      return `Deep ${formatHz(s.beatHz)} Hz in ${formatDuration(until)}`
    }
    if (s.phase === 'ramp-out') {
      return `Exit in ${formatDuration(until)}`
    }
  }
  if (stepIndex < schedule.length - 1) {
    return `Next: ${schedule[stepIndex + 1].label ?? schedule[stepIndex + 1].phase}`
  }
  return stepIndex >= 0 && schedule.length > 0 ? 'Session winding down' : ''
}

export function useAutoRamp() {
  const engineRef = useRef<BinauralEngine | null>(null)
  const scheduleRef = useRef<ScheduleStep[]>([])
  const stepIndexRef = useRef(0)
  const stepEndAtRef = useRef(0)
  const pausedRemainingRef = useRef(0)
  const totalDurationRef = useRef(0)
  const startedAtRef = useRef(0)
  const pausedTotalElapsedRef = useRef(0)
  const tickRef = useRef<number | null>(null)
  const lastBaseRef = useRef(0)

  const [state, setState] = useState<SessionState>(idleState)

  const clearTick = () => {
    if (tickRef.current != null) {
      cancelAnimationFrame(tickRef.current)
      tickRef.current = null
    }
  }

  const applyStepAudio = useCallback((step: ScheduleStep) => {
    const engine = engineRef.current
    if (!engine) return
    // Carrier first when it changes — keep current beat, then set beat
    if (Math.abs(step.baseHz - lastBaseRef.current) > 0.5) {
      engine.setBaseHz(step.baseHz)
      lastBaseRef.current = step.baseHz
    }
    engine.setBeatHz(step.beatHz)
  }, [])

  const advanceToStep = useCallback(
    (index: number) => {
      const schedule = scheduleRef.current
      if (index >= schedule.length) {
        clearTick()
        engineRef.current?.stop()
        engineRef.current = null
        setState((prev) => ({
          ...prev,
          phase: 'done',
          isRunning: false,
          isPaused: false,
          stepRemainingSec: 0,
          totalRemainingSec: 0,
          currentBeatHz: schedule[schedule.length - 1]?.beatHz ?? prev.currentBeatHz,
          currentBaseHz: schedule[schedule.length - 1]?.baseHz ?? prev.currentBaseHz,
          upcomingLabel: '',
        }))
        return
      }

      const step = schedule[index]
      stepIndexRef.current = index
      stepEndAtRef.current = performance.now() + step.durationSec * 1000
      applyStepAudio(step)

      setState((prev) => ({
        ...prev,
        phase: step.phase as Phase,
        currentBeatHz: step.beatHz,
        currentBaseHz: step.baseHz,
        stepIndex: index,
        totalSteps: schedule.length,
        stepRemainingSec: step.durationSec,
        isRunning: true,
        isPaused: false,
        upcomingLabel: computeUpcoming(schedule, index, step.durationSec),
      }))
    },
    [applyStepAudio]
  )

  const tick = useCallback(() => {
    const now = performance.now()
    const remaining = Math.max(0, (stepEndAtRef.current - now) / 1000)
    const schedule = scheduleRef.current
    const idx = stepIndexRef.current

    const elapsed =
      pausedTotalElapsedRef.current + (now - startedAtRef.current) / 1000
    const totalRem = Math.max(0, totalDurationRef.current - elapsed)

    setState((prev) => ({
      ...prev,
      stepRemainingSec: remaining,
      totalRemainingSec: totalRem,
      totalElapsedSec: Math.min(elapsed, totalDurationRef.current),
      upcomingLabel: computeUpcoming(schedule, idx, remaining),
    }))

    if (remaining <= 0) {
      advanceToStep(idx + 1)
    }

    if (stepIndexRef.current < schedule.length) {
      tickRef.current = requestAnimationFrame(tick)
    }
  }, [advanceToStep])

  const start = useCallback(
    async (config: SessionConfig) => {
      clearTick()
      if (engineRef.current) {
        await engineRef.current.stop()
        engineRef.current = null
      }

      const schedule = buildSchedule(config)
      scheduleRef.current = schedule
      totalDurationRef.current = totalDuration(schedule)
      pausedTotalElapsedRef.current = 0
      startedAtRef.current = performance.now()
      stepIndexRef.current = 0

      const engine = new BinauralEngine()
      engineRef.current = engine
      const first = schedule[0]
      lastBaseRef.current = first.baseHz
      await engine.start(first.baseHz, first.beatHz, config.volume)

      setState({
        phase: first.phase,
        currentBeatHz: first.beatHz,
        currentBaseHz: first.baseHz,
        stepIndex: 0,
        totalSteps: schedule.length,
        stepRemainingSec: first.durationSec,
        totalRemainingSec: totalDurationRef.current,
        totalElapsedSec: 0,
        totalDurationSec: totalDurationRef.current,
        isRunning: true,
        isPaused: false,
        upcomingLabel: computeUpcoming(schedule, 0, first.durationSec),
      })

      stepEndAtRef.current = performance.now() + first.durationSec * 1000
      tickRef.current = requestAnimationFrame(tick)
    },
    [tick]
  )

  const pause = useCallback(async () => {
    if (!engineRef.current) return
    clearTick()
    pausedRemainingRef.current = Math.max(
      0,
      (stepEndAtRef.current - performance.now()) / 1000
    )
    pausedTotalElapsedRef.current +=
      (performance.now() - startedAtRef.current) / 1000
    await engineRef.current.pause()
    setState((prev) => ({ ...prev, isPaused: true, phase: 'paused' }))
  }, [])

  const resume = useCallback(async () => {
    if (!engineRef.current) return
    await engineRef.current.resume()
    startedAtRef.current = performance.now()
    stepEndAtRef.current = performance.now() + pausedRemainingRef.current * 1000

    const schedule = scheduleRef.current
    const step = schedule[stepIndexRef.current]
    setState((prev) => ({
      ...prev,
      isPaused: false,
      phase: step?.phase ?? prev.phase,
      upcomingLabel: computeUpcoming(
        schedule,
        stepIndexRef.current,
        pausedRemainingRef.current
      ),
    }))
    tickRef.current = requestAnimationFrame(tick)
  }, [tick])

  const stop = useCallback(async () => {
    clearTick()
    if (engineRef.current) {
      await engineRef.current.stop()
      engineRef.current = null
    }
    scheduleRef.current = []
    setState(idleState)
  }, [])

  const setVolume = useCallback((volume: number) => {
    engineRef.current?.setVolume(volume)
  }, [])

  useEffect(() => {
    return () => {
      clearTick()
      engineRef.current?.stop()
    }
  }, [])

  return { state, start, pause, resume, stop, setVolume, previewSchedule: buildSchedule }
}

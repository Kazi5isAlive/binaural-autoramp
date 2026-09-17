import { useCallback, useEffect, useRef, useState } from 'react'
import { BinauralEngine } from '../audio/BinauralEngine'
import { IsochronicEngine } from '../audio/IsochronicEngine'
import { JetNoiseEngine, type JetPhase } from '../audio/JetNoiseEngine'
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

function resolveIsoRate(
  beatHz: number,
  config: Pick<SessionConfig, 'isoRateMode' | 'isoFixedHz'>
): number {
  if (config.isoRateMode === 'fixed') {
    return Math.max(0.5, Math.min(40, config.isoFixedHz ?? 15))
  }
  return Math.max(0.5, Math.min(40, beatHz))
}

export function useAutoRamp() {
  const engineRef = useRef<BinauralEngine | null>(null)
  const jetRef = useRef<JetNoiseEngine | null>(null)
  const isoRef = useRef<IsochronicEngine | null>(null)
  const isoConfigRef = useRef<Pick<SessionConfig, 'isoRateMode' | 'isoFixedHz'>>({
    isoRateMode: 'follow-beat',
    isoFixedHz: 15,
  })
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

  const stopLayers = useCallback(async () => {
    if (isoRef.current) {
      await isoRef.current.stop()
      isoRef.current = null
    }
    if (jetRef.current) {
      await jetRef.current.stop()
      jetRef.current = null
    }
  }, [])

  const applyStepAudio = useCallback((step: ScheduleStep) => {
    const engine = engineRef.current
    if (!engine) return
    // Carrier first when it changes — keep current beat, then set beat
    if (Math.abs(step.baseHz - lastBaseRef.current) > 0.5) {
      engine.setBaseHz(step.baseHz)
      lastBaseRef.current = step.baseHz
    }
    engine.setBeatHz(step.beatHz)
    // Jet bed follows phase: swell on entry/wake/dip, duck in deep hold
    jetRef.current?.setPhase(step.phase as JetPhase)
    // Isochronic pulse rate follows beat (or stays on fixed override)
    isoRef.current?.setRateHz(resolveIsoRate(step.beatHz, isoConfigRef.current))
  }, [])

  const advanceToStep = useCallback(
    (index: number) => {
      const schedule = scheduleRef.current
      if (index >= schedule.length) {
        clearTick()
        const last = schedule[schedule.length - 1]
        setState((prev) => ({
          ...prev,
          phase: 'done',
          isRunning: false,
          isPaused: false,
          stepRemainingSec: 0,
          totalRemainingSec: 0,
          currentBeatHz: last?.beatHz ?? prev.currentBeatHz,
          currentBaseHz: last?.baseHz ?? prev.currentBaseHz,
          upcomingLabel: '',
        }))
        // Layers must stop before closing the shared AudioContext
        void (async () => {
          await stopLayers()
          if (engineRef.current) {
            await engineRef.current.stop()
            engineRef.current = null
          }
        })()
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
    [applyStepAudio, stopLayers]
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
      await stopLayers()
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
      isoConfigRef.current = {
        isoRateMode: config.isoRateMode ?? 'follow-beat',
        isoFixedHz: config.isoFixedHz ?? 15,
      }

      const engine = new BinauralEngine()
      engineRef.current = engine
      const first = schedule[0]
      lastBaseRef.current = first.baseHz
      await engine.start(
        first.baseHz,
        first.beatHz,
        config.volume,
        config.toneSoftness ?? 0.7
      )

      const ctx = engine.audioContext

      const jet = new JetNoiseEngine()
      if (ctx) jet.attach(ctx)
      jetRef.current = jet
      await jet.start(
        config.volume,
        config.jetEnabled ?? true,
        config.jetMix ?? 0.2,
        first.phase as JetPhase
      )

      const iso = new IsochronicEngine()
      if (ctx) iso.attach(ctx)
      isoRef.current = iso
      await iso.start(
        config.volume,
        config.isoEnabled ?? false,
        config.isoMix ?? 0.12,
        resolveIsoRate(first.beatHz, isoConfigRef.current)
      )

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
    [tick, stopLayers]
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
    // Shared AudioContext — suspend pauses carriers + jet + iso together
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
    if (step) {
      jetRef.current?.setPhase(step.phase as JetPhase)
      isoRef.current?.setRateHz(resolveIsoRate(step.beatHz, isoConfigRef.current))
    }
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
    await stopLayers()
    if (engineRef.current) {
      await engineRef.current.stop()
      engineRef.current = null
    }
    scheduleRef.current = []
    setState(idleState)
  }, [stopLayers])

  const setVolume = useCallback((volume: number) => {
    engineRef.current?.setVolume(volume)
    jetRef.current?.setCarrierVolume(volume)
    isoRef.current?.setCarrierVolume(volume)
  }, [])

  const setToneSoftness = useCallback((softness: number) => {
    engineRef.current?.setSoftness(softness)
  }, [])

  const setJetEnabled = useCallback((enabled: boolean) => {
    jetRef.current?.setEnabled(enabled)
  }, [])

  const setJetMix = useCallback((mix: number) => {
    jetRef.current?.setMix(mix)
  }, [])

  const setIsoEnabled = useCallback((enabled: boolean) => {
    isoRef.current?.setEnabled(enabled)
  }, [])

  const setIsoMix = useCallback((mix: number) => {
    isoRef.current?.setMix(mix)
  }, [])

  const setIsoRateMode = useCallback(
    (mode: 'follow-beat' | 'fixed', fixedHz?: number) => {
      isoConfigRef.current = {
        isoRateMode: mode,
        isoFixedHz:
          typeof fixedHz === 'number'
            ? fixedHz
            : isoConfigRef.current.isoFixedHz,
      }
      const beat =
        scheduleRef.current[stepIndexRef.current]?.beatHz ??
        engineRef.current?.currentBeatHz ??
        4
      isoRef.current?.setRateHz(resolveIsoRate(beat, isoConfigRef.current))
    },
    []
  )

  const setIsoFixedHz = useCallback((hz: number) => {
    isoConfigRef.current = {
      ...isoConfigRef.current,
      isoFixedHz: hz,
    }
    if (isoConfigRef.current.isoRateMode === 'fixed') {
      isoRef.current?.setRateHz(resolveIsoRate(hz, isoConfigRef.current))
    }
  }, [])

  useEffect(() => {
    return () => {
      clearTick()
      void stopLayers()
      engineRef.current?.stop()
    }
  }, [stopLayers])

  return {
    state,
    start,
    pause,
    resume,
    stop,
    setVolume,
    setToneSoftness,
    setJetEnabled,
    setJetMix,
    setIsoEnabled,
    setIsoMix,
    setIsoRateMode,
    setIsoFixedHz,
    previewSchedule: buildSchedule,
  }
}

/**
 * Stereo jet/turbine ambient bed — identical L/R so it never forms a competing
 * binaural beat. Pure sine carriers remain the only intentional beat source.
 *
 * Continuity rules:
 * - One looping buffer source for the whole session (never stop/restart)
 * - Phase ducking via long gain/filter ramps only (several seconds)
 * - Seamless crossfade at the loop point (no fade-to-silence seam)
 * - Almost-static roar with tiny slow filter drift (no audible LFO pulse)
 */

export type JetPhase =
  | 'ramp-in'
  | 'hold'
  | 'wake'
  | 'dip'
  | 'ramp-out'
  | 'idle'
  | 'done'
  | 'paused'

/** Relative to carrier master volume; caps noise so it cannot drown the beat. */
const MAX_NOISE_TO_CARRIER = 0.28

/**
 * Phase intensity — keep a continuous bed; never near-zero during a session.
 * Differences are small; long ramps make changes feel like slow weather, not mute.
 */
const PHASE_INTENSITY: Record<string, number> = {
  'ramp-in': 1.0,
  hold: 0.72,
  wake: 0.85,
  dip: 0.8,
  'ramp-out': 0.55,
  idle: 0,
  done: 0,
  paused: 0, // gain held; AudioContext suspend handles silence
}

/** Seconds for phase / mix / enable gain changes during a session. */
const PHASE_RAMP_SEC = 5.5
/** Start/stop fade only (session begin/end). */
const EDGE_FADE_SEC = 0.35

/**
 * Brown+pink jet buffer with equal-power crossfade at the loop seam.
 * Longer buffer + real crossfade avoids clicks and silence gaps.
 */
function createJetNoiseBuffer(ctx: AudioContext, durationSec = 16): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * durationSec)
  const buffer = ctx.createBuffer(1, len, sr)
  const data = buffer.getChannelData(0)

  let brown = 0
  const b = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    // Paul Kellet pink approximation
    b[0] = 0.99886 * b[0] + white * 0.0555179
    b[1] = 0.99332 * b[1] + white * 0.0750759
    b[2] = 0.969 * b[2] + white * 0.153852
    b[3] = 0.8665 * b[3] + white * 0.3104856
    b[4] = 0.55 * b[4] + white * 0.5329522
    b[5] = -0.7616 * b[5] - white * 0.016898
    const pink =
      b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * 0.5362
    b[6] = white * 0.115926
    data[i] = brown * 2.8 + pink * 0.08
  }

  // Equal-power crossfade at the END of the buffer toward the START samples
  // so sample[len-1] ≈ sample[0] and the loop wrap has no click or silence.
  // Do NOT fade both ends to zero (that creates audible silence every loop).
  const xfade = Math.min(Math.floor(sr * 0.4), Math.floor(len / 8))
  for (let i = 0; i < xfade; i++) {
    const t = xfade === 1 ? 1 : i / (xfade - 1)
    const fadeOut = Math.cos((t * Math.PI) / 2) // 1 → 0
    const fadeIn = Math.sin((t * Math.PI) / 2) // 0 → 1
    const idx = len - xfade + i
    data[idx] = data[idx] * fadeOut + data[i] * fadeIn
  }

  // Mild normalize to avoid hot peaks after blend
  let peak = 0
  for (let i = 0; i < len; i++) {
    const v = Math.abs(data[i])
    if (v > peak) peak = v
  }
  if (peak > 1e-6) {
    const scale = 0.85 / peak
    for (let i = 0; i < len; i++) data[i] *= scale
  }

  return buffer
}

export class JetNoiseEngine {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private highpass: BiquadFilterNode | null = null
  private lowpass: BiquadFilterNode | null = null
  private bandpass: BiquadFilterNode | null = null
  private whooshGain: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private jetGain: GainNode | null = null

  private enabled = true
  private mix = 0.2
  private carrierVolume = 0.35
  private phaseIntensity = 1
  private playing = false
  private nodesReady = false

  /** Attach to an existing AudioContext (shared with binaural carriers). */
  attach(ctx: AudioContext): void {
    this.ctx = ctx
  }

  async start(
    carrierVolume: number,
    enabled: boolean,
    mix: number,
    phase: JetPhase = 'ramp-in'
  ): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    this.carrierVolume = Math.max(0, Math.min(1, carrierVolume))
    this.enabled = enabled
    this.mix = Math.max(0, Math.min(1, mix))
    this.phaseIntensity = PHASE_INTENSITY[phase] ?? 0.75

    // Only build the graph once per session — never restart the buffer mid-session.
    if (!this.nodesReady) {
      this.teardownNodes()
      this.createNodes()
      this.nodesReady = true
    }

    this.playing = true
    this.applyGain(true)
    this.applyFilterCharacter(true)
  }

  private createNodes(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const buffer = createJetNoiseBuffer(this.ctx, 16)

    this.source = this.ctx.createBufferSource()
    this.source.buffer = buffer
    this.source.loop = true
    // Crossfade region lives at the start of the buffer; loop full length.
    this.source.loopStart = 0
    this.source.loopEnd = buffer.duration

    this.highpass = this.ctx.createBiquadFilter()
    this.highpass.type = 'highpass'
    this.highpass.frequency.setValueAtTime(90, t)
    this.highpass.Q.setValueAtTime(0.7, t)

    this.lowpass = this.ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.setValueAtTime(2000, t)
    this.lowpass.Q.setValueAtTime(0.55, t)

    this.bandpass = this.ctx.createBiquadFilter()
    this.bandpass.type = 'peaking'
    this.bandpass.frequency.setValueAtTime(480, t)
    this.bandpass.Q.setValueAtTime(0.8, t)
    this.bandpass.gain.setValueAtTime(4, t)

    // Static bed level — no LFO on gain (LFO→gain caused audible pulsing/gaps).
    // Texture comes from the long noise buffer; phase changes use slow ramps only.
    this.whooshGain = this.ctx.createGain()
    this.whooshGain.gain.setValueAtTime(0.75, t)

    this.merger = this.ctx.createChannelMerger(2)
    this.jetGain = this.ctx.createGain()
    this.jetGain.gain.setValueAtTime(0, t)

    this.source.connect(this.highpass)
    this.highpass.connect(this.lowpass)
    this.lowpass.connect(this.bandpass)
    this.bandpass.connect(this.whooshGain)
    this.whooshGain.connect(this.merger, 0, 0)
    this.whooshGain.connect(this.merger, 0, 1)
    this.merger.connect(this.jetGain)
    this.jetGain.connect(this.ctx.destination)

    this.source.start(t)
  }

  private targetGain(): number {
    if (!this.enabled || !this.playing) return 0
    return (
      this.carrierVolume *
      this.mix *
      this.phaseIntensity *
      MAX_NOISE_TO_CARRIER
    )
  }

  private applyGain(immediateEdge = false): void {
    if (!this.ctx || !this.jetGain) return
    const t = this.ctx.currentTime
    const next = this.targetGain()
    const ramp = immediateEdge ? EDGE_FADE_SEC : PHASE_RAMP_SEC
    this.jetGain.gain.cancelScheduledValues(t)
    this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t)
    this.jetGain.gain.linearRampToValueAtTime(next, t + ramp)
  }

  /** Soft filter shifts with phase — never mute; only gentle warmth change. */
  private applyFilterCharacter(immediate = false): void {
    if (!this.ctx || !this.lowpass || !this.bandpass) return
    const t = this.ctx.currentTime
    const ramp = immediate ? EDGE_FADE_SEC : PHASE_RAMP_SEC

    // Hold: slightly darker/quieter whoosh; entry: a bit more open
    const lpHz =
      this.phaseIntensity >= 0.95
        ? 2100
        : this.phaseIntensity >= 0.8
          ? 1950
          : 1750
    const peakGain = this.phaseIntensity >= 0.9 ? 4.5 : 3.5

    this.lowpass.frequency.cancelScheduledValues(t)
    this.lowpass.frequency.setValueAtTime(this.lowpass.frequency.value, t)
    this.lowpass.frequency.linearRampToValueAtTime(lpHz, t + ramp)

    this.bandpass.gain.cancelScheduledValues(t)
    this.bandpass.gain.setValueAtTime(this.bandpass.gain.value, t)
    this.bandpass.gain.linearRampToValueAtTime(peakGain, t + ramp)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.applyGain()
  }

  setMix(mix: number): void {
    this.mix = Math.max(0, Math.min(1, mix))
    this.applyGain()
  }

  setCarrierVolume(volume: number): void {
    this.carrierVolume = Math.max(0, Math.min(1, volume))
    this.applyGain()
  }

  /** Follow Classic Deep session phases — long smooth duck/swell, never restart. */
  setPhase(phase: JetPhase): void {
    if (phase === 'paused') return // keep last intensity; context is suspended
    if (!this.nodesReady || !this.playing) {
      this.phaseIntensity = PHASE_INTENSITY[phase] ?? 0.75
      return
    }
    const next = PHASE_INTENSITY[phase] ?? 0.75
    if (Math.abs(next - this.phaseIntensity) < 0.001) return
    this.phaseIntensity = next
    this.applyGain(false)
    this.applyFilterCharacter(false)
  }

  private teardownNodes(): void {
    try {
      this.source?.stop()
    } catch {
      /* already stopped */
    }
    this.source?.disconnect()
    this.highpass?.disconnect()
    this.lowpass?.disconnect()
    this.bandpass?.disconnect()
    this.whooshGain?.disconnect()
    this.merger?.disconnect()
    this.jetGain?.disconnect()
    this.source = null
    this.highpass = null
    this.lowpass = null
    this.bandpass = null
    this.whooshGain = null
    this.merger = null
    this.jetGain = null
    this.nodesReady = false
  }

  async stop(): Promise<void> {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (this.jetGain) {
      this.jetGain.gain.cancelScheduledValues(t)
      this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t)
      this.jetGain.gain.linearRampToValueAtTime(0, t + EDGE_FADE_SEC)
      await new Promise((r) => setTimeout(r, EDGE_FADE_SEC * 1000 + 30))
    }
    this.teardownNodes()
    this.playing = false
    // Do not close shared ctx — BinauralEngine owns lifecycle when attached
  }

  /** Full teardown including context when JetNoise owns it solo. */
  async dispose(): Promise<void> {
    await this.stop()
    this.ctx = null
  }

  get isPlaying(): boolean {
    return this.playing
  }
}

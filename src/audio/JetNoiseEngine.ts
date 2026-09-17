/**
 * Stereo jet/turbine ambient bed — identical L/R so it never forms a competing
 * binaural beat. Pure sine carriers remain the only intentional beat source.
 *
 * Noise is filtered (not flat white), slowly modulated, and phase-ducked so
 * deep hold keeps carriers clear.
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

/** Phase intensity multipliers — entry can swell; deep hold is a quiet bed. */
const PHASE_INTENSITY: Record<string, number> = {
  'ramp-in': 1.0,
  hold: 0.32,
  wake: 0.55,
  dip: 0.48,
  'ramp-out': 0.22,
  idle: 0,
  done: 0,
  paused: 0, // gain held; AudioContext suspend handles silence
}

function createJetNoiseBuffer(ctx: AudioContext, durationSec = 4): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * durationSec)
  // Mono buffer — fed identically to both ears
  const buffer = ctx.createBuffer(1, len, sr)
  const data = buffer.getChannelData(0)

  // Leaky brown + pink blend → turbine rumble/whoosh character
  let brown = 0
  let pink = 0
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
    pink =
      b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + white * 0.5362
    b[6] = white * 0.115926
    data[i] = brown * 2.8 + pink * 0.08
  }

  // Soft loop seam
  const fade = Math.min(2048, Math.floor(len / 16))
  for (let i = 0; i < fade; i++) {
    const g = i / fade
    data[i] *= g
    data[len - 1 - i] *= g
  }
  return buffer
}

export class JetNoiseEngine {
  private ctx: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private lowShelf: BiquadFilterNode | null = null
  private lowpass: BiquadFilterNode | null = null
  private bandpass: BiquadFilterNode | null = null
  private whooshGain: GainNode | null = null
  private lfo: OscillatorNode | null = null
  private lfoDepth: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private jetGain: GainNode | null = null

  private enabled = true
  private mix = 0.2
  private carrierVolume = 0.35
  private phaseIntensity = 1
  private playing = false
  private readonly FADE = 0.08

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
    this.phaseIntensity = PHASE_INTENSITY[phase] ?? 0.4

    this.teardownNodes()
    this.createNodes()
    this.playing = true
    this.applyGain(true)
  }

  private createNodes(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const buffer = createJetNoiseBuffer(this.ctx)

    this.source = this.ctx.createBufferSource()
    this.source.buffer = buffer
    this.source.loop = true

    // Jet character: HP clears DC/mud near deep carriers, LP roar, peaking whoosh
    this.lowShelf = this.ctx.createBiquadFilter()
    this.lowShelf.type = 'highpass'
    this.lowShelf.frequency.setValueAtTime(90, t)
    this.lowShelf.Q.setValueAtTime(0.7, t)

    this.lowpass = this.ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.frequency.setValueAtTime(2200, t)
    this.lowpass.Q.setValueAtTime(0.65, t)

    this.bandpass = this.ctx.createBiquadFilter()
    this.bandpass.type = 'peaking'
    this.bandpass.frequency.setValueAtTime(480, t)
    this.bandpass.Q.setValueAtTime(0.8, t)
    this.bandpass.gain.setValueAtTime(5, t)

    // Mid-band bed — ducks in hold so 128 Hz carriers stay clear
    this.whooshGain = this.ctx.createGain()
    this.whooshGain.gain.setValueAtTime(0.7, t)

    // Slow roar/whoosh modulation (identical in both ears — not a beat)
    this.lfo = this.ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.setValueAtTime(0.07, t)
    this.lfoDepth = this.ctx.createGain()
    this.lfoDepth.gain.setValueAtTime(0.1, t)
    this.lfo.connect(this.lfoDepth)
    this.lfoDepth.connect(this.whooshGain.gain)

    this.merger = this.ctx.createChannelMerger(2)
    this.jetGain = this.ctx.createGain()
    this.jetGain.gain.setValueAtTime(0, t)

    this.source.connect(this.lowShelf)
    this.lowShelf.connect(this.lowpass)
    this.lowpass.connect(this.bandpass)
    this.bandpass.connect(this.whooshGain)
    // Identical mono → both ears (no interaural difference / competing beat)
    this.whooshGain.connect(this.merger, 0, 0)
    this.whooshGain.connect(this.merger, 0, 1)
    this.merger.connect(this.jetGain)
    this.jetGain.connect(this.ctx.destination)

    this.source.start(t)
    this.lfo.start(t)
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

  private applyGain(immediate = false): void {
    if (!this.ctx || !this.jetGain) return
    const t = this.ctx.currentTime
    const next = this.targetGain()
    this.jetGain.gain.cancelScheduledValues(t)
    this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t)
    if (immediate) {
      this.jetGain.gain.linearRampToValueAtTime(next, t + this.FADE)
    } else {
      // Gentler phase duck / swell
      this.jetGain.gain.linearRampToValueAtTime(next, t + 0.6)
    }
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

  /** Follow Classic Deep session phases — ducks in hold, slight swell on wake/dip. */
  setPhase(phase: JetPhase): void {
    if (phase === 'paused') return // keep last intensity; context is suspended
    this.phaseIntensity = PHASE_INTENSITY[phase] ?? 0.4
    this.applyGain()
  }

  private teardownNodes(): void {
    try {
      this.source?.stop()
      this.lfo?.stop()
    } catch {
      /* already stopped */
    }
    this.source?.disconnect()
    this.lowShelf?.disconnect()
    this.lowpass?.disconnect()
    this.bandpass?.disconnect()
    this.whooshGain?.disconnect()
    this.lfo?.disconnect()
    this.lfoDepth?.disconnect()
    this.merger?.disconnect()
    this.jetGain?.disconnect()
    this.source = null
    this.lowShelf = null
    this.lowpass = null
    this.bandpass = null
    this.whooshGain = null
    this.lfo = null
    this.lfoDepth = null
    this.merger = null
    this.jetGain = null
  }

  async stop(): Promise<void> {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (this.jetGain) {
      this.jetGain.gain.cancelScheduledValues(t)
      this.jetGain.gain.setValueAtTime(this.jetGain.gain.value, t)
      this.jetGain.gain.linearRampToValueAtTime(0, t + this.FADE)
      await new Promise((r) => setTimeout(r, this.FADE * 1000 + 20))
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

/**
 * Stereo binaural beat engine.
 * Left = baseHz, Right = baseHz + beatHz.
 * Smooth gain ramps / crossfades when beat frequency changes (no clicks).
 * Carrier frequencies are clamped safely below Nyquist for the AudioContext sample rate.
 */
export class BinauralEngine {
  private ctx: AudioContext | null = null
  private leftOsc: OscillatorNode | null = null
  private rightOsc: OscillatorNode | null = null
  private leftGain: GainNode | null = null
  private rightGain: GainNode | null = null
  private masterGain: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private baseHz = 100
  private beatHz = 10
  private volume = 0.35
  private playing = false
  private readonly FADE = 0.04 // seconds for click-free transitions
  /** Leave headroom below Nyquist to avoid aliasing near the limit */
  private static readonly NYQUIST_MARGIN = 100

  async start(baseHz: number, beatHz: number, volume: number): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    this.baseHz = this.clampCarrier(baseHz)
    this.beatHz = Math.max(0, beatHz)
    this.volume = volume

    this.teardownNodes()
    this.createNodes()
    this.playing = true
  }

  /** Max playable oscillator frequency for current sample rate (below Nyquist). */
  private maxSafeHz(): number {
    const sr = this.ctx?.sampleRate ?? 44100
    return Math.max(100, sr / 2 - BinauralEngine.NYQUIST_MARGIN)
  }

  /** Clamp a carrier so both L and L+beat stay under Nyquist. */
  private clampCarrier(baseHz: number): number {
    const max = this.maxSafeHz()
    // Reserve room for typical beat offsets (up to ~20 Hz ramp-out)
    const ceiling = Math.max(50, max - Math.max(this.beatHz, 25))
    return Math.min(Math.max(50, baseHz), ceiling)
  }

  private createNodes(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const leftHz = this.clampCarrier(this.baseHz)
    const rightHz = Math.min(leftHz + this.beatHz, this.maxSafeHz())
    this.baseHz = leftHz

    this.merger = this.ctx.createChannelMerger(2)
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.setValueAtTime(0, t)
    this.masterGain.gain.linearRampToValueAtTime(this.volume, t + this.FADE)

    this.leftGain = this.ctx.createGain()
    this.rightGain = this.ctx.createGain()
    this.leftGain.gain.setValueAtTime(1, t)
    this.rightGain.gain.setValueAtTime(1, t)

    this.leftOsc = this.ctx.createOscillator()
    this.rightOsc = this.ctx.createOscillator()
    this.leftOsc.type = 'sine'
    this.rightOsc.type = 'sine'
    this.leftOsc.frequency.setValueAtTime(leftHz, t)
    this.rightOsc.frequency.setValueAtTime(rightHz, t)

    this.leftOsc.connect(this.leftGain)
    this.rightOsc.connect(this.rightGain)
    this.leftGain.connect(this.merger, 0, 0)
    this.rightGain.connect(this.merger, 0, 1)
    this.merger.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)

    this.leftOsc.start(t)
    this.rightOsc.start(t)
  }

  private teardownNodes(): void {
    try {
      this.leftOsc?.stop()
      this.rightOsc?.stop()
    } catch {
      /* already stopped */
    }
    this.leftOsc?.disconnect()
    this.rightOsc?.disconnect()
    this.leftGain?.disconnect()
    this.rightGain?.disconnect()
    this.merger?.disconnect()
    this.masterGain?.disconnect()
    this.leftOsc = null
    this.rightOsc = null
    this.leftGain = null
    this.rightGain = null
    this.merger = null
    this.masterGain = null
  }

  /** Change beat frequency with a short crossfade (no clicks). */
  setBeatHz(beatHz: number): void {
    if (!this.ctx || !this.playing || !this.rightOsc || !this.leftGain || !this.rightGain) {
      this.beatHz = beatHz
      return
    }
    if (Math.abs(beatHz - this.beatHz) < 0.001) return

    const t = this.ctx.currentTime
    const fade = this.FADE
    const nextBeat = Math.max(0, beatHz)
    const rightHz = Math.min(this.baseHz + nextBeat, this.maxSafeHz())

    // Dip gains briefly, change frequency, restore — avoids zipper noise
    this.leftGain.gain.cancelScheduledValues(t)
    this.rightGain.gain.cancelScheduledValues(t)
    this.leftGain.gain.setValueAtTime(this.leftGain.gain.value, t)
    this.rightGain.gain.setValueAtTime(this.rightGain.gain.value, t)
    this.leftGain.gain.linearRampToValueAtTime(0.15, t + fade * 0.5)
    this.rightGain.gain.linearRampToValueAtTime(0.15, t + fade * 0.5)

    this.rightOsc.frequency.setValueAtTime(this.baseHz + this.beatHz, t)
    this.rightOsc.frequency.linearRampToValueAtTime(rightHz, t + fade)
    this.beatHz = nextBeat

    this.leftGain.gain.linearRampToValueAtTime(1, t + fade)
    this.rightGain.gain.linearRampToValueAtTime(1, t + fade)
  }

  setBaseHz(baseHz: number): void {
    const clamped = this.clampCarrier(baseHz)
    this.baseHz = clamped
    if (!this.ctx || !this.playing || !this.leftOsc || !this.rightOsc) return
    const t = this.ctx.currentTime
    const rightHz = Math.min(clamped + this.beatHz, this.maxSafeHz())
    this.leftOsc.frequency.setTargetAtTime(clamped, t, 0.02)
    this.rightOsc.frequency.setTargetAtTime(rightHz, t, 0.02)
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (!this.ctx || !this.masterGain) return
    const t = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(t)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
    this.masterGain.gain.linearRampToValueAtTime(this.volume, t + this.FADE)
  }

  async pause(): Promise<void> {
    if (this.ctx && this.ctx.state === 'running') {
      await this.ctx.suspend()
    }
  }

  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
  }

  async stop(): Promise<void> {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(t)
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
      this.masterGain.gain.linearRampToValueAtTime(0, t + this.FADE)
      await new Promise((r) => setTimeout(r, this.FADE * 1000 + 20))
    }
    this.teardownNodes()
    this.playing = false
    try {
      await this.ctx.close()
    } catch {
      /* ignore */
    }
    this.ctx = null
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get currentBeatHz(): number {
    return this.beatHz
  }
}

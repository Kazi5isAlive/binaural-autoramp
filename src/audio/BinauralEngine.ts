/**
 * Stereo binaural beat engine.
 * Left = baseHz, Right = baseHz + beatHz.
 * Soft sine-family carriers with optional warmth lowpass; same Hz as configured.
 * Smooth frequency ramps (no sharp gain blips) when beat/carrier changes.
 *
 * Optional jet ambient bed is owned by JetNoiseEngine on the same AudioContext;
 * sines stay at full intended level — noise is ducked separately and never forms
 * a competing interaural beat (identical L/R).
 */
export class BinauralEngine {
  private ctx: AudioContext | null = null
  private leftOsc: OscillatorNode | null = null
  private rightOsc: OscillatorNode | null = null
  private leftGain: GainNode | null = null
  private rightGain: GainNode | null = null
  private leftWarm: BiquadFilterNode | null = null
  private rightWarm: BiquadFilterNode | null = null
  private softGain: GainNode | null = null
  private masterGain: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private baseHz = 100
  private beatHz = 10
  private volume = 0.22
  /** 0 = brighter/louder carriers; 1 = warmer/softer default. */
  private softness = 0.7
  private playing = false
  /** Short fade for master volume / start-stop only. */
  private readonly EDGE_FADE = 0.08
  /** Long crossfade when beat or carrier Hz changes. */
  private readonly FREQ_FADE = 1.2
  /** Leave headroom below Nyquist to avoid aliasing near the limit */
  private static readonly NYQUIST_MARGIN = 100

  async start(
    baseHz: number,
    beatHz: number,
    volume: number,
    softness = 0.7
  ): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }

    this.baseHz = this.clampCarrier(baseHz)
    this.beatHz = Math.max(0, beatHz)
    this.volume = volume
    this.softness = Math.max(0, Math.min(1, softness))

    this.teardownNodes()
    this.createNodes()
    this.playing = true
  }

  /** Shared context for companion layers (jet noise). */
  get audioContext(): AudioContext | null {
    return this.ctx
  }

  /** Max playable oscillator frequency for current sample rate (below Nyquist). */
  private maxSafeHz(): number {
    const sr = this.ctx?.sampleRate ?? 44100
    return Math.max(100, sr / 2 - BinauralEngine.NYQUIST_MARGIN)
  }

  /** Clamp a carrier so both L and L+beat stay under Nyquist. */
  private clampCarrier(baseHz: number): number {
    const max = this.maxSafeHz()
    const ceiling = Math.max(50, max - Math.max(this.beatHz, 25))
    return Math.min(Math.max(50, baseHz), ceiling)
  }

  /** Softness → lowpass cutoff (Hz) and extra attenuation. */
  private warmthCutoff(): number {
    // softness 0 → ~12 kHz (open); 1 → ~2.8 kHz (warm)
    return 12000 - this.softness * 9200
  }

  private softnessAttenuation(): number {
    // Keep beat clear; soften perception without burying it
    return 1 - this.softness * 0.28
  }

  private createNodes(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const leftHz = this.clampCarrier(this.baseHz)
    const rightHz = Math.min(leftHz + this.beatHz, this.maxSafeHz())
    this.baseHz = leftHz

    this.merger = this.ctx.createChannelMerger(2)
    this.softGain = this.ctx.createGain()
    this.softGain.gain.setValueAtTime(this.softnessAttenuation(), t)

    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.setValueAtTime(0, t)
    this.masterGain.gain.linearRampToValueAtTime(
      this.volume,
      t + this.EDGE_FADE
    )

    this.leftGain = this.ctx.createGain()
    this.rightGain = this.ctx.createGain()
    // Slight amplitude softness (gentle, not tremolo) — keeps beat intact
    const ampSoft = 0.92 + (1 - this.softness) * 0.08
    this.leftGain.gain.setValueAtTime(ampSoft, t)
    this.rightGain.gain.setValueAtTime(ampSoft, t)

    this.leftWarm = this.ctx.createBiquadFilter()
    this.rightWarm = this.ctx.createBiquadFilter()
    this.leftWarm.type = 'lowpass'
    this.rightWarm.type = 'lowpass'
    const cut = this.warmthCutoff()
    this.leftWarm.frequency.setValueAtTime(cut, t)
    this.rightWarm.frequency.setValueAtTime(cut, t)
    this.leftWarm.Q.setValueAtTime(0.5, t)
    this.rightWarm.Q.setValueAtTime(0.5, t)

    this.leftOsc = this.ctx.createOscillator()
    this.rightOsc = this.ctx.createOscillator()
    // Stay sine-family / warm sine — never square/saw
    this.leftOsc.type = 'sine'
    this.rightOsc.type = 'sine'
    this.leftOsc.frequency.setValueAtTime(leftHz, t)
    this.rightOsc.frequency.setValueAtTime(rightHz, t)

    this.leftOsc.connect(this.leftWarm)
    this.rightOsc.connect(this.rightWarm)
    this.leftWarm.connect(this.leftGain)
    this.rightWarm.connect(this.rightGain)
    this.leftGain.connect(this.merger, 0, 0)
    this.rightGain.connect(this.merger, 0, 1)
    this.merger.connect(this.softGain)
    this.softGain.connect(this.masterGain)
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
    this.leftWarm?.disconnect()
    this.rightWarm?.disconnect()
    this.leftGain?.disconnect()
    this.rightGain?.disconnect()
    this.softGain?.disconnect()
    this.merger?.disconnect()
    this.masterGain?.disconnect()
    this.leftOsc = null
    this.rightOsc = null
    this.leftWarm = null
    this.rightWarm = null
    this.leftGain = null
    this.rightGain = null
    this.softGain = null
    this.merger = null
    this.masterGain = null
  }

  /**
   * Change beat frequency with a long smooth freq ramp — no gain dip/blip.
   * Same left/right carrier relationship; only the difference Hz changes.
   */
  setBeatHz(beatHz: number): void {
    if (!this.ctx || !this.playing || !this.rightOsc || !this.leftOsc) {
      this.beatHz = beatHz
      return
    }
    if (Math.abs(beatHz - this.beatHz) < 0.001) return

    const t = this.ctx.currentTime
    const fade = this.FREQ_FADE
    const nextBeat = Math.max(0, beatHz)
    const leftHz = this.clampCarrier(this.baseHz)
    const rightHz = Math.min(leftHz + nextBeat, this.maxSafeHz())

    // Smooth frequency glide only — avoid cancel+jump and avoid gain ducking
    this.leftOsc.frequency.cancelScheduledValues(t)
    this.rightOsc.frequency.cancelScheduledValues(t)
    this.leftOsc.frequency.setValueAtTime(this.leftOsc.frequency.value, t)
    this.rightOsc.frequency.setValueAtTime(this.rightOsc.frequency.value, t)
    this.leftOsc.frequency.linearRampToValueAtTime(leftHz, t + fade)
    this.rightOsc.frequency.linearRampToValueAtTime(rightHz, t + fade)

    this.baseHz = leftHz
    this.beatHz = nextBeat
  }

  setBaseHz(baseHz: number): void {
    const clamped = this.clampCarrier(baseHz)
    this.baseHz = clamped
    if (!this.ctx || !this.playing || !this.leftOsc || !this.rightOsc) return
    const t = this.ctx.currentTime
    const fade = this.FREQ_FADE
    const rightHz = Math.min(clamped + this.beatHz, this.maxSafeHz())
    this.leftOsc.frequency.cancelScheduledValues(t)
    this.rightOsc.frequency.cancelScheduledValues(t)
    this.leftOsc.frequency.setValueAtTime(this.leftOsc.frequency.value, t)
    this.rightOsc.frequency.setValueAtTime(this.rightOsc.frequency.value, t)
    this.leftOsc.frequency.linearRampToValueAtTime(clamped, t + fade)
    this.rightOsc.frequency.linearRampToValueAtTime(rightHz, t + fade)
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (!this.ctx || !this.masterGain) return
    const t = this.ctx.currentTime
    this.masterGain.gain.cancelScheduledValues(t)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
    this.masterGain.gain.linearRampToValueAtTime(
      this.volume,
      t + this.EDGE_FADE
    )
  }

  /** Tone softness / warmth (0–1). Keeps same beat + carrier Hz. */
  setSoftness(softness: number): void {
    this.softness = Math.max(0, Math.min(1, softness))
    if (!this.ctx || !this.playing) return
    const t = this.ctx.currentTime
    const cut = this.warmthCutoff()
    const att = this.softnessAttenuation()
    const ampSoft = 0.92 + (1 - this.softness) * 0.08

    if (this.leftWarm && this.rightWarm) {
      this.leftWarm.frequency.cancelScheduledValues(t)
      this.rightWarm.frequency.cancelScheduledValues(t)
      this.leftWarm.frequency.setValueAtTime(this.leftWarm.frequency.value, t)
      this.rightWarm.frequency.setValueAtTime(this.rightWarm.frequency.value, t)
      this.leftWarm.frequency.linearRampToValueAtTime(cut, t + 0.4)
      this.rightWarm.frequency.linearRampToValueAtTime(cut, t + 0.4)
    }
    if (this.softGain) {
      this.softGain.gain.cancelScheduledValues(t)
      this.softGain.gain.setValueAtTime(this.softGain.gain.value, t)
      this.softGain.gain.linearRampToValueAtTime(att, t + 0.4)
    }
    if (this.leftGain && this.rightGain) {
      this.leftGain.gain.cancelScheduledValues(t)
      this.rightGain.gain.cancelScheduledValues(t)
      this.leftGain.gain.setValueAtTime(this.leftGain.gain.value, t)
      this.rightGain.gain.setValueAtTime(this.rightGain.gain.value, t)
      this.leftGain.gain.linearRampToValueAtTime(ampSoft, t + 0.4)
      this.rightGain.gain.linearRampToValueAtTime(ampSoft, t + 0.4)
    }
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
      this.masterGain.gain.linearRampToValueAtTime(0, t + this.EDGE_FADE)
      await new Promise((r) => setTimeout(r, this.EDGE_FADE * 1000 + 20))
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

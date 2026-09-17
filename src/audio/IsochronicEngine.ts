/**
 * True isochronic pulses — identical L/R (no competing interaural beat).
 * Soft amplitude-modulated tone; pulse rate can follow the binaural beat Hz
 * or use a fixed override. Continuous graph: rate/mix changes are ramps only.
 *
 * Shares AudioContext with BinauralEngine + JetNoiseEngine; never closes it.
 */

/** Soft default mix; hard-capped vs carrier so clicks stay optional/quiet. */
const MAX_ISO_TO_CARRIER = 0.22
const EDGE_FADE_SEC = 0.12
const RATE_RAMP_SEC = 1.2
const MIX_RAMP_SEC = 0.35

/** Gentle carrier under the AM envelope (audible soft pulse, not a click bomb). */
const CARRIER_HZ = 220
const LFO_DEPTH = 0.48
const LFO_OFFSET = 0.5

export class IsochronicEngine {
  private ctx: AudioContext | null = null
  private carrier: OscillatorNode | null = null
  private carrierWarm: BiquadFilterNode | null = null
  private ampGain: GainNode | null = null
  private lfo: OscillatorNode | null = null
  private lfoScale: GainNode | null = null
  private merger: ChannelMergerNode | null = null
  private masterGain: GainNode | null = null

  private enabled = false
  private mix = 0.12
  private carrierVolume = 0.22
  private rateHz = 4
  private playing = false
  private nodesReady = false

  /** Attach to an existing AudioContext (shared with binaural + jet). */
  attach(ctx: AudioContext): void {
    this.ctx = ctx
  }

  async start(
    carrierVolume: number,
    enabled: boolean,
    mix: number,
    rateHz: number
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
    this.rateHz = Math.max(0.5, Math.min(40, rateHz))

    if (!this.nodesReady) {
      this.teardownNodes()
      this.createNodes()
      this.nodesReady = true
    } else {
      this.applyRate(true)
    }

    this.playing = true
    this.applyGain(true)
  }

  private createNodes(): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime

    // Soft sine carrier (gentle pulsed tone; identical to both ears)
    this.carrier = this.ctx.createOscillator()
    this.carrier.type = 'sine'
    this.carrier.frequency.setValueAtTime(CARRIER_HZ, t)

    this.carrierWarm = this.ctx.createBiquadFilter()
    this.carrierWarm.type = 'lowpass'
    this.carrierWarm.frequency.setValueAtTime(1400, t)
    this.carrierWarm.Q.setValueAtTime(0.6, t)

    // AM envelope: offset + sine LFO → soft rise/fall (not hard square clicks)
    this.ampGain = this.ctx.createGain()
    this.ampGain.gain.setValueAtTime(LFO_OFFSET, t)

    this.lfo = this.ctx.createOscillator()
    this.lfo.type = 'sine'
    this.lfo.frequency.setValueAtTime(this.rateHz, t)

    this.lfoScale = this.ctx.createGain()
    this.lfoScale.gain.setValueAtTime(LFO_DEPTH, t)

    this.merger = this.ctx.createChannelMerger(2)
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.setValueAtTime(0, t)

    this.carrier.connect(this.carrierWarm)
    this.carrierWarm.connect(this.ampGain)
    this.lfo.connect(this.lfoScale)
    this.lfoScale.connect(this.ampGain.gain)

    // Identical mono → L and R (true isochronic; no L/R frequency difference)
    this.ampGain.connect(this.merger, 0, 0)
    this.ampGain.connect(this.merger, 0, 1)
    this.merger.connect(this.masterGain)
    this.masterGain.connect(this.ctx.destination)

    this.carrier.start(t)
    this.lfo.start(t)
  }

  private targetGain(): number {
    if (!this.enabled || !this.playing) return 0
    return this.carrierVolume * this.mix * MAX_ISO_TO_CARRIER
  }

  private applyGain(immediateEdge = false): void {
    if (!this.ctx || !this.masterGain) return
    const t = this.ctx.currentTime
    const next = this.targetGain()
    const ramp = immediateEdge ? EDGE_FADE_SEC : MIX_RAMP_SEC
    this.masterGain.gain.cancelScheduledValues(t)
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
    this.masterGain.gain.linearRampToValueAtTime(next, t + ramp)
  }

  private applyRate(immediate = false): void {
    if (!this.ctx || !this.lfo) return
    const t = this.ctx.currentTime
    const ramp = immediate ? EDGE_FADE_SEC : RATE_RAMP_SEC
    const hz = Math.max(0.5, Math.min(40, this.rateHz))
    this.lfo.frequency.cancelScheduledValues(t)
    this.lfo.frequency.setValueAtTime(this.lfo.frequency.value, t)
    this.lfo.frequency.linearRampToValueAtTime(hz, t + ramp)
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

  /**
   * Pulse rate in Hz (pulses per second). Smooth glide when beat Hz changes
   * so follow-beat mode stays continuous during ramps.
   */
  setRateHz(rateHz: number): void {
    const next = Math.max(0.5, Math.min(40, rateHz))
    if (Math.abs(next - this.rateHz) < 0.001) return
    this.rateHz = next
    if (!this.nodesReady || !this.playing) return
    this.applyRate(false)
  }

  private teardownNodes(): void {
    try {
      this.carrier?.stop()
      this.lfo?.stop()
    } catch {
      /* already stopped */
    }
    this.carrier?.disconnect()
    this.carrierWarm?.disconnect()
    this.ampGain?.disconnect()
    this.lfo?.disconnect()
    this.lfoScale?.disconnect()
    this.merger?.disconnect()
    this.masterGain?.disconnect()
    this.carrier = null
    this.carrierWarm = null
    this.ampGain = null
    this.lfo = null
    this.lfoScale = null
    this.merger = null
    this.masterGain = null
    this.nodesReady = false
  }

  async stop(): Promise<void> {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    if (this.masterGain) {
      this.masterGain.gain.cancelScheduledValues(t)
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t)
      this.masterGain.gain.linearRampToValueAtTime(0, t + EDGE_FADE_SEC)
      await new Promise((r) => setTimeout(r, EDGE_FADE_SEC * 1000 + 30))
    }
    this.teardownNodes()
    this.playing = false
    // Do not close shared ctx — BinauralEngine owns lifecycle when attached
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.ctx = null
  }

  get isPlaying(): boolean {
    return this.playing
  }

  get currentRateHz(): number {
    return this.rateHz
  }
}

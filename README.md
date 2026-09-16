# kazi5isalive Auto-Ramp

**Carrier-focused binaural beats** by kazi5isalive.

Press **Start Auto-Ramp** and the session runs by itself: an optional brainwave beat ramp → hold at the target difference → optional ramp out. The default beat is a fixed 4 Hz difference.

## Features

- Beat presets: Good (fixed target) / Fair (optional 8 Hz start) / Poor (optional 12 Hz start)
- Explicit beat range controls: From / To / Out to (1 Hz steps, fractional endpoints supported)
- Targets: 4 Hz, 3.8 Hz, 3.75 Hz
- Carrier range: base 50–16,000 Hz, with prominent 12 / 13 / 14 kHz and 12–14 kHz controls; right tone = base + beat
- **Quick Demo** — hear the full down→up journey in a few minutes
- Beat-path visualization with live playhead
- Adjustable step duration & hold length
- Click-free Web Audio oscillators (stereo: L = base, R = base + beat)
- Save named configurations
- Dark meditation UI

**Stereo headphones required.**

These are training wheels — eventually practice without beats.

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Deployed at: https://kazi5isalive.github.io/binaural-autoramp/

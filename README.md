# kazi5isalive Auto-Ramp

**Session-program binaural beats** by kazi5isalive.

Press **Start Auto-Ramp** and the hero **Classic Deep Session** runs by itself:
entry beat ramp → long hold at 4 Hz with periodic wake pulses and deep dips → optional exit.
Carrier (base) automation is separate from the beat.

## Classic Deep Session (default)

| Phase | Beat | Notes |
|-------|------|--------|
| Entry | 10→9→…→4 (or 20→4) | ~45 s / 1 Hz step (or smooth 6-min glide) |
| Hold | 4 Hz | ~30 min (adjustable 20–90) |
| Wake | 4→8→4 | every ~5 min · ~30 s at 8 Hz |
| Dip | 4→2→4 | every ~15 min · ~90 s at 2 Hz |
| Carrier | 512→256→128 Hz | **≠ beat** — left = carrier, right = carrier + beat |
| Exit | short ramp or gentle stop | e.g. 4→8→10 |

High-carrier mode (12–14 kHz) remains available as an alternate.

## Features

- First-class session program with interleaved wake/dip timeline
- Beat-path chart showing hold spikes (8) and dips (2)
- Live phase, beat, carrier, progress, and upcoming events
- Quick Demo (compressed classic shape)
- Manual timing / carrier / exit controls
- Click-free Web Audio (stereo)
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

# Metronome (web)

A sample-accurate browser metronome: React + TypeScript + Vite, with the click engine running in an AudioWorklet.

- BPM 30–300 (slider, field, ↑/↓, Shift+↑/↓), beats per bar 1–12 with an accented downbeat
- Tap tempo (button or T), beat indicator synced to what you hear, Space to start/stop
- Subdivisions (eighths with swing, triplets, sixteenths), per-beat accent/normal/mute (click a dot)
- Four sounds (Beep, Wood, Hi-hat, Click) and volume
- Gap trainer (play n bars, mute m) and speed trainer (+n BPM every m bars up to a target)

```sh
npm install
npm run dev     # then open the printed URL
npm test
npm run build   # static files in dist/
```

import type { SfxName } from './sim';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let hum: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
let muted = false;

export function initAudio() {
  if (ctx) { void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 118;
  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.value = 121.5;
  osc.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  osc.start();
  osc2.start();
  hum = { osc, osc2, gain, filter };
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

export function setHum(level: number, pitch: number) {
  if (!ctx || !hum) return;
  const t = ctx.currentTime;
  hum.gain.gain.setTargetAtTime(Math.min(0.12, level * 0.12), t, 0.15);
  hum.osc.frequency.setTargetAtTime(110 + pitch * 40, t, 0.2);
  hum.osc2.frequency.setTargetAtTime(113 + pitch * 42, t, 0.2);
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.25, delay = 0, slideTo?: number) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, vol = 0.3, freq = 800, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
}

export function play(name: SfxName) {
  switch (name) {
    case 'order': tone(880, 0.12, 'triangle', 0.2); tone(1175, 0.18, 'triangle', 0.2, 0.12); break;
    case 'pickup': noise(0.08, 0.25, 500); tone(300, 0.08, 'square', 0.08); break;
    case 'attach': tone(520, 0.06, 'square', 0.12); tone(780, 0.1, 'square', 0.12, 0.07); noise(0.05, 0.2, 2000, 0.05); break;
    case 'launch': tone(220, 0.6, 'sawtooth', 0.12, 0, 520); break;
    case 'drop': tone(660, 0.25, 'sine', 0.2, 0, 220); break;
    case 'perfect': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.08)); break;
    case 'good': [523, 659, 784].forEach((f, i) => tone(f, 0.2, 'triangle', 0.2, i * 0.08)); break;
    case 'miss': tone(300, 0.35, 'sawtooth', 0.15, 0, 120); break;
    case 'alarm': tone(988, 0.14, 'square', 0.12); tone(740, 0.14, 'square', 0.12, 0.16); tone(988, 0.14, 'square', 0.12, 0.32); break;
    case 'fixed': tone(600, 0.1, 'triangle', 0.2); tone(900, 0.2, 'triangle', 0.2, 0.1); break;
    case 'land': noise(0.25, 0.3, 300); tone(140, 0.2, 'sine', 0.2); break;
    case 'deny': tone(180, 0.15, 'square', 0.12); break;
    case 'swap': noise(0.1, 0.25, 1200); tone(400, 0.08, 'square', 0.1, 0.1); tone(800, 0.15, 'triangle', 0.15, 0.2); break;
    case 'select': tone(1400, 0.05, 'square', 0.08); break;
    case 'ping': tone(1320, 0.09, 'sine', 0.16); tone(1320, 0.09, 'sine', 0.12, 0.14); break;
    case 'clear': [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.22, i * 0.12)); break;
    case 'fail': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'sawtooth', 0.12, i * 0.18)); break;
  }
}

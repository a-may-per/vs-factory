// 程序化 BGM：简单音序器 + 合成器音色，产出确定性背景乐。零素材零版权。
// duel 用热血战斗曲（快 BPM 小调），music-ball 用明快解压曲（中 BPM 大调）。
import { writeWav } from "./sfx.ts";

const SR = 44100;
const note = (semi: number) => 440 * Math.pow(2, semi / 12);

export interface BgmOpts {
  bpm: number;
  bars: number;
  /** 和弦根音（相对 A4 半音，负数向下），每项一小节循环 */
  chordRoots: number[];
  chordType: "minor" | "major";
  melodySeed: number;
  lead: "square" | "saw" | "triangle";
}

function synthNote(freq: number, dur: number, wave: "square"|"saw"|"triangle", vol: number): Float32Array {
  const n = Math.floor(dur * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    if (wave === "square") v = Math.sign(Math.sin(2 * Math.PI * freq * t));
    else if (wave === "saw") v = 2 * ((freq * t) % 1) - 1;
    else v = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * freq * t));
    out[i] = v;
  }
  const attack = Math.floor(0.008 * SR);
  const release = Math.floor(Math.min(dur * 0.4, 0.15) * SR);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < attack) env = i / attack;
    if (i > n - release) env = Math.max(0, (n - i) / release);
    out[i] *= env * vol;
  }
  let dc = 0;
  for (const v of out) dc += v;
  dc /= n || 1;
  for (let i = 0; i < n; i++) out[i] -= dc;
  return out;
}

function place(dst: Float32Array, src: Float32Array, offsetSec: number): void {
  const start = Math.floor(offsetSec * SR);
  for (let i = 0; i < src.length; i++) {
    const j = start + i;
    if (j >= 0 && j < dst.length) dst[j] += src[i];
  }
}

/** 四轨 BGM：鼓（底鼓/军鼓/hihat）+ 贝斯 + 和弦垫 + 随机音阶主旋律。 */
export function generateBgm(opts: BgmOpts): Float32Array {
  const beat = 60 / opts.bpm;
  const bar = beat * 4;
  const total = opts.bars * bar + 1;
  const out = new Float32Array(Math.floor(total * SR));
  let a = opts.melodySeed >>> 0;
  const rng = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const scale = opts.chordType === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const third = opts.chordType === "minor" ? 3 : 4;

  for (let b = 0; b < opts.bars; b++) {
    const root = opts.chordRoots[b % opts.chordRoots.length];
    const t0 = b * bar;
    for (let bt = 0; bt < 4; bt++) {
      if (bt === 0 || bt === 2) {
        const kick = synthNote(55, 0.15, "saw", 0.9);
        for (let i = 0; i < kick.length; i++) kick[i] *= Math.exp(-30 * i / SR);
        place(out, kick, t0 + bt * beat);
      } else {
        const n = Math.floor(0.12 * SR);
        const snare = new Float32Array(n);
        for (let i = 0; i < n; i++) snare[i] = (rng() * 2 - 1) * Math.exp(-25 * i / SR) * 0.5;
        place(out, snare, t0 + bt * beat);
      }
      const hn = Math.floor(0.04 * SR);
      const hat = new Float32Array(hn);
      for (let i = 0; i < hn; i++) hat[i] = (rng() * 2 - 1) * Math.exp(-60 * i / SR) * 0.12;
      place(out, hat, t0 + bt * beat);
      place(out, hat, t0 + bt * beat + beat / 2);
    }
    for (let e = 0; e < 8; e++) {
      const f = note(root - 24) * (e % 4 === 3 ? 2 : 1);
      place(out, synthNote(f, (beat / 2) * 0.9, "saw", 0.32), t0 + e * beat / 2);
    }
    const chordFreqs = [note(root), note(root + third), note(root + 7)];
    for (const cf of chordFreqs) place(out, synthNote(cf, bar * 0.95, "triangle", 0.09), t0);
    for (let e = 0; e < 8; e++) {
      if (rng() < 0.3) continue;
      let step: number;
      if (e === 0) step = [0, 2, 4][Math.floor(rng() * 3)];
      else step = scale[Math.floor(rng() * scale.length)];
      const oct = rng() < 0.25 ? 12 : 0;
      place(out, synthNote(note(root + step + oct), (beat / 2) * 0.85, opts.lead, 0.20), t0 + e * beat / 2);
    }
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.9) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return out;
}

export function writeBgmWav(pcm: Float32Array, path: string): void {
  writeWav(pcm, path);
}

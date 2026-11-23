// 程序化音效合成器（jsfxr 思路）：按事件类型生成短音效，零素材零版权。
// mulberry32 确定性伪随机：同 seed 同音效，符合流水线可复现目标。
import { writeFileSync } from "node:fs";

export type SfxKind = "punch" | "crit" | "skill" | "death" | "vs-slam" | "coin" | "whoosh" | "hit" | "parry";

export interface SfxSpec {
  dur: number; freq: number; freqEnd: number; noise: number; decay: number;
  vol: number; slide: number; squareMix: number;
}

const SPECS: Record<SfxKind, SfxSpec> = {
  punch:     { dur: 0.12, freq: 245,  freqEnd: 68,   noise: 0.20, decay: 10,  vol: 0.92, slide: 4,  squareMix: 0.24 },
  crit:      { dur: 0.20, freq: 350,  freqEnd: 58,   noise: 0.24, decay: 8,   vol: 1.0,  slide: 5,  squareMix: 0.30 },
  skill:     { dur: 0.24, freq: 520,  freqEnd: 135,  noise: 0.14, decay: 7,   vol: 0.85, slide: -3, squareMix: 0.55 },
  death:     { dur: 0.55, freq: 180,  freqEnd: 30,   noise: 0.32, decay: 4,   vol: 1.0,  slide: -4, squareMix: 0.45 },
  "vs-slam": { dur: 0.38, freq: 155,  freqEnd: 38,   noise: 0.32, decay: 5.5, vol: 1.0,  slide: 2,  squareMix: 0.18 },
  coin:      { dur: 0.09, freq: 920,  freqEnd: 1460, noise: 0.0,  decay: 9,   vol: 0.58, slide: -2, squareMix: 0.65 },
  whoosh:    { dur: 0.18, freq: 420,  freqEnd: 95,   noise: 0.65, decay: 7.5, vol: 0.48, slide: 1,  squareMix: 0.0 },
  hit:       { dur: 0.075, freq: 380, freqEnd: 135,  noise: 0.12, decay: 13,  vol: 0.58, slide: -2, squareMix: 0.25 },
  parry:     { dur: 0.15, freq: 1260, freqEnd: 1820, noise: 0.07, decay: 8,   vol: 0.96, slide: 2,  squareMix: 0.45 },
};

const SR = 44100;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function synthSfx(kind: SfxKind, seed = 42, pitchMul = 1.0): Float32Array {
  const spec = SPECS[kind];
  const rng = mulberry32(seed);
  const n = Math.floor(spec.dur * SR);
  const out = new Float32Array(n);
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    // 频率滑动 + 指数衰减包络（零直流偏置 + 清脆泛音，彻底消除白噪刺耳底噪）
    const f = spec.freq * Math.pow(spec.freqEnd / spec.freq, k) * pitchMul;
    phase += (2 * Math.PI * f) / SR;
    phase2 += (2 * Math.PI * f * 2.41) / SR;
    const env = Math.exp(-spec.decay * k * 3);
    const square = Math.sign(Math.sin(phase)) * 0.72;
    const harmonicSine =
      Math.sin(phase) * 0.72 + Math.sin(phase * 2) * 0.20 + Math.sin(phase * 3) * 0.08;
    let tone = square * spec.squareMix + harmonicSine * (1 - spec.squareMix);
    if (kind === "parry") {
      // 金属刀剑/弹球清脆泛音（Inharmonic metallic bell overtone）
      tone = Math.sin(phase) * 0.58 + Math.sin(phase2) * 0.42;
    } else if (kind === "coin") {
      tone = Math.sin(phase) * 0.70 + Math.sin(phase * 2) * 0.30;
    }
    const noise = (rng() * 2 - 1) * Math.exp(-k * 5.5);
    const sample = tone * (1 - spec.noise) + noise * spec.noise;
    out[i] = sample * env * spec.vol;
  }
  // 简单压一下爆音
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 1) for (let i = 0; i < out.length; i++) out[i] /= peak;
  return out;
}

/** 写 WAV 文件（16bit mono） */
export function writeWav(samples: Float32Array, path: string): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

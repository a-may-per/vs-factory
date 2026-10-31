// 程序化多曲风音乐与精确卡点事件轴生成器（支持舒缓治愈钢琴/八音盒/拇指琴与动感电音，亦可与外部 MP3/WAV 混用）
import { writeFileSync } from "node:fs";
import { writeWav } from "../../shared/audio/sfx.ts";
import { normalize } from "../../shared/audio/mixer.ts";
import type { AxisEvent } from "./natural-level.ts";

export type SynthGenre =
  | "healing-piano"
  | "crystal-musicbox"
  | "lofi-kalimba"
  | "cyber-phonk"
  | "melodic-house"
  | "hyper-techno"
  | "chill-synthwave";

export interface SynthTrackSpec {
  genre: SynthGenre;
  title: string;
  tempo: number;
  durationSec: number;
  soothing?: boolean;
  scaleHz: number[];
  bassHz: number[];
}

export const SYNTH_GENRES: Record<SynthGenre, SynthTrackSpec> = {
  "healing-piano": {
    genre: "healing-piano",
    title: "治愈夜曲 · 晚安钢琴曲",
    tempo: 76,
    durationSec: 15.0,
    soothing: true,
    // C major 9 / A minor 9 soothing pentatonic-diatonic arpeggio (Canon-like healing intervals)
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99],
    bassHz: [130.81, 98.00, 110.00, 87.31], // C3 -> G2 -> A2 -> F2 Canon progression
  },
  "crystal-musicbox": {
    genre: "crystal-musicbox",
    title: "星空八音盒 · 静谧月光旋律",
    tempo: 82,
    durationSec: 15.0,
    soothing: true,
    // G major / E minor dreamy celesta music-box register
    scaleHz: [392.00, 440.00, 493.88, 587.33, 659.25, 783.99, 880.00, 987.77],
    bassHz: [196.00, 164.81, 130.81, 146.83], // G3 -> E3 -> C3 -> D3
  },
  "lofi-kalimba": {
    genre: "lofi-kalimba",
    title: "森林拇指琴 · 空灵微风",
    tempo: 86,
    durationSec: 15.0,
    soothing: true,
    // F major 7 warm kalimba tines
    scaleHz: [349.23, 392.00, 440.00, 523.25, 587.33, 659.25, 698.46, 880.00],
    bassHz: [174.61, 146.83, 110.00, 130.81], // F3 -> D3 -> A2 -> C3
  },
  "cyber-phonk": {
    genre: "cyber-phonk",
    title: "赛博漂移 Phonk",
    tempo: 135,
    durationSec: 15.0,
    scaleHz: [293.66, 349.23, 392.00, 440.00, 523.25, 587.33, 698.46, 783.99],
    bassHz: [73.42, 87.31, 98.00, 65.41],
  },
  "melodic-house": {
    genre: "melodic-house",
    title: "霓虹律动 House",
    tempo: 126,
    durationSec: 15.0,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25],
    bassHz: [110.00, 87.31, 130.81, 98.00],
  },
  "hyper-techno": {
    genre: "hyper-techno",
    title: "超载脉冲 Techno",
    tempo: 142,
    durationSec: 15.0,
    scaleHz: [349.23, 415.30, 466.16, 523.25, 622.25, 698.46, 830.61, 932.33],
    bassHz: [87.31, 77.78, 92.50, 103.83],
  },
  "chill-synthwave": {
    genre: "chill-synthwave",
    title: "星际合成器 Synthwave",
    tempo: 118,
    durationSec: 15.0,
    scaleHz: [261.63, 329.63, 392.00, 493.88, 523.25, 659.25, 783.99, 987.77],
    bassHz: [65.41, 82.41, 98.00, 73.42],
  },
};

export const SYNTH_GENRE_LIST: SynthGenre[] = [
  "healing-piano",
  "crystal-musicbox",
  "lofi-kalimba",
  "chill-synthwave",
  "melodic-house",
  "cyber-phonk",
  "hyper-techno",
];

function seededRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 治愈系分解和弦旋律走向（优雅起伏、像《卡农》/久石让夜曲一样自然呼吸）
const SOOTHING_MELODY_PATTERNS: number[][] = [
  [4, 2, 3, 4, 5, 4, 2, 1],
  [5, 4, 3, 2, 0, 2, 4, 3],
  [2, 4, 5, 7, 5, 4, 3, 2],
  [6, 5, 4, 2, 3, 4, 2, 0],
];

/**
 * 生成指定曲风 + 随机种子的高品质 WAV 与严格对齐的卡点 JSON 事件轴
 */
export function generateSynthSongAndAxis(
  wavPath: string,
  axisJsonPath: string,
  opts: {
    genre?: SynthGenre;
    seed?: number;
    durationSec?: number;
  } = {},
): {
  genre: SynthGenre;
  title: string;
  tempo: number;
  durationSec: number;
  events: AxisEvent[];
} {
  const seed = opts.seed ?? 77;
  const rng = seededRng(seed);
  const genre = opts.genre ?? SYNTH_GENRE_LIST[Math.abs(seed) % SYNTH_GENRE_LIST.length];
  const spec = SYNTH_GENRES[genre] ?? SYNTH_GENRES["healing-piano"];
  const tempo = spec.tempo;
  const durationSec = opts.durationSec ?? spec.durationSec;

  const SR = 44100;
  const totalSamples = Math.floor(durationSec * SR);
  const buf = new Float32Array(totalSamples);

  const beatInterval = 60 / tempo;
  const halfBeat = beatInterval / 2;
  const events: AxisEvent[] = [];

  if (spec.soothing) {
    // 舒缓治愈音乐合成管线：温暖毡音钢琴 / 水晶八音盒 / 拇指琴 + 柔和呼吸和弦铺底（无电子底鼓与刺耳白噪）
    const pattern = SOOTHING_MELODY_PATTERNS[Math.abs(seed) % SOOTHING_MELODY_PATTERNS.length];
    let stepIdx = 0;
    for (let t = 0.32; t < durationSec - 0.45; t += halfBeat, stepIdx++) {
      const isBeat = stepIdx % 2 === 0;
      const beatNum = Math.floor(stepIdx / 2);
      const isDownbeat = isBeat && beatNum % 4 === 0;
      // 舒缓曲目以正拍 + 优美分解半拍音符为主，留出呼吸感
      const includeOffbeat = !isBeat && (stepIdx % 4 === 1 || rng() < 0.38);
      if (!isBeat && !includeOffbeat) continue;

      const tier: "strong" | "beat" | "weak" = isDownbeat
        ? "strong"
        : isBeat
          ? (beatNum % 2 === 0 ? "strong" : "beat")
          : "weak";
      const strength = isDownbeat
        ? 0.88 + rng() * 0.08
        : tier === "strong"
          ? 0.74 + rng() * 0.10
          : isBeat
            ? 0.56 + rng() * 0.12
            : 0.40 + rng() * 0.10;

      events.push({
        t_ms: Math.round(t * 1000),
        strength: Number(strength.toFixed(3)),
        band: isDownbeat ? "perc" : "harm",
        beat: isBeat,
        downbeat: isDownbeat,
        tier,
      });

      const startSample = Math.floor(t * SR);
      const chordIdx = Math.floor(beatNum / 2) % spec.bassHz.length;
      const rootHz = spec.bassHz[chordIdx];

      // 1. 温暖大提琴/电钢琴低音和弦铺底（小节正拍轻柔渐入，给画面深邃治愈感）
      if (isDownbeat || (isBeat && beatNum % 2 === 0)) {
        const padLen = Math.floor(beatInterval * 2.3 * SR);
        const fifthHz = rootHz * 1.4983;
        const tenthHz = rootHz * 2.5198;
        let pRoot = 0;
        let pFifth = 0;
        let pTenth = 0;
        for (let i = 0; i < padLen && startSample + i < totalSamples; i++) {
          const dt = i / SR;
          pRoot += (2 * Math.PI * rootHz) / SR;
          pFifth += (2 * Math.PI * fifthHz) / SR;
          pTenth += (2 * Math.PI * tenthHz) / SR;
          const attack = Math.min(1, dt / 0.085);
          const decay = Math.exp(-dt * 1.45);
          const padWave =
            Math.sin(pRoot) * 0.52 +
            Math.sin(pFifth) * 0.30 +
            Math.sin(pTenth) * 0.18;
          buf[startSample + i] += padWave * attack * decay * (isDownbeat ? 0.24 : 0.16);
        }
      }

      // 2. 主旋律音符（毡音钢琴 / 水晶八音盒 / 拇指琴共鸣泛音 + 柔和自然延音）
      const melDeg = pattern[stepIdx % pattern.length];
      const noteIdx = (melDeg + chordIdx) % spec.scaleHz.length;
      const noteHz = spec.scaleHz[noteIdx];
      const noteDur = isDownbeat ? 1.35 : isBeat ? 1.05 : 0.78;
      const noteLen = Math.floor(noteDur * SR);
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      let p4 = 0;
      const decayRate = genre === "crystal-musicbox" ? 3.2 : genre === "lofi-kalimba" ? 4.0 : 2.6;
      const attackTime = genre === "crystal-musicbox" ? 0.006 : 0.012;
      for (let i = 0; i < noteLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        p1 += (2 * Math.PI * noteHz) / SR;
        p2 += (2 * Math.PI * noteHz * 2.0) / SR;
        p3 += (2 * Math.PI * noteHz * 3.0) / SR;
        p4 += (2 * Math.PI * noteHz * 4.002) / SR;
        const attack = Math.min(1, dt / attackTime);
        const env = attack * Math.exp(-dt * decayRate);
        // 高次泛音随时间更快衰减，模拟真实钢琴槌/音叉物理阻尼，柔润不刺耳
        const overtoneEnv = Math.exp(-dt * (decayRate * 2.4));
        const fundamental = Math.sin(p1) * 0.72 + Math.sin(p2) * 0.20;
        const shimmer = (Math.sin(p3) * 0.06 + Math.sin(p4) * 0.025) * overtoneEnv;
        const gain = isDownbeat ? 0.36 : isBeat ? 0.29 : 0.22;
        buf[startSample + i] += (fundamental + shimmer) * env * gain;
      }

      // 3. 轻柔八度泛音回声（模拟空间混响，延迟 140ms）
      const echoDelay = Math.floor(0.14 * SR);
      const echoLen = Math.floor(0.55 * SR);
      let pe = 0;
      for (let i = 0; i < echoLen && startSample + echoDelay + i < totalSamples; i++) {
        const dt = i / SR;
        pe += (2 * Math.PI * noteHz * 2.0) / SR;
        const env = Math.min(1, dt / 0.025) * Math.exp(-dt * 4.2);
        buf[startSample + echoDelay + i] += Math.sin(pe) * env * 0.055;
      }
    }
  } else {
    // 动感电音管线（底鼓 + 低音 Bassline + 主旋律 Pluck/Cowbell）
    let stepIdx = 0;
    for (let t = 0.28; t < durationSec - 0.35; t += halfBeat, stepIdx++) {
      const isBeat = stepIdx % 2 === 0;
      const beatNum = Math.floor(stepIdx / 2);
      const isDownbeat = isBeat && beatNum % 4 === 0;
      const includeOffbeat = !isBeat && (beatNum % 2 === 1 || rng() < 0.42);
      if (!isBeat && !includeOffbeat) continue;

      const tier: "strong" | "beat" | "weak" = isDownbeat
        ? "strong"
        : isBeat
          ? (beatNum % 2 === 0 && rng() < 0.45 ? "strong" : "beat")
          : "weak";
      const strength = isDownbeat
        ? 0.92 + rng() * 0.08
        : tier === "strong"
          ? 0.80 + rng() * 0.12
          : isBeat
            ? 0.58 + rng() * 0.18
            : 0.38 + rng() * 0.15;

      const band = isDownbeat || (isBeat && beatNum % 2 === 0) ? "perc" : "harm";
      events.push({
        t_ms: Math.round(t * 1000),
        strength: Number(strength.toFixed(3)),
        band,
        beat: isBeat,
        downbeat: isDownbeat,
        tier,
      });

      const startSample = Math.floor(t * SR);

      if (isBeat) {
        const kickLen = Math.floor(0.22 * SR);
        let phase = 0;
        for (let i = 0; i < kickLen && startSample + i < totalSamples; i++) {
          const dt = i / SR;
          const freq = 48 + 115 * Math.exp(-dt * 34);
          phase += (2 * Math.PI * freq) / SR;
          const env = Math.exp(-dt * 14);
          buf[startSample + i] += Math.sin(phase) * env * (isDownbeat ? 0.56 : 0.44);
        }
      }

      const noteIdx = (beatNum * 2 + (isBeat ? 0 : 3) + Math.floor(rng() * 2)) % spec.scaleHz.length;
      const noteHz = spec.scaleHz[noteIdx];
      const noteLen = Math.floor((isDownbeat ? 0.36 : 0.24) * SR);
      let p1 = 0;
      let p2 = 0;
      for (let i = 0; i < noteLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        p1 += (2 * Math.PI * noteHz) / SR;
        p2 += (2 * Math.PI * noteHz * (genre === "cyber-phonk" ? 1.498 : 2.0)) / SR;
        const env = Math.min(1, dt / 0.004) * Math.exp(-dt * (genre === "chill-synthwave" ? 7.5 : 11.5));
        const tone = Math.sin(p1) * 0.65 + Math.sin(p2) * 0.25 + (Math.sin(p1 * 3) * 0.10);
        buf[startSample + i] += tone * env * (isDownbeat ? 0.36 : 0.26);
      }

      if (isBeat) {
        const bassHz = spec.bassHz[Math.floor(beatNum / 4) % spec.bassHz.length];
        const bassLen = Math.floor(beatInterval * 0.88 * SR);
        let pb = 0;
        for (let i = 0; i < bassLen && startSample + i < totalSamples; i++) {
          const dt = i / SR;
          pb += (2 * Math.PI * bassHz) / SR;
          const sidechain = Math.min(1, dt / 0.06);
          const env = sidechain * Math.exp(-dt * 3.2);
          const saw = 2 * ((pb / (2 * Math.PI)) - Math.floor(0.5 + pb / (2 * Math.PI)));
          buf[startSample + i] += (Math.sin(pb) * 0.7 + saw * 0.3) * env * 0.25;
        }
      }

      if (!isBeat || beatNum % 2 === 1) {
        const hatLen = Math.floor(0.06 * SR);
        for (let i = 0; i < hatLen && startSample + i < totalSamples; i++) {
          const dt = i / SR;
          const noise = (Math.sin(i * 12.9898) * 43758.5453) % 1;
          buf[startSample + i] += noise * Math.exp(-dt * 55) * 0.12;
        }
      }
    }
  }

  normalize(buf, 0.88);
  writeWav(buf, wavPath);

  const axisData = {
    meta: {
      duration_s: durationSec,
      tempo,
      events: events.length,
      genre,
      title: spec.title,
    },
    events,
  };
  writeFileSync(axisJsonPath, JSON.stringify(axisData, null, 2));

  return {
    genre,
    title: spec.title,
    tempo,
    durationSec,
    events,
  };
}

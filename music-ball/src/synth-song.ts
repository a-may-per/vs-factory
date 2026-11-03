// 程序化多曲风音乐与精确卡点事件轴生成器（支持舒缓治愈钢琴/八音盒/拇指琴与动感电音，亦可与外部 MP3/WAV 混用）
import { writeFileSync } from "node:fs";
import { writeWav } from "../../shared/audio/sfx.ts";
import { normalize } from "../../shared/audio/mixer.ts";
import type { AxisEvent } from "./natural-level.ts";

export type SynthGenre =
  | "canon-piano"
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
  isCanon?: boolean;
  scaleHz: number[];
  bassHz: number[];
}

export const SYNTH_GENRES: Record<SynthGenre, SynthTrackSpec> = {
  "canon-piano": {
    genre: "canon-piano",
    title: "帕赫贝尔《卡农》· 完整版治愈钢琴",
    tempo: 96,
    durationSec: 42.0,
    soothing: true,
    isCanon: true,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [130.81, 98.00, 110.00, 82.41, 87.31, 130.81, 87.31, 98.00],
  },
  "healing-piano": {
    genre: "healing-piano",
    title: "治愈夜曲 · 卡农律动钢琴",
    tempo: 98,
    durationSec: 15.0,
    soothing: true,
    isCanon: true,
    // 与 NOTE_NAMES (C4, D4, E4, G4, A4, C5, D5, E5, G5, A5) 1:1 严格对齐的五声/大调音阶
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [130.81, 98.00, 110.00, 82.41, 87.31, 130.81, 87.31, 98.00],
  },
  "crystal-musicbox": {
    genre: "crystal-musicbox",
    title: "星空八音盒 · 灵动水晶琴",
    tempo: 104,
    durationSec: 15.0,
    soothing: true,
    // 与 NOTE_NAMES 1:1 严格对齐的清脆高音水晶八音盒音阶
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [130.81, 164.81, 110.00, 146.83],
  },
  "lofi-kalimba": {
    genre: "lofi-kalimba",
    title: "森林拇指琴 · 律动微风",
    tempo: 100,
    durationSec: 15.0,
    soothing: true,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [130.81, 110.00, 87.31, 98.00],
  },
  "cyber-phonk": {
    genre: "cyber-phonk",
    title: "赛博漂移 Phonk",
    tempo: 135,
    durationSec: 15.0,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [73.42, 87.31, 98.00, 65.41],
  },
  "melodic-house": {
    genre: "melodic-house",
    title: "霓虹律动 House",
    tempo: 126,
    durationSec: 15.0,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [110.00, 87.31, 130.81, 98.00],
  },
  "hyper-techno": {
    genre: "hyper-techno",
    title: "超载脉冲 Techno",
    tempo: 142,
    durationSec: 15.0,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
    bassHz: [87.31, 77.78, 92.50, 103.83],
  },
  "chill-synthwave": {
    genre: "chill-synthwave",
    title: "星际合成器 Synthwave",
    tempo: 118,
    durationSec: 15.0,
    scaleHz: [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00],
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

// 全自然音阶频率与视觉色板索引映射（完整覆盖帕赫贝尔《卡农》所需的 F4/B4/F5/C6 等全部音级）
const DIATONIC_MAP: Record<string, { hz: number; idx: number }> = {
  C4: { hz: 261.63, idx: 0 },
  D4: { hz: 293.66, idx: 1 },
  E4: { hz: 329.63, idx: 2 },
  F4: { hz: 349.23, idx: 2 },
  G4: { hz: 392.00, idx: 3 },
  A4: { hz: 440.00, idx: 4 },
  B4: { hz: 493.88, idx: 4 },
  C5: { hz: 523.25, idx: 5 },
  D5: { hz: 587.33, idx: 6 },
  E5: { hz: 659.25, idx: 7 },
  F5: { hz: 698.46, idx: 7 },
  G5: { hz: 783.99, idx: 8 },
  A5: { hz: 880.00, idx: 9 },
  B5: { hz: 987.77, idx: 9 },
  C6: { hz: 1046.50, idx: 9 },
};

interface CanonNoteStep {
  note: keyof typeof DIATONIC_MAP;
  durBeats: number;
  accent?: boolean;
}

// 帕赫贝尔《卡农》左手经典八和弦分解低音（I - V - vi - iii - IV - I - IV - V，每个和弦 2 拍 = 4 个八分琶音）
const CANON_LH_CHORDS: number[][] = [
  [130.81, 196.00, 261.63, 329.63], // C  (C3 - G3 - C4 - E4)
  [98.00, 146.83, 196.00, 246.94],  // G  (G2 - D3 - G3 - B3)
  [110.00, 164.81, 220.00, 261.63], // Am (A2 - E3 - A3 - C4)
  [82.41, 123.47, 164.81, 196.00],  // Em (E2 - B2 - E3 - G3)
  [87.31, 130.81, 174.61, 220.00],  // F  (F2 - C3 - F3 - A3)
  [130.81, 196.00, 261.63, 329.63], // C  (C3 - G3 - C4 - E4)
  [87.31, 130.81, 174.61, 220.00],  // F  (F2 - C3 - F3 - A3)
  [98.00, 146.83, 196.00, 246.94],  // G  (G2 - D3 - G3 - B3)
];

// 第一乐章（16拍）：《卡农》经典主题引入 + 流水八分琶音变奏
const CANON_MOVEMENT_1_THEME: CanonNoteStep[] = [
  // Chords 1-4: E5 - D5 - C5 - B4 经典下行主题 + 八分音符呼应
  { note: "E5", durBeats: 1.0, accent: true }, { note: "G5", durBeats: 0.5 }, { note: "E5", durBeats: 0.5 },
  { note: "D5", durBeats: 1.0, accent: true }, { note: "G4", durBeats: 0.5 }, { note: "B4", durBeats: 0.5 },
  { note: "C5", durBeats: 1.0, accent: true }, { note: "A4", durBeats: 0.5 }, { note: "C5", durBeats: 0.5 },
  { note: "B4", durBeats: 1.0, accent: true }, { note: "G4", durBeats: 0.5 }, { note: "B4", durBeats: 0.5 },
  // Chords 5-8: A4 - G4 - A4 - B4 流水八分变奏推进
  { note: "A4", durBeats: 0.5, accent: true }, { note: "F4", durBeats: 0.5 }, { note: "A4", durBeats: 0.5 }, { note: "C5", durBeats: 0.5 },
  { note: "G4", durBeats: 0.5, accent: true }, { note: "E4", durBeats: 0.5 }, { note: "G4", durBeats: 0.5 }, { note: "C5", durBeats: 0.5 },
  { note: "A4", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.5 }, { note: "F5", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.5 },
  { note: "B4", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.5 }, { note: "G5", durBeats: 0.5, accent: true }, { note: "F5", durBeats: 0.5 },
];

// 第二乐章（16拍）：帕赫贝尔《卡农》享誉全球的经典十六分音符高潮大爆发（Mi - Do Re Mi - Do Re Mi Sol La Si Do Re Mi Fa...）
const CANON_MOVEMENT_2_CLIMAX: CanonNoteStep[] = [
  // Chord 1 (C): E5 - C5 D5 E5 - C5 D5
  { note: "E5", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 },
  { note: "E5", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 },
  // Chord 2 (G): E5 G4 A4 B4 C5 D5 E5 F5
  { note: "E5", durBeats: 0.25, accent: true }, { note: "G4", durBeats: 0.25 }, { note: "A4", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 },
  { note: "C5", durBeats: 0.25, accent: true }, { note: "D5", durBeats: 0.25 }, { note: "E5", durBeats: 0.25 }, { note: "F5", durBeats: 0.25 },
  // Chord 3 (Am): D5 - B4 C5 D5 - E4 F4
  { note: "D5", durBeats: 0.5, accent: true }, { note: "B4", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 },
  { note: "D5", durBeats: 0.5, accent: true }, { note: "E4", durBeats: 0.25 }, { note: "F4", durBeats: 0.25 },
  // Chord 4 (Em): G4 A4 B4 C5 B4 A4 G4 B4
  { note: "G4", durBeats: 0.25, accent: true }, { note: "A4", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 },
  { note: "B4", durBeats: 0.25, accent: true }, { note: "A4", durBeats: 0.25 }, { note: "G4", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 },
  // Chord 5 (F): A4 - F4 G4 A4 - G4 F4
  { note: "A4", durBeats: 0.5, accent: true }, { note: "F4", durBeats: 0.25 }, { note: "G4", durBeats: 0.25 },
  { note: "A4", durBeats: 0.5, accent: true }, { note: "G4", durBeats: 0.25 }, { note: "F4", durBeats: 0.25 },
  // Chord 6 (C): G4 C5 B4 C5 A4 C5 G4 C5
  { note: "G4", durBeats: 0.25, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 },
  { note: "A4", durBeats: 0.25, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "G4", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 },
  // Chord 7 (F): A4 - C5 B4 C5 - A4 C5
  { note: "A4", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 },
  { note: "C5", durBeats: 0.5, accent: true }, { note: "A4", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 },
  // Chord 8 (G): B4 D5 C5 D5 B4 D5 G5 F5
  { note: "B4", durBeats: 0.25, accent: true }, { note: "D5", durBeats: 0.25 }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 },
  { note: "B4", durBeats: 0.25, accent: true }, { note: "D5", durBeats: 0.25 }, { note: "G5", durBeats: 0.25 }, { note: "F5", durBeats: 0.25 },
];

// 第三乐章（16拍）：高八度璀璨水晶变奏与律动切分对位
const CANON_MOVEMENT_3_VARIATION: CanonNoteStep[] = [
  // Chord 1 (C)
  { note: "E5", durBeats: 0.5, accent: true }, { note: "G5", durBeats: 0.5 }, { note: "C6", durBeats: 0.5, accent: true }, { note: "G5", durBeats: 0.5 },
  // Chord 2 (G)
  { note: "G5", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.25 }, { note: "E5", durBeats: 0.25 }, { note: "F5", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.5 },
  // Chord 3 (Am)
  { note: "E5", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 }, { note: "E5", durBeats: 0.5, accent: true }, { note: "A5", durBeats: 0.5 },
  // Chord 4 (Em)
  { note: "G5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 }, { note: "B4", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 5 (F)
  { note: "F5", durBeats: 0.5, accent: true }, { note: "A5", durBeats: 0.25 }, { note: "G5", durBeats: 0.25 }, { note: "F5", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.5 },
  // Chord 6 (C)
  { note: "E5", durBeats: 0.25, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 }, { note: "E5", durBeats: 0.25 }, { note: "G5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 7 (F)
  { note: "F5", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.25 }, { note: "E5", durBeats: 0.25 }, { note: "F5", durBeats: 0.5, accent: true }, { note: "A5", durBeats: 0.5 },
  // Chord 8 (G)
  { note: "G5", durBeats: 0.25, accent: true }, { note: "F5", durBeats: 0.25 }, { note: "E5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 },
  { note: "B4", durBeats: 0.25, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 },
];

// 第四乐章（18拍）：终章华彩再现与主和弦圆满收束（Grand Finale Resolution）
const CANON_MOVEMENT_4_FINALE: CanonNoteStep[] = [
  // Chord 1 (C)
  { note: "C5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.25 }, { note: "F5", durBeats: 0.25 }, { note: "G5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 2 (G)
  { note: "D5", durBeats: 0.5, accent: true }, { note: "G5", durBeats: 0.25 }, { note: "F5", durBeats: 0.25 }, { note: "D5", durBeats: 0.5, accent: true }, { note: "B4", durBeats: 0.5 },
  // Chord 3 (Am)
  { note: "C5", durBeats: 0.5, accent: true }, { note: "A4", durBeats: 0.25 }, { note: "B4", durBeats: 0.25 }, { note: "C5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 4 (Em)
  { note: "B4", durBeats: 0.5, accent: true }, { note: "G4", durBeats: 0.5 }, { note: "B4", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 5 (F)
  { note: "A4", durBeats: 0.5, accent: true }, { note: "C5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 }, { note: "F5", durBeats: 0.5, accent: true }, { note: "A5", durBeats: 0.5 },
  // Chord 6 (C)
  { note: "G5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.25 }, { note: "D5", durBeats: 0.25 }, { note: "C5", durBeats: 0.5, accent: true }, { note: "E5", durBeats: 0.5 },
  // Chord 7 (F)
  { note: "F5", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.5 }, { note: "C5", durBeats: 0.5, accent: true }, { note: "A4", durBeats: 0.5 },
  // Chord 8 (G)
  { note: "B4", durBeats: 0.5, accent: true }, { note: "D5", durBeats: 0.5 }, { note: "G5", durBeats: 0.5, accent: true }, { note: "B4", durBeats: 0.5 },
  // Finale Tonic Resolution (C Major Grand Sustain · 双音主和弦圆满收束，凑成 154 个偶数音符以完美支持迷宫 90° 反射奇偶无缝闭环)
  { note: "C5", durBeats: 1.0, accent: true }, { note: "E5", durBeats: 1.0, accent: true },
];
interface ScoreStep {
  durBeats: number;
  deg: number;
  accent: boolean;
}

const VIRAL_MIDI_PHRASES: ScoreStep[][] = [
  // Phrase A：经典《卡农 / 天空之城》式叙事律动（稳健起拍 -> 4连十六分快闪 -> 长音落地 -> 切分推进 -> 高潮连击）
  [
    { durBeats: 0.50, deg: 5, accent: true },
    { durBeats: 0.50, deg: 4, accent: false },
    { durBeats: 0.50, deg: 5, accent: true },
    { durBeats: 0.50, deg: 7, accent: false },
    { durBeats: 0.25, deg: 8, accent: true },
    { durBeats: 0.25, deg: 7, accent: false },
    { durBeats: 0.25, deg: 5, accent: false },
    { durBeats: 0.25, deg: 4, accent: false },
    { durBeats: 0.75, deg: 5, accent: true },
    { durBeats: 0.25, deg: 2, accent: false },
    // Bar 2
    { durBeats: 0.50, deg: 3, accent: true },
    { durBeats: 0.25, deg: 4, accent: false },
    { durBeats: 0.25, deg: 5, accent: false },
    { durBeats: 0.50, deg: 4, accent: true },
    { durBeats: 0.50, deg: 2, accent: false },
    { durBeats: 0.25, deg: 0, accent: true },
    { durBeats: 0.25, deg: 2, accent: false },
    { durBeats: 0.25, deg: 4, accent: false },
    { durBeats: 0.25, deg: 7, accent: false },
    { durBeats: 0.50, deg: 6, accent: true },
    { durBeats: 0.50, deg: 5, accent: false },
  ],
  // Phrase B：灵动八音盒跳跃律动（附点起跳 + 密集十六分音阶跑动）
  [
    { durBeats: 0.75, deg: 4, accent: true },
    { durBeats: 0.25, deg: 5, accent: false },
    { durBeats: 0.50, deg: 7, accent: true },
    { durBeats: 0.50, deg: 5, accent: false },
    { durBeats: 0.25, deg: 4, accent: true },
    { durBeats: 0.25, deg: 5, accent: false },
    { durBeats: 0.25, deg: 7, accent: false },
    { durBeats: 0.25, deg: 8, accent: false },
    { durBeats: 0.50, deg: 7, accent: true },
    { durBeats: 0.50, deg: 4, accent: false },
    // Bar 2
    { durBeats: 0.50, deg: 5, accent: true },
    { durBeats: 0.50, deg: 3, accent: false },
    { durBeats: 0.25, deg: 2, accent: true },
    { durBeats: 0.25, deg: 3, accent: false },
    { durBeats: 0.25, deg: 4, accent: false },
    { durBeats: 0.25, deg: 5, accent: false },
    { durBeats: 0.75, deg: 4, accent: true },
    { durBeats: 0.25, deg: 2, accent: false },
    { durBeats: 0.50, deg: 0, accent: true },
    { durBeats: 0.50, deg: 2, accent: false },
  ],
];

/**
 * 生成指定曲风 + 随机种子的高品质 WAV 与严格 1:1 音画同源对齐的卡点 JSON 事件轴
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

  if (spec.isCanon) {
    // 帕赫贝尔《卡农》完整版钢琴合成管线：
    // - 时长 >= 28s 时演奏完整四乐章（主题引入 -> 十六分经典高潮 -> 高八度变奏 -> 终章收束，共 66 拍 ≈ 42s）
    // - 时长 < 28s 时直接从经典高潮乐章切入，确保短片也能立即听到最震撼的卡农十六分连击
    const canonScore: CanonNoteStep[] =
      durationSec >= 28
        ? [
            ...CANON_MOVEMENT_1_THEME,
            ...CANON_MOVEMENT_2_CLIMAX,
            ...CANON_MOVEMENT_3_VARIATION,
            ...CANON_MOVEMENT_4_FINALE,
          ]
        : [
            ...CANON_MOVEMENT_2_CLIMAX,
            ...CANON_MOVEMENT_3_VARIATION,
            ...CANON_MOVEMENT_4_FINALE,
          ];

    // 1. 铺设《卡农》左手经典八和弦分解琶音伴奏（I - V - vi - iii - IV - I - IV - V，每半拍一颗温暖低音琴键）
    const halfBeatSec = beatInterval * 0.5;
    for (let eigIdx = 0, bt = 0.26; bt < durationSec - 0.45; eigIdx++, bt += halfBeatSec) {
      const startSample = Math.floor(bt * SR);
      const chordIdx = Math.floor(eigIdx / 4) % CANON_LH_CHORDS.length;
      const arpSlot = eigIdx % 4;
      const lhHz = CANON_LH_CHORDS[chordIdx][arpSlot];
      const isChordRoot = arpSlot === 0;
      const noteLen = Math.floor(beatInterval * (isChordRoot ? 1.8 : 1.1) * SR);
      let p1 = 0;
      let p2 = 0;
      for (let i = 0; i < noteLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        p1 += (2 * Math.PI * lhHz) / SR;
        p2 += (2 * Math.PI * lhHz * 2.0) / SR;
        const attack = Math.min(1, dt / 0.005);
        const decay = Math.exp(-dt * (isChordRoot ? 2.2 : 3.6));
        const thump = isChordRoot ? Math.sin(p1 * 0.5) * Math.exp(-dt * 38) * 0.16 : 0;
        const warmAccomp = (Math.sin(p1) * 0.72 + Math.sin(p2) * 0.28) * attack * decay;
        buf[startSample + i] += warmAccomp * (isChordRoot ? 0.18 : 0.11) + thump;
      }
    }

    // 2. 严格按《卡农》右手原谱合成清脆三角钢琴主旋律，并与视觉碰撞节点 1:1 绝对对齐
    let curT = 0.26;
    let curBeatPos = 0;
    let stepIdx = 0;
    while (curT < durationSec - 0.36) {
      const step = canonScore[stepIdx % canonScore.length];
      const durSec = step.durBeats * beatInterval;
      if (curT + Math.min(durSec * 0.4, 0.25) > durationSec - 0.26) break;

      const beatMod4 = curBeatPos % 4;
      const isDownbeat = Math.abs(beatMod4) < 0.02 || Math.abs(beatMod4 - 4) < 0.02;
      const isOnBeat = Math.abs(curBeatPos - Math.round(curBeatPos)) < 0.02;
      const isFastBurst = step.durBeats <= 0.26;

      const mapped = DIATONIC_MAP[step.note] ?? DIATONIC_MAP.C5;
      const noteHz = mapped.hz;
      const noteIdx = mapped.idx;

      const tier: "strong" | "beat" | "weak" = isDownbeat || step.accent
        ? "strong"
        : isOnBeat
          ? "beat"
          : "weak";
      const strength = isDownbeat
        ? 0.95
        : step.accent
          ? 0.85
          : isFastBurst
            ? 0.74
            : 0.64;

      const evObj: AxisEvent & { noteIdx?: number; noteName?: string } = {
        t_ms: Math.round(curT * 1000),
        strength: Number(strength.toFixed(3)),
        band: isDownbeat || step.accent ? "perc" : "harm",
        beat: isOnBeat,
        downbeat: isDownbeat,
        tier,
        noteIdx,
        noteName: step.note,
      };
      events.push(evObj);

      const startSample = Math.floor(curT * SR);
      const noteDur = Math.max(0.36, durSec * 1.65);
      const noteLen = Math.floor(noteDur * SR);
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      let p4 = 0;
      let pClick = 0;
      const decayRate = step.durBeats >= 1.5 ? 1.8 : 3.2;
      const attackTime = 0.0015;
      const gain = isDownbeat ? 0.46 : step.accent ? 0.40 : 0.34;

      for (let i = 0; i < noteLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        // 三角钢琴轻微双弦失谐（1.0006x）赋予真实大钢琴温润厚实的共鸣感
        p1 += (2 * Math.PI * noteHz) / SR;
        p2 += (2 * Math.PI * noteHz * 2.001) / SR;
        p3 += (2 * Math.PI * noteHz * 3.002) / SR;
        p4 += (2 * Math.PI * noteHz * 4.004) / SR;
        pClick += (2 * Math.PI * (noteHz * 5.0 + 1350)) / SR;

        const attack = Math.min(1, dt / attackTime);
        const bodyEnv = attack * Math.exp(-dt * decayRate);
        const overtoneEnv = attack * Math.exp(-dt * (decayRate * 2.6));
        const malletStrike = Math.sin(pClick) * Math.exp(-dt * 150) * 0.21;

        const fundamental = Math.sin(p1) * 0.68 + Math.sin(p2) * 0.24;
        const shimmer = (Math.sin(p3) * 0.09 + Math.sin(p4) * 0.04) * overtoneEnv;
        buf[startSample + i] += (fundamental * bodyEnv + shimmer + malletStrike) * gain;
      }

      curT += durSec;
      curBeatPos += step.durBeats;
      stepIdx++;
      // 若已演奏完第四乐章最后一颗 2.0 拍主和弦收束音，直接优雅结束，不重复循环开头
      if (durationSec >= 28 && stepIdx >= canonScore.length) break;
    }
  } else if (spec.soothing) {
    // 1. 先铺设整首曲目的四分音符律动底脉冲（温暖低音大提琴/软木槌重音 + 清脆八音盒节拍齿轮轻叩），让节奏骨架清晰可感
    for (let beatIdx = 0, bt = 0.26; bt < durationSec - 0.35; beatIdx++, bt += beatInterval) {
      const startSample = Math.floor(bt * SR);
      const isDownbeat = beatIdx % 4 === 0;
      const isHalfBar = beatIdx % 2 === 0;
      const chordIdx = Math.floor(beatIdx / 2) % spec.bassHz.length;
      const rootHz = spec.bassHz[chordIdx];

      // 温暖柔润的拍点低音脉冲（模拟钢琴左手低音八度触键）
      const pulseLen = Math.floor(beatInterval * (isHalfBar ? 1.6 : 0.9) * SR);
      const fifthHz = rootHz * 1.4983;
      let pRoot = 0;
      let pFifth = 0;
      for (let i = 0; i < pulseLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        pRoot += (2 * Math.PI * rootHz) / SR;
        pFifth += (2 * Math.PI * fifthHz) / SR;
        const attack = Math.min(1, dt / 0.008);
        const decay = Math.exp(-dt * (isHalfBar ? 2.4 : 4.2));
        // 拍头前 15ms 加入温润的软槌低频瞬态（增强拍感而不刺耳）
        const thump = Math.sin(pRoot * 0.5) * Math.exp(-dt * 42) * (isDownbeat ? 0.22 : 0.14);
        const warmPad = (Math.sin(pRoot) * 0.65 + Math.sin(pFifth) * 0.35) * attack * decay;
        buf[startSample + i] += warmPad * (isDownbeat ? 0.24 : isHalfBar ? 0.18 : 0.11) + thump;
      }
    }

    // 2. 严格按爆款 MIDI 节奏型合成主旋律音符，并将每一颗音符 1:1 写入事件轴（零空拍、零假细分）
    const phrase = VIRAL_MIDI_PHRASES[Math.abs(seed) % VIRAL_MIDI_PHRASES.length];
    let curT = 0.26;
    let curBeatPos = 0;
    let stepIdx = 0;

    while (curT < durationSec - 0.36) {
      const step = phrase[stepIdx % phrase.length];
      const durSec = step.durBeats * beatInterval;
      if (curT + durSec * 0.5 > durationSec - 0.28) break;

      const beatMod4 = curBeatPos % 4;
      const isDownbeat = Math.abs(beatMod4) < 0.02 || Math.abs(beatMod4 - 4) < 0.02;
      const isOnBeat = Math.abs(curBeatPos - Math.round(curBeatPos)) < 0.02;
      const isFastBurst = step.durBeats <= 0.26;

      const chordIdx = Math.floor(curBeatPos / 2) % spec.bassHz.length;
      const noteIdx = (step.deg + chordIdx) % spec.scaleHz.length;
      const noteHz = spec.scaleHz[noteIdx];

      const tier: "strong" | "beat" | "weak" = isDownbeat || step.accent
        ? "strong"
        : isOnBeat
          ? "beat"
          : "weak";
      const strength = isDownbeat
        ? 0.94
        : step.accent
          ? 0.84
          : isFastBurst
            ? 0.72
            : 0.62;

      const evObj: AxisEvent & { noteIdx?: number } = {
        t_ms: Math.round(curT * 1000),
        strength: Number(strength.toFixed(3)),
        band: isDownbeat || step.accent ? "perc" : "harm",
        beat: isOnBeat,
        downbeat: isDownbeat,
        tier,
        noteIdx,
      };
      events.push(evObj);

      const startSample = Math.floor(curT * SR);
      const noteDur = Math.max(0.32, durSec * 1.45);
      const noteLen = Math.floor(noteDur * SR);
      let p1 = 0;
      let p2 = 0;
      let p3 = 0;
      let p4 = 0;
      let pClick = 0;
      const decayRate = genre === "crystal-musicbox" ? 4.2 : genre === "lofi-kalimba" ? 4.8 : 3.5;
      // 毫秒级（1.5ms）清脆琴槌/音叉敲击瞬态，让耳朵在碰撞瞬间立刻捕捉到精准卡点！
      const attackTime = 0.0015;
      const gain = isDownbeat ? 0.44 : step.accent ? 0.38 : 0.32;

      for (let i = 0; i < noteLen && startSample + i < totalSamples; i++) {
        const dt = i / SR;
        p1 += (2 * Math.PI * noteHz) / SR;
        p2 += (2 * Math.PI * noteHz * 2.0) / SR;
        p3 += (2 * Math.PI * noteHz * 3.0) / SR;
        p4 += (2 * Math.PI * noteHz * 4.0) / SR;
        pClick += (2 * Math.PI * (noteHz * 5.5 + 1400)) / SR;

        const attack = Math.min(1, dt / attackTime);
        const bodyEnv = attack * Math.exp(-dt * decayRate);
        const overtoneEnv = attack * Math.exp(-dt * (decayRate * 3.0));
        // 前 8ms 的清脆木槌/水晶拨片瞬态（Hammer/Mallet Strike Transient），赋予极强的物理敲击卡点感
        const malletStrike = Math.sin(pClick) * Math.exp(-dt * 145) * 0.22;

        const fundamental = Math.sin(p1) * 0.70 + Math.sin(p2) * 0.22;
        const shimmer = (Math.sin(p3) * 0.08 + Math.sin(p4) * 0.04) * overtoneEnv;
        buf[startSample + i] += (fundamental * bodyEnv + shimmer + malletStrike) * gain;
      }

      curT += durSec;
      curBeatPos += step.durBeats;
      stepIdx++;
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

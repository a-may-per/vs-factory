// 音乐片段截取与高潮自动识别模块（支持任意 MP3/WAV/M4A/MP4 视频提取音频 + 手动时间段 + 自动副歌高潮检测）
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { writeWav } from "../../shared/audio/sfx.ts";

const SR = 44100;

export interface ClipOptions {
  /** 起始时间（秒，或 "MM:SS" / "HH:MM:SS" 字符串） */
  start?: number | string;
  /** 片段时长（秒，默认 15.5 秒） */
  duration?: number;
  /** 默认片段时长（秒） */
  defaultClipDuration?: number;
  /** 简写区间，例如 "00:42-00:58" 或 "42-58" */
  clip?: string;
  /** 简写区间别名 */
  clipRange?: string;
  /** 当输入整首歌且未指定 start 时，自动挑选第几个高能片段（0 = 最高能副歌，1 = 次高能片段，用于批量切条） */
  segmentIndex?: number;
  /** 总共计划切几段（可选） */
  totalSegments?: number;
  /** 是否自动识别高潮/副歌片段（默认 true） */
  autoClimax?: boolean;
  /** 是否保留整首歌不裁剪 */
  fullSong?: boolean;
}

export interface PreparedClipResult {
  wavPath: string;
  title: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  originalDurationSec: number;
  autoClimaxUsed: boolean;
  isAutoClimax: boolean;
}

/**
 * 解析秒数或 "MM:SS" / "HH:MM:SS" 时间格式
 */
export function parseTimeSec(input: number | string | undefined): number | undefined {
  if (input === undefined || input === "") return undefined;
  if (typeof input === "number") return Number.isFinite(input) ? Math.max(0, input) : undefined;
  const trimmed = input.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, parseFloat(trimmed));
  }
  const parts = trimmed.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return undefined;
}

/**
 * 解析 "--clip 00:42-00:58" 或 "42~57"
 */
export function parseClipRange(rangeStr?: string): { startSec?: number; durationSec?: number } {
  if (!rangeStr) return {};
  const m = rangeStr.trim().split(/\s*[-~至到]\s*/);
  if (m.length !== 2) return {};
  const s = parseTimeSec(m[0]);
  const e = parseTimeSec(m[1]);
  if (s !== undefined && e !== undefined && e > s) {
    return { startSec: s, durationSec: e - s };
  }
  return {};
}

export function formatTimeMMSS(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

function readMonoWavSamples(path: string): Float32Array {
  const b = readFileSync(path);
  let p = 12, ch = 0, bits = 0, d = -1, n = 0;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const z = b.readUInt32LE(p + 4);
    const q = p + 8;
    if (id === "fmt ") {
      ch = b.readUInt16LE(q + 2);
      bits = b.readUInt16LE(q + 14);
    }
    if (id === "data") {
      d = q;
      n = Math.min(z, b.length - q);
      break;
    }
    p = q + z + (z % 2);
  }
  if (d < 0 || ch < 1 || bits !== 16) throw new Error("16-bit PCM WAV required");
  const out = new Float32Array(Math.floor(n / 2 / ch));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += b.readInt16LE(d + (i * ch + c) * 2) / 32768;
    out[i] = s / ch;
  }
  return out;
}

/**
 * 在整首歌曲采样中自动寻找最适合做卡点短视频的高潮/副歌片段（结合响度 RMS + 瞬态鼓点能量差）
 * 支持返回前 K 个互不重叠的高能片段，方便一首歌批量切出多条短视频。
 */
export function findTopClimaxSegments(
  samples: Float32Array,
  clipDurationSec: number,
  maxCount = 5,
): { startSec: number; score: number }[] {
  const totalSec = samples.length / SR;
  if (totalSec <= clipDurationSec + 1.0) {
    return [{ startSec: 0, score: 1 }];
  }

  // 以 0.25s 为一帧计算能量包络与瞬态冲击度
  const frameSamples = Math.floor(SR * 0.25);
  const numFrames = Math.floor(samples.length / frameSamples);
  const rmsEnv = new Float32Array(numFrames);
  const fluxEnv = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * frameSamples;
    let sumSq = 0;
    let transient = 0;
    for (let i = 0; i < frameSamples; i += 4) {
      const v = samples[offset + i];
      sumSq += v * v;
      if (i > 0) {
        const diff = Math.abs(v - samples[offset + i - 4]);
        if (diff > 0.08) transient += diff;
      }
    }
    const count = frameSamples / 4;
    rmsEnv[f] = Math.sqrt(sumSq / count);
    fluxEnv[f] = transient / count;
  }

  const winFrames = Math.max(4, Math.round(clipDurationSec / 0.25));
  // 避开最开头 2 秒和最结尾 3 秒的淡入淡出区
  const minFrame = totalSec > clipDurationSec + 6 ? Math.floor(2.0 / 0.25) : 0;
  const maxFrame = Math.max(minFrame, numFrames - winFrames - Math.floor(2.5 / 0.25));

  const candidates: { startSec: number; score: number }[] = [];
  for (let startF = minFrame; startF <= maxFrame; startF += 2) {
    let sumRms = 0;
    let sumFlux = 0;
    let activeFrames = 0;
    for (let w = 0; w < winFrames; w++) {
      const r = rmsEnv[startF + w];
      const fl = fluxEnv[startF + w];
      sumRms += r;
      sumFlux += fl;
      if (r > 0.05) activeFrames++;
    }
    // 惩罚中间有大段静音的区间，优先选择鼓点密集+响度饱满的副歌 Drop
    const continuity = activeFrames / winFrames;
    const score = (sumRms / winFrames) * 0.55 + (sumFlux / winFrames) * 1.45 * continuity;
    candidates.push({ startSec: Number((startF * 0.25).toFixed(2)), score });
  }

  candidates.sort((a, b) => b.score - a.score);

  const picked: { startSec: number; score: number }[] = [];
  const minSeparation = Math.max(6.0, clipDurationSec * 0.65);
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p.startSec - c.startSec) >= minSeparation)) {
      picked.push(c);
      if (picked.length >= maxCount) break;
    }
  }
  return picked.length > 0 ? picked : [{ startSec: 0, score: 1 }];
}

/**
 * 将外部音频/视频文件准备为标准 44.1kHz 单声道 WAV 片段：
 * - 若指定了 start / clipRange，按指定时间段精确裁剪；
 * - 若未指定 start 且原曲时长 > 22 秒，自动提取全曲最高能副歌片段（默认 15.5 秒）；
 * - 自动对裁剪边缘施加平滑淡入淡出，消除切歌爆音。
 */
export function prepareAudioClip(
  inputPath: string,
  outWavPath: string,
  opts: ClipOptions = {},
): PreparedClipResult {
  const rawName = basename(inputPath, extname(inputPath))
    .replace(/[_-]+/g, " ")
    .trim();
  const title = rawName || "Custom Track";

  const fullTmpWav = `/tmp/mb_full_decode_${process.pid}_${Date.now()}.wav`;
  const decode = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", inputPath, "-ac", "1", "-ar", String(SR), "-sample_fmt", "s16", fullTmpWav],
    { stdio: "inherit" },
  );
  if (decode.status !== 0) {
    throw new Error(`ffmpeg failed to decode audio from ${inputPath}`);
  }

  const allSamples = readMonoWavSamples(fullTmpWav);
  const originalDurationSec = Number((allSamples.length / SR).toFixed(2));

  const rangeParsed = parseClipRange(opts.clip ?? opts.clipRange);
  const explicitStart = parseTimeSec(opts.start) ?? rangeParsed.startSec;
  const targetDuration = rangeParsed.durationSec ?? opts.duration ?? opts.defaultClipDuration ?? 15.5;

  let startSec = explicitStart ?? 0;
  let durationSec = Math.min(originalDurationSec, targetDuration);
  let autoClimaxUsed = false;

  if (opts.fullSong || opts.autoClimax === false) {
    if (explicitStart !== undefined) {
      startSec = Math.min(Math.max(0, explicitStart), Math.max(0, originalDurationSec - 2.0));
      durationSec = Math.min(targetDuration, originalDurationSec - startSec);
    } else {
      startSec = 0;
      durationSec = originalDurationSec;
    }
  } else if (explicitStart !== undefined) {
    startSec = Math.min(Math.max(0, explicitStart), Math.max(0, originalDurationSec - 2.0));
    durationSec = Math.min(targetDuration, originalDurationSec - startSec);
  } else if (originalDurationSec > targetDuration + 4.0) {
    // 未指定起始时间且输入是一首长歌：自动定位最高能副歌/Drop 片段！
    const topSegments = findTopClimaxSegments(allSamples, targetDuration, 8);
    const idx = Math.abs(opts.segmentIndex ?? 0) % topSegments.length;
    startSec = topSegments[idx].startSec;
    durationSec = Math.min(targetDuration, originalDurationSec - startSec);
    autoClimaxUsed = true;
  } else {
    startSec = 0;
    durationSec = originalDurationSec;
  }

  const startSample = Math.max(0, Math.floor(startSec * SR));
  const lenSamples = Math.min(allSamples.length - startSample, Math.floor(durationSec * SR));
  const clipped = new Float32Array(lenSamples);

  const fadeInSamples = startSec > 0.1 ? Math.min(Math.floor(0.15 * SR), Math.floor(lenSamples * 0.1)) : 0;
  const fadeOutSamples = (startSample + lenSamples < allSamples.length - Math.floor(0.2 * SR))
    ? Math.min(Math.floor(0.35 * SR), Math.floor(lenSamples * 0.15))
    : 0;

  for (let i = 0; i < lenSamples; i++) {
    let gain = 1.0;
    if (fadeInSamples > 0 && i < fadeInSamples) {
      gain = i / fadeInSamples;
    } else if (fadeOutSamples > 0 && i >= lenSamples - fadeOutSamples) {
      gain = (lenSamples - 1 - i) / fadeOutSamples;
    }
    clipped[i] = allSamples[startSample + i] * gain;
  }

  writeWav(clipped, outWavPath, SR);

  const finalStart = Number(startSec.toFixed(2));
  const finalDur = Number((lenSamples / SR).toFixed(2));
  return {
    wavPath: outWavPath,
    title,
    startSec: finalStart,
    endSec: Number((finalStart + finalDur).toFixed(2)),
    durationSec: finalDur,
    originalDurationSec,
    autoClimaxUsed,
    isAutoClimax: autoClimaxUsed,
  };
}

/**
 * 对切片后的 WAV 音频提取节拍与瞬态事件轴（优先调用 librosa，若环境无 librosa 则自动使用内置零依赖 TS DSP 节拍提取器）
 */
export function analyzeAudioAxis(wavPath: string, outAxisPath: string, mbDir?: string): void {
  if (mbDir) {
    const venvPy = join(mbDir, ".venv/bin/python");
    const analyzePy = join(mbDir, "tools/analyze.py");
    if (existsSync(venvPy) && existsSync(analyzePy)) {
      const res = spawnSync(venvPy, [analyzePy, wavPath, outAxisPath], { stdio: "pipe" });
      if (res.status === 0 && existsSync(outAxisPath)) {
        if (res.stdout?.length) process.stdout.write(res.stdout);
        return;
      }
    }
  }

  // 内置零依赖 TS DSP 节拍与瞬态分析器（自相关 BPM 估计 + 鼓点相位对齐 + 高低频分离）
  const samples = readMonoWavSamples(wavPath);
  const duration = samples.length / SR;
  const hop = 512;
  const nFrames = Math.max(1, Math.floor(samples.length / hop));
  const rms = new Float32Array(nFrames);
  const lowE = new Float32Array(nFrames);
  const highE = new Float32Array(nFrames);
  const onsetEnv = new Float32Array(nFrames);

  let lpState = 0;
  for (let f = 0; f < nFrames; f++) {
    const base = f * hop;
    let sumSq = 0;
    let sumLow = 0;
    let sumHigh = 0;
    for (let i = 0; i < hop; i++) {
      const x = samples[base + i];
      lpState += 0.08 * (x - lpState);
      const hp = x - lpState;
      sumSq += x * x;
      sumLow += lpState * lpState;
      sumHigh += hp * hp;
    }
    rms[f] = Math.sqrt(sumSq / hop);
    lowE[f] = sumLow / hop;
    highE[f] = sumHigh / hop;
    if (f > 0) {
      const diff = rms[f] - rms[f - 1];
      const lowDiff = Math.sqrt(lowE[f]) - Math.sqrt(lowE[f - 1]);
      onsetEnv[f] = Math.max(0, diff * 1.2 + Math.max(0, lowDiff) * 0.9);
    }
  }

  let maxOnset = 1e-6;
  for (let f = 0; f < nFrames; f++) {
    if (onsetEnv[f] > maxOnset) maxOnset = onsetEnv[f];
  }
  const normOnset = new Float32Array(nFrames);
  for (let f = 0; f < nFrames; f++) normOnset[f] = onsetEnv[f] / maxOnset;

  // 在 68..160 BPM 范围内通过自相关寻找主导节拍周期（兼容 70-90 BPM 舒缓钢琴/八音盒/白噪音与 120-160 BPM 动感电音）
  const frameRate = SR / hop;
  let bestBpm = 120;
  let bestScore = -1;
  for (let bpm = 68; bpm <= 160; bpm += 1) {
    const lag = Math.round((60 / bpm) * frameRate);
    if (lag < 4 || lag >= nFrames) continue;
    let ac = 0;
    for (let f = lag; f < nFrames; f++) {
      ac += normOnset[f] * normOnset[f - lag];
    }
    if (ac > bestScore) {
      bestScore = ac;
      bestBpm = bpm;
    }
  }

  const periodSec = 60 / bestBpm;
  const periodFrames = Math.max(4, Math.round(periodSec * frameRate));
  let bestPhase = 0;
  let bestPhaseEnergy = -1;
  for (let ph = 0; ph < periodFrames; ph++) {
    let e = 0;
    for (let f = ph; f < nFrames; f += periodFrames) {
      e += normOnset[f] + (f > 0 ? normOnset[f - 1] * 0.5 : 0) + (f + 1 < nFrames ? normOnset[f + 1] * 0.5 : 0);
    }
    if (e > bestPhaseEnergy) {
      bestPhaseEnergy = e;
      bestPhase = ph;
    }
  }

  const beatTimes: number[] = [];
  for (let t = bestPhase / frameRate; t < duration - 0.15; t += periodSec) {
    if (t >= 0.08) beatTimes.push(t);
  }

  // 提取局部峰值 onset
  const onsetPeaks: { t: number; strength: number }[] = [];
  for (let f = 2; f < nFrames - 2; f++) {
    const v = normOnset[f];
    if (v > 0.16 && v >= normOnset[f - 1] && v >= normOnset[f + 1] && v >= normOnset[f - 2] && v >= normOnset[f + 2]) {
      const t = f / frameRate;
      if (onsetPeaks.length === 0 || t - onsetPeaks[onsetPeaks.length - 1].t > 0.09) {
        onsetPeaks.push({ t, strength: Math.min(1, Number((v * 1.15).toFixed(3))) });
      }
    }
  }

  const beatTol = Math.max(0.075, Math.min(0.12, 30 / bestBpm));
  const bandAt = (tSec: number): "perc" | "harm" => {
    const idx = Math.min(nFrames - 1, Math.max(0, Math.round(tSec * frameRate)));
    return lowE[idx] * 1.35 >= highE[idx] ? "perc" : "harm";
  };
  const strengthAt = (tSec: number): number => {
    const idx = Math.min(nFrames - 1, Math.max(0, Math.round(tSec * frameRate)));
    return Math.min(1, Math.max(0.28, Number((normOnset[idx] * 0.85 + rms[idx] * 0.65).toFixed(3))));
  };

  interface RawEv {
    t_ms: number;
    strength: number;
    band: "perc" | "harm";
    beat: boolean;
    downbeat: boolean;
    tier?: "strong" | "beat" | "weak";
  }

  const events: RawEv[] = [];
  beatTimes.forEach((bt, bi) => {
    let nearOnset: { t: number; strength: number } | undefined;
    for (const op of onsetPeaks) {
      if (Math.abs(op.t - bt) <= beatTol) {
        if (!nearOnset || Math.abs(op.t - bt) < Math.abs(nearOnset.t - bt)) nearOnset = op;
      }
    }
    const st = Math.max(strengthAt(bt), nearOnset ? nearOnset.strength : 0.35);
    events.push({
      t_ms: Math.round(bt * 1000),
      strength: Number(st.toFixed(3)),
      band: bandAt(nearOnset ? nearOnset.t : bt),
      beat: true,
      downbeat: bi % 4 === 0,
    });
  });

  const melodicThresh = bestBpm < 100 ? 0.34 : 0.46;
  for (const op of onsetPeaks) {
    const nearBeat = beatTimes.some((bt) => Math.abs(bt - op.t) <= beatTol);
    if (!nearBeat && op.strength >= melodicThresh) {
      events.push({
        t_ms: Math.round(op.t * 1000),
        strength: op.strength,
        band: bandAt(op.t),
        beat: false,
        downbeat: false,
      });
    }
  }

  events.sort((a, b) => a.t_ms - b.t_ms);
  const filtered: RawEv[] = [];
  for (const ev of events) {
    if (filtered.length > 0 && ev.t_ms - filtered[filtered.length - 1].t_ms < 95) {
      const prev = filtered[filtered.length - 1];
      if (ev.beat && !prev.beat) filtered[filtered.length - 1] = ev;
    } else {
      filtered.push(ev);
    }
  }

  const sortedSt = filtered.map((e) => e.strength).sort((a, b) => a - b);
  const strongCut = sortedSt.length > 0 ? sortedSt[Math.floor(sortedSt.length * 0.68)] : 0.65;
  for (const ev of filtered) {
    if (ev.downbeat || ev.strength >= strongCut) ev.tier = "strong";
    else if (ev.beat) ev.tier = "beat";
    else ev.tier = "weak";
  }

  const meta = {
    duration_s: Number(duration.toFixed(2)),
    tempo: bestBpm,
    events: filtered.length,
    strong_events: filtered.filter((e) => e.tier === "strong").length,
    beat_events: filtered.filter((e) => e.tier === "beat").length,
    weak_events: filtered.filter((e) => e.tier === "weak").length,
    beat_tolerance_ms: Math.round(beatTol * 1000),
  };
  writeFileSync(outAxisPath, JSON.stringify({ meta, events: filtered }, null, 2));
  console.log(`      analyzed ${wavPath}: tempo=${meta.tempo}BPM, events=${meta.events} (saved ${outAxisPath})`);
}

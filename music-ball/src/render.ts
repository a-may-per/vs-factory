// Music-Ball 短视频爆款全系渲染引擎（默认 1080×1920 竖屏 9:16）：
// 【三大全新全网顶流爆款模式】：
// 1. maze     （弹跳方块·音符迷宫）：全网播放量第一的发光圆角方块 2D 开放空间 45° 对角线折返 + 3D 立体斜切音砖回弹
// 2. staircase（2.5D 水晶阶梯·八音盒）：抖音/小红书千万赞治愈水晶琉璃球抛物线拾级而下 + 3D 三面体水晶琴键下沉 + 极光光柱
// 3. pendulum （催眠钟摆波·激光竖琴）：海外 2000W+ 播放 Polyrhythm 同心星弧轨道 + 多普勒蛇形相位波 + 中轴激光竖琴弦驻波共振
// 【三大经典保留模式（完整保留可随时切换）】：
// 4. corridor （赛博深井·琴键折返弹射）：左右壁面发光钢琴砖块 + 真实法线水平折返 + 零穿模
// 5. hopper   （几何节拍·重力音阶跳台）：因果重力反推抛物线 + 100% 踏板上表面向上起跳 + 弹簧压陷 + 零穿模
// 6. rings    （破壁圆环·同心牢笼爆破）：节拍内壁反弹 + 重拍碎环 + 外环推进
import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { synthSfx, writeWav } from "../../shared/audio/sfx.ts";
import { mixTracks, normalize } from "../../shared/audio/mixer.ts";
import type { AxisEvent } from "./natural-level.ts";
import {
  BALL_SKIN_NAMES,
  NOTE_NAMES,
  SOOTHING_HOOKS,
  VIRAL_HOOKS,
  drawFitText,
  drawShortVideoHud,
  drawStylizedBall,
  pickBallSkin,
  pickTheme,
  type BallSkinId,
  type MusicBallMode,
  type ThemeId,
} from "./themes.ts";
import {
  buildViralNodes,
  renderMazeMode,
  renderPendulumMode,
  renderStaircaseMode,
} from "./viral-modes.ts";
import { readFileSync } from "node:fs";

const FPS = 30;
const SR = 44100;
const INTRO_SEC = 0.0;
const OUTRO_SEC = 0.90;
const BALL_R = 28;

export interface RenderMusicBallOptions {
  seed?: number;
  mode?: MusicBallMode;
  theme?: ThemeId;
  skin?: BallSkinId;
  hookText?: string;
  songTitle?: string;
  aspect?: "9:16" | "16:9";
}

interface AxisFile {
  meta: {
    duration_s: number;
    tempo: number;
    events: number;
    title?: string;
  };
  events: AxisEvent[];
}

interface BeatNode {
  id: number;
  t: number;
  strength: number;
  strong: boolean;
  downbeat: boolean;
  band: string;
  noteName: string;
  // Mode-specific geometry
  x: number;         // Ball center X at exact impact
  y: number;         // Ball center Y at exact impact
  side: "left" | "right";
  protrude: number;  // Corridor key protrusion
  padX: number;      // Hopper pad center X
  padY: number;      // Hopper pad center Y
  padW: number;
  padH: number;
  angle: number;     // Rings impact angle
  shatterRing: boolean;
  ringIndex: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function seededRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function readMonoWav(path: string): Float32Array {
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
 * 从音频事件轴提取节奏骨架节点（保证最小间隔 >= 0.22s，使每次弹跳清晰可辨、绝不鬼畜）
 */
function buildBeatNodes(
  axis: AxisFile,
  seed: number,
  W: number,
  H: number,
): BeatNode[] {
  const rng = seededRng(seed);
  const raw = [...axis.events].sort((a, b) => a.t_ms - b.t_ms);
  const strengths = raw.map(e => e.strength).sort((a, b) => a - b);
  const strongCut = strengths.length ? strengths[Math.floor(strengths.length * 0.65)] : 0.65;

  const filtered: AxisEvent[] = [];
  let lastT = -999;
  for (const ev of raw) {
    const t = ev.t_ms / 1000;
    if (t < 0.20 || t > axis.meta.duration_s - 0.25) continue;
    const isStrong = Boolean(ev.downbeat || ev.tier === "strong" || ev.strength >= strongCut);
    const minGap = isStrong ? 0.22 : 0.27;
    if (t - lastT < minGap) {
      // 如果新事件明显更强且距离上个点很近，替换上个点以确保强拍必中
      if (isStrong && filtered.length > 0 && !filtered[filtered.length - 1].downbeat) {
        filtered[filtered.length - 1] = ev;
        lastT = t;
      }
      continue;
    }
    filtered.push(ev);
    lastT = t;
  }

  // 若开头空白较长，插入一个热身起跳点
  if (!filtered.length || filtered[0].t_ms / 1000 > 0.65) {
    filtered.unshift({
      t_ms: 350,
      strength: 0.9,
      band: "perc",
      beat: true,
      downbeat: true,
      tier: "strong",
    });
  }

  // Corridor 墙面内壁基准坐标
  const shaftLeft = Math.round(W * 0.135);
  const shaftRight = Math.round(W * 0.865);

  // Hopper 四车道水平坐标（保证相邻踏板水平错开 >= 205px，绝不上下重叠挡路）
  const lanes = [
    Math.round(W * 0.21),
    Math.round(W * 0.40),
    Math.round(W * 0.60),
    Math.round(W * 0.79),
  ];

  const nodes: BeatNode[] = [];
  let curY = 420;
  let hopperY = 460;
  let prevLane = 1;
  let curAngle = -Math.PI * 0.35;
  let ringIdx = 0;
  let hitsInCurrentRing = 0;

  for (let i = 0; i < filtered.length; i++) {
    const ev = filtered[i];
    const t = ev.t_ms / 1000;
    const prevT = i > 0 ? filtered[i - 1].t_ms / 1000 : 0;
    const dt = i > 0 ? Math.max(0.20, t - prevT) : 0.35;
    const nextT = i + 1 < filtered.length ? filtered[i + 1].t_ms / 1000 : t + 0.4;
    const nextDt = Math.max(0.20, nextT - t);

    const strong = Boolean(ev.downbeat || ev.tier === "strong" || ev.strength >= strongCut);
    const side: "left" | "right" = i % 2 === 0 ? "left" : "right";

    // 1. Corridor 几何：短间隔时琴键适当向井道中心伸出，控制横向飞行速度自然流畅
    const speedFactor = clamp((0.42 - Math.min(dt, nextDt)) / 0.22, 0, 1);
    const protrude = Math.round(46 + speedFactor * 115 + (strong ? 16 : 0));
    if (i > 0) {
      curY += Math.round(clamp(dt * 470, 155, 310));
    }
    const corridorX = side === "left"
      ? shaftLeft + protrude + BALL_R
      : shaftRight - protrude - BALL_R;

    // 2. Hopper 几何：严格切换到不同车道（水平间距 >= 205px），踏板宽度 168px，绝不遮挡抛物线
    let lane = prevLane;
    const candidateLanes = [0, 1, 2, 3].filter(l => l !== prevLane);
    lane = candidateLanes[Math.floor(rng() * candidateLanes.length)];
    prevLane = lane;

    if (i > 0) {
      hopperY += Math.round(clamp(dt * 215, 84, 185));
    }
    const padW = strong ? 182 : 158;
    const padH = strong ? 36 : 30;
    const padX = lanes[lane];
    const padY = hopperY;

    // 3. Rings 几何：每次撞击沿圆环内壁跨弦弹射（转角 130°~230°），重拍或满 2 次撞击即轰碎当前圆环！
    const deltaAngle = (132 + rng() * 96) * (Math.PI / 180) * (i % 2 === 0 ? 1 : -1);
    curAngle += deltaAngle;
    hitsInCurrentRing++;
    const shatterRing = (strong && hitsInCurrentRing >= 2) || hitsInCurrentRing >= 3;
    const nodeRingIdx = ringIdx;
    if (shatterRing) {
      ringIdx++;
      hitsInCurrentRing = 0;
    }

    nodes.push({
      id: i,
      t,
      strength: clamp(ev.strength, 0.25, 1),
      strong,
      downbeat: Boolean(ev.downbeat),
      band: ev.band || "perc",
      noteName: NOTE_NAMES[(i * 2 + (strong ? 3 : 0)) % NOTE_NAMES.length],
      x: corridorX,
      y: curY,
      side,
      protrude,
      padX,
      padY,
      padW,
      padH,
      angle: curAngle,
      shatterRing,
      ringIndex: nodeRingIdx,
    });
  }

  return nodes;
}

/**
 * 采样音频短时频谱包络（驱动背景均衡器频谱柱与发光脉冲）
 */
function computeSpectrumFrame(
  samples: Float32Array,
  gameT: number,
  numBars: number,
  hitFlash: number,
): number[] {
  const centerIdx = Math.floor(Math.max(0, gameT) * SR);
  const windowSize = 1024;
  const out: number[] = [];
  let rms = 0;
  const start = Math.max(0, centerIdx - windowSize / 2);
  const end = Math.min(samples.length, start + windowSize);
  for (let i = start; i < end; i++) {
    rms += samples[i] * samples[i];
  }
  rms = Math.sqrt(rms / Math.max(1, end - start));

  for (let b = 0; b < numBars; b++) {
    const bandOffset = Math.floor((b / numBars) * (windowSize * 0.7));
    const idx = Math.min(samples.length - 1, Math.max(0, start + bandOffset));
    const local = Math.abs(samples[idx]);
    const wave = 0.25 + 0.25 * Math.sin(gameT * 9.5 + b * 0.55);
    const val = clamp(rms * 2.4 + local * 0.95 + wave * 0.35 + hitFlash * 0.45, 0.08, 1.0);
    out.push(val);
  }
  return out;
}

/**
 * 绘制通用暗色赛博背景网格与律动星尘
 */
function drawCyberBackdrop(
  fb: FrameBuf,
  theme: ReturnType<typeof pickTheme>,
  camX: number,
  camY: number,
  gameT: number,
  hitPulse: number,
): void {
  const W = fb.w;
  const H = fb.h;
  fb.blendGradientRect(0, 0, W, H, theme.bgTop, theme.bgBottom, true);

  // 动态呼吸中心氛围光晕
  fb.drawGlowCircle(
    W / 2,
    H * 0.48,
    460 + hitPulse * 120,
    [
      theme.primary[0],
      theme.primary[1],
      theme.primary[2],
      Math.round(32 + hitPulse * 38),
    ],
  );

  // 视差赛博网格
  const gridStep = 96;
  const offX = ((-camX * 0.25) % gridStep + gridStep) % gridStep;
  const offY = ((-camY * 0.25) % gridStep + gridStep) % gridStep;
  for (let x = offX; x < W; x += gridStep) {
    fb.blendRect(x, 0, 2, H, theme.gridColor);
  }
  for (let y = offY; y < H; y += gridStep) {
    fb.blendRect(0, y, W, 2, theme.gridColor);
  }

  // 漂浮霓虹星尘粒子
  for (let i = 0; i < 24; i++) {
    const px = ((i * 173 + Math.sin(gameT * 0.8 + i) * 60 - camX * 0.15) % W + W) % W;
    const py = ((i * 239 - camY * 0.22 - gameT * 38) % H + H) % H;
    const col = i % 2 === 0 ? theme.primary : theme.strong;
    fb.blendCircle(px, py, (i % 3) + 2, [col[0], col[1], col[2], 75]);
  }
}

/**
 * 绘制开场吸睛大卡与结尾 S+ 荣誉结算卡
 */
function drawIntroOverlay(
  fb: FrameBuf,
  atlas: FontAtlas,
  big: FontAtlas,
  theme: ReturnType<typeof pickTheme>,
  skin: BallSkinId,
  modeTitle: string,
  subtitle: string,
  tempo: number,
  now: number,
): void {
  const W = fb.w;
  const H = fb.h;
  const k = clamp(now / INTRO_SEC, 0, 1);
  const pop = easeOutBack(Math.min(1, k * 1.25));
  const cx = W / 2;
  const cy = H * 0.46;
  const cardW = W - 110;
  const cardH = 620;
  const cardX = cx - cardW / 2;
  const cardY = cy - cardH / 2 + (1 - pop) * 90;

  fb.blendRect(0, 0, W, H, [4, 7, 18, 175]);
  fb.drawGlowCircle(cx, cy, 420, [theme.primary[0], theme.primary[1], theme.primary[2], 95]);

  fb.drawCard(cardX, cardY, cardW, cardH, {
    bgTop: [18, 28, 66, 245],
    bgBottom: [9, 14, 34, 250],
    border: [theme.primary[0], theme.primary[1], theme.primary[2], 245],
    borderWidth: 4,
    radius: 32,
    shadowAlpha: 185,
    shadowOffsetY: 14,
    topHighlight: [255, 255, 255, 45],
  });

  // 顶部金色徽章
  fb.drawCard(cx - 230, cardY - 28, 460, 58, {
    bgTop: [theme.strong[0], theme.strong[1], theme.strong[2], 255],
    bgBottom: [220, 135, 24, 255],
    border: [255, 250, 215, 255],
    borderWidth: 3,
    radius: 20,
  });
  drawFitText(
    fb,
    atlas,
    `★ ${Math.round(tempo)} BPM · 节拍实机挑战 ★`,
    cx,
    cardY - 17,
    [255, 255, 255, 255],
    420,
    0.45,
    "center",
    2,
  );

  drawFitText(
    fb,
    big,
    modeTitle,
    cx,
    cardY + 70,
    [255, 255, 255, 255],
    cardW - 80,
    1.05,
    "center",
    4,
  );
  drawFitText(
    fb,
    atlas,
    subtitle,
    cx,
    cardY + 195,
    [theme.primary[0], theme.primary[1], theme.primary[2], 245],
    cardW - 90,
    0.46,
    "center",
    2,
  );

  // 主角球皮肤展示台
  fb.drawCard(cx - 260, cardY + 275, 520, 195, {
    bgTop: [12, 20, 48, 235],
    border: [theme.strong[0], theme.strong[1], theme.strong[2], 185],
    borderWidth: 2,
    radius: 24,
  });
  drawStylizedBall(fb, cx, cardY + 350, 180, -90, 44, skin, theme, 0.5, now);
  drawFitText(
    fb,
    atlas,
    `出战皮肤：${BALL_SKIN_NAMES[skin]} · 主题：${theme.name}`,
    cx,
    cardY + 418,
    [255, 230, 125, 250],
    480,
    0.40,
    "center",
    2,
  );

  drawFitText(
    fb,
    atlas,
    "♫ 戴上耳机 · 全程零穿模卡点开始！",
    cx,
    cardY + 518,
    [255, 255, 255, 240],
    cardW - 100,
    0.48,
    "center",
    2,
  );
}

function drawOutroOverlay(
  fb: FrameBuf,
  atlas: FontAtlas,
  big: FontAtlas,
  theme: ReturnType<typeof pickTheme>,
  outroProgress: number,
  _stats: [string, string, RGBA][],
): void {
  const W = fb.w;
  const H = fb.h;
  const k = clamp(outroProgress, 0, 1);
  // 爆款极简留白尾帧：无笨重结算框，仅柔和压暗背景并浮现无框发光大字，方便短视频无缝循环播放
  fb.blendRect(0, 0, W, H, [4, 7, 18, Math.round(145 * k)]);
  if (k < 0.1) return;

  const pop = easeOutBack(Math.min(1, (k - 0.1) / 0.65));
  const alpha = Math.round(255 * Math.min(1, k * 1.4));
  const cx = W / 2;
  const cy = H * 0.46 + (1 - pop) * 36;

  fb.drawGlowCircle(cx, cy, 280, [theme.strong[0], theme.strong[1], theme.strong[2], Math.round(65 * k)]);
  drawFitText(
    fb,
    big,
    "FULL COMBO",
    cx,
    cy - 42,
    [theme.strong[0], theme.strong[1], theme.strong[2], alpha],
    W - 140,
    0.92,
    "center",
    4,
  );
  drawFitText(
    fb,
    atlas,
    "♫ 评论区留下你想听的歌 · 下期安排 ♫",
    cx,
    cy + 58,
    [255, 255, 255, alpha],
    W - 140,
    0.46,
    "center",
    3,
  );
}

const NOTE_FREQ_MAP: Record<string, number> = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.00,
  A4: 440.00,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  F5: 698.46,
  G5: 783.99,
  A5: 880.00,
  B5: 987.77,
  C6: 1046.50,
};

/**
 * 合成零延迟（1.5ms 瞬态起音）的水晶木槌触键共鸣音，确保每一次碰撞的画面帧与清脆敲击瞬态 100% 咬合
 */
function synthGentleNoteChime(noteName: string, strong: boolean): Float32Array {
  const freq = NOTE_FREQ_MAP[noteName] ?? 523.25;
  const dur = strong ? 0.34 : 0.24;
  const len = Math.floor(dur * SR);
  const pcm = new Float32Array(len);
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < len; i++) {
    const dt = i / SR;
    p1 += (2 * Math.PI * freq) / SR;
    p2 += (2 * Math.PI * freq * 2.0) / SR;
    p3 += (2 * Math.PI * freq * 4.0) / SR;
    // 1.5ms 极速起音 + 清脆高频木槌瞬态，消除“画面撞上了声音才慢吞吞出来”的拖沓感
    const attack = Math.min(1, dt / 0.0015);
    const env = attack * Math.exp(-dt * (strong ? 9.5 : 12.5));
    const transient = Math.sin(p3) * 0.32 * Math.exp(-dt * 95);
    pcm[i] =
      (Math.sin(p1) * 0.76 +
        Math.sin(p2) * 0.24 * Math.exp(-dt * 18) +
        transient) *
      env;
  }
  return pcm;
}

/**
 * 合成带清脆触键瞬态共鸣的音轨（剔除刺耳白噪，同时让每次视觉碰撞都有明确清脆的声学咬合点）
 */
function buildMixedAudioTrack(
  wavPath: string,
  nodes: BeatNode[],
  totalSec: number,
  tempo: number,
): string {
  const songSamples = readMonoWav(wavPath);
  const totalSamples = Math.ceil((totalSec + 0.5) * SR);
  const baseTrack = new Float32Array(totalSamples);
  const offset = Math.floor(INTRO_SEC * SR);
  for (let i = 0; i < songSamples.length && i + offset < totalSamples; i++) {
    baseTrack[i + offset] = songSamples[i] * 0.88;
  }

  const sfxItems: { offsetSec: number; pcm: Float32Array; gain: number }[] = [];
  for (const n of nodes) {
    const hitTime = INTRO_SEC + n.t;
    sfxItems.push({
      offsetSec: hitTime,
      pcm: synthGentleNoteChime(n.noteName, n.strong),
      gain: n.strong ? 0.20 : 0.14,
    });
  }
  const mixed = normalize(
    mixTracks([
      { offsetSec: 0, pcm: baseTrack, gain: 1.0 },
      ...sfxItems,
    ], totalSec + 0.5, SR),
    0.92,
  );
  const outWav = `/tmp/mb_mixed_${process.pid}_${Date.now()}.wav`;
  writeWav(mixed, outWav);
  return outWav;
}

// ============================================================================
// 核心统一渲染主入口：支持 corridor / hopper / rings 三大短视频流行模式
// ============================================================================
export async function renderMusicBallVideo(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  opts: RenderMusicBallOptions = {},
): Promise<void> {
  const seed = opts.seed ?? 77;
  const mode: MusicBallMode = opts.mode ?? "corridor";
  const theme = pickTheme(seed, opts.theme);
  const skin = pickBallSkin(seed, opts.skin);
  const aspect = opts.aspect ?? "9:16";
  const W = aspect === "9:16" ? 1080 : 1920;
  const H = aspect === "9:16" ? 1920 : 1080;

  const axis: AxisFile = JSON.parse(readFileSync(axisPath, "utf-8"));
  const songSamples = readMonoWav(wavPath);
  const isNewViralMode = mode === "maze" || mode === "staircase" || mode === "pendulum";
  const viralNodes = isNewViralMode
    ? buildViralNodes(axis.events, axis.meta.duration_s, axis.meta.tempo, seed, mode)
    : [];
  const nodes = buildBeatNodes(axis, seed, W, H);
  const activeNodesForAudio = isNewViralMode ? (viralNodes as unknown as BeatNode[]) : nodes;
  const effectiveOutroSec = isNewViralMode ? 0.08 : OUTRO_SEC;
  const totalSec = INTRO_SEC + axis.meta.duration_s + effectiveOutroSec;
  const totalFrames = Math.ceil(totalSec * FPS);

  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(`${fontDir}atlas64.rgba`, `${fontDir}atlas64.json`);
  const big = new FontAtlas(`${fontDir}atlas96.rgba`, `${fontDir}atlas96.json`);

  const outWav = buildMixedAudioTrack(wavPath, activeNodesForAudio, totalSec, axis.meta.tempo);

  const isSoothing = axis.meta.tempo < 100;
  const hooks = isSoothing ? SOOTHING_HOOKS[mode] : VIRAL_HOOKS[mode];
  const hookText = opts.hookText ?? hooks[Math.abs(seed) % hooks.length];
  const shakeScale = isSoothing ? 0.25 : 1.0;

  const modeTitle = mode === "corridor"
    ? "霓虹琴键回廊"
    : mode === "hopper"
      ? "重力音阶跳台"
      : "破壁同心圆环";
  const modeSubtitle = mode === "corridor"
    ? "左右壁面音符琴键 · 真实物理折返 · 零穿模精准踩点"
    : mode === "hopper"
      ? "因果重力抛物线引擎 · 踏板弹簧压陷 · 真实向上弹跳"
      : "旋转霓虹同心牢笼 · 节拍内壁反射 · 重音碎环解压";

  const beatMarkers = activeNodesForAudio.map(n => ({ t: n.t, strong: n.strong }));

  // 维护历史轨迹与碎环碎片状态
  const trail: { x: number; y: number }[] = [];
  let camX = W / 2;
  let camY = nodes[0]?.y ?? 420;
  const viralCam = {
    x: viralNodes[0]?.x ?? 0,
    y: viralNodes[0]?.y ?? 420,
  };

  function* frameGen(): Iterable<FrameBuf> {
    for (let fIdx = 0; fIdx < totalFrames; fIdx++) {
      const now = fIdx / FPS;
      const gt = now - INTRO_SEC;
      const fb = new FrameBuf(W, H, theme.bgTop);

      // 计算当前所处的节拍区间 [prevNode, nextNode]
      let segIdx = 0;
      while (segIdx + 1 < nodes.length && nodes[segIdx + 1].t <= gt) {
        segIdx++;
      }
      const curNode = nodes[segIdx];
      const nextNode = nodes[Math.min(nodes.length - 1, segIdx + 1)];

      // 计算最近一次碰撞的时间差，驱动高光、震屏与弹簧形变
      let sinceLastHit = 999;
      let lastHitNode: BeatNode = activeNodesForAudio[0] ?? nodes[0];
      for (const n of activeNodesForAudio) {
        if (gt >= n.t && gt - n.t < sinceLastHit) {
          sinceLastHit = gt - n.t;
          lastHitNode = n;
        }
      }
      const hitPulse = sinceLastHit < 0.22 ? Math.pow(1 - sinceLastHit / 0.22, 1.5) : 0;
      const isHitStrong = hitPulse > 0.15 && lastHitNode.strong;
      const isHitAny = hitPulse > 0.15;

      // 当前已达成的连击数
      let combo = 0;
      for (const n of activeNodesForAudio) {
        if (gt >= n.t) combo++;
      }

      const spectrum = computeSpectrumFrame(songSamples, Math.max(0, gt), 32, hitPulse);

      if (now < INTRO_SEC) {
        drawCyberBackdrop(fb, theme, W / 2, 420, 0, 0.35);
        drawIntroOverlay(fb, atlas, big, theme, skin, modeTitle, modeSubtitle, axis.meta.tempo, now);
        yield fb;
        continue;
      }

      // ======================================================================
      // 全新三大千万播放级爆款模式：MAZE / STAIRCASE / PENDULUM
      // ======================================================================
      if (mode === "maze" || mode === "staircase" || mode === "pendulum") {
        if (mode === "maze") {
          renderMazeMode(fb, atlas, viralNodes, gt, hitPulse, theme, trail, viralCam);
        } else if (mode === "staircase") {
          renderStaircaseMode(fb, atlas, viralNodes, gt, hitPulse, theme, trail, viralCam);
        } else {
          renderPendulumMode(fb, atlas, viralNodes, gt, hitPulse, theme, axis.meta.tempo);
        }

        drawShortVideoHud(fb, atlas, big, {
          mode,
          modeTitle: mode === "maze" ? "弹跳方块" : mode === "staircase" ? "水晶八音盒" : "同心星弧",
          songTitle: opts.songTitle ?? axis.meta.title,
          hookText,
          tempo: axis.meta.tempo,
          skinName: BALL_SKIN_NAMES[skin],
          theme,
          statusText: lastHitNode.noteName,
          isHitStrong,
          isHitAny,
          hitPulse,
          combo,
          maxCombo: combo,
          progress: clamp(gt / axis.meta.duration_s, 0, 1),
          currentTime: Math.max(0, gt),
          duration: axis.meta.duration_s,
          beatMarkers,
          extraMetricLabel: mode === "maze" ? "点亮方块" : mode === "staircase" ? "水晶琴键" : "星弧音律",
          extraMetricValue: `${combo}`,
          spectrum,
        });
      } else if (mode === "corridor") {
        let bx = curNode.x;
        let by = curNode.y;
        let bvx = 0;
        let bvy = 260;

        if (gt < nodes[0].t) {
          const u = clamp(gt / Math.max(0.05, nodes[0].t), 0, 1);
          bx = W / 2 + (nodes[0].x - W / 2) * u;
          by = (nodes[0].y - 220) + 220 * u * u;
          bvx = (nodes[0].x - W / 2) / Math.max(0.1, nodes[0].t);
          bvy = 440 * u;
        } else if (curNode !== nextNode && gt >= curNode.t && gt <= nextNode.t) {
          const dt = Math.max(0.05, nextNode.t - curNode.t);
          const tau = gt - curNode.t;
          const u = clamp(tau / dt, 0, 1);
          const dy = nextNode.y - curNode.y;
          // 横向恒速折返（触壁瞬间 vx 真实反向！）
          bx = curNode.x + (nextNode.x - curNode.x) * u;
          bvx = (nextNode.x - curNode.x) / dt;
          // 纵向受重力微抛物线加速下落
          const vy0 = (0.32 * dy) / dt;
          const gEff = (2 * 0.68 * dy) / (dt * dt);
          by = curNode.y + vy0 * tau + 0.5 * gEff * tau * tau;
          bvy = vy0 + gEff * tau;
        } else {
          const over = Math.max(0, gt - curNode.t);
          bx = curNode.x + (curNode.side === "left" ? 1 : -1) * Math.min(260, over * 420);
          by = curNode.y + over * 340;
          bvx = curNode.side === "left" ? 420 : -420;
          bvy = 340;
        }

        camY += (by + 110 - camY) * (isSoothing ? 0.16 : 0.22);
        const shakeX = isHitStrong ? Math.sin(gt * 95) * 9 * hitPulse * shakeScale : 0;
        const shakeY = isHitStrong ? Math.cos(gt * 82) * 7 * hitPulse * shakeScale : 0;
        const viewY = camY - H * 0.46 + shakeY;

        drawCyberBackdrop(fb, theme, W / 2 + shakeX, camY, gt, hitPulse);

        const shaftLeft = Math.round(W * 0.135) + shakeX;
        const shaftRight = Math.round(W * 0.865) + shakeX;

        // 绘制左右深井外墙与声波律动柱
        fb.fillRect(0, 0, shaftLeft, H, theme.wallFill);
        fb.fillRect(shaftRight, 0, W - shaftRight, H, theme.wallFill);
        fb.fillRect(shaftLeft - 5, 0, 5, H, theme.wallBorder);
        fb.fillRect(shaftRight, 0, 5, H, theme.wallBorder);

        // 左右井壁内置 LED 频谱灯带
        for (let row = 0; row < 24; row++) {
          const ry = row * 80;
          const val = spectrum[row % spectrum.length];
          const barW = Math.round(18 + val * (shaftLeft - 36));
          const col = row % 2 === 0 ? theme.primary : theme.secondary;
          fb.fillRoundRect(shaftLeft - 14 - barW, ry + 18, barW, 42, 6, [
            col[0],
            col[1],
            col[2],
            Math.round(55 + val * 120),
          ]);
          fb.fillRoundRect(shaftRight + 14, ry + 18, barW, 42, 6, [
            col[0],
            col[1],
            col[2],
            Math.round(55 + val * 120),
          ]);
        }

        // 绘制未来 3 个节点的激光折返引导线（让观众提前预判折返节奏）
        for (let k = segIdx; k < Math.min(nodes.length - 1, segIdx + 3); k++) {
          const a = nodes[k];
          const b = nodes[k + 1];
          const ay = a.y - viewY;
          const by2 = b.y - viewY;
          const alpha = k === segIdx ? 95 : 45;
          fb.drawLine(a.x + shakeX, ay, b.x + shakeX, by2, 3, [
            theme.primary[0],
            theme.primary[1],
            theme.primary[2],
            alpha,
          ]);
        }

        // 绘制所有壁面发光音符琴键（Piano Note Keys）
        const keyH = 104;
        for (const n of nodes) {
          const sy = n.y - viewY;
          if (sy < -140 || sy > H + 140) continue;

          const dtHit = gt - n.t;
          const activeFlash = dtHit >= 0 && dtHit < 0.36 ? Math.pow(1 - dtHit / 0.36, 1.4) : 0;
          // 撞击瞬间琴键向墙体内部物理压陷回弹！
          const recoil = activeFlash * (n.strong ? 22 : 14);
          const col = n.strong ? theme.strong : n.id % 2 === 0 ? theme.primary : theme.secondary;

          if (n.side === "left") {
            const kw = n.protrude - recoil;
            const kx = shaftLeft;
            const ky = sy - keyH / 2;
            if (activeFlash > 0.05) {
              fb.drawGlowCircle(kx + kw, sy, 95 * activeFlash + 40, [col[0], col[1], col[2], Math.round(160 * activeFlash)]);
            }
            fb.drawCard(kx - 10, ky, kw + 10, keyH, {
              bgTop: activeFlash > 0.1
                ? [col[0], col[1], col[2], 250]
                : [Math.round(col[0] * 0.32), Math.round(col[1] * 0.32), Math.round(col[2] * 0.38), 235],
              bgBottom: [14, 22, 48, 245],
              border: [col[0], col[1], col[2], 250],
              borderWidth: n.strong ? 4 : 3,
              radius: 16,
              accentColor: [255, 255, 255, 240],
              accentSide: "right",
            });
            drawFitText(
              fb,
              atlas,
              n.noteName,
              kx + kw / 2,
              sy - 18,
              activeFlash > 0.1 ? [12, 18, 38, 255] : [255, 255, 255, 235],
              kw - 12,
              0.42,
              "center",
              activeFlash > 0.1 ? 0 : 2,
            );
          } else {
            const kw = n.protrude - recoil;
            const kx = shaftRight - kw;
            const ky = sy - keyH / 2;
            if (activeFlash > 0.05) {
              fb.drawGlowCircle(kx, sy, 95 * activeFlash + 40, [col[0], col[1], col[2], Math.round(160 * activeFlash)]);
            }
            fb.drawCard(kx, ky, kw + 10, keyH, {
              bgTop: activeFlash > 0.1
                ? [col[0], col[1], col[2], 250]
                : [Math.round(col[0] * 0.32), Math.round(col[1] * 0.32), Math.round(col[2] * 0.38), 235],
              bgBottom: [14, 22, 48, 245],
              border: [col[0], col[1], col[2], 250],
              borderWidth: n.strong ? 4 : 3,
              radius: 16,
              accentColor: [255, 255, 255, 240],
              accentSide: "left",
            });
            drawFitText(
              fb,
              atlas,
              n.noteName,
              kx + kw / 2,
              sy - 18,
              activeFlash > 0.1 ? [12, 18, 38, 255] : [255, 255, 255, 235],
              kw - 12,
              0.42,
              "center",
              activeFlash > 0.1 ? 0 : 2,
            );
          }

          // 撞击瞬间法线方向飞溅火花、冲击波环与音阶飘字
          if (dtHit >= 0 && dtHit < 0.34) {
            const p = dtHit / 0.34;
            const hitX = (n.side === "left" ? shaftLeft + n.protrude : shaftRight - n.protrude);
            const dir = n.side === "left" ? 1 : -1;
            const ringR = 24 + p * (n.strong ? 140 : 95);
            fb.strokeRing(hitX, sy, ringR, Math.max(2, (1 - p) * 7), [
              col[0],
              col[1],
              col[2],
              Math.round((1 - p) * 235),
            ]);
            for (let s = 0; s < 12; s++) {
              const spread = ((s / 11) - 0.5) * 1.35;
              const dist = (32 + (s % 3) * 22) * p * (n.strong ? 1.45 : 1.0);
              const px = hitX + Math.cos(spread) * dir * dist;
              const py = sy + Math.sin(spread) * dist + p * p * 28;
              fb.fillCircle(px, py, Math.max(2, (1 - p) * 5.5), [
                255,
                245,
                190,
                Math.round((1 - p) * 245),
              ]);
            }
            // 极简音符判定微浮字（无冗长 PERFECT 词条，仅保留灵动音高）
            const popY = sy - 50 - p * 36;
            drawFitText(
              fb,
              atlas,
              `♪ ${n.noteName}`,
              hitX + dir * 78,
              popY,
              n.strong ? [255, 232, 95, Math.round((1 - p) * 245)] : [140, 240, 255, Math.round((1 - p) * 225)],
              160,
              n.strong ? 0.38 : 0.34,
              "center",
              2,
            );
          }
        }

        // 更新并绘制丝带拖尾与主角球
        const screenBallX = bx + shakeX;
        const screenBallY = by - viewY;
        trail.push({ x: bx, y: by });
        if (trail.length > 16) trail.shift();
        for (let i = 0; i < trail.length; i++) {
          const ratio = (i + 1) / trail.length;
          const tp = trail[i];
          const col = isHitStrong ? theme.strong : theme.primary;
          fb.blendCircle(
            tp.x + shakeX,
            tp.y - viewY,
            BALL_R * (0.22 + ratio * 0.58),
            [col[0], col[1], col[2], Math.round(ratio * ratio * 155)],
          );
        }
        drawStylizedBall(fb, screenBallX, screenBallY, bvx, bvy, BALL_R, skin, theme, hitPulse, gt);

        drawShortVideoHud(fb, atlas, big, {
          mode,
          modeTitle: "赛博琴键回廊",
          songTitle: opts.songTitle ?? axis.meta.title,
          hookText,
          tempo: axis.meta.tempo,
          skinName: BALL_SKIN_NAMES[skin],
          theme,
          statusText: lastHitNode.noteName,
          isHitStrong,
          isHitAny,
          hitPulse,
          combo,
          maxCombo: combo,
          progress: clamp(gt / axis.meta.duration_s, 0, 1),
          currentTime: Math.max(0, gt),
          duration: axis.meta.duration_s,
          beatMarkers,
          extraMetricLabel: "当前音高",
          extraMetricValue: lastHitNode.noteName,
          spectrum,
        });
      }

      // ======================================================================
      // 分支二：HOPPER 重力音阶跳台（100% 因果反推抛物线，球必定向上跃起落向踏板上表面，零穿模）
      // ======================================================================
      else if (mode === "hopper") {
        let bx = curNode.padX;
        let by = curNode.padY - curNode.padH / 2 - BALL_R;
        let bvx = 0;
        let bvy = 0;

        if (gt < nodes[0].t) {
          const n0 = nodes[0];
          const targetY = n0.padY - n0.padH / 2 - BALL_R;
          const u = clamp(gt / Math.max(0.05, n0.t), 0, 1);
          bx = W / 2 + (n0.padX - W / 2) * u;
          by = targetY - 240 * (1 - u * u);
          bvx = (n0.padX - W / 2) / Math.max(0.1, n0.t);
          bvy = 480 * u;
        } else if (curNode !== nextNode && gt >= curNode.t && gt <= nextNode.t) {
          const dt = Math.max(0.08, nextNode.t - curNode.t);
          const tau = gt - curNode.t;
          const u = clamp(tau / dt, 0, 1);

          const startY = curNode.padY - curNode.padH / 2 - BALL_R;
          const endY = nextNode.padY - nextNode.padH / 2 - BALL_R;
          const dy = endY - startY;

          // 因果反推抛物线公式：保证球在 t=curNode.t 时必定以 vy0 < 0 向上高高跃起，越过最高点 h1 后落在下一块踏板上表面！
          const h1 = clamp(dt * 330, 105, 225) * (curNode.strong ? 1.18 : 1.0);
          const h2 = Math.max(40, h1 + dy);
          const sqrtG = (Math.sqrt(2 * h1) + Math.sqrt(2 * h2)) / dt;
          const gSeg = sqrtG * sqrtG;
          const vy0 = -Math.sqrt(2 * gSeg * h1);

          bx = curNode.padX + (nextNode.padX - curNode.padX) * u;
          by = startY + vy0 * tau + 0.5 * gSeg * tau * tau;
          bvx = (nextNode.padX - curNode.padX) / dt;
          bvy = vy0 + gSeg * tau;
        } else {
          const over = Math.max(0, gt - curNode.t);
          const startY = curNode.padY - curNode.padH / 2 - BALL_R;
          bx = curNode.padX;
          by = startY - 180 * over + 0.5 * 980 * over * over;
          bvx = 0;
          bvy = -180 + 980 * over;
        }

        camY += (by + 95 - camY) * (isSoothing ? 0.15 : 0.20);
        camX += ((bx - W / 2) * 0.22 + W / 2 - camX) * (isSoothing ? 0.14 : 0.18);
        const shakeX = isHitStrong ? Math.sin(gt * 92) * 8 * hitPulse * shakeScale : 0;
        const shakeY = isHitStrong ? Math.cos(gt * 78) * 8 * hitPulse * shakeScale : 0;
        const viewX = camX - W / 2 + shakeX;
        const viewY = camY - H * 0.48 + shakeY;

        drawCyberBackdrop(fb, theme, camX, camY, gt, hitPulse);

        // 绘制未来 2 段抛物线虚线引导轨迹（让观众直观看到向上弹跳的完美抛物线！）
        for (let k = segIdx; k < Math.min(nodes.length - 1, segIdx + 2); k++) {
          const a = nodes[k];
          const b = nodes[k + 1];
          const dt = Math.max(0.08, b.t - a.t);
          const startY = a.padY - a.padH / 2 - BALL_R;
          const endY = b.padY - b.padH / 2 - BALL_R;
          const dy = endY - startY;
          const h1 = clamp(dt * 330, 105, 225) * (a.strong ? 1.18 : 1.0);
          const h2 = Math.max(40, h1 + dy);
          const sqrtG = (Math.sqrt(2 * h1) + Math.sqrt(2 * h2)) / dt;
          const gSeg = sqrtG * sqrtG;
          const vy0 = -Math.sqrt(2 * gSeg * h1);

          const dots = 16;
          for (let d = 1; d < dots; d++) {
            const u = d / dots;
            const tau = u * dt;
            const px = a.padX + (b.padX - a.padX) * u - viewX;
            const py = startY + vy0 * tau + 0.5 * gSeg * tau * tau - viewY;
            fb.blendCircle(px, py, k === segIdx ? 4.5 : 3.0, [
              theme.primary[0],
              theme.primary[1],
              theme.primary[2],
              k === segIdx ? 130 : 65,
            ]);
          }
        }

        // 绘制所有悬浮 3D 霓虹音阶踏板（Floating Synth Pads）
        for (const n of nodes) {
          const sx = n.padX - viewX;
          const syBase = n.padY - viewY;
          if (syBase < -160 || syBase > H + 160) continue;

          const dtHit = gt - n.t;
          const activeFlash = dtHit >= 0 && dtHit < 0.38 ? Math.pow(1 - dtHit / 0.38, 1.4) : 0;
          // 弹簧向下压陷物理形变（球砸在踏板上表面时，踏板向下压缩再回弹！）
          const springDrop = activeFlash * (n.strong ? 22 : 15);
          const sy = syBase + springDrop;
          const col = n.strong ? theme.strong : n.id % 2 === 0 ? theme.primary : theme.secondary;

          // 踏板底部悬浮能量立柱与阴影光晕
          fb.blendGradientRect(
            sx - n.padW * 0.32,
            sy + n.padH / 2,
            n.padW * 0.64,
            70,
            [col[0], col[1], col[2], Math.round(75 + activeFlash * 110)],
            [col[0], col[1], col[2], 0],
            true,
          );

          if (activeFlash > 0.05) {
            fb.drawGlowCircle(sx, sy, 110 * activeFlash + 50, [
              col[0],
              col[1],
              col[2],
              Math.round(165 * activeFlash),
            ]);
          }

          // 踏板主体卡片
          fb.drawCard(sx - n.padW / 2, sy - n.padH / 2, n.padW, n.padH, {
            bgTop: activeFlash > 0.1
              ? [col[0], col[1], col[2], 255]
              : [Math.round(col[0] * 0.36), Math.round(col[1] * 0.36), Math.round(col[2] * 0.44), 242],
            bgBottom: [12, 18, 42, 250],
            border: [col[0], col[1], col[2], 255],
            borderWidth: n.strong ? 4 : 3,
            radius: 14,
            shadowAlpha: 135,
            shadowOffsetY: 8,
            topHighlight: [255, 255, 255, 165],
          });

          // 踏板音名标识
          drawFitText(
            fb,
            atlas,
            n.noteName,
            sx,
            sy - 15,
            activeFlash > 0.1 ? [10, 16, 34, 255] : [255, 255, 255, 240],
            n.padW - 24,
            0.36,
            "center",
            activeFlash > 0.1 ? 0 : 2,
          );

          // 下一个即将命中的目标踏板绘制锁定准星光环
          if (n === nextNode && gt < n.t) {
            const pulse = 0.5 + 0.5 * Math.sin(gt * 18);
            fb.strokeRing(
              sx,
              sy - n.padH / 2 - BALL_R,
              BALL_R + 6 + pulse * 10,
              2.5,
              [theme.strong[0], theme.strong[1], theme.strong[2], 165],
            );
          }

          // 撞击瞬间向上喷射火花与横向扩音环
          if (dtHit >= 0 && dtHit < 0.36) {
            const p = dtHit / 0.36;
            const ringR = 32 + p * (n.strong ? 150 : 105);
            fb.strokeRing(sx, sy - n.padH / 2, ringR, Math.max(2, (1 - p) * 6.5), [
              col[0],
              col[1],
              col[2],
              Math.round((1 - p) * 230),
            ]);
            for (let s = 0; s < 14; s++) {
              const ang = -Math.PI * 0.12 - (s / 13) * Math.PI * 0.76;
              const dist = (38 + (s % 3) * 26) * p * (n.strong ? 1.45 : 1.0);
              const px = sx + Math.cos(ang) * dist;
              const py = sy - n.padH / 2 + Math.sin(ang) * dist + p * p * 36;
              fb.fillCircle(px, py, Math.max(2, (1 - p) * 5.5), [
                255,
                245,
                195,
                Math.round((1 - p) * 245),
              ]);
            }
            drawFitText(
              fb,
              atlas,
              `♪ ${n.noteName}`,
              sx,
              sy - 62 - p * 40,
              n.strong ? [255, 232, 95, Math.round((1 - p) * 245)] : [135, 240, 255, Math.round((1 - p) * 225)],
              160,
              n.strong ? 0.38 : 0.34,
              "center",
              2,
            );
          }
        }

        // 拖尾与主角球
        const screenBallX = bx - viewX;
        const screenBallY = by - viewY;
        trail.push({ x: bx, y: by });
        if (trail.length > 18) trail.shift();
        for (let i = 0; i < trail.length; i++) {
          const ratio = (i + 1) / trail.length;
          const tp = trail[i];
          const col = isHitStrong ? theme.strong : theme.primary;
          fb.blendCircle(
            tp.x - viewX,
            tp.y - viewY,
            BALL_R * (0.20 + ratio * 0.56),
            [col[0], col[1], col[2], Math.round(ratio * ratio * 155)],
          );
        }
        drawStylizedBall(fb, screenBallX, screenBallY, bvx, bvy, BALL_R, skin, theme, hitPulse, gt);

        drawShortVideoHud(fb, atlas, big, {
          mode,
          modeTitle: "重力音阶跳台",
          songTitle: opts.songTitle ?? axis.meta.title,
          hookText,
          tempo: axis.meta.tempo,
          skinName: BALL_SKIN_NAMES[skin],
          theme,
          statusText: lastHitNode.noteName,
          isHitStrong,
          isHitAny,
          hitPulse,
          combo,
          maxCombo: combo,
          progress: clamp(gt / axis.meta.duration_s, 0, 1),
          currentTime: Math.max(0, gt),
          duration: axis.meta.duration_s,
          beatMarkers,
          extraMetricLabel: "已踩踏板",
          extraMetricValue: `${combo}/${nodes.length}`,
          spectrum,
        });
      }

      // ======================================================================
      // 分支三：RINGS 破壁同心圆环（抖音/TikTok 顶流解压玩法：圆环内壁弹射 + 重音碎环爆破）
      // ======================================================================
      else {
        const cx = W / 2 + (isHitStrong ? Math.sin(gt * 95) * 8 * hitPulse * shakeScale : 0);
        const cy = H * 0.50 + (isHitStrong ? Math.cos(gt * 82) * 8 * hitPulse * shakeScale : 0);
        const activeRingRadius = Math.round(Math.min(W, H) * 0.275); // ~297px in 1080x1920
        const bounceR = activeRingRadius - BALL_R - 6;

        // 统计当前已击碎的圆环数与最近一次碎环动画
        let shatteredCount = 0;
        let sinceShatter = 999;
        let lastShatterNode: BeatNode | null = null;
        for (const n of nodes) {
          if (gt >= n.t && n.shatterRing) {
            shatteredCount++;
            if (gt - n.t < sinceShatter) {
              sinceShatter = gt - n.t;
              lastShatterNode = n;
            }
          }
        }
        const totalRings = Math.max(1, nodes.filter(n => n.shatterRing).length);
        const remainingRings = Math.max(0, totalRings - shatteredCount);

        // 外环平滑向内收缩补位偏置
        const ringExpandOffset = sinceShatter < 0.35
          ? 52 * Math.pow(1 - sinceShatter / 0.35, 2)
          : 0;

        drawCyberBackdrop(fb, theme, W / 2, H / 2 + gt * 120, gt, hitPulse);

        // 圆心半透明剩余圆环巨字水印（TikTok 破壁圆环经典居中倒数设计）
        drawFitText(
          fb,
          big,
          `${remainingRings}`,
          cx,
          cy - 34,
          [theme.primary[0], theme.primary[1], theme.primary[2], 65],
          240,
          1.05,
          "center",
          0,
        );

        // 绘制同心旋转霓虹圆环阵列（从外到内共 6 层）
        for (let layer = 5; layer >= 0; layer--) {
          const r = activeRingRadius + layer * 52 + ringExpandOffset;
          const ringId = shatteredCount + layer;
          const col = ringId % 3 === 0
            ? theme.strong
            : ringId % 2 === 0
              ? theme.primary
              : theme.secondary;
          const alpha = layer === 0 ? 245 : Math.max(45, 195 - layer * 32);
          const thickness = layer === 0 ? 14 : Math.max(5, 11 - layer);

          if (layer === 0) {
            fb.strokeRing(cx, cy, r + 6, 22, [
              col[0],
              col[1],
              col[2],
              Math.round(45 + hitPulse * 75),
            ]);
          }
          fb.strokeRing(cx, cy, r, thickness, [col[0], col[1], col[2], alpha]);

          // 圆环上的旋转能量刻度缺口装饰
          const rotSpeed = (ringId % 2 === 0 ? 1 : -1) * (0.65 + (ringId % 3) * 0.22);
          for (let seg = 0; seg < 6; seg++) {
            const a0 = gt * rotSpeed + (seg * Math.PI * 2) / 6;
            fb.drawArc(cx, cy, r, thickness + 3, a0, a0 + 0.24, [255, 255, 255, Math.round(alpha * 0.75)]);
          }
        }

        // 若刚刚发生重拍碎环，绘制 28 块向外爆裂飞散的霓虹圆弧碎片！
        if (lastShatterNode && sinceShatter < 0.48) {
          const p = sinceShatter / 0.48;
          const burstR = activeRingRadius + p * 185;
          const col = theme.strong;
          for (let s = 0; s < 28; s++) {
            const a = (s / 28) * Math.PI * 2 + p * (s % 2 === 0 ? 0.4 : -0.4);
            const jitter = ((s * 37) % 19) * p * 2.5;
            const px = cx + Math.cos(a) * (burstR + jitter);
            const py = cy + Math.sin(a) * (burstR + jitter) + p * p * 35;
            fb.fillRotatedRect(
              px,
              py,
              26 * (1 - p * 0.5),
              10 * (1 - p * 0.4),
              a + Math.PI / 2,
              [col[0], col[1], col[2], Math.round((1 - p) * 250)],
            );
          }
        }

        // 计算小球在当前激活圆环内部的弦向弹射坐标（100% 严格在圆环内壁，绝不穿出环外！）
        let bx = cx;
        let by = cy;
        let bvx = 0;
        let bvy = 0;

        if (gt < nodes[0].t) {
          const u = clamp(gt / Math.max(0.05, nodes[0].t), 0, 1);
          const tx = cx + Math.cos(nodes[0].angle) * bounceR;
          const ty = cy + Math.sin(nodes[0].angle) * bounceR;
          bx = cx + (tx - cx) * u;
          by = cy + (ty - cy) * u;
          bvx = (tx - cx) / Math.max(0.1, nodes[0].t);
          bvy = (ty - cy) / Math.max(0.1, nodes[0].t);
        } else if (curNode !== nextNode && gt >= curNode.t && gt <= nextNode.t) {
          const dt = Math.max(0.06, nextNode.t - curNode.t);
          const u = clamp((gt - curNode.t) / dt, 0, 1);
          const x0 = cx + Math.cos(curNode.angle) * bounceR;
          const y0 = cy + Math.sin(curNode.angle) * bounceR;
          const x1 = cx + Math.cos(nextNode.angle) * bounceR;
          const y1 = cy + Math.sin(nextNode.angle) * bounceR;

          // 弦向线性飞行 + 朝向圆心的微重力弧度（保证轨迹 100% 位于圆内）
          const sag = 42 * 4 * u * (1 - u);
          const midX = (x0 + x1) * 0.5;
          const midY = (y0 + y1) * 0.5;
          const toCenterX = cx - midX;
          const toCenterY = cy - midY;
          const len = Math.max(1, Math.hypot(toCenterX, toCenterY));

          bx = x0 + (x1 - x0) * u + (toCenterX / len) * sag * 0.35;
          by = y0 + (y1 - y0) * u + (toCenterY / len) * sag * 0.35 + sag * 0.45;
          // 安全钳制在圆环内壁以内
          const distFromCenter = Math.hypot(bx - cx, by - cy);
          if (distFromCenter > bounceR) {
            bx = cx + ((bx - cx) / distFromCenter) * bounceR;
            by = cy + ((by - cy) / distFromCenter) * bounceR;
          }
          bvx = (x1 - x0) / dt;
          bvy = (y1 - y0) / dt;

          // 绘制通往下一拍内壁撞击点的瞄准激光线与靶心
          fb.drawLine(bx, by, x1, y1, 2.5, [theme.primary[0], theme.primary[1], theme.primary[2], 75]);
          fb.strokeRing(x1, y1, 14, 2.5, [theme.strong[0], theme.strong[1], theme.strong[2], 150]);
        } else {
          bx = cx + Math.cos(curNode.angle) * bounceR * Math.max(0, 1 - (gt - curNode.t) * 1.5);
          by = cy + Math.sin(curNode.angle) * bounceR * Math.max(0, 1 - (gt - curNode.t) * 1.5);
        }

        // 内壁撞击点局部波纹与向心火花
        if (sinceLastHit < 0.32) {
          const p = sinceLastHit / 0.32;
          const hx = cx + Math.cos(lastHitNode.angle) * activeRingRadius;
          const hy = cy + Math.sin(lastHitNode.angle) * activeRingRadius;
          const col = lastHitNode.strong ? theme.strong : theme.primary;
          fb.strokeRing(hx, hy, 20 + p * 95, Math.max(2, (1 - p) * 6), [
            col[0],
            col[1],
            col[2],
            Math.round((1 - p) * 235),
          ]);
          const inwardAngle = lastHitNode.angle + Math.PI;
          for (let s = 0; s < 10; s++) {
            const ang = inwardAngle + ((s / 9) - 0.5) * 1.2;
            const dist = (30 + (s % 3) * 22) * p;
            fb.fillCircle(
              hx + Math.cos(ang) * dist,
              hy + Math.sin(ang) * dist,
              Math.max(2, (1 - p) * 5),
              [255, 245, 190, Math.round((1 - p) * 240)],
            );
          }
        }

        // 拖尾与主角球
        trail.push({ x: bx, y: by });
        if (trail.length > 16) trail.shift();
        for (let i = 0; i < trail.length; i++) {
          const ratio = (i + 1) / trail.length;
          const tp = trail[i];
          const col = isHitStrong ? theme.strong : theme.primary;
          fb.blendCircle(
            tp.x,
            tp.y,
            BALL_R * (0.22 + ratio * 0.58),
            [col[0], col[1], col[2], Math.round(ratio * ratio * 155)],
          );
        }
        drawStylizedBall(fb, bx, by, bvx, bvy, BALL_R, skin, theme, hitPulse, gt);

        drawShortVideoHud(fb, atlas, big, {
          mode,
          modeTitle: "破壁同心圆环",
          songTitle: opts.songTitle ?? axis.meta.title,
          hookText,
          tempo: axis.meta.tempo,
          skinName: BALL_SKIN_NAMES[skin],
          theme,
          statusText: `${remainingRings}`,
          isHitStrong,
          isHitAny,
          hitPulse,
          combo,
          maxCombo: combo,
          progress: clamp(gt / axis.meta.duration_s, 0, 1),
          currentTime: Math.max(0, gt),
          duration: axis.meta.duration_s,
          beatMarkers,
          extraMetricLabel: "剩余圆环",
          extraMetricValue: `${remainingRings}`,
          spectrum,
        });
      }

      // ======================================================================
      // 终局 S+ 荣誉结算面板（仅在传统街机三模式开启；新三大爆款模式保持纯净开放首尾以实现无缝无限循环）
      // ======================================================================
      if (!isNewViralMode && gt > axis.meta.duration_s) {
        const outroProgress = (gt - axis.meta.duration_s) / (OUTRO_SEC * 0.75);
        const totalShattered = nodes.filter(n => n.shatterRing).length;
        const metric3Label = mode === "corridor"
          ? "琴键折返深度"
          : mode === "hopper"
            ? "音阶跳台跨越"
            : "累计轰碎圆环";
        const metric3Val = mode === "corridor"
          ? `-${Math.round((nodes[nodes.length - 1]?.y ?? 1800) / 10)} 米`
          : mode === "hopper"
            ? `${nodes.length} 座跳台`
            : `${totalShattered} 层圆环`;

        drawOutroOverlay(fb, atlas, big, theme, outroProgress, [
          ["最高连击记录", `${nodes.length} COMBO`, [255, 225, 92, 255]],
          ["节拍同步率", "100% 零失误", [95, 235, 255, 255]],
          [metric3Label, metric3Val, [135, 245, 175, 255]],
          ["综合音律评级", "S+ 节奏大师", [255, 170, 220, 255]],
        ]);
      }

      yield fb;
    }
  }

  await encodeFrames(frameGen(), {
    width: W,
    height: H,
    fps: FPS,
    outPath: outMp4,
    audioPath: outWav,
    crf: 19,
  });
  console.log(`music-ball [${mode} | ${theme.id} | ${skin}] rendered -> ${outMp4}`);
}

/**
 * 兼容旧入口 1：赛博深井模式（现升级为 1080×1920 竖屏霓虹琴键折返走廊 corridor，100% 零穿模真反弹）
 */
export async function renderNaturalMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 71,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: opts.mode ?? "corridor",
  });
}

/**
 * 兼容旧入口 2：几何节拍冲撞模式（现升级为 1080×1920 竖屏因果重力抛物线音阶跳台 hopper，100% 向上弹跳零穿模）
 */
export async function renderImpactMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 23,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: opts.mode ?? "hopper",
  });
}

/**
 * 新增爆款入口 3：破壁同心圆环模式（抖音/TikTok 顶流解压旋转圆环爆破 rings）
 */
export async function renderRingMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 99,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: "rings",
  });
}

/**
 * 全新顶流爆款入口 4：弹跳方块音符迷宫（Viral Bouncing Square MIDI Labyrinth - maze）
 */
export async function renderMazeMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 108,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: "maze",
  });
}

/**
 * 全新顶流爆款入口 5：2.5D 水晶阶梯八音盒（Cascading Crystal Piano Staircase - staircase）
 */
export async function renderStaircaseMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 208,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: "staircase",
  });
}

/**
 * 全新顶流爆款入口 6：催眠钟摆波激光竖琴（Hypnotic Polyrhythm Pendulum Harp - pendulum）
 */
export async function renderPendulumMusicBall(
  axisPath: string,
  wavPath: string,
  outMp4: string,
  seed = 308,
  opts: Partial<RenderMusicBallOptions> = {},
): Promise<void> {
  await renderMusicBallVideo(axisPath, wavPath, outMp4, {
    ...opts,
    seed,
    mode: "pendulum",
  });
}

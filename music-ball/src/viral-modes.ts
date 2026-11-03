// 2026 全网千万播放级三大爆款音乐可视化新范式（1080×1920 竖屏）：
// 1. maze      （弹跳方块音符迷宫 · Viral Bouncing Square MIDI Labyrinth）：
//               2D 开放空间 45° 对角线自由折返 + 发光倒角方块 + 快拍连击砖块走廊 + 矩形冲击波
// 2. staircase （2.5D 水晶阶梯八音盒 · Cascading Crystal Piano Staircase）：
//               立体三面发光水晶音阶键阶梯 + 流光玻璃弹珠抛物线级联弹跳 + 琴键真实下压回弹与光柱
// 3. pendulum  （催眠钟摆波激光竖琴 · Hypnotic Polyrhythm Pendulum Harp）：
//               10 轨同心音律星弧 + 相位锁定多节奏钟摆波 + 100% 精准跨弦卡点 + 激光琴弦物理驻波震颤

import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import type { AxisEvent } from "./natural-level.ts";
import {
  NOTE_NAMES,
  drawFitText,
  type VisualTheme,
} from "./themes.ts";

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

// 10 个音高对应的霓虹色板（从低音暖金/青色到高音空灵紫/冰蓝，保证视觉层次极其丰富）
const PITCH_PALETTE: [number, number, number][] = [
  [56, 232, 255],   // C4 冰青
  [72, 245, 190],   // D4 薄荷绿
  [120, 250, 145],  // E4 荧光翠
  [255, 222, 85],   // G4 琥珀金
  [255, 168, 92],   // A4 珊瑚橙
  [255, 115, 165],  // C5 霓虹粉
  [225, 125, 255],  // D5 星云紫
  [150, 145, 255],  // E5 极光靛
  [88, 195, 255],   // G5 天空蓝
  [165, 250, 255],  // A5 钻石白青
];

export type Pt2 = [number, number];

export function fillConvexQuad(
  fb: FrameBuf,
  pts: [Pt2, Pt2, Pt2, Pt2],
  cTop: RGBA,
  cBot?: RGBA,
): void {
  const c1 = cBot ?? cTop;
  if (cTop[3] <= 0 && c1[3] <= 0) return;

  let area2 = 0;
  let minX = 1e9;
  let minY = 1e9;
  let maxX = -1e9;
  let maxY = -1e9;
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) & 3];
    area2 += x0 * y1 - x1 * y0;
    if (x0 < minX) minX = x0;
    if (x0 > maxX) maxX = x0;
    if (y0 < minY) minY = y0;
    if (y0 > maxY) maxY = y0;
  }
  if (Math.abs(area2) < 1e-2) return;
  const sign = area2 > 0 ? 1 : -1;

  const nx = new Float64Array(4);
  const ny = new Float64Array(4);
  const cc = new Float64Array(4);
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) & 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    nx[i] = (-dy * sign) / len;
    ny[i] = (dx * sign) / len;
    cc[i] = -(nx[i] * x0 + ny[i] * y0);
  }

  const xStart = Math.max(0, Math.floor(minX - 1));
  const yStart = Math.max(0, Math.floor(minY - 1));
  const xEnd = Math.min(fb.w - 1, Math.ceil(maxX + 1));
  const yEnd = Math.min(fb.h - 1, Math.ceil(maxY + 1));
  const spanY = Math.max(1, maxY - minY);
  const data = fb.data;
  const w = fb.w;

  for (let py = yStart; py <= yEnd; py++) {
    const cy = py + 0.5;
    const ty = clamp((cy - minY) / spanY, 0, 1);
    const cr = cTop[0] + (c1[0] - cTop[0]) * ty;
    const cg = cTop[1] + (c1[1] - cTop[1]) * ty;
    const cb = cTop[2] + (c1[2] - cTop[2]) * ty;
    const baseA = (cTop[3] + (c1[3] - cTop[3]) * ty) / 255;
    if (baseA <= 0) continue;

    const baseD0 = ny[0] * cy + cc[0];
    const baseD1 = ny[1] * cy + cc[1];
    const baseD2 = ny[2] * cy + cc[2];
    const baseD3 = ny[3] * cy + cc[3];

    let idx = (py * w + xStart) * 4;
    for (let px = xStart; px <= xEnd; px++) {
      const cx = px + 0.5;
      const d0 = nx[0] * cx + baseD0;
      const d1 = nx[1] * cx + baseD1;
      const d2 = nx[2] * cx + baseD2;
      const d3 = nx[3] * cx + baseD3;
      const minDist = Math.min(d0, d1, d2, d3);
      if (minDist > -0.75) {
        const cov = minDist >= 0.75 ? 1 : (minDist + 0.75) * 0.6667;
        const a = baseA * cov;
        const invA = 1 - a;
        data[idx] = data[idx] * invA + cr * a;
        data[idx + 1] = data[idx + 1] * invA + cg * a;
        data[idx + 2] = data[idx + 2] * invA + cb * a;
        data[idx + 3] = 255;
      }
      idx += 4;
    }
  }
}

export function strokeQuad(
  fb: FrameBuf,
  pts: [Pt2, Pt2, Pt2, Pt2],
  thickness: number,
  col: RGBA,
): void {
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) & 3];
    fb.drawLine(a[0], a[1], b[0], b[1], thickness, col);
  }
}

export function fillThickSegment(
  fb: FrameBuf,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  halfW: number,
  col: RGBA,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return;
  const px = (-dy / len) * halfW;
  const py = (dx / len) * halfW;
  fillConvexQuad(
    fb,
    [
      [x0 + px, y0 + py],
      [x1 + px, y1 + py],
      [x1 - px, y1 - py],
      [x0 - px, y0 - py],
    ],
    col,
  );
}

export interface ViralBeatNode {
  idx: number;
  t: number;
  strength: number;
  strong: boolean;
  noteIdx: number;
  noteName: string;
  color: [number, number, number];
  x: number;
  y: number;
  hitAxis: "x" | "y";
  incomingVx: number;
  incomingVy: number;
  outgoingVx: number;
  outgoingVy: number;
  brickX: number;
  brickY: number;
  brickW: number;
  brickH: number;
  isoX: number;
  isoY: number;
  isoZ: number;
  isoHalfX: number;
  isoHalfY: number;
  isoThickZ: number;
  isoAxis: "x" | "y";
  isCornerStep: boolean;
  stepW: number;
  stepDir: 1 | -1;
  trackIdx: number;
  swingSign: 1 | -1;
}

const SQ_R = 18; // 36×36px 锐利几何方块（配合 38px 通道半宽确保十六分音符密集折返也绝不并墙）

/**
 * 精确计算点 (px, py) 到 45° 对角线段 AB 的切比雪夫（L∞）距离（闭式解，零循环）
 */
function ptToDiagSegChebDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) < 1e-6) return Math.max(Math.abs(px - ax), Math.abs(py - ay));
  const t =
    dx * dy > 0
      ? clamp((px + py - (ax + ay)) / (2 * dx), 0, 1)
      : clamp((px - py - (ax - ay)) / (2 * dx), 0, 1);
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.max(Math.abs(px - qx), Math.abs(py - qy));
}

/**
 * 精确计算两条 45° 对角线段 AB 与 CD 之间的切比雪夫（L∞）距离（用于 100% 严防迷宫走廊重叠或自交）
 */
function diagSegToSegChebDist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const minABx = Math.min(ax, bx);
  const maxABx = Math.max(ax, bx);
  const minABy = Math.min(ay, by);
  const maxABy = Math.max(ay, by);
  const minCDx = Math.min(cx, dx);
  const maxCDx = Math.max(cx, dx);
  const minCDy = Math.min(cy, dy);
  const maxCDy = Math.max(cy, dy);

  const boxGapX = Math.max(0, minABx - maxCDx, minCDx - maxABx);
  const boxGapY = Math.max(0, minABy - maxCDy, minCDy - maxABy);
  const boxCheb = Math.max(boxGapX, boxGapY);
  if (boxCheb >= 120) return boxCheb;

  const d1x = bx - ax;
  const d1y = by - ay;
  const d2x = dx - cx;
  const d2y = dy - cy;
  // 若两段斜率正交，检查其唯一交点是否同时落在线段内部
  if (d1x * d1y * (d2x * d2y) < 0 && Math.abs(d1x) > 1e-5 && Math.abs(d2x) > 1e-5) {
    // 一条满足 x - y = cDiff，另一条满足 x + y = cSum
    const abIsPosSlope = d1x * d1y > 0;
    const cDiff = abIsPosSlope ? ax - ay : cx - cy;
    const cSum = abIsPosSlope ? cx + cy : ax + ay;
    const ix = 0.5 * (cSum + cDiff);
    const iy = 0.5 * (cSum - cDiff);
    const t1 = (ix - ax) / d1x;
    const t2 = (ix - cx) / d2x;
    if (t1 >= 0 && t1 <= 1 && t2 >= 0 && t2 <= 1) return 0;
  }

  return Math.min(
    ptToDiagSegChebDist(ax, ay, cx, cy, dx, dy),
    ptToDiagSegChebDist(bx, by, cx, cy, dx, dy),
    ptToDiagSegChebDist(cx, cy, ax, ay, bx, by),
    ptToDiagSegChebDist(dx, dy, ax, ay, bx, by),
  );
}

export function buildViralNodes(
  events: AxisEvent[],
  duration: number,
  tempo: number,
  seed: number,
  mode: "maze" | "staircase" | "pendulum",
): ViralBeatNode[] {
  // 1. 兼容 AxisEvent 的 t_ms（毫秒）与 t（秒）字段，并保留合成旋律的精确音高索引 noteIdx
  const normalized = events
    .map(e => {
      const tSec = typeof (e as any).t === "number" ? (e as any).t : e.t_ms / 1000;
      const isStrong = Boolean(
        e.downbeat ||
        e.tier === "strong" ||
        ((e as any).kind === "beat" && e.strength >= 0.72) ||
        e.strength >= 0.75,
      );
      const rawNoteIdx = (e as any).noteIdx;
      const rawNoteName = (e as any).noteName;
      return {
        t: tSec,
        strength: clamp(e.strength ?? 0.7, 0.25, 1),
        strong: isStrong,
        noteIdx: typeof rawNoteIdx === "number" ? clamp(Math.round(rawNoteIdx), 0, 9) : undefined,
        noteName: typeof rawNoteName === "string" ? rawNoteName : undefined,
      };
    })
    .filter(e => Number.isFinite(e.t) && e.t >= 0.12 && e.t <= duration - 0.18)
    .sort((a, b) => a.t - b.t);

  // 允许十六分音符快闪连击（dt ≈ 0.14s..0.16s）完整保留，绝不吞掉快速卡点音符
  const minGap = mode === "pendulum" ? 0.13 : 0.11;
  const baseEvents: { t: number; strength: number; strong: boolean; noteIdx?: number; noteName?: string }[] = [];
  for (const ev of normalized) {
    if (baseEvents.length === 0 || ev.t - baseEvents[baseEvents.length - 1].t >= minGap) {
      baseEvents.push(ev);
    } else if (ev.strength > baseEvents[baseEvents.length - 1].strength) {
      baseEvents[baseEvents.length - 1] = ev;
    }
  }

  if (baseEvents.length < 6) {
    const step = 60 / Math.max(72, tempo || 120);
    for (let t = 0.24, i = 0; t < duration - 0.22; t += step, i++) {
      baseEvents.push({
        t: Number(t.toFixed(4)),
        strength: i % 2 === 0 ? 0.88 : 0.64,
        strong: i % 2 === 0,
      });
    }
  }

  // 2. 严格保证“1个音频音符 = 1次视觉碰撞”的 1:1 绝对卡点映射！
  // 内置合成曲目（含完整版卡农钢琴）自带精确 noteIdx 音符表，100% 原样映射绝不插拍；仅外部无 noteIdx 音频出现 >= 0.85s 空拍断档时才做过渡补间
  const hasExplicitNotes = baseEvents.some(e => typeof e.noteIdx === "number");
  const denseEvents: { t: number; strength: number; strong: boolean; noteIdx?: number; noteName?: string }[] = [];
  if (mode === "maze" || mode === "staircase") {
    const targetSubDt = tempo < 95 ? 0.38 : 0.32;
    for (let i = 0; i < baseEvents.length; i++) {
      const cur = baseEvents[i];
      denseEvents.push(cur);
      if (!hasExplicitNotes && i + 1 < baseEvents.length) {
        const next = baseEvents[i + 1];
        const gap = next.t - cur.t;
        if (gap >= 0.85) {
          const subCount = Math.min(3, Math.max(2, Math.round(gap / targetSubDt)));
          for (let s = 1; s < subCount; s++) {
            const subT = cur.t + (gap * s) / subCount;
            denseEvents.push({
              t: Number(subT.toFixed(4)),
              strength: clamp(cur.strength * 0.78, 0.38, 0.72),
              strong: false,
            });
          }
        }
      }
    }
    if (mode === "maze" && denseEvents.length > 4 && denseEvents.length % 2 === 1) {
      // 保证 maze 节点总数 N 为偶数：若外部音频音符数为奇数，在最大间隔处插入 1 个过渡拍，绝不丢弃末尾收束音符
      let maxGapIdx = 0;
      let maxGap = -1;
      for (let i = 0; i < denseEvents.length - 1; i++) {
        const g = denseEvents[i + 1].t - denseEvents[i].t;
        if (g > maxGap) {
          maxGap = g;
          maxGapIdx = i;
        }
      }
      const a = denseEvents[maxGapIdx];
      const b = denseEvents[maxGapIdx + 1];
      denseEvents.splice(maxGapIdx + 1, 0, {
        t: Number(((a.t + b.t) * 0.5).toFixed(4)),
        strength: clamp(a.strength * 0.78, 0.38, 0.72),
        strong: false,
        noteIdx: a.noteIdx,
        noteName: a.noteName,
      });
    }
  } else {
    denseEvents.push(...baseEvents);
  }

  const melodyContour = [
    0, 2, 4, 7, 5, 4, 2, 4,
    5, 7, 9, 7, 5, 4, 2, 1,
    2, 4, 6, 8, 7, 5, 4, 2,
  ];
  const lastTrackTrigger = new Array<number>(10).fill(-99);

  // 预计算 MAZE 全向二维自回避迷宫路径（4-Direction 2D Self-Avoiding Labyrinth Solver）：
  // 彻底告别单调向下的竖井轨迹，让方块在 2D 迷宫中真正向「右 →、上 ↑、左 ←、下 ↓」四个方向自由穿梭折返，
  // 并通过精确 Chebyshev 距离回溯求解器保证 100% 零走廊自交、零并墙，且首尾方向严格同向衔接
  interface MazePlannedNode {
    x: number;
    y: number;
    hitAxis: "x" | "y";
    inVx: number;
    inVy: number;
    outVx: number;
    outVy: number;
  }
  const mazePlan: MazePlannedNode[] = [];
  if (mode === "maze" && denseEvents.length > 0) {
    const N = denseEvents.length;
    const stepDists: number[] = [];
    for (let i = 0; i < N; i++) {
      const rawDt = i + 1 < N ? denseEvents[i + 1].t - denseEvents[i].t : 0.25;
      const effDt = clamp(rawDt, 0.14, 0.65);
      // 即使在卡农 16 分音符风暴（dt=0.156s）下，单步走廊长度也 >= 107px > 2*wallRimHalfW(84px)，彻底杜绝并墙
      stepDists.push(Math.round(clamp(74 + effDt * 210, 104, 210)));
    }

    // 方案 A + B 融合：有机错落斜向阶梯（↘/↙ 45° Z-Staircase）+ 局部斜角长廊（18°~25° Tilted Gallery）+ 快拍垂直乒乓井（↓）：
    // 彻底打破死板的「水平横条割草机（R6 -> D3 -> L6 -> D3）」与「0° 绝对平行水平走廊」：
    //   1. 局部斜角长廊（Tilted Diagonal Gallery）：在横向推进段内，向下弹射步长放大（1.16x）、向上折返步长压缩（upRatio = 0.55~0.64），
    //      使整条走廊的顶壁与底壁呈现 18°~25° 顺重力斜向倾角（↘ 或 ↙），而砖块依然保持锐利水平/垂直正交；
    //   2. 45° 错落斜向阶梯（Stepped Z-Staircase）：穿插 D2 偶数步短垂直阶梯（R -> D2 -> R 形成 ↘ 45° 阶梯，L -> D2 -> L 形成 ↙ 45° 阶梯），
    //      与 D3 奇数步折返井交替组合，形成丰富多变的对角线阶梯室与曲折回廊；
    //   3. 快拍垂直乒乓井（Vertical Pinball Drop Shaft）：遇到 16 分音符高潮段（inFastRun）自动切入 D5~D7 垂直下落高速连击井。
    interface MacroStage {
      dir: "R" | "D" | "L";
      len: number;
      upRatio: number;
    }
    const MACRO_STAGES: MacroStage[] = [
      // 阶段 0~3：右下斜角长廊 (↘ ~22°) -> 45° 东南阶梯步 (D2 -> R2) -> 垂直折返井 (D3)
      { dir: "R", len: 4, upRatio: 0.55 },
      { dir: "D", len: 2, upRatio: 1.0 },
      { dir: "R", len: 2, upRatio: 0.62 },
      { dir: "D", len: 3, upRatio: 1.0 },
      // 阶段 4~7：左下斜角长廊 (↙ ~22°) -> 45° 西南阶梯步 (D2 -> L2) -> 垂直折返井 (D3)
      { dir: "L", len: 4, upRatio: 0.55 },
      { dir: "D", len: 2, upRatio: 1.0 },
      { dir: "L", len: 2, upRatio: 0.62 },
      { dir: "D", len: 3, upRatio: 1.0 },
      // 阶段 8~9：右下中长斜角走廊 (↘ ~20°) -> 垂直深折返井 (D3)
      { dir: "R", len: 4, upRatio: 0.56 },
      { dir: "D", len: 3, upRatio: 1.0 },
      // 阶段 10~13：45° 西南错落短阶梯 (L2 -> D2) -> 左下斜角长廊 (L4 ↙) -> 垂直折返井 (D3)
      { dir: "L", len: 2, upRatio: 0.64 },
      { dir: "D", len: 2, upRatio: 1.0 },
      { dir: "L", len: 4, upRatio: 0.56 },
      { dir: "D", len: 3, upRatio: 1.0 },
    ];

    interface SolverStep {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      inSx: 1 | -1;
      inSy: 1 | -1;
      hitAxis: "x" | "y";
      outSx: 1 | -1;
      outSy: 1 | -1;
      macroIdx: number;
      runLen: number;
    }
    const solvedSteps: SolverStep[] = [];
    const leadDist = 135;
    const initInSx: 1 | -1 = 1;
    const initInSy: 1 | -1 = -1;
    const leadSeg = {
      x0: -initInSx * leadDist,
      y0: -initInSy * leadDist,
      x1: 0,
      y1: 0,
    };

    const isSegmentClear = (
      candX0: number,
      candY0: number,
      candX1: number,
      candY1: number,
      uptoIdx: number,
      minClearance: number,
    ): boolean => {
      if (uptoIdx >= 1) {
        const dLead = diagSegToSegChebDist(
          candX0,
          candY0,
          candX1,
          candY1,
          leadSeg.x0,
          leadSeg.y0,
          leadSeg.x1,
          leadSeg.y1,
        );
        if (dLead < minClearance) return false;
      }
      for (let j = 0; j < uptoIdx - 1; j++) {
        const s = solvedSteps[j];
        const d = diagSegToSegChebDist(candX0, candY0, candX1, candY1, s.x0, s.y0, s.x1, s.y1);
        if (d < minClearance) return false;
      }
      return true;
    };

    let solverCalls = 0;
    const maxSolverCalls = 140000;

    // 预计算每个音符的拍间间隔与「快拍高潮连击段（inFastRun）」标记：
    // 慢拍/舒缓乐句走斜角长廊与 45° 错落阶梯（↘ / ↙），
    // 快拍/高潮十六分音符连弹段（连续 >=3 个 dt <= 0.195s）自动切入垂直下落乒乓连击井（Down ↓，连续 5~7 次高频左右夹击下落）！
    const rawStepDts: number[] = [];
    for (let i = 0; i < N; i++) {
      rawStepDts.push(i + 1 < N ? Math.max(0.08, denseEvents[i + 1].t - denseEvents[i].t) : 0.25);
    }
    const inFastRun: boolean[] = new Array(N).fill(false);
    let fastStreak = 0;
    for (let i = N - 1; i >= 0; i--) {
      if (rawStepDts[i] <= 0.195) {
        fastStreak++;
      } else {
        fastStreak = 0;
      }
      if (fastStreak >= 3 || (i > 0 && rawStepDts[i] <= 0.195 && inFastRun[i - 1])) {
        inFastRun[i] = true;
      }
    }
    for (let i = 1; i < N; i++) {
      if (rawStepDts[i] <= 0.195 && (inFastRun[i - 1] || (i + 1 < N && inFastRun[i + 1]))) {
        inFastRun[i] = true;
      }
    }

    const pickNextMacroIdx = (curMacroIdx: number, nextAxis: "x" | "y", nextHorizSx: 1 | -1): number => {
      const L = MACRO_STAGES.length;
      const candIdx = (curMacroIdx + 1) % L;
      if (nextAxis === "x") {
        return MACRO_STAGES[candIdx].dir === "D" ? candIdx : (candIdx + 1) % L;
      }
      const wantDir = nextHorizSx === 1 ? "R" : "L";
      for (let off = 1; off <= L; off++) {
        const idx = (curMacroIdx + off) % L;
        if (MACRO_STAGES[idx].dir === wantDir) return idx;
      }
      return candIdx;
    };

    const solveMazeDFS = (idx: number, minClearance: number): boolean => {
      if (idx >= N) return true;
      if (++solverCalls > maxSolverCalls) return false;

      const curX0 = idx === 0 ? 0 : solvedSteps[idx - 1].x1;
      const curY0 = idx === 0 ? 0 : solvedSteps[idx - 1].y1;
      const inSx: 1 | -1 = idx === 0 ? initInSx : solvedSteps[idx - 1].outSx;
      const inSy: 1 | -1 = idx === 0 ? initInSy : solvedSteps[idx - 1].outSy;
      const prevAxis = idx > 0 ? solvedSteps[idx - 1].hitAxis : null;
      const prevRunLen = idx > 0 ? solvedSteps[idx - 1].runLen : 0;
      const prevMacroIdx = idx > 0 ? solvedSteps[idx - 1].macroIdx : 0;
      const curStage = MACRO_STAGES[prevMacroIdx % MACRO_STAGES.length];
      const nextStage = MACRO_STAGES[(prevMacroIdx + 1) % MACRO_STAGES.length];
      const isFast = inFastRun[idx];

      // 计算两种碰撞轴（"x" 竖直墙反射 vs "y" 水平墙反射）的优先级评分
      const scoreAxis = (axis: "x" | "y"): number => {
        const outSx: 1 | -1 = axis === "x" ? (-inSx as 1 | -1) : inSx;
        const outSy: 1 | -1 = axis === "y" ? (-inSy as 1 | -1) : inSy;

        // 核心铁律 1：彻底禁止任何「向上 ↑」垂直走廊！竖直墙反射 (axis="x") 必须在顺重力下落 (outSy === +1) 时触发
        if (axis === "x" && outSy === -1) {
          return -1000;
        }

        // 末节点强制要求出射方向等于首节点入射方向 (+1, -1)，实现无缝无限循环
        if (idx === N - 1) {
          return outSx === initInSx && outSy === initInSy ? 1000 : -1000;
        }
        // 首步必须向右 (axis="y", outSx=+1)
        if (idx === 0) {
          return axis === "y" ? 1000 : -1000;
        }
        // 末尾收束段：提前汇入向右斜角走廊 (axis="y", outSx=+1)，确保末节点奇偶方向完美对齐 (+1, -1)
        if (idx >= N - 8) {
          if (prevAxis === "y" && inSx === 1) {
            return axis === "y" ? 600 : -600;
          }
          if (prevAxis === "x") {
            if (inSx === 1 && prevRunLen >= (idx >= N - 4 ? 1 : 2)) {
              return axis === "y" ? 600 : -200;
            }
            return axis === "x" ? 400 : -400;
          }
          if (prevAxis === "y" && inSx === -1 && prevRunLen >= 2 && inSy === 1) {
            return axis === "x" ? 550 : -200;
          }
        }

        // 核心铁律 2：至少连续 2 步才允许切换轴向（其中 2 步对应 45° Z-Staircase 错落斜向阶梯，3~4 步对应斜角长廊与折返井）
        const minRunForPrev = prevAxis === "x" ? Math.min(2, curStage.len) : 2;
        if (prevAxis && axis !== prevAxis && prevRunLen < minRunForPrev) {
          return -800;
        }

        // 节奏分流策略 A：当前处于「十六分音符快拍连击段（isFast === true）」——优先切入并保持垂直下落乒乓连击井（Down ↓）
        if (isFast) {
          if (prevAxis === "y") {
            if (inSy === 1 && prevRunLen >= 2) {
              return axis === "x" ? 320 : -80;
            }
            return axis === "y" ? 180 : -1000;
          } else {
            // 在垂直下落乒乓井中连续高速弹射 5~7 步（优先在匹配下一阶段方向或奇数步折返时切出，保持左右均衡）
            if (prevRunLen < 5) {
              return axis === "x" ? 300 : -150;
            }
            const targetSx: 1 | -1 = nextStage.dir === "L" ? -1 : 1;
            if (inSx === targetSx || prevRunLen >= 7) {
              return axis === "y" ? 260 : -60;
            }
            return axis === "x" ? 200 : -150;
          }
        }

        // 节奏分流策略 B：当前处于「舒缓/中速旋律段（isFast === false）」——按照 MACRO_STAGES 交替走 20° 斜角长廊与 45° 错落斜向阶梯
        // 注意：首段 (idx <= 3) 因起始 inSy = -1，走 3 步即可到达 inSy = +1 向下切入点
        const curTargetLen =
          prevMacroIdx === 0 && prevAxis === "y" && idx <= 4
            ? 3
            : curStage.len;
        const wantTurn = prevRunLen >= curTargetLen;

        if (!wantTurn) {
          return axis === prevAxis ? 160 : -140;
        }

        if (prevAxis === "y") {
          // 从斜角走廊/阶梯切入垂直下落阶梯（Down ↓）：仅当 inSy === 1（顺重力向下）时切入 axis="x"
          if (inSy === 1) {
            return axis === "x" ? 240 : -50;
          }
          return axis === "y" ? 170 : -1000;
        } else {
          // 从垂直阶梯切入下一段斜角走廊或 45° 阶梯：校核水平方向是否匹配下一阶段（偶数步 D2 保持同向阶梯，奇数步 D3 折返反向）
          const targetSx: 1 | -1 = nextStage.dir === "L" ? -1 : 1;
          if (inSx === targetSx) {
            return axis === "y" ? 260 : -60;
          }
          return axis === "x" ? 170 : -220;
        }
      };

      const axes: ("x" | "y")[] = scoreAxis("x") >= scoreAxis("y") ? ["x", "y"] : ["y", "x"];

      for (const hitAxis of axes) {
        if (scoreAxis(hitAxis) <= -700) continue;

        const outSx: 1 | -1 = hitAxis === "x" ? (-inSx as 1 | -1) : inSx;
        const outSy: 1 | -1 = hitAxis === "y" ? (-inSy as 1 | -1) : inSy;

        if (idx === N - 1 && (outSx !== initInSx || outSy !== initInSy)) {
          continue;
        }

        const turned = prevAxis !== null && hitAxis !== prevAxis;
        const nextMacroIdx = turned ? pickNextMacroIdx(prevMacroIdx, hitAxis, outSx) : prevMacroIdx;
        const activeStage = MACRO_STAGES[nextMacroIdx % MACRO_STAGES.length];

        const prevSegLen =
          idx > 0 ? Math.abs(solvedSteps[idx - 1].y1 - solvedSteps[idx - 1].y0) : leadDist;
        // 关键几何突破：在横向/斜向走廊（hitAxis === "y"）中，向下弹射步长放大 1.35x (158~228px)，向上折返步长控制在 102~122px（严格 > minClearance 96px）！
        // 这样既保证相邻平行弹射段之间的 Chebyshev 间距 >= 102px 零并墙，又使每次「下+上」折返净下沉 55~95px，形成 16°~22° 顺重力斜角长廊（↘ / ↙）！
        let segLen: number;
        if (idx === N - 1) {
          segLen = leadDist;
        } else if (hitAxis === "y") {
          if (outSy === -1) {
            segLen = Math.round(clamp(prevSegLen * activeStage.upRatio, 102, Math.max(102, prevSegLen - 46)));
          } else {
            segLen = Math.round(clamp(stepDists[idx] * 1.36, 158, 228));
          }
        } else {
          segLen = Math.max(104, stepDists[idx]);
        }
        const nextX = curX0 + outSx * segLen;
        const nextY = curY0 + outSy * segLen;

        if (!isSegmentClear(curX0, curY0, nextX, nextY, idx, minClearance)) {
          continue;
        }

        // 额外校核「宽敞腔体镂空包络弦 A' -> C'」的中点与四分点对所有历史 45° 走廊的安全间距（注意 diagSegToSegChebDist 仅适用于 45° 线段，因此对弦采样点用 ptToDiagSegChebDist）
        if (idx >= 2) {
          const prevSt = solvedSteps[idx - 1];
          const wedgePad = 24;
          const ax0 = hitAxis === "y" ? prevSt.x0 + outSx * wedgePad : prevSt.x0;
          const ay0 = hitAxis === "x" ? prevSt.y0 + outSy * wedgePad : prevSt.y0;
          const cx1 = hitAxis === "y" ? nextX - outSx * wedgePad : nextX;
          const cy1 = hitAxis === "x" ? nextY - outSy * wedgePad : nextY;
          const mx = 0.5 * (ax0 + cx1);
          const my = 0.5 * (ay0 + cy1);
          let wedgeOk = true;
          for (let j = 0; j < idx - 2; j++) {
            const s = solvedSteps[j];
            if (ptToDiagSegChebDist(mx, my, s.x0, s.y0, s.x1, s.y1) < minClearance - 6) {
              wedgeOk = false;
              break;
            }
          }
          if (!wedgeOk) continue;
        }

        // 在末节点额外校验首尾周期延伸段 [-16..-1] 与 [0..16] 的全局无碰撞，确保全周期渲染零交叉
        if (idx === N - 1) {
          const shiftX = nextX;
          const shiftY = nextY;
          let periodicOk = true;
          const checkK = Math.min(16, Math.floor(N / 3));
          for (let k = 0; k < checkK && periodicOk; k++) {
            const headSeg = solvedSteps[k];
            const hx0 = headSeg.x0 + shiftX;
            const hy0 = headSeg.y0 + shiftY;
            const hx1 = headSeg.x1 + shiftX;
            const hy1 = headSeg.y1 + shiftY;
            for (let j = 0; j < N - 1; j++) {
              if (k === 0 && j === N - 2) continue;
              const s = solvedSteps[j];
              if (diagSegToSegChebDist(hx0, hy0, hx1, hy1, s.x0, s.y0, s.x1, s.y1) < minClearance) {
                periodicOk = false;
                break;
              }
            }
          }
          if (!periodicOk) continue;
        }

        solvedSteps.push({
          x0: curX0,
          y0: curY0,
          x1: nextX,
          y1: nextY,
          inSx,
          inSy,
          hitAxis,
          outSx,
          outSy,
          macroIdx: nextMacroIdx,
          runLen: turned ? 1 : prevRunLen + 1,
        });

        if (solveMazeDFS(idx + 1, minClearance)) {
          return true;
        }
        solvedSteps.pop();
      }

      return false;
    };

    // 使用 98px 超宽安全间距求解（远大于 2*wallRimHalfW=84px，且无任何 <4 步的急转掉头）
    if (!solveMazeDFS(0, 98)) {
      solvedSteps.length = 0;
      solverCalls = 0;
      solveMazeDFS(0, 90);
    }

    for (let i = 0; i < N; i++) {
      const st = solvedSteps[i];
      const prevSt = i > 0 ? solvedSteps[i - 1] : undefined;
      const prevDt = i === 0 ? 0.25 : Math.max(0.08, denseEvents[i].t - denseEvents[i - 1].t);
      const nextDt = i + 1 < N ? Math.max(0.08, denseEvents[i + 1].t - denseEvents[i].t) : 0.25;
      const inDist = i === 0 ? leadDist : prevSt ? Math.abs(prevSt.x1 - prevSt.x0) : stepDists[i - 1];
      const outDist = i === N - 1 ? leadDist : st ? Math.abs(st.x1 - st.x0) : stepDists[i];

      mazePlan.push({
        x: st ? st.x0 : 0,
        y: st ? st.y0 : 0,
        hitAxis: st ? st.hitAxis : "x",
        inVx: (st ? st.inSx : 1) * (inDist / prevDt),
        inVy: (st ? st.inSy : -1) * (inDist / prevDt),
        outVx: (st ? st.outSx : 1) * (outDist / nextDt),
        outVy: (st ? st.outSy : 1) * (outDist / nextDt),
      });
    }
  }

  let prevT = denseEvents[0]?.t ? Math.max(0, denseEvents[0].t - 0.24) : 0;

  // 预计算 staircase 3D 等轴测阶梯每一步的行进轴向 ("x" 右下 / "y" 左下)，每 5 步或到视界边缘时 90° 转向
  const stairAxes: ("x" | "y")[] = [];
  let curAxis: "x" | "y" = "x";
  let runCount = 0;
  let simIsoX = 0;
  let simIsoY = 0;
  for (let i = 0; i < denseEvents.length; i++) {
    stairAxes.push(curAxis);
    runCount++;
    const approxScreenX = (simIsoX - simIsoY) * 0.866;
    const mustTurn =
      (curAxis === "x" && approxScreenX > 185) ||
      (curAxis === "y" && approxScreenX < -185);
    if (runCount >= 5 || (runCount >= 3 && mustTurn)) {
      curAxis = curAxis === "x" ? "y" : "x";
      runCount = 0;
    }
    if (curAxis === "x") simIsoX += 76;
    else simIsoY += 76;
  }

  let isoX = 0;
  let isoY = 0;
  let isoZ = 0;
  const nodes: ViralBeatNode[] = [];

  for (let i = 0; i < denseEvents.length; i++) {
    const ev = denseEvents[i];
    const dt = i === 0 ? 0.24 : Math.max(0.11, ev.t - prevT);
    const strong = ev.strong || i % 4 === 0;

    let noteIdx =
      typeof ev.noteIdx === "number"
        ? ev.noteIdx
        : melodyContour[(i + Math.abs(seed)) % melodyContour.length];
    if (mode === "pendulum") {
      for (let offset = 0; offset < 10; offset++) {
        const cand = (noteIdx + offset) % 10;
        if (ev.t - lastTrackTrigger[cand] >= 0.85) {
          noteIdx = cand;
          break;
        }
      }
      lastTrackTrigger[noteIdx] = ev.t;
    }

    const noteName = ev.noteName ?? NOTE_NAMES[noteIdx];
    const color = PITCH_PALETTE[noteIdx % PITCH_PALETTE.length];

    if (mode === "maze") {
      const plan = mazePlan[i] ?? {
        x: 0,
        y: 0,
        hitAxis: "x" as const,
        inVx: 440,
        inVy: -440,
        outVx: -440,
        outVy: -440,
      };
      const curX = plan.x;
      const curY = plan.y;
      const hitAxis = plan.hitAxis;
      const incomingVx = plan.inVx;
      const incomingVy = plan.inVy;
      const outVx = plan.outVx;
      const outVy = plan.outVy;
      const nextRawDt = i + 1 < denseEvents.length ? denseEvents[i + 1].t - ev.t : 0.25;

      const brickThick = 20;
      const brickLen = dt <= 0.19 || nextRawDt <= 0.19 ? 56 : strong ? 76 : 68;
      const brickW = hitAxis === "y" ? brickLen : brickThick;
      const brickH = hitAxis === "y" ? brickThick : brickLen;
      const signX = incomingVx >= 0 ? 1 : -1;
      const signY = incomingVy >= 0 ? 1 : -1;

      const brickX = hitAxis === "x" ? curX + signX * (SQ_R + brickW * 0.5) : curX;
      const brickY = hitAxis === "y" ? curY + signY * (SQ_R + brickH * 0.5) : curY;

      nodes.push({
        idx: i,
        t: ev.t,
        strength: ev.strength,
        strong,
        noteIdx,
        noteName,
        color,
        x: curX,
        y: curY,
        hitAxis,
        incomingVx,
        incomingVy,
        outgoingVx: outVx,
        outgoingVy: outVy,
        brickX,
        brickY,
        brickW,
        brickH,
        isoX: 0,
        isoY: 0,
        isoZ: 0,
        isoHalfX: 40,
        isoHalfY: 40,
        isoThickZ: 24,
        isoAxis: "x",
        isCornerStep: false,
        stepW: 160,
        stepDir: 1,
        trackIdx: noteIdx,
        swingSign: 1,
      });
    } else if (mode === "staircase") {
      const outAxis = stairAxes[i];
      const inAxis = i > 0 ? stairAxes[i - 1] : outAxis;
      const prevInAxis = i > 1 ? stairAxes[i - 2] : inAxis;
      const isCornerStep = i > 0 && inAxis !== outAxis;
      const prevWasCorner = i > 1 && prevInAxis !== inAxis;

      if (i > 0) {
        // 关键：从 i-1 到 i 沿着进入轴 inAxis 推进，步距随音符时值 dt 动态缩放，快音符紧凑连跳、长音符大跨步跃迁
        const stepAdvance = isCornerStep || prevWasCorner
          ? 94
          : Math.round(clamp(48 + dt * 92, 60, 92));
        const stepDrop = Math.round(clamp(30 + dt * 52, 36, 56));
        if (inAxis === "x") isoX += stepAdvance;
        else isoY += stepAdvance;
        isoZ -= stepDrop;
      }

      const barHalfLen = Math.round(92 - noteIdx * 2.8);
      const barHalfBreadth = 24;
      const isoHalfX = isCornerStep ? 44 : outAxis === "x" ? barHalfBreadth : barHalfLen;
      const isoHalfY = isCornerStep ? 44 : outAxis === "x" ? barHalfLen : barHalfBreadth;
      const isoThickZ = isCornerStep ? 34 : strong ? 30 : 26;

      const projX = (isoX - isoY) * 0.8660254;
      const projY = 420 + (isoX + isoY) * 0.5 - isoZ;

      nodes.push({
        idx: i,
        t: ev.t,
        strength: ev.strength,
        strong,
        noteIdx,
        noteName,
        color,
        x: projX,
        y: projY,
        hitAxis: "y",
        incomingVx: 0,
        incomingVy: 0,
        outgoingVx: 0,
        outgoingVy: 0,
        brickX: projX,
        brickY: projY,
        brickW: barHalfLen * 2,
        brickH: isoThickZ,
        isoX,
        isoY,
        isoZ,
        isoHalfX,
        isoHalfY,
        isoThickZ,
        isoAxis: outAxis,
        isCornerStep,
        stepW: barHalfLen * 2,
        stepDir: outAxis === "x" ? 1 : -1,
        trackIdx: noteIdx,
        swingSign: 1,
      });
    } else {
      const prevSameCount = nodes.filter(n => n.trackIdx === noteIdx).length;
      const swingSign: 1 | -1 = prevSameCount % 2 === 0 ? 1 : -1;
      nodes.push({
        idx: i,
        t: ev.t,
        strength: ev.strength,
        strong,
        noteIdx,
        noteName,
        color,
        x: 540,
        y: 460 + (9 - noteIdx) * 74,
        hitAxis: "x",
        incomingVx: 0,
        incomingVy: 0,
        outgoingVx: 0,
        outgoingVy: 0,
        brickX: 540,
        brickY: 460 + (9 - noteIdx) * 74,
        brickW: 80,
        brickH: 30,
        isoX: 0,
        isoY: 0,
        isoZ: 0,
        isoHalfX: 40,
        isoHalfY: 40,
        isoThickZ: 24,
        isoAxis: "x",
        isCornerStep: false,
        stepW: 160,
        stepDir: 1,
        trackIdx: noteIdx,
        swingSign,
      });
    }

    prevT = ev.t;
  }

  return nodes;
}

// ============================================================================
// 渲染器 1：MAZE（弹跳方块音符迷宫 · Viral Bouncing Square MIDI Labyrinth）
// ============================================================================

export function renderMazeMode(
  fb: FrameBuf,
  atlas: FontAtlas,
  nodes: ViralBeatNode[],
  gt: number,
  hitPulse: number,
  theme: VisualTheme,
  trail: { x: number; y: number }[],
  camState: { x: number; y: number },
): void {
  const W = fb.w;
  const H = fb.h;
  const N = nodes.length;
  if (N === 0) return;

  // 周期性无限迷宫平移向量（Loop Translation Vector）：
  // 将末节点 nodes[N-1] 沿出射桥接段 (+135, -135) 衔接至下一周期的首节点 nodes[0]，使首尾通道 100% 开放且无限循环
  const leadDist = 135;
  const first = nodes[0];
  const last = nodes[N - 1];
  const bridgeSx = last.outgoingVx >= 0 ? 1 : -1;
  const bridgeSy = last.outgoingVy >= 0 ? 1 : -1;
  const loopShiftX = last.x + bridgeSx * leadDist - first.x;
  const loopShiftY = last.y + bridgeSy * leadDist - first.y;

  // 获取任意虚拟周期索引 vIdx（允许 < 0 或 >= N）对应的世界坐标与节点属性
  const getVirtualNode = (vIdx: number) => {
    const cycle = Math.floor(vIdx / N);
    const baseIdx = ((vIdx % N) + N) % N;
    const base = nodes[baseIdx];
    const shiftX = cycle * loopShiftX;
    const shiftY = cycle * loopShiftY;
    return {
      vIdx,
      cycle,
      base,
      x: base.x + shiftX,
      y: base.y + shiftY,
      brickX: base.brickX + shiftX,
      brickY: base.brickY + shiftY,
    };
  };

  // 获取走廊中心脊线坐标（二阶均匀 B-Spline 滤波：0.25*V_{k-1} + 0.5*V_k + 0.25*V_{k+1}）
  // 在水平走廊中彻底消除上下锯齿颠簸，在垂直下落乒乓井中彻底消除左右高频晃动，同时在循环周期边界 100% 连续
  const getSpinePoint = (vIdx: number) => {
    const pPrev = getVirtualNode(vIdx - 1);
    const pCur = getVirtualNode(vIdx);
    const pNext = getVirtualNode(vIdx + 1);
    return {
      x: 0.25 * pPrev.x + 0.5 * pCur.x + 0.25 * pNext.x,
      y: 0.25 * pPrev.y + 0.5 * pCur.y + 0.25 * pNext.y,
    };
  };

  // 1. 插值当前方块在迷宫通道中的精确坐标与速度（首尾通过桥接段平滑闭合）
  let segIdx = 0;
  while (segIdx + 1 < N && nodes[segIdx + 1].t <= gt) {
    segIdx++;
  }

  let bx = first.x;
  let by = first.y;
  let vx = first.incomingVx;
  let vy = first.incomingVy;
  let spineX = first.x;
  let spineY = first.y;

  // 桥接段：前半程在片尾 (gt > last.t) 走完 0 -> 0.45，后半程在片头 (gt <= first.t) 从 0.45 -> 1.0 走完，首尾帧位置 100% 连续
  const introSpan = Math.max(0.25, first.t + 0.35);
  const outroSpan = 0.34;
  if (gt <= first.t) {
    const uIntro = clamp((gt - (-0.35)) / introSpan, 0, 1);
    const bridgeFrac = lerp(0.45, 1.0, uIntro);
    const startBridgeX = first.x - bridgeSx * leadDist;
    const startBridgeY = first.y - bridgeSy * leadDist;
    bx = lerp(startBridgeX, first.x, bridgeFrac);
    by = lerp(startBridgeY, first.y, bridgeFrac);
    vx = (first.x - startBridgeX) * (0.55 / introSpan);
    vy = (first.y - startBridgeY) * (0.55 / introSpan);
    const spA = getSpinePoint(-1);
    const spB = getSpinePoint(0);
    spineX = lerp(spA.x, spB.x, bridgeFrac);
    spineY = lerp(spA.y, spB.y, bridgeFrac);
  } else if (segIdx < N - 1) {
    const A = nodes[segIdx];
    const B = nodes[segIdx + 1];
    const frac = clamp((gt - A.t) / Math.max(0.0001, B.t - A.t), 0, 1);
    bx = lerp(A.x, B.x, frac);
    by = lerp(A.y, B.y, frac);
    vx = (B.x - A.x) / Math.max(0.05, B.t - A.t);
    vy = (B.y - A.y) / Math.max(0.05, B.t - A.t);
    const spA = getSpinePoint(segIdx);
    const spB = getSpinePoint(segIdx + 1);
    spineX = lerp(spA.x, spB.x, frac);
    spineY = lerp(spA.y, spB.y, frac);
  } else {
    const uOutro = clamp((gt - last.t) / outroSpan, 0, 1);
    const bridgeFrac = lerp(0.0, 0.45, uOutro);
    const endBridgeX = last.x + bridgeSx * leadDist;
    const endBridgeY = last.y + bridgeSy * leadDist;
    bx = lerp(last.x, endBridgeX, bridgeFrac);
    by = lerp(last.y, endBridgeY, bridgeFrac);
    vx = (endBridgeX - last.x) * (0.45 / outroSpan);
    vy = (endBridgeY - last.y) * (0.45 / outroSpan);
    const spA = getSpinePoint(N - 1);
    const spB = getSpinePoint(N);
    spineX = lerp(spA.x, spB.x, bridgeFrac);
    spineY = lerp(spA.y, spB.y, bridgeFrac);
  }

  // 2. 走廊中心导轨镜头跟随（Cinema Centerline Rail Camera）：
  // 72% 锁定走廊中心脊线 + 28% 跟随方块本体，横走廊水平丝滑推进无上下颠簸，竖直乒乓连击井垂直俯冲无左右晃动
  const targetCamX = lerp(bx, spineX, 0.72);
  const targetCamY = lerp(by, spineY, 0.72) + 65;

  if (trail.length === 0) {
    // 首帧直接锁定在桥接段对应镜头位置，并预填充桥接拖尾，使无限循环首尾零跳变
    camState.x = targetCamX;
    camState.y = targetCamY;
    for (let k = 12; k >= 1; k--) {
      trail.push({
        x: bx - bridgeSx * k * 4.5,
        y: by - bridgeSy * k * 4.5,
      });
    }
  } else {
    camState.x = lerp(camState.x, targetCamX, 0.14);
    camState.y = lerp(camState.y, targetCamY, 0.14);
  }

  const toScreenX = (wx: number) => W * 0.5 + (wx - camState.x);
  const toScreenY = (wy: number) => H * 0.48 + (wy - camState.y);

  // 3. 绘制实心建筑迷宫外墙矩阵（Bouncing Square 标志性的深黑蓝工程墙体 + 精密十字网格）
  fb.fillRect(0, 0, W, H, [7, 10, 19, 255]);
  const wallGrid = 54;
  const offX = ((-Math.round(camState.x) % wallGrid) + wallGrid) % wallGrid;
  const offY = ((-Math.round(camState.y) % wallGrid) + wallGrid) % wallGrid;
  for (let x = offX; x < W; x += wallGrid) {
    fb.blendRect(x, 0, 1, H, [28, 44, 82, 55]);
  }
  for (let y = offY; y < H; y += wallGrid) {
    fb.blendRect(0, y, W, 1, [28, 44, 82, 55]);
  }
  for (let y = offY; y < H; y += wallGrid * 2) {
    for (let x = offX; x < W; x += wallGrid * 2) {
      fb.blendRect(x - 3, y, 7, 1, [58, 92, 160, 75]);
      fb.blendRect(x, y - 3, 1, 7, [58, 92, 160, 75]);
    }
  }

  // 4. 雕刻首尾开放、无限循环衔接的镂空迷宫甬道（Open-Ended Seamless Loop Corridor）：
  // 采样虚拟周期窗口 [segIdx - 34, segIdx + 38]，首节点之前自然延伸出上一轮已点亮走廊，末节点之后自然延伸出下一轮待探索走廊，绝不封死首尾
  const winStart = segIdx - 34;
  const winEnd = segIdx + 38;
  const corridorPts: {
    x: number;
    y: number;
    hitAxis: "x" | "y";
    col: [number, number, number];
    passed: boolean;
  }[] = [];

  for (let vIdx = winStart; vIdx <= winEnd; vIdx++) {
    const vn = getVirtualNode(vIdx);
    const passed =
      vn.cycle < 0 ? true : vn.cycle > 0 ? false : gt >= vn.base.t;
    corridorPts.push({
      x: vn.x,
      y: vn.y,
      hitAxis: vn.base.hitAxis,
      col: vn.base.color,
      passed,
    });
  }

  const tunnelHalfW = SQ_R + 20; // 38px 精确闵可夫斯基方形通道半宽（与 18px 方块 + 20px 音砖外沿 100% 严丝合缝齐平）
  const wallRimHalfW = tunnelHalfW + 4; // 42px 外层发光迷宫直角墙沿（2*42=84px < 94px 走廊最小间距，彻底杜绝并墙）

  // 辅助函数 1：绘制从 (x0,y0) 到 (x1,y1) 的直角方形截面迷宫走廊（Minkowski Sum of Segment + Axis-Aligned Square）
  const fillSquareCorridorSeg = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    halfW: number,
    col: RGBA,
  ) => {
    fb.fillRect(x0 - halfW, y0 - halfW, halfW * 2, halfW * 2, col);
    fb.fillRect(x1 - halfW, y1 - halfW, halfW * 2, halfW * 2, col);
    const sx = x1 >= x0 ? 1 : -1;
    const sy = y1 >= y0 ? 1 : -1;
    fillConvexQuad(
      fb,
      [
        [x0 - sx * halfW, y0 + sy * halfW],
        [x0 + sx * halfW, y0 - sy * halfW],
        [x1 + sx * halfW, y1 - sy * halfW],
        [x1 - sx * halfW, y1 + sy * halfW],
      ],
      col,
    );
  };

  // 辅助函数 2（方案 B 核心）：镂空雕刻相邻折返节点 A -> B -> C 之间的「宽敞腔体楔形包络（Spacious Chamber Wedge）」，
  // 在保留每个音砖背后 24px 平直建筑基座的同时，彻底削平传统 1D 管道留下的锯齿波纹管尖牙（\/\/\/），形成平滑斜廊壁面与开阔阶梯室！
  const fillChamberWedge = (
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    sx2: number,
    sy2: number,
    bHitAxis: "x" | "y",
    halfW: number,
    col: RGBA,
  ) => {
    const pad = 24;
    if (bHitAxis === "y") {
      const sx = sx1 >= sx0 ? 1 : -1;
      const ax = sx0 + sx * pad;
      const ay = sy0;
      const cx = sx2 - sx * pad;
      const cy = sy2;
      if ((cx - ax) * sx <= 4) return;
      fillSquareCorridorSeg(ax, ay, cx, cy, halfW, col);
      fillConvexQuad(
        fb,
        [
          [ax, ay],
          [sx1, sy1],
          [cx, cy],
          [ax, ay],
        ],
        col,
      );
    } else {
      const sy = sy1 >= sy0 ? 1 : -1;
      const ax = sx0;
      const ay = sy0 + sy * pad;
      const cx = sx2;
      const cy = sy2 - sy * pad;
      if ((cy - ay) * sy <= 4) return;
      fillSquareCorridorSeg(ax, ay, cx, cy, halfW, col);
      fillConvexQuad(
        fb,
        [
          [ax, ay],
          [sx1, sy1],
          [cx, cy],
          [ax, ay],
        ],
        col,
      );
    }
  };

  // Pass 4A：绘制迷宫内壁外沿发光边墙（包含腔体楔形包络，已走过路段点亮为音符霓虹色，前方路段为冷峻冰蓝墙沿）
  for (let i = 0; i < corridorPts.length - 1; i++) {
    const A = corridorPts[i];
    const B = corridorPts[i + 1];
    const sx0 = toScreenX(A.x);
    const sy0 = toScreenY(A.y);
    const sx1 = toScreenX(B.x);
    const sy1 = toScreenY(B.y);
    if (
      Math.max(sx0, sx1) < -220 ||
      Math.min(sx0, sx1) > W + 220 ||
      Math.max(sy0, sy1) < -220 ||
      Math.min(sy0, sy1) > H + 220
    ) {
      continue;
    }

    const rimCol: RGBA = A.passed
      ? [A.col[0], A.col[1], A.col[2], 225]
      : [68, 118, 198, 185];
    fillSquareCorridorSeg(sx0, sy0, sx1, sy1, wallRimHalfW, rimCol);

    if (i + 2 < corridorPts.length) {
      const C = corridorPts[i + 2];
      const sx2 = toScreenX(C.x);
      const sy2 = toScreenY(C.y);
      const wedgeRimCol: RGBA = B.passed
        ? [B.col[0], B.col[1], B.col[2], 225]
        : [68, 118, 198, 185];
      fillChamberWedge(sx0, sy0, sx1, sy1, sx2, sy2, B.hitAxis, wallRimHalfW, wedgeRimCol);
    }
  }

  // Pass 4B：镂空雕刻迷宫内部下沉式暗色通道地面与宽敞腔体
  const floorCol: RGBA = [14, 21, 39, 255];
  const innerShadowCol: RGBA = [8, 12, 24, 255];
  for (let i = 0; i < corridorPts.length - 1; i++) {
    const A = corridorPts[i];
    const B = corridorPts[i + 1];
    const sx0 = toScreenX(A.x);
    const sy0 = toScreenY(A.y);
    const sx1 = toScreenX(B.x);
    const sy1 = toScreenY(B.y);
    if (
      Math.max(sx0, sx1) < -220 ||
      Math.min(sx0, sx1) > W + 220 ||
      Math.max(sy0, sy1) < -220 ||
      Math.min(sy0, sy1) > H + 220
    ) {
      continue;
    }

    fillSquareCorridorSeg(sx0, sy0, sx1, sy1, tunnelHalfW + 1, innerShadowCol);
    if (i + 2 < corridorPts.length) {
      const C = corridorPts[i + 2];
      fillChamberWedge(
        sx0,
        sy0,
        sx1,
        sy1,
        toScreenX(C.x),
        toScreenY(C.y),
        B.hitAxis,
        tunnelHalfW + 1,
        innerShadowCol,
      );
    }
  }
  for (let i = 0; i < corridorPts.length - 1; i++) {
    const A = corridorPts[i];
    const B = corridorPts[i + 1];
    const sx0 = toScreenX(A.x);
    const sy0 = toScreenY(A.y);
    const sx1 = toScreenX(B.x);
    const sy1 = toScreenY(B.y);
    if (
      Math.max(sx0, sx1) < -220 ||
      Math.min(sx0, sx1) > W + 220 ||
      Math.max(sy0, sy1) < -220 ||
      Math.min(sy0, sy1) > H + 220
    ) {
      continue;
    }

    fillSquareCorridorSeg(sx0, sy0, sx1, sy1, tunnelHalfW - 2, floorCol);
    if (i + 2 < corridorPts.length) {
      const C = corridorPts[i + 2];
      fillChamberWedge(
        sx0,
        sy0,
        sx1,
        sy1,
        toScreenX(C.x),
        toScreenY(C.y),
        B.hitAxis,
        tunnelHalfW - 2,
        floorCol,
      );
    }
  }

  // Pass 4C：仅为「已经走过」的迷宫通道地面保留一条发光能量余晖线（支持跨周期鬼影余晖）
  const activeHeadVIdx = gt <= first.t ? -1 : segIdx;
  for (let vIdx = activeHeadVIdx - 12; vIdx < activeHeadVIdx; vIdx++) {
    const A = getVirtualNode(vIdx);
    const B = getVirtualNode(vIdx + 1);
    const sx0 = toScreenX(A.x);
    const sy0 = toScreenY(A.y);
    const sx1 = toScreenX(B.x);
    const sy1 = toScreenY(B.y);
    const stepAge = (activeHeadVIdx - vIdx) / 12;
    const age = clamp(1 - stepAge * 0.82, 0.18, 0.78);
    fb.drawLine(sx0, sy0, sx1, sy1, 3, [
      A.base.color[0],
      A.base.color[1],
      A.base.color[2],
      Math.round(130 * age),
    ]);
  }

  const curCol = (gt <= first.t ? last.color : nodes[segIdx]?.color) ?? theme.primary;
  fb.drawGlowCircle(
    toScreenX(bx),
    toScreenY(by),
    260 + hitPulse * 110,
    [curCol[0], curCol[1], curCol[2], Math.round(36 + hitPulse * 48)],
  );

  // 5. 绘制齐平镶嵌在迷宫折返壁面上的锐利 MIDI 音符砖块（包含首尾周期延伸鬼影砖块，视觉完全无缝循环）
  for (let vIdx = segIdx - 14; vIdx <= segIdx + 18; vIdx++) {
    const vn = getVirtualNode(vIdx);
    const n = vn.base;
    const dtHit = vn.cycle < 0 ? 1.0 : vn.cycle > 0 ? -1.0 : gt - n.t;
    const isHit = dtHit >= 0;
    const activeFlash =
      vn.cycle === 0 && isHit && dtHit < 0.36 ? Math.pow(1 - dtHit / 0.36, 1.5) : 0;

    const recoilMag = activeFlash > 0 ? Math.sin(activeFlash * Math.PI) * 7 : 0;
    const normX = n.hitAxis === "x" ? (n.incomingVx > 0 ? 1 : -1) : 0;
    const normY = n.hitAxis === "y" ? (n.incomingVy > 0 ? 1 : -1) : 0;

    const sx = toScreenX(vn.brickX + normX * recoilMag);
    const sy = toScreenY(vn.brickY + normY * recoilMag);
    if (sy < 195 || sy > H + 150 || sx < -150 || sx > W + 150) continue;

    const col = n.color;
    const rx = sx - n.brickW * 0.5;
    const ry = sy - n.brickH * 0.5;

    if (activeFlash > 0.02) {
      fb.drawGlowCircle(sx, sy, 115 * activeFlash + 45, [col[0], col[1], col[2], Math.round(210 * activeFlash)]);
    } else if (isHit) {
      fb.drawGlowCircle(sx, sy, 44, [col[0], col[1], col[2], 55]);
    }

    fb.blendRoundRect(rx + 3, ry + 5, n.brickW, n.brickH, 3, [0, 0, 0, 175]);

    const fillTop: RGBA = activeFlash > 0.10
      ? [255, 255, 255, 255]
      : isHit
        ? [col[0], col[1], col[2], 245]
        : [22, 33, 62, 245];
    const fillBot: RGBA = activeFlash > 0.10
      ? [col[0], col[1], col[2], 255]
      : isHit
        ? [Math.round(col[0] * 0.55), Math.round(col[1] * 0.55), Math.round(col[2] * 0.65), 240]
        : [13, 20, 40, 245];

    fb.blendGradientRoundRect(rx, ry, n.brickW, n.brickH, 3, fillTop, fillBot, true);

    if (n.hitAxis === "y") {
      const edgeY = n.incomingVy > 0 ? ry + 1 : ry + n.brickH - 5;
      fb.blendRect(rx + 3, edgeY, n.brickW - 6, 4, [255, 255, 255, isHit ? 250 : 175]);
    } else {
      const edgeX = n.incomingVx > 0 ? rx + 1 : rx + n.brickW - 5;
      fb.blendRect(edgeX, ry + 3, 4, n.brickH - 6, [255, 255, 255, isHit ? 250 : 175]);
    }

    fb.strokeRoundRect(
      rx,
      ry,
      n.brickW,
      n.brickH,
      3,
      activeFlash > 0.1 ? 3.5 : 2.5,
      [col[0], col[1], col[2], isHit ? 255 : 215],
    );

    if (vn.cycle === 0 && dtHit >= 0 && dtHit < 0.38) {
      const p = dtHit / 0.38;
      const expand = p * (n.strong ? 72 : 50);
      const alpha = Math.round((1 - p) * 235);
      fb.strokeRoundRect(
        rx - expand,
        ry - expand,
        n.brickW + expand * 2,
        n.brickH + expand * 2,
        3,
        Math.max(1.5, (1 - p) * 4),
        [col[0], col[1], col[2], alpha],
      );

      const count = n.strong ? 8 : 5;
      const hitContactX = toScreenX(vn.x + normX * SQ_R);
      const hitContactY = toScreenY(vn.y + normY * SQ_R);
      for (let k = 0; k < count; k++) {
        const baseAng = Math.atan2(-normY, -normX);
        const spread = ((k / Math.max(1, count - 1)) - 0.5) * 2.0;
        const ang = baseAng + spread;
        const dist = (18 + (k % 3) * 12) + p * (n.strong ? 95 : 68);
        const px = hitContactX + Math.cos(ang) * dist;
        const py = hitContactY + Math.sin(ang) * dist;
        const pSize = Math.max(3, (1 - p) * 9);
        fb.fillRect(
          px - pSize * 0.5,
          py - pSize * 0.5,
          pSize,
          pSize,
          k % 2 === 0
            ? [255, 255, 255, Math.round((1 - p) * 245)]
            : [col[0], col[1], col[2], Math.round((1 - p) * 235)],
        );
      }

      drawFitText(
        fb,
        atlas,
        n.noteName,
        sx - normX * 42,
        sy - normY * 42 - 12 - p * 18,
        [255, 255, 255, Math.round((1 - p) * 250)],
        120,
        0.34,
        "center",
        2,
      );
    }
  }

  // 6. 绘制零断层连续多边形丝带拖尾（Continuous Polygon Ribbon Trail）
  trail.push({ x: bx, y: by });
  if (trail.length > 18) trail.shift();

  for (let i = 0; i < trail.length - 1; i++) {
    const p0 = trail[i];
    const p1 = trail[i + 1];
    const f0 = (i + 1) / trail.length;
    const f1 = (i + 2) / trail.length;
    const sx0 = toScreenX(p0.x);
    const sy0 = toScreenY(p0.y);
    const sx1 = toScreenX(p1.x);
    const sy1 = toScreenY(p1.y);
    const dx = sx1 - sx0;
    const dy = sy1 - sy0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const w0 = SQ_R * (0.18 + 0.78 * f0);
    const w1 = SQ_R * (0.18 + 0.78 * f1);
    const alpha = Math.round(f1 * f1 * 175);
    fillConvexQuad(
      fb,
      [
        [sx0 + nx * w0, sy0 + ny * w0],
        [sx1 + nx * w1, sy1 + ny * w1],
        [sx1 - nx * w1, sy1 - ny * w1],
        [sx0 - nx * w0, sy0 - ny * w0],
      ],
      [curCol[0], curCol[1], curCol[2], alpha],
    );
  }

  // 7. 绘制主角「锐利几何发光音符方块」（r = 3px，外层纯白亮框 + 随音高实时变色的霓虹能量内芯）
  const lastNode = nodes[segIdx];
  const squashAmt = hitPulse > 0.15 ? (hitPulse - 0.15) * 0.28 : 0;
  const scaleX = lastNode?.hitAxis === "x" ? 1 - squashAmt : 1 + squashAmt * 0.55;
  const scaleY = lastNode?.hitAxis === "y" ? 1 - squashAmt : 1 + squashAmt * 0.55;
  const sqW = SQ_R * 2 * scaleX;
  const sqH = SQ_R * 2 * scaleY;
  const sbx = toScreenX(bx) - sqW * 0.5;
  const sby = toScreenY(by) - sqH * 0.5;

  fb.drawGlowCircle(toScreenX(bx), toScreenY(by), 68 + hitPulse * 32, [curCol[0], curCol[1], curCol[2], 185]);
  fb.blendRoundRect(sbx, sby, sqW, sqH, 3, [255, 255, 255, 255]);
  const borderPad = 4.5;
  fb.blendRoundRect(
    sbx + borderPad,
    sby + borderPad,
    Math.max(8, sqW - borderPad * 2),
    Math.max(8, sqH - borderPad * 2),
    2,
    [curCol[0], curCol[1], curCol[2], 255],
  );
  const corePad = 11;
  fb.blendRoundRect(
    sbx + corePad,
    sby + corePad,
    Math.max(4, sqW - corePad * 2),
    Math.max(4, sqH - corePad * 2),
    1.5,
    [255, 255, 255, 235],
  );
}

// ============================================================================
// 渲染器 2：STAIRCASE（2.5D 水晶阶梯八音盒 · Cascading Crystal Piano Staircase）
// ============================================================================

const ORB_R = 23;
const COS30 = 0.8660254;
const SIN30 = 0.5;

function isoProject(
  wx: number,
  wy: number,
  wz: number,
  camWx: number,
  camWy: number,
  camWz: number,
  W: number,
  H: number,
): Pt2 {
  const dx = wx - camWx;
  const dy = wy - camWy;
  const dz = wz - camWz;
  return [
    W * 0.5 + (dx - dy) * COS30,
    H * 0.42 + (dx + dy) * SIN30 - dz,
  ];
}

function drawIsoPrism(
  fb: FrameBuf,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  camWx: number,
  camWy: number,
  camWz: number,
  topColStart: RGBA,
  topColEnd: RGBA,
  rightColStart: RGBA,
  rightColEnd: RGBA,
  leftColStart: RGBA,
  leftColEnd: RGBA,
  edgeCol: RGBA,
  edgeWidth: number,
  drawGloss: boolean,
): { topCenter: Pt2; topPts: [Pt2, Pt2, Pt2, Pt2] } {
  const W = fb.w;
  const H = fb.h;

  const t00 = isoProject(x0, y0, z1, camWx, camWy, camWz, W, H);
  const t10 = isoProject(x1, y0, z1, camWx, camWy, camWz, W, H);
  const t11 = isoProject(x1, y1, z1, camWx, camWy, camWz, W, H);
  const t01 = isoProject(x0, y1, z1, camWx, camWy, camWz, W, H);

  const b10 = isoProject(x1, y0, z0, camWx, camWy, camWz, W, H);
  const b11 = isoProject(x1, y1, z0, camWx, camWy, camWz, W, H);
  const b01 = isoProject(x0, y1, z0, camWx, camWy, camWz, W, H);

  fillConvexQuad(fb, [t01, t11, b11, b01], leftColStart, leftColEnd);
  fillConvexQuad(fb, [t10, t11, b11, b10], rightColStart, rightColEnd);
  fillConvexQuad(fb, [t00, t10, t11, t01], topColStart, topColEnd);

  if (drawGloss) {
    const g0 = isoProject(lerp(x0, x1, 0.14), lerp(y0, y1, 0.14), z1, camWx, camWy, camWz, W, H);
    const g1 = isoProject(lerp(x0, x1, 0.86), lerp(y0, y1, 0.14), z1, camWx, camWy, camWz, W, H);
    const g2 = isoProject(lerp(x0, x1, 0.86), lerp(y0, y1, 0.34), z1, camWx, camWy, camWz, W, H);
    const g3 = isoProject(lerp(x0, x1, 0.14), lerp(y0, y1, 0.34), z1, camWx, camWy, camWz, W, H);
    fillConvexQuad(fb, [g0, g1, g2, g3], [255, 255, 255, 115], [255, 255, 255, 35]);
  }

  if (edgeWidth > 0 && edgeCol[3] > 0) {
    strokeQuad(fb, [t00, t10, t11, t01], edgeWidth, edgeCol);
    const sideEdge: RGBA = [edgeCol[0], edgeCol[1], edgeCol[2], Math.round(edgeCol[3] * 0.72)];
    fb.drawLine(t01[0], t01[1], b01[0], b01[1], edgeWidth * 0.85, sideEdge);
    fb.drawLine(t10[0], t10[1], b10[0], b10[1], edgeWidth * 0.85, sideEdge);
    fb.drawLine(b01[0], b01[1], b11[0], b11[1], edgeWidth * 0.85, sideEdge);
    fb.drawLine(b10[0], b10[1], b11[0], b11[1], edgeWidth * 0.85, sideEdge);
    fb.drawLine(t11[0], t11[1], b11[0], b11[1], edgeWidth * 1.1, [
      Math.min(255, edgeCol[0] + 55),
      Math.min(255, edgeCol[1] + 55),
      Math.min(255, edgeCol[2] + 55),
      edgeCol[3],
    ]);
  }

  const topCenter: Pt2 = [(t00[0] + t11[0]) * 0.5, (t00[1] + t11[1]) * 0.5];
  return { topCenter, topPts: [t00, t10, t11, t01] };
}

export function renderStaircaseMode(
  fb: FrameBuf,
  atlas: FontAtlas,
  nodes: ViralBeatNode[],
  gt: number,
  hitPulse: number,
  theme: VisualTheme,
  trail: { x: number; y: number }[],
  camState: { x: number; y: number },
): void {
  const W = fb.w;
  const H = fb.h;

  let segIdx = 0;
  while (segIdx + 1 < nodes.length && nodes[segIdx + 1].t <= gt) {
    segIdx++;
  }

  let ballWx = nodes[0].isoX;
  let ballWy = nodes[0].isoY;
  let groundWz = nodes[0].isoZ;
  let ballWz = nodes[0].isoZ + ORB_R;

  if (gt <= nodes[0].t) {
    const dt = clamp(nodes[0].t - gt, 0, 0.28);
    const u = 1 - dt / 0.28;
    ballWx = nodes[0].isoX - 55 * (1 - u);
    ballWy = nodes[0].isoY;
    groundWz = nodes[0].isoZ + 36 * (1 - u);
    const arcH = 85 * 4 * u * (1 - u);
    ballWz = groundWz + ORB_R + arcH;
  } else if (segIdx < nodes.length - 1) {
    const A = nodes[segIdx];
    const B = nodes[segIdx + 1];
    const T = Math.max(0.08, B.t - A.t);
    const u = clamp((gt - A.t) / T, 0, 1);

    ballWx = lerp(A.isoX, B.isoX, u);
    ballWy = lerp(A.isoY, B.isoY, u);
    groundWz = lerp(A.isoZ, B.isoZ, u);

    // 抛物线弹跳高度与音符间隔 T 严格成正比：十六分音符快闪呈现低弧度轻快点跳，长音符呈现高抛蓄力重击
    const peakLift = clamp(24 + T * 245, 42, 142);
    const parabola = 4 * u * (1 - u) * peakLift;
    ballWz = groundWz + ORB_R + parabola;
  } else {
    const last = nodes[nodes.length - 1];
    const u = clamp((gt - last.t) / 0.28, 0, 1.4);
    ballWx = last.isoX + (last.isoAxis === "x" ? 72 * u : 0);
    ballWy = last.isoY + (last.isoAxis === "y" ? 72 * u : 0);
    groundWz = last.isoZ - 46 * u;
    const parabola = Math.max(-60, 4 * u * (1 - u) * 88);
    ballWz = groundWz + ORB_R + parabola;
  }

  const rawBallProjX = (ballWx - ballWy) * COS30;
  const rawBallProjY = (ballWx + ballWy) * SIN30 - groundWz;
  camState.x = lerp(camState.x, rawBallProjX * 0.68, 0.14);
  camState.y = lerp(camState.y, rawBallProjY + 85, 0.14);

  const camWx = (camState.x / COS30 + camState.y / SIN30) * 0.5;
  const camWy = (camState.y / SIN30 - camState.x / COS30) * 0.5;
  const camWz = 0;

  fb.blendGradientRect(0, 0, W, H, [6, 9, 24, 255], [15, 11, 36, 255], true);

  const curCol = nodes[segIdx]?.color ?? theme.primary;
  fb.drawGlowCircle(
    W * 0.5,
    H * 0.42,
    460 + hitPulse * 110,
    [curCol[0], curCol[1], curCol[2], Math.round(28 + hitPulse * 36)],
  );

  // 远景深空等轴测菱形参考网格
  const gridSpacing = 140;
  const baseGridX = Math.floor(camWx / gridSpacing) * gridSpacing;
  const baseGridY = Math.floor(camWy / gridSpacing) * gridSpacing;
  const gridZ = groundWz - 220;
  for (let i = -5; i <= 6; i++) {
    const gx = baseGridX + i * gridSpacing;
    const p0 = isoProject(gx, baseGridY - 5 * gridSpacing, gridZ, camWx, camWy, camWz, W, H);
    const p1 = isoProject(gx, baseGridY + 6 * gridSpacing, gridZ, camWx, camWy, camWz, W, H);
    fb.drawLine(p0[0], p0[1], p1[0], p1[1], 1, [70, 115, 195, 22]);

    const gy = baseGridY + i * gridSpacing;
    const q0 = isoProject(baseGridX - 5 * gridSpacing, gy, gridZ, camWx, camWy, camWz, W, H);
    const q1 = isoProject(baseGridX + 6 * gridSpacing, gy, gridZ, camWx, camWy, camWz, W, H);
    fb.drawLine(q0[0], q0[1], q1[0], q1[1], 1, [70, 115, 195, 22]);
  }

  for (let s = 0; s < 30; s++) {
    const sx = (s * 173 + 41) % W;
    const sy = (((s * 293) - Math.round(camState.y * (0.22 + (s % 3) * 0.10))) % H + H) % H;
    const sr = (s % 3) + 1.5;
    fb.blendCircle(sx, sy, sr, [205, 232, 255, 50 + (s % 4) * 26]);
  }

  const startIdx = Math.max(0, segIdx - 8);
  const endIdx = Math.min(nodes.length - 1, segIdx + 13);

  // 台阶底部 3D 等轴测承重水晶龙骨梁
  for (let i = startIdx; i < endIdx; i++) {
    const A = nodes[i];
    const B = nodes[i + 1];
    const pA = isoProject(A.isoX, A.isoY, A.isoZ - A.isoThickZ - 6, camWx, camWy, camWz, W, H);
    const pB = isoProject(B.isoX, B.isoY, B.isoZ - B.isoThickZ - 6, camWx, camWy, camWz, W, H);
    if (Math.max(pA[1], pB[1]) < 180 || Math.min(pA[1], pB[1]) > H + 180) continue;
    const passed = gt >= B.t;
    fb.drawLine(pA[0], pA[1], pB[0], pB[1], 10, passed ? [A.color[0], A.color[1], A.color[2], 95] : [38, 60, 108, 90]);
    fb.drawLine(pA[0], pA[1], pB[0], pB[1], 3, passed ? [220, 245, 255, 145] : [85, 130, 210, 85]);
  }

  const visibleIndices: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) visibleIndices.push(i);
  visibleIndices.sort((ia, ib) => {
    const A = nodes[ia];
    const B = nodes[ib];
    return (A.isoX + A.isoY - A.isoZ * 0.6) - (B.isoX + B.isoY - B.isoZ * 0.6);
  });

  for (const i of visibleIndices) {
    const n = nodes[i];
    const dtHit = gt - n.t;
    const isHit = dtHit >= 0;
    const activeFlash = isHit && dtHit < 0.42 ? Math.pow(1 - dtHit / 0.42, 1.45) : 0;

    const depressZ = activeFlash > 0 ? Math.sin(activeFlash * Math.PI) * 15 : 0;
    const zTop = n.isoZ - depressZ;
    const zBot = zTop - n.isoThickZ;

    const centerScreen = isoProject(n.isoX, n.isoY, zTop, camWx, camWy, camWz, W, H);
    if (centerScreen[1] < 175 || centerScreen[1] > H + 210) continue;

    const col = n.color;
    const x0 = n.isoX - n.isoHalfX;
    const x1 = n.isoX + n.isoHalfX;
    const y0 = n.isoY - n.isoHalfY;
    const y1 = n.isoY + n.isoHalfY;

    // ① 琴键正下方的 3D 半透明水晶承托立柱
    const pillarHalf = n.isCornerStep ? 22 : 16;
    const pillarDepth = 185;
    const pColAlpha = isHit ? 105 : 68;
    drawIsoPrism(
      fb,
      n.isoX - pillarHalf,
      n.isoX + pillarHalf,
      n.isoY - pillarHalf,
      n.isoY + pillarHalf,
      zBot - pillarDepth,
      zBot,
      camWx,
      camWy,
      camWz,
      [18, 28, 54, pColAlpha],
      [14, 22, 44, pColAlpha],
      [
        Math.round(col[0] * (isHit ? 0.34 : 0.16)),
        Math.round(col[1] * (isHit ? 0.34 : 0.16)),
        Math.round(col[2] * (isHit ? 0.42 : 0.24)),
        pColAlpha,
      ],
      [8, 12, 26, 0],
      [
        Math.round(col[0] * (isHit ? 0.22 : 0.10)),
        Math.round(col[1] * (isHit ? 0.22 : 0.10)),
        Math.round(col[2] * (isHit ? 0.30 : 0.18)),
        pColAlpha,
      ],
      [6, 9, 20, 0],
      [col[0], col[1], col[2], isHit ? 95 : 42],
      1.2,
      false,
    );

    if (activeFlash > 0.02) {
      fb.drawGlowCircle(centerScreen[0], centerScreen[1], 135 * activeFlash + 55, [col[0], col[1], col[2], Math.round(195 * activeFlash)]);
    } else if (isHit) {
      fb.drawGlowCircle(centerScreen[0], centerScreen[1], 56, [col[0], col[1], col[2], 45]);
    }

    // ② 3D 等轴测六面体水晶琴键本体（未触发时亦呈现半透明冰晶琉璃质感，触发后瞬间全亮绽放）
    const topStart: RGBA = activeFlash > 0.10
      ? [255, 255, 255, 255]
      : isHit
        ? [Math.min(255, col[0] + 62), Math.min(255, col[1] + 62), Math.min(255, col[2] + 62), 250]
        : [Math.round(44 + col[0] * 0.36), Math.round(58 + col[1] * 0.36), Math.round(92 + col[2] * 0.42), 242];
    const topEnd: RGBA = activeFlash > 0.10
      ? [col[0], col[1], col[2], 252]
      : isHit
        ? [col[0], col[1], col[2], 245]
        : [Math.round(28 + col[0] * 0.24), Math.round(38 + col[1] * 0.24), Math.round(68 + col[2] * 0.32), 238];

    const rightStart: RGBA = activeFlash > 0.10
      ? [col[0], col[1], col[2], 250]
      : isHit
        ? [Math.round(col[0] * 0.78), Math.round(col[1] * 0.78), Math.round(col[2] * 0.86), 246]
        : [Math.round(22 + col[0] * 0.22), Math.round(32 + col[1] * 0.22), Math.round(62 + col[2] * 0.28), 242];
    const rightEnd: RGBA = activeFlash > 0.10
      ? [Math.round(col[0] * 0.72), Math.round(col[1] * 0.72), Math.round(col[2] * 0.82), 248]
      : isHit
        ? [Math.round(col[0] * 0.54), Math.round(col[1] * 0.54), Math.round(col[2] * 0.66), 244]
        : [Math.round(14 + col[0] * 0.14), Math.round(22 + col[1] * 0.14), Math.round(46 + col[2] * 0.20), 242];

    const leftStart: RGBA = activeFlash > 0.10
      ? [Math.round(col[0] * 0.78), Math.round(col[1] * 0.78), Math.round(col[2] * 0.88), 250]
      : isHit
        ? [Math.round(col[0] * 0.52), Math.round(col[1] * 0.52), Math.round(col[2] * 0.64), 246]
        : [Math.round(15 + col[0] * 0.16), Math.round(24 + col[1] * 0.16), Math.round(48 + col[2] * 0.22), 244];
    const leftEnd: RGBA = activeFlash > 0.10
      ? [Math.round(col[0] * 0.52), Math.round(col[1] * 0.52), Math.round(col[2] * 0.65), 248]
      : isHit
        ? [Math.round(col[0] * 0.36), Math.round(col[1] * 0.36), Math.round(col[2] * 0.48), 244]
        : [Math.round(10 + col[0] * 0.10), Math.round(16 + col[1] * 0.10), Math.round(34 + col[2] * 0.15), 244];

    const edgeCol: RGBA = activeFlash > 0.08
      ? [255, 255, 255, 255]
      : isHit
        ? [Math.min(255, col[0] + 55), Math.min(255, col[1] + 55), Math.min(255, col[2] + 55), 248]
        : [Math.min(255, col[0] + 30), Math.min(255, col[1] + 30), Math.min(255, col[2] + 30), 195];

    const { topCenter, topPts } = drawIsoPrism(
      fb,
      x0,
      x1,
      y0,
      y1,
      zBot,
      zTop,
      camWx,
      camWy,
      camWz,
      topStart,
      topEnd,
      rightStart,
      rightEnd,
      leftStart,
      leftEnd,
      edgeCol,
      activeFlash > 0.08 ? 3.2 : 2.0,
      true,
    );

    if (activeFlash > 0.03) {
      const beamH = 175 * activeFlash + 35;
      const bTop0 = isoProject(x0 + 6, y0 + 6, zTop + beamH, camWx, camWy, camWz, W, H);
      const bTop1 = isoProject(x1 - 6, y1 - 6, zTop + beamH, camWx, camWy, camWz, W, H);
      fillConvexQuad(
        fb,
        [bTop0, bTop1, topPts[2], topPts[0]],
        [col[0], col[1], col[2], 0],
        [col[0], col[1], col[2], Math.round(92 * activeFlash)],
      );
    }

    drawFitText(
      fb,
      atlas,
      n.noteName,
      topCenter[0],
      topCenter[1] - 11,
      [255, 255, 255, activeFlash > 0.12 ? 255 : isHit ? 245 : 185],
      90,
      0.30,
      "center",
      2,
    );

    // 沿 3D 等轴测水平面扩散的平行四边形波纹环
    if (dtHit >= 0 && dtHit < 0.44) {
      const p = dtHit / 0.44;
      const expand = p * (n.strong ? 52 : 36);
      const r00 = isoProject(x0 - expand, y0 - expand, zTop, camWx, camWy, camWz, W, H);
      const r10 = isoProject(x1 + expand, y0 - expand, zTop, camWx, camWy, camWz, W, H);
      const r11 = isoProject(x1 + expand, y1 + expand, zTop, camWx, camWy, camWz, W, H);
      const r01 = isoProject(x0 - expand, y1 + expand, zTop, camWx, camWy, camWz, W, H);
      strokeQuad(fb, [r00, r10, r11, r01], Math.max(1.5, (1 - p) * 3.8), [col[0], col[1], col[2], Math.round((1 - p) * 230)]);

      drawFitText(
        fb,
        atlas,
        `♪ ${n.noteName}`,
        topCenter[0],
        topCenter[1] - 38 - p * 48,
        [col[0], col[1], col[2], Math.round((1 - p) * 250)],
        160,
        0.40,
        "center",
        2,
      );
    }
  }

  // 5. 绘制水晶琉璃球在台阶平面上的真实 3D 垂直落点阴影（Drop Shadow）
  const heightAbove = Math.max(0, ballWz - ORB_R - groundWz);
  const shadowScale = clamp(1 - heightAbove / 165, 0.32, 1.0);
  const shR = ORB_R * (0.55 + 0.55 * shadowScale);
  const shAlpha = Math.round(165 * shadowScale);
  const s00 = isoProject(ballWx - shR, ballWy - shR, groundWz, camWx, camWy, camWz, W, H);
  const s10 = isoProject(ballWx + shR, ballWy - shR, groundWz, camWx, camWy, camWz, W, H);
  const s11 = isoProject(ballWx + shR, ballWy + shR, groundWz, camWx, camWy, camWz, W, H);
  const s01 = isoProject(ballWx - shR, ballWy + shR, groundWz, camWx, camWy, camWz, W, H);
  fillConvexQuad(fb, [s00, s10, s11, s01], [3, 5, 14, shAlpha]);

  // 6. 绘制流光水晶琉璃球的连续丝带光轨与高折射球体
  const ballScreen = isoProject(ballWx, ballWy, ballWz, camWx, camWy, camWz, W, H);
  const worldScreenX = ballScreen[0] + camState.x;
  const worldScreenY = ballScreen[1] + camState.y;
  trail.push({ x: worldScreenX, y: worldScreenY });
  if (trail.length > 18) trail.shift();

  for (let i = 0; i < trail.length - 1; i++) {
    const p0 = trail[i];
    const p1 = trail[i + 1];
    const f0 = (i + 1) / trail.length;
    const f1 = (i + 2) / trail.length;
    const sx0 = p0.x - camState.x;
    const sy0 = p0.y - camState.y;
    const sx1 = p1.x - camState.x;
    const sy1 = p1.y - camState.y;
    const dx = sx1 - sx0;
    const dy = sy1 - sy0;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const w0 = ORB_R * (0.14 + 0.68 * f0);
    const w1 = ORB_R * (0.14 + 0.68 * f1);
    fillConvexQuad(
      fb,
      [
        [sx0 + nx * w0, sy0 + ny * w0],
        [sx1 + nx * w1, sy1 + ny * w1],
        [sx1 - nx * w1, sy1 - ny * w1],
        [sx0 - nx * w0, sy0 - ny * w0],
      ],
      [curCol[0], curCol[1], curCol[2], Math.round(f1 * f1 * 155)],
    );
  }

  const sbx = ballScreen[0];
  const sby = ballScreen[1];
  fb.drawGlowCircle(sbx, sby, 82 + hitPulse * 38, [curCol[0], curCol[1], curCol[2], 185]);
  fb.fillCircle(sbx, sby, ORB_R + 2, [255, 255, 255, 248]);
  fb.fillCircle(sbx, sby, ORB_R - 1.5, [curCol[0], curCol[1], curCol[2], 255]);
  fb.fillCircle(sbx + ORB_R * 0.14, sby + ORB_R * 0.16, ORB_R * 0.68, [
    Math.round(curCol[0] * 0.72),
    Math.round(curCol[1] * 0.72),
    Math.round(curCol[2] * 0.85),
    235,
  ]);
  fb.fillCircle(sbx - ORB_R * 0.12, sby - ORB_R * 0.12, ORB_R * 0.50, [255, 255, 255, 240]);
  fb.fillCircle(sbx - ORB_R * 0.32, sby - ORB_R * 0.34, ORB_R * 0.22, [255, 255, 255, 255]);
}

// ============================================================================
// 渲染器 3：PENDULUM（催眠钟摆波激光竖琴 · Hypnotic Polyrhythm Pendulum Harp）
// ============================================================================

export function renderPendulumMode(
  fb: FrameBuf,
  atlas: FontAtlas,
  nodes: ViralBeatNode[],
  gt: number,
  hitPulse: number,
  theme: VisualTheme,
  tempo: number,
): void {
  const W = fb.w;
  const H = fb.h;

  // 同心音律圆心与 10 条轨道半径（内圈高音 A5 -> 外圈低音 C4）
  const pivotX = W * 0.5;
  const pivotY = 475;
  const maxSwingRad = 0.62; // 最大摆角 ±35.5°，确保 10 颗球全部在 1080px 屏幕内舒展摆动

  // 1. 深空催眠背景
  fb.blendGradientRect(0, 0, W, H, [5, 8, 20, 255], [11, 16, 34, 255], true);
  fb.drawGlowCircle(pivotX, pivotY + 420, 520 + hitPulse * 110, [
    theme.primary[0],
    theme.primary[1],
    theme.primary[2],
    Math.round(28 + hitPulse * 35),
  ]);

  // 2. 预计算每条轨道 (k = 0..9) 的事件时间表，保证钟摆在每个事件时刻精确跨过中轴线 (sin(phi) = 0)
  const trackEvents: ViralBeatNode[][] = Array.from({ length: 10 }, () => []);
  for (const n of nodes) {
    trackEvents[n.trackIdx].push(n);
  }

  // 计算最近一次全局拨弦事件，驱动中央激光竖琴弦产生真实的物理驻波震颤（Plucked String Standing Wave）
  let stringPluckDt = 999;
  let stringPluckY = pivotY + 450;
  let stringPluckCol: [number, number, number] = theme.primary;
  for (const n of nodes) {
    if (gt >= n.t && gt - n.t < stringPluckDt) {
      stringPluckDt = gt - n.t;
      const ringOrder = 9 - n.trackIdx;
      stringPluckY = pivotY + 220 + ringOrder * 74;
      stringPluckCol = n.color;
    }
  }

  // 3. 绘制中央激光竖琴弦（带物理阻尼正弦驻波形变）
  const stringTopY = pivotY;
  const stringBotY = pivotY + 220 + 9 * 74 + 45;
  const pluckAmp = stringPluckDt < 0.45
    ? Math.exp(-stringPluckDt * 8.5) * Math.sin(stringPluckDt * 62) * 22
    : 0;

  let prevSx = pivotX;
  let prevSy = stringTopY;
  const segs = 36;
  for (let s = 1; s <= segs; s++) {
    const frac = s / segs;
    const sy = lerp(stringTopY, stringBotY, frac);
    // 驻波包络：在拨弦点附近振幅最大，两端固定为 0
    const distToPluck = Math.abs(sy - stringPluckY) / 380;
    const localEnv = Math.sin(frac * Math.PI) * Math.exp(-distToPluck * distToPluck);
    const sx = pivotX + pluckAmp * localEnv;

    fb.drawLine(prevSx, prevSy, sx, sy, 6, [
      stringPluckCol[0],
      stringPluckCol[1],
      stringPluckCol[2],
      stringPluckDt < 0.35 ? 120 : 45,
    ]);
    fb.drawLine(prevSx, prevSy, sx, sy, 2.5, [235, 248, 255, 215]);
    prevSx = sx;
    prevSy = sy;
  }

  // 顶部星轨轴承座与底部共鸣锚点
  fb.drawGlowCircle(pivotX, pivotY, 44, [theme.primary[0], theme.primary[1], theme.primary[2], 140]);
  fb.fillCircle(pivotX, pivotY, 14, [255, 255, 255, 245]);
  fb.strokeRing(pivotX, pivotY, 22, 3, [theme.primary[0], theme.primary[1], theme.primary[2], 220]);

  // 4. 遍历 10 条同心音阶星轨（k = 0..9），计算相位锁定的摆角并渲染星弧、共鸣点与钟摆球
  const baseOmega = (Math.PI * Math.max(72, tempo)) / 120; // 自然摆动角频率

  for (let k = 0; k < 10; k++) {
    const ringOrder = 9 - k; // 内圈高音 (k=9 -> ringOrder=0)，外圈低音 (k=0 -> ringOrder=9)
    const radius = 220 + ringOrder * 74;
    const col = PITCH_PALETTE[k];
    const evList = trackEvents[k];

    // 计算当前轨道的触发闪烁强度
    let trackFlash = 0;
    let lastHitEv: ViralBeatNode | null = null;
    for (const ev of evList) {
      if (gt >= ev.t && gt - ev.t < 0.48) {
        const f = Math.pow(1 - (gt - ev.t) / 0.48, 1.4);
        if (f > trackFlash) {
          trackFlash = f;
          lastHitEv = ev;
        }
      }
    }

    // 计算相位 phi(gt)：
    // - 在每个事件时刻 evList[m].t，phi = m * PI，此时 sin(phi) === 0（100% 精准跨过中央激光竖琴弦！）
    // - 在两个事件之间平滑插值，在首尾事件之外按多节奏频率 omega_k 自由摆动形成钟摆波！
    const omegaK = baseOmega * (0.82 + k * 0.042);
    let phi = 0;
    if (evList.length === 0) {
      phi = gt * omegaK + k * 0.38;
    } else if (gt <= evList[0].t) {
      phi = -(evList[0].t - gt) * omegaK;
    } else if (gt >= evList[evList.length - 1].t) {
      const mLast = evList.length - 1;
      phi = mLast * Math.PI + (gt - evList[mLast].t) * omegaK;
    } else {
      let m = 0;
      while (m + 1 < evList.length && evList[m + 1].t <= gt) {
        m++;
      }
      const t0 = evList[m].t;
      const t1 = evList[m + 1].t;
      const u = clamp((gt - t0) / Math.max(0.01, t1 - t0), 0, 1);
      phi = (m + u) * Math.PI;
    }

    const swingAngle = maxSwingRad * Math.sin(phi);
    const angleRad = Math.PI * 0.5 + swingAngle; // PI/2 为正下方中轴线

    // ① 绘制同心音阶圆弧导轨
    const arcAlpha = Math.round(42 + trackFlash * 175);
    fb.drawArc(
      pivotX,
      pivotY,
      radius,
      trackFlash > 0.1 ? 5.5 : 2.5,
      Math.PI * 0.5 - maxSwingRad * 1.06,
      Math.PI * 0.5 + maxSwingRad * 1.06,
      [col[0], col[1], col[2], arcAlpha],
      false,
    );

    // ② 绘制中央激光琴弦上的音阶共鸣锚点
    const nodeY = pivotY + radius;
    fb.fillCircle(pivotX, nodeY, trackFlash > 0.1 ? 9 : 5, [
      col[0],
      col[1],
      col[2],
      trackFlash > 0.1 ? 255 : 155,
    ]);

    // 轨道右侧常驻轻量化音高刻度标签
    drawFitText(
      fb,
      atlas,
      NOTE_NAMES[k],
      pivotX + 26,
      nodeY - 11,
      [col[0], col[1], col[2], trackFlash > 0.1 ? 255 : 130],
      70,
      0.28,
      "left",
      1,
    );

    // 跨弦瞬间：在中央激光弦锚点爆开同心水波纹 + 高亮音符飘字
    if (lastHitEv && gt >= lastHitEv.t && gt - lastHitEv.t < 0.48) {
      const p = (gt - lastHitEv.t) / 0.48;
      const r1 = 16 + p * (lastHitEv.strong ? 115 : 80);
      const r2 = 8 + p * (lastHitEv.strong ? 68 : 48);
      fb.strokeRing(pivotX, nodeY, r1, Math.max(1.5, (1 - p) * 5), [
        col[0],
        col[1],
        col[2],
        Math.round((1 - p) * 235),
      ]);
      fb.strokeRing(pivotX, nodeY, r2, Math.max(1.5, (1 - p) * 3), [
        255,
        255,
        255,
        Math.round((1 - p) * 210),
      ]);

      drawFitText(
        fb,
        atlas,
        `♪ ${NOTE_NAMES[k]}`,
        pivotX - 75,
        nodeY - 18 - p * 28,
        [col[0], col[1], col[2], Math.round((1 - p) * 250)],
        140,
        0.38,
        "center",
        2,
      );
    }

    // ③ 绘制钟摆球的圆弧彗星尾迹
    const dPhi = Math.cos(phi); // 角速度方向符号
    const tailSpan = clamp(Math.abs(dPhi) * 0.24, 0.06, 0.24) * (dPhi >= 0 ? -1 : 1);
    const a0 = Math.min(angleRad, angleRad + tailSpan);
    const a1 = Math.max(angleRad, angleRad + tailSpan);
    fb.drawArc(
      pivotX,
      pivotY,
      radius,
      14,
      a0,
      a1,
      [col[0], col[1], col[2], 145],
      true,
    );

    // ④ 绘制发光钟摆悬丝与钟摆球本体
    const ox = pivotX + Math.cos(angleRad) * radius;
    const oy = pivotY + Math.sin(angleRad) * radius;
    fb.drawLine(pivotX, pivotY, ox, oy, 1.5, [col[0], col[1], col[2], 32 + Math.round(trackFlash * 85)]);

    const orbR = 17 + trackFlash * 6;
    fb.drawGlowCircle(ox, oy, 48 + trackFlash * 38, [col[0], col[1], col[2], Math.round(135 + trackFlash * 95)]);
    fb.fillCircle(ox, oy, orbR, [col[0], col[1], col[2], 255]);
    fb.strokeRing(ox, oy, orbR, 2.5, [255, 255, 255, 240]);
    fb.fillCircle(ox, oy, orbR * 0.46, [255, 255, 255, 250]);
  }
}

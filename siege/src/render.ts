// siege 帧渲染器（真正的狭窄漏斗口场景 + 普通机枪兵一碰即碎 + 单直线前排严格阻挡射击 + 1080x1920 竖屏成片）
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync } from "node:fs";
import {
  ARENA_W,
  ARENA_H,
  CORRIDOR_CX,
  getCorridorHalfWidth,
  type SiegeMapId,
} from "./config.ts";
import {
  SiegeSimulator,
  SIM_HZ,
  type SiegeAudioEvent,
} from "./sim.ts";
import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { writeWav } from "../../shared/audio/sfx.ts";

const PROJ_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const TICKS_PER_FRAME = Math.round(SIM_HZ / FPS);

const BOARD_X = Math.floor((OUT_W - ARENA_W) / 2); // 48
const BOARD_Y = 212;

export interface SiegeRenderOptions {
  mapId?: SiegeMapId;
  seed: number;
  durationSec?: number;
  outMp4: string;
  hookTitle?: string;
}

export interface SiegeRenderStats {
  durationSec: number;
  kills: number;
  bossesKilled: number;
  totalBosses: number;
  aliveGreens: number;
  totalGreens: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 构建真正的「上方宽阔聚怪大漏斗 -> 中间 136px 极窄峡谷咽喉口 -> 下方绝境死守战壕」静态场景底图
 */
function buildStaticBackground(): Uint8ClampedArray {
  const fb = new FrameBuf(OUT_W, OUT_H, [8, 10, 15, 255]);
  const raw = fb.data;

  // 逐扫描线绘制厚重装甲峡谷墙体与狭窄漏斗通道地面
  for (let ay = 0; ay < ARENA_H; ay++) {
    const wy = BOARD_Y + ay;
    if (wy < 0 || wy >= OUT_H) continue;

    const halfW = getCorridorHalfWidth(ay);
    const leftEdge = CORRIDOR_CX - halfW;
    const rightEdge = CORRIDOR_CX + halfW;
    const isBottomWall = ay >= 1468;

    for (let ax = 0; ax < ARENA_W; ax++) {
      const wx = BOARD_X + ax;
      const idx = (wy * OUT_W + wx) * 4;

      const distToLeft = ax - leftEdge;
      const distToRight = rightEdge - ax;
      const minEdgeDist = isBottomWall ? ay - 1468 : Math.min(distToLeft, distToRight);

      if (!isBottomWall && distToLeft >= 0 && distToRight >= 0) {
        // 通道内部地面（狭窄口子 y=580..1150 区域加深战术底色并带纵向导流槽纹）
        const inNarrowThroat = ay >= 580 && ay <= 1150;
        let r = inNarrowThroat ? 13 : 16;
        let g = inNarrowThroat ? 17 : 20;
        let b = inNarrowThroat ? 25 : 29;

        // 墙根内侧 16px 环境光遮蔽暗影，强化狭窄口子的深邃立体感
        if (minEdgeDist < 16) {
          const ao = (16 - minEdgeDist) / 16;
          r = Math.round(r * (1 - ao * 0.45));
          g = Math.round(g * (1 - ao * 0.45));
          b = Math.round(b * (1 - ao * 0.45));
        }

        // 地面 32px 战术网格线
        if (ax % 32 === 0 || ay % 32 === 0) {
          r += 4;
          g += 5;
          b += 7;
        }

        // 狭窄口子内部纵向防滑导流纹理与横向防线距离刻度线
        if (inNarrowThroat) {
          if (Math.abs(ax - CORRIDOR_CX) === 28 && (ay % 16 < 10)) {
            r += 6;
            g += 8;
            b += 12;
          }
          if (ay % 140 === 0 && minEdgeDist > 12) {
            r += 14;
            g += 16;
            b += 20;
          }
        }

        raw[idx] = r;
        raw[idx + 1] = g;
        raw[idx + 2] = b;
        raw[idx + 3] = 255;
      } else {
        // 通道外侧实心厚重岩石/合金要塞墙体
        const wallDepth = isBottomWall
          ? ay - 1468
          : distToLeft < 0
            ? -distToLeft
            : -distToRight;

        if (wallDepth <= 3.5) {
          // 墙体内缘高光金属切边
          raw[idx] = 110;
          raw[idx + 1] = 128;
          raw[idx + 2] = 158;
          raw[idx + 3] = 255;
        } else if (wallDepth <= 15) {
          // 15px 宽的 3D 倒角装甲护壁（在狭窄口子入口 y=555..615 处绘制黄黑警示斜纹）
          const isPinchZone = ay >= 555 && ay <= 615;
          const stripe = ((ax + ay) >> 4) & 1;
          if (isPinchZone && stripe === 0) {
            raw[idx] = 215;
            raw[idx + 1] = 162;
            raw[idx + 2] = 28;
          } else {
            raw[idx] = 48;
            raw[idx + 1] = 58;
            raw[idx + 2] = 76;
          }
          raw[idx + 3] = 255;
        } else {
          // 实心要塞深色装甲墙体 + 横向加固肋板细节
          let wr = 20;
          let wg = 24;
          let wb = 34;

          const ribY = ay % 76;
          if (ribY < 10) {
            wr = 28;
            wg = 34;
            wb = 46;
          } else if (ribY === 10) {
            wr = 12;
            wg = 15;
            wb = 22;
          }

          if (((ax + ay) % 48) < 2) {
            wr += 3;
            wg += 4;
            wb += 5;
          }

          raw[idx] = wr;
          raw[idx + 1] = wg;
          raw[idx + 2] = wb;
          raw[idx + 3] = 255;
        }
      }
    }
  }

  // 中轴虚线（贯穿漏斗与狭窄口子）
  for (let y = 36; y < 1455; y += 36) {
    fb.fillRect(BOARD_X + CORRIDOR_CX - 1, BOARD_Y + y, 2, 18, [34, 43, 60, 160]);
  }

  // 底部绝境死守区地面警示框线 (y = 1250..1455)
  fb.strokeRoundRect(
    BOARD_X + CORRIDOR_CX - 132,
    BOARD_Y + 1255,
    264,
    196,
    6,
    2,
    [70, 36, 46, 130],
  );

  // 战场外框线
  fb.strokeRoundRect(BOARD_X - 2, BOARD_Y - 2, ARENA_W + 4, ARENA_H + 4, 4, 2, [58, 70, 94, 220]);

  return new Uint8ClampedArray(fb.data);
}

/**
 * 将持久化血迹与碎石刻入静态底图
 */
function bakeDecalsIntoBackground(bgRaw: Uint8ClampedArray, sim: SiegeSimulator): void {
  if (sim.pendingDecals.length === 0) return;
  const fb = new FrameBuf(OUT_W, OUT_H);
  fb.data.set(bgRaw);

  for (const d of sim.pendingDecals) {
    const cx = BOARD_X + d.x;
    const cy = BOARD_Y + d.y;
    if (d.kind === "blood") {
      fb.blendCircle(cx, cy, d.r, [72, 12, 22, 110]);
      fb.blendCircle(cx + 3, cy - 2, d.r * 0.55, [96, 16, 28, 125]);
    } else if (d.kind === "boss_blood") {
      fb.blendCircle(cx, cy, d.r, [95, 12, 26, 155]);
      fb.blendCircle(cx - 5, cy + 4, d.r * 0.65, [130, 18, 34, 165]);
    } else if (d.kind === "rubble") {
      fb.blendCircle(cx, cy, d.r * 0.7, [36, 42, 54, 150]);
    }
  }

  sim.pendingDecals.length = 0;
  bgRaw.set(fb.data);
}

/**
 * 合成重机枪连续射击、换弹、破障与 Boss 音效
 */
function buildSiegeAudioTrack(events: SiegeAudioEvent[], durationSec: number): Float32Array {
  const sr = 44100;
  const totalSamples = Math.ceil(durationSec * sr);
  const samples = new Float32Array(totalSamples);

  let rngState = 1337;
  const rand = (): number => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296 - 0.5;
  };

  for (const ev of events) {
    const startIdx = Math.floor(ev.timeSec * sr);
    if (startIdx < 0 || startIdx >= totalSamples) continue;

    if (ev.kind === "mg" || ev.kind === "heavy-mg") {
      const dur = ev.kind === "heavy-mg" ? 0.052 : 0.042;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      const baseFreq = (ev.kind === "heavy-mg" ? 130 : 155) * ev.pitch;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 68);
        const thump = Math.sin(2 * Math.PI * baseFreq * t);
        const crack = rand() * 1.45 * Math.exp(-t * 115);
        samples[startIdx + i] += (thump * 0.62 + crack * 0.78) * env * ev.gain;
      }
    } else if (ev.kind === "reload") {
      const len = Math.min(Math.floor(0.28 * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const click =
          t < 0.05 || (t > 0.16 && t < 0.22)
            ? Math.sin(2 * Math.PI * 880 * t) * Math.exp(-((t % 0.16) * 60))
            : 0;
        samples[startIdx + i] += click * 0.45 * ev.gain;
      }
    } else if (ev.kind === "breach" || ev.kind === "boss-kill") {
      const dur = ev.kind === "boss-kill" ? 0.46 : 0.34;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 9.5);
        const boom = Math.sin(2 * Math.PI * (78 - t * 42) * t);
        const noise = rand() * 0.9;
        samples[startIdx + i] += (boom * 0.68 + noise * 0.42) * env * ev.gain * 0.65;
      }
    } else if (ev.kind === "boss-spawn" || ev.kind === "adrenaline") {
      const dur = 0.42;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      const f0 = ev.kind === "adrenaline" ? 220 : 95;
      const f1 = ev.kind === "adrenaline" ? 520 : 62;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 6.5);
        const freq = f0 + ((f1 - f0) * t) / dur;
        samples[startIdx + i] += Math.sin(2 * Math.PI * freq * t) * env * ev.gain * 0.5;
      }
    }
  }

  for (let i = 0; i < totalSamples; i++) {
    samples[i] = clamp(samples[i], -0.92, 0.92);
  }
  return samples;
}

export async function renderSiegeVideo(opts: SiegeRenderOptions): Promise<SiegeRenderStats> {
  const mapId = opts.mapId ?? "canyon-bridge";
  const sim = new SiegeSimulator(opts.seed, mapId, opts.durationSec);
  const atlas = new FontAtlas(
    join(PROJ_ROOT, "shared/fonts/atlas64.rgba"),
    join(PROJ_ROOT, "shared/fonts/atlas64.json"),
  );

  const allTicks = sim.maxTicks;
  const maxFrames = Math.ceil(allTicks / TICKS_PER_FRAME);
  let totalFrames = 0;

  while (!sim.isFinished && totalFrames < maxFrames) {
    for (let s = 0; s < TICKS_PER_FRAME; s++) {
      sim.stepTick();
      if (sim.isFinished) break;
    }
    totalFrames++;
  }

  const actualDurationSec = Number((totalFrames / FPS).toFixed(2));
  const tmpWav = join(tmpdir(), `siege_audio_${opts.seed}_${Date.now()}.wav`);
  const audioSamples = buildSiegeAudioTrack(sim.audioEvents, actualDurationSec);
  writeWav(audioSamples, tmpWav);

  // 重新运行一遍完全相同种子的模拟并流式生成视频帧
  const simRender = new SiegeSimulator(opts.seed, mapId, opts.durationSec);
  const bgRenderRaw = buildStaticBackground();
  const fb = new FrameBuf(OUT_W, OUT_H);
  const hookTitle = opts.hookTitle ?? simRender.map.hookTitle;

  function* frameGenerator(): IterableIterator<FrameBuf> {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      for (let s = 0; s < TICKS_PER_FRAME; s++) {
        simRender.stepTick();
        if (simRender.isFinished) break;
      }

      bakeDecalsIntoBackground(bgRenderRaw, simRender);
      fb.data.set(bgRenderRaw);

      const ox = BOARD_X;
      const oy = BOARD_Y;
      const hero = simRender.greens[0];

      // 1. 绘制狭窄口子入口路障 (gate-1)
      for (const b of simRender.barricades) {
        if (b.broken) {
          for (let sx = b.x + 8; sx < b.x + b.w - 8; sx += 24) {
            fb.fillRect(ox + sx, oy + b.y + 4, 12, 12, [44, 52, 66, 175]);
          }
          continue;
        }
        const flash = b.hitFlash;
        const baseColor: RGBA = flash > 0.25 ? [255, 225, 150, 255] : [205, 148, 38, 245];
        fb.fillRect(ox + b.x, oy + b.y, b.w, b.h, baseColor);
        fb.strokeRoundRect(ox + b.x, oy + b.y, b.w, b.h, 2, 2, [255, 215, 90, 240]);
      }

      // 2. 绘制冲击波环
      for (const r of simRender.rings) {
        const p = 1 - r.ttl / r.maxTtl;
        const rad = 12 + p * r.maxR;
        const alpha = Math.round((1 - p) * 195);
        const col: RGBA =
          r.kind === "adrenaline"
            ? [255, 215, 70, alpha]
            : r.kind === "boss-kill"
              ? [255, 90, 60, alpha]
              : [255, 165, 60, alpha];
        fb.strokeRing(ox + r.x, oy + r.y, rad, 3, col);
      }

      // 3. 绘制普通丧尸红点（在漏斗口与狭窄通道中摩肩接踵挤压推进）
      for (let i = 0; i < simRender.reds.length; i++) {
        const r = simRender.reds[i];
        if (r.kind === "boss") continue;
        const rx = ox + r.x;
        const ry = oy + r.y;

        fb.fillCircle(rx, ry, r.r + 1.2, [28, 6, 12, 230]);
        const bodyCol: RGBA =
          r.hitFlash > 0.35
            ? [255, 235, 210, 255]
            : r.kind === "runner"
              ? [248, 52, 68, 255]
              : [215, 28, 48, 255];
        fb.fillCircle(rx, ry, r.r, bodyCol);
        fb.fillCircle(rx - r.r * 0.28, ry - r.r * 0.28, r.r * 0.36, [255, 125, 135, 210]);
      }

      // 4. 绘制巨型变异泰坦 Boss（顶在窄口前排充当巨型肉盾，挡住后方百尸）
      for (let i = 0; i < simRender.reds.length; i++) {
        const r = simRender.reds[i];
        if (r.kind !== "boss") continue;
        const rx = ox + r.x;
        const ry = oy + r.y;
        const isFinal = Boolean(r.isFinalBoss);

        const faceAng = hero
          ? Math.atan2(hero.y - r.y, hero.x - r.x)
          : Math.PI * 0.5;

        // 底部深红气场
        fb.drawGlowCircle(
          rx,
          ry,
          r.r * 1.4,
          isFinal ? [210, 20, 50, 90] : [180, 24, 42, 70],
        );

        // 周圈变异骨刺
        const isHitPulse = r.hitFlash > 0.55 && frameIdx % 2 === 0;
        const spikeCount = isFinal ? 8 : 6;
        for (let s = 0; s < spikeCount; s++) {
          const sAng = faceAng + (s * Math.PI * 2) / spikeCount;
          const sx0 = rx + Math.cos(sAng) * (r.r * 0.72);
          const sy0 = ry + Math.sin(sAng) * (r.r * 0.72);
          const sx1 = rx + Math.cos(sAng) * (r.r + (isFinal ? 6.5 : 5.0));
          const sy1 = ry + Math.sin(sAng) * (r.r + (isFinal ? 6.5 : 5.0));
          fb.drawLine(
            sx0,
            sy0,
            sx1,
            sy1,
            isFinal ? 5.0 : 4.2,
            isHitPulse ? [255, 150, 120, 255] : [125, 16, 32, 250],
          );
        }

        // 前探重爪
        for (const side of [-1, 1]) {
          const armAng = faceAng + side * 0.48;
          const ax0 = rx + Math.cos(armAng) * (r.r * 0.75);
          const ay0 = ry + Math.sin(armAng) * (r.r * 0.75);
          const ax1 = rx + Math.cos(armAng - side * 0.18) * (r.r + 8.5);
          const ay1 = ry + Math.sin(armAng - side * 0.18) * (r.r + 8.5);
          fb.drawLine(ax0, ay0, ax1, ay1, 5.5, [165, 22, 42, 255]);
          fb.fillCircle(ax1, ay1, 3.2, [255, 95, 95, 255]);
        }

        // 泰坦重甲躯干
        fb.fillCircle(rx, ry, r.r + 2.2, [32, 6, 14, 255]);
        const outerArmor: RGBA = isHitPulse
          ? [225, 58, 68, 255]
          : isFinal
            ? [145, 12, 36, 255]
            : [168, 20, 40, 255];
        fb.fillCircle(rx, ry, r.r, outerArmor);

        const innerCore: RGBA = isHitPulse
          ? [255, 115, 95, 255]
          : isFinal
            ? [225, 28, 62, 255]
            : [218, 38, 58, 255];
        fb.fillCircle(rx, ry, r.r * 0.72, innerCore);

        fb.fillCircle(
          rx - Math.cos(faceAng) * (r.r * 0.14),
          ry - Math.sin(faceAng) * (r.r * 0.14),
          r.r * 0.36,
          isFinal ? [88, 8, 22, 240] : [110, 12, 28, 230],
        );

        // 泰坦双目凶光
        const eyeDist = r.r * 0.42;
        for (const side of [-1, 1]) {
          const eAng = faceAng + side * 0.34;
          const ex = rx + Math.cos(eAng) * eyeDist;
          const ey = ry + Math.sin(eAng) * eyeDist;
          fb.fillCircle(ex, ey, isFinal ? 3.6 : 3.0, [255, 240, 95, 255]);
        }

        // 头顶紧凑高对比度血条（带白色掉血残影 ghostFrac）
        const barW = isFinal ? 74 : 58;
        const barH = isFinal ? 7 : 6;
        const barX = rx - barW * 0.5;
        const barY = ry - r.r - 15;
        const hpFrac = clamp(r.hp / r.maxHp, 0, 1);
        const ghostFrac = clamp(r.ghostHp / r.maxHp, hpFrac, 1);

        fb.drawBar(barX, barY, barW, barH, hpFrac, {
          radius: 3,
          bgColor: [14, 16, 24, 230],
          borderColor: isFinal ? [255, 200, 75, 230] : [220, 75, 90, 210],
          fgStart: isFinal ? [255, 45, 85, 255] : [255, 65, 65, 255],
          fgEnd: isFinal ? [255, 155, 45, 255] : [225, 30, 50, 255],
          ghostFrac,
          ghostColor: [255, 255, 255, 235],
        });

        if (r.name) {
          atlas.drawStyled(
            fb,
            r.name,
            rx,
            barY - 19,
            isFinal ? [255, 225, 110, 255] : [255, 195, 200, 245],
            isFinal ? 0.30 : 0.26,
            "center",
            { outlineWidth: 2.5, outlineColor: [8, 10, 16, 245] },
          );
        }
      }

      // 5. 绘制黄铜抛壳与受击火花/血雾粒子
      for (const sh of simRender.shells) {
        const alpha = clamp(Math.round((sh.ttl / sh.maxTtl) * 240), 0, 240);
        const sx0 = ox + sh.x - Math.cos(sh.angle) * 2.8;
        const sy0 = oy + sh.y - Math.sin(sh.angle) * 2.8;
        const sx1 = ox + sh.x + Math.cos(sh.angle) * 2.8;
        const sy1 = oy + sh.y + Math.sin(sh.angle) * 2.8;
        fb.drawLine(sx0, sy0, sx1, sy1, 2.2, [255, 208, 72, alpha]);
      }

      for (const sp of simRender.sparks) {
        const alpha = clamp(Math.round((sp.ttl / sp.maxTtl) * 245), 0, 245);
        const sx = ox + sp.x;
        const sy = oy + sp.y;
        if (sp.kind === "blood") {
          fb.fillCircle(sx, sy, 2.8, [225, 24, 42, alpha]);
        } else {
          fb.drawLine(sx, sy, sx - sp.vx * 1.6, sy - sp.vy * 1.6, 2.2, [255, 238, 130, alpha]);
        }
      }

      // 6. 绘制「一条直线打过去、前排没打掉绝不打后排」的笔直机枪火线！
      const line = simRender.firingLine;
      if (line) {
        const lx1 = ox + line.x1;
        const ly1 = oy + line.y1;
        const lx2 = ox + line.x2;
        const ly2 = oy + line.y2;

        // 外层暖光晕直线
        fb.drawLine(
          lx1,
          ly1,
          lx2,
          ly2,
          line.adrenaline ? 7.0 : 5.2,
          line.adrenaline ? [255, 195, 50, 95] : [255, 175, 45, 78],
        );
        // 中层明黄笔直弹道线
        fb.drawLine(
          lx1,
          ly1,
          lx2,
          ly2,
          line.adrenaline ? 3.6 : 2.8,
          [255, 232, 115, 235],
        );
        // 内核纯白高亮笔直中心线
        fb.drawLine(
          lx1,
          ly1,
          lx2,
          ly2,
          1.5,
          [255, 255, 240, 255],
        );

        // 直线终点（最前排受击目标前表面）迸发耀眼受击火光，直观体现子弹被前排结结实实挡住！
        fb.drawGlowCircle(lx2, ly2, line.hitKind === "boss" ? 13 : 9, [255, 200, 75, 185]);
        fb.fillCircle(lx2, ly2, line.hitKind === "boss" ? 4.8 : 3.6, [255, 255, 235, 255]);
      }

      // 7. 绘制一碰即碎的普通机枪兵（单管重机枪 + 贴脸生死预警圈 + 换弹进度条）
      if (hero && hero.alive) {
        const gx = ox + hero.x;
        const gy = oy + hero.y;
        const ang = hero.aimAngle;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const px = -uy;
        const py = ux;

        // 当敌人逼近至 68px 内时，机枪兵脚下亮起红色生死距离预警环（提示一碰即碎！）
        if (simRender.closestThreatDist < 68) {
          const dangerAlpha = clamp(Math.round((1 - simRender.closestThreatDist / 68) * 210), 45, 220);
          fb.strokeRing(gx, gy, hero.r + 11, 2.5, [255, 55, 65, dangerAlpha]);
        }

        // 底部战术光圈
        fb.drawGlowCircle(
          gx,
          gy,
          hero.r * 1.6,
          simRender.overdriveActive ? [255, 210, 65, 95] : [40, 235, 145, 75],
        );

        // 单管重机枪枪身与枪口制退器（往复后坐力震动）
        const recoil = hero.recoilOffset;
        const gunStart = hero.r * 0.25 - recoil;
        const gunEnd = hero.r + 14 - recoil;
        fb.drawLine(
          gx + ux * gunStart,
          gy + uy * gunStart,
          gx + ux * gunEnd,
          gy + uy * gunEnd,
          5.2,
          [52, 62, 78, 255],
        );
        fb.drawLine(
          gx + ux * (gunStart + 2),
          gy + uy * (gunStart + 2),
          gx + ux * (gunEnd - 1),
          gy + uy * (gunEnd - 1),
          2.4,
          [155, 175, 200, 255],
        );

        // 枪口喷焰
        if (hero.muzzleFlash > 0.1 && hero.reloadTicks === 0) {
          const mx = gx + ux * (gunEnd + 2);
          const my = gy + uy * (gunEnd + 2);
          fb.drawGlowCircle(mx + ux * 6, my + uy * 6, 11, [255, 195, 55, 165]);
          fb.drawLine(mx, my, mx + ux * 15, my + uy * 15, 3.6, [255, 250, 210, 250]);
        }

        // 机枪兵双肩与绿色战术头盔
        for (const side of [-1, 1]) {
          fb.fillCircle(
            gx + px * side * (hero.r * 0.68),
            gy + py * side * (hero.r * 0.68),
            6.0,
            [24, 140, 82, 255],
          );
        }
        fb.fillCircle(gx, gy, hero.r + 1.5, [12, 28, 20, 255]);
        fb.fillCircle(gx, gy, hero.r, [38, 215, 122, 255]);
        fb.fillCircle(gx - ux * 2, gy - uy * 2, hero.r * 0.65, [95, 250, 168, 255]);

        // 战术护目镜
        const visorX = gx + ux * (hero.r * 0.46);
        const visorY = gy + uy * (hero.r * 0.46);
        fb.drawLine(
          visorX - px * 5.0,
          visorY - py * 5.0,
          visorX + px * 5.0,
          visorY + py * 5.0,
          3.2,
          simRender.overdriveActive ? [255, 240, 110, 255] : [210, 255, 255, 255],
        );

        // 换弹时脚下显示醒目的橙色换弹读条与「换弹中」字样
        if (hero.reloadTicks > 0) {
          const reloadFrac = 1 - hero.reloadTicks / hero.maxReloadTicks;
          const gBarW = 46;
          const gBarX = gx - gBarW * 0.5;
          const gBarY = gy + hero.r + 9;
          fb.drawBar(gBarX, gBarY, gBarW, 5, reloadFrac, {
            radius: 2,
            bgColor: [16, 18, 26, 230],
            borderColor: [255, 165, 50, 220],
            fgStart: [255, 140, 35, 255],
            fgEnd: [255, 215, 70, 255],
          });
          atlas.drawStyled(
            fb,
            "换弹中",
            gx,
            gBarY + 18,
            [255, 195, 80, 250],
            0.24,
            "center",
            { outlineWidth: 2, outlineColor: [8, 10, 16, 245] },
          );
        }
      }

      // 8. 换弹/贴脸危机红框呼吸脉冲
      if (simRender.alarmFlash > 0.05) {
        const a = clamp(Math.round(simRender.alarmFlash * 105), 0, 120);
        fb.strokeRoundRect(ox, oy, ARENA_W, ARENA_H, 4, 5, [255, 42, 58, a]);
      }

      // 9. 顶部精简高对比度 HUD
      atlas.drawStyled(
        fb,
        hookTitle,
        OUT_W * 0.5,
        54,
        [245, 248, 255, 255],
        0.42,
        "center",
        { outlineWidth: 3, outlineColor: [8, 10, 18, 240] },
      );

      const barX = BOARD_X;
      const barY = 98;
      const barW = ARENA_W;
      const barH = 22;
      const totalReds = Math.max(1, simRender.kills + simRender.reds.length);
      const clearRatio = clamp(simRender.kills / totalReds, 0.08, 1);

      fb.blendRoundRect(barX, barY, barW, barH, 11, [22, 26, 36, 240]);
      fb.blendRoundRect(barX, barY, barW, barH, 11, [215, 38, 58, 225]);
      const greenW = Math.round(barW * clearRatio);
      const barCol: RGBA = simRender.overdriveActive
        ? [255, 195, 45, 255]
        : [42, 225, 132, 255];
      fb.blendRoundRect(barX, barY, greenW, barH, 11, barCol);
      fb.fillRect(barX + greenW - 2, barY - 4, 4, barH + 8, [255, 255, 255, 255]);
      fb.strokeRoundRect(barX, barY, barW, barH, 11, 2, [85, 98, 128, 200]);

      const isDanger = Boolean((hero && hero.reloadTicks > 0) || simRender.closestThreatDist < 55);
      const statusText =
        hero && hero.reloadTicks > 0
          ? "机枪兵 · 换弹危机！"
          : isDanger
            ? "机枪兵 · 近身险境！"
            : "机枪兵 (一碰即碎)";
      const statusCol: RGBA = isDanger ? [255, 95, 95, 255] : [80, 245, 155, 255];

      fb.fillCircle(barX + 12, 156, 7, statusCol);
      atlas.drawStyled(
        fb,
        statusText,
        barX + 28,
        160,
        statusCol,
        0.35,
        "left",
        { outlineWidth: 2.5, outlineColor: [8, 10, 16, 240] },
      );

      atlas.drawStyled(
        fb,
        `泰坦击杀 ${simRender.bossesKilled}/${simRender.totalBosses}`,
        OUT_W * 0.5,
        162,
        [255, 215, 75, 255],
        0.46,
        "center",
        { outlineWidth: 3, outlineColor: [8, 10, 16, 245] },
      );

      fb.fillCircle(barX + barW - 12, 156, 7, [245, 52, 72, 255]);
      atlas.drawStyled(
        fb,
        `歼灭 ${simRender.kills}`,
        barX + barW - 28,
        160,
        [255, 110, 125, 255],
        0.35,
        "right",
        { outlineWidth: 2.5, outlineColor: [8, 10, 16, 240] },
      );

      // 10. 底部实时战况字幕
      const bottomText = simRender.callout ? simRender.callout.text : simRender.map.subtitle;
      const bottomCol: RGBA =
        simRender.callout?.kind === "crisis"
          ? [255, 115, 115, 255]
          : simRender.callout?.kind === "overdrive"
            ? [255, 220, 85, 255]
            : simRender.callout?.kind === "victory"
              ? [90, 255, 165, 255]
              : [210, 222, 245, 245];

      atlas.drawStyled(
        fb,
        bottomText,
        OUT_W * 0.5,
        BOARD_Y + ARENA_H + 74,
        bottomCol,
        0.38,
        "center",
        { outlineWidth: 3, outlineColor: [8, 10, 16, 245] },
      );

      yield fb;
    }
  }

  await encodeFrames(frameGenerator(), {
    width: OUT_W,
    height: OUT_H,
    fps: FPS,
    outPath: opts.outMp4,
    audioPath: tmpWav,
  });

  try {
    unlinkSync(tmpWav);
  } catch {
    // ignore cleanup error
  }

  return {
    durationSec: actualDurationSec,
    kills: simRender.kills,
    bossesKilled: simRender.bossesKilled,
    totalBosses: simRender.totalBosses,
    aliveGreens: simRender.greens.filter(g => g.alive).length,
    totalGreens: simRender.greens.length,
  };
}

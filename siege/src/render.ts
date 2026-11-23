// siege 帧渲染器（高精度机械要塞线条 + 笔直弹道脉冲/枪口制退焰/受击裂片细节 + 棱镜晶石/钢筋囚笼/生物母巢精细刻画 + 1080x1920 竖屏成片）
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ARENA_W,
  ARENA_H,
  WORLD_W,
  WORLD_H,
  CORRIDOR_CX,
  SIEGE_MODE_META,
  getArchZones,
  getInteriorProps,
  getDoorways,
  getDeadCornerWalls,
  getCorridorBounds,
  getOuterWallSegments,
  type InteriorPropSpec,
  type DoorwaySpec,
  type SiegeMapId,
  type SiegeModeId,
} from "./config.ts";
import {
  SiegeSimulator,
  SIM_HZ,
  NAV_COLS,
  NAV_ROWS,
  NAV_CELL,
  type DestructiblePropState,
  type SiegeAudioEvent,
} from "./sim.ts";
import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";

const PROJ_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const TICKS_PER_FRAME = Math.round(SIM_HZ / FPS);

const BOARD_X = Math.floor((OUT_W - ARENA_W) / 2); // 48
const BOARD_Y = 212;

export interface SiegeRenderOptions {
  mapId?: SiegeMapId;
  modeId?: SiegeModeId;
  seed: number;
  durationSec?: number;
  outMp4: string;
  hookTitle?: string;
  bgmPath?: string;
}

export interface SiegeRenderStats {
  durationSec: number;
  modeId: SiegeModeId;
  kills: number;
  bossesKilled: number;
  totalBosses: number;
  aliveGreens: number;
  rescuedCount: number;
  casualties: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 绘制多边形顶点连线（用于八角装甲底座、棱镜晶石切面、六角机械结构等高精度线条细节）
 */
function drawPolygonLines(
  fb: FrameBuf,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotRad: number,
  thickness: number,
  col: RGBA,
  connectToCenter = false,
  centerCol?: RGBA,
): void {
  let prevX = cx + Math.cos(rotRad) * r;
  let prevY = cy + Math.sin(rotRad) * r;
  for (let i = 1; i <= sides; i++) {
    const ang = rotRad + (i * Math.PI * 2) / sides;
    const nx = cx + Math.cos(ang) * r;
    const ny = cy + Math.sin(ang) * r;
    fb.drawLine(prevX, prevY, nx, ny, thickness, col);
    if (connectToCenter) {
      fb.drawLine(cx, cy, nx, ny, Math.max(1.0, thickness * 0.65), centerCol ?? col);
    }
    prevX = nx;
    prevY = ny;
  }
}

/**
 * 绘制四角战术瞄准框线 `[ ]`（用于强化牢笼、晶石、战区防线节点的精密 UI/工业线条感）
 */
function drawCornerBrackets(
  fb: FrameBuf,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  armLen: number,
  thickness: number,
  col: RGBA,
): void {
  const x0 = cx - halfW;
  const x1 = cx + halfW;
  const y0 = cy - halfH;
  const y1 = cy + halfH;
  // 左上
  fb.drawLine(x0, y0, x0 + armLen, y0, thickness, col);
  fb.drawLine(x0, y0, x0, y0 + armLen, thickness, col);
  // 右上
  fb.drawLine(x1, y0, x1 - armLen, y0, thickness, col);
  fb.drawLine(x1, y0, x1, y0 + armLen, thickness, col);
  // 左下
  fb.drawLine(x0, y1, x0 + armLen, y1, thickness, col);
  fb.drawLine(x0, y1, x0, y1 - armLen, thickness, col);
  // 右下
  fb.drawLine(x1, y1, x1 - armLen, y1, thickness, col);
  fb.drawLine(x1, y1, x1, y1 - armLen, thickness, col);
}

/**
 * 绘制平滑环形进度弧线 (0..1 -> 0°..360° 顺时针填充，用于商铺幸存者路障破拆与补给仓解锁进度展示)
 */
function drawRadialProgressArc(
  fb: FrameBuf,
  cx: number,
  cy: number,
  r: number,
  frac: number,
  thickness: number,
  col: RGBA,
): void {
  const clamped = clamp(frac, 0, 1);
  if (clamped <= 0.005) return;
  const segs = Math.max(4, Math.ceil(clamped * 48));
  const startAng = -Math.PI * 0.5;
  const totalAng = clamped * Math.PI * 2;
  let prevX = cx + Math.cos(startAng) * r;
  let prevY = cy + Math.sin(startAng) * r;
  for (let s = 1; s <= segs; s++) {
    const ang = startAng + (s / segs) * totalAng;
    const nx = cx + Math.cos(ang) * r;
    const ny = cy + Math.sin(ang) * r;
    fb.drawLine(prevX, prevY, nx, ny, thickness, col);
    prevX = nx;
    prevY = ny;
  }
}

/**
 * 纯几何矢量绘制国际通用【三叶生物危害标志 ☣ (Biohazard Emblem)】（零文字直观传达“感染尸变”！）
 */
function drawBiohazardSymbol(
  fb: FrameBuf,
  cx: number,
  cy: number,
  rad: number,
  rotRad: number,
  col: RGBA,
): void {
  fb.strokeRing(cx, cy, rad * 0.24, 1.8, col);
  for (let k = 0; k < 3; k++) {
    const ang = rotRad + (k * Math.PI * 2) / 3;
    const ox = cx + Math.cos(ang) * (rad * 0.54);
    const oy = cy + Math.sin(ang) * (rad * 0.54);
    fb.strokeRing(ox, oy, rad * 0.44, 2.2, col);
    // 三叶外尖刺短线
    fb.drawLine(
      cx + Math.cos(ang) * (rad * 0.85),
      cy + Math.sin(ang) * (rad * 0.85),
      cx + Math.cos(ang) * (rad * 1.12),
      cy + Math.sin(ang) * (rad * 1.12),
      2.0,
      col,
    );
  }
}

/**
 * 构建支持任意平滑变焦倍率 (zoom = 1.0..2.15) 的世界空间矢量代理画布：
 * - 所有世界坐标 (BOARD_X + wx - camX, BOARD_Y + wy - camY) 自动按 zoom 映射到 1080p 屏幕像素，保持 100% 原生 SDF 抗锯齿锐度！
 */
function createZoomedFrameBuf(base: FrameBuf, zoom: number): FrameBuf {
  if (Math.abs(zoom - 1.0) < 0.002) return base;
  const zx = (x: number) => BOARD_X + (x - BOARD_X) * zoom;
  const zy = (y: number) => BOARD_Y + (y - BOARD_Y) * zoom;
  const zs = (s: number) => s * zoom;
  const proxy = {
    w: base.w,
    h: base.h,
    data: base.data,
    fillRect(x: number, y: number, w: number, h: number, c: RGBA) {
      base.fillRect(zx(x), zy(y), zs(w), zs(h), c);
    },
    blendRect(x: number, y: number, w: number, h: number, c: RGBA) {
      base.blendRect(zx(x), zy(y), zs(w), zs(h), c);
    },
    blendGradientRect(
      x: number,
      y: number,
      w: number,
      h: number,
      cStart: RGBA,
      cEnd: RGBA,
      vertical = true,
    ) {
      base.blendGradientRect(zx(x), zy(y), zs(w), zs(h), cStart, cEnd, vertical);
    },
    fillRoundRect(x: number, y: number, w: number, h: number, radius: number, c: RGBA) {
      base.fillRoundRect(zx(x), zy(y), zs(w), zs(h), zs(radius), c);
    },
    blendRoundRect(x: number, y: number, w: number, h: number, radius: number, c: RGBA) {
      base.blendRoundRect(zx(x), zy(y), zs(w), zs(h), zs(radius), c);
    },
    strokeRoundRect(
      x: number,
      y: number,
      w: number,
      h: number,
      radius: number,
      borderW: number,
      c: RGBA,
    ) {
      base.strokeRoundRect(zx(x), zy(y), zs(w), zs(h), zs(radius), zs(borderW), c);
    },
    fillCircle(cx: number, cy: number, r: number, c: RGBA) {
      base.fillCircle(zx(cx), zy(cy), zs(r), c);
    },
    blendCircle(cx: number, cy: number, r: number, c: RGBA) {
      base.blendCircle(zx(cx), zy(cy), zs(r), c);
    },
    strokeRing(cx: number, cy: number, r: number, w: number, c: RGBA) {
      base.strokeRing(zx(cx), zy(cy), zs(r), zs(w), c);
    },
    drawGlowCircle(cx: number, cy: number, r: number, c: RGBA) {
      base.drawGlowCircle(zx(cx), zy(cy), zs(r), c);
    },
    drawLine(x1: number, y1: number, x2: number, y2: number, w: number, c: RGBA) {
      base.drawLine(zx(x1), zy(y1), zx(x2), zy(y2), zs(w), c);
    },
    drawBar(x: number, y: number, w: number, h: number, frac: number, style: Parameters<FrameBuf["drawBar"]>[5]) {
      base.drawBar(zx(x), zy(y), zs(w), zs(h), frac, {
        ...style,
        radius: style.radius ? zs(style.radius) : undefined,
      });
    },
  };
  return proxy as unknown as FrameBuf;
}

/**
 * 绘制重型压迫感【战术入场载具（八轮重装破障军用大巴 / 双发重装黑鹰武装直升机）】
 * 配合开场 2.08x 镜头特写放大，在屏幕上呈现近 400px 翼展/车长的钢铁巨兽视觉冲击！
 */
function renderInsertionVehicles(
  fb: FrameBuf,
  sim: SiegeSimulator,
  _atlas: FontAtlas,
  ox: number,
  oy: number,
  frameIdx: number,
): void {
  for (let i = 0; i < sim.vehicles.length; i++) {
    const v = sim.vehicles[i];
    if (v.phase === "gone") continue;
    const vx = ox + v.x;
    const vy = oy + v.y;

    if (v.kind === "bus") {
      const isPrison = sim.mode === "maze-infect";
      const bodyCol: RGBA = isPrison ? [48, 26, 66, 255] : [30, 56, 80, 255];
      const roofCol: RGBA = isPrison ? [72, 38, 94, 255] : [48, 86, 118, 255];
      const borderCol: RGBA = isPrison ? [245, 115, 215, 250] : [115, 228, 255, 250];

      // 1. 双排加宽重型防爆轮胎橡胶刹印
      for (const tx of [-26, 26]) {
        fb.drawLine(vx + tx, vy + 58, vx + tx, vy + 142, 6.2, [6, 8, 14, 185]);
      }

      // 2. 重型底盘投影与 8 轮外凸越野防爆宽胎
      fb.blendRoundRect(vx - 41, vy - 76, 82, 152, 11, [4, 7, 13, 230]);
      for (const wyOff of [-46, -15, 16, 47]) {
        fb.fillRect(vx - 40, vy + wyOff - 9, 8, 18, [16, 20, 26, 255]);
        fb.fillRect(vx + 32, vy + wyOff - 9, 8, 18, [16, 20, 26, 255]);
        fb.drawLine(vx - 39, vy + wyOff, vx - 33, vy + wyOff, 1.8, [75, 92, 115, 220]);
        fb.drawLine(vx + 33, vy + wyOff, vx + 39, vy + wyOff, 1.8, [75, 92, 115, 220]);
      }

      // 3. 巨型锯齿状液压 V 型破障铲 (Heavy Hydraulic V-Plow) + 黑黄工程警示斜纹
      fb.drawLine(vx - 37, vy - 64, vx, vy - 88, 6.8, [205, 225, 245, 255]);
      fb.drawLine(vx + 37, vy - 64, vx, vy - 88, 6.8, [205, 225, 245, 255]);
      fb.drawLine(vx - 31, vy - 68, vx, vy - 81, 3.6, [255, 198, 42, 250]);
      fb.drawLine(vx + 31, vy - 68, vx, vy - 81, 3.6, [255, 198, 42, 250]);
      for (const toothX of [-24, -12, 0, 12, 24]) {
        const ty0 = vy - 66 - (1 - Math.abs(toothX) / 36) * 20;
        fb.drawLine(vx + toothX, ty0, vx + toothX, ty0 - 7, 2.8, [235, 248, 255, 255]);
      }

      // 4. 70x142 重装反应装甲车体 + 两侧反应装甲块 + 防弹百叶前挡风窗
      fb.blendRoundRect(vx - 35, vy - 70, 70, 140, 9, bodyCol);
      fb.strokeRoundRect(vx - 35, vy - 70, 70, 140, 9, 2.8, borderCol);
      for (const side of [-33, 28]) {
        for (const ryOff of [-44, -12, 20]) {
          fb.strokeRoundRect(vx + side, vy + ryOff, 5, 24, 1, 1.4, borderCol);
        }
      }

      fb.blendRoundRect(vx - 27, vy - 61, 54, 20, 4, [12, 20, 32, 250]);
      for (const ly of [-57, -51, -45]) {
        fb.drawLine(vx - 24, vy + ly, vx + 24, vy + ly, 1.8, borderCol);
      }

      // 5. 两侧大型液压突击舱门展开
      if (v.doorOpen > 0.05) {
        const span = v.doorOpen * 20;
        for (const side of [-1, 1]) {
          const dx0 = vx + side * 35;
          const dx1 = vx + side * (35 + span);
          fb.drawLine(dx0, vy - 34, dx1, vy - 24, 4.4, [95, 255, 175, 250]);
          fb.drawLine(dx0, vy - 14, dx1, vy - 24, 3.0, borderCol);
        }
      }

      // 6. 车顶装甲舱盖、天窗内待命特战小队与 30mm 双联重机炮遥控武器站
      fb.blendRoundRect(vx - 22, vy - 30, 44, 80, 6, roofCol);
      fb.strokeRoundRect(vx - 22, vy - 30, 44, 80, 6, 1.8, borderCol);

      const remainingInside = Math.max(0, v.totalToDeploy - v.deployedCount);
      for (let uIdx = 0; uIdx < remainingInside; uIdx++) {
        const col = uIdx % 2 === 0 ? -10 : 10;
        const row = Math.floor(uIdx / 2) * 16 + 6;
        fb.fillCircle(vx + col, vy + row, 5.4, [45, 235, 135, 255]);
        fb.strokeRing(vx + col, vy + row, 5.4, 1.4, [12, 32, 22, 240]);
      }

      const tX = vx;
      const tY = vy - 18;
      const tux = Math.cos(v.turretAngle);
      const tuy = Math.sin(v.turretAngle);
      const tpx = -tuy;
      const tpy = tux;
      fb.fillCircle(tX, tY, 14, [20, 30, 44, 255]);
      drawPolygonLines(fb, tX, tY, 14, 8, v.turretAngle, 2.4, borderCol, true);
      for (const side of [-5.0, 5.0]) {
        const bx0 = tX + tpx * side + tux * 6;
        const by0 = tY + tpy * side + tuy * 6;
        const bx1 = tX + tpx * side + tux * 30;
        const by1 = tY + tpy * side + tuy * 30;
        fb.drawLine(bx0, by0, bx1, by1, 4.4, [28, 38, 52, 255]);
        fb.drawLine(bx0, by0, bx1, by1, 2.0, [215, 242, 255, 255]);
        if (v.muzzleFlash > 0.08) {
          fb.drawGlowCircle(bx1 + tux * 6, by1 + tuy * 6, 18, [255, 215, 75, 225]);
          fb.drawLine(bx1, by1, bx1 + tux * 16, by1 + tuy * 16, 3.4, [255, 248, 175, 255]);
        }
      }

      if (v.muzzleFlash > 0.08 && v.phase === "inbound") {
        for (const side of [-1, 1]) {
          const px0 = vx + side * 35;
          const py0 = vy - 8;
          fb.drawGlowCircle(px0 + side * 6, py0 - 5, 14, [255, 195, 65, 205]);
          fb.drawLine(px0, py0, px0 + side * 14, py0 - 12, 2.8, [255, 242, 165, 250]);
        }
      }

      const flashLeft = frameIdx % 8 < 4;
      const leftStrobe: RGBA = flashLeft ? [255, 45, 68, 255] : [65, 215, 255, 255];
      const rightStrobe: RGBA = flashLeft ? [65, 215, 255, 255] : [255, 45, 68, 255];
      fb.drawGlowCircle(vx - 15, vy - 36, 18, [leftStrobe[0], leftStrobe[1], leftStrobe[2], 160]);
      fb.drawGlowCircle(vx + 15, vy - 36, 18, [rightStrobe[0], rightStrobe[1], rightStrobe[2], 160]);
      fb.fillCircle(vx - 15, vy - 36, 4.4, leftStrobe);
      fb.fillCircle(vx + 15, vy - 36, 4.4, rightStrobe);

      // 7. 车头高流明探照远光灯 + 车尾刹车灯 + 倒车撤离白色高亮倒车灯
      for (const hxOff of [-22, 22]) {
        fb.drawGlowCircle(vx + hxOff, vy - 70, 24, [255, 245, 185, 195]);
        fb.fillCircle(vx + hxOff, vy - 70, 5.5, [255, 255, 225, 255]);
        fb.fillCircle(vx + hxOff, vy + 68, 4.4, [255, 42, 55, 245]);
        if (v.phase === "departing") {
          fb.drawGlowCircle(vx + hxOff * 0.65, vy + 70, 16, [235, 248, 255, 195]);
          fb.fillCircle(vx + hxOff * 0.65, vy + 70, 3.8, [255, 255, 255, 255]);
        }
      }
    } else {
      // 双发重装黑鹰武装直升机 (MH-60L DAP Gunship)：192px 巨型主旋翼直径 + 双发涡轴短舱 + 19联装九头蛇火箭巢！
      const isSonar = sim.mode === "sonar";
      const ux = Math.cos(v.angle);
      const uy = Math.sin(v.angle);
      const px = -uy;
      const py = ux;

      // 1. 双圈高速下洗气浪冲击环与特战双侧索降粗绳 (Fast-Ropes)
      const washR = 88 + Math.sin(frameIdx * 0.48) * 6;
      fb.strokeRing(
        vx,
        vy,
        washR,
        2.2,
        isSonar ? [65, 245, 215, 125] : [255, 215, 95, 115],
      );
      fb.strokeRing(
        vx,
        vy,
        washR * 0.72,
        1.4,
        isSonar ? [65, 245, 215, 70] : [255, 215, 95, 65],
      );
      if (v.ropeDrop > 0.05) {
        for (const side of [-1, 1]) {
          const rx0 = vx + px * side * 28;
          const ry0 = vy + py * side * 28;
          const rx1 = vx + px * side * (52 * v.ropeDrop);
          const ry1 = vy + py * side * (52 * v.ropeDrop) + 18 * v.ropeDrop;
          fb.drawLine(rx0, ry0, rx1, ry1, 4.0, [235, 188, 82, 245]);
          fb.fillCircle(rx1, ry1, 5.2, [255, 230, 125, 250]);
        }
      }

      // 2. 加长装甲尾梁 (84px Tail Boom)、宽体水平尾翼与高速尾桨
      const tailX = vx - ux * 84;
      const tailY = vy - uy * 84;
      fb.drawLine(vx, vy, tailX, tailY, 12.5, [22, 32, 44, 255]);
      fb.drawLine(vx, vy, tailX, tailY, 6.2, isSonar ? [48, 130, 136, 255] : [64, 82, 102, 255]);
      fb.drawLine(
        tailX - px * 26,
        tailY - py * 26,
        tailX + px * 26,
        tailY + py * 26,
        5.8,
        [95, 140, 175, 250],
      );
      const trLen = 16 * Math.sin(frameIdx * 0.95);
      fb.drawLine(
        tailX + px * 11 - ux * trLen,
        tailY + py * 11 - uy * trLen,
        tailX + px * 11 + ux * trLen,
        tailY + py * 11 + uy * trLen,
        3.4,
        [220, 248, 255, 250],
      );

      // 3. 96px 宽 ESSS 重型武器挂架短翼 + 19联装火箭发射巢 + 双翼六管加特林
      const wLeftX = vx - px * 48;
      const wLeftY = vy - py * 48;
      const wRightX = vx + px * 48;
      const wRightY = vy + py * 48;
      fb.drawLine(wLeftX, wLeftY, wRightX, wRightY, 11.0, [30, 44, 60, 255]);
      fb.drawLine(wLeftX, wLeftY, wRightX, wRightY, 4.2, [125, 192, 232, 250]);
      for (const side of [-1, 1]) {
        // 双发 T700 涡轴发动机装甲短舱
        const engX = vx + px * side * 17 - ux * 8;
        const engY = vy + py * side * 17 - uy * 8;
        fb.fillCircle(engX, engY, 8.5, [34, 48, 66, 255]);
        fb.strokeRing(engX, engY, 8.5, 1.6, [145, 205, 235, 230]);

        // 外挂火箭巢与加特林枪管
        const podX = vx + px * side * 40;
        const podY = vy + py * side * 40;
        const tipX = podX + ux * 26;
        const tipY = podY + uy * 26;
        fb.drawLine(podX - ux * 10, podY - uy * 10, tipX, tipY, 6.8, [38, 52, 70, 255]);
        fb.drawLine(podX - ux * 8, podY - uy * 8, tipX, tipY, 2.6, [215, 242, 255, 255]);
        if (v.muzzleFlash > 0.08) {
          fb.drawGlowCircle(tipX + ux * 7, tipY + uy * 7, 22, [255, 215, 75, 230]);
          fb.drawLine(tipX, tipY, tipX + ux * 20, tipY + uy * 20, 4.0, [255, 248, 185, 255]);
        }
      }
      fb.fillCircle(wLeftX, wLeftY, 5.5, [255, 48, 68, 255]);
      fb.fillCircle(wRightX, wRightY, 5.5, [55, 255, 155, 255]);

      // 4. 加大号装甲机腹主舱、舱内特战队员与前部防弹玻璃驾驶舱
      fb.fillCircle(vx, vy, 31, [20, 30, 42, 255]);
      drawPolygonLines(
        fb,
        vx,
        vy,
        30,
        8,
        v.angle,
        3.0,
        isSonar ? [75, 245, 215, 250] : [255, 205, 75, 250],
      );
      const remainingHeli = Math.max(0, v.totalToDeploy - v.deployedCount);
      for (let uIdx = 0; uIdx < remainingHeli; uIdx++) {
        const ang = (uIdx / Math.max(1, remainingHeli)) * Math.PI * 2;
        fb.fillCircle(vx + Math.cos(ang) * 13, vy + Math.sin(ang) * 13, 4.6, [45, 235, 135, 255]);
      }
      const noseX = vx + ux * 24;
      const noseY = vy + uy * 24;
      fb.fillCircle(noseX, noseY, 18, [85, 218, 255, 240]);
      fb.drawGlowCircle(noseX + ux * 9, noseY + uy * 9, 28, [255, 245, 185, 205]);

      // 5. 96px 半径（192px 直径）四叶重型主旋翼 + 半透明气动残影圆盘 + 翼尖频闪灯
      const rotorR = 96;
      fb.blendCircle(vx, vy, rotorR, [145, 205, 245, 18]);
      fb.strokeRing(vx, vy, rotorR, 2.4, [185, 232, 255, 135]);
      fb.strokeRing(vx, vy, rotorR * 0.62, 1.2, [165, 215, 245, 75]);
      for (let b = 0; b < 4; b++) {
        const bAng = v.rotorAngle + (b * Math.PI) / 2;
        const bx = vx + Math.cos(bAng) * rotorR;
        const by = vy + Math.sin(bAng) * rotorR;
        // 旋翼扇叶扫掠残影线
        const lagAng = bAng - 0.16;
        fb.drawLine(
          vx,
          vy,
          vx + Math.cos(lagAng) * (rotorR * 0.96),
          vy + Math.sin(lagAng) * (rotorR * 0.96),
          6.5,
          [140, 195, 235, 55],
        );
        fb.drawLine(vx, vy, bx, by, 4.8, [38, 52, 70, 240]);
        fb.drawLine(vx, vy, bx, by, 2.2, [215, 242, 255, 245]);
        fb.fillCircle(bx, by, 4.0, [255, 232, 95, 255]);
      }
      fb.fillCircle(vx, vy, 9.0, [195, 228, 248, 255]);
      fb.strokeRing(vx, vy, 9.0, 2.0, [32, 48, 66, 255]);
    }
  }
}

function getEffectiveCam(sim: SiegeSimulator): { camX: number; camY: number; zoom: number } {
  const zoom = clamp(sim.camZoom || 1.0, 1.0, 2.2);
  const viewW = ARENA_W / zoom;
  const viewH = ARENA_H / zoom;
  return {
    camX: clamp(sim.camX + sim.camShakeX, 0, WORLD_W - viewW),
    camY: clamp(sim.camY + sim.camShakeY, 0, WORLD_H - viewH),
    zoom,
  };
}

function renderDeadCornerWalls(fb: FrameBuf, sim: SiegeSimulator): void {
  if (sim.deadCornerWalls.length === 0) return;
  const { camX, camY, zoom } = getEffectiveCam(sim);
  const viewW = ARENA_W / zoom;
  const viewH = ARENA_H / zoom;
  const ox = BOARD_X - camX;
  const oy = BOARD_Y - camY;

  // 真实现代商业建筑/地铁/医院清水混凝土与拉丝铝合金门框墙体配色（彻底告别廉价卡通斜纹条！）
  const coreCol: RGBA = [36, 42, 52, 255];
  const mortarCol: RGBA = [54, 63, 76, 255];
  const trimCol: RGBA =
    sim.mode === "blackout"
      ? [148, 136, 112, 235]
      : sim.mode === "sonar"
        ? [112, 146, 152, 235]
        : sim.mode === "maze-infect"
          ? [142, 118, 152, 235]
          : [118, 142, 166, 235];

  for (const w of sim.deadCornerWalls) {
    const wMinX = Math.min(w.x1, w.x2) - 12;
    const wMaxX = Math.max(w.x1, w.x2) + 12;
    const wMinY = Math.min(w.y1, w.y2) - 12;
    const wMaxY = Math.max(w.y1, w.y2) + 12;
    if (
      wMaxX < camX - 24 ||
      wMinX > camX + viewW + 24 ||
      wMaxY < camY - 24 ||
      wMinY > camY + viewH + 24
    ) {
      continue;
    }
    const x1 = ox + w.x1;
    const y1 = oy + w.y1;
    const x2 = ox + w.x2;
    const y2 = oy + w.y2;
    const minX = Math.min(x1, x2) - 8;
    const maxX = Math.max(x1, x2) + 8;
    const minY = Math.min(y1, y2) - 8;
    const maxY = Math.max(y1, y2) + 8;
    const rw = maxX - minX;
    const rh = maxY - minY;

    // 2.5D 斜向落地阴影 + 现浇混凝土墙芯 + 内墙石膏粉刷线 + 商铺铝合金玻璃门窗框细节
    fb.blendRoundRect(minX + 4, minY + 6, rw + 4, rh + 4, 2, [3, 5, 9, 185]);
    fb.fillRoundRect(minX, minY, rw, rh, 2, coreCol);
    fb.strokeRoundRect(minX + 2, minY + 2, Math.max(2, rw - 4), Math.max(2, rh - 4), 1, 1.2, mortarCol);
    fb.strokeRoundRect(minX, minY, rw, rh, 2, 1.4, trimCol);

    // 横向长商铺隔墙嵌入半碎钢化玻璃橱窗与铝型材竖梃（打破单调水泥条感！）
    const isHoriz = rw > rh * 2.2;
    if (isHoriz && rw >= 110) {
      for (let gx = minX + 26; gx < maxX - 34; gx += 46) {
        fb.fillRect(gx, minY + 4, 28, Math.max(3, rh - 8), [22, 34, 46, 235]);
        fb.drawLine(gx + 3, minY + 6, gx + 14, maxY - 6, 1.4, [155, 205, 235, 165]);
        fb.drawLine(gx + 19, minY + 6, gx + 25, minY + 10, 1.2, [195, 235, 250, 145]);
      }
    }

    // 墙端承重门垛与包角立柱
    for (const [px, py] of [
      [x1, y1],
      [x2, y2],
    ]) {
      fb.fillRoundRect(px - 8, py - 8, 16, 16, 2, [46, 53, 64, 255]);
      fb.strokeRoundRect(px - 8, py - 8, 16, 16, 2, 1.4, trimCol);
    }
  }
}

/**
 * 真实体积感【自然战争迷雾引擎 (Gaussian-Blurred Natural Fog of War)】：
 * 1) 零辅助线/零三角线框：全部光锥与周身视野经射线墙体阻挡后，执行双向分离 5-Tap 高斯柔化，过渡如真实夜色雾气般丝滑；
 * 2) 三态迷雾记忆：当前视线照亮区 (100% 清晰暖冷光感) -> 已探索记忆迷雾区 (24% 低饱和石板蓝) -> 未探索未知黑雾区 (3.5% 深暗夜雾)；
 * 3) 建筑轮廓与任务点“若隐若现”：未见区域内的店铺墙壁仅透出 ~13% 朦胧建筑剪影，未照亮救援点仅浮现微弱呼吸求救波纹！
 */
function applyDeadCornerRaycastLighting(
  rawFb: FrameBuf,
  wfb: FrameBuf,
  sim: SiegeSimulator,
  frameIdx: number,
): void {
  const { camX, camY, zoom } = getEffectiveCam(sim);
  const viewW = ARENA_W / zoom;
  const viewH = ARENA_H / zoom;
  const ox = BOARD_X - camX;
  const oy = BOARD_Y - camY;
  const tSec = sim.tick / SIM_HZ;

  // 0. 对 50x84 探索网格做一次超轻量 3x3 平滑，配合双线性插值彻底消除记忆迷雾 36px 锯齿方块！
  const smoothExplored = new Float32Array(NAV_COLS * NAV_ROWS);
  for (let nr = 0; nr < NAV_ROWS; nr++) {
    const r0 = Math.max(0, nr - 1) * NAV_COLS;
    const r1 = nr * NAV_COLS;
    const r2 = Math.min(NAV_ROWS - 1, nr + 1) * NAV_COLS;
    for (let nc = 0; nc < NAV_COLS; nc++) {
      const c0 = Math.max(0, nc - 1);
      const c2 = Math.min(NAV_COLS - 1, nc + 1);
      smoothExplored[r1 + nc] =
        (sim.exploredGrid[r0 + c0] + sim.exploredGrid[r0 + nc] * 2 + sim.exploredGrid[r0 + c2] +
          sim.exploredGrid[r1 + c0] * 2 + sim.exploredGrid[r1 + nc] * 4 + sim.exploredGrid[r1 + c2] * 2 +
          sim.exploredGrid[r2 + c0] + sim.exploredGrid[r2 + nc] * 2 + sim.exploredGrid[r2 + c2]) *
        0.0625;
    }
  }
  const sampleExplored = (wx: number, wy: number): number => {
    const cf = wx / NAV_CELL - 0.5;
    const rf = wy / NAV_CELL - 0.5;
    const c0 = clamp(Math.floor(cf), 0, NAV_COLS - 1);
    const c1 = Math.min(NAV_COLS - 1, c0 + 1);
    const r0 = clamp(Math.floor(rf), 0, NAV_ROWS - 1);
    const r1 = Math.min(NAV_ROWS - 1, r0 + 1);
    const fc = clamp(cf - c0, 0, 1);
    const fr = clamp(rf - r0, 0, 1);
    const top = smoothExplored[r0 * NAV_COLS + c0] * (1 - fc) + smoothExplored[r0 * NAV_COLS + c1] * fc;
    const bot = smoothExplored[r1 * NAV_COLS + c0] * (1 - fc) + smoothExplored[r1 * NAV_COLS + c1] * fc;
    return top * (1 - fr) + bot * fr;
  };

  // 【差异化多模式照明体系】：
  // 1) scavenge (自然天窗采光商场) & maze-infect (玻璃幕墙航站楼) & 通电阶段 blackout (0~11.5s 荧光灯地铁站)：
  //    保持通透明亮的真实室内光线，仅对尚未进入的封闭侧室施加 0.80 柔和室内阴影（并在 10.3~11.5s 地铁站变电短路时呈现高压电弧爆闪！）
  if (!sim.isDarkMode) {
    const raw = rawFb.data;
    const isFlickeringMetro = sim.mode === "blackout" && sim.metroPowerLevel < 0.995;
    const powerScale = sim.mode === "blackout" ? clamp(0.16 + sim.metroPowerLevel * 0.84, 0.16, 1.0) : 1.0;

    for (let ay = 0; ay < ARENA_H; ay++) {
      const screenY = BOARD_Y + ay;
      const worldY = camY + ay / zoom;
      for (let ax = 0; ax < ARENA_W; ax++) {
        const worldX = camX + ax / zoom;
        const expFrac = sampleExplored(worldX, worldY);
        const roomShade = 0.80 + 0.20 * expFrac;
        const vis = roomShade * powerScale;
        if (vis >= 0.995 && !isFlickeringMetro) continue;

        const idx = (screenY * OUT_W + (BOARD_X + ax)) * 4;
        const arcTintB = isFlickeringMetro && sim.metroPowerLevel > 0.4 ? 14 : 0;
        raw[idx] = clamp((raw[idx] * vis) | 0, 0, 255);
        raw[idx + 1] = clamp((raw[idx + 1] * vis + arcTintB * 0.5) | 0, 0, 255);
        raw[idx + 2] = clamp((raw[idx + 2] * (vis * (1.03 - 0.03 * expFrac)) + arcTintB) | 0, 0, 255);
      }
    }
    return;
  }

  const CELL = 6;
  const GW = Math.ceil(ARENA_W / CELL);
  const GH = Math.ceil(ARENA_H / CELL);
  const lightGrid = new Float32Array(GW * GH);
  const warmGrid = new Float32Array(GW * GH);
  const archMask = new Uint8Array(GW * GH);

  // 1. 预标记屏幕视野内的建筑墙体边缘网格（用于在未见黑雾中呈现“若隐若现的建筑轮廓”！）
  const markWallSeg = (wx1: number, wy1: number, wx2: number, wy2: number) => {
    const sx1 = (wx1 - camX) * zoom;
    const sy1 = (wy1 - camY) * zoom;
    const sx2 = (wx2 - camX) * zoom;
    const sy2 = (wy2 - camY) * zoom;
    const len = Math.hypot(sx2 - sx1, sy2 - sy1);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.75)));
    const padCells = Math.max(1, Math.round((8 * zoom) / CELL));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const gx0 = Math.floor((sx1 + (sx2 - sx1) * t) / CELL);
      const gy0 = Math.floor((sy1 + (sy2 - sy1) * t) / CELL);
      if (gx0 < -2 || gx0 >= GW + 2 || gy0 < -2 || gy0 >= GH + 2) continue;
      for (let dy = -padCells; dy <= padCells; dy++) {
        const yy = gy0 + dy;
        if (yy < 0 || yy >= GH) continue;
        for (let dx = -padCells; dx <= padCells; dx++) {
          const xx = gx0 + dx;
          if (xx >= 0 && xx < GW) {
            archMask[yy * GW + xx] = 1;
          }
        }
      }
    }
  };
  for (const w of sim.deadCornerWalls) markWallSeg(w.x1, w.y1, w.x2, w.y2);
  for (const w of sim.outerWalls) markWallSeg(w.x1, w.y1, w.x2, w.y2);

  // 2. 投射全部广角柔光手电与探照灯（余弦钟形柔和衰减，严禁硬边与线框！）
  const RAY_COUNT = 48;
  for (let ci = 0; ci < sim.lightCones.length; ci++) {
    const c = sim.lightCones[ci];
    const dists = new Float32Array(RAY_COUNT);
    for (let rIdx = 0; rIdx < RAY_COUNT; rIdx++) {
      const frac = rIdx / (RAY_COUNT - 1);
      const rayAng = c.angle - c.halfFov + frac * (c.halfFov * 2);
      dists[rIdx] = sim.castRayToWalls(c.x, c.y, Math.cos(rayAng), Math.sin(rayAng), c.range);
    }

    const cxLocal = (c.x - camX) * zoom;
    const cyLocal = (c.y - camY) * zoom;
    const rangeScr = c.range * zoom;
    const minGX = Math.max(0, Math.floor((cxLocal - rangeScr) / CELL));
    const maxGX = Math.min(GW - 1, Math.ceil((cxLocal + rangeScr) / CELL));
    const minGY = Math.max(0, Math.floor((cyLocal - rangeScr) / CELL));
    const maxGY = Math.min(GH - 1, Math.ceil((cyLocal + rangeScr) / CELL));

    for (let gy = minGY; gy <= maxGY; gy++) {
      const py = gy * CELL + CELL * 0.5;
      const dy = py - cyLocal;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const px = gx * CELL + CELL * 0.5;
        const dx = px - cxLocal;
        const distScr = Math.hypot(dx, dy);
        if (distScr > rangeScr) continue;

        let da = Math.atan2(dy, dx) - c.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > c.halfFov) continue;

        const u = ((da + c.halfFov) / (2 * c.halfFov)) * (RAY_COUNT - 1);
        const idx0 = Math.max(0, Math.min(RAY_COUNT - 1, u | 0));
        const idx1 = Math.min(RAY_COUNT - 1, idx0 + 1);
        const f = u - idx0;
        const wallDistScr = (dists[idx0] * (1 - f) + dists[idx1] * f) * zoom;

        // 墙体表面留 10px 柔光漫反射，墙后则严格被阻挡在迷雾中！
        if (distScr <= wallDistScr + 10 * zoom) {
          const penumbra =
            distScr > wallDistScr
              ? Math.max(0, 1 - (distScr - wallDistScr) / (10 * zoom))
              : 1.0;
          const normD = distScr / rangeScr;
          const distFalloff = Math.pow(1 - normD, 1.35);
          const angBell = Math.pow(0.5 + 0.5 * Math.cos((Math.PI * Math.abs(da)) / c.halfFov), 1.45);
          const energy = distFalloff * angBell * penumbra * c.intensity;
          const cellIdx = gy * GW + gx;
          // 多名队员柔和叠加照明（软饱和曲线 1 - exp(-sum) 自然融合，绝无生硬拼接缝！）
          lightGrid[cellIdx] = Math.min(1.25, lightGrid[cellIdx] + energy * 0.72);
          if (c.kind === "spotlight") {
            warmGrid[cellIdx] = Math.min(1.0, warmGrid[cellIdx] + energy * 0.8);
          }
        }
      }
    }
  }

  // 3. 叠加受墙体严格遮挡 (24向射线检测) 的士兵近身 360° 微光感知圈（防止光线穿墙泄入隔壁暗室！）
  const AURA_RAYS = 24;
  const auraDists = new Float32Array(AURA_RAYS);
  for (let gi = 0; gi < sim.greens.length; gi++) {
    const g = sim.greens[gi];
    const auraWorldR = g.muzzleFlash > 0.2 ? 135 : 105;
    for (let rIdx = 0; rIdx < AURA_RAYS; rIdx++) {
      const ang = (rIdx * Math.PI * 2) / AURA_RAYS;
      auraDists[rIdx] = sim.castRayToWalls(g.x, g.y, Math.cos(ang), Math.sin(ang), auraWorldR);
    }
    const cx = (g.x - camX) * zoom;
    const cy = (g.y - camY) * zoom;
    const rScr = auraWorldR * zoom;
    const minGX = Math.max(0, Math.floor((cx - rScr) / CELL));
    const maxGX = Math.min(GW - 1, Math.ceil((cx + rScr) / CELL));
    const minGY = Math.max(0, Math.floor((cy - rScr) / CELL));
    const maxGY = Math.min(GH - 1, Math.ceil((cy + rScr) / CELL));
    for (let gy = minGY; gy <= maxGY; gy++) {
      const dy = gy * CELL + CELL * 0.5 - cy;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const dx = gx * CELL + CELL * 0.5 - cx;
        const d = Math.hypot(dx, dy);
        if (d > rScr) continue;
        let ang = Math.atan2(dy, dx);
        if (ang < 0) ang += Math.PI * 2;
        const u = (ang / (Math.PI * 2)) * AURA_RAYS;
        const i0 = u % AURA_RAYS | 0;
        const i1 = (i0 + 1) % AURA_RAYS;
        const frac = u - Math.floor(u);
        const wDistScr = (auraDists[i0] * (1 - frac) + auraDists[i1] * frac) * zoom;
        if (d <= wDistScr + 9 * zoom) {
          const fall = Math.pow(1 - d / rScr, 1.5) * (g.muzzleFlash > 0.2 ? 0.85 : 0.62);
          const cellIdx = gy * GW + gx;
          if (fall > lightGrid[cellIdx]) {
            lightGrid[cellIdx] = fall;
          } else {
            lightGrid[cellIdx] = Math.min(1.25, lightGrid[cellIdx] + fall * 0.35);
          }
        }
      }
    }
  }

  // 载具周身环境光与母巢暗红生物微光
  const addSoftPointLight = (wx: number, wy: number, rad: number, peak: number, warm = 0) => {
    const cx = (wx - camX) * zoom;
    const cy = (wy - camY) * zoom;
    const rScr = rad * zoom;
    const minGX = Math.max(0, Math.floor((cx - rScr) / CELL));
    const maxGX = Math.min(GW - 1, Math.ceil((cx + rScr) / CELL));
    const minGY = Math.max(0, Math.floor((cy - rScr) / CELL));
    const maxGY = Math.min(GH - 1, Math.ceil((cy + rScr) / CELL));
    for (let gy = minGY; gy <= maxGY; gy++) {
      const dy = gy * CELL + CELL * 0.5 - cy;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const dx = gx * CELL + CELL * 0.5 - cx;
        const d = Math.hypot(dx, dy);
        if (d <= rScr) {
          const v = Math.pow(1 - d / rScr, 1.6) * peak;
          const idx = gy * GW + gx;
          lightGrid[idx] = Math.min(1.25, lightGrid[idx] + v);
          if (warm > 0) warmGrid[idx] = Math.min(1.0, warmGrid[idx] + v * warm);
        }
      }
    }
  };
  for (const v of sim.vehicles) {
    if (v.phase !== "gone") {
      addSoftPointLight(v.x, v.y, 240, 1.04, 0.55);
      addSoftPointLight(v.x, v.y - 115, 215, 0.88, 0.48);
    }
  }
  for (const n of sim.nodes) {
    if (n.broken) continue;
    let revealed = (n.breachProgress ?? 0) > 0.005;
    if (!revealed) {
      for (let gi = 0; gi < sim.greens.length; gi++) {
        const g = sim.greens[gi];
        if (Math.hypot(g.x - n.x, g.y - n.y) <= 295 && sim.hasLineOfSight(g.x, g.y, n.x, n.y)) {
          revealed = true;
          break;
        }
      }
    }
    if (revealed) {
      // 小队靠近照亮铁笼时，铁笼旁应急求救信号棒散发自然暖光池，照亮铁笼与周边货架/病床陈设！
      addSoftPointLight(n.x, n.y, 125, 0.78, 0.35);
    }
  }
  if (sim.hive.alive) {
    addSoftPointLight(sim.hive.x, sim.hive.y, 165, 0.78, 0.2);
  }
  for (const r of sim.rings) {
    if (r.kind === "sonar" || r.kind === "noise") {
      const p = 1 - r.ttl / r.maxTtl;
      const ringR = 14 + p * r.maxR;
      addSoftPointLight(r.x, r.y, Math.min(240, ringR + 28), 0.48 * (1 - p), 0);
    }
  }

  // 4. 对光照场执行双遍 5-Tap 可分离高斯平滑模糊 ([1, 4, 6, 4, 1] / 16)，彻底消除锯齿格与生硬光斑边界！
  const tmpBlur = new Float32Array(GW * GH);
  const blurredLight = new Float32Array(GW * GH);
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? lightGrid : blurredLight;
    for (let gy = 0; gy < GH; gy++) {
      const row = gy * GW;
      for (let gx = 0; gx < GW; gx++) {
        const c0 = src[row + Math.max(0, gx - 2)];
        const c1 = src[row + Math.max(0, gx - 1)];
        const c2 = src[row + gx];
        const c3 = src[row + Math.min(GW - 1, gx + 1)];
        const c4 = src[row + Math.min(GW - 1, gx + 2)];
        tmpBlur[row + gx] = (c0 + c1 * 4 + c2 * 6 + c3 * 4 + c4) * 0.0625;
      }
    }
    for (let gy = 0; gy < GH; gy++) {
      const r0 = Math.max(0, gy - 2) * GW;
      const r1 = Math.max(0, gy - 1) * GW;
      const r2 = gy * GW;
      const r3 = Math.min(GH - 1, gy + 1) * GW;
      const r4 = Math.min(GH - 1, gy + 2) * GW;
      for (let gx = 0; gx < GW; gx++) {
        blurredLight[r2 + gx] =
          (tmpBlur[r0 + gx] +
            tmpBlur[r1 + gx] * 4 +
            tmpBlur[r2 + gx] * 6 +
            tmpBlur[r3 + gx] * 4 +
            tmpBlur[r4 + gx]) *
          0.0625;
      }
    }
  }

  // 5. 全视口自然战争迷雾合成（仅用于 sonar 深层隔离医院 与 断电后的 blackout 地铁站！）
  const lateFlood =
    sim.mode === "blackout"
      ? sim.metroPowerLevel
      : tSec >= 31.5
        ? clamp((tSec - 31.5) / 4.5, 0, 1) * 0.3
        : 0;
  const raw = rawFb.data;
  const fogR = sim.mode === "sonar" ? 5 : 8;
  const fogG = sim.mode === "sonar" ? 13 : 9;
  const fogB = sim.mode === "sonar" ? 19 : 15;
  const emergencyRedBoost = sim.mode === "blackout" && sim.metroPowerLevel > 0.05 ? sim.metroPowerLevel * 22 : 0;

  for (let ay = 0; ay < ARENA_H; ay++) {
    const screenY = BOARD_Y + ay;
    const worldY = camY + ay / zoom;
    const navR = clamp((worldY / NAV_CELL) | 0, 0, NAV_ROWS - 1) * NAV_COLS;

    const gyF = ay / CELL - 0.5;
    const gy0 = clamp(Math.floor(gyF), 0, GH - 1);
    const gy1 = Math.min(GH - 1, gy0 + 1);
    const fy = clamp(gyF - gy0, 0, 1);
    const row0 = gy0 * GW;
    const row1 = gy1 * GW;

    for (let ax = 0; ax < ARENA_W; ax++) {
      const gxF = ax / CELL - 0.5;
      const gx0 = clamp(Math.floor(gxF), 0, GW - 1);
      const gx1 = Math.min(GW - 1, gx0 + 1);
      const fx = clamp(gxF - gx0, 0, 1);

      // 双线性插值采样高斯模糊后的光照强度，丝滑无颗粒！
      const lTop = blurredLight[row0 + gx0] * (1 - fx) + blurredLight[row0 + gx1] * fx;
      const lBot = blurredLight[row1 + gx0] * (1 - fx) + blurredLight[row1 + gx1] * fx;
      const rawL = lTop * (1 - fy) + lBot * fy;
      const litVis = 1 - Math.exp(-rawL * 1.65);

      const worldX = camX + ax / zoom;
      const expFrac = sampleExplored(worldX, worldY);
      const isWallEdge = archMask[row0 + gx0] > 0;

      // 未探索区底光极低 (0.035)，但未见建筑墙体边缘透出 0.14 的“若隐若现”朦胧轮廓；已探索区平滑过渡至 0.22~0.24 记忆迷雾
      const unexpVis = isWallEdge
        ? (sim.mode === "blackout" ? 0.14 : 0.145)
        : (sim.mode === "blackout" ? 0.032 : 0.038);
      const expVis = sim.mode === "blackout" ? 0.21 : 0.24;
      const baseFogVis = unexpVis + (expVis - unexpVis) * expFrac;
      const vis = clamp(Math.max(baseFogVis + lateFlood, litVis), 0, 1.05);

      const idx = (screenY * OUT_W + (BOARD_X + ax)) * 4;
      const srcR = raw[idx];
      const srcG = raw[idx + 1];
      const srcB = raw[idx + 2];

      const lum = srcR * 0.299 + srcG * 0.587 + srcB * 0.114;
      const satMix = clamp((vis - 0.08) / 0.55, 0.22, 1.0);
      const colR = lum * (1 - satMix) + srcR * satMix;
      const colG = lum * (1 - satMix) + srcG * satMix;
      const colB = lum * 1.08 * (1 - satMix) + srcB * satMix;

      const warm = warmGrid[row0 + gx0];
      const bloom = Math.max(0, rawL - 0.55) * 18;
      const outR = fogR * (1 - Math.min(1, vis)) + colR * vis + bloom * (warm > 0.1 ? 1.3 : 0.7) + emergencyRedBoost;
      const outG = fogG * (1 - Math.min(1, vis)) + colG * vis + bloom * 0.95;
      const outB = fogB * (1 - Math.min(1, vis)) + colB * vis + bloom * (warm > 0.1 ? 0.45 : 1.15);

      raw[idx] = clamp(outR | 0, 0, 255);
      raw[idx + 1] = clamp(outG | 0, 0, 255);
      raw[idx + 2] = clamp(outB | 0, 0, 255);
    }
  }

  // 6. 在迷雾层之上：对【尚未被照亮的任务救援点】仅绘制若隐若现的低透明度呼吸求救微光波纹（照亮后才显现完整路障与进度环！）
  for (const n of sim.nodes) {
    if (n.broken) continue;
    const gx = clamp(Math.floor(((n.x - camX) * zoom) / CELL), 0, GW - 1);
    const gy = clamp(Math.floor(((n.y - camY) * zoom) / CELL), 0, GH - 1);
    const localL = blurredLight[gy * GW + gx];
    if (localL < 0.38) {
      const nx = ox + n.x;
      const ny = oy + n.y;
      const pulse = (frameIdx * 0.045) % 1.0;
      const alpha = Math.round((1 - pulse) * 52 * clamp(1 - localL * 2, 0.2, 1));
      const hintCol: RGBA =
        n.kind === "rescue_cage" ? [85, 240, 165, alpha] : [255, 210, 95, alpha];
      wfb.strokeRing(nx, ny, 16 + pulse * 34, 1.8, hintCol);
      wfb.drawGlowCircle(nx, ny, 18, [hintCol[0], hintCol[1], hintCol[2], 32]);
    }
  }

  // 7. 声呐潜行模式下：青色超声波扫过墙后暗室蛰伏尸潮时，在迷雾上点亮清晰的「青色声呐穿墙回波靶环」！
  for (let i = 0; i < sim.reds.length; i++) {
    const r = sim.reds[i];
    if (r.x < camX - 20 || r.x > camX + viewW + 20 || r.y < camY - 20 || r.y > camY + viewH + 20) {
      continue;
    }
    const gx = clamp(Math.floor(((r.x - camX) * zoom) / CELL), 0, GW - 1);
    const gy = clamp(Math.floor(((r.y - camY) * zoom) / CELL), 0, GH - 1);
    const localL = blurredLight[gy * GW + gx];
    const pingTicks = r.sonarPingTicks ?? 0;

    if (sim.mode === "sonar" && pingTicks > 0 && localL < 0.45) {
      const rx = ox + r.x;
      const ry = oy + r.y;
      const pingFrac = clamp(pingTicks / 46, 0, 1);
      const pingAlpha = Math.round(pingFrac * 225);
      wfb.drawGlowCircle(rx, ry, r.r + 7, [45, 245, 220, Math.round(pingAlpha * 0.42)]);
      wfb.strokeRing(rx, ry, r.r + 2.8 + (1 - pingFrac) * 4, 1.5, [75, 255, 232, pingAlpha]);
      wfb.fillCircle(rx, ry, Math.max(2.4, r.r * 0.45), [185, 255, 245, pingAlpha]);
      continue;
    }

    if ((localL >= 0.05 && localL < 0.42) || (sim.mode === "sonar" && r.dormant)) {
      const rx = ox + r.x;
      const ry = oy + r.y;
      const moveAng = Math.atan2(r.vy || 1, r.vx || 0);
      const px = -Math.sin(moveAng);
      const py = Math.cos(moveAng);
      const eyeSpread = Math.max(2.0, r.r * 0.34);
      const ex1 = rx + Math.cos(moveAng) * 2 - px * eyeSpread;
      const ey1 = ry + Math.sin(moveAng) * 2 - py * eyeSpread;
      const ex2 = rx + Math.cos(moveAng) * 2 + px * eyeSpread;
      const ey2 = ry + Math.sin(moveAng) * 2 + py * eyeSpread;
      const eyeAlpha = Math.round(clamp((0.5 + 0.5 * Math.sin(frameIdx * 0.25 + r.id)) * 155, 45, 165));
      wfb.fillCircle(ex1, ey1, 1.6, [255, 45, 65, eyeAlpha]);
      wfb.fillCircle(ex2, ey2, 1.6, [255, 45, 65, eyeAlpha]);
    }
  }
}

/**
 * 右上角【纯视觉全局战术雷达小地图 + 实时视野跟随白框 (`renderGlobalMinimapAndTelemetry`)】
 * （零文字解说，纯图形化信息表达）
 */
function renderGlobalMinimapAndTelemetry(
  fb: FrameBuf,
  sim: SiegeSimulator,
  _atlas: FontAtlas,
  frameIdx: number,
): void {
  const mapW = 168;
  const mapH = 280;
  const panelX = BOARD_X + ARENA_W - mapW - 22;
  const panelY = BOARD_Y + 14;
  const mapX = panelX + 6;
  const mapY = panelY + 6;

  // 1. 小地图半透明装甲底板
  fb.blendRoundRect(panelX, panelY, mapW + 12, mapH + 12, 8, [6, 10, 18, 228]);
  const themeCol: RGBA =
    sim.mode === "blackout"
      ? [255, 198, 65, 235]
      : sim.mode === "sonar"
        ? [68, 245, 215, 235]
        : sim.mode === "maze-infect"
          ? [245, 95, 210, 235]
          : [95, 225, 255, 235];
  fb.strokeRoundRect(panelX, panelY, mapW + 12, mapH + 12, 8, 2.0, themeCol);

  // 2. 绘制 1800x3000 全图走廊建筑轮廓与战争迷雾探索状态 (sim.exploredGrid)
  for (let py = 0; py < mapH; py += 2) {
    const wy = (py / mapH) * WORLD_H;
    const bnd = getCorridorBounds(wy, sim.mode);
    const lx = mapX + Math.round((bnd.left / WORLD_W) * mapW);
    const rx = mapX + Math.round((bnd.right / WORLD_W) * mapW);
    const navR = clamp(Math.floor(wy / NAV_CELL), 0, NAV_ROWS - 1);
    const midC = clamp(Math.floor(bnd.cx / NAV_CELL), 0, NAV_COLS - 1);
    const isExplored = sim.exploredGrid[navR * NAV_COLS + midC] > 0;
    const rowCol: RGBA = isExplored ? [32, 62, 88, 230] : [16, 24, 36, 210];
    fb.fillRect(lx, mapY + py, Math.max(2, rx - lx), 2, rowCol);
  }

  // 3. 绘制全图外墙轮廓与内部死角隔墙/门洞/反应堆屏蔽核
  for (const seg of sim.outerWalls) {
    fb.drawLine(
      mapX + (seg.x1 / WORLD_W) * mapW,
      mapY + (seg.y1 / WORLD_H) * mapH,
      mapX + (seg.x2 / WORLD_W) * mapW,
      mapY + (seg.y2 / WORLD_H) * mapH,
      1.3,
      [95, 135, 175, 200],
    );
  }
  for (const seg of sim.deadCornerWalls) {
    fb.drawLine(
      mapX + (seg.x1 / WORLD_W) * mapW,
      mapY + (seg.y1 / WORLD_H) * mapH,
      mapX + (seg.x2 / WORLD_W) * mapW,
      mapY + (seg.y2 / WORLD_H) * mapH,
      2.0,
      themeCol,
    );
  }

  // 4. 绘制北部母巢核心、3座战术节点、尸潮红点、泰坦与我方绿兵小队在全局地图上的实时位置
  if (sim.hive.alive) {
    const hx = mapX + (sim.hive.x / WORLD_W) * mapW;
    const hy = mapY + (sim.hive.y / WORLD_H) * mapH;
    fb.fillCircle(hx, hy, 5.5, [255, 38, 68, 255]);
    fb.strokeRing(hx, hy, 7.5 + Math.sin(frameIdx * 0.2) * 1.5, 1.4, [255, 215, 75, 240]);
  }
  for (const n of sim.nodes) {
    if (n.broken) continue;
    const nx = mapX + (n.x / WORLD_W) * mapW;
    const ny = mapY + (n.y / WORLD_H) * mapH;
    fb.fillCircle(nx, ny, 2.3, [115, 255, 175, 240]);
  }
  for (let i = 0; i < sim.reds.length; i += 2) {
    const r = sim.reds[i];
    const rx = mapX + (r.x / WORLD_W) * mapW;
    const ry = mapY + (r.y / WORLD_H) * mapH;
    if (r.kind === "boss") {
      fb.fillCircle(rx, ry, 3.8, [255, 175, 45, 255]);
    } else {
      fb.fillCircle(rx, ry, 1.5, [235, 48, 68, 195]);
    }
  }
  for (const g of sim.greens) {
    const gx = mapX + (g.x / WORLD_W) * mapW;
    const gy = mapY + (g.y / WORLD_H) * mapH;
    fb.fillCircle(gx, gy, 2.2, [65, 255, 155, 255]);
  }

  // 5. 绘制【实时动态变焦镜头视野跟随白框 (Zoomed Camera Follow Viewport Box)】
  const zoom = clamp(sim.camZoom || 1.0, 1.0, 2.2);
  const vx = mapX + (sim.camX / WORLD_W) * mapW;
  const vy = mapY + (sim.camY / WORLD_H) * mapH;
  const vw = ((ARENA_W / zoom) / WORLD_W) * mapW;
  const vh = ((ARENA_H / zoom) / WORLD_H) * mapH;
  fb.blendRoundRect(vx, vy, vw, vh, 2, [255, 255, 255, 28]);
  fb.strokeRoundRect(vx, vy, vw, vh, 2, 1.8, [255, 255, 255, 245]);
  drawCornerBrackets(
    fb,
    vx + vw * 0.5,
    vy + vh * 0.5,
    vw * 0.5 + 2,
    vh * 0.5 + 2,
    6,
    2.2,
    [125, 245, 255, 255],
  );
}

function hash2i(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * 在大世界底图上绘制高细节真实世界室内家具陈设（带斜投影阴影、材质立体倒角与末日凌乱细节）
 */
function renderInteriorPropIntoWorld(fb: FrameBuf, p: InteriorPropSpec): void {
  const { x, y, w, h, kind } = p;
  const variant = p.variant ?? 0;
  const rot = p.rot ?? 0;

  // 通用地面环境光遮蔽阴影
  fb.blendRoundRect(x + 4, y + 6, w + 2, h + 2, 4, [3, 5, 10, 165]);

  if (kind === "shelf_aisle") {
    // 超市/药店重型双面金属货架 + 彩色商品盒罐排列 + 散落在地上的掉落商品
    fb.fillRoundRect(x, y, w, h, 3, [42, 48, 58, 255]);
    fb.strokeRoundRect(x, y, w, h, 3, 1.5, [108, 120, 136, 240]);
    const isVert = h >= w;
    if (isVert) {
      fb.drawLine(x + w * 0.5, y + 3, x + w * 0.5, y + h - 3, 2.0, [78, 88, 102, 235]);
      const palette: RGBA[] = [
        [195, 68, 58, 235],
        [62, 148, 205, 235],
        [215, 168, 52, 235],
        [68, 175, 112, 235],
        [185, 195, 208, 235],
      ];
      for (let sy = y + 8; sy < y + h - 10; sy += 13) {
        const cL = palette[Math.floor(hash2i(x, sy) * palette.length)];
        const cR = palette[Math.floor(hash2i(x + 19, sy) * palette.length)];
        fb.fillRect(x + 4, sy, Math.max(4, w * 0.5 - 7), 8, cL);
        fb.fillRect(x + w * 0.5 + 3, sy, Math.max(4, w * 0.5 - 7), 8, cR);
      }
      // 散落在货架脚边的掉落罐头与包装盒
      for (let k = 0; k < 4; k++) {
        const side = k % 2 === 0 ? -7 : w + 4;
        const dy = y + 18 + k * ((h - 32) / 3.5);
        const col = palette[(k + variant) % palette.length];
        fb.fillRect(x + side, dy, 5, 5, col);
      }
    } else {
      fb.drawLine(x + 3, y + h * 0.5, x + w - 3, y + h * 0.5, 2.0, [78, 88, 102, 235]);
      for (let sx = x + 8; sx < x + w - 10; sx += 13) {
        const col: RGBA = ((sx >> 3) + variant) % 2 === 0 ? [75, 165, 195, 230] : [205, 145, 58, 230];
        fb.fillRect(sx, y + 4, 8, Math.max(4, h * 0.5 - 6), col);
        fb.fillRect(sx, y + h * 0.5 + 2, 8, Math.max(4, h * 0.5 - 6), [168, 182, 196, 225]);
      }
    }
    return;
  }

  if (kind === "checkout") {
    // 收银台传送带 / 导医接待台 / 后厨不锈钢操作台
    const baseCol: RGBA =
      variant === 2 ? [68, 76, 86, 255] : variant === 1 ? [48, 62, 76, 255] : [58, 48, 40, 255];
    fb.fillRoundRect(x, y, w, h, 4, baseCol);
    fb.strokeRoundRect(x, y, w, h, 4, 1.6, [132, 146, 162, 235]);
    if (h > w) {
      // 黑色橡胶收银传送带 + 扫码收银机屏幕
      fb.fillRect(x + 5, y + 6, Math.max(8, w - 10), Math.max(12, h * 0.58), [22, 25, 30, 250]);
      fb.fillRect(x + 7, y + h * 0.7, Math.max(8, w - 14), 11, [145, 168, 188, 240]);
      fb.fillCircle(x + w * 0.5, y + h * 0.75, 2.5, [95, 235, 185, 245]);
    } else {
      fb.fillRect(x + 8, y + 6, Math.max(12, w - 16), Math.max(6, h - 12), [36, 44, 54, 235]);
      for (let sx = x + 22; sx < x + w - 20; sx += 36) {
        fb.fillRect(sx, y + 8, 16, 10, [135, 185, 215, 235]);
      }
    }
    return;
  }

  if (kind === "round_table") {
    // 餐饮圆桌 + 四周 4 把椅子（含被撞歪/拉出的末日凌乱椅位）+ 桌面餐盘水杯
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const tr = Math.min(w, h) * 0.36;
    for (let ci = 0; ci < 4; ci++) {
      const cAng = rot + (ci * Math.PI) / 2 + (ci === 1 ? 0.32 : ci === 3 ? -0.24 : 0);
      const dist = tr + (ci === 2 ? 11 : 6.5);
      const chX = cx + Math.cos(cAng) * dist;
      const chY = cy + Math.sin(cAng) * dist;
      fb.fillCircle(chX + 2, chY + 2, 6.2, [4, 6, 10, 150]);
      fb.fillCircle(chX, chY, 5.8, variant === 0 ? [92, 52, 42, 245] : [48, 68, 88, 245]);
      fb.strokeRing(chX, chY, 5.8, 1.2, [138, 148, 162, 215]);
    }
    fb.fillCircle(cx + 3, cy + 4, tr + 1, [4, 6, 10, 165]);
    fb.fillCircle(cx, cy, tr, variant === 0 ? [84, 62, 44, 255] : [68, 76, 88, 255]);
    fb.strokeRing(cx, cy, tr, 1.5, [148, 136, 122, 230]);
    // 桌面遗留白色餐盘与水杯
    fb.fillCircle(cx - 5, cy - 3, 3.6, [205, 212, 220, 225]);
    fb.fillCircle(cx + 6, cy + 4, 2.4, [145, 195, 225, 225]);
    return;
  }

  if (kind === "booth_table") {
    // 餐厅双排软包卡座沙发 + 实木餐桌
    const benchCol: RGBA = variant === 0 ? [96, 36, 46, 250] : [38, 58, 84, 250];
    fb.fillRoundRect(x, y, 18, h, 3, benchCol);
    fb.fillRoundRect(x + w - 18, y, 18, h, 3, benchCol);
    fb.strokeRoundRect(x, y, 18, h, 3, 1.2, [145, 95, 105, 210]);
    fb.strokeRoundRect(x + w - 18, y, 18, h, 3, 1.2, [145, 95, 105, 210]);
    fb.fillRoundRect(x + 21, y + 4, w - 42, h - 8, 2, [82, 60, 42, 255]);
    fb.strokeRoundRect(x + 21, y + 4, w - 42, h - 8, 2, 1.3, [142, 118, 92, 230]);
    return;
  }

  if (kind === "clothes_rack") {
    // 服装店/免税店圆形展示岛与彩色挂衣架
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const r = Math.min(w, h) * 0.42;
    fb.fillCircle(cx, cy, r, [34, 40, 50, 250]);
    fb.strokeRing(cx, cy, r, 2.0, [165, 178, 195, 235]);
    const cols: RGBA[] = [
      [185, 62, 78, 235],
      [65, 138, 195, 235],
      [205, 172, 72, 235],
      [88, 165, 128, 235],
    ];
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI * 2) / 10;
      fb.drawLine(
        cx + Math.cos(a) * (r * 0.35),
        cy + Math.sin(a) * (r * 0.35),
        cx + Math.cos(a) * (r * 0.88),
        cy + Math.sin(a) * (r * 0.88),
        3.6,
        cols[(i + variant) % cols.length],
      );
    }
    fb.fillCircle(cx, cy, r * 0.28, [190, 202, 215, 245]);
    return;
  }

  if (kind === "planter") {
    // 商场/航站楼石材坐凳花坛 + 室内棕榈阔叶绿植
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const r = Math.min(w, h) * 0.46;
    fb.fillRoundRect(x, y, w, h, 8, [64, 70, 80, 255]);
    fb.strokeRoundRect(x, y, w, h, 8, 2.0, [122, 132, 146, 235]);
    fb.fillRoundRect(x + 7, y + 7, w - 14, h - 14, 5, [32, 26, 20, 255]);
    for (let f = 0; f < 9; f++) {
      const a = (f * Math.PI * 2) / 9 + variant * 0.4;
      const len = r * (0.68 + (f % 2) * 0.22);
      fb.drawLine(
        cx,
        cy,
        cx + Math.cos(a) * len,
        cy + Math.sin(a) * len,
        4.4,
        f % 2 === 0 ? [36, 118, 68, 245] : [54, 148, 84, 245],
      );
    }
    fb.fillCircle(cx, cy, 6, [68, 168, 96, 250]);
    return;
  }

  if (kind === "vending") {
    // 自动售货机 / 地铁自动售票机（带发光橱窗微光）
    fb.fillRoundRect(x, y, w, h, 3, [36, 46, 62, 255]);
    fb.strokeRoundRect(x, y, w, h, 3, 1.5, [125, 168, 205, 240]);
    const glowCol: RGBA =
      variant === 1 ? [75, 205, 245, 215] : variant === 2 ? [245, 175, 65, 215] : [95, 235, 175, 215];
    fb.fillRect(x + 4, y + 4, Math.max(6, w - 8), Math.max(6, h - 8), glowCol);
    fb.drawGlowCircle(x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.55, [glowCol[0], glowCol[1], glowCol[2], 55]);
    return;
  }

  if (kind === "cart_clutter") {
    // 散落的手推购物车、拉杆行李箱与倾倒纸箱
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const ux = Math.cos(rot);
    const uy = Math.sin(rot);
    const px = -uy;
    const py = ux;
    // 金属网框手推车
    fb.drawLine(cx - ux * 14 - px * 9, cy - uy * 14 - py * 9, cx + ux * 14 - px * 9, cy + uy * 14 - py * 9, 2.0, [155, 170, 188, 230]);
    fb.drawLine(cx - ux * 14 + px * 9, cy - uy * 14 + py * 9, cx + ux * 14 + px * 9, cy + uy * 14 + py * 9, 2.0, [155, 170, 188, 230]);
    fb.drawLine(cx + ux * 14 - px * 9, cy + uy * 14 - py * 9, cx + ux * 14 + px * 9, cy + uy * 14 + py * 9, 2.0, [155, 170, 188, 230]);
    fb.drawLine(cx - ux * 16 - px * 10, cy - uy * 16 - py * 10, cx - ux * 16 + px * 10, cy - uy * 16 + py * 10, 2.6, [215, 68, 58, 240]);
    // 旁侧倾倒瓦楞纸箱与行李箱
    fb.fillRoundRect(cx + 10, cy - 6, 15, 13, 2, [118, 92, 58, 240]);
    fb.strokeRoundRect(cx + 10, cy - 6, 15, 13, 2, 1.2, [158, 128, 86, 225]);
    fb.fillRoundRect(cx - 22, cy + 6, 14, 10, 2, [48, 72, 108, 240]);
    return;
  }

  if (kind === "subway_train") {
    // 真实不锈钢地铁列车车厢（带车顶波纹钢板、3组空调机组、车头双风挡与轻微脱轨偏角）
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const ux = Math.cos(rot);
    const uy = Math.sin(rot);
    const hw = w * 0.46;
    const hh = h * 0.48;
    // 沿着旋转车体中轴绘制高密度实心车体
    for (let t = -hh; t <= hh; t += 3) {
      const bx = cx - uy * t;
      const by = cy + ux * t;
      fb.drawLine(bx - ux * hw, by - uy * hw, bx + ux * hw, by + uy * hw, 4.5, [62, 72, 84, 255]);
    }
    // 车体蓝色/橙色地铁线路腰线与不锈钢顶盖肋条
    const stripeCol: RGBA = variant === 0 ? [48, 138, 215, 240] : [225, 142, 42, 240];
    fb.drawLine(cx - ux * (hw - 2) + uy * hh, cy - uy * (hw - 2) - ux * hh, cx - ux * (hw - 2) - uy * hh, cy - uy * (hw - 2) + ux * hh, 3.0, stripeCol);
    fb.drawLine(cx + ux * (hw - 2) + uy * hh, cy + uy * (hw - 2) - ux * hh, cx + ux * (hw - 2) - uy * hh, cy + uy * (hw - 2) + ux * hh, 3.0, stripeCol);
    for (const acOff of [-hh * 0.58, 0, hh * 0.58]) {
      const ax = cx - uy * acOff;
      const ay = cy + ux * acOff;
      fb.fillRoundRect(ax - 18, ay - 20, 36, 40, 4, [88, 98, 112, 255]);
      fb.strokeRoundRect(ax - 18, ay - 20, 36, 40, 4, 1.5, [138, 150, 166, 235]);
      fb.fillCircle(ax, ay - 8, 6.5, [38, 44, 54, 245]);
      fb.fillCircle(ax, ay + 8, 6.5, [38, 44, 54, 245]);
    }
    // 驾驶室深色前风挡玻璃
    const cabY = cy - ux * (hh - 14);
    const cabX = cx + uy * (hh - 14);
    fb.fillRoundRect(cabX - 24, cabY - 8, 48, 14, 3, [18, 26, 36, 250]);
    return;
  }

  if (kind === "turnstile_row") {
    // 地铁检票不锈钢三辊闸机阵列（含红叉/绿箭通行指示灯）
    const gates = Math.max(3, Math.floor(w / 38));
    const step = w / gates;
    for (let g = 0; g < gates; g++) {
      const gx = x + g * step;
      fb.fillRoundRect(gx, y, 13, h, 3, [86, 98, 114, 255]);
      fb.strokeRoundRect(gx, y, 13, h, 3, 1.2, [152, 168, 185, 235]);
      const openGate = (g + variant) % 3 === 1;
      fb.fillCircle(gx + 6.5, y + 6, 2.4, openGate ? [65, 245, 145, 250] : [255, 65, 75, 250]);
      if (!openGate) {
        fb.drawLine(gx + 13, y + h * 0.5, gx + step - 2, y + h * 0.5, 2.2, [185, 72, 82, 215]);
      }
    }
    return;
  }

  if (kind === "transformer") {
    // 高压变电柜 / 太平间不锈钢冷柜阵列（散热鳍片 + 铜母线排）
    fb.fillRoundRect(x, y, w, h, 4, [44, 52, 62, 255]);
    fb.strokeRoundRect(x, y, w, h, 4, 1.8, [118, 132, 148, 240]);
    if (h >= w) {
      for (let sy = y + 10; sy < y + h - 8; sy += 12) {
        fb.drawLine(x + 5, sy, x + w - 5, sy, 2.0, [74, 86, 100, 230]);
      }
      fb.fillRect(x + w * 0.35, y + 12, w * 0.3, h - 24, [158, 112, 56, 225]);
    } else {
      for (let sx = x + 12; sx < x + w - 10; sx += 14) {
        fb.drawLine(sx, y + 5, sx, y + h - 5, 2.0, [74, 86, 100, 230]);
      }
    }
    return;
  }

  if (kind === "hospital_bed") {
    // 医院急诊病床（白床垫 + 枕头 + 蓝白被单/血迹 + 输液架 + 弧形隐私蓝布帘）
    fb.fillRoundRect(x, y, w, h, 4, [168, 178, 190, 250]);
    fb.strokeRoundRect(x, y, w, h, 4, 1.8, [92, 108, 126, 245]);
    const headLeft = (rot ?? 0) < 1.0;
    const pilX = headLeft ? x + 6 : x + w - 24;
    fb.fillRoundRect(pilX, y + 7, 18, h - 14, 3, [225, 232, 240, 255]);
    const sheetX = headLeft ? x + 28 : x + 6;
    fb.fillRoundRect(sheetX, y + 4, w - 34, h - 8, 3, [78, 136, 178, 245]);
    if (variant === 1) {
      // 病床残留暗红血迹
      fb.blendCircle(x + w * 0.52, y + h * 0.48, 12, [135, 22, 34, 195]);
    }
    // 旁侧不锈钢输液架与蓝色隐私隔帘轨
    const ivX = headLeft ? x + 12 : x + w - 12;
    fb.fillCircle(ivX, y - 7, 4.5, [185, 215, 235, 240]);
    fb.drawLine(x, y + h + 5, x + w * 0.78, y + h + 5, 2.4, [62, 125, 168, 215]);
    return;
  }

  if (kind === "surgical_set") {
    // 手术室无菌绿布手术台 + 双悬臂圆形无影灯 + 器械盘
    fb.fillRoundRect(x + 12, y + 16, w - 24, h - 32, 5, [38, 118, 98, 255]);
    fb.strokeRoundRect(x + 12, y + 16, w - 24, h - 32, 5, 1.8, [125, 205, 185, 240]);
    // 双悬臂无影灯头
    for (const [lx, ly] of [
      [x + w * 0.36, y + 10],
      [x + w * 0.68, y + h - 10],
    ]) {
      fb.drawLine(x + w * 0.5, y + h * 0.5, lx, ly, 2.2, [165, 180, 196, 235]);
      fb.fillCircle(lx, ly, 10.5, [195, 235, 245, 245]);
      fb.strokeRing(lx, ly, 10.5, 1.6, [85, 145, 168, 240]);
      fb.fillCircle(lx, ly, 4.2, [245, 255, 255, 255]);
    }
    fb.fillRoundRect(x + w - 8, y + 20, 16, 26, 2, [155, 170, 186, 245]);
    return;
  }

  if (kind === "mri_scanner") {
    // 核磁共振 (MRI) 圆筒形超导磁体机壳 + 滑轨检查床
    fb.fillRoundRect(x, y, 76, h, 14, [188, 202, 215, 255]);
    fb.strokeRoundRect(x, y, 76, h, 14, 2.2, [82, 138, 168, 245]);
    fb.fillCircle(x + 38, y + h * 0.5, 24, [24, 34, 46, 255]);
    fb.strokeRing(x + 38, y + h * 0.5, 24, 2.4, [75, 195, 215, 240]);
    // 延伸出的滑轨检查床
    fb.fillRoundRect(x + 42, y + h * 0.5 - 15, w - 42, 30, 4, [145, 165, 182, 255]);
    fb.strokeRoundRect(x + 42, y + h * 0.5 - 15, w - 42, 30, 4, 1.5, [90, 112, 132, 240]);
    return;
  }

  if (kind === "seat_row") {
    // 机场/医院不锈钢横梁联排候诊座椅
    const isVert = h > w;
    const count = Math.max(3, Math.floor((isVert ? h : w) / 24));
    if (isVert) {
      fb.drawLine(x + w * 0.5, y + 4, x + w * 0.5, y + h - 4, 3.0, [120, 132, 148, 235]);
      for (let i = 0; i < count; i++) {
        const sy = y + 4 + i * ((h - 8) / count);
        fb.fillRoundRect(x + 3, sy, w - 6, 18, 3, [46, 78, 118, 250]);
        fb.strokeRoundRect(x + 3, sy, w - 6, 18, 3, 1.2, [95, 135, 178, 225]);
      }
    } else {
      fb.drawLine(x + 4, y + h * 0.5, x + w - 4, y + h * 0.5, 3.0, [120, 132, 148, 235]);
      for (let i = 0; i < count; i++) {
        const sx = x + 4 + i * ((w - 8) / count);
        fb.fillRoundRect(sx, y + 3, 19, h - 6, 3, [46, 78, 118, 250]);
        fb.strokeRoundRect(sx, y + 3, 19, h - 6, 3, 1.2, [95, 135, 178, 225]);
      }
    }
    return;
  }

  if (kind === "sofa_l") {
    // 头等舱 VIP 行政酒廊真皮转角沙发 + 实木茶几
    const leather: RGBA = variant === 0 ? [86, 52, 36, 255] : [58, 44, 56, 255];
    fb.fillRoundRect(x, y, 28, h, 5, leather);
    fb.fillRoundRect(x, y, w, 28, 5, leather);
    fb.strokeRoundRect(x, y, 28, h, 5, 1.4, [138, 96, 72, 230]);
    fb.strokeRoundRect(x, y, w, 28, 5, 1.4, [138, 96, 72, 230]);
    fb.fillRoundRect(x + 38, y + 38, w - 44, h - 44, 3, [112, 82, 52, 255]);
    fb.strokeRoundRect(x + 38, y + 38, w - 44, h - 44, 3, 1.3, [168, 132, 94, 235]);
    return;
  }

  if (kind === "xray_checkpoint") {
    // 航站楼安检通道：滚筒行李传送带 + 铅帘X光扫描主机 + 旁边金属安检门框
    fb.fillRoundRect(x + 8, y, w - 16, h, 3, [46, 54, 66, 255]);
    fb.strokeRoundRect(x + 8, y, w - 16, h, 3, 1.5, [122, 138, 156, 235]);
    for (let ry = y + 10; ry < y + h - 10; ry += 10) {
      fb.drawLine(x + 12, ry, x + w - 12, ry, 1.6, [88, 102, 118, 220]);
    }
    // 中段巨型 X 光扫描铅箱主体与侧置安检员屏幕
    fb.fillRoundRect(x, y + h * 0.3, w, h * 0.38, 4, [76, 88, 104, 255]);
    fb.strokeRoundRect(x, y + h * 0.3, w, h * 0.38, 4, 2.0, [158, 175, 195, 245]);
    fb.fillRect(x + w - 14, y + h * 0.42, 11, 18, [85, 215, 245, 240]);
    return;
  }

  if (kind === "glass_window") {
    // 钢化玻璃橱窗隔断 / 观察窗（铝合金窗框 + 半透冰青钢化玻璃 + 斜向高光反光条）
    fb.fillRoundRect(x, y, w, h, 2, [42, 68, 88, 195]);
    fb.strokeRoundRect(x, y, w, h, 2, 1.8, [148, 172, 195, 240]);
    const isHoriz = w >= h;
    if (isHoriz) {
      for (let gx = x + 16; gx < x + w - 18; gx += 28) {
        fb.drawLine(gx, y + 3, gx + 10, y + h - 3, 1.5, [195, 242, 255, 190]);
        fb.drawLine(gx + 14, y + 2, gx + 14, y + h - 2, 1.2, [118, 145, 168, 215]);
      }
    } else {
      for (let gy = y + 16; gy < y + h - 18; gy += 28) {
        fb.drawLine(x + 3, gy, x + w - 3, gy + 10, 1.5, [195, 242, 255, 190]);
        fb.drawLine(x + 2, gy + 14, x + w - 2, gy + 14, 1.2, [118, 145, 168, 215]);
      }
    }
    return;
  }

  if (kind === "cinema_seats") {
    // 巨幕影厅 / 候机指廊成排剧院座椅阵列
    const seatCol: RGBA = variant === 0 ? [98, 30, 42, 245] : [86, 32, 48, 245];
    for (let sy = y + 6; sy < y + h - 12; sy += 22) {
      for (let sx = x + 6; sx < x + w - 14; sx += 20) {
        fb.fillRoundRect(sx, sy, 15, 14, 3, seatCol);
        fb.strokeRoundRect(sx, sy, 15, 14, 3, 1.0, [145, 62, 74, 210]);
      }
    }
  }
}

/**
 * 绘制被子弹/泰坦/爆炸彻底轰碎后的【地面坍塌家具残骸与碎玻璃碴】
 * （破碎后不再阻挡移动，但永久保留逼真木板断茬、倾泻罐头、弯曲钢架与反光玻璃碎片！）
 */
function renderWreckedProp(fb: FrameBuf, p: DestructiblePropState, ox: number, oy: number): void {
  const x = ox + p.x;
  const y = oy + p.y;
  const { w, h, kind, material } = p;
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;

  if (kind === "glass_window" || material === "glass") {
    // 碎裂铝合金空窗框 + 满地晶莹反光玻璃碴
    fb.strokeRoundRect(x, y, w, h, 2, 1.3, [78, 92, 108, 165]);
    for (let k = 0; k < 14; k++) {
      const ha = hash2i(p.id * 13 + k, 7);
      const hb = hash2i(p.id * 29 + k, 19);
      const sx = x - 8 + ha * (w + 16);
      const sy = y - 10 + hb * (h + 20);
      const ang = (ha * 6.28) + k;
      fb.drawLine(
        sx,
        sy,
        sx + Math.cos(ang) * 6.5,
        sy + Math.sin(ang) * 6.5,
        1.6,
        k % 2 === 0 ? [175, 235, 255, 195] : [115, 195, 232, 165],
      );
    }
    return;
  }

  // 坍塌暗色焦痕底影
  fb.blendRoundRect(x - 2, y - 2, w + 4, h + 4, 5, [10, 12, 18, 155]);

  if (kind === "shelf_aisle" || kind === "vending") {
    // 扭曲倾倒的货架钢梁 + 散落一地的彩色商品盒罐
    fb.drawLine(x + 4, y + 6, x + w - 4, y + h - 6, 3.0, [64, 74, 88, 215]);
    fb.drawLine(x + w - 5, y + 8, x + 5, y + h - 8, 2.4, [82, 94, 110, 195]);
    const cols: RGBA[] = [
      [205, 65, 55, 215],
      [62, 152, 215, 215],
      [215, 172, 48, 215],
      [68, 178, 112, 215],
    ];
    for (let k = 0; k < 12; k++) {
      const sx = x - 6 + hash2i(p.id + k * 7, 3) * (w + 12);
      const sy = y - 6 + hash2i(p.id + k * 11, 9) * (h + 12);
      fb.fillRect(sx, sy, 5, 4, cols[k % cols.length]);
    }
    return;
  }

  if (material === "wood") {
    // 劈裂成数截的实木桌面断板 + 翻倒椅圈与碎瓷片
    for (let k = 0; k < 6; k++) {
      const ha = hash2i(p.id * 17 + k, 5);
      const hb = hash2i(p.id * 31 + k, 11);
      const sx = x + ha * w * 0.85;
      const sy = y + hb * h * 0.85;
      const ang = (ha - 0.5) * 3.1;
      const len = 14 + hb * 10;
      fb.drawLine(
        sx - Math.cos(ang) * len * 0.5,
        sy - Math.sin(ang) * len * 0.5,
        sx + Math.cos(ang) * len * 0.5,
        sy + Math.sin(ang) * len * 0.5,
        3.6,
        k % 2 === 0 ? [96, 68, 44, 225] : [74, 52, 34, 215],
      );
    }
    fb.fillCircle(cx + 6, cy - 4, 2.5, [205, 215, 225, 195]);
    return;
  }

  // 金属/织物/绿植花坛破碎残骸（弯曲钢管、撕裂坐垫海绵或散落棕榈断叶）
  for (let k = 0; k < 7; k++) {
    const ha = hash2i(p.id * 19 + k, 13);
    const hb = hash2i(p.id * 41 + k, 23);
    const sx = x + ha * w;
    const sy = y + hb * h;
    const ang = ha * 6.28;
    const col: RGBA =
      material === "stone"
        ? k % 2 === 0
          ? [46, 138, 72, 215]
          : [92, 98, 108, 215]
        : material === "fabric"
          ? k % 2 === 0
            ? [168, 185, 205, 205]
            : [64, 108, 148, 205]
          : [98, 110, 126, 215];
    fb.drawLine(sx, sy, sx + Math.cos(ang) * 11, sy + Math.sin(ang) * 11, 2.8, col);
  }
}

/**
 * 实时绘制视野内所有动态可破坏家具（完好态带受击震颤/渐进裂纹/高光闪白；破碎态化为满地逼真残骸！）
 */
function renderDynamicInteriorProps(fb: FrameBuf, sim: SiegeSimulator): void {
  const { camX, camY, zoom } = getEffectiveCam(sim);
  const viewW = ARENA_W / zoom;
  const viewH = ARENA_H / zoom;
  const ox = BOARD_X - camX;
  const oy = BOARD_Y - camY;

  for (let i = 0; i < sim.props.length; i++) {
    const p = sim.props[i];
    if (
      p.x + p.w < camX - 36 ||
      p.x > camX + viewW + 36 ||
      p.y + p.h < camY - 36 ||
      p.y > camY + viewH + 36
    ) {
      continue;
    }

    if (!p.intact) {
      renderWreckedProp(fb, p, ox, oy);
      continue;
    }

    const drawX = ox + p.x + p.shakeX;
    const drawY = oy + p.y + p.shakeY;
    renderInteriorPropIntoWorld(fb, {
      ...p,
      x: drawX,
      y: drawY,
    });

    // 渐进受损裂纹细节：当耐久低于 68% 时浮现清晰弹孔与结构裂痕！
    const hpRatio = p.hp / Math.max(1, p.maxHp);
    if (!p.indestructible && hpRatio < 0.68) {
      const cx = drawX + p.w * 0.5;
      const cy = drawY + p.h * 0.5;
      const crackCol: RGBA =
        p.material === "glass" ? [215, 250, 255, 235] : [22, 18, 16, 225];
      fb.drawLine(cx - p.w * 0.28, cy - p.h * 0.22, cx + p.w * 0.12, cy + p.h * 0.26, 1.6, crackCol);
      fb.drawLine(cx + p.w * 0.24, cy - p.h * 0.18, cx - p.w * 0.08, cy + p.h * 0.15, 1.4, crackCol);
    }

    // 受击瞬间高亮闪白反馈
    if (p.hitFlash > 0.2) {
      const flashA = Math.round(p.hitFlash * 115);
      fb.blendRoundRect(drawX, drawY, p.w, p.h, 3, [255, 245, 215, flashA]);
    }
  }
}

/**
 * 在每一处房间出入口绘制真实建筑【金属门槛踏板 + 90° 地面扫掠开门弧线 + 推开的玻璃门/防火门扇】
 */
function renderDoorwayIntoWorld(fb: FrameBuf, d: DoorwaySpec): void {
  const ux = Math.cos(d.wallAngle);
  const uy = Math.sin(d.wallAngle);
  const nx = -uy * d.openSign;
  const ny = ux * d.openSign;

  // 1. 地面拉丝不锈钢门槛踏板
  const ex = d.hx + ux * d.width;
  const ey = d.hy + uy * d.width;
  fb.drawLine(d.hx, d.hy, ex, ey, 6.0, [52, 60, 72, 235]);
  fb.drawLine(d.hx, d.hy, ex, ey, 1.6, [118, 132, 148, 210]);

  const drawLeaf = (hingeX: number, hingeY: number, dirAlong: 1 | -1, leafLen: number, openRad: number) => {
    // 地面开门虚线圆弧轨迹（建筑平面图精髓质感！）
    const steps = 10;
    for (let s = 0; s < steps; s += 2) {
      const a0 = (s / steps) * openRad;
      const a1 = ((s + 1) / steps) * openRad;
      const p0x = hingeX + (ux * dirAlong * Math.cos(a0) + nx * Math.sin(a0)) * leafLen;
      const p0y = hingeY + (uy * dirAlong * Math.cos(a0) + ny * Math.sin(a0)) * leafLen;
      const p1x = hingeX + (ux * dirAlong * Math.cos(a1) + nx * Math.sin(a1)) * leafLen;
      const p1y = hingeY + (uy * dirAlong * Math.cos(a1) + ny * Math.sin(a1)) * leafLen;
      fb.drawLine(p0x, p0y, p1x, p1y, 1.2, [95, 112, 132, 115]);
    }
    // 推开的真实门扇实体与门把手
    const tipX = hingeX + (ux * dirAlong * Math.cos(openRad) + nx * Math.sin(openRad)) * leafLen;
    const tipY = hingeY + (uy * dirAlong * Math.cos(openRad) + ny * Math.sin(openRad)) * leafLen;
    fb.drawLine(hingeX + 3, hingeY + 4, tipX + 3, tipY + 4, 6.5, [4, 6, 10, 155]);
    fb.drawLine(
      hingeX,
      hingeY,
      tipX,
      tipY,
      5.8,
      d.glass ? [78, 128, 158, 235] : [88, 72, 56, 250],
    );
    fb.drawLine(
      hingeX,
      hingeY,
      tipX,
      tipY,
      2.0,
      d.glass ? [175, 225, 245, 230] : [148, 132, 112, 235],
    );
  };

  if (d.doubleDoor) {
    const leaf = Math.min(54, d.width * 0.34);
    drawLeaf(d.hx + ux * 6, d.hy + uy * 6, 1, leaf, 1.32);
    drawLeaf(ex - ux * 6, ey - uy * 6, -1, leaf, 1.46);
  } else {
    drawLeaf(d.hx + ux * 6, d.hy + uy * 6, 1, Math.min(68, d.width * 0.72), 1.38);
  }
}

/**
 * 构建 1800 x 3000 高真实度末日商业综合体/地铁站/三甲医院/国际航站楼世界底图 (`buildWorldBackground`)
 */
function buildWorldBackground(modeId: SiegeModeId, _atlas: FontAtlas): Uint8ClampedArray {
  const fb = new FrameBuf(WORLD_W, WORLD_H, [7, 9, 14, 255]);
  const raw = fb.data;
  const outerSegments = getOuterWallSegments(modeId);

  for (let wy = 0; wy < WORLD_H; wy++) {
    const bnd = getCorridorBounds(wy, modeId);
    const leftEdge = bnd.left;
    const rightEdge = bnd.right;
    const isTopWall = wy < 40;
    const isBottomWall = wy >= 2860;

    for (let wx = 0; wx < WORLD_W; wx++) {
      const idx = (wy * WORLD_W + wx) * 4;
      const distToLeft = wx - leftEdge;
      const distToRight = rightEdge - wx;
      const minEdgeDist = isTopWall
        ? 40 - wy
        : isBottomWall
          ? wy - 2860
          : Math.min(distToLeft, distToRight);

      if (!isTopWall && !isBottomWall && distToLeft >= 0 && distToRight >= 0) {
        // 1. 真实水磨石/花岗岩/环氧地坪基色 + 空间微噪点磨损脏迹（彻底告别塑料纯色块！）
        const grit = Math.round((hash2i(wx >> 2, wy >> 2) - 0.5) * 5 + (hash2i(wx >> 5, wy >> 5) - 0.5) * 6);
        let r = 24 + grit;
        let g = 27 + grit;
        let b = 33 + grit;

        if (modeId === "scavenge") {
          // 购物中心米灰水磨石主中庭地砖 + 双道黄铜装饰镶边
          r = 25 + grit;
          g = 28 + grit;
          b = 34 + grit;
          if (wx % 72 === 0 || wy % 72 === 0) {
            r -= 4;
            g -= 4;
            b -= 5;
          }
          const borderDist = Math.min(Math.abs(distToLeft - 52), Math.abs(distToRight - 52));
          if (borderDist <= 2) {
            r += 14;
            g += 11;
            b += 4;
          }
        } else if (modeId === "blackout") {
          // 地铁站深灰防滑花岗岩地砖 + 站台边缘明黄盲道警示砖条！
          r = 23 + grit;
          g = 25 + grit;
          b = 30 + grit;
          if (wx % 56 === 0 || wy % 56 === 0) {
            r -= 4;
            g -= 4;
            b -= 4;
          }
          const nearTrackEdge =
            wy >= 1450 &&
            wy <= 2340 &&
            (wy < 1830 || wy > 1990) &&
            (Math.abs(wx - 696) <= 5 || Math.abs(wx - 1004) <= 5);
          if (nearTrackEdge && (wy % 10 < 7)) {
            r = 165;
            g = 132;
            b = 28;
          }
        } else if (modeId === "sonar") {
          // 医院水磨石走廊 + 地面急诊红/外科青/影像黄三色科室导引地标线！
          r = 22 + grit;
          g = 29 + grit;
          b = 33 + grit;
          if (wx % 60 === 0 || wy % 60 === 0) {
            r -= 4;
            g -= 4;
            b -= 4;
          }
          if (wy >= 1460 && wy <= 2580) {
            const dGuide = wx - (CORRIDOR_CX - 36);
            if (dGuide >= 0 && dGuide <= 3) {
              r = 148;
              g = 42;
              b = 48;
            } else if (dGuide >= 6 && dGuide <= 9) {
              r = 42;
              g = 138;
              b = 132;
            } else if (dGuide >= 12 && dGuide <= 15) {
              r = 158;
              g = 128;
              b = 42;
            }
          }
        } else if (modeId === "maze-infect") {
          // 国际航站楼抛光石英地砖
          r = 26 + grit;
          g = 27 + grit;
          b = 34 + grit;
          if (wx % 64 === 0 || wy % 64 === 0) {
            r -= 4;
            g -= 4;
            b -= 5;
          }
        }

        // 北部丧尸母巢周围生物菌毯腐蚀渐变
        const dxHive = wx - CORRIDOR_CX;
        const dyHive = wy - 230;
        const distToHive = Math.hypot(dxHive, dyHive);
        if (distToHive < 290) {
          const creep = (290 - distToHive) / 290;
          const veinWave = Math.sin(Math.atan2(dyHive, dxHive) * 14 + distToHive * 0.07);
          const veinBoost = veinWave > 0.72 ? 18 * creep : 0;
          r = Math.round(r + creep * 28 + veinBoost);
          g = Math.round(g - creep * 5);
          b = Math.round(b + creep * 7 + veinBoost * 0.3);
        }

        // 外墙根部自然踢脚线环境光遮蔽阴影
        if (minEdgeDist < 22) {
          const ao = (22 - minEdgeDist) / 22;
          r = Math.round(r * (1 - ao * 0.52));
          g = Math.round(g * (1 - ao * 0.52));
          b = Math.round(b * (1 - ao * 0.52));
        }

        raw[idx] = clamp(r, 0, 255);
        raw[idx + 1] = clamp(g, 0, 255);
        raw[idx + 2] = clamp(b, 0, 255);
        raw[idx + 3] = 255;
      } else {
        // 2. 真实建筑厚重混凝土外立面幕墙与室外暗黑沥青路面（彻底移除霓虹斜纹警告带与科幻铆钉！）
        const wallDepth = isTopWall
          ? 40 - wy
          : isBottomWall
            ? wy - 2860
            : distToLeft < 0
              ? -distToLeft
              : -distToRight;

        if (wallDepth <= 3.0) {
          raw[idx] = 88;
          raw[idx + 1] = 96;
          raw[idx + 2] = 108;
          raw[idx + 3] = 255;
        } else if (wallDepth <= 22) {
          // 建筑外墙钢筋混凝土墙体 + 幕墙玻璃窗格凹槽
          const isWindowBay = !isTopWall && !isBottomWall && (wy % 140 >= 28 && wy % 140 <= 108) && wallDepth >= 8 && wallDepth <= 15;
          if (isWindowBay) {
            raw[idx] = 24;
            raw[idx + 1] = 36;
            raw[idx + 2] = 48;
          } else {
            const concreteGrit = Math.round((hash2i(wx >> 1, wy >> 1) - 0.5) * 6);
            raw[idx] = 40 + concreteGrit;
            raw[idx + 1] = 45 + concreteGrit;
            raw[idx + 2] = 54 + concreteGrit;
          }
          raw[idx + 3] = 255;
        } else {
          // 室外深暗街区地坪
          const extGrid = (wx % 96 === 0 || wy % 96 === 0) ? 3 : 0;
          raw[idx] = 10 + extGrid;
          raw[idx + 1] = 12 + extGrid;
          raw[idx + 2] = 17 + extGrid;
          raw[idx + 3] = 255;
        }
      }
    }
  }

  // 3. 绘制非对称商铺地面材质、地铁碎石道床双铁轨、跨轨过街天桥与自动扶梯天井
  const archZones = getArchZones(modeId);
  for (const z of archZones) {
    if (z.kind === "shop") {
      for (let py = Math.max(0, z.y); py < Math.min(WORLD_H, z.y + z.h); py++) {
        for (let px = Math.max(0, z.x); px < Math.min(WORLD_W, z.x + z.w); px++) {
          const idx = (py * WORLD_W + px) * 4;
          const grit = Math.round((hash2i(px >> 2, py >> 2) - 0.5) * 5);
          let fr = 26 + grit;
          let fg = 30 + grit;
          let fbCol = 38 + grit;
          if (z.floorStyle === "wood") {
            const seam = py % 16 === 0 || (px + ((py / 16) | 0) * 41) % 88 === 0 ? -7 : 0;
            const grain = Math.round(Math.sin(py * 0.9 + hash2i(px >> 4, py >> 4) * 3) * 2);
            fr = 48 + seam + grain + grit;
            fg = 35 + seam + grain + grit;
            fbCol = 25 + seam + grit;
          } else if (z.floorStyle === "checker") {
            const chk = (((px >> 4) + (py >> 4)) & 1) === 0;
            fr = (chk ? 44 : 23) + grit;
            fg = (chk ? 45 : 26) + grit;
            fbCol = (chk ? 50 : 32) + grit;
          } else if (z.floorStyle === "clinical") {
            const seam = px % 36 === 0 || py % 36 === 0 ? -5 : 0;
            fr = 30 + seam + grit;
            fg = 41 + seam + grit;
            fbCol = 47 + seam + grit;
          } else if (z.floorStyle === "tile_warm") {
            const seam = px % 44 === 0 || py % 44 === 0 ? -5 : 0;
            fr = 39 + seam + grit;
            fg = 37 + seam + grit;
            fbCol = 34 + seam + grit;
          } else if (z.floorStyle === "carpet") {
            const pat = ((px % 24 < 3) && (py % 24 < 3)) ? 6 : ((px + py) % 6 === 0 ? 2 : 0);
            fr = 40 + pat + grit;
            fg = 20 + (pat >> 1) + grit;
            fbCol = 29 + pat + grit;
          } else {
            const seam = px % 48 === 0 || py % 48 === 0 ? -4 : 0;
            fr = 28 + seam + grit;
            fg = 33 + seam + grit;
            fbCol = 41 + seam + grit;
          }
          raw[idx] = clamp(fr, 0, 255);
          raw[idx + 1] = clamp(fg, 0, 255);
          raw[idx + 2] = clamp(fbCol, 0, 255);
        }
      }
    } else if (z.kind === "atrium_pit") {
      fb.fillRoundRect(z.x, z.y, z.w, z.h, 6, [9, 12, 18, 255]);
      fb.strokeRoundRect(z.x + 4, z.y + 4, z.w - 8, z.h - 8, 5, 2.0, [58, 72, 90, 230]);
      if (modeId === "blackout" && z.h >= 240) {
        // 地铁下沉碎石道床 + 枕木 + 双股并行工字钢铁轨！
        for (const trackCx of [z.x + z.w * 0.33, z.x + z.w * 0.67]) {
          for (let ty = z.y + 12; ty < z.y + z.h - 10; ty += 14) {
            fb.fillRect(trackCx - 24, ty, 48, 5, [46, 36, 28, 245]);
          }
          fb.drawLine(trackCx - 15, z.y + 6, trackCx - 15, z.y + z.h - 6, 2.4, [138, 150, 166, 240]);
          fb.drawLine(trackCx + 15, z.y + 6, trackCx + 15, z.y + z.h - 6, 2.4, [138, 150, 166, 240]);
        }
      } else if (z.h >= 135) {
        // 商场/医院/航站楼双并排跨层自动扶梯金属踏步与玻璃扶手
        for (const escOff of [-34, 34]) {
          const ex = z.x + z.w * 0.5 + escOff;
          fb.fillRoundRect(ex - 17, z.y + 16, 34, z.h - 32, 3, [22, 28, 38, 255]);
          fb.strokeRoundRect(ex - 17, z.y + 16, 34, z.h - 32, 3, 2.0, [96, 124, 152, 235]);
          for (let sy = z.y + 22; sy < z.y + z.h - 20; sy += 8) {
            fb.drawLine(ex - 14, sy, ex + 14, sy, 1.2, [58, 72, 92, 220]);
          }
        }
      }
    } else if (z.kind === "bridge_deck") {
      // 地铁跨轨行人过街天桥防滑钢板桥面与南北护栏
      fb.blendRoundRect(z.x - 4, z.y + 6, z.w + 8, z.h + 8, 4, [2, 4, 8, 210]);
      fb.fillRoundRect(z.x, z.y, z.w, z.h, 3, [42, 48, 58, 255]);
      for (let bx = z.x + 16; bx < z.x + z.w - 12; bx += 24) {
        fb.drawLine(bx, z.y + 6, bx, z.y + z.h - 6, 1.3, [58, 66, 78, 215]);
      }
      fb.drawLine(z.x, z.y + 3, z.x + z.w, z.y + 3, 3.2, [135, 148, 165, 245]);
      fb.drawLine(z.x, z.y + z.h - 3, z.x + z.w, z.y + z.h - 3, 3.2, [135, 148, 165, 245]);
    } else if (z.kind === "pillar") {
      fb.blendRoundRect(z.x + 4, z.y + 6, z.w + 4, z.h + 4, 3, [3, 5, 10, 195]);
      fb.fillRoundRect(z.x, z.y, z.w, z.h, 3, [48, 55, 66, 255]);
      fb.strokeRoundRect(z.x, z.y, z.w, z.h, 3, 1.6, [118, 132, 148, 235]);
    }
  }

  // 4. 在地板上绘制末日真实生活杂物微细节（散落传单纸张、碎玻璃渣、干涸血迹拖痕）
  const modeSeed = modeId.charCodeAt(0) * 31 + modeId.charCodeAt(1) * 17;
  for (let i = 0; i < 155; i++) {
    const ry = 280 + Math.floor(hash2i(i, modeSeed) * 2480);
    const bnd = getCorridorBounds(ry, modeId);
    const rx = Math.floor(bnd.left + 36 + hash2i(i + 97, modeSeed) * (bnd.right - bnd.left - 72));
    const kindRoll = i % 5;
    if (kindRoll <= 2) {
      // 散落白纸/宣传单
      fb.fillRect(rx, ry, 6, 4, [155, 162, 172, 125]);
    } else if (kindRoll === 3) {
      // 橱窗碎裂玻璃反光碴
      fb.drawLine(rx, ry, rx + 5, ry + 3, 1.3, [165, 215, 240, 135]);
      fb.drawLine(rx + 4, ry - 2, rx + 8, ry + 2, 1.1, [185, 230, 250, 120]);
    } else {
      // 地面陈旧暗褐血渍拖痕
      fb.blendCircle(rx, ry, 9, [68, 16, 22, 85]);
      fb.drawLine(rx, ry, rx + 14, ry - 8, 3.2, [58, 14, 20, 75]);
    }
  }

  // 5. 室内家具改为在帧循环中实时动态渲染 (renderDynamicInteriorProps)，以支持受击震颤、裂纹与彻底崩碎残骸！

  // 6. 为所有室内隔墙预先烘焙地面环境光遮蔽阴影，并在每处门洞绘制推开的门扇与开门弧线
  const innerWalls = getDeadCornerWalls(modeId);
  for (const w of innerWalls) {
    const minX = Math.min(w.x1, w.x2) - 8;
    const maxX = Math.max(w.x1, w.x2) + 8;
    const minY = Math.min(w.y1, w.y2) - 8;
    const maxY = Math.max(w.y1, w.y2) + 8;
    fb.blendRoundRect(minX + 6, minY + 8, maxX - minX + 4, maxY - minY + 4, 3, [3, 5, 9, 135]);
  }
  const doorways = getDoorways(modeId);
  for (const dw of doorways) {
    renderDoorwayIntoWorld(fb, dw);
  }

  // 7. 外墙沉稳建筑结构轮廓线（取代刺眼的霓虹框线）
  for (const seg of outerSegments) {
    fb.drawLine(seg.x1, seg.y1, seg.x2, seg.y2, 2.2, [96, 108, 124, 220]);
  }

  // 8. 北部母巢核心 (900, 230) 下方生物主血管与孵化腔
  const hiveWorldX = CORRIDOR_CX;
  const hiveWorldY = 230;
  for (const offset of [-145, 0, 145]) {
    const vx = CORRIDOR_CX + offset;
    const vy = 320;
    fb.drawLine(hiveWorldX + offset * 0.25, hiveWorldY + 38, vx, vy, 5.2, [85, 14, 30, 195]);
    fb.drawLine(hiveWorldX + offset * 0.25, hiveWorldY + 38, vx, vy, 2.2, [175, 28, 54, 215]);
    fb.blendCircle(vx, vy, 24, [42, 8, 18, 225]);
    drawPolygonLines(fb, vx, vy, 23, 6, Math.PI / 6, 2.0, [165, 32, 56, 220], true, [95, 18, 34, 160]);
    fb.fillCircle(vx, vy, 9, [210, 38, 62, 215]);
  }

  return new Uint8ClampedArray(fb.data);
}

/**
 * 将持久化血迹与晶石碎屑刻入 1800x3000 大世界底图
 */
function bakeDecalsIntoBackground(worldBgRaw: Uint8ClampedArray, sim: SiegeSimulator): void {
  if (sim.pendingDecals.length === 0) return;
  const fb = new FrameBuf(WORLD_W, WORLD_H);
  fb.data.set(worldBgRaw);

  for (const d of sim.pendingDecals) {
    const cx = d.x;
    const cy = d.y;
    if (d.kind === "blood") {
      fb.blendCircle(cx, cy, d.r, [72, 12, 22, 105]);
      fb.blendCircle(cx + 3, cy - 2, d.r * 0.55, [96, 16, 28, 120]);
      for (let s = 0; s < 3; s++) {
        const ang = ((d.seed + s * 2.1) % 6.28);
        fb.drawLine(
          cx,
          cy,
          cx + Math.cos(ang) * (d.r * 1.45),
          cy + Math.sin(ang) * (d.r * 1.45),
          1.6,
          [92, 14, 26, 115],
        );
      }
    } else if (d.kind === "boss_blood") {
      fb.blendCircle(cx, cy, d.r, [98, 12, 28, 155]);
      fb.blendCircle(cx - 5, cy + 4, d.r * 0.65, [135, 18, 36, 165]);
      for (let s = 0; s < 8; s++) {
        const ang = (s * Math.PI * 2) / 8 + (d.seed % 3) * 0.2;
        fb.drawLine(
          cx,
          cy,
          cx + Math.cos(ang) * (d.r * 1.35),
          cy + Math.sin(ang) * (d.r * 1.35),
          2.4,
          [125, 16, 34, 150],
        );
      }
    } else if (d.kind === "crystals") {
      fb.blendCircle(cx, cy, d.r, [32, 75, 98, 125]);
      drawPolygonLines(fb, cx, cy, d.r * 0.9, 6, 0.3, 2.0, [95, 225, 255, 155], true);
    } else if (d.kind === "scorch") {
      // 机载破片火箭弹与重火力爆炸焦黑弹坑 + 放射状烟尘裂纹
      fb.blendCircle(cx, cy, d.r * 1.15, [10, 8, 12, 165]);
      fb.blendCircle(cx, cy, d.r * 0.62, [28, 16, 12, 185]);
      fb.strokeRing(cx, cy, d.r * 0.72, 1.5, [165, 78, 28, 115]);
      for (let s = 0; s < 7; s++) {
        const ang = (s * Math.PI * 2) / 7 + (d.seed % 5) * 0.19;
        fb.drawLine(
          cx + Math.cos(ang) * (d.r * 0.35),
          cy + Math.sin(ang) * (d.r * 0.35),
          cx + Math.cos(ang) * (d.r * 1.48),
          cy + Math.sin(ang) * (d.r * 1.48),
          1.8,
          [18, 14, 18, 145],
        );
      }
    } else if (d.kind === "tire") {
      // 重型装甲大巴加宽双排轮胎橡胶压痕
      for (const txOff of [-26, 26]) {
        fb.blendRoundRect(cx + txOff - 4, cy - 10, 8, 20, 2, [5, 7, 11, 145]);
        fb.drawLine(cx + txOff - 3, cy - 4, cx + txOff + 3, cy + 3, 1.4, [28, 36, 48, 125]);
      }
    }
  }

  sim.pendingDecals.length = 0;
  worldBgRaw.set(fb.data);
}

/**
 * 将 1800x3000 大世界底图按任意平滑变焦倍率 (zoom = 1.0..2.15) 双线性插值高速投射至 984x1520 帧缓冲
 */
function blitWorldToViewport(
  fb: FrameBuf,
  worldBgRaw: Uint8ClampedArray,
  camX: number,
  camY: number,
  zoom: number,
): void {
  const dst = fb.data;
  if (Math.abs(zoom - 1.0) < 0.002) {
    const cx = clamp(Math.round(camX), 0, WORLD_W - ARENA_W);
    const cy = clamp(Math.round(camY), 0, WORLD_H - ARENA_H);
    const rowBytes = ARENA_W * 4;
    for (let ay = 0; ay < ARENA_H; ay++) {
      const srcStart = ((cy + ay) * WORLD_W + cx) * 4;
      const dstStart = ((BOARD_Y + ay) * OUT_W + BOARD_X) * 4;
      dst.set(worldBgRaw.subarray(srcStart, srcStart + rowBytes), dstStart);
    }
    return;
  }

  const invZ = 1 / zoom;
  const x0Arr = new Int32Array(ARENA_W);
  const x1Arr = new Int32Array(ARENA_W);
  const fxArr = new Int32Array(ARENA_W);
  for (let ax = 0; ax < ARENA_W; ax++) {
    const wx = clamp(camX + ax * invZ, 0, WORLD_W - 1.001);
    const ix = wx | 0;
    x0Arr[ax] = ix * 4;
    x1Arr[ax] = Math.min(WORLD_W - 1, ix + 1) * 4;
    fxArr[ax] = ((wx - ix) * 256) | 0;
  }

  const rowStride = WORLD_W * 4;
  for (let ay = 0; ay < ARENA_H; ay++) {
    const wy = clamp(camY + ay * invZ, 0, WORLD_H - 1.001);
    const iy = wy | 0;
    const fy = ((wy - iy) * 256) | 0;
    const invFy = 256 - fy;
    const row0 = iy * rowStride;
    const row1 = Math.min(WORLD_H - 1, iy + 1) * rowStride;
    let dIdx = ((BOARD_Y + ay) * OUT_W + BOARD_X) * 4;

    for (let ax = 0; ax < ARENA_W; ax++) {
      const fx = fxArr[ax];
      const invFx = 256 - fx;
      const w00 = invFx * invFy;
      const w10 = fx * invFy;
      const w01 = invFx * fy;
      const w11 = fx * fy;
      const i00 = row0 + x0Arr[ax];
      const i10 = row0 + x1Arr[ax];
      const i01 = row1 + x0Arr[ax];
      const i11 = row1 + x1Arr[ax];

      dst[dIdx] =
        (worldBgRaw[i00] * w00 +
          worldBgRaw[i10] * w10 +
          worldBgRaw[i01] * w01 +
          worldBgRaw[i11] * w11) >>
        16;
      dst[dIdx + 1] =
        (worldBgRaw[i00 + 1] * w00 +
          worldBgRaw[i10 + 1] * w10 +
          worldBgRaw[i01 + 1] * w01 +
          worldBgRaw[i11 + 1] * w11) >>
        16;
      dst[dIdx + 2] =
        (worldBgRaw[i00 + 2] * w00 +
          worldBgRaw[i10 + 2] * w10 +
          worldBgRaw[i01 + 2] * w01 +
          worldBgRaw[i11 + 2] * w11) >>
        16;
      dst[dIdx + 3] = 255;
      dIdx += 4;
    }
  }
}

/**
 * 裁剪掉超出战场视口 (BOARD_X..BOARD_X+ARENA_W, BOARD_Y..BOARD_Y+ARENA_H) 的绘制溢出，并绘制双层精密外框
 */
function clipHudMarginsAndDrawArenaBorder(fb: FrameBuf, modeId: SiegeModeId): void {
  // 顶部、底部与左右外侧边栏恢复深邃暗黑 HUD 底色
  fb.fillRect(0, 0, OUT_W, BOARD_Y, [8, 10, 15, 255]);
  fb.fillRect(0, BOARD_Y + ARENA_H, OUT_W, OUT_H - (BOARD_Y + ARENA_H), [8, 10, 15, 255]);
  fb.fillRect(0, BOARD_Y, BOARD_X, ARENA_H, [8, 10, 15, 255]);
  fb.fillRect(BOARD_X + ARENA_W, BOARD_Y, OUT_W - (BOARD_X + ARENA_W), ARENA_H, [8, 10, 15, 255]);

  const wallLineCol: RGBA =
    modeId === "blackout"
      ? [255, 205, 75, 240]
      : modeId === "sonar"
        ? [75, 245, 215, 240]
        : modeId === "maze-infect"
          ? [245, 95, 215, 240]
          : [135, 220, 255, 240];
  fb.strokeRoundRect(BOARD_X - 3, BOARD_Y - 3, ARENA_W + 6, ARENA_H + 6, 5, 2, wallLineCol);
  fb.strokeRoundRect(BOARD_X - 7, BOARD_Y - 7, ARENA_W + 14, ARENA_H + 14, 8, 1, [42, 54, 74, 180]);
}

/**
 * 使用 ffmpeg 解码外部自定义 BGM 音频文件（支持 mp3/wav/m4a/ogg），自动循环或裁剪至目标时长
 */
function loadExternalBgmSamples(bgmPath: string, durationSec: number, sr = 44100): Float32Array {
  const buf = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-stream_loop",
      "-1",
      "-i",
      bgmPath,
      "-t",
      String(durationSec),
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      String(sr),
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/**
 * 写入 44.1kHz 16-bit 双声道立体声 WAV 文件 (True Stereo Spatial PCM)
 */
function writeStereoWav(left: Float32Array, right: Float32Array, path: string): void {
  const sr = 44100;
  const n = Math.min(left.length, right.length);
  const dataBytes = n * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // 2 channels (Stereo)
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
    const r = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
    const off = 44 + i * 4;
    buf.writeInt16LE(l, off);
    buf.writeInt16LE(r, off + 2);
  }
  writeFileSync(path, buf);
}

/**
 * 工业级双声道空间混音母带引擎：
 * - 132 BPM D-Minor Drift Phonk 三幕式电子乐（808 Sub-Bass 居中锚定 + Cowbell/Pad 立体声展开）
 * - 开场载具专属物理声场（黑鹰四叶旋翼拍击涡流声 / 重装柴油 V8 轰鸣 + 气动刹车泄压声）
 * - 基于战场 X 坐标等功率声像定位 (Equal-Power Stereo Panning) 的抛壳枪声、机载火箭呼啸爆炸、丧尸爆浆 ASMR
 * - 自动侧链闪避 (Sidechain Ducking) + 软削波母带限制器
 */
function buildSiegeStereoAudioTrack(
  events: SiegeAudioEvent[],
  durationSec: number,
  modeId: SiegeModeId,
  externalBgm?: Float32Array,
): { left: Float32Array; right: Float32Array } {
  const sr = 44100;
  const totalSamples = Math.ceil(durationSec * sr);
  const bgmL = new Float32Array(totalSamples);
  const bgmR = new Float32Array(totalSamples);
  const sfxL = new Float32Array(totalSamples);
  const sfxR = new Float32Array(totalSamples);
  const duckEnv = new Float32Array(totalSamples);
  duckEnv.fill(1.0);

  let rngState = 1337;
  const rand = (): number => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296 - 0.5;
  };

  // 1. 解析三幕剧情转折时间点（自动对齐破笼/倍增/反推/母巢崩塌时刻）
  const adrenalineTimes = events.filter(e => e.kind === "adrenaline").map(e => e.timeSec);
  const act2StartSec = adrenalineTimes[0] ?? 9.5;
  const act3StartSec = adrenalineTimes[2] ?? Math.min(durationSec * 0.62, 22.8);
  const hiveBlastEv = events.find(e => e.kind === "hive-blast");
  const hiveBlastSec = hiveBlastEv ? hiveBlastEv.timeSec : durationSec + 10;

  // 2. 构建侧链闪避包络 (Sidechain Ducking)
  const applyDuck = (timeSec: number, dip: number, holdSec: number, releaseSec: number) => {
    const sIdx = Math.max(0, Math.floor(timeSec * sr));
    const holdSamples = Math.floor(holdSec * sr);
    const relSamples = Math.floor(releaseSec * sr);
    const total = holdSamples + relSamples;
    for (let i = 0; i < total && sIdx + i < totalSamples; i++) {
      let target = 1.0;
      if (i < holdSamples) {
        const a = Math.min(1, i / Math.max(1, Math.floor(0.012 * sr)));
        target = 1.0 - (1.0 - dip) * a;
      } else {
        const r = (i - holdSamples) / Math.max(1, relSamples);
        target = dip + (1.0 - dip) * (1 - Math.exp(-r * 3.8));
      }
      if (target < duckEnv[sIdx + i]) {
        duckEnv[sIdx + i] = target;
      }
    }
  };

  for (const ev of events) {
    if (ev.kind === "adrenaline") {
      applyDuck(ev.timeSec, 0.44, 0.14, 0.34);
    } else if (ev.kind === "boss-kill" || ev.kind === "rocket-blast") {
      applyDuck(ev.timeSec, 0.46, 0.15, 0.36);
    } else if (ev.kind === "breach" || ev.kind === "boss-spawn") {
      applyDuck(ev.timeSec, 0.52, 0.12, 0.28);
    } else if (ev.kind === "infect-bite") {
      applyDuck(ev.timeSec, 0.42, 0.16, 0.36);
    } else if (ev.kind === "hive-blast") {
      applyDuck(ev.timeSec, 0.30, 0.35, 0.65);
    }
  }

  // 2.5 开场载具连续物理声场层 (t = 0.0s .. 5.8s)
  const isHeliMode = modeId === "blackout" || modeId === "sonar";
  const vehEndSample = Math.min(totalSamples, Math.floor(5.9 * sr));
  let rotorNoiseLp = 0;
  for (let i = 0; i < vehEndSample; i++) {
    const t = i / sr;
    if (isHeliMode) {
      // 黑鹰四叶主旋翼 18Hz 涡流拍击声 + 涡轴发动机高频哨音（悬停索降后向左侧盘旋淡出）
      const env = t < 0.25 ? t / 0.25 : t < 4.35 ? 1.0 : Math.max(0, 1 - (t - 4.35) / 1.45);
      const bladeMod = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * 18.2 * t), 2.6);
      rotorNoiseLp += 0.065 * (rand() - rotorNoiseLp);
      const thump = Math.sin(2 * Math.PI * 54 * t) * bladeMod * 0.45;
      const turbine = Math.sin(2 * Math.PI * (1320 + Math.sin(t * 2.5) * 40) * t) * 0.032;
      const heliSig = (rotorNoiseLp * bladeMod * 2.2 + thump + turbine) * env * 0.34;
      const pan = t < 4.35 ? Math.sin(t * 3.6) * 0.25 : clamp(-(t - 4.35) * 0.55, -0.8, 0);
      const ang = ((pan + 1) * Math.PI) * 0.25;
      sfxL[i] += heliSig * Math.cos(ang);
      sfxR[i] += heliSig * Math.sin(ang);
    } else {
      // 重装柴油大巴 V8 低吼引擎声 (0~3.2s 推进，4.95~6.6s 倒车撤离)
      let rpmEnv = 0;
      let rpmFreq = 56;
      if (t < 3.2) {
        rpmEnv = t < 0.2 ? t / 0.2 : 1.0 - (t / 3.2) * 0.25;
        rpmFreq = 54 + (1 - t / 3.2) * 26;
      } else if (t >= 4.95 && t < 6.6) {
        rpmEnv = Math.sin(((t - 4.95) / 1.65) * Math.PI) * 0.55;
        rpmFreq = 52 + (t - 4.95) * 14;
      }
      if (rpmEnv > 0.01) {
        const rumble =
          Math.tanh(
            Math.sin(2 * Math.PI * rpmFreq * t) * 1.4 +
              Math.sin(2 * Math.PI * rpmFreq * 2.0 * t) * 0.65 +
              Math.sin(2 * Math.PI * rpmFreq * 0.5 * t) * 0.5,
          ) *
          rpmEnv *
          0.16;
        sfxL[i] += rumble * 0.95;
        sfxR[i] += rumble * 0.95;
      }
    }
  }

  // 3. 合成或载入三幕式立体声 BGM (132 BPM, D Minor: D - Bb - C - A)
  if (externalBgm && externalBgm.length > 0) {
    const copyLen = Math.min(totalSamples, externalBgm.length);
    for (let i = 0; i < copyLen; i++) {
      bgmL[i] = externalBgm[i] * 0.68;
      bgmR[i] = externalBgm[i] * 0.68;
    }
  } else {
    const bpm = 132;
    const beatSec = 60 / bpm;
    const step16Sec = beatSec / 4;
    const bassRoots = [73.42, 58.27, 65.41, 55.0];
    const phonkMelodyAct2 = [
      587.33, 0, 587.33, 698.46, 880.0, 0, 783.99, 698.46, 659.25, 0, 698.46, 0, 587.33, 0,
      523.25, 440.0,
    ];
    const phonkMelodyAct3 = [
      587.33, 587.33, 698.46, 880.0, 1174.66, 0, 1046.5, 880.0, 783.99, 0, 880.0, 698.46, 659.25,
      587.33, 523.25, 659.25,
    ];

    let bassLp = 0;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      const beatFloat = t / beatSec;
      const beatIdx = Math.floor(beatFloat);
      const beatTime = (beatFloat - beatIdx) * beatSec;

      const step16Float = t / step16Sec;
      const step16Idx = Math.floor(step16Float);
      const step16Time = (step16Float - step16Idx) * step16Sec;

      const barIdx = Math.floor(beatIdx / 4);
      const chordRoot = bassRoots[barIdx % 4];
      const stepInBar = step16Idx % 16;

      const isAct1 = t < act2StartSec;
      const isAct2 = t >= act2StartSec && t < act3StartSec;
      const isAct3 = t >= act3StartSec && t < hiveBlastSec;
      const isVictory = t >= hiveBlastSec;

      let centerMono = 0;
      let sideStereo = 0;

      if (!isVictory) {
        const isKickBeat =
          isAct1 ? stepInBar % 4 === 0 || stepInBar === 11 || stepInBar === 14 : stepInBar % 4 === 0;
        if (isKickBeat && step16Time < 0.18) {
          const kt = step16Time;
          const kFreq = 46 + 108 * Math.exp(-kt * 44);
          const kEnv = Math.exp(-kt * 16.5);
          const kClick = Math.sin(2 * Math.PI * 1650 * kt) * Math.exp(-kt * 190) * 0.22;
          centerMono += (Math.tanh(Math.sin(2 * Math.PI * kFreq * kt) * 1.45) * kEnv + kClick) * 0.34;
        }

        const pumpEnv = 0.22 + 0.78 * (1 - Math.exp(-beatTime * 8.5));
        const saw1 = ((t * chordRoot) % 1) * 2 - 1;
        const saw2 = ((t * chordRoot * 1.006) % 1) * 2 - 1;
        const subSine = Math.sin(2 * Math.PI * chordRoot * t);
        const rawBass = subSine * 0.65 + (saw1 + saw2) * (isAct1 ? 0.16 : 0.26);
        const cutoff = isAct1 ? 0.035 : isAct2 ? 0.065 : 0.095;
        bassLp += cutoff * (rawBass - bassLp);
        centerMono += Math.tanh(bassLp * 1.6) * pumpEnv * (isAct1 ? 0.24 : 0.28);

        if (isAct1) {
          if (stepInBar % 4 === 2 && step16Time < 0.045) {
            sideStereo += rand() * Math.exp(-step16Time * 95) * 0.08;
          }
          if (stepInBar === 6 || stepInBar === 14) {
            const pEnv = Math.exp(-step16Time * 24);
            sideStereo += Math.sin(2 * Math.PI * 440 * step16Time) * pEnv * 0.055;
          }
        }

        if (isAct2 || isAct3) {
          const melTable = isAct3 ? phonkMelodyAct3 : phonkMelodyAct2;
          const noteFreq = melTable[stepInBar];
          if (noteFreq > 0 && step16Time < 0.11) {
            const nt = step16Time;
            const cEnv = Math.min(1, nt / 0.0025) * Math.exp(-nt * (isAct3 ? 19 : 23));
            const osc1 = Math.sin(2 * Math.PI * noteFreq * nt);
            const osc2 = Math.sin(2 * Math.PI * noteFreq * 1.481 * nt) * 0.38;
            const subOct = isAct3 ? Math.sin(2 * Math.PI * (noteFreq * 0.5) * nt) * 0.35 : 0;
            const cowbell = Math.tanh((osc1 + osc2 + subOct) * 1.85) * cEnv * (isAct3 ? 0.17 : 0.14);
            centerMono += cowbell * 0.85;
            sideStereo += cowbell * (stepInBar % 2 === 0 ? 0.32 : -0.32);
          }

          if ((stepInBar === 4 || stepInBar === 12) && step16Time < 0.12) {
            const st = step16Time;
            const sBody = Math.sin(2 * Math.PI * (195 - st * 420) * st) * Math.exp(-st * 32);
            const sNoise = rand() * Math.exp(-st * 26);
            centerMono += (sBody * 0.45 + sNoise * 0.55) * 0.21;
          }

          const hatDur = stepInBar === 7 || stepInBar === 15 ? 0.055 : 0.032;
          if (step16Time < hatDur) {
            const hAccent = stepInBar % 2 === 0 ? 0.09 : 0.055;
            const metallic =
              (rand() * 0.7 + Math.sin(2 * Math.PI * 6850 * step16Time) * 0.3) *
              Math.exp(-step16Time * 115) *
              hAccent;
            centerMono += metallic * 0.7;
            sideStereo += metallic * (stepInBar % 4 < 2 ? 0.45 : -0.45);
          }
        }

        const riserWindow = act3StartSec - t;
        if (riserWindow > 0 && riserWindow <= 1.6) {
          const prog = 1 - riserWindow / 1.6;
          const riserFreq = 220 * Math.pow(2, prog * 2.0);
          const rollRate = prog < 0.5 ? step16Sec * 0.5 : step16Sec * 0.25;
          const rollPhase = (t % rollRate) / rollRate;
          const rollSnare = rand() * Math.exp(-rollPhase * 6.5) * (0.08 + prog * 0.16);
          const riserSynth = Math.sin(2 * Math.PI * riserFreq * t) * prog * 0.12;
          centerMono += rollSnare + riserSynth;
        }

        if (isAct3) {
          const padRoot = chordRoot * 2;
          const padFifth = padRoot * 1.498;
          const padOct = padRoot * 2;
          const padWaveL =
            Math.sin(2 * Math.PI * padRoot * t) * 0.45 +
            Math.sin(2 * Math.PI * (padFifth * 1.003) * t) * 0.35 +
            Math.sin(2 * Math.PI * padOct * t) * 0.2;
          const padWaveR =
            Math.sin(2 * Math.PI * (padRoot * 0.997) * t) * 0.45 +
            Math.sin(2 * Math.PI * padFifth * t) * 0.35 +
            Math.sin(2 * Math.PI * (padOct * 1.002) * t) * 0.2;
          bgmL[i] += Math.tanh(padWaveL * 1.4) * pumpEnv * 0.12;
          bgmR[i] += Math.tanh(padWaveR * 1.4) * pumpEnv * 0.12;
        }
      } else {
        const vt = t - hiveBlastSec;
        const vEnv = Math.min(1, vt / 0.08) * Math.exp(-vt * 1.45);
        const vChord =
          Math.sin(2 * Math.PI * 146.83 * t) * 0.32 +
          Math.sin(2 * Math.PI * 220.0 * t) * 0.24 +
          Math.sin(2 * Math.PI * 293.66 * t) * 0.22 +
          Math.sin(2 * Math.PI * 369.99 * t) * 0.18 +
          Math.sin(2 * Math.PI * 440.0 * t) * 0.14;
        centerMono += Math.tanh(vChord * 1.35) * vEnv * 0.32;
        sideStereo += Math.sin(2 * Math.PI * 587.33 * t) * vEnv * 0.08;
      }

      bgmL[i] += centerMono + sideStereo;
      bgmR[i] += centerMono - sideStereo;
    }
  }

  // 4. 合成等功率立体声定位 (Equal-Power Stereo Panning) ASMR 战斗与载具音效层
  for (const ev of events) {
    const startIdx = Math.floor(ev.timeSec * sr);
    if (startIdx < 0 || startIdx >= totalSamples) continue;

    const pan = clamp(ev.pan ?? 0, -0.85, 0.85);
    const panAng = ((pan + 1) * Math.PI) * 0.25;
    const gainL = Math.cos(panAng);
    const gainR = Math.sin(panAng);
    const addStereo = (idx: number, val: number) => {
      sfxL[idx] += val * gainL;
      sfxR[idx] += val * gainR;
    };

    if (ev.kind === "mg" || ev.kind === "heavy-mg") {
      const isHeavy = ev.kind === "heavy-mg";
      const dur = isHeavy ? 0.046 : 0.036;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      const fStart = (isHeavy ? 155 : 185) * ev.pitch;
      const fEnd = (isHeavy ? 52 : 66) * ev.pitch;
      const shellFreq = (isHeavy ? 4650 : 5480) * ev.pitch;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const punchEnv = Math.exp(-t * 88);
        const instFreq = fEnd + (fStart - fEnd) * Math.exp(-t * 110);
        const punch = Math.sin(2 * Math.PI * instFreq * t) * punchEnv;
        const boltSnap =
          (rand() * 0.65 + Math.sin(2 * Math.PI * 2350 * t) * 0.35) * Math.exp(-t * 165);
        let shellClink = 0;
        if (t > 0.012) {
          const st = t - 0.012;
          shellClink =
            (Math.sin(2 * Math.PI * shellFreq * st) +
              Math.sin(2 * Math.PI * (shellFreq * 1.31) * st) * 0.6) *
            Math.exp(-st * 195) *
            0.22;
        }
        addStereo(startIdx + i, (punch * 0.56 + boltSnap * 0.42 + shellClink) * ev.gain * 0.74);
      }
    } else if (ev.kind === "rocket-launch") {
      // 机载火箭出巢高压气流呼啸声 (Doppler Whoosh)
      const dur = 0.18;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.012) * Math.exp(-t * 15);
        const sweep = Math.sin(2 * Math.PI * (1550 - t * 4800) * t) * 0.35;
        const hiss = rand() * 0.65;
        addStereo(startIdx + i, (sweep + hiss) * env * ev.gain * 0.65);
      }
    } else if (ev.kind === "rocket-blast") {
      // 破片火箭弹落地轰爆声
      const dur = 0.36;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 9.2);
        const sub = Math.tanh(Math.sin(2 * Math.PI * (52 + 95 * Math.exp(-t * 28)) * t) * 1.9);
        const debris = rand() * Math.exp(-t * 16) * 0.75;
        addStereo(startIdx + i, (sub * 0.65 + debris * 0.55) * env * ev.gain * 0.82);
      }
    } else if (ev.kind === "bus-brake") {
      // 装甲大巴急刹气动泄压嘶鸣 + 液压重型舱门弹开声
      const dur = 0.34;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const airHiss = rand() * Math.exp(-t * 11) * 0.52;
        const clunk =
          t > 0.08
            ? Math.sin(2 * Math.PI * 135 * (t - 0.08)) * Math.exp(-(t - 0.08) * 32) * 0.65
            : 0;
        addStereo(startIdx + i, (airHiss + clunk) * ev.gain * 0.68);
      }
    } else if (ev.kind === "ram-hit") {
      // 车头 V 型钢制撞角碾碎路障丧尸重击声
      const dur = 0.14;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const thud = Math.sin(2 * Math.PI * (128 - t * 520) * t) * Math.exp(-t * 26);
        const crunch = rand() * Math.exp(-t * 38) * 0.45;
        addStereo(startIdx + i, (thud * 0.7 + crunch) * ev.gain * 0.68);
      }
    } else if (ev.kind === "kill-pop") {
      const dur = 0.028;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      const f0 = 580 * ev.pitch;
      const f1 = 1360 * ev.pitch;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.sin((Math.PI * t) / dur) * Math.exp(-t * 58);
        const freq = f0 + ((f1 - f0) * t) / dur;
        const bubble = Math.sin(2 * Math.PI * freq * t);
        const tick = Math.sin(2 * Math.PI * 3400 * t) * Math.exp(-t * 240) * 0.35;
        addStereo(startIdx + i, (bubble * 0.75 + tick) * env * ev.gain * 0.78);
      }
    } else if (ev.kind === "adrenaline") {
      const notes = [587.33, 698.46, 880.0, 1174.66];
      const dur = 0.52;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const shatter =
          t < 0.065
            ? (rand() * 0.55 + Math.sin(2 * Math.PI * 3850 * t) * 0.45) * Math.exp(-t * 62) * 0.48
            : 0;
        let chime = 0;
        for (let n = 0; n < notes.length; n++) {
          const noteStart = n * 0.055;
          if (t >= noteStart) {
            const nt = t - noteStart;
            const nEnv = Math.min(1, nt / 0.004) * Math.exp(-nt * 8.5);
            const nf = notes[n] * ev.pitch;
            chime +=
              (Math.sin(2 * Math.PI * nf * nt) +
                Math.sin(2 * Math.PI * (nf * 2) * nt) * 0.28) *
              nEnv *
              0.26;
          }
        }
        addStereo(startIdx + i, (shatter + chime) * ev.gain * 0.85);
      }
    } else if (ev.kind === "breach") {
      const dur = 0.32;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 9.5);
        const subThud = Math.sin(2 * Math.PI * (92 - t * 140) * t) * Math.exp(-t * 18);
        const alarmFreq = t < 0.11 ? 880 : t < 0.22 ? 659.25 : 0;
        const alarm =
          alarmFreq > 0
            ? Math.tanh(Math.sin(2 * Math.PI * alarmFreq * t) * 1.6) * Math.exp(-(t % 0.11) * 16)
            : 0;
        addStereo(startIdx + i, (subThud * 0.58 + alarm * 0.34) * env * ev.gain * 0.72);
      }
    } else if (ev.kind === "boss-spawn") {
      const dur = 0.46;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.03) * Math.exp(-t * 5.2);
        const f = (110 - t * 48) * ev.pitch;
        const brass =
          Math.sin(2 * Math.PI * f * t) * 0.6 +
          Math.sin(2 * Math.PI * (f * 1.5) * t) * 0.25 +
          Math.sin(2 * Math.PI * (f * 2) * t) * 0.15;
        addStereo(startIdx + i, Math.tanh(brass * 1.8) * env * ev.gain * 0.56);
      }
    } else if (ev.kind === "boss-kill") {
      const dur = 0.48;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 7.8);
        const boom = Math.sin(2 * Math.PI * (96 - t * 115) * t);
        const crackle = rand() * Math.exp(-t * 18) * 0.65;
        const rewardPing =
          t > 0.05
            ? Math.sin(2 * Math.PI * 1174.66 * (t - 0.05)) * Math.exp(-(t - 0.05) * 12) * 0.32
            : 0;
        addStereo(startIdx + i, (boom * 0.62 + crackle + rewardPing) * env * ev.gain * 0.75);
      }
    } else if (ev.kind === "infect-bite") {
      // 士兵被咬感染尸变瞬间：血肉骨裂低频咬合声 + 1360Hz->980Hz 急救心电监护仪断气双音警报 + 丧尸喉音嘶吼！
      const dur = 0.48;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const crunch =
          Math.tanh(
            (Math.sin(2 * Math.PI * (165 - t * 240) * t) * 0.7 + rand() * 0.65) * 2.1,
          ) * Math.exp(-t * 22);
        const ecgFreq = t < 0.14 ? 1360 : t < 0.34 ? 980 : 0;
        const ecgBeep =
          ecgFreq > 0
            ? Math.tanh(Math.sin(2 * Math.PI * ecgFreq * t) * 1.8) * Math.exp(-(t % 0.14) * 11) * 0.42
            : 0;
        const snarl =
          Math.tanh(
            Math.sin(2 * Math.PI * (135 + Math.sin(2 * Math.PI * 34 * t) * 28) * t) * 1.9,
          ) *
          Math.min(1, t / 0.06) *
          Math.exp(-t * 5.8) *
          0.44;
        addStereo(startIdx + i, (crunch * 0.72 + ecgBeep + snarl) * ev.gain * 0.85);
      }
    } else if (ev.kind === "glass-break") {
      // 钢化玻璃橱窗爆碎声：清脆高频泛音晶簇叮当瀑布 + 玻璃崩裂瞬态白噪！
      const dur = 0.34;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const burst = rand() * Math.exp(-t * 28) * 0.58;
        const chime =
          (Math.sin(2 * Math.PI * (3120 * ev.pitch) * t) * Math.exp(-t * 14) +
            Math.sin(2 * Math.PI * (4680 * ev.pitch) * t) * Math.exp(-t * 19) * 0.8 +
            Math.sin(2 * Math.PI * (6240 * ev.pitch) * t) * Math.exp(-t * 24) * 0.65) *
          0.32;
        addStereo(startIdx + i, (burst + chime) * ev.gain * 0.72);
      }
    } else if (ev.kind === "prop-smash") {
      // 实木桌椅/货架/售货机轰碎声：浑厚木铁闷响冲击 + 木刺金属碎裂噼啪声！
      const dur = 0.28;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const thud = Math.tanh(Math.sin(2 * Math.PI * (145 - t * 260) * t) * 2.0) * Math.exp(-t * 18);
        const splinter = rand() * Math.exp(-t * 16) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 820 * t)) * 0.62;
        addStereo(startIdx + i, (thud * 0.68 + splinter) * ev.gain * 0.72);
      }
    } else if (ev.kind === "sonar-ping") {
      // 深层医院超声波声呐回声定位脉冲：清澈高辨识度 1380Hz->1720Hz 水晶声学脉冲！
      const dur = 0.26;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 13.5);
        const freq = (1380 + t * 920) * ev.pitch;
        const ping = Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 2 * t) * 0.22;
        addStereo(startIdx + i, ping * env * ev.gain * 0.48);
      }
    } else if (ev.kind === "power-down") {
      // 地铁站高压变电所短路拉闸断电声：电弧啪啦爆裂 + 280Hz->38Hz 变压器停机骤降轰鸣！
      const dur = 0.72;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const snap = t < 0.09 ? rand() * Math.exp(-t * 36) * 0.85 : 0;
        const dropF = 36 + 240 * Math.exp(-t * 4.8);
        const humDrop = Math.tanh(Math.sin(2 * Math.PI * dropF * t) * 2.2) * Math.exp(-t * 3.2);
        addStereo(startIdx + i, (snap + humDrop * 0.78) * ev.gain * 0.82);
      }
    } else if (ev.kind === "hive-blast") {
      const dur = 1.05;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 3.6);
        const dropFreq = 32 + 78 * Math.exp(-t * 5.5);
        const subBoom = Math.tanh(Math.sin(2 * Math.PI * dropFreq * t) * 2.1);
        const shockwave = rand() * Math.exp(-t * 8.5) * 0.72;
        const shimmer =
          Math.sin(2 * Math.PI * 587.33 * t) * Math.exp(-t * 4.2) * 0.24 +
          Math.sin(2 * Math.PI * 880.0 * t) * Math.exp(-t * 3.8) * 0.18;
        const val = (subBoom * 0.68 + shockwave * 0.45 + shimmer) * env * ev.gain;
        sfxL[startIdx + i] += val;
        sfxR[startIdx + i] += val;
      }
    }
  }

  // 5. 双声道母带软削波限制器 (Stereo Soft-Clip Limiter)
  const outL = new Float32Array(totalSamples);
  const outR = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const mL = bgmL[i] * duckEnv[i] + sfxL[i];
    const mR = bgmR[i] * duckEnv[i] + sfxR[i];
    outL[i] = clamp(Math.tanh(mL * 1.15) * 0.92, -0.94, 0.94);
    outR[i] = clamp(Math.tanh(mR * 1.15) * 0.92, -0.94, 0.94);
  }
  return { left: outL, right: outR };
}

export async function renderSiegeVideo(opts: SiegeRenderOptions): Promise<SiegeRenderStats> {
  const mapId = opts.mapId ?? "canyon-bridge";
  const modeId = opts.modeId ?? "combo";
  const maxDur = opts.durationSec ?? 54;
  const sim = new SiegeSimulator(opts.seed, mapId, maxDur, modeId);
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
  const extBgm = opts.bgmPath ? loadExternalBgmSamples(opts.bgmPath, actualDurationSec) : undefined;
  const stereoAudio = buildSiegeStereoAudioTrack(sim.audioEvents, actualDurationSec, modeId, extBgm);
  writeStereoWav(stereoAudio.left, stereoAudio.right, tmpWav);

  // 重新运行一遍完全相同种子的模拟并流式生成视频帧
  const simRender = new SiegeSimulator(opts.seed, mapId, maxDur, modeId);
  const worldBgRaw = buildWorldBackground(modeId, atlas);
  const screenFb = new FrameBuf(OUT_W, OUT_H, [8, 10, 15, 255]);

  function* frameGenerator(): IterableIterator<FrameBuf> {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      for (let s = 0; s < TICKS_PER_FRAME; s++) {
        simRender.stepTick();
        if (simRender.isFinished) break;
      }

      const { camX: effCamX, camY: effCamY, zoom: effZoom } = getEffectiveCam(simRender);
      bakeDecalsIntoBackground(worldBgRaw, simRender);
      blitWorldToViewport(screenFb, worldBgRaw, effCamX, effCamY, effZoom);

      const fb = createZoomedFrameBuf(screenFb, effZoom);
      const drawWorldText = (
        text: string,
        wxScreen: number,
        wyScreen: number,
        col: RGBA,
        scale: number,
        align: "left" | "center" | "right",
        style: Parameters<FontAtlas["drawStyled"]>[7],
      ) => {
        atlas.drawStyled(
          screenFb,
          text,
          BOARD_X + (wxScreen - BOARD_X) * effZoom,
          BOARD_Y + (wyScreen - BOARD_Y) * effZoom,
          col,
          scale * effZoom,
          align,
          style,
        );
      };

      const ox = BOARD_X - effCamX;
      const oy = BOARD_Y - effCamY;

      // 0. 先绘制动态可破坏室内家具/玻璃窗（完好实体 + 破碎坍塌残骸），再绘制混凝土隔墙底座
      renderDynamicInteriorProps(fb, simRender);
      renderDeadCornerWalls(fb, simRender);

      // 1. 绘制顶部【丧尸母巢核心】（12片分节甲壳线条 + 内部放射生物血管 + 旋转锁定准星环）
      const hive = simRender.hive;
      const hx = ox + hive.x;
      const hy = oy + hive.y;
      if (hive.alive) {
        const pulse = Math.sin(hive.pulsePhase) * 3.2;
        const isHit = hive.hitFlash > 0.35;

        fb.drawGlowCircle(hx, hy, (hive.r + pulse) * 1.55, [195, 18, 48, 95]);

        // 外圈战术锁定框线与 12 根分节生物骨刺
        drawPolygonLines(
          fb,
          hx,
          hy,
          hive.r + 14,
          12,
          hive.pulsePhase * 0.15,
          1.4,
          [165, 36, 62, 165],
        );

        const spikeCount = 12;
        for (let s = 0; s < spikeCount; s++) {
          const ang = (s * Math.PI * 2) / spikeCount + Math.sin(hive.pulsePhase * 0.5) * 0.06;
          const sx0 = hx + Math.cos(ang) * (hive.r * 0.68);
          const sy0 = hy + Math.sin(ang) * (hive.r * 0.68);
          const sxMid = hx + Math.cos(ang + 0.08) * (hive.r * 0.98);
          const syMid = hy + Math.sin(ang + 0.08) * (hive.r * 0.98);
          const sx1 = hx + Math.cos(ang) * (hive.r + 13 + (s % 2) * 5);
          const sy1 = hy + Math.sin(ang) * (hive.r + 13 + (s % 2) * 5);
          const spikeCol: RGBA = isHit ? [255, 185, 150, 255] : [145, 18, 40, 255];
          fb.drawLine(sx0, sy0, sxMid, syMid, 5.2, spikeCol);
          fb.drawLine(sxMid, syMid, sx1, sy1, 2.8, [235, 65, 88, 255]);
        }

        // 母巢重甲底座与 8 道内骨骼放射接缝线
        fb.fillCircle(hx, hy, hive.r + 3, [28, 4, 12, 255]);
        fb.fillCircle(
          hx,
          hy,
          hive.r,
          isHit ? [245, 75, 85, 255] : [150, 16, 38, 255],
        );
        drawPolygonLines(
          fb,
          hx,
          hy,
          hive.r - 2,
          8,
          -hive.pulsePhase * 0.2,
          2.2,
          [75, 6, 20, 240],
          true,
          [95, 10, 26, 220],
        );

        // 内部搏动腔体与十字生物裂隙线
        const innerR = hive.r * 0.68 + pulse * 0.55;
        fb.fillCircle(
          hx,
          hy,
          innerR,
          isHit ? [255, 160, 120, 255] : [220, 28, 58, 255],
        );
        drawPolygonLines(
          fb,
          hx,
          hy,
          innerR,
          6,
          hive.pulsePhase * 0.3,
          2.0,
          [255, 110, 125, 235],
          true,
          [255, 165, 95, 210],
        );

        fb.fillCircle(
          hx,
          hy,
          hive.r * 0.34 - pulse * 0.25,
          [255, 225, 85, 255],
        );
        fb.strokeRing(hx, hy, hive.r * 0.34 - pulse * 0.25, 2.0, [255, 255, 210, 255]);

        // 母巢顶部巨型血条与名称标识
        const hBarW = 220;
        const hBarH = 11;
        const hBarX = hx - hBarW * 0.5;
        const hBarY = hy - hive.r - 24;
        const hpFrac = clamp(hive.hp / hive.maxHp, 0, 1);
        const ghostFrac = clamp(hive.ghostHp / hive.maxHp, hpFrac, 1);

        fb.drawBar(hBarX, hBarY, hBarW, hBarH, hpFrac, {
          radius: 4,
          bgColor: [14, 16, 24, 235],
          borderColor: [255, 185, 65, 235],
          fgStart: [255, 38, 75, 255],
          fgEnd: [255, 145, 40, 255],
          ghostFrac,
          ghostColor: [255, 255, 255, 240],
        });

        drawWorldText(
          `${Math.ceil(hive.hp)}`,
          hx,
          hBarY - 20,
          [255, 225, 95, 255],
          0.32,
          "center",
          { outlineWidth: 3, outlineColor: [8, 10, 16, 245] },
        );
      } else {
        // 母巢被轰爆后的放射裂纹弹坑遗迹
        fb.blendCircle(hx, hy, hive.r * 1.15, [22, 16, 24, 230]);
        drawPolygonLines(fb, hx, hy, hive.r * 0.95, 8, 0.2, 2.2, [95, 42, 48, 195], true);
      }

      // 2. 绘制真实焊接钢筋铁笼 (`囚笼+1`) 与军用武器箱（绝不凭空消失：破锁前关押 1 名抓栏呼救幸存者，破锁后铁门大敞并永久遗留在房间地面上！）
      for (const n of simRender.nodes) {
        const nx = ox + n.x;
        const ny = oy + n.y;
        const rot = n.rot ?? 0;
        const ux = Math.cos(rot);
        const uy = Math.sin(rot);
        const px = -uy;
        const py = ux;
        const toW = (lx: number, ly: number): [number, number] => [
          nx + ux * lx + px * ly,
          ny + uy * lx + py * ly,
        ];
        const isHit = !n.broken && n.hitFlash > 0.3;
        const beaconPulse = 0.5 + 0.5 * Math.sin(frameIdx * 0.22 + n.x * 0.03);

        if (n.kind === "rescue_cage") {
          const hw = 19;
          const hh = 15.5;

          // 2a. 铁笼落地阴影与锈蚀铁篦底座
          fb.blendCircle(nx + 3, ny + 4, 23, [3, 5, 10, 175]);
          for (let ly = -hh + 2; ly <= hh - 2; ly += 4) {
            const [ax, ay] = toW(-hw + 1, ly);
            const [bx, by] = toW(hw - 1, ly);
            fb.drawLine(ax, ay, bx, by, 4.4, [24, 28, 34, 245]);
          }
          // 地面抓痕与求救信号棒微光
          if (!n.broken) {
            const [fx, fy] = toW(-hw - 5, hh + 4);
            fb.drawGlowCircle(fx, fy, 18, [255, 95, 55, Math.round(55 + 45 * beaconPulse)]);
            fb.fillCircle(fx, fy, 2.6, [255, 165, 85, 250]);
          }

          // 2b. 若尚未破锁：绘制笼内 1 名真实被困幸存者（双手紧握/挥动铁栏呼救）！
          if (!n.broken) {
            const sway = Math.sin(frameIdx * 0.24 + n.y * 0.05) * 1.8;
            const [sx, sy] = toW(sway, 1.5);
            const waveAng = rot + Math.PI * 0.5 + Math.sin(frameIdx * 0.36 + n.x * 0.04) * 0.48;
            // 伸出铁栏缝隙挥动求救的手臂与握栏手掌
            fb.drawLine(
              sx,
              sy,
              sx + Math.cos(waveAng) * 14.5,
              sy + Math.sin(waveAng) * 14.5,
              2.3,
              [155, 255, 205, 245],
            );
            const [gripX, gripY] = toW(-6, hh - 1);
            fb.fillCircle(gripX, gripY, 2.1, [215, 190, 165, 245]);
            // 幸存者双肩战术背心与绿色头盔护目镜
            fb.fillCircle(sx, sy, 6.8, [32, 168, 98, 250]);
            fb.fillCircle(sx, sy - 0.8, 4.2, [125, 250, 185, 255]);
            fb.drawLine(sx - ux * 3.2, sy - uy * 3.2 - 1.5, sx + ux * 3.2, sy + uy * 3.2 - 1.5, 1.7, [225, 255, 255, 255]);
          }

          // 2c. 铁笼背墙与左右两侧焊接钢筋竖栏 + 顶部防逃交叉铁栅
          const barCol: RGBA = isHit ? [245, 232, 185, 255] : [116, 128, 142, 248];
          const rustCol: RGBA = [96, 62, 42, 235];
          const [cTLx, cTLy] = toW(-hw, -hh);
          const [cTRx, cTRy] = toW(hw, -hh);
          const [cBLx, cBLy] = toW(-hw, hh);
          const [cBRx, cBRy] = toW(hw, hh);

          // 背侧与左右外框角钢
          fb.drawLine(cTLx, cTLy, cTRx, cTRy, 2.8, rustCol);
          fb.drawLine(cTLx, cTLy, cTRx, cTRy, 1.6, barCol);
          fb.drawLine(cTLx, cTLy, cBLx, cBLy, 2.8, rustCol);
          fb.drawLine(cTLx, cTLy, cBLx, cBLy, 1.6, barCol);
          fb.drawLine(cTRx, cTRy, cBRx, cBRy, 2.8, rustCol);
          fb.drawLine(cTRx, cTRy, cBRx, cBRy, 1.6, barCol);

          // 笼顶纵向铁条（破锁后略带半透，露出空笼内部）
          const roofAlpha = n.broken ? 145 : 215;
          for (const bx of [-12, -4, 4, 12]) {
            const [r0x, r0y] = toW(bx, -hh);
            const [r1x, r1y] = toW(bx, hh);
            fb.drawLine(r0x, r0y, r1x, r1y, 1.4, [108, 120, 136, roofAlpha]);
          }
          const [m0x, m0y] = toW(-hw, 0);
          const [m1x, m1y] = toW(hw, 0);
          fb.drawLine(m0x, m0y, m1x, m1y, 1.3, [92, 102, 118, roofAlpha]);

          // 四角重型焊接立柱墩头
          for (const [cxp, cyp] of [
            [cTLx, cTLy],
            [cTRx, cTRy],
            [cBLx, cBLy],
            [cBRx, cBRy],
          ]) {
            fb.fillCircle(cxp, cyp, 3.0, [52, 58, 68, 255]);
            fb.fillCircle(cxp, cyp, 1.6, [148, 160, 175, 245]);
          }

          // 2d. 正门铁栏门扇：未破锁时紧闭并挂有黄铜/红芯大挂锁；破锁后绕左铰链平滑向外敞开 ~110° 并掉落断锁！
          if (!n.broken) {
            fb.drawLine(cBLx, cBLy, cBRx, cBRy, 2.8, barCol);
            const [lockX, lockY] = toW(7, hh + 1.5);
            fb.fillRoundRect(lockX - 3.5, lockY - 3, 7, 7, 1.5, isHit ? [255, 250, 200, 255] : [215, 162, 42, 255]);
            fb.fillCircle(lockX, lockY + 0.5, 1.6, [235, 48, 58, 255]);
          } else {
            const openRad = clamp(n.openAnim ?? 1, 0.15, 1) * 1.92;
            const dDirX = ux * Math.cos(openRad) + px * Math.sin(openRad);
            const dDirY = uy * Math.cos(openRad) + py * Math.sin(openRad);
            const doorLen = hw * 1.92;
            const tipX = cBLx + dDirX * doorLen;
            const tipY = cBLy + dDirY * doorLen;
            fb.drawLine(cBLx + 2, cBLy + 3, tipX + 2, tipY + 3, 3.6, [3, 5, 10, 165]);
            fb.drawLine(cBLx, cBLy, tipX, tipY, 3.0, [132, 146, 162, 245]);
            // 地面掉落的砸断挂锁残片
            const [bLockX, bLockY] = toW(10, hh + 6);
            fb.fillRect(bLockX - 2.5, bLockY - 2, 5, 4, [168, 126, 38, 215]);
          }
        } else if (n.kind === "multiply_crystal") {
          // 战术空投集结通讯站（八角装甲通讯底座 + 双鞭状天线 + 青金脉冲集结光环，激活后展开为地面基站遗迹）
          fb.blendCircle(nx + 3, ny + 4, 24, [3, 5, 10, 175]);
          fb.fillCircle(nx, ny, 20, n.broken ? [24, 30, 38, 245] : [36, 48, 62, 250]);
          drawPolygonLines(fb, nx, ny, 19, 8, 0.2, 2.0, [115, 195, 225, n.broken ? 145 : 240], true);
          if (!n.broken) {
            fb.drawGlowCircle(nx, ny, 26, [255, 215, 75, Math.round(65 + 55 * beaconPulse)]);
            fb.strokeRing(nx, ny, 11 + beaconPulse * 3, 2.0, [255, 225, 85, 245]);
            fb.fillCircle(nx, ny, 5.5, isHit ? [255, 255, 235, 255] : [95, 240, 255, 255]);
            fb.drawLine(nx - 8, ny - 6, nx - 14, ny - 22, 1.8, [165, 205, 230, 245]);
            fb.drawLine(nx + 8, ny - 6, nx + 13, ny - 19, 1.6, [165, 205, 230, 245]);
          } else {
            fb.fillCircle(nx, ny, 6.5, [48, 62, 76, 235]);
          }
        } else {
          // 军规橄榄绿重武器木钢补给箱（破箱后箱盖掀翻在旁侧保留为空箱遗迹）
          const cw = 24;
          const ch = 17;
          fb.blendRoundRect(nx - cw + 3, ny - ch + 4, cw * 2, ch * 2, 4, [3, 5, 10, 180]);
          fb.fillRoundRect(
            nx - cw,
            ny - ch,
            cw * 2,
            ch * 2,
            4,
            n.broken ? [26, 32, 28, 245] : isHit ? [165, 195, 145, 255] : [52, 68, 48, 255],
          );
          fb.strokeRoundRect(nx - cw, ny - ch, cw * 2, ch * 2, 4, 2.0, [118, 138, 108, 240]);
          if (!n.broken) {
            fb.drawLine(nx - cw + 4, ny, nx + cw - 4, ny, 2.4, [88, 106, 82, 235]);
            fb.fillRect(nx - 4, ny + ch - 3, 8, 5, [215, 168, 48, 250]);
          } else {
            // 掀开的军火箱顶盖斜靠在箱旁
            fb.fillRoundRect(nx + cw + 4, ny - ch + 2, 12, ch * 1.8, 2, [58, 74, 52, 235]);
            fb.strokeRoundRect(nx + cw + 4, ny - ch + 2, 12, ch * 1.8, 2, 1.3, [118, 138, 108, 220]);
          }
        }
      }

      // 3. 绘制双层几何冲击波环（含声呐超声波环 sonar 与枪口噪音惊醒波 noise）
      for (const r of simRender.rings) {
        const p = 1 - r.ttl / r.maxTtl;
        const rad = 14 + p * r.maxR;
        const alpha = Math.round((1 - p) * 210);
        const col: RGBA =
          r.kind === "sonar"
            ? [65, 240, 255, alpha]
            : r.kind === "noise"
              ? [255, 145, 45, alpha]
              : r.kind === "rescue" || r.kind === "infect"
                ? [75, 255, 165, alpha]
                : r.kind === "multiply"
                  ? [255, 225, 75, alpha]
                  : r.kind === "casualty"
                    ? [255, 55, 75, alpha]
                    : [255, 110, 65, alpha];
        fb.strokeRing(ox + r.x, oy + r.y, rad, r.kind === "sonar" ? 2.4 : 3.0, col);
        drawPolygonLines(
          fb,
          ox + r.x,
          oy + r.y,
          rad * 0.82,
          r.kind === "sonar" ? 12 : 8,
          p * 0.8,
          1.5,
          col,
        );
        // 接触同化瞬间绘制紫绿双色生物电弧裂纹（无需文字即可一眼看清“人类被感染突变为变异枪兵”！）
        if (r.kind === "casualty" && p < 0.72) {
          for (let aIdx = 0; aIdx < 5; aIdx++) {
            const ang0 = (aIdx * Math.PI * 2) / 5 + p * 2.2;
            const mx = ox + r.x + Math.cos(ang0 + 0.18) * (rad * 0.55);
            const my = oy + r.y + Math.sin(ang0 + 0.18) * (rad * 0.55);
            const ex = ox + r.x + Math.cos(ang0) * (rad * 1.05);
            const ey = oy + r.y + Math.sin(ang0) * (rad * 1.05);
            fb.drawLine(ox + r.x, oy + r.y, mx, my, 2.0, [95, 255, 165, alpha]);
            fb.drawLine(mx, my, ex, ey, 1.8, [255, 65, 195, alpha]);
          }
        }
      }

      // 4. 绘制尸潮红点（带前扑利爪短线与背部甲壳纹理）、感染精英与绿光【同化母体】
      for (let i = 0; i < simRender.reds.length; i++) {
        const r = simRender.reds[i];
        if (r.kind === "boss") continue;
        const rx = ox + r.x;
        const ry = oy + r.y;

        if (r.kind === "carrier") {
          fb.drawGlowCircle(rx, ry, r.r * 1.6, [55, 245, 155, 95]);
          fb.fillCircle(rx, ry, r.r + 2, [18, 42, 28, 245]);
          fb.fillCircle(
            rx,
            ry,
            r.r,
            r.hitFlash > 0.3 ? [220, 255, 220, 255] : [155, 34, 120, 255],
          );
          drawPolygonLines(
            fb,
            rx,
            ry,
            r.r - 1,
            6,
            frameIdx * 0.04,
            2.0,
            [85, 255, 165, 245],
            true,
            [65, 225, 145, 195],
          );
          fb.fillCircle(rx, ry, r.r * 0.42, [150, 255, 200, 255]);
          continue;
        }

        if (r.kind === "infected_elite") {
          const mutTicks = r.mutatingTicks ?? 0;
          if (mutTicks > 0) {
            // 【等身自然尸变痉挛 (0.40s)：士兵在原体型尺度抽搐变色并弹出小巧 ☣ 感染提示，绝不膨胀成突兀小Boss！】
            const prog = clamp(1 - mutTicks / 24, 0, 1);
            const mx = rx + Math.sin(frameIdx * 2.8 + r.id) * 2.1;
            const my = ry + Math.cos(frameIdx * 3.3 + r.id) * 2.1;
            const strobeGreen = frameIdx % 4 < 2;

            fb.drawGlowCircle(mx, my, 17 + prog * 6, [235, 38, 115, 145]);
            for (let tIdx = 0; tIdx < 4; tIdx++) {
              const tAng = (tIdx * Math.PI) / 2 + frameIdx * 0.22;
              fb.drawLine(
                mx,
                my,
                mx + Math.cos(tAng) * (r.r + 6 + prog * 4),
                my + Math.sin(tAng) * (r.r + 6 + prog * 4),
                1.9,
                strobeGreen ? [85, 245, 155, 220] : [235, 45, 95, 230],
              );
            }
            fb.fillCircle(mx, my, r.r + 1.5, [26, 6, 16, 250]);
            fb.fillCircle(mx, my, r.r, strobeGreen ? [52, 215, 125, 255] : [215, 34, 68, 255]);
            drawBiohazardSymbol(
              fb,
              mx,
              my - r.r - 11 - prog * 4,
              8.5,
              frameIdx * 0.1,
              strobeGreen ? [115, 255, 165, 245] : [255, 75, 135, 245],
            );
            continue;
          }

          // 尸变完成后的【普通等身感染士兵丧尸】（无Boss血条、无巨型体型、无激光步枪，仅保留歪斜残破绿头盔护肩与前扑尸爪，一眼认出是昔日队友！）
          const moveAng = Math.atan2(r.vy || 1, r.vx || 0);
          const mux = Math.cos(moveAng);
          const muy = Math.sin(moveAng);
          const mpx = -muy;
          const mpy = mux;

          for (const side of [-0.5, 0.5]) {
            const cAng = moveAng + side;
            fb.drawLine(
              rx + Math.cos(cAng) * (r.r * 0.55),
              ry + Math.sin(cAng) * (r.r * 0.55),
              rx + Math.cos(cAng) * (r.r + 4.0),
              ry + Math.sin(cAng) * (r.r + 4.0),
              2.0,
              [165, 24, 46, 240],
            );
          }
          // 一侧残留的橄榄绿破损战术护肩，标识其曾是人类士兵
          fb.fillCircle(rx - mpx * (r.r * 0.72), ry - mpy * (r.r * 0.72), 3.3, [44, 172, 98, 245]);
          fb.fillCircle(rx, ry, r.r + 1.4, [26, 6, 14, 245]);
          fb.fillCircle(
            rx,
            ry,
            r.r,
            r.hitFlash > 0.35 ? [255, 232, 220, 255] : [196, 30, 68, 255],
          );
          // 歪斜碎裂的战术护目镜微光与丧尸红眼
          fb.drawLine(
            rx + mux * 2.5 - mpx * 3.2,
            ry + muy * 2.5 - mpy * 3.2,
            rx + mux * 3.2,
            ry + muy * 3.2,
            1.6,
            [115, 235, 175, 215],
          );
          fb.fillCircle(rx + mux * 2.8 + mpx * 2.2, ry + muy * 2.8 + mpy * 2.2, 1.5, [255, 220, 85, 250]);
          continue;
        }

        // 小丧尸前探双爪短线（赋予每个红点生动的冲锋方向感与机械/生物线条细节）
        const moveAng = Math.atan2(r.vy || 1, r.vx || 0);
        for (const side of [-0.52, 0.52]) {
          const cAng = moveAng + side;
          fb.drawLine(
            rx + Math.cos(cAng) * (r.r * 0.6),
            ry + Math.sin(cAng) * (r.r * 0.6),
            rx + Math.cos(cAng) * (r.r + 3.2),
            ry + Math.sin(cAng) * (r.r + 3.2),
            1.8,
            [140, 18, 34, 235],
          );
        }

        fb.fillCircle(rx, ry, r.r + 1.3, [26, 5, 11, 240]);
        const bodyCol: RGBA =
          r.hitFlash > 0.35
            ? [255, 238, 215, 255]
            : r.kind === "infected_elite"
              ? [235, 32, 135, 255]
              : r.kind === "runner"
                ? [248, 52, 68, 255]
                : [215, 28, 48, 255];
        fb.fillCircle(rx, ry, r.r, bodyCol);
        // 背部暗色甲壳横纹与高光点
        fb.drawLine(rx - r.r * 0.55, ry - 1, rx + r.r * 0.55, ry - 1, 1.3, [95, 10, 24, 200]);
        fb.fillCircle(rx - r.r * 0.28, ry - r.r * 0.28, r.r * 0.34, [255, 135, 145, 215]);
      }

      // 5. 绘制 4 大守护泰坦 Boss（多节重甲肩甲线条 + 双关节巨螯 + 胸腔裂隙核心）
      for (let i = 0; i < simRender.reds.length; i++) {
        const r = simRender.reds[i];
        if (r.kind !== "boss") continue;
        const rx = ox + r.x;
        const ry = oy + r.y;
        const isFinal = Boolean(r.isFinalBoss);
        const faceAng = Math.PI * 0.5;

        fb.drawGlowCircle(
          rx,
          ry,
          r.r * 1.45,
          isFinal ? [210, 20, 50, 95] : [180, 24, 42, 75],
        );

        const isHitPulse = r.hitFlash > 0.55 && frameIdx % 2 === 0;
        const spikeCount = isFinal ? 10 : 8;
        for (let s = 0; s < spikeCount; s++) {
          const sAng = faceAng + (s * Math.PI * 2) / spikeCount;
          const sx0 = rx + Math.cos(sAng) * (r.r * 0.72);
          const sy0 = ry + Math.sin(sAng) * (r.r * 0.72);
          const sx1 = rx + Math.cos(sAng) * (r.r + (isFinal ? 8.0 : 6.0));
          const sy1 = ry + Math.sin(sAng) * (r.r + (isFinal ? 8.0 : 6.0));
          fb.drawLine(
            sx0,
            sy0,
            sx1,
            sy1,
            isFinal ? 4.8 : 4.0,
            isHitPulse ? [255, 165, 130, 255] : [125, 16, 32, 250],
          );
        }

        // 双关节重甲巨螯线条
        for (const side of [-1, 1]) {
          const shoulderAng = faceAng + side * 0.62;
          const elbowAng = faceAng + side * 0.42;
          const tipAng = faceAng + side * 0.22;
          const sx = rx + Math.cos(shoulderAng) * (r.r * 0.82);
          const sy = ry + Math.sin(shoulderAng) * (r.r * 0.82);
          const ex = rx + Math.cos(elbowAng) * (r.r + 7.5);
          const ey = ry + Math.sin(elbowAng) * (r.r + 7.5);
          const tx = rx + Math.cos(tipAng) * (r.r + 12.5);
          const ty = ry + Math.sin(tipAng) * (r.r + 12.5);
          fb.drawLine(sx, sy, ex, ey, 5.5, [155, 20, 40, 255]);
          fb.drawLine(ex, ey, tx, ty, 3.8, [235, 75, 85, 255]);
          fb.fillCircle(ex, ey, 3.2, [255, 140, 120, 255]);
        }

        // 八角重甲躯干与内部装甲接缝线
        fb.fillCircle(rx, ry, r.r + 2.4, [28, 5, 12, 255]);
        const outerArmor: RGBA = isHitPulse
          ? [230, 65, 75, 255]
          : isFinal
            ? [145, 12, 36, 255]
            : [168, 20, 40, 255];
        fb.fillCircle(rx, ry, r.r, outerArmor);
        drawPolygonLines(
          fb,
          rx,
          ry,
          r.r - 1.5,
          8,
          Math.PI / 8,
          2.2,
          [72, 8, 20, 240],
          true,
          [92, 10, 26, 215],
        );

        const innerCore: RGBA = isHitPulse
          ? [255, 130, 105, 255]
          : isFinal
            ? [225, 28, 62, 255]
            : [218, 38, 58, 255];
        fb.fillCircle(rx, ry, r.r * 0.62, innerCore);
        drawPolygonLines(fb, rx, ry, r.r * 0.62, 6, 0, 1.8, [255, 150, 110, 230]);

        const eyeDist = r.r * 0.44;
        for (const side of [-1, 1]) {
          const eAng = faceAng + side * 0.34;
          const ex = rx + Math.cos(eAng) * eyeDist;
          const ey = ry + Math.sin(eAng) * eyeDist;
          fb.fillCircle(ex, ey, isFinal ? 3.8 : 3.2, [255, 245, 105, 255]);
        }

        const barW = isFinal ? 78 : 62;
        const barH = isFinal ? 7 : 6;
        const barX = rx - barW * 0.5;
        const barY = ry - r.r - 16;
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

        drawWorldText(
          `${Math.ceil(r.hp)}`,
          rx,
          barY - 19,
          isFinal ? [255, 225, 110, 255] : [255, 195, 200, 245],
          isFinal ? 0.30 : 0.26,
          "center",
          { outlineWidth: 2.5, outlineColor: [8, 10, 16, 245] },
        );
      }

      // 6. 绘制高细节「笔直交叉火网」（纤细笔直气浪基线 + 高速分段曳光弹芯脉冲 + 枪口三叉制退火舌 + 受击点三向碎裂火光）
      for (let i = 0; i < simRender.firingLines.length; i++) {
        const line = simRender.firingLines[i];
        const lx1 = ox + line.x1;
        const ly1 = oy + line.y1;
        const lx2 = ox + line.x2;
        const ly2 = oy + line.y2;

        const dx = lx2 - lx1;
        const dy = ly2 - ly1;
        const totalLen = Math.hypot(dx, dy) || 1;
        const ux = dx / totalLen;
        const uy = dy / totalLen;
        const px = -uy;
        const py = ux;

        if (line.corrupted) {
          // 变异叛变枪兵发射的腐化紫绿电弧弹道！
          const midX = (lx1 + lx2) * 0.5 + px * (((frameIdx + i) % 2 === 0 ? 1 : -1) * 6);
          const midY = (ly1 + ly2) * 0.5 + py * (((frameIdx + i) % 2 === 0 ? 1 : -1) * 6);
          fb.drawLine(lx1, ly1, midX, midY, 3.8, [245, 38, 185, 195]);
          fb.drawLine(midX, midY, lx2, ly2, 3.8, [245, 38, 185, 195]);
          fb.drawLine(lx1, ly1, midX, midY, 1.6, [125, 255, 175, 245]);
          fb.drawLine(midX, midY, lx2, ly2, 1.6, [125, 255, 175, 245]);
          fb.drawGlowCircle(lx2, ly2, 7.5, [255, 55, 195, 210]);
          continue;
        }

        const isCyan = line.role === "turret" || line.role === "sniper";

        // 6a. 贯穿枪口至受击点的纤细笔直弹道基线（确保“一条直线打过去”的几何清晰度，同时告别粗重死板的黄棍感）
        const baseGlowCol: RGBA = isCyan
          ? [45, 205, 255, 52]
          : line.buffed
            ? [255, 190, 48, 56]
            : [255, 170, 42, 46];
        const coreBeamCol: RGBA = isCyan
          ? [145, 245, 255, 165]
          : [255, 232, 125, 165];
        fb.drawLine(lx1, ly1, lx2, ly2, 3.4, baseGlowCol);
        fb.drawLine(lx1, ly1, lx2, ly2, 1.3, coreBeamCol);

        // 6b. 沿笔直射线高速飞驰的分段超音速曳光弹芯脉冲 (Supersonic Segmented Tracer Pulses)
        const pulseCount = totalLen > 240 ? 2 : 1;
        for (let pIdx = 0; pIdx < pulseCount; pIdx++) {
          const phase = ((frameIdx * 0.38 + i * 0.23 + pIdx * 0.5) % 1.0);
          const headDist = phase * totalLen;
          const tailDist = Math.max(0, headDist - Math.min(58, totalLen * 0.35));
          const hx0 = lx1 + ux * tailDist;
          const hy0 = ly1 + uy * tailDist;
          const hx1 = lx1 + ux * headDist;
          const hy1 = ly1 + uy * headDist;

          fb.drawLine(
            hx0,
            hy0,
            hx1,
            hy1,
            isCyan ? 3.2 : 2.8,
            isCyan ? [95, 240, 255, 245] : [255, 225, 95, 245],
          );
          fb.drawLine(
            hx1 - ux * 16,
            hy1 - uy * 16,
            hx1,
            hy1,
            1.8,
            [255, 255, 250, 255],
          );
        }

        // 6c. 枪口三叉制退器喷焰细线 (Muzzle Brake V-Flash)
        fb.drawLine(lx1, ly1, lx1 + ux * 13, ly1 + uy * 13, 2.4, [255, 255, 225, 245]);
        for (const side of [-1, 1]) {
          const vx = lx1 + (ux * 7 + px * side * 5);
          const vy = ly1 + (uy * 7 + py * side * 5);
          fb.drawLine(lx1, ly1, vx, vy, 1.6, isCyan ? [150, 245, 255, 220] : [255, 215, 90, 220]);
        }

        // 6d. 终点（前排目标受击表面）三向溅射火花细线，直观呈现子弹被前排结结实实物理挡住！
        const sparkR =
          line.hitKind === "hive"
            ? 9
            : line.hitKind === "boss" || line.hitKind === "node"
              ? 7.5
              : 5.5;
        fb.drawGlowCircle(
          lx2,
          ly2,
          sparkR,
          line.hitKind === "node"
            ? [115, 255, 195, 185]
            : isCyan
              ? [115, 240, 255, 185]
              : [255, 205, 75, 180],
        );
        // 沿受击法线向两侧反弹的 3 道锐利跳弹火光细线
        for (const refl of [-0.65, 0, 0.65]) {
          const rAng = Math.atan2(-uy, -ux) + refl + ((frameIdx + i) % 3 - 1) * 0.12;
          const rLen = sparkR + 4.5;
          fb.drawLine(
            lx2,
            ly2,
            lx2 + Math.cos(rAng) * rLen,
            ly2 + Math.sin(rAng) * rLen,
            1.6,
            [255, 250, 215, 245],
          );
        }
        fb.fillCircle(lx2, ly2, 2.6, [255, 255, 245, 255]);
      }

      // 7. 绘制飞溅旋转家具/玻璃碎片 (DebrisShard) 与受击粒子
      for (let di = 0; di < simRender.debris.length; di++) {
        const db = simRender.debris[di];
        const alpha = clamp(Math.round((db.ttl / db.maxTtl) * db.color[3]), 0, 255);
        const dx = ox + db.x;
        const dy = oy + db.y;
        const ux = Math.cos(db.rot);
        const uy = Math.sin(db.rot);
        const halfL = db.len * 0.5;
        fb.drawLine(dx - ux * halfL + 2, dy - uy * halfL + 3, dx + ux * halfL + 2, dy + uy * halfL + 3, db.wid, [4, 6, 10, Math.round(alpha * 0.55)]);
        const shardCol: RGBA = [db.color[0], db.color[1], db.color[2], alpha];
        fb.drawLine(dx - ux * halfL, dy - uy * halfL, dx + ux * halfL, dy + uy * halfL, db.wid, shardCol);
        if (db.shape === "glass") {
          fb.drawLine(dx - uy * 2.5, dy + ux * 2.5, dx + ux * halfL, dy + uy * halfL, 1.3, [235, 252, 255, alpha]);
        }
      }

      for (const sp of simRender.sparks) {
        const alpha = clamp(Math.round((sp.ttl / sp.maxTtl) * 245), 0, 245);
        const sx = ox + sp.x;
        const sy = oy + sp.y;
        if (sp.kind === "blood") {
          fb.fillCircle(sx, sy, 2.6, [225, 24, 42, alpha]);
        } else if (sp.kind === "bio") {
          fb.fillCircle(sx, sy, 3.2, sp.ttl % 2 === 0 ? [255, 45, 195, alpha] : [95, 255, 165, alpha]);
        } else if (sp.kind === "gold") {
          fb.fillCircle(sx, sy, 3.0, [255, 235, 95, alpha]);
        } else {
          fb.drawLine(sx, sy, sx - sp.vx * 1.8, sy - sp.vy * 1.8, 2.0, [255, 238, 130, alpha]);
        }
      }

      // 8. 绘制我方绿色军团（高精度八角重机枪碉堡 + 带战术肩甲/护目镜/导轨枪管的绿兵）
      for (let i = 0; i < simRender.greens.length; i++) {
        const g = simRender.greens[i];
        const gx = ox + g.x;
        const gy = oy + g.y;
        const ang = g.aimAngle;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const px = -uy;
        const py = ux;

        if (g.role === "turret") {
          // 重机枪碉堡：八角装甲底座 + 内部十字机械线 + 双联加特林枪管与横向稳定翼
          fb.drawGlowCircle(gx, gy, g.r * 1.55, [55, 215, 255, 80]);
          fb.fillCircle(gx, gy, g.r + 2, [18, 28, 42, 255]);
          fb.fillCircle(gx, gy, g.r, [38, 132, 182, 255]);
          drawPolygonLines(
            fb,
            gx,
            gy,
            g.r + 1,
            8,
            Math.PI / 8,
            2.2,
            [140, 242, 255, 250],
            true,
            [24, 78, 115, 210],
          );

          for (const side of [-4.0, 4.0]) {
            const bx0 = gx + px * side + ux * (g.r * 0.25 - g.recoilOffset);
            const by0 = gy + py * side + uy * (g.r * 0.25 - g.recoilOffset);
            const bx1 = gx + px * side + ux * (g.r + 13 - g.recoilOffset);
            const by1 = gy + py * side + uy * (g.r + 13 - g.recoilOffset);
            fb.drawLine(bx0, by0, bx1, by1, 3.6, [32, 46, 66, 255]);
            fb.drawLine(bx0, by0, bx1, by1, 1.8, [205, 238, 255, 255]);
          }
          // 枪管前段横向箍环线
          const braceX = gx + ux * (g.r + 6 - g.recoilOffset);
          const braceY = gy + uy * (g.r + 6 - g.recoilOffset);
          fb.drawLine(braceX - px * 5, braceY - py * 5, braceX + px * 5, braceY + py * 5, 2.0, [150, 235, 255, 255]);

          fb.fillCircle(gx, gy, g.r * 0.48, [175, 248, 255, 255]);
          fb.strokeRing(gx, gy, g.r * 0.48, 1.6, [28, 72, 105, 245]);
          continue;
        }

        // 普通绿点士兵（脚下战术 V 型底座线 + 精密导轨步枪 + 描边双肩甲 + 发光战术护目镜）
        fb.drawGlowCircle(
          gx,
          gy,
          g.r * 1.4,
          g.buffed ? [255, 215, 65, 72] : [40, 235, 145, 64],
        );

        const recoil = g.recoilOffset;
        const gunStart = g.r * 0.2 - recoil;
        const gunEnd = g.r + 11.5 - recoil;
        // 枪械外框与高光导轨细线
        fb.drawLine(
          gx + ux * gunStart,
          gy + uy * gunStart,
          gx + ux * gunEnd,
          gy + uy * gunEnd,
          4.2,
          [32, 40, 54, 255],
        );
        fb.drawLine(
          gx + ux * (gunStart + 1.5),
          gy + uy * (gunStart + 1.5),
          gx + ux * (gunEnd - 0.8),
          gy + uy * (gunEnd - 0.8),
          1.8,
          [185, 208, 235, 255],
        );

        // 士兵双肩护甲（带深色外轮廓线）
        for (const side of [-1, 1]) {
          const sx = gx + px * side * (g.r * 0.72);
          const sy = gy + py * side * (g.r * 0.72);
          fb.fillCircle(sx, sy, 5.2, [14, 34, 24, 255]);
          fb.fillCircle(sx, sy, 3.8, [28, 162, 96, 255]);
        }

        // 士兵头盔主体与内圈装甲分界线
        fb.fillCircle(gx, gy, g.r + 1.5, [12, 28, 20, 255]);
        const helmetCol: RGBA =
          g.role === "sniper"
            ? [48, 235, 195, 255]
            : g.role === "shotgun"
              ? [68, 235, 115, 255]
              : [38, 215, 122, 255];
        fb.fillCircle(gx, gy, g.r, helmetCol);
        fb.strokeRing(gx, gy, g.r * 0.68, 1.3, [22, 125, 74, 220]);
        fb.fillCircle(gx - ux * 1.5, gy - uy * 1.5, g.r * 0.52, [115, 255, 182, 255]);

        // 战术护目镜横线
        const visorX = gx + ux * (g.r * 0.48);
        const visorY = gy + uy * (g.r * 0.48);
        fb.drawLine(
          visorX - px * 4.4,
          visorY - py * 4.4,
          visorX + px * 4.4,
          visorY + py * 4.4,
          2.6,
          g.buffed ? [255, 242, 115, 255] : [215, 255, 255, 255],
        );
      }

      // 8.6 绘制高速抛射旋转黄铜弹壳与机载破片火箭弹尾焰轨迹
      for (let i = 0; i < simRender.shells.length; i++) {
        const sh = simRender.shells[i];
        const sx = ox + sh.x;
        const sy = oy + sh.y;
        const alpha = clamp(Math.round((sh.ttl / sh.maxTtl) * 235), 0, 235);
        const halfLen = sh.heavy ? 3.4 : 2.3;
        const dx = Math.cos(sh.rot) * halfLen;
        const dy = Math.sin(sh.rot) * halfLen;
        fb.drawLine(sx - dx, sy - dy, sx + dx, sy + dy, sh.heavy ? 2.1 : 1.5, [255, 215, 82, alpha]);
      }
      for (let i = 0; i < simRender.rockets.length; i++) {
        const rk = simRender.rockets[i];
        const rx = ox + rk.x;
        const ry = oy + rk.y;
        const vLen = Math.hypot(rk.vx, rk.vy) || 1;
        const ux = rk.vx / vLen;
        const uy = rk.vy / vLen;
        fb.drawLine(rx - ux * 34, ry - uy * 34, rx, ry, 5.2, [255, 165, 55, 110]);
        fb.drawLine(rx - ux * 20, ry - uy * 20, rx, ry, 2.8, [255, 240, 155, 235]);
        fb.drawGlowCircle(rx - ux * 4, ry - uy * 4, 14, [255, 195, 65, 195]);
        fb.drawLine(rx - ux * 5, ry - uy * 5, rx + ux * 6, ry + uy * 6, 3.6, [235, 248, 255, 255]);
      }

      // 8.7 战术载具入场渲染
      renderInsertionVehicles(fb, simRender, atlas, ox, oy, frameIdx);

      // 8.8 最后统一施加【高斯柔化自然战争迷雾】（遮蔽所有未见商铺/墙后尸群/未照亮任务点，仅让未见建筑边缘与求救波纹若隐若现！）
      applyDeadCornerRaycastLighting(screenFb, fb, simRender, frameIdx);

      // 8.85 战争迷雾之上的【铁笼+1 任务反馈层】：
      //      - 未照亮盲区内铁笼：仅透出极微弱呼吸虚影（若隐若现，去除制式化瞄准角框）；
      //      - 照亮破锁中的铁笼：紧贴铁笼呈现精致 27px 破锁进度环与清晰 "+1" 提示！
      for (const n of simRender.nodes) {
        if (n.broken) continue;
        const nx = ox + n.x;
        const ny = oy + n.y;
        const prog = clamp(n.breachProgress ?? 0, 0, 1);
        let revealed = !simRender.isDarkMode || prog > 0.005;
        if (!revealed) {
          for (let gi = 0; gi < simRender.greens.length; gi++) {
            const g = simRender.greens[gi];
            if (
              Math.hypot(g.x - n.x, g.y - n.y) <= 275 &&
              simRender.hasLineOfSight(g.x, g.y, n.x, n.y)
            ) {
              revealed = true;
              break;
            }
          }
        }
        const ringRad = n.r + 6;
        if (revealed) {
          if (prog > 0.008) {
            fb.strokeRing(nx, ny, ringRad, 3.2, [10, 16, 24, 210]);
            const arcCol: RGBA =
              n.kind === "rescue_cage"
                ? [85, 255, 172, 255]
                : n.kind === "multiply_crystal"
                  ? [255, 225, 85, 255]
                  : [115, 235, 255, 255];
            drawRadialProgressArc(fb, nx, ny, ringRad, 4.2, prog, arcCol);
            const headAng = -Math.PI * 0.5 + prog * Math.PI * 2;
            fb.drawGlowCircle(
              nx + Math.cos(headAng) * ringRad,
              ny + Math.sin(headAng) * ringRad,
              6.5,
              arcCol,
            );
          }
          drawWorldText(
            n.label,
            nx,
            ny - n.r - 16,
            n.kind === "rescue_cage"
              ? [125, 255, 188, 250]
              : n.kind === "multiply_crystal"
                ? [255, 228, 95, 250]
                : [135, 240, 255, 250],
            0.29,
            "center",
            { outlineWidth: 2.8, outlineColor: [8, 10, 16, 245] },
          );
        } else {
          const ghostBreathe = 0.5 + 0.5 * Math.sin(frameIdx * 0.12 + n.x * 0.03 + n.y * 0.02);
          const ghostA = Math.round(28 + 26 * ghostBreathe);
          const ghostCol: RGBA =
            n.kind === "rescue_cage" ? [85, 225, 155, ghostA] : [95, 210, 245, ghostA];
          drawWorldText(
            n.label,
            nx,
            ny - n.r - 14,
            ghostCol,
            0.25,
            "center",
            { outlineWidth: 1.8, outlineColor: [6, 8, 14, ghostA] },
          );
        }
      }

      // 9. 绘制纯算术符号飘字 (+6, ×2, +7, -1)
      for (const b of simRender.banners) {
        const alpha = clamp(Math.round((b.ttl / b.maxTtl) * 255), 0, 255);
        const col: RGBA = [b.color[0], b.color[1], b.color[2], alpha];
        drawWorldText(
          b.text,
          ox + b.x,
          oy + b.y,
          col,
          0.38,
          "center",
          { outlineWidth: 3.0, outlineColor: [8, 10, 16, Math.min(245, alpha)] },
        );
      }

      // 9.5 裁剪视口外溢像素并绘制战场外框、右上角【全局战术小地图 + 动态变焦视野跟随白框】
      clipHudMarginsAndDrawArenaBorder(screenFb, modeId);

      // 9.8 感染惊悚紫红全屏四周压迫渐晕脉冲 (Bio-Infection Edge Vignette Pulse)
      if (simRender.infectionFlash > 0.02) {
        const vigA = clamp(Math.round(simRender.infectionFlash * 155), 0, 165);
        const vigCol: RGBA = [245, 28, 155, vigA];
        const zeroCol: RGBA = [245, 28, 155, 0];
        const band = 56;
        screenFb.blendGradientRect(BOARD_X, BOARD_Y, ARENA_W, band, vigCol, zeroCol, true);
        screenFb.blendGradientRect(BOARD_X, BOARD_Y + ARENA_H - band, ARENA_W, band, zeroCol, vigCol, true);
        screenFb.blendGradientRect(BOARD_X, BOARD_Y, band, ARENA_H, vigCol, zeroCol, false);
        screenFb.blendGradientRect(BOARD_X + ARENA_W - band, BOARD_Y, band, ARENA_H, zeroCol, vigCol, false);
        screenFb.strokeRoundRect(BOARD_X + 2, BOARD_Y + 2, ARENA_W - 4, ARENA_H - 4, 4, 6, [255, 45, 175, vigA]);
      }

      renderGlobalMinimapAndTelemetry(screenFb, simRender, atlas, frameIdx);

      // 10. 减员危机红框脉冲
      if (simRender.alarmFlash > 0.05) {
        const a = clamp(Math.round(simRender.alarmFlash * 110), 0, 125);
        screenFb.strokeRoundRect(BOARD_X, BOARD_Y, ARENA_W, ARENA_H, 4, 5, [255, 42, 58, a]);
      }

      // 11. 顶部纯图形符号零文字解说「红绿阵营实时战力拉锯条 + 矢量阵营徽标 + 泰坦菱形指示灯 + 数字计数 HUD」
      const barX = BOARD_X;
      const barY = 92;
      const barW = ARENA_W;
      const barH = 24;
      let aliveBossCount = 0;
      for (let i = 0; i < simRender.reds.length; i++) {
        if (simRender.reds[i].kind === "boss") aliveBossCount++;
      }
      let undeployedHumans = 0;
      for (let i = 0; i < simRender.vehicles.length; i++) {
        const v = simRender.vehicles[i];
        undeployedHumans += Math.max(0, v.totalToDeploy - v.deployedCount);
      }
      const totalHumans = simRender.greens.length + undeployedHumans;
      const greenPower = totalHumans * 16;
      const redPower =
        simRender.reds.length * 1.2 +
        aliveBossCount * 80 +
        (hive.alive ? (hive.hp / hive.maxHp) * 90 : 0);
      const tugFrac =
        totalHumans === 0
          ? 0.0
          : hive.alive || simRender.reds.length > 0
            ? clamp(greenPower / Math.max(1, greenPower + redPower), 0.10, 0.92)
            : 1.0;

      screenFb.blendRoundRect(barX, barY, barW, barH, 12, [22, 26, 36, 240]);
      screenFb.blendRoundRect(barX, barY, barW, barH, 12, [215, 38, 58, 225]);
      const greenW = Math.round(barW * tugFrac);
      const barCol: RGBA =
        tugFrac < 0.28
          ? [255, 145, 45, 255]
          : simRender.counterPushActive
            ? [255, 195, 45, 255]
            : [42, 225, 132, 255];
      if (greenW > 0) {
        screenFb.blendRoundRect(barX, barY, greenW, barH, 12, barCol);
        screenFb.fillRect(barX + greenW - 2, barY - 5, 4, barH + 10, [255, 255, 255, 255]);
      }
      screenFb.strokeRoundRect(barX, barY, barW, barH, 12, 2, [85, 98, 128, 200]);

      const squadCol: RGBA =
        totalHumans === 0
          ? [255, 65, 95, 255]
          : totalHumans <= 5
            ? [255, 135, 95, 255]
            : simRender.counterPushActive
              ? [255, 220, 75, 255]
              : [80, 245, 155, 255];

      // 左侧矢量人类战术头盔/护目镜徽标 + 幸存兵力数字
      const gIconX = barX + 18;
      const gIconY = 154;
      screenFb.fillCircle(gIconX, gIconY, 12, [14, 34, 26, 245]);
      screenFb.fillCircle(gIconX, gIconY, 10, squadCol);
      screenFb.drawLine(gIconX - 6, gIconY - 1, gIconX + 6, gIconY - 1, 3.0, [225, 255, 255, 255]);
      atlas.drawStyled(
        screenFb,
        `${totalHumans}`,
        barX + 40,
        158,
        squadCol,
        0.44,
        "left",
        { outlineWidth: 2.8, outlineColor: [8, 10, 16, 240] },
      );

      // 中央 4 枚泰坦 Boss 菱形进度指示灯（纯图形化提示已击杀/存活 Boss 数，零文字）
      const pipCenterX = OUT_W * 0.5;
      const pipY = 154;
      for (let bIdx = 0; bIdx < simRender.totalBosses; bIdx++) {
        const px = pipCenterX + (bIdx - (simRender.totalBosses - 1) * 0.5) * 28;
        const killed = bIdx < simRender.bossesKilled;
        const spawned = bIdx < simRender.bossesSpawned;
        const pipCol: RGBA = killed
          ? [65, 245, 155, 235]
          : spawned
            ? [255, 65, 85, 255]
            : [85, 96, 118, 165];
        if (spawned && !killed) {
          screenFb.drawGlowCircle(px, pipY, 13, [255, 45, 65, 135]);
        }
        drawPolygonLines(screenFb, px, pipY, 7.5, 4, 0, 2.2, pipCol, !killed);
      }

      // 右侧矢量尸潮利爪生物徽标 + 实时丧尸总数
      const rIconX = barX + barW - 18;
      const rIconY = 154;
      screenFb.fillCircle(rIconX, rIconY, 12, [36, 10, 18, 245]);
      screenFb.fillCircle(rIconX, rIconY, 10, [245, 45, 68, 255]);
      screenFb.fillCircle(rIconX - 3.5, rIconY - 1, 2.2, [255, 240, 110, 255]);
      screenFb.fillCircle(rIconX + 3.5, rIconY - 1, 2.2, [255, 240, 110, 255]);
      atlas.drawStyled(
        screenFb,
        `${simRender.reds.length}`,
        barX + barW - 40,
        158,
        [255, 110, 125, 255],
        0.44,
        "right",
        { outlineWidth: 2.8, outlineColor: [8, 10, 16, 240] },
      );

      yield screenFb;
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
    modeId,
    kills: simRender.kills,
    bossesKilled: simRender.bossesKilled,
    totalBosses: simRender.totalBosses,
    aliveGreens: simRender.greens.length,
    rescuedCount: simRender.rescuedCount,
    casualties: simRender.casualties,
  };
}

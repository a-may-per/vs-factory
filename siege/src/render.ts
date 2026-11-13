// siege 帧渲染器（高精度机械要塞线条 + 笔直弹道脉冲/枪口制退焰/受击裂片细节 + 棱镜晶石/钢筋囚笼/生物母巢精细刻画 + 1080x1920 竖屏成片）
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  ARENA_W,
  ARENA_H,
  WORLD_W,
  WORLD_H,
  CORRIDOR_CX,
  SIEGE_MODE_META,
  getCorridorBounds,
  getOuterWallSegments,
  type SiegeMapId,
  type SiegeModeId,
} from "./config.ts";
import {
  SiegeSimulator,
  SIM_HZ,
  NAV_COLS,
  NAV_ROWS,
  NAV_CELL,
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
 * 绘制各模式专属【战术入场载具（重装防暴军用大巴 / 押运装甲大巴 / 黑鹰武装直升机 / 声呐侦察直升机）】
 */
function renderInsertionVehicles(
  fb: FrameBuf,
  sim: SiegeSimulator,
  atlas: FontAtlas,
  ox: number,
  oy: number,
  frameIdx: number,
): void {
  for (let i = 0; i < sim.vehicles.length; i++) {
    const v = sim.vehicles[i];
    if (v.phase === "gone") continue;
    const vx = ox + v.x;
    const vy = oy + v.y;
    if (
      vx < BOARD_X - 110 ||
      vx > BOARD_X + ARENA_W + 110 ||
      vy < BOARD_Y - 110 ||
      vy > BOARD_Y + ARENA_H + 110
    ) {
      continue;
    }

    if (v.kind === "bus") {
      const isPrison = sim.mode === "maze-infect";
      const bodyCol: RGBA = isPrison ? [46, 26, 62, 255] : [32, 56, 78, 255];
      const roofCol: RGBA = isPrison ? [66, 36, 86, 255] : [48, 82, 112, 255];
      const borderCol: RGBA = isPrison ? [245, 115, 215, 250] : [115, 225, 255, 250];

      // 1. 急刹双轮胎黑色刹车印痕
      for (const tx of [-18, 18]) {
        fb.drawLine(vx + tx, vy + 42, vx + tx, vy + 108, 4.5, [8, 10, 16, 175]);
      }

      // 2. 车身底部厚重阴影与 6 轮外凸防爆宽胎
      fb.blendRoundRect(vx - 29, vy - 54, 58, 108, 9, [5, 8, 14, 225]);
      for (const wyOff of [-32, 0, 32]) {
        fb.fillRect(vx - 28, vy + wyOff - 7, 5, 14, [18, 22, 28, 255]);
        fb.fillRect(vx + 23, vy + wyOff - 7, 5, 14, [18, 22, 28, 255]);
      }

      // 3. 车头重装 V 型破障撞角 (Armored Ram Bumper)
      fb.drawLine(vx - 25, vy - 46, vx, vy - 59, 4.8, [195, 215, 235, 255]);
      fb.drawLine(vx + 25, vy - 46, vx, vy - 59, 4.8, [195, 215, 235, 255]);
      fb.drawLine(vx - 18, vy - 50, vx + 18, vy - 50, 3.0, [255, 195, 45, 245]);

      // 4. 装甲大巴主车体与防弹百叶前挡风窗
      fb.blendRoundRect(vx - 24, vy - 48, 48, 96, 7, bodyCol);
      fb.strokeRoundRect(vx - 24, vy - 48, 48, 96, 7, 2.4, borderCol);

      fb.blendRoundRect(vx - 19, vy - 42, 38, 15, 3, [14, 22, 34, 250]);
      for (const ly of [-39, -35, -31]) {
        fb.drawLine(vx - 17, vy + ly, vx + 17, vy + ly, 1.5, borderCol);
      }

      // 5. 两侧液压展开式突击车门与绿色出舱引导踏板
      if (v.doorOpen > 0.05) {
        const span = v.doorOpen * 14;
        for (const side of [-1, 1]) {
          const dx0 = vx + side * 24;
          const dx1 = vx + side * (24 + span);
          fb.drawLine(dx0, vy - 24, dx1, vy - 18, 3.6, [95, 255, 175, 245]);
          fb.drawLine(dx0, vy - 10, dx1, vy - 18, 2.4, borderCol);
        }
      }

      // 6. 车顶装甲舱盖、车内待命士兵头盔与车顶 360 度旋转双联重机枪塔 (Roof Twin Autocannon Turret)
      fb.blendRoundRect(vx - 15, vy - 20, 30, 54, 4, roofCol);
      fb.strokeRoundRect(vx - 15, vy - 20, 30, 54, 4, 1.6, borderCol);

      // 车内尚未下车的士兵（透过装甲天窗可见绿色战术头盔，随开门下车逐一减少）
      const remainingInside = Math.max(0, v.totalToDeploy - v.deployedCount);
      for (let uIdx = 0; uIdx < remainingInside; uIdx++) {
        const col = uIdx % 2 === 0 ? -7 : 7;
        const row = Math.floor(uIdx / 2) * 12 + 4;
        fb.fillCircle(vx + col, vy + row, 4.2, [45, 235, 135, 255]);
        fb.strokeRing(vx + col, vy + row, 4.2, 1.2, [12, 32, 22, 240]);
      }

      // 车顶旋转双联重机枪塔座與双枪管 + 开火制退焰
      const tX = vx;
      const tY = vy - 12;
      const tux = Math.cos(v.turretAngle);
      const tuy = Math.sin(v.turretAngle);
      const tpx = -tuy;
      const tpy = tux;
      drawPolygonLines(fb, tX, tY, 10, 6, v.turretAngle, 2.0, borderCol, true);
      for (const side of [-3.5, 3.5]) {
        const bx0 = tX + tpx * side + tux * 4;
        const by0 = tY + tpy * side + tuy * 4;
        const bx1 = tX + tpx * side + tux * 20;
        const by1 = tY + tpy * side + tuy * 20;
        fb.drawLine(bx0, by0, bx1, by1, 3.4, [28, 38, 52, 255]);
        fb.drawLine(bx0, by0, bx1, by1, 1.6, [215, 242, 255, 255]);
        if (v.muzzleFlash > 0.08) {
          fb.drawGlowCircle(bx1 + tux * 4, by1 + tuy * 4, 14, [255, 215, 75, 210]);
          fb.drawLine(bx1, by1, bx1 + tux * 12, by1 + tuy * 12, 2.8, [255, 248, 175, 255]);
        }
      }

      // 推进阶段两侧射击孔火舌
      if (v.muzzleFlash > 0.08 && v.phase === "inbound") {
        for (const side of [-1, 1]) {
          const px0 = vx + side * 24;
          const py0 = vy - 6;
          fb.drawGlowCircle(px0 + side * 5, py0 - 4, 12, [255, 195, 65, 195]);
          fb.drawLine(px0, py0, px0 + side * 10, py0 - 9, 2.4, [255, 242, 165, 250]);
        }
      }

      const flashLeft = frameIdx % 8 < 4;
      const leftStrobe: RGBA = flashLeft ? [255, 45, 68, 255] : [65, 215, 255, 255];
      const rightStrobe: RGBA = flashLeft ? [65, 215, 255, 255] : [255, 45, 68, 255];
      fb.drawGlowCircle(vx - 11, vy - 24, 15, [leftStrobe[0], leftStrobe[1], leftStrobe[2], 150]);
      fb.drawGlowCircle(vx + 11, vy - 24, 15, [rightStrobe[0], rightStrobe[1], rightStrobe[2], 150]);
      fb.fillCircle(vx - 11, vy - 24, 3.8, leftStrobe);
      fb.fillCircle(vx + 11, vy - 24, 3.8, rightStrobe);

      // 7. 车头双远光卤素大灯与车尾红色刹车灯
      for (const hxOff of [-15, 15]) {
        fb.drawGlowCircle(vx + hxOff, vy - 48, 20, [255, 245, 185, 185]);
        fb.fillCircle(vx + hxOff, vy - 48, 4.5, [255, 255, 225, 255]);
        fb.fillCircle(vx + hxOff, vy + 47, 3.6, [255, 42, 55, 245]);
      }
    } else {
      // 黑鹰武装直升机 / 声呐潜行直升机俯视高精度渲染（含双翼加特林机炮 + 火箭巢扫射火舌）
      const isSonar = sim.mode === "sonar";
      const ux = Math.cos(v.angle);
      const uy = Math.sin(v.angle);
      const px = -uy;
      const py = ux;

      // 1. 地面旋翼下洗气流环与双侧特战索降绳 (Fast-Ropes)
      fb.strokeRing(
        vx,
        vy,
        58 + Math.sin(frameIdx * 0.45) * 5,
        1.8,
        isSonar ? [65, 245, 215, 115] : [255, 215, 95, 105],
      );
      if (v.ropeDrop > 0.05) {
        for (const side of [-1, 1]) {
          const rx0 = vx + px * side * 20;
          const ry0 = vy + py * side * 20;
          const rx1 = vx + px * side * (36 * v.ropeDrop);
          const ry1 = vy + py * side * (36 * v.ropeDrop) + 12 * v.ropeDrop;
          fb.drawLine(rx0, ry0, rx1, ry1, 3.2, [235, 188, 82, 240]);
          fb.fillCircle(rx1, ry1, 4.0, [255, 230, 125, 245]);
        }
      }

      // 2. 尾梁 (Tail Boom)、水平尾翼与尾桨
      const tailX = vx - ux * 56;
      const tailY = vy - uy * 56;
      fb.drawLine(vx, vy, tailX, tailY, 8.5, [24, 34, 46, 255]);
      fb.drawLine(vx, vy, tailX, tailY, 4.2, isSonar ? [48, 125, 130, 255] : [62, 78, 96, 255]);
      fb.drawLine(
        tailX - px * 16,
        tailY - py * 16,
        tailX + px * 16,
        tailY + py * 16,
        4.0,
        [95, 135, 165, 250],
      );
      const trLen = 11 * Math.sin(frameIdx * 0.9);
      fb.drawLine(
        tailX + px * 8 - ux * trLen,
        tailY + py * 8 - uy * trLen,
        tailX + px * 8 + ux * trLen,
        tailY + py * 8 + uy * trLen,
        2.6,
        [215, 245, 255, 245],
      );

      // 3. 两侧短翼武器挂架 (Stub Wings + Twin Gatling Miniguns & Rocket Pods)
      const wLeftX = vx - px * 32;
      const wLeftY = vy - py * 32;
      const wRightX = vx + px * 32;
      const wRightY = vy + py * 32;
      fb.drawLine(wLeftX, wLeftY, wRightX, wRightY, 7.5, [34, 48, 64, 255]);
      fb.drawLine(wLeftX, wLeftY, wRightX, wRightY, 2.8, [120, 185, 225, 245]);
      for (const side of [-1, 1]) {
        const podX = vx + px * side * 28;
        const podY = vy + py * side * 28;
        const tipX = podX + ux * 18;
        const tipY = podY + uy * 18;
        fb.drawLine(podX - ux * 6, podY - uy * 6, tipX, tipY, 4.2, [42, 56, 74, 255]);
        fb.drawLine(podX - ux * 4, podY - uy * 4, tipX, tipY, 1.8, [210, 238, 255, 255]);
        if (v.muzzleFlash > 0.08) {
          fb.drawGlowCircle(tipX + ux * 5, tipY + uy * 5, 16, [255, 215, 75, 220]);
          fb.drawLine(tipX, tipY, tipX + ux * 14, tipY + uy * 14, 3.0, [255, 248, 185, 255]);
        }
      }
      fb.fillCircle(wLeftX, wLeftY, 4.2, [255, 48, 68, 255]);
      fb.fillCircle(wRightX, wRightY, 4.2, [55, 255, 155, 255]);

      // 4. 装甲机舱主体、舱内待命特战队员与前部防弹玻璃驾驶舱
      fb.fillCircle(vx, vy, 22, [22, 32, 44, 255]);
      drawPolygonLines(
        fb,
        vx,
        vy,
        21,
        8,
        v.angle,
        2.4,
        isSonar ? [75, 245, 215, 250] : [255, 205, 75, 250],
      );
      const remainingHeli = Math.max(0, v.totalToDeploy - v.deployedCount);
      for (let uIdx = 0; uIdx < remainingHeli; uIdx++) {
        const ang = (uIdx / Math.max(1, remainingHeli)) * Math.PI * 2;
        fb.fillCircle(vx + Math.cos(ang) * 9, vy + Math.sin(ang) * 9, 3.6, [45, 235, 135, 255]);
      }
      const noseX = vx + ux * 16;
      const noseY = vy + uy * 16;
      fb.fillCircle(noseX, noseY, 13, [85, 215, 255, 235]);
      fb.drawGlowCircle(noseX + ux * 6, noseY + uy * 6, 22, [255, 245, 185, 195]);

      // 5. 高速旋转四叶主旋翼 (4-Blade Main Rotor) 与气动残影环
      const rotorR = 64;
      fb.strokeRing(vx, vy, rotorR, 1.8, [175, 225, 255, 115]);
      for (let b = 0; b < 4; b++) {
        const bAng = v.rotorAngle + (b * Math.PI) / 2;
        const bx = vx + Math.cos(bAng) * rotorR;
        const by = vy + Math.sin(bAng) * rotorR;
        fb.drawLine(vx, vy, bx, by, 3.2, [42, 56, 74, 230]);
        fb.drawLine(vx, vy, bx, by, 1.5, [210, 238, 255, 240]);
        fb.fillCircle(bx, by, 3.0, [255, 230, 95, 250]);
      }
      fb.fillCircle(vx, vy, 6.5, [195, 225, 245, 255]);
    }
  }
}

/**
 * 绘制各模式专属室内死角防爆隔墙与转角铆钉柱 (`sim.deadCornerWalls`)
 * - scavenge: 战术冰蓝合金破门墙
 * - blackout: 核反应堆琥珀金防辐射挡板
 * - sonar: 深海荧光青声呐折流岩壁
 * - maze-infect: 生化紫红高压检疫监区隔墙
 */
function renderDeadCornerWalls(fb: FrameBuf, sim: SiegeSimulator): void {
  if (sim.deadCornerWalls.length === 0) return;
  const camX = Math.round(sim.camX);
  const camY = Math.round(sim.camY);
  const ox = BOARD_X - camX;
  const oy = BOARD_Y - camY;

  const bodyCol: RGBA =
    sim.mode === "scavenge"
      ? [24, 46, 68, 255]
      : sim.mode === "blackout"
        ? [48, 36, 18, 255]
        : sim.mode === "sonar"
          ? [14, 44, 48, 255]
          : [48, 18, 54, 255];

  const stripeCol: RGBA =
    sim.mode === "scavenge"
      ? [65, 215, 255, 235]
      : sim.mode === "blackout"
        ? [255, 185, 32, 235]
        : sim.mode === "sonar"
          ? [48, 240, 205, 235]
          : [245, 72, 185, 235];

  const borderCol: RGBA =
    sim.mode === "scavenge"
      ? [155, 235, 255, 245]
      : sim.mode === "blackout"
        ? [255, 222, 115, 245]
        : sim.mode === "sonar"
          ? [125, 255, 230, 245]
          : [255, 145, 225, 245];

  for (const w of sim.deadCornerWalls) {
    const x1 = ox + w.x1;
    const y1 = oy + w.y1;
    const x2 = ox + w.x2;
    const y2 = oy + w.y2;
    const minX = Math.min(x1, x2) - 8;
    const maxX = Math.max(x1, x2) + 8;
    const minY = Math.min(y1, y2) - 8;
    const maxY = Math.max(y1, y2) + 8;
    if (
      maxX < BOARD_X - 24 ||
      minX > BOARD_X + ARENA_W + 24 ||
      maxY < BOARD_Y - 24 ||
      minY > BOARD_Y + ARENA_H + 24
    ) {
      continue;
    }
    const rw = maxX - minX;
    const rh = maxY - minY;

    // 墙根深色投影与重甲钢梁主体
    fb.blendRoundRect(minX - 3, minY - 3, rw + 6, rh + 6, 4, [6, 8, 14, 220]);
    fb.blendRoundRect(minX, minY, rw, rh, 3, bodyCol);

    // 墙体表面高辨识度警示斜纹
    const isHoriz = rw >= rh;
    if (isHoriz) {
      for (let sx = minX + 10; sx < maxX - 10; sx += 18) {
        fb.drawLine(sx, minY + 3, sx + 7, maxY - 3, 3.2, stripeCol);
      }
    } else {
      for (let sy = minY + 10; sy < maxY - 10; sy += 18) {
        fb.drawLine(minX + 3, sy, maxX - 3, sy + 7, 3.2, stripeCol);
      }
    }

    // 双层合金切边高光线
    fb.strokeRoundRect(minX, minY, rw, rh, 3, 2.0, borderCol);
    fb.drawLine(x1, y1, x2, y2, 1.6, stripeCol);

    // 墙体两端八角防爆铆钉柱
    for (const [px, py] of [
      [x1, y1],
      [x2, y2],
    ]) {
      fb.fillCircle(px, py, 9.5, bodyCol);
      drawPolygonLines(fb, px, py, 9.0, 8, Math.PI / 8, 1.8, borderCol);
      fb.fillCircle(px, py, 3.2, stripeCol);
    }
  }
}

/**
 * 2D 射线遮挡光影迷雾 (2D Raycast Light & Shadow Fog-of-War) + 体积手电/探照灯光锥 + 死角暗处红眼闪烁
 * - 射线遮挡检测在 1800x3000 大世界坐标系中精确计算，再通过镜头偏移 (camX, camY) 投射到当前 984x1520 视野窗口！
 */
function applyDeadCornerRaycastLighting(
  fb: FrameBuf,
  sim: SiegeSimulator,
  atlas: FontAtlas,
  frameIdx: number,
): void {
  if (!sim.isDarkMode) return;
  const camX = Math.round(sim.camX);
  const camY = Math.round(sim.camY);
  const ox = BOARD_X - camX;
  const oy = BOARD_Y - camY;
  const tSec = sim.tick / SIM_HZ;

  const CELL = 4;
  const GW = Math.ceil(ARENA_W / CELL);
  const GH = Math.ceil(ARENA_H / CELL);
  const lightGrid = new Float32Array(GW * GH);
  const coneGrid = new Float32Array(GW * GH);
  const tintGrid = new Uint8Array(GW * GH); // 0: 默认手电, 1: 探照灯暖黄, 2: 声呐青绿

  // 基础环境底光：断电过载期 (blackoutActive) 极暗 (0.12)，常规死角期 (0.20)，终局总攻红色应急灯亮起后逐步提升至 0.56
  const lateFlood = tSec >= 24.5 ? clamp((tSec - 24.5) / 4.0, 0, 1) * 0.36 : 0;
  const baseAmbient = (sim.blackoutActive ? 0.12 : 0.20) + lateFlood;
  lightGrid.fill(baseAmbient);

  // 1. 为每个手电筒/旋转探照灯预计算 36 条 2D 射线墙体阻挡距离 (Ray-Wall Shadow Map)
  const RAY_COUNT = 36;
  const coneShadowMaps: Float32Array[] = [];

  for (let ci = 0; ci < sim.lightCones.length; ci++) {
    const c = sim.lightCones[ci];
    const dists = new Float32Array(RAY_COUNT);
    for (let rIdx = 0; rIdx < RAY_COUNT; rIdx++) {
      const frac = rIdx / (RAY_COUNT - 1);
      const rayAng = c.angle - c.halfFov + frac * (c.halfFov * 2);
      dists[rIdx] = sim.castRayToWalls(
        c.x,
        c.y,
        Math.cos(rayAng),
        Math.sin(rayAng),
        c.range,
      );
    }
    coneShadowMaps.push(dists);

    // 将该射线裁剪后的光锥光强转换到镜头局部坐标 (cxLocal, cyLocal) 后写入 4x4 视口光照网格
    const cxLocal = c.x - camX;
    const cyLocal = c.y - camY;
    const minGX = Math.max(0, Math.floor((cxLocal - c.range) / CELL));
    const maxGX = Math.min(GW - 1, Math.ceil((cxLocal + c.range) / CELL));
    const minGY = Math.max(0, Math.floor((cyLocal - c.range) / CELL));
    const maxGY = Math.min(GH - 1, Math.ceil((cyLocal + c.range) / CELL));

    for (let gy = minGY; gy <= maxGY; gy++) {
      const py = gy * CELL + 2;
      const dy = py - cyLocal;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const px = gx * CELL + 2;
        const dx = px - cxLocal;
        const dist = Math.hypot(dx, dy);
        if (dist > c.range) continue;

        let da = Math.atan2(dy, dx) - c.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) > c.halfFov) continue;

        const u = ((da + c.halfFov) / (2 * c.halfFov)) * (RAY_COUNT - 1);
        const idx0 = Math.max(0, Math.min(RAY_COUNT - 1, Math.floor(u)));
        const idx1 = Math.min(RAY_COUNT - 1, idx0 + 1);
        const f = u - idx0;
        const wallDist = dists[idx0] * (1 - f) + dists[idx1] * f;

        // 射线被死角墙挡住的后方区域保持在阴影中！
        if (dist <= wallDist + 8) {
          const distAtten = 1 - (dist / c.range) * 0.72;
          const angRatio = Math.abs(da) / c.halfFov;
          const angAtten = 1 - angRatio * angRatio * 0.45;
          const beam = distAtten * angAtten * c.intensity;
          const val = clamp(baseAmbient + beam * 0.95, 0, 1.15);
          const cellIdx = gy * GW + gx;
          if (val > lightGrid[cellIdx]) {
            lightGrid[cellIdx] = val;
            tintGrid[cellIdx] = c.kind === "spotlight" ? 1 : sim.mode === "sonar" ? 2 : 0;
          }
          coneGrid[cellIdx] = Math.min(1.35, coneGrid[cellIdx] + beam * 0.55);
        }
      }
    }
  }

  // 2. 叠加人类士兵近身夜视光环 + 枪口爆闪 + 战术节点应急信标 + 声呐脉冲环
  const addRadialLight = (worldX: number, worldY: number, rad: number, peak: number, tint = 0) => {
    const cx = worldX - camX;
    const cy = worldY - camY;
    const minGX = Math.max(0, Math.floor((cx - rad) / CELL));
    const maxGX = Math.min(GW - 1, Math.ceil((cx + rad) / CELL));
    const minGY = Math.max(0, Math.floor((cy - rad) / CELL));
    const maxGY = Math.min(GH - 1, Math.ceil((cy + rad) / CELL));
    for (let gy = minGY; gy <= maxGY; gy++) {
      const py = gy * CELL + 2;
      const dy = py - cy;
      for (let gx = minGX; gx <= maxGX; gx++) {
        const px = gx * CELL + 2;
        const d = Math.hypot(px - cx, dy);
        if (d <= rad) {
          const v = baseAmbient + (1 - d / rad) * peak;
          const cellIdx = gy * GW + gx;
          if (v > lightGrid[cellIdx]) {
            lightGrid[cellIdx] = Math.min(1.15, v);
            if (tint > 0) tintGrid[cellIdx] = tint;
          }
        }
      }
    }
  };

  for (const g of sim.greens) {
    addRadialLight(g.x, g.y, g.muzzleFlash > 0.2 ? 102 : 70, g.muzzleFlash > 0.2 ? 0.88 : 0.68);
  }
  for (const v of sim.vehicles) {
    if (v.phase !== "gone") {
      addRadialLight(v.x, v.y, 118, 0.86, 1);
    }
  }
  for (const n of sim.nodes) {
    if (!n.broken) {
      addRadialLight(n.x, n.y, 76, 0.74, 1);
    }
  }
  if (sim.hive.alive) {
    addRadialLight(sim.hive.x, sim.hive.y, 130, 0.68);
  }
  for (const r of sim.rings) {
    if (r.kind === "sonar" || r.kind === "noise") {
      const p = 1 - r.ttl / r.maxTtl;
      const ringR = 14 + p * r.maxR;
      addRadialLight(r.x, r.y, Math.min(240, ringR + 30), 0.60 * (1 - p), 2);
    }
  }

  // 3. 将 2D 射线阴影迷雾应用到当前视口内的战场地面像素（按大世界纵坐标 camY + ay 精确采样外墙轮廓）
  const raw = fb.data;
  for (let ay = 0; ay < ARENA_H; ay++) {
    const screenY = BOARD_Y + ay;
    const worldY = camY + ay;
    const gy = Math.min(GH - 1, ay >> 2);
    const bnd = getCorridorBounds(worldY, sim.mode);
    const leftEdge = Math.max(0, Math.floor(bnd.left - camX));
    const rightEdge = Math.min(ARENA_W - 1, Math.ceil(bnd.right - camX));

    for (let ax = leftEdge; ax <= rightEdge; ax++) {
      const gx = Math.min(GW - 1, ax >> 2);
      const cellIdx = gy * GW + gx;
      const light = lightGrid[cellIdx];
      const cone = coneGrid[cellIdx];
      const tint = tintGrid[cellIdx];
      const idx = (screenY * OUT_W + (BOARD_X + ax)) * 4;

      // 先对未照亮死角区域做阴影压暗
      let r = raw[idx] * Math.min(1.05, light);
      let g = raw[idx + 1] * Math.min(1.06, light * 1.03);
      let b = raw[idx + 2] * Math.min(1.10, light * 1.12);

      // 叠加手电筒/旋转探照灯的地面体积光束照度（被死角隔墙截断处立刻形成锐利明暗边界！）
      if (cone > 0.01) {
        if (tint === 1) {
          // 旋转工业探照灯：高对比暖金琥珀光束
          r += cone * 52;
          g += cone * 38;
          b += cone * 12;
        } else if (tint === 2) {
          // S弯声呐手电：深海荧光青绿光束
          r += cone * 10;
          g += cone * 44;
          b += cone * 38;
        } else if (sim.mode === "maze-infect") {
          // 三道监区生化紫白战术光束
          r += cone * 34;
          g += cone * 26;
          b += cone * 48;
        } else {
          // CQB 搜房冷青白战术枪灯
          r += cone * 22;
          g += cone * 38;
          b += cone * 50;
        }
      } else if (tint === 2 && light > baseAmbient + 0.05) {
        // 声呐超声波扫描环：翡翠青色雷达脉冲微光
        const sBoost = light - baseAmbient;
        g += sBoost * 28;
        b += sBoost * 34;
      }

      raw[idx] = clamp(Math.round(r), 0, 255);
      raw[idx + 1] = clamp(Math.round(g), 0, 255);
      raw[idx + 2] = clamp(Math.round(b), 0, 255);
    }
  }

  // 4. 绘制被死角墙体物理切割的体积光锥边界线与扇形光线束 (Volumetric Raycast Light Beams)
  for (let ci = 0; ci < sim.lightCones.length; ci++) {
    const c = sim.lightCones[ci];
    const dists = coneShadowMaps[ci];
    const sx = ox + c.x;
    const sy = oy + c.y;
    const isSpot = c.kind === "spotlight";
    const rayCol: RGBA = isSpot
      ? [255, 224, 110, 44]
      : sim.mode === "sonar"
        ? [75, 250, 215, 30]
        : sim.mode === "maze-infect"
          ? [225, 165, 255, 30]
          : [135, 240, 255, 28];
    const edgeCol: RGBA = isSpot
      ? [255, 235, 130, 128]
      : sim.mode === "sonar"
        ? [95, 255, 225, 84]
        : sim.mode === "maze-infect"
          ? [240, 175, 255, 82]
          : [155, 245, 255, 78];

    let prevEndX = sx;
    let prevEndY = sy;
    for (let rIdx = 0; rIdx < RAY_COUNT; rIdx++) {
      const frac = rIdx / (RAY_COUNT - 1);
      const rayAng = c.angle - c.halfFov + frac * (c.halfFov * 2);
      const d = dists[rIdx];
      const ex = sx + Math.cos(rayAng) * d;
      const ey = sy + Math.sin(rayAng) * d;

      // 两侧边缘射线 + 内部稀疏体积光束线
      if (rIdx === 0 || rIdx === RAY_COUNT - 1) {
        fb.drawLine(sx, sy, ex, ey, isSpot ? 2.2 : 1.4, edgeCol);
      } else if (rIdx % 5 === 0) {
        fb.drawLine(sx, sy, ex, ey, isSpot ? 1.8 : 1.1, rayCol);
      }

      // 光锥前端被墙体切割的折线轮廓
      if (rIdx > 0) {
        fb.drawLine(prevEndX, prevEndY, ex, ey, isSpot ? 2.0 : 1.2, edgeCol);
      }
      prevEndX = ex;
      prevEndY = ey;
    }

    // 探照灯灯塔光源本体渲染
    if (isSpot) {
      fb.drawGlowCircle(sx, sy, 28, [255, 220, 95, 165]);
      fb.fillCircle(sx, sy, 12, [42, 32, 18, 255]);
      drawPolygonLines(fb, sx, sy, 12, 6, frameIdx * 0.03, 2.2, [255, 225, 95, 255]);
      fb.fillCircle(sx, sy, 6.0, [255, 250, 210, 255]);
    }
  }

  // 5. 若为 blackout 断电期间，在 4 座熄灭的工业探照灯塔基座上闪烁红色故障警示光环
  if (sim.mode === "blackout" && sim.blackoutActive) {
    for (const [tx, ty] of [
      [520, 2130],
      [1280, 2130],
      [520, 1050],
      [1280, 1050],
    ]) {
      const sx = ox + tx;
      const sy = oy + ty;
      fb.fillCircle(sx, sy, 12, [38, 16, 20, 255]);
      drawPolygonLines(fb, sx, sy, 12, 6, 0, 2.0, [255, 65, 75, 235]);
      if (frameIdx % 6 < 3) {
        fb.drawGlowCircle(sx, sy, 24, [255, 45, 65, 155]);
      }
    }
  }

  // 6. 重绘室内死角防爆墙高光轮廓（确保墙体在阴影/光锥交界处棱角分明）
  renderDeadCornerWalls(fb, sim);

  // 7. 在黑暗死角阴影中绘制【丧尸腥红幽光双眼 (`暗处红眼闪烁`)】与声呐蛰伏脉冲框！
  for (let i = 0; i < sim.reds.length; i++) {
    const r = sim.reds[i];
    const rx = ox + r.x;
    const ry = oy + r.y;
    if (rx < BOARD_X - 20 || rx > BOARD_X + ARENA_W + 20 || ry < BOARD_Y - 20 || ry > BOARD_Y + ARENA_H + 20) {
      continue;
    }
    const gx = clamp(Math.floor((r.x - camX) / CELL), 0, GW - 1);
    const gy = clamp(Math.floor((r.y - camY) / CELL), 0, GH - 1);
    const light = lightGrid[gy * GW + gx];

    // 声呐模式下处于蛰伏状态 (dormant) 或位于死角阴影中 (light < 0.62) 的丧尸：亮起嗜血红眼！
    if (r.dormant || light < 0.62) {
      const moveAng = Math.atan2(r.vy || 1, r.vx || 0);
      const px = -Math.sin(moveAng);
      const py = Math.cos(moveAng);
      const eyeSpread = Math.max(2.2, r.r * 0.36);
      const eyeForward = r.r * 0.25;
      const ex1 = rx + Math.cos(moveAng) * eyeForward - px * eyeSpread;
      const ey1 = ry + Math.sin(moveAng) * eyeForward - py * eyeSpread;
      const ex2 = rx + Math.cos(moveAng) * eyeForward + px * eyeSpread;
      const ey2 = ry + Math.sin(moveAng) * eyeForward + py * eyeSpread;

      const flicker = 0.65 + 0.35 * Math.sin(frameIdx * 0.28 + r.id * 1.7);
      const eyeAlpha = Math.round(clamp(flicker * (r.dormant ? 195 : 245), 90, 250));
      const eyeCol: RGBA =
        r.kind === "infected_elite"
          ? [255, 65, 195, eyeAlpha]
          : r.kind === "carrier"
            ? [85, 255, 165, eyeAlpha]
            : [255, 38, 62, eyeAlpha];

      // 蛰伏丧尸轮廓暗环
      if (r.dormant) {
        fb.strokeRing(rx, ry, r.r * 0.9, 1.2, [120, 24, 42, 110]);
      }

      const eyeR = r.kind === "boss" ? 3.2 : r.kind === "infected_elite" ? 2.4 : 1.7;
      fb.fillCircle(ex1, ey1, eyeR, eyeCol);
      fb.fillCircle(ex2, ey2, eyeR, eyeCol);
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
    fb.fillCircle(nx, ny, 3.6, [255, 225, 75, 255]);
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

  // 5. 绘制【实时镜头视野跟随白框 (Camera Follow Viewport Box)】
  const vx = mapX + (sim.camX / WORLD_W) * mapW;
  const vy = mapY + (sim.camY / WORLD_H) * mapH;
  const vw = (ARENA_W / WORLD_W) * mapW;
  const vh = (ARENA_H / WORLD_H) * mapH;
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

/**
 * 构建 1800 x 3000 超大科学战术世界地图 (`buildWorldBackground`)：
 * - scavenge: 西翼/东翼折角实验大楼（3座带 130px 真实门洞的封闭侧室 `1号军火密室`、`2号基因密室`、`3号重装密室`）
 * - blackout: 双八角地下核反应堆设施（南区1号反应堆 + 中央防爆气闸 + 北区2号反应堆 + 2座中央矩形防爆反应核 + 4座工业探照灯基座）
 * - sonar: 大跨度 S 型蜿蜒深渊洞穴（横跨 x=485..1315 的三段大S弯 + 同心声呐扫描距离环 + 荧光导航轨线）
 * - maze-infect: 三通道生化隔离监区（下层被两道 1100px 竖墙分隔为 A/B/C 三条平行监区走廊 + 中央检疫汇合广场 + 上层生化隔离区）
 */
function buildWorldBackground(modeId: SiegeModeId, atlas: FontAtlas): Uint8ClampedArray {
  const fb = new FrameBuf(WORLD_W, WORLD_H, [8, 10, 15, 255]);
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
        // 1. 各模式专属地板基色与功能区高亮
        let r = 14;
        let g = 18;
        let b = 26;

        if (modeId === "scavenge") {
          // 冰蓝 CQB 室内大楼地板 + 1号军火室 / 2号基因室 / 3号重装室 专属蓝图房间地砖
          r = 11;
          g = 22;
          b = 36;
          const inRoom1 = wx <= 680 && wy >= 2110 && wy <= 2520;
          const inRoom2 = wx >= 1120 && wy >= 1380 && wy <= 1800;
          const inRoom3 = wx <= 680 && wy >= 720 && wy <= 1120;
          if (inRoom1 || inRoom2 || inRoom3) {
            r = 18;
            g = 40;
            b = 62;
            if ((wx + wy) % 24 < 2) {
              r += 8;
              g += 18;
              b += 26;
            }
          }
        } else if (modeId === "blackout") {
          // 琥珀金双八角地下核反应堆地板
          r = 22;
          g = 17;
          b = 11;
          const distCore1 = Math.hypot(wx - CORRIDOR_CX, wy - 2130);
          const distCore2 = Math.hypot(wx - CORRIDOR_CX, wy - 1050);
          if (distCore1 < 380 || distCore2 < 380) {
            r = 28;
            g = 21;
            b = 12;
          }
          // 中央矩形反应堆防爆屏蔽核内部斜纹区
          const inIsland1 = wx >= 760 && wx <= 1040 && wy >= 2010 && wy <= 2250;
          const inIsland2 = wx >= 760 && wx <= 1040 && wy >= 930 && wy <= 1170;
          if (inIsland1 || inIsland2) {
            const stripe = ((wx + wy) >> 4) & 1;
            r = stripe ? 44 : 26;
            g = stripe ? 34 : 20;
            b = 14;
          }
        } else if (modeId === "sonar") {
          // 深海翡翠青 S 型声呐洞穴地板
          r = 7;
          g = 22;
          b = 25;
          const distCenter = Math.abs(wx - bnd.cx);
          if (distCenter < 85) {
            g += 6;
            b += 7;
          }
        } else if (modeId === "maze-infect") {
          // 生化紫红三道死角监区地板（下层 A/B/C 三条平行监区走廊交替色调）
          const inLowerLanes = wy >= 1640 && wy <= 2760;
          const inSideLane = inLowerLanes && (wx < 690 || wx > 1110);
          r = inSideLane ? 29 : 21;
          g = inSideLane ? 11 : 10;
          b = inSideLane ? 32 : 25;
        }

        // 北部丧尸母巢核心周围 (wy < 520) 暗红生物菌毯与脉络纹理
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

        // 墙根内侧 24px 阶梯式环境光遮蔽与内嵌排水槽线
        if (minEdgeDist < 24) {
          const ao = (24 - minEdgeDist) / 24;
          r = Math.round(r * (1 - ao * 0.48));
          g = Math.round(g * (1 - ao * 0.48));
          b = Math.round(b * (1 - ao * 0.48));
          if (minEdgeDist >= 18 && minEdgeDist <= 20) {
            r += modeId === "blackout" ? 24 : modeId === "maze-infect" ? 22 : 12;
            g += modeId === "sonar" ? 24 : modeId === "scavenge" ? 20 : 14;
            b += modeId === "scavenge" || modeId === "maze-infect" ? 28 : 16;
          }
        }

        // 大世界 64px 主网格线 + 16px 副网格线（随镜头移动产生极强地面空间参照感）
        if (wx % 64 === 0 || wy % 64 === 0) {
          r += modeId === "blackout" ? 10 : modeId === "maze-infect" ? 10 : 6;
          g += modeId === "sonar" ? 11 : modeId === "scavenge" ? 10 : 7;
          b += modeId === "scavenge" ? 15 : modeId === "maze-infect" ? 12 : 8;
        } else if (wx % 16 === 0 || wy % 16 === 0) {
          r += 2;
          g += 3;
          b += 4;
        }

        // 顺着当前通道中心线 bnd.cx 延伸的双轨导流槽线
        const distToTrack = Math.abs(Math.abs(wx - Math.round(bnd.cx)) - 76);
        if (distToTrack <= 4 && minEdgeDist > 26) {
          if (distToTrack === 4) {
            r += modeId === "blackout" ? 18 : 10;
            g += modeId === "sonar" ? 18 : 14;
            b += modeId === "scavenge" ? 22 : 16;
          } else if (wy % 12 < 6) {
            r -= 3;
            g -= 3;
            b -= 4;
          }
        }

        raw[idx] = clamp(r, 0, 255);
        raw[idx + 1] = clamp(g, 0, 255);
        raw[idx + 2] = clamp(b, 0, 255);
        raw[idx + 3] = 255;
      } else {
        // 2. 各模式外侧多层装甲/岩壁墙体
        const wallDepth = isTopWall
          ? 40 - wy
          : isBottomWall
            ? wy - 2860
            : distToLeft < 0
              ? -distToLeft
              : -distToRight;

        if (wallDepth <= 2.5) {
          raw[idx] = modeId === "blackout" ? 255 : modeId === "maze-infect" ? 235 : 95;
          raw[idx + 1] = modeId === "sonar" ? 245 : modeId === "scavenge" ? 215 : modeId === "blackout" ? 195 : 95;
          raw[idx + 2] = modeId === "scavenge" ? 255 : modeId === "maze-infect" ? 245 : modeId === "sonar" ? 215 : 85;
          raw[idx + 3] = 255;
        } else if (wallDepth <= 6.5) {
          raw[idx] = 14;
          raw[idx + 1] = 16;
          raw[idx + 2] = 22;
          raw[idx + 3] = 255;
        } else if (wallDepth <= 19) {
          const stripe = ((wx + wy) >> 4) & 1;
          if (modeId === "blackout") {
            raw[idx] = stripe === 0 ? 235 : 46;
            raw[idx + 1] = stripe === 0 ? 172 : 34;
            raw[idx + 2] = stripe === 0 ? 28 : 18;
          } else if (modeId === "scavenge") {
            raw[idx] = stripe === 0 ? 38 : 24;
            raw[idx + 1] = stripe === 0 ? 128 : 54;
            raw[idx + 2] = stripe === 0 ? 185 : 82;
          } else if (modeId === "sonar") {
            raw[idx] = stripe === 0 ? 22 : 14;
            raw[idx + 1] = stripe === 0 ? 135 : 58;
            raw[idx + 2] = stripe === 0 ? 122 : 54;
          } else if (modeId === "maze-infect") {
            raw[idx] = stripe === 0 ? 175 : 52;
            raw[idx + 1] = stripe === 0 ? 42 : 20;
            raw[idx + 2] = stripe === 0 ? 148 : 58;
          } else {
            raw[idx] = 52;
            raw[idx + 1] = 64;
            raw[idx + 2] = 84;
          }
          raw[idx + 3] = 255;
        } else if (wallDepth <= 22) {
          raw[idx] = modeId === "blackout" ? 145 : modeId === "maze-infect" ? 135 : 68;
          raw[idx + 1] = modeId === "sonar" ? 145 : modeId === "scavenge" ? 135 : 95;
          raw[idx + 2] = modeId === "scavenge" ? 175 : modeId === "maze-infect" ? 145 : 95;
          raw[idx + 3] = 255;
        } else {
          let wr = modeId === "blackout" ? 24 : modeId === "maze-infect" ? 24 : 12;
          let wg = modeId === "sonar" ? 24 : modeId === "scavenge" ? 22 : 16;
          let wb = modeId === "scavenge" ? 36 : modeId === "maze-infect" ? 30 : 22;

          const ribY = wy % 64;
          const ribX = wx % 64;
          if (ribY === 0 || ribX === 0) {
            wr += 18;
            wg += 22;
            wb += 26;
          } else if (ribY < 8) {
            wr += 7;
            wg += 9;
            wb += 12;
          } else if (((wx + wy) % 32) === 0 || ((wx - wy + 4096) % 32) === 0) {
            wr += 4;
            wg += 5;
            wb += 7;
          }

          raw[idx] = clamp(wr, 0, 255);
          raw[idx + 1] = clamp(wg, 0, 255);
          raw[idx + 2] = clamp(wb, 0, 255);
          raw[idx + 3] = 255;
        }
      }
    }
  }

  // 3. 在 1800 x 3000 大地图上绘制各模式专属大型地面地标、房间门洞导引线与区域文字标识
  if (modeId === "scavenge") {
    const rooms = [
      { x: 274, y: 2116, w: 400, h: 398, doorX: 680, doorY: 2315, title: "1号军火密室" },
      { x: 1126, y: 1386, w: 400, h: 408, doorX: 1120, doorY: 1590, title: "2号基因密室" },
      { x: 274, y: 726, w: 400, h: 388, doorX: 680, doorY: 925, title: "3号重装密室" },
    ];
    for (const rm of rooms) {
      fb.strokeRoundRect(rm.x, rm.y, rm.w, rm.h, 6, 2.4, [55, 195, 245, 190]);
      drawCornerBrackets(
        fb,
        rm.x + rm.w * 0.5,
        rm.y + rm.h * 0.5,
        rm.w * 0.42,
        rm.h * 0.42,
        22,
        2.4,
        [75, 220, 255, 200],
      );
      // 130px 门洞破拆发光阈值线
      fb.drawLine(rm.doorX, rm.doorY - 62, rm.doorX, rm.doorY + 62, 3.6, [95, 245, 255, 230]);
    }
  } else if (modeId === "blackout") {
    // 南区1号核反应堆 (900, 2130) 与 北区2号核反应堆 (900, 1050)
    for (const [ry] of [
      [2130, "1号核反应堆核心"],
      [1050, "2号核反应堆核心"],
    ] as const) {
      for (const rad of [165, 255, 345]) {
        drawPolygonLines(
          fb,
          CORRIDOR_CX,
          ry,
          rad,
          8,
          Math.PI / 8,
          2.6,
          [235, 165, 35, 170],
          rad === 165,
          [185, 120, 25, 130],
        );
      }
    }
    // 4座工业旋转探照灯塔基座
    for (const [tx, ty] of [
      [520, 2130],
      [1280, 2130],
      [520, 1050],
      [1280, 1050],
    ]) {
      fb.blendCircle(tx, ty, 38, [65, 45, 18, 215]);
      drawPolygonLines(fb, tx, ty, 36, 8, Math.PI / 8, 2.4, [255, 195, 45, 225], true);
    }
  } else if (modeId === "sonar") {
    // 3处大跨度S弯声呐雷达环与荧光导航轨迹线
    for (const [scx, scy] of [
      [560, 2220, "西1号声呐弯道"],
      [1240, 1550, "东2号回声盲区"],
      [560, 880, "西3号深渊弯道"],
    ] as const) {
      for (const rad of [85, 165, 245]) {
        fb.strokeRing(scx, scy, rad, 1.8, [38, 195, 175, 140]);
      }
      fb.drawLine(scx - 250, scy, scx + 250, scy, 1.4, [38, 195, 175, 115]);
      fb.drawLine(scx, scy - 250, scx, scy + 250, 1.4, [38, 195, 175, 115]);
    }
    let prevX = getCorridorBounds(320, "sonar").cx;
    let prevY = 320;
    for (let y = 380; y <= 2780; y += 50) {
      const nx = getCorridorBounds(y, "sonar").cx;
      const ny = y;
      fb.drawLine(prevX, prevY, nx, ny, 2.8, [55, 235, 205, 170]);
      fb.fillCircle(nx, ny, 3.8, [95, 255, 225, 200]);
      prevX = nx;
      prevY = ny;
    }
  } else if (modeId === "maze-infect") {
    // 下层 A/B/C 三条平行监区导轨 (x = 485, 900, 1315, y = 1640..2760)
    for (const [laneX] of [
      [485, "A监区 · 西通道"],
      [900, "B监区 · 中通道"],
      [1315, "C监区 · 东通道"],
    ] as const) {
      fb.drawLine(laneX, 1640, laneX, 2760, 2.6, [215, 65, 185, 160]);
      for (let ly = 1720; ly <= 2680; ly += 140) {
        fb.drawLine(laneX - 28, ly + 16, laneX, ly, 2.4, [235, 85, 195, 190]);
        fb.drawLine(laneX + 28, ly + 16, laneX, ly, 2.4, [235, 85, 195, 190]);
        drawCornerBrackets(fb, laneX, ly + 32, 76, 36, 12, 1.8, [185, 55, 165, 145]);
      }
    }
  }

  // 在外墙折线段上绘制高细节矢量装甲边线
  const wallLineCol: RGBA =
    modeId === "blackout"
      ? [255, 205, 75, 240]
      : modeId === "sonar"
        ? [75, 245, 215, 240]
        : modeId === "maze-infect"
          ? [245, 95, 215, 240]
          : [135, 220, 255, 240];
  for (const seg of outerSegments) {
    fb.drawLine(seg.x1, seg.y1, seg.x2, seg.y2, 2.8, wallLineCol);
  }

  // 沿纵向外墙每隔 110px 绘制外凸机械装甲铆钉柱 (Buttress Pillars)
  for (let wy = 120; wy <= 2820; wy += 110) {
    const bnd = getCorridorBounds(wy, modeId);
    for (const wx of [bnd.left - 10, bnd.right + 10]) {
      fb.blendRoundRect(wx - 7, wy - 12, 14, 24, 3, [48, 58, 78, 245]);
      fb.strokeRoundRect(wx - 7, wy - 12, 14, 24, 3, 1.5, wallLineCol);
      fb.fillCircle(wx, wy - 6, 2.0, [225, 235, 250, 240]);
      fb.fillCircle(wx, wy + 6, 2.0, [225, 235, 250, 240]);
    }
  }

  // 地面横向战术防线分界线 + 向上推进 V 型导向箭头
  for (let lineY = 520; lineY <= 2620; lineY += 300) {
    const bnd = getCorridorBounds(lineY, modeId);
    const halfW = bnd.halfW - 30;
    for (let dx = -halfW; dx <= halfW - 18; dx += 32) {
      fb.drawLine(bnd.cx + dx, lineY, bnd.cx + dx + 16, lineY, 1.6, [62, 78, 104, 175]);
    }
    const cx = bnd.cx;
    for (const dy of [0, 12]) {
      fb.drawLine(cx - 20, lineY + dy + 9, cx, lineY + dy, 2.2, wallLineCol);
      fb.drawLine(cx + 20, lineY + dy + 9, cx, lineY + dy, 2.2, wallLineCol);
    }
  }

  // 北部母巢核心 (900, 230) 下方 3 个尸潮孵化喷口与生物主血管线
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
    } else if (d.kind === "rubble") {
      fb.blendCircle(cx, cy, d.r * 0.7, [36, 42, 54, 150]);
    }
  }

  sim.pendingDecals.length = 0;
  worldBgRaw.set(fb.data);
}

/**
 * 将 1800x3000 大世界底图中当前 2D 镜头视野 (camX, camY, ARENA_W, ARENA_H) 高速拷贝至帧缓冲
 */
function blitWorldToViewport(
  fb: FrameBuf,
  worldBgRaw: Uint8ClampedArray,
  camX: number,
  camY: number,
): void {
  const cx = clamp(Math.round(camX), 0, WORLD_W - ARENA_W);
  const cy = clamp(Math.round(camY), 0, WORLD_H - ARENA_H);
  const dst = fb.data;
  const rowBytes = ARENA_W * 4;
  for (let ay = 0; ay < ARENA_H; ay++) {
    const srcStart = ((cy + ay) * WORLD_W + cx) * 4;
    const dstStart = ((BOARD_Y + ay) * OUT_W + BOARD_X) * 4;
    dst.set(worldBgRaw.subarray(srcStart, srcStart + rowBytes), dstStart);
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
 * 爆款攻防短视频三幕式情绪 BGM (132 BPM D-Minor Drift Phonk / Dark Synth)
 * + 解压 ASMR 级战斗音效叠层 (清脆抛壳枪声 / 丧尸爆浆气泡音 / 破笼多巴胺琶音 / 母巢核爆)
 * + 自动侧链闪避 (Sidechain Ducking)
 */
function buildSiegeAudioTrack(
  events: SiegeAudioEvent[],
  durationSec: number,
  externalBgm?: Float32Array,
): Float32Array {
  const sr = 44100;
  const totalSamples = Math.ceil(durationSec * sr);
  const bgmSamples = new Float32Array(totalSamples);
  const sfxSamples = new Float32Array(totalSamples);
  const duckEnv = new Float32Array(totalSamples);
  duckEnv.fill(1.0);

  let rngState = 1337;
  const rand = (): number => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296 - 0.5;
  };

  // 1. 解析三幕剧情转折时间点（自动对齐破笼/倍增/反推/母巢崩塌时刻）
  const adrenalineTimes = events.filter(e => e.kind === "adrenaline").map(e => e.timeSec);
  const act2StartSec = adrenalineTimes[0] ?? 9.2;
  const act3StartSec = adrenalineTimes[2] ?? Math.min(durationSec * 0.58, 21.2);
  const hiveBlastEv = events.find(e => e.kind === "hive-blast");
  const hiveBlastSec = hiveBlastEv ? hiveBlastEv.timeSec : durationSec - 1.25;

  // 2. 构建侧链闪避包络 (Sidechain Ducking)：破笼/倍增/Boss击杀/母巢爆炸/减员警报时自动压低 BGM 45%~62%
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
    } else if (ev.kind === "boss-kill") {
      applyDuck(ev.timeSec, 0.42, 0.18, 0.42);
    } else if (ev.kind === "breach" || ev.kind === "boss-spawn") {
      applyDuck(ev.timeSec, 0.52, 0.12, 0.28);
    } else if (ev.kind === "hive-blast") {
      applyDuck(ev.timeSec, 0.32, 0.35, 0.65);
    }
  }

  // 3. 合成或载入三幕式 BGM (132 BPM, D Minor: D - Bb - C - A)
  if (externalBgm && externalBgm.length > 0) {
    const copyLen = Math.min(totalSamples, externalBgm.length);
    for (let i = 0; i < copyLen; i++) {
      bgmSamples[i] = externalBgm[i] * 0.68;
    }
  } else {
    const bpm = 132;
    const beatSec = 60 / bpm; // 0.454545s
    const step16Sec = beatSec / 4; // 0.113636s
    // D 小调经典暗黑史诗走向: D2 -> Bb1 -> C2 -> A1
    const bassRoots = [73.42, 58.27, 65.41, 55.0];
    // Drift Phonk 808 Cowbell 战神逆袭卡点旋律 (16分音符步进, 0表示休止)
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
      const beatPhase = beatFloat - beatIdx;
      const beatTime = beatPhase * beatSec;

      const step16Float = t / step16Sec;
      const step16Idx = Math.floor(step16Float);
      const step16Phase = step16Float - step16Idx;
      const step16Time = step16Phase * step16Sec;

      const barIdx = Math.floor(beatIdx / 4);
      const chordRoot = bassRoots[barIdx % 4];
      const stepInBar = step16Idx % 16;

      const isAct1 = t < act2StartSec;
      const isAct2 = t >= act2StartSec && t < act3StartSec;
      const isAct3 = t >= act3StartSec && t < hiveBlastSec;
      const isVictory = t >= hiveBlastSec;

      let sample = 0;

      if (!isVictory) {
        // (a) 808 重型底鼓 (Four-on-the-floor Kick + Act1 绝境双心跳)
        const isKickBeat =
          isAct1 ? stepInBar % 4 === 0 || stepInBar === 11 || stepInBar === 14 : stepInBar % 4 === 0;
        if (isKickBeat && step16Time < 0.18) {
          const kt = step16Time;
          const kFreq = 46 + 108 * Math.exp(-kt * 44);
          const kEnv = Math.exp(-kt * 16.5);
          const kClick = Math.sin(2 * Math.PI * 1650 * kt) * Math.exp(-kt * 190) * 0.22;
          sample += (Math.tanh(Math.sin(2 * Math.PI * kFreq * kt) * 1.45) * kEnv + kClick) * 0.34;
        }

        // (b) 暗黑 Reese / 808 Sub Bass（带底鼓四分音符自动侧链抽吸感 Pumping）
        const pumpEnv = 0.22 + 0.78 * (1 - Math.exp(-beatTime * 8.5));
        const saw1 = ((t * chordRoot) % 1) * 2 - 1;
        const saw2 = ((t * chordRoot * 1.006) % 1) * 2 - 1;
        const subSine = Math.sin(2 * Math.PI * chordRoot * t);
        const rawBass = subSine * 0.65 + (saw1 + saw2) * (isAct1 ? 0.16 : 0.26);
        const cutoff = isAct1 ? 0.035 : isAct2 ? 0.065 : 0.095;
        bassLp += cutoff * (rawBass - bassLp);
        sample += Math.tanh(bassLp * 1.6) * pumpEnv * (isAct1 ? 0.24 : 0.28);

        // (c) Act 1 专属：高频呼吸急促感与心跳压迫低频脉冲
        if (isAct1) {
          // 反拍暗黑闭镲
          if (stepInBar % 4 === 2 && step16Time < 0.045) {
            sample += rand() * Math.exp(-step16Time * 95) * 0.08;
          }
          // 危急声呐暗音 (每两拍尾部微弱脉冲)
          if (stepInBar === 6 || stepInBar === 14) {
            const pEnv = Math.exp(-step16Time * 24);
            sample += Math.sin(2 * Math.PI * 440 * step16Time) * pEnv * 0.055;
          }
        }

        // (d) Act 2 & Act 3：808 Drift Phonk 牛铃主旋律 (Cowbell Lead Hook) + Trap 军鼓与滚镲
        if (isAct2 || isAct3) {
          const melTable = isAct3 ? phonkMelodyAct3 : phonkMelodyAct2;
          const noteFreq = melTable[stepInBar];
          if (noteFreq > 0 && step16Time < 0.11) {
            // TR-808 经典双频失谐方波/正弦波复合谐振 (1 : 1.481 比例模拟金属牛铃卡点音色)
            const nt = step16Time;
            const cEnv = Math.min(1, nt / 0.0025) * Math.exp(-nt * (isAct3 ? 19 : 23));
            const osc1 = Math.sin(2 * Math.PI * noteFreq * nt);
            const osc2 = Math.sin(2 * Math.PI * noteFreq * 1.481 * nt) * 0.38;
            const subOct = isAct3 ? Math.sin(2 * Math.PI * (noteFreq * 0.5) * nt) * 0.35 : 0;
            const cowbell = Math.tanh((osc1 + osc2 + subOct) * 1.85) * cEnv;
            sample += cowbell * (isAct3 ? 0.17 : 0.14);
          }

          // 二四拍清脆 Phonk 军鼓 / 拍手 (Snare + Clap)
          if ((stepInBar === 4 || stepInBar === 12) && step16Time < 0.12) {
            const st = step16Time;
            const sBody = Math.sin(2 * Math.PI * (195 - st * 420) * st) * Math.exp(-st * 32);
            const sNoise = rand() * Math.exp(-st * 26);
            sample += (sBody * 0.45 + sNoise * 0.55) * 0.21;
          }

          // 16分音符 Trap 金属闭合踩镲 (带三连音滚镲细节)
          const hatDur = stepInBar === 7 || stepInBar === 15 ? 0.055 : 0.032;
          if (step16Time < hatDur) {
            const hAccent = stepInBar % 2 === 0 ? 0.09 : 0.055;
            const metallic =
              (rand() * 0.7 + Math.sin(2 * Math.PI * 6850 * step16Time) * 0.3) *
              Math.exp(-step16Time * 115);
            sample += metallic * hAccent;
          }
        }

        // (e) Act 2 -> Act 3 交界处 (前 1.6s)：滚奏军鼓 (Snare Roll) + 升调合成器 Riser 蓄力推向反攻高潮
        const riserWindow = act3StartSec - t;
        if (riserWindow > 0 && riserWindow <= 1.6) {
          const prog = 1 - riserWindow / 1.6; // 0 -> 1
          const riserFreq = 220 * Math.pow(2, prog * 2.0);
          const rollRate = prog < 0.5 ? step16Sec * 0.5 : step16Sec * 0.25;
          const rollPhase = (t % rollRate) / rollRate;
          const rollSnare = rand() * Math.exp(-rollPhase * 6.5) * (0.08 + prog * 0.16);
          const riserSynth = Math.sin(2 * Math.PI * riserFreq * t) * prog * 0.12;
          sample += rollSnare + riserSynth;
        }

        // (f) Act 3 专属：26人全军反推高燃五度和弦垫音 (Power Chord Supersaw Pad)
        if (isAct3) {
          const padRoot = chordRoot * 2;
          const padFifth = padRoot * 1.498;
          const padOct = padRoot * 2;
          const padWave =
            Math.sin(2 * Math.PI * padRoot * t) * 0.45 +
            Math.sin(2 * Math.PI * padFifth * t) * 0.35 +
            Math.sin(2 * Math.PI * padOct * t) * 0.2;
          sample += Math.tanh(padWave * 1.4) * pumpEnv * 0.12;
        }
      } else {
        // (g) 母巢击破后的胜利史诗尾奏 (D 大三和弦皮卡第第三音辉煌余韵: D3 + A3 + D4 + F#4 + A4)
        const vt = t - hiveBlastSec;
        const vEnv = Math.min(1, vt / 0.08) * Math.exp(-vt * 1.45);
        const vChord =
          Math.sin(2 * Math.PI * 146.83 * t) * 0.32 +
          Math.sin(2 * Math.PI * 220.0 * t) * 0.24 +
          Math.sin(2 * Math.PI * 293.66 * t) * 0.22 +
          Math.sin(2 * Math.PI * 369.99 * t) * 0.18 +
          Math.sin(2 * Math.PI * 440.0 * t) * 0.14;
        sample += Math.tanh(vChord * 1.35) * vEnv * 0.32;
      }

      bgmSamples[i] = sample;
    }
  }

  // 4. 合成解压 ASMR 战斗音效层 (SFX Layer)
  for (const ev of events) {
    const startIdx = Math.floor(ev.timeSec * sr);
    if (startIdx < 0 || startIdx >= totalSamples) continue;

    if (ev.kind === "mg" || ev.kind === "heavy-mg") {
      // 解压微瞬态枪声：低频胸腔锤击 + 机械枪机脆响 + 延迟 14ms 的黄铜弹壳清脆抛壳声
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
            0.18;
        }
        sfxSamples[startIdx + i] +=
          (punch * 0.56 + boltSnap * 0.42 + shellClink) * ev.gain * 0.72;
      }
    } else if (ev.kind === "kill-pop") {
      // 爆款割草灵魂音效：丧尸爆浆气泡音 + 清脆命中 Hitmarker 滴答声
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
        sfxSamples[startIdx + i] += (bubble * 0.75 + tick) * env * ev.gain * 0.78;
      }
    } else if (ev.kind === "adrenaline") {
      // 破笼/倍增/筑塔高光时刻：钢化棱镜碎裂声 + 四音上行多巴胺水晶琶音 (D5 -> F5 -> A5 -> D6)
      const notes = [587.33, 698.46, 880.0, 1174.66];
      const dur = 0.52;
      const len = Math.min(Math.floor(dur * sr), totalSamples - startIdx);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        // 初始破笼清脆碎裂瞬态
        const shatter =
          t < 0.065
            ? (rand() * 0.55 + Math.sin(2 * Math.PI * 3850 * t) * 0.45) * Math.exp(-t * 62) * 0.48
            : 0;
        // 四音上行琶音叠加
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
        sfxSamples[startIdx + i] += (shatter + chime) * ev.gain * 0.85;
      }
    } else if (ev.kind === "breach") {
      // 绿点一碰即碎/同化危急警报：战术双频急促蜂鸣 + 低频重击
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
        sfxSamples[startIdx + i] += (subThud * 0.58 + alarm * 0.34) * env * ev.gain * 0.72;
      }
    } else if (ev.kind === "boss-spawn") {
      // 暴君降临：深渊低音号角 (Braaam) 下潜震颤
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
        sfxSamples[startIdx + i] += Math.tanh(brass * 1.8) * env * ev.gain * 0.56;
      }
    } else if (ev.kind === "boss-kill") {
      // 暴君击毙：重甲爆裂 + 金币/晶石清脆爆散音
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
        sfxSamples[startIdx + i] += (boom * 0.62 + crackle + rewardPing) * env * ev.gain * 0.75;
      }
    } else if (ev.kind === "hive-blast") {
      // 终局母巢核心轰爆：超重低音核爆下潜 (Sub-Drop) + 装甲崩解冲击波
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
        sfxSamples[startIdx + i] += (subBoom * 0.68 + shockwave * 0.45 + shimmer) * env * ev.gain;
      }
    }
  }

  // 5. 母带级混音：将 BGM 乘上侧链闪避包络后与 SFX 叠加，并经软削波限制器 (Soft Limiter) 保证响度饱满不爆音
  const out = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i++) {
    const mixed = bgmSamples[i] * duckEnv[i] + sfxSamples[i];
    out[i] = clamp(Math.tanh(mixed * 1.15) * 0.92, -0.94, 0.94);
  }
  return out;
}

export async function renderSiegeVideo(opts: SiegeRenderOptions): Promise<SiegeRenderStats> {
  const mapId = opts.mapId ?? "canyon-bridge";
  const modeId = opts.modeId ?? "combo";
  const sim = new SiegeSimulator(opts.seed, mapId, opts.durationSec, modeId);
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
  const audioSamples = buildSiegeAudioTrack(sim.audioEvents, actualDurationSec, extBgm);
  writeWav(audioSamples, tmpWav);

  // 重新运行一遍完全相同种子的模拟并流式生成视频帧
  const simRender = new SiegeSimulator(opts.seed, mapId, opts.durationSec, modeId);
  const worldBgRaw = buildWorldBackground(modeId, atlas);
  const fb = new FrameBuf(OUT_W, OUT_H, [8, 10, 15, 255]);
  const modeMeta = SIEGE_MODE_META[modeId];
  const hookTitle = opts.hookTitle ?? modeMeta.hookTitle;

  function* frameGenerator(): IterableIterator<FrameBuf> {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      for (let s = 0; s < TICKS_PER_FRAME; s++) {
        simRender.stepTick();
        if (simRender.isFinished) break;
      }

      bakeDecalsIntoBackground(worldBgRaw, simRender);
      blitWorldToViewport(fb, worldBgRaw, simRender.camX, simRender.camY);

      const ox = BOARD_X - Math.round(simRender.camX);
      const oy = BOARD_Y - Math.round(simRender.camY);

      // 0. 若为死角光暗模式，先绘制室内 L 型死角防爆隔墙底座
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

        atlas.drawStyled(
          fb,
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

      // 2. 绘制战场战术节点（八角钢筋囚笼 / 多切面几何棱镜晶石 / 十字装甲工事箱）
      for (const n of simRender.nodes) {
        if (n.broken) continue;
        const nx = ox + n.x;
        const ny = oy + n.y;
        const isHit = n.hitFlash > 0.3;

        if (n.kind === "rescue_cage") {
          fb.drawGlowCircle(nx, ny, n.r * 1.55, [45, 235, 145, 85]);
          fb.fillCircle(nx, ny, n.r + 2, [18, 26, 36, 250]);
          drawPolygonLines(fb, nx, ny, n.r + 1, 8, Math.PI / 8, 2.4, [75, 245, 155, 240]);

          // 笼内被困的 2 名绿兵小人（带头盔、护目镜与枪管线条）
          for (const dx of [-7.5, 7.5]) {
            fb.fillCircle(nx + dx, ny + 2, 6.2, [38, 215, 122, 245]);
            fb.fillCircle(nx + dx, ny + 0.5, 3.6, [130, 255, 190, 250]);
            fb.drawLine(nx + dx - 3, ny - 1, nx + dx + 3, ny - 1, 1.8, [220, 255, 255, 255]);
          }

          // 纵横交错的钢筋铁栏与横向锁梁线条
          for (const bx of [-12, -4, 4, 12]) {
            const halfChord = Math.sqrt(Math.max(4, n.r * n.r - bx * bx)) - 2;
            fb.drawLine(
              nx + bx,
              ny - halfChord,
              nx + bx,
              ny + halfChord,
              2.2,
              isHit ? [255, 245, 190, 255] : [165, 185, 215, 245],
            );
          }
          fb.drawLine(nx - n.r + 3, ny - 6, nx + n.r - 3, ny - 6, 2.0, [120, 142, 172, 235]);
          fb.drawLine(nx - n.r + 3, ny + 7, nx + n.r - 3, ny + 7, 2.0, [120, 142, 172, 235]);
          drawCornerBrackets(fb, nx, ny, n.r + 5, n.r + 5, 7, 2.0, [85, 255, 168, 225]);
        } else if (n.kind === "multiply_crystal") {
          // 算术倍增晶石：六角几何切面棱镜 + 内部折射晶格线 + 外围四角锁定框
          fb.drawGlowCircle(nx, ny, n.r * 1.65, [255, 205, 55, 95]);
          fb.fillCircle(nx, ny, n.r + 2, [34, 24, 10, 250]);
          fb.fillCircle(
            nx,
            ny,
            n.r - 1,
            isHit ? [255, 250, 205, 255] : [245, 182, 32, 250],
          );
          // 外部六边形棱镜轮廓与中心放射切面线
          drawPolygonLines(
            fb,
            nx,
            ny,
            n.r,
            6,
            frameIdx * 0.02,
            2.6,
            [255, 248, 175, 255],
            true,
            [255, 235, 130, 230],
          );
          // 内部反向交错三角形折射线
          drawPolygonLines(
            fb,
            nx,
            ny,
            n.r * 0.58,
            6,
            -frameIdx * 0.02 + Math.PI / 6,
            1.8,
            [255, 255, 225, 245],
          );
          drawCornerBrackets(fb, nx, ny, n.r + 5, n.r + 5, 7, 2.0, [255, 225, 85, 230]);
        } else {
          // 碉堡工事补给箱：对角交叉加固肋条 + 战术锁定框
          fb.drawGlowCircle(nx, ny, n.r * 1.55, [65, 210, 255, 90]);
          fb.blendRoundRect(
            nx - n.r,
            ny - n.r,
            n.r * 2,
            n.r * 2,
            6,
            isHit ? [190, 245, 255, 255] : [32, 118, 168, 250],
          );
          fb.drawLine(nx - n.r + 4, ny - n.r + 4, nx + n.r - 4, ny + n.r - 4, 2.2, [95, 215, 255, 220]);
          fb.drawLine(nx + n.r - 4, ny - n.r + 4, nx - n.r + 4, ny + n.r - 4, 2.2, [95, 215, 255, 220]);
          fb.strokeRoundRect(nx - n.r, ny - n.r, n.r * 2, n.r * 2, 6, 2.6, [135, 240, 255, 250]);
          drawCornerBrackets(fb, nx, ny, n.r + 5, n.r + 5, 7, 2.0, [95, 230, 255, 225]);
        }

        const nBarW = 66;
        const nBarH = 6;
        const nBarX = nx - nBarW * 0.5;
        const nBarY = ny - n.r - 15;
        const nFrac = clamp(n.hp / n.maxHp, 0, 1);
        const nGhost = clamp(n.ghostHp / n.maxHp, nFrac, 1);

        fb.drawBar(nBarX, nBarY, nBarW, nBarH, nFrac, {
          radius: 3,
          bgColor: [14, 18, 26, 230],
          borderColor: [240, 220, 110, 220],
          fgStart: n.kind === "rescue_cage" ? [45, 235, 145, 255] : [255, 205, 55, 255],
          fgEnd: n.kind === "rescue_cage" ? [115, 255, 185, 255] : [255, 240, 120, 255],
          ghostFrac: nGhost,
          ghostColor: [255, 255, 255, 230],
        });

        atlas.drawStyled(
          fb,
          n.label,
          nx,
          nBarY - 19,
          n.kind === "rescue_cage" ? [105, 255, 175, 255] : [255, 235, 95, 255],
          0.30,
          "center",
          { outlineWidth: 2.8, outlineColor: [8, 10, 16, 245] },
        );
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
          // 被丧尸杀掉后原地突变的前人类士兵（半残绿甲+紫红变异甲壳+歪斜步枪与利爪+血条）
          fb.drawGlowCircle(rx, ry, r.r * 1.7, [235, 28, 145, 105]);
          // 歪斜残破步枪与向下扑咬的变异利爪
          fb.drawLine(rx + 4, ry + 2, rx + 7, ry + r.r + 9, 3.4, [48, 56, 72, 255]);
          fb.drawLine(rx - 5, ry + 3, rx - 9, ry + r.r + 8, 2.8, [245, 45, 125, 255]);
          fb.drawLine(rx + 6, ry + 3, rx + 10, ry + r.r + 7, 2.8, [245, 45, 125, 255]);

          // 左肩残留人类绿甲 vs 右肩紫红肉瘤异变
          fb.fillCircle(rx - r.r * 0.72, ry, 4.5, [28, 155, 88, 255]);
          fb.fillCircle(rx + r.r * 0.72, ry, 5.0, [215, 25, 115, 255]);

          // 破损头盔与变异核心
          fb.fillCircle(rx, ry, r.r + 1.8, [28, 6, 18, 255]);
          fb.fillCircle(
            rx,
            ry,
            r.r,
            r.hitFlash > 0.3 ? [255, 215, 235, 255] : [198, 22, 102, 255],
          );
          drawPolygonLines(
            fb,
            rx,
            ry,
            r.r - 1.2,
            8,
            frameIdx * 0.03,
            1.8,
            [75, 235, 145, 215],
            true,
            [255, 65, 155, 195],
          );
          // 碎裂染血护目镜横线
          fb.drawLine(rx - 5, ry + 4, rx + 5, ry + 4, 2.6, [255, 240, 95, 255]);

          const iBarW = 46;
          const iBarH = 5;
          const iBarX = rx - iBarW * 0.5;
          const iBarY = ry - r.r - 12;
          const iFrac = clamp(r.hp / r.maxHp, 0, 1);
          fb.drawBar(iBarX, iBarY, iBarW, iBarH, iFrac, {
            radius: 2,
            bgColor: [14, 16, 24, 225],
            borderColor: [245, 95, 185, 220],
            fgStart: [245, 35, 135, 255],
            fgEnd: [255, 115, 195, 255],
          });
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

        atlas.drawStyled(
          fb,
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

      // 7. 绘制受击粒子
      for (const sp of simRender.sparks) {
        const alpha = clamp(Math.round((sp.ttl / sp.maxTtl) * 245), 0, 245);
        const sx = ox + sp.x;
        const sy = oy + sp.y;
        if (sp.kind === "blood") {
          fb.fillCircle(sx, sy, 2.6, [225, 24, 42, alpha]);
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

      // 8.5 死角光暗模式：2D 射线遮挡光影迷雾 + 体积手电/探照灯光锥 + 暗处丧尸红眼闪烁
      applyDeadCornerRaycastLighting(fb, simRender, atlas, frameIdx);

      // 8.8 战术载具入场渲染（重装防暴军用大巴 / 押运装甲大巴 / 黑鹰武装直升机 / 声呐侦察直升机）
      renderInsertionVehicles(fb, simRender, atlas, ox, oy, frameIdx);

      // 9. 绘制战场飘字横幅
      for (const b of simRender.banners) {
        const alpha = clamp(Math.round((b.ttl / b.maxTtl) * 255), 0, 255);
        const col: RGBA = [b.color[0], b.color[1], b.color[2], alpha];
        atlas.drawStyled(
          fb,
          b.text,
          ox + b.x,
          oy + b.y,
          col,
          0.33,
          "center",
          { outlineWidth: 3.0, outlineColor: [8, 10, 16, Math.min(245, alpha)] },
        );
      }

      // 9.5 裁剪视口外溢像素并绘制战场外框、右上角【全局战术小地图 + 实时视野跟随白框】与左上角【当前推进扇区遥测面板】
      clipHudMarginsAndDrawArenaBorder(fb, modeId);
      renderGlobalMinimapAndTelemetry(fb, simRender, atlas, frameIdx);

      // 10. 减员危机红框脉冲
      if (simRender.alarmFlash > 0.05) {
        const a = clamp(Math.round(simRender.alarmFlash * 110), 0, 125);
        fb.strokeRoundRect(BOARD_X, BOARD_Y, ARENA_W, ARENA_H, 4, 5, [255, 42, 58, a]);
      }

      // 11. 顶部纯视觉零文字解说「红绿阵营实时战力拉锯条 + 极简数字计数 HUD」
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

      fb.blendRoundRect(barX, barY, barW, barH, 12, [22, 26, 36, 240]);
      fb.blendRoundRect(barX, barY, barW, barH, 12, [215, 38, 58, 225]);
      const greenW = Math.round(barW * tugFrac);
      const barCol: RGBA =
        tugFrac < 0.28
          ? [255, 145, 45, 255]
          : simRender.counterPushActive
            ? [255, 195, 45, 255]
            : [42, 225, 132, 255];
      if (greenW > 0) {
        fb.blendRoundRect(barX, barY, greenW, barH, 12, barCol);
        fb.fillRect(barX + greenW - 2, barY - 4, 4, barH + 8, [255, 255, 255, 255]);
      }
      fb.strokeRoundRect(barX, barY, barW, barH, 12, 2, [85, 98, 128, 200]);

      const squadCol: RGBA =
        totalHumans === 0
          ? [255, 65, 95, 255]
          : totalHumans <= 5
            ? [255, 135, 95, 255]
            : simRender.counterPushActive
              ? [255, 220, 75, 255]
              : [80, 245, 155, 255];

      fb.fillCircle(barX + 14, 154, 8, squadCol);
      atlas.drawStyled(
        fb,
        `${totalHumans}`,
        barX + 32,
        158,
        squadCol,
        0.42,
        "left",
        { outlineWidth: 2.8, outlineColor: [8, 10, 16, 240] },
      );

      fb.fillCircle(barX + barW - 14, 154, 8, [245, 52, 72, 255]);
      atlas.drawStyled(
        fb,
        `${simRender.reds.length}`,
        barX + barW - 32,
        158,
        [255, 110, 125, 255],
        0.42,
        "right",
        { outlineWidth: 2.8, outlineColor: [8, 10, 16, 240] },
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
    modeId,
    kills: simRender.kills,
    bossesKilled: simRender.bossesKilled,
    totalBosses: simRender.totalBosses,
    aliveGreens: simRender.greens.length,
    rescuedCount: simRender.rescuedCount,
    casualties: simRender.casualties,
  };
}

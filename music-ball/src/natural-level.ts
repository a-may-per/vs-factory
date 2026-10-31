// Falling Ball 直角空间：由水平平台、竖直墙、矩形房间和直角台阶组成。
// 建筑几何先于运动存在；平台排布密度与竖井尺度经过调校，使小球下坠穿梭富有韵律感。
export interface AxisEvent {
  t_ms: number;
  strength: number;
  band: string;
  beat: boolean;
  downbeat: boolean;
  tier?: "strong" | "beat" | "weak";
}

export type PlatformKind = "ledge" | "gate";

export interface Wall {
  side: "left" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Platform {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: 0;
  support: "left" | "right" | "full";
  kind: PlatformKind;
  strong: boolean;
  guideDir: -1 | 1;
}

export interface NaturalLevel {
  duration: number;
  seed: number;
  shaftLeft: number;
  shaftRight: number;
  worldHeight: number;
  walls: Wall[];
  platforms: Platform[];
  events: AxisEvent[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildNaturalLevel(events: AxisEvent[], duration: number, seed = 71): NaturalLevel {
  const r = rng(seed);
  const left = 300;
  const right = 1620;
  const worldHeight = duration * 360 + 2000;
  const walls: Wall[] = [
    { side: "left", x: left - 92, y: 0, width: 92, height: worldHeight },
    { side: "right", x: right, y: 0, width: 92, height: worldHeight },
  ];
  const platforms: Platform[] = [];
  let id = 0;
  let y = 340;
  let room = 0;

  while (y < worldHeight - 480) {
    const mode = room % 5;
    // 每个房间只使用直角几何，平台始终从墙边伸出或横跨空间，形成高频左右导流与弹射。
    if (mode === 0) {
      const w = 480 + r() * 190;
      platforms.push({
        id: id++, x: left, y, width: w, height: 52, angle: 0,
        support: "left", kind: "ledge", strong: room % 2 === 0, guideDir: 1,
      });
      platforms.push({
        id: id++, x: right - w, y: y + 360, width: w, height: 52, angle: 0,
        support: "right", kind: "ledge", strong: false, guideDir: -1,
      });
    } else if (mode === 1) {
      platforms.push({
        id: id++, x: left + 110, y, width: right - left - 220, height: 58, angle: 0,
        support: "full", kind: "gate", strong: true, guideDir: room % 2 ? 1 : -1,
      });
      platforms.push({
        id: id++, x: left, y: y + 410, width: 450, height: 52, angle: 0,
        support: "left", kind: "ledge", strong: false, guideDir: 1,
      });
    } else if (mode === 2) {
      const w = 440 + r() * 190;
      platforms.push({
        id: id++, x: right - w, y, width: w, height: 52, angle: 0,
        support: "right", kind: "ledge", strong: room % 2 === 0, guideDir: -1,
      });
      platforms.push({
        id: id++, x: left, y: y + 390, width: w, height: 52, angle: 0,
        support: "left", kind: "ledge", strong: false, guideDir: 1,
      });
    } else if (mode === 3) {
      // 直角交错台阶：左、右、左，形成紧凑的矩形穿梭路线。
      for (let step = 0; step < 3; step++) {
        const side = step % 2 === 0 ? "left" : "right";
        const w = 420 + r() * 140;
        const yy = y + step * 250;
        platforms.push({
          id: id++,
          x: side === "left" ? left : right - w,
          y: yy,
          width: w,
          height: 48,
          angle: 0,
          support: side,
          kind: "ledge",
          strong: step === 2,
          guideDir: side === "left" ? 1 : -1,
        });
      }
    } else {
      // 矩形房间横梁：两侧留出可见的下落开口。
      const gap = 460 + r() * 170;
      platforms.push({
        id: id++, x: left + 70, y, width: gap, height: 56, angle: 0,
        support: "left", kind: "gate", strong: false, guideDir: 1,
      });
      platforms.push({
        id: id++, x: right - gap - 70, y: y + 340, width: gap, height: 56, angle: 0,
        support: "right", kind: "gate", strong: true, guideDir: -1,
      });
    }
    y += 860 + r() * 180;
    room++;
  }

  return { duration, seed, shaftLeft: left, shaftRight: right, worldHeight, walls, platforms, events };
}

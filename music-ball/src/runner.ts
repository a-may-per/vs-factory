// 横版跑酷运动模型：向右推进 + 重力 + 平台碰撞 + 节拍自动跳跃。
// 该文件不负责绘制，便于单独测试物理和回放。
import type { BeatTarget, Level, Platform } from "./level.ts";

export interface RunnerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  platformId: number;
  status: "run" | "jump" | "fall" | "land";
  jumpT: number;
  nextTarget: number;
  combo: number;
  lastLandT: number;
}

export interface RunnerFrame extends RunnerState {
  worldX: number;
  cameraX: number;
  targetId: number;
  targetHit: boolean;
  landingPlatformId: number;
}

export interface RunnerOptions {
  startX?: number;
  startY?: number;
  speed?: number;
  gravity?: number;
  jumpVelocity?: number;
}

const BALL_R = 25;

function platformAt(level: Level, x: number, y: number, vy: number): Platform | undefined {
  if (vy < 0) return undefined;
  return level.platforms.find(p => x >= p.x - BALL_R && x <= p.endX + BALL_R && y <= p.topY + 12 && y >= p.topY - 70);
}

export function createRunner(level: Level, options: RunnerOptions = {}): RunnerState {
  const startY = options.startY ?? 500;
  return {
    x: options.startX ?? 90,
    y: startY - BALL_R,
    vx: options.speed ?? level.speed,
    vy: 0,
    grounded: true,
    platformId: 0,
    status: "run",
    jumpT: 0,
    nextTarget: 0,
    combo: 0,
    lastLandT: 0,
  };
}

function shouldJump(state: RunnerState, level: Level, t: number): BeatTarget | undefined {
  const target = level.targets[state.nextTarget];
  if (!target || target.tSec < t - 0.12) return target;
  const dx = target.x - state.x;
  // 事件点来到球前方 160px 内时跳，强拍提前一点。
  const trigger = target.downbeat ? 230 : target.beat ? 190 : 155;
  return dx > 0 && dx < trigger ? target : undefined;
}

export function stepRunner(
  state: RunnerState,
  level: Level,
  t: number,
  dt: number,
  options: RunnerOptions = {},
): RunnerFrame {
  const gravity = options.gravity ?? 1550;
  const jumpVelocity = options.jumpVelocity ?? -610;
  const beforeY = state.y;
  const target = shouldJump(state, level, t);
  if (state.grounded && target) {
    state.vy = jumpVelocity - (target.downbeat ? 70 : target.strength * 50);
    state.grounded = false;
    state.status = "jump";
    state.jumpT = t;
  }

  state.x += state.vx * dt;
  if (!state.grounded) {
    state.vy += gravity * dt;
    state.y += state.vy * dt;
  }

  const landing = platformAt(level, state.x, state.y + BALL_R, state.vy);
  let landed = false;
  if (landing) {
    state.y = landing.topY - BALL_R;
    state.grounded = true;
    state.vy = 0;
    state.platformId = landing.id;
    state.status = "land";
    state.lastLandT = t;
    landed = true;
  } else if (!state.grounded && state.y > 850 - BALL_R) {
    // 安全底板也走普通重力碰撞，不做传送。
    state.y = 850 - BALL_R;
    state.vy = 0;
    state.grounded = true;
    state.platformId = level.platforms.find(p => p.kind === "safe")?.id ?? -1;
    state.status = "land";
    state.lastLandT = t;
    landed = true;
  } else if (state.grounded) {
    state.status = "run";
  } else {
    state.status = "fall";
  }

  // 目标点经过球心后视为一次命中/漏踩；漏踩不会伪造命中。
  let targetHit = false;
  const currentTarget = level.targets[state.nextTarget];
  if (currentTarget && state.x >= currentTarget.x - 32) {
    targetHit = Math.abs(state.y + BALL_R - currentTarget.y) < 90 && (landed || state.grounded);
    if (targetHit) state.combo++;
    else state.combo = 0;
    state.nextTarget++;
  }

  const cameraX = Math.max(0, state.x - 350);
  return {
    ...state,
    worldX: state.x,
    cameraX,
    targetId: currentTarget?.id ?? -1,
    targetHit,
    landingPlatformId: landed ? state.platformId : -1,
  };
}

export const BALL_RADIUS = BALL_R;

// Swept collision physics: continuous wall/platform intersections prevent tunneling.
// Platform contacts guide horizontal motion; vertical velocity always remains downward.
import type { NaturalLevel, Platform } from "./natural-level.ts";

export interface PhysicsFrame {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  cameraY: number;
  impact?: Platform;
  wallHit?: "left" | "right";
  collisionT?: number;
  status: "fall" | "guide" | "wall-bounce" | "rest";
}

export interface PhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastImpact: number;
  cooldown: number;
}

const R = 30;
const EPS = 0.02;
const MAX_SUBSTEP = 1 / 120;
const MAX_COLLISIONS_PER_STEP = 4;

interface SweepHit {
  t: number;
  kind: "left" | "right" | "platform";
  platform?: Platform;
  x: number;
  y: number;
}

export function createPhysics(level: NaturalLevel): PhysicsState {
  return {
    x: (level.shaftLeft + level.shaftRight) / 2,
    y: 80,
    vx: 80,
    vy: 120,
    lastImpact: -1,
    cooldown: 0,
  };
}

function sweepWall(x0: number, x1: number, y0: number, y1: number, level: NaturalLevel): SweepHit | undefined {
  const left = level.shaftLeft + R;
  const right = level.shaftRight - R;
  if (x1 < left && x0 >= left && x1 !== x0) {
    const t = (left - x0) / (x1 - x0);
    return { t, kind: "left", x: left, y: y0 + (y1 - y0) * t };
  }
  if (x1 > right && x0 <= right && x1 !== x0) {
    const t = (right - x0) / (x1 - x0);
    return { t, kind: "right", x: right, y: y0 + (y1 - y0) * t };
  }
  return undefined;
}

/** Sweep the ball center against the one-sided top face of a rotated platform. */
function sweepPlatform(
  x0: number, y0: number, x1: number, y1: number,
  p: Platform,
): SweepHit | undefined {
  const slope = Math.tan(p.angle);
  const surface = (x: number) => p.y + slope * (x - p.x);
  const d0 = y0 + R - surface(x0);
  const d1 = y1 + R - surface(x1);
  // Only collide while descending through the platform's top face.
  if (d0 > 0 || d1 < 0 || d1 === d0) return undefined;
  const t = -d0 / (d1 - d0);
  if (t < 0 || t > 1) return undefined;
  const x = x0 + (x1 - x0) * t;
  const y = y0 + (y1 - y0) * t;
  const margin = R * 0.45;
  if (x < p.x - margin || x > p.x + p.width + margin) return undefined;
  return { t, kind: "platform", platform: p, x, y };
}

function earliestHit(x0: number, y0: number, x1: number, y1: number, level: NaturalLevel, state: PhysicsState): SweepHit | undefined {
  let best = sweepWall(x0, x1, y0, y1, level);
  for (const p of level.platforms) {
    if (state.cooldown > 0 && p.id === state.lastImpact) continue;
    const hit = sweepPlatform(x0, y0, x1, y1, p);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }
  return best;
}

function advanceSubstep(state: PhysicsState, level: NaturalLevel, h: number): { impact?: Platform; wallHit?: "left" | "right"; collisionT?: number } {
  const gravity = 760;
  let remaining = h;
  let firstImpact: Platform | undefined;
  let wallHit: "left" | "right" | undefined;
  let collisionT: number | undefined;

  for (let iteration = 0; iteration < MAX_COLLISIONS_PER_STEP && remaining > 1e-6; iteration++) {
    const x0 = state.x, y0 = state.y;
    const vy1 = Math.min(620, state.vy + gravity * remaining);
    const x1 = x0 + state.vx * remaining;
    const y1 = y0 + (state.vy + vy1) * 0.5 * remaining;
    const hit = earliestHit(x0, y0, x1, y1, level, state);
    if (!hit) {
      state.x = x1;
      state.y = y1;
      state.vy = vy1;
      state.cooldown = Math.max(0, state.cooldown - remaining);
      remaining = 0;
      break;
    }

    const hitDt = remaining * hit.t;
    state.x = hit.x;
    state.y = hit.y;
    state.vy = Math.min(620, state.vy + gravity * hitDt);
    remaining -= hitDt;
    collisionT ??= 1 - remaining / h;

    if (hit.kind === "left" || hit.kind === "right") {
      wallHit = hit.kind;
      state.x += hit.kind === "left" ? EPS : -EPS;
      state.vx = hit.kind === "left" ? Math.abs(state.vx) * 0.82 : -Math.abs(state.vx) * 0.82;
    } else if (hit.platform) {
      const p = hit.platform;
      firstImpact ??= p;
      state.y = hit.y - EPS;
      state.cooldown = 0.045;
      state.lastImpact = p.id;
      const slope = Math.tan(p.angle);
      const guide = p.kind === "slope" ? 240 : p.kind === "gate" ? 190 : 145;
      state.vx = Math.max(-380, Math.min(380, state.vx + p.guideDir * guide + slope * state.vy * 0.18));
      // Compression reduces vertical speed briefly but never reverses it.
      state.vy = Math.max(130, state.vy * (p.strong ? 0.58 : 0.72));
    }

    // Avoid repeatedly resolving the same contact at t=0 while consuming the rest of this substep.
    const consume = Math.min(remaining, 1 / 240);
    if (consume > 0) {
      state.x += state.vx * consume;
      state.y += state.vy * consume + 0.5 * gravity * consume * consume;
      state.vy = Math.min(620, state.vy + gravity * consume);
      state.cooldown = Math.max(0, state.cooldown - consume);
      remaining -= consume;
    }
  }

  state.vx = Math.max(-390, Math.min(390, state.vx * 0.999));
  return { impact: firstImpact, wallHit, collisionT };
}

export function stepPhysics(state: PhysicsState, level: NaturalLevel, t: number, dt: number): PhysicsFrame {
  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / steps;
  let impact: Platform | undefined;
  let wallHit: "left" | "right" | undefined;
  let collisionT: number | undefined;
  for (let i = 0; i < steps; i++) {
    const result = advanceSubstep(state, level, h);
    impact ??= result.impact;
    wallHit ??= result.wallHit;
    if (result.collisionT !== undefined) collisionT = (i + result.collisionT) / steps;
  }

  // Clamp only as a final numerical guard; normal motion is resolved by swept wall tests above.
  state.x = Math.max(level.shaftLeft + R, Math.min(level.shaftRight - R, state.x));
  state.vy = Math.max(0, state.vy);
  return {
    t, x: state.x, y: state.y, vx: state.vx, vy: state.vy,
    cameraY: state.y, impact, wallHit, collisionT,
    status: impact ? "guide" : wallHit ? "wall-bounce" : "fall",
  };
}

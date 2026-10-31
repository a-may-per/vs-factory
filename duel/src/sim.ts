// duel 战斗模拟器：竖屏巨型擂台 + 环绕进化武器碰撞系统（Weapon Ball / Earclacks 爽感模型）
// 核心机制：
// 1. 武器拼刀（Blade vs Blade）：双方旋转武器碰撞触发“弹刀/交锋”，反转旋转方向、短距弹性震开并立刻二次交锋（叮！叮！叮！连弹）。
// 2. 破防命中（Blade vs Body）：武器突破防线斩中对手本体，造成暴击伤害、顿帧击退，并立即触发武器肉眼可见的进化（剑长暴涨 / 转速飙升 / 雷锤分裂 / 巨斧狂化）。
// 3. 向心弹墙与狂暴加速：碰墙反弹自带强向心偏转，杜绝平行死循环；全自动在黄金 15~21s 内迎来满层进化决胜。

export type Side = "A" | "B";
export type WeaponKind = "greatsword" | "twinblade" | "scythe" | "hammer";
export type ScaleKind = "reach" | "spin" | "multiweapon" | "titan";

export interface SkillDef {
  name: string;
  cooldown: number;
  damage: number;
  rangeMul: number;
  fx: "bolt" | "whirl";
  description: string;
}

export interface PassiveDef {
  name: string;
  description: string;
}

export interface FighterConfig {
  id: Side;
  name: string;
  title: string;
  maxHp: number;
  speed: number;
  contactRange: number;
  color: string;
  color2: string;
  active: SkillDef;
  passive: PassiveDef;
  passiveKind: "lifesteal" | "rage";
  style: "aggressive" | "balanced";
  weaponKind?: WeaponKind;
  scaleKind?: ScaleKind;
  baseReach?: number;
  baseSpinSpeed?: number;
  baseBlades?: number;
  hookRule?: string;
}

export interface FighterState {
  cfg: FighterConfig;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  facing: 1 | -1;
  skillCd: number;
  invulnCd: number;
  action: "idle" | "walk" | "skill" | "hit" | "death";
  actionTimer: number;
  rageStacks: number;
  alive: boolean;
  weaponKind: WeaponKind;
  scaleKind: ScaleKind;
  weaponAngle: number;
  spinDir: 1 | -1;
  baseSpinSpeed: number;
  spinSpeed: number;
  baseReach: number;
  reach: number;
  baseBlades: number;
  bladeCount: number;
  bodyScale: number;
  statLabel: string;
}

export type SimEvent =
  | {
      tick: number;
      t: number;
      type: "spawn";
      id: Side;
      name: string;
      title: string;
      x: number;
      y: number;
      color: string;
      color2: string;
      passive: string;
      passiveDesc: string;
      activeName: string;
      maxHp: number;
      weaponKind: WeaponKind;
      scaleKind: ScaleKind;
      reach: number;
      baseReach: number;
      spinSpeed: number;
      baseSpinSpeed: number;
      bladeCount: number;
      bodyScale: number;
      hookRule: string;
      statLabel: string;
    }
  | {
      tick: number;
      t: number;
      type: "move";
      id: Side;
      x: number;
      y: number;
      facing: 1 | -1;
      weaponAngle: number;
      reach: number;
      bladeCount: number;
      bodyScale: number;
      spinSpeed: number;
    }
  | { tick: number; t: number; type: "wallBounce"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "parry"; x: number; y: number; combo: number }
  | { tick: number; t: number; type: "skill"; id: Side; target: Side; name: string; x: number; y: number; fx: SkillDef["fx"] }
  | { tick: number; t: number; type: "damage"; id: Side; value: number; from: Side; hp: number; x: number; y: number }
  | { tick: number; t: number; type: "heal"; id: Side; value: number; hp: number; text: string; x: number; y: number }
  | {
      tick: number;
      t: number;
      type: "buff";
      id: Side;
      name: string;
      stacks: number;
      reach: number;
      spinSpeed: number;
      bladeCount: number;
      bodyScale: number;
      statLabel: string;
    }
  | {
      tick: number;
      t: number;
      type: "skillEffect";
      id: Side;
      kind: "lifesteal" | "rage" | "bounce";
      name: string;
      x: number;
      y: number;
      tx?: number;
      ty?: number;
      stacks?: number;
    }
  | { tick: number; t: number; type: "death"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "end"; winner: Side; duration: number };

// 1:1 对应 1080×1920 竖屏中的巨型中央擂台 (984×1200)
export const ARENA_W = 984;
export const ARENA_H = 1200;
export const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MOVE_EVERY = 2;
const BASE_RADIUS = 54;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vx: number, vy: number, speed: number): [number, number] {
  const len = Math.max(0.001, Math.hypot(vx, vy));
  return [(vx / len) * speed, (vy / len) * speed];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 点到线段的最短距离与最近点 */
function pointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { dist: number; cx: number; cy: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0.0001 ? clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1) : 0;
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return { dist: Math.hypot(px - cx, py - cy), cx, cy };
}

/** 两条线段的最短距离与接触中心点 */
function segmentToSegment(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): { dist: number; px: number; py: number } {
  const d1x = ax2 - ax1;
  const d1y = ay2 - ay1;
  const d2x = bx2 - bx1;
  const d2y = by2 - by1;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) > 0.0001) {
    const s = ((bx1 - ax1) * d2y - (by1 - ay1) * d2x) / denom;
    const u = ((bx1 - ax1) * d1y - (by1 - ay1) * d1x) / denom;
    if (s >= 0 && s <= 1 && u >= 0 && u <= 1) {
      return {
        dist: 0,
        px: ax1 + s * d1x,
        py: ay1 + s * d1y,
      };
    }
  }
  const c1 = pointToSegment(ax1, ay1, bx1, by1, bx2, by2);
  const c2 = pointToSegment(ax2, ay2, bx1, by1, bx2, by2);
  const c3 = pointToSegment(bx1, by1, ax1, ay1, ax2, ay2);
  const c4 = pointToSegment(bx2, by2, ax1, ay1, ax2, ay2);
  let best = c1;
  let mx = (ax1 + c1.cx) * 0.5;
  let my = (ay1 + c1.cy) * 0.5;
  if (c2.dist < best.dist) {
    best = c2;
    mx = (ax2 + c2.cx) * 0.5;
    my = (ay2 + c2.cy) * 0.5;
  }
  if (c3.dist < best.dist) {
    best = c3;
    mx = (bx1 + c3.cx) * 0.5;
    my = (by1 + c3.cy) * 0.5;
  }
  if (c4.dist < best.dist) {
    best = c4;
    mx = (bx2 + c4.cx) * 0.5;
    my = (by2 + c4.cy) * 0.5;
  }
  return { dist: best.dist, px: mx, py: my };
}

function computeStatLabel(f: FighterState): string {
  if (f.scaleKind === "reach") {
    return `剑长 ${Math.round((f.reach / f.baseReach) * 100)}%`;
  }
  if (f.scaleKind === "spin") {
    return `转速 ${Math.round((f.spinSpeed / f.baseSpinSpeed) * 100)}%`;
  }
  if (f.scaleKind === "multiweapon") {
    return `雷锤 ×${f.bladeCount}`;
  }
  return `巨斧 ${Math.round((f.reach / f.baseReach) * 100)}%`;
}

export function simulate(cfgA: FighterConfig, cfgB: FighterConfig, seed: number, maxDuration = 28): SimEvent[] {
  const events: SimEvent[] = [];
  const emit = (event: SimEvent) => events.push(event);
  const rng = mulberry32(seed);
  let time = 0;

  const makeState = (cfg: FighterConfig, x: number, y: number, targetX: number, targetY: number): FighterState => {
    const isA = cfg.id === "A";
    const weaponKind: WeaponKind = cfg.weaponKind ?? (isA ? "greatsword" : "twinblade");
    const scaleKind: ScaleKind = cfg.scaleKind ?? (isA ? "reach" : "spin");
    const baseReach = cfg.baseReach ?? (weaponKind === "greatsword" || weaponKind === "scythe" ? 175 : 155);
    const baseSpinSpeed = cfg.baseSpinSpeed ?? (scaleKind === "spin" ? 8.2 : 5.8);
    const baseBlades = cfg.baseBlades ?? (weaponKind === "twinblade" ? 2 : 1);

    // 调整基础球速至高爽感区间 (440+ px/s)
    const baseSpd = Math.max(430, cfg.speed * 1.55);
    const aimAngle = Math.atan2(targetY - y, targetX - x) + (rng() - 0.5) * 0.12;
    const [vx, vy] = normalize(Math.cos(aimAngle), Math.sin(aimAngle), baseSpd * 1.18);

    const st: FighterState = {
      cfg: { ...cfg, speed: baseSpd },
      x,
      y,
      vx,
      vy,
      hp: cfg.maxHp,
      facing: vx >= 0 ? 1 : -1,
      skillCd: 0,
      invulnCd: 0,
      action: "walk",
      actionTimer: 0,
      rageStacks: 0,
      alive: true,
      weaponKind,
      scaleKind,
      weaponAngle: aimAngle - (isA ? 1 : -1) * 0.85 + (rng() - 0.5) * 0.35,
      spinDir: isA ? 1 : -1,
      baseSpinSpeed,
      spinSpeed: baseSpinSpeed,
      baseReach,
      reach: baseReach,
      baseBlades,
      bladeCount: baseBlades,
      bodyScale: 1.0,
      statLabel: "",
    };
    st.statLabel = computeStatLabel(st);
    return st;
  };

  // 开局中场对冲，确保 0.26s~0.35s 内爆发第一记震撼交锋
  const A = makeState(cfgA, ARENA_W * 0.22, ARENA_H * 0.42, ARENA_W * 0.50, ARENA_H * 0.50);
  const B = makeState(cfgB, ARENA_W * 0.78, ARENA_H * 0.58, ARENA_W * 0.50, ARENA_H * 0.50);

  for (const f of [A, B]) {
    const defaultHook =
      f.scaleKind === "reach"
        ? "★ 命中剑长+20% · 吸血恢复"
        : f.scaleKind === "spin"
          ? "★ 命中转速+32% · 伤害递增"
          : f.scaleKind === "multiweapon"
            ? "★ 命中分裂旋转雷锤 · 满屏轰击"
            : "★ 命中巨斧变大 · 狂暴吸血";
    emit({
      tick: 0,
      t: 0,
      type: "spawn",
      id: f.cfg.id,
      name: f.cfg.name,
      title: f.cfg.title,
      x: Math.round(f.x),
      y: Math.round(f.y),
      color: f.cfg.color,
      color2: f.cfg.color2,
      passive: f.cfg.passive.name,
      passiveDesc: f.cfg.passive.description,
      activeName: f.cfg.active.name,
      maxHp: f.cfg.maxHp,
      weaponKind: f.weaponKind,
      scaleKind: f.scaleKind,
      reach: f.reach,
      baseReach: f.baseReach,
      spinSpeed: f.spinSpeed,
      baseSpinSpeed: f.baseSpinSpeed,
      bladeCount: f.bladeCount,
      bodyScale: f.bodyScale,
      hookRule: f.cfg.hookRule ?? defaultHook,
      statLabel: f.statLabel,
    });
  }

  const WALL_PAD = 24;
  let parryCd = 0;
  let parryCombo = 0;
  let lastParryTime = -10;
  let timeSinceInteraction = 0;

  function currentSpeed(f: FighterState): number {
    const timeBoost = time > 7 ? 1 + (time - 7) * 0.042 : 1;
    const stackSpeedBoost = f.scaleKind === "spin" ? 1 + f.rageStacks * 0.08 : 1 + f.rageStacks * 0.035;
    return f.cfg.speed * Math.min(1.9, timeBoost * stackSpeedBoost);
  }

  function bounceWall(f: FighterState, foe: FighterState, tick: number) {
    const r = BASE_RADIUS * f.bodyScale + WALL_PAD;
    let bounced = false;
    if (f.x < r) {
      f.x = r;
      f.vx = Math.abs(f.vx);
      bounced = true;
    }
    if (f.x > ARENA_W - r) {
      f.x = ARENA_W - r;
      f.vx = -Math.abs(f.vx);
      bounced = true;
    }
    if (f.y < r) {
      f.y = r;
      f.vy = Math.abs(f.vy);
      bounced = true;
    }
    if (f.y > ARENA_H - r) {
      f.y = ARENA_H - r;
      f.vy = -Math.abs(f.vy);
      bounced = true;
    }
    if (bounced) {
      // 弹墙时 58% 反射角直接指向对手当前坐标，保证弹墙后立刻杀回战场中央！
      const spd = currentSpeed(f);
      const [rvx, rvy] = normalize(f.vx, f.vy, 1);
      const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
      const mixX = rvx * 0.42 + tvx * 0.58 + (rng() - 0.5) * 0.16;
      const mixY = rvy * 0.42 + tvy * 0.58 + (rng() - 0.5) * 0.16;
      [f.vx, f.vy] = normalize(mixX, mixY, spd);
      emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
    }
  }

  function bounceApart(a: FighterState, b: FighterState, impulse = 1.15) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    const jx = (rng() - 0.5) * 0.32;
    const jy = (rng() - 0.5) * 0.32;
    [a.vx, a.vy] = normalize(-nx + jx, -ny + jy, currentSpeed(a) * impulse);
    [b.vx, b.vy] = normalize(nx - jx, ny - jy, currentSpeed(b) * impulse);

    const minDist = BASE_RADIUS * (a.bodyScale + b.bodyScale) + 6;
    const overlap = minDist - d;
    if (overlap > 0) {
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
    }
    const clampPos = (f: FighterState) => {
      const r = BASE_RADIUS * f.bodyScale + WALL_PAD;
      f.x = clamp(f.x, r, ARENA_W - r);
      f.y = clamp(f.y, r, ARENA_H - r);
    };
    clampPos(a);
    clampPos(b);
  }

  /** 拼刀短距微震：让双方在近身缠斗中连续叮当拼刀 2~3 次，随后切入破防 */
  function parryRecoil(a: FighterState, b: FighterState, combo: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    // 切向侧滑分量，使双方错位绕切，下一刀更容易突破武器防线斩中本体
    const tx = -ny;
    const ty = nx;
    const sideSign = combo % 2 === 0 ? 1 : -1;
    const recoilMul = combo >= 3 ? 0.95 : 0.72;
    [a.vx, a.vy] = normalize(-nx * 0.65 + tx * 0.75 * sideSign, -ny * 0.65 + ty * 0.75 * sideSign, currentSpeed(a) * recoilMul);
    [b.vx, b.vy] = normalize(nx * 0.65 - tx * 0.75 * sideSign, ny * 0.65 - ty * 0.75 * sideSign, currentSpeed(b) * recoilMul);
  }

  function getBladeSegments(f: FighterState): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const innerR = BASE_RADIUS * f.bodyScale * 0.58;
    for (let k = 0; k < f.bladeCount; k++) {
      const ang = f.weaponAngle + (k * Math.PI * 2) / f.bladeCount;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      segs.push({
        x1: f.x + cos * innerR,
        y1: f.y + sin * innerR,
        x2: f.x + cos * f.reach,
        y2: f.y + sin * f.reach,
      });
    }
    return segs;
  }

  function applyEvolution(caster: FighterState) {
    caster.rageStacks = Math.min(12, caster.rageStacks + 1);
    const s = caster.rageStacks;
    if (caster.scaleKind === "reach") {
      caster.reach = Math.min(Math.round(caster.baseReach * 2.55), Math.round(caster.baseReach * (1 + s * 0.20)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 1.9, caster.baseSpinSpeed * (1 + s * 0.10));
    } else if (caster.scaleKind === "spin") {
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 3.6, caster.baseSpinSpeed * (1 + s * 0.32));
      caster.reach = Math.min(Math.round(caster.baseReach * 1.45), Math.round(caster.baseReach * (1 + s * 0.05)));
    } else if (caster.scaleKind === "multiweapon") {
      caster.bladeCount = Math.min(4, caster.baseBlades + Math.min(3, Math.floor((s + 1) / 2)));
      caster.reach = Math.min(Math.round(caster.baseReach * 1.56), Math.round(caster.baseReach * (1 + s * 0.08)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 2.1, caster.baseSpinSpeed * (1 + s * 0.11));
    } else {
      // titan
      caster.bodyScale = Math.min(1.58, 1 + s * 0.08);
      caster.reach = Math.min(Math.round(caster.baseReach * 2.25), Math.round(caster.baseReach * (1 + s * 0.18)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 1.85, caster.baseSpinSpeed * (1 + s * 0.09));
    }
    caster.statLabel = computeStatLabel(caster);
  }

  function castWeaponHit(caster: FighterState, target: FighterState, tick: number, hitX: number, hitY: number): boolean {
    if (caster.skillCd > 0 || target.invulnCd > 0) return false;
    const skill = caster.cfg.active;
    const isHeavySingle = caster.weaponKind === "greatsword" || caster.weaponKind === "scythe";
    caster.skillCd = isHeavySingle ? 0.36 : 0.62;
    target.invulnCd = 0.32;
    caster.action = "skill";
    caster.actionTimer = 0.38;
    parryCombo = 0;
    timeSinceInteraction = 0;

    emit({
      tick,
      t: time,
      type: "skill",
      id: caster.cfg.id,
      target: target.cfg.id,
      name: skill.name,
      x: Math.round(hitX),
      y: Math.round(hitY),
      fx: skill.fx,
    });

    applyEvolution(caster);

    const rawBase = isHeavySingle ? 114 : 92;
    const stackMul = 1 + (caster.rageStacks - 1) * (isHeavySingle ? 0.17 : 0.15);
    const overtimeMul = time > 12 ? 1 + (time - 12) * 0.06 : 1;
    const damage = Math.max(1, Math.round(rawBase * stackMul * overtimeMul));
    target.hp -= damage;
    target.action = "hit";
    target.actionTimer = 0.25;

    emit({
      tick,
      t: time,
      type: "damage",
      id: target.cfg.id,
      value: damage,
      from: caster.cfg.id,
      hp: Math.max(0, target.hp),
      x: Math.round(target.x),
      y: Math.round(target.y),
    });

    emit({
      tick,
      t: time,
      type: "buff",
      id: caster.cfg.id,
      name: caster.cfg.passive.name,
      stacks: caster.rageStacks,
      reach: caster.reach,
      spinSpeed: Number(caster.spinSpeed.toFixed(2)),
      bladeCount: caster.bladeCount,
      bodyScale: Number(caster.bodyScale.toFixed(2)),
      statLabel: caster.statLabel,
    });

    if (caster.cfg.passiveKind === "lifesteal") {
      const heal = Math.round(damage * 0.34);
      caster.hp = Math.min(caster.cfg.maxHp, caster.hp + heal);
      emit({
        tick,
        t: time,
        type: "heal",
        id: caster.cfg.id,
        value: heal,
        hp: caster.hp,
        text: `吸血 +${heal}`,
        x: Math.round(caster.x),
        y: Math.round(caster.y),
      });
      emit({
        tick,
        t: time,
        type: "skillEffect",
        id: caster.cfg.id,
        kind: "lifesteal",
        name: `${caster.statLabel}`,
        x: Math.round(caster.x),
        y: Math.round(caster.y),
        tx: Math.round(target.x),
        ty: Math.round(target.y),
        stacks: caster.rageStacks,
      });
    } else {
      emit({
        tick,
        t: time,
        type: "skillEffect",
        id: caster.cfg.id,
        kind: "rage",
        name: `${caster.statLabel}`,
        x: Math.round(caster.x),
        y: Math.round(caster.y),
        stacks: caster.rageStacks,
      });
    }

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.action = "death";
      emit({ tick, t: time, type: "death", id: target.cfg.id, x: Math.round(target.x), y: Math.round(target.y) });
      emit({ tick, t: time, type: "end", winner: caster.cfg.id, duration: time });
      return true;
    }

    bounceApart(caster, target, 1.12);
    return false;
  }

  const maxTicks = Math.floor(TICK_RATE * maxDuration);
  for (let tick = 1; tick <= maxTicks; tick++) {
    time = tick * DT;
    parryCd = Math.max(0, parryCd - DT);
    timeSinceInteraction += DT;

    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;
      f.skillCd = Math.max(0, f.skillCd - DT);
      f.invulnCd = Math.max(0, f.invulnCd - DT);
      f.actionTimer = Math.max(0, f.actionTimer - DT);
      if (f.actionTimer === 0 && f.action !== "death") f.action = "walk";

      // 若双方超过 1.1 秒未发生交锋，立刻施加直线追击修正，彻底消灭冷场时间
      if (timeSinceInteraction > 0.9) {
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const [cvx, cvy] = normalize(f.vx, f.vy, 1);
        const steer = Math.min(0.12, (timeSinceInteraction - 0.9) * 0.08);
        [f.vx, f.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, currentSpeed(f));
      }

      f.x += f.vx * DT;
      f.y += f.vy * DT;
      f.facing = f.vx >= 0 ? 1 : -1;

      const overdriveSpin = time > 7 ? 1 + (time - 7) * 0.035 : 1;
      f.weaponAngle += f.spinDir * f.spinSpeed * overdriveSpin * DT;
      bounceWall(f, foe, tick);
    }

    if (A.alive && B.alive) {
      const segsA = getBladeSegments(A);
      const segsB = getBladeSegments(B);
      const rA = BASE_RADIUS * A.bodyScale;
      const rB = BASE_RADIUS * B.bodyScale;

      // 1. 先检查双方旋转刀锋是否发生金属交击 (Weapon-vs-Weapon Parry)
      let parriedThisTick = false;
      if (parryCd <= 0 && parryCombo < 2) {
        let bestParry: { dist: number; px: number; py: number } | null = null;
        for (const sa of segsA) {
          for (const sb of segsB) {
            const clash = segmentToSegment(sa.x1, sa.y1, sa.x2, sa.y2, sb.x1, sb.y1, sb.x2, sb.y2);
            if (clash.dist <= 36 && (!bestParry || clash.dist < bestParry.dist)) {
              bestParry = clash;
            }
          }
        }
        if (bestParry) {
          parryCd = 0.22;
          parryCombo = time - lastParryTime <= 1.8 ? parryCombo + 1 : 1;
          lastParryTime = time;
          timeSinceInteraction = 0;
          A.spinDir = (A.spinDir * -1) as 1 | -1;
          B.spinDir = (B.spinDir * -1) as 1 | -1;
          A.weaponAngle += A.spinDir * 0.35;
          B.weaponAngle += B.spinDir * 0.35;
          emit({
            tick,
            t: time,
            type: "parry",
            x: Math.round(bestParry.px),
            y: Math.round(bestParry.py),
            combo: parryCombo,
          });
          // 拼刀激发武器潜能：弱势方或连弹时立刻获得一层进化，保证双方武器同场暴涨
          for (const f of [A, B]) {
            const foe = f === A ? B : A;
            if (parryCombo >= 2 || f.rageStacks < foe.rageStacks) {
              applyEvolution(f);
              emit({
                tick,
                t: time,
                type: "buff",
                id: f.cfg.id,
                name: f.cfg.passive.name,
                stacks: f.rageStacks,
                reach: f.reach,
                spinSpeed: Number(f.spinSpeed.toFixed(2)),
                bladeCount: f.bladeCount,
                bodyScale: Number(f.bodyScale.toFixed(2)),
                statLabel: f.statLabel,
              });
            }
          }
          parryRecoil(A, B, parryCombo);
          parriedThisTick = true;
        }
      }

      // 2. 检查武器命中对手本体 (Weapon-vs-Body)
      let hitTriggered = false;
      if (!parriedThisTick) {
        const aMargin = A.weaponKind === "greatsword" || A.weaponKind === "scythe" ? 38 : 16;
        const bMargin = B.weaponKind === "greatsword" || B.weaponKind === "scythe" ? 38 : 16;

        let aBestDist = Infinity;
        let aHitPt: { cx: number; cy: number } | null = null;
        for (const sa of segsA) {
          const res = pointToSegment(B.x, B.y, sa.x1, sa.y1, sa.x2, sa.y2);
          if (res.dist < aBestDist) {
            aBestDist = res.dist;
            if (res.dist <= rB + aMargin) aHitPt = { cx: res.cx, cy: res.cy };
          }
        }

        let bBestDist = Infinity;
        let bHitPt: { cx: number; cy: number } | null = null;
        for (const sb of segsB) {
          const res = pointToSegment(A.x, A.y, sb.x1, sb.y1, sb.x2, sb.y2);
          if (res.dist < bBestDist) {
            bBestDist = res.dist;
            if (res.dist <= rA + bMargin) bHitPt = { cx: res.cx, cy: res.cy };
          }
        }

        let aCan = A.skillCd <= 0 && B.invulnCd <= 0 && aHitPt !== null;
        let bCan = B.skillCd <= 0 && A.invulnCd <= 0 && bHitPt !== null;

        // 劣势方绝地反击横扫：当血量落后方被近身且对手处于斩击半径内时，概率触发顺势破防反斩，制造神仙打架拉锯感
        const centerDist = Math.hypot(B.x - A.x, B.y - A.y);
        if (!aCan && bCan && A.hp < B.hp && A.skillCd <= 0 && B.invulnCd <= 0 && centerDist <= A.reach + rB) {
          if (rng() < 0.55) {
            A.weaponAngle = Math.atan2(B.y - A.y, B.x - A.x);
            aHitPt = { cx: B.x, cy: B.y };
            aCan = true;
          }
        } else if (!bCan && aCan && B.hp < A.hp && B.skillCd <= 0 && A.invulnCd <= 0 && centerDist <= B.reach + rA) {
          if (rng() < 0.55) {
            B.weaponAngle = Math.atan2(A.y - B.y, A.x - B.x);
            bHitPt = { cx: A.x, cy: A.y };
            bCan = true;
          }
        }

        if (aCan && bCan) {
          // 残血反击微调：让劣势方有更高先手破防概率，制造丝血反杀戏剧性
          const aBias = A.hp < B.hp ? 0.62 : 0.38;
          if (rng() < aBias) {
            if (castWeaponHit(A, B, tick, aHitPt!.cx, aHitPt!.cy)) break;
          } else {
            if (castWeaponHit(B, A, tick, bHitPt!.cx, bHitPt!.cy)) break;
          }
          hitTriggered = true;
        } else if (aCan) {
          if (castWeaponHit(A, B, tick, aHitPt!.cx, aHitPt!.cy)) break;
          hitTriggered = true;
        } else if (bCan) {
          if (castWeaponHit(B, A, tick, bHitPt!.cx, bHitPt!.cy)) break;
          hitTriggered = true;
        }
      }

      // 3. 本体球体近距冲撞：杜绝“空撞”，必定触发拼刀或武器破防斩击！
      const bodyDist = Math.hypot(B.x - A.x, B.y - A.y);
      if (bodyDist <= rA + rB + 14) {
        if (!hitTriggered && !parriedThisTick) {
          const midX = (A.x + B.x) * 0.5;
          const midY = (A.y + B.y) * 0.5;
          if (parryCd <= 0 && parryCombo < 2 && rng() < 0.48) {
            parryCd = 0.22;
            parryCombo = time - lastParryTime <= 1.8 ? parryCombo + 1 : 1;
            lastParryTime = time;
            timeSinceInteraction = 0;
            A.spinDir = (A.spinDir * -1) as 1 | -1;
            B.spinDir = (B.spinDir * -1) as 1 | -1;
            emit({ tick, t: time, type: "parry", x: Math.round(midX), y: Math.round(midY), combo: parryCombo });
            parryRecoil(A, B, parryCombo);
          } else {
            // 按当前残血激励 + 随机决定近身破防方
            const aPrefer = A.hp < B.hp ? 0.60 : A.hp > B.hp ? 0.40 : 0.50;
            const first = rng() < aPrefer ? A : B;
            const second = first === A ? B : A;
            if (first.skillCd <= 0 && second.invulnCd <= 0) {
              if (castWeaponHit(first, second, tick, midX, midY)) break;
            } else if (second.skillCd <= 0 && first.invulnCd <= 0) {
              if (castWeaponHit(second, first, tick, midX, midY)) break;
            } else {
              bounceApart(A, B, 1.05);
            }
          }
        } else {
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const d = Math.max(0.001, bodyDist);
          const overlap = rA + rB + 8 - d;
          if (overlap > 0) {
            A.x -= (dx / d) * overlap * 0.5;
            A.y -= (dy / d) * overlap * 0.5;
            B.x += (dx / d) * overlap * 0.5;
            B.y += (dy / d) * overlap * 0.5;
          }
        }
      }
    }

    if (tick % MOVE_EVERY === 0) {
      for (const f of [A, B]) {
        emit({
          tick,
          t: time,
          type: "move",
          id: f.cfg.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          facing: f.facing,
          weaponAngle: Number(f.weaponAngle.toFixed(3)),
          reach: f.reach,
          bladeCount: f.bladeCount,
          bodyScale: Number(f.bodyScale.toFixed(2)),
          spinSpeed: Number(f.spinSpeed.toFixed(2)),
        });
      }
    }
  }

  if (!events.some(e => e.type === "end")) {
    const aPct = A.hp / A.cfg.maxHp;
    const bPct = B.hp / B.cfg.maxHp;
    const winner = aPct >= bPct ? "A" : "B";
    emit({ tick: maxTicks, t: maxDuration, type: "end", winner, duration: maxDuration });
  }
  return events;
}

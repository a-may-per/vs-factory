// duel 战斗模拟器：竖屏巨型擂台 + 环绕进化武器碰撞系统（Weapon Ball / Earclacks 爽感模型）
// 核心机制：
// 1. 武器拼刀（Blade vs Blade）：双方旋转武器碰撞触发“弹刀/交锋”，反转旋转方向、短距弹性震开并立刻二次交锋（叮！叮！叮！连弹）。
// 2. 破防命中（Blade vs Body）：武器突破防线斩中对手本体，造成暴击伤害、顿帧击退，并立即触发武器肉眼可见的进化（剑长暴涨 / 转速飙升 / 雷锤分裂 / 巨斧狂化）。
// 3. 向心弹墙与狂暴加速：碰墙反弹自带强向心偏转，杜绝平行死循环；全自动在黄金 15~21s 内迎来满层进化决胜。

export type Side = "A" | "B";
export type CombatMode = "weapon" | "skillball";
export type BallSkillKind = "vampire_latch" | "spider_web" | "one_punch" | "dance_granny";
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
  combatMode?: CombatMode;
  ballSkillKind?: BallSkillKind;
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
      combatMode?: CombatMode;
      ballSkillKind?: BallSkillKind;
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
      latchedTo?: Side | null;
      punchCharge?: number;
      slowed?: boolean;
      vx?: number;
      vy?: number;
    }
  | { tick: number; t: number; type: "wallBounce"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "parry"; x: number; y: number; combo: number }
  | { tick: number; t: number; type: "skill"; id: Side; target: Side; name: string; x: number; y: number; fx: SkillDef["fx"] }
  | { tick: number; t: number; type: "damage"; id: Side; value: number; from: Side; hp: number; x: number; y: number; tag?: string }
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
  | { tick: number; t: number; type: "webSpawn"; webId: number; id: Side; x1: number; y1: number; x2: number; y2: number }
  | { tick: number; t: number; type: "webHit"; webId: number; id: Side; target: Side; x: number; y: number; value: number; broken: boolean; vx?: number; vy?: number }
  | { tick: number; t: number; type: "latchStart"; id: Side; target: Side; duration: number; x: number; y: number }
  | { tick: number; t: number; type: "latchEnd"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "seriousPunch"; id: Side; target: Side; x: number; y: number; tx: number; ty: number; power: number }
  | { tick: number; t: number; type: "soundWave"; id: Side; x: number; y: number; maxR: number }
  | { tick: number; t: number; type: "cloneSync"; id: Side; clones: Array<{ id: number; x: number; y: number }> }
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
    return f.weaponKind === "twinblade" ? `双匕 ×${f.bladeCount}` : `雷锤 ×${f.bladeCount}`;
  }
  return `巨斧 ${Math.round((f.reach / f.baseReach) * 100)}%`;
}

export function simulate(cfgA: FighterConfig, cfgB: FighterConfig, seed: number, maxDuration = 28): SimEvent[] {
  if (cfgA.combatMode === "skillball" || cfgB.combatMode === "skillball") {
    return simulateSkillBall(cfgA, cfgB, seed, maxDuration);
  }
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
      caster.reach = Math.min(Math.round(caster.baseReach * 2.75), Math.round(caster.baseReach * (1 + s * 0.20)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 2.0, caster.baseSpinSpeed * (1 + s * 0.11));
    } else if (caster.scaleKind === "spin") {
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 4.2, caster.baseSpinSpeed * (1 + s * 0.32));
      caster.reach = Math.min(Math.round(caster.baseReach * 1.50), Math.round(caster.baseReach * (1 + s * 0.05)));
    } else if (caster.scaleKind === "multiweapon") {
      caster.bladeCount = Math.min(5, caster.baseBlades + Math.min(4, Math.floor((s + 1) / 2)));
      caster.reach = Math.min(Math.round(caster.baseReach * 1.62), Math.round(caster.baseReach * (1 + s * 0.08)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 2.3, caster.baseSpinSpeed * (1 + s * 0.12));
    } else {
      // titan
      caster.bodyScale = Math.min(1.65, 1 + s * 0.08);
      caster.reach = Math.min(Math.round(caster.baseReach * 2.40), Math.round(caster.baseReach * (1 + s * 0.18)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 1.95, caster.baseSpinSpeed * (1 + s * 0.10));
    }
    caster.statLabel = computeStatLabel(caster);
  }

  function castWeaponHit(caster: FighterState, target: FighterState, tick: number, hitX: number, hitY: number): boolean {
    if (caster.skillCd > 0 || target.invulnCd > 0) return false;
    const skill = caster.cfg.active;
    const isHeavySingle = caster.weaponKind === "greatsword" || caster.weaponKind === "scythe";
    const spinRatio = caster.spinSpeed / Math.max(1, caster.baseSpinSpeed);
    const baseCd = isHeavySingle ? 0.34 : 0.38;
    caster.skillCd = clamp(baseCd / (0.82 + 0.34 * spinRatio + (caster.bladeCount - 1) * 0.12), 0.13, 0.36);
    target.invulnCd = clamp(caster.skillCd * 0.72, 0.11, 0.24);
    caster.action = "skill";
    caster.actionTimer = 0.32;
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

    const rawBase = isHeavySingle ? 98 : 78;
    const stackMul = 1 + (caster.rageStacks - 1) * (isHeavySingle ? 0.15 : 0.13);
    const overtimeMul = time > 11 ? 1 + (time - 11) * 0.07 : 1;
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

      // 若双方超过 0.65 秒未发生交锋，立刻施加直线追击修正，彻底消灭冷场时间
      if (timeSinceInteraction > 0.65) {
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const [cvx, cvy] = normalize(f.vx, f.vy, 1);
        const steer = Math.min(0.18, (timeSinceInteraction - 0.65) * 0.12);
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
      if (parryCd <= 0 && parryCombo < 3) {
        let bestParry: { dist: number; px: number; py: number } | null = null;
        for (const sa of segsA) {
          for (const sb of segsB) {
            const clash = segmentToSegment(sa.x1, sa.y1, sa.x2, sa.y2, sb.x1, sb.y1, sb.x2, sb.y2);
            if (clash.dist <= 38 && (!bestParry || clash.dist < bestParry.dist)) {
              bestParry = clash;
            }
          }
        }
        if (bestParry) {
          parryCd = 0.13;
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
          if (parryCd <= 0 && parryCombo < 3 && rng() < 0.48) {
            parryCd = 0.13;
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

// ============================================================================
// 模式 B：机制小球 / 抽象英雄技能对决引擎 (Skill-Ball Mode)
// 1. 鲜血吸血鬼 (vampire_latch)：碰撞死死吸附对手 1.3~2.1s，贴身连续高频吸血 + 血蝠进化
// 2. 剧毒蜘蛛王 (spider_web)：移动/弹墙在场内拉出绷紧蛛丝网，对手路过触发蛛丝切割扣血 + 减速粘滞
// 3. 一拳光头 (one_punch)：蓄力认真一拳，将对手超高速轰飞连撞墙壁造成粉碎伤害
// 4. 广场舞老太 (dance_granny)：外放高音震波圈 + 召唤伴舞大妈分身球围殴 + 碰瓷反伤
// ============================================================================
interface SkillBallState extends FighterState {
  ballSkillKind: BallSkillKind;
  latchedTo: Side | null;
  latchTimer: number;
  latchTickCd: number;
  latchCooldown: number;
  latchAngle: number;
  slowTimer: number;
  knockbackTimer: number;
  knockbackFrom: Side | null;
  punchCharge: number;
  webCastCd: number;
  lastAnchorX: number;
  lastAnchorY: number;
  webGlobalCd: number;
  soundWaveCd: number;
  counterCd: number;
}

interface ActiveWeb {
  id: number;
  owner: Side;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hp: number;
  hitCd: number;
}

interface DancerClone {
  id: number;
  owner: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hitCd: number;
}

function computeSkillBallLabel(f: SkillBallState, webCount: number, cloneCount: number): string {
  if (f.ballSkillKind === "vampire_latch") {
    const dur = (1.3 + f.rageStacks * 0.16).toFixed(1);
    return `吸附 ${dur}秒`;
  }
  if (f.ballSkillKind === "spider_web") {
    return `蛛丝 ×${Math.max(1, webCount)}`;
  }
  if (f.ballSkillKind === "one_punch") {
    return `拳威 ${100 + f.rageStacks * 35}%`;
  }
  return `伴舞 ×${cloneCount + 1}`;
}

function simulateSkillBall(cfgA: FighterConfig, cfgB: FighterConfig, seed: number, maxDuration = 34): SimEvent[] {
  const events: SimEvent[] = [];
  const emit = (event: SimEvent) => events.push(event);
  const rng = mulberry32(seed);
  let time = 0;

  const BALL_R = 58;
  const WALL_PAD = 24;
  let nextWebId = 1;
  let nextCloneId = 1;
  const webs: ActiveWeb[] = [];
  const clones: DancerClone[] = [];

  const makeBall = (cfg: FighterConfig, x: number, y: number, tx: number, ty: number): SkillBallState => {
    const isA = cfg.id === "A";
    const ballSkillKind: BallSkillKind = cfg.ballSkillKind ?? (isA ? "vampire_latch" : "spider_web");
    const baseSpd = Math.max(450, cfg.speed * 1.48);
    const aim = Math.atan2(ty - y, tx - x) + (rng() - 0.5) * 0.15;
    const [vx, vy] = normalize(Math.cos(aim), Math.sin(aim), baseSpd * 1.12);
    const st: SkillBallState = {
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
      weaponKind: cfg.weaponKind ?? "greatsword",
      scaleKind: cfg.scaleKind ?? "reach",
      weaponAngle: 0,
      spinDir: isA ? 1 : -1,
      baseSpinSpeed: 6,
      spinSpeed: 6,
      baseReach: 140,
      reach: 140,
      baseBlades: 1,
      bladeCount: 1,
      bodyScale: 1.08,
      statLabel: "",
      ballSkillKind,
      latchedTo: null,
      latchTimer: 0,
      latchTickCd: 0,
      latchCooldown: 0.25,
      latchAngle: isA ? 0 : Math.PI,
      slowTimer: 0,
      knockbackTimer: 0,
      knockbackFrom: null,
      punchCharge: ballSkillKind === "one_punch" ? 72 : 0,
      webCastCd: 0.18,
      lastAnchorX: x,
      lastAnchorY: y,
      webGlobalCd: 0,
      soundWaveCd: 0.55,
      counterCd: 0,
    };
    st.statLabel = computeSkillBallLabel(st, 0, 0);
    return st;
  };

  const A = makeBall(cfgA, ARENA_W * 0.22, ARENA_H * 0.38, ARENA_W * 0.52, ARENA_H * 0.52);
  const B = makeBall(cfgB, ARENA_W * 0.78, ARENA_H * 0.62, ARENA_W * 0.48, ARENA_H * 0.48);

  for (const f of [A, B]) {
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
      combatMode: "skillball",
      ballSkillKind: f.ballSkillKind,
      weaponKind: f.weaponKind,
      scaleKind: f.scaleKind,
      reach: f.reach,
      baseReach: f.baseReach,
      spinSpeed: f.spinSpeed,
      baseSpinSpeed: f.baseSpinSpeed,
      bladeCount: f.bladeCount,
      bodyScale: f.bodyScale,
      hookRule: f.cfg.hookRule ?? "★ 机制碰撞进化 ★",
      statLabel: f.statLabel,
    });
  }

  // 开局若一方是蜘蛛王，预先在场地中央斜拉 2 根交叉初始蛛丝，开场即有视觉张力
  for (const f of [A, B]) {
    if (f.ballSkillKind === "spider_web") {
      const w1: ActiveWeb = {
        id: nextWebId++,
        owner: f.cfg.id,
        x1: Math.round(ARENA_W * 0.14),
        y1: Math.round(ARENA_H * 0.68),
        x2: Math.round(ARENA_W * 0.84),
        y2: Math.round(ARENA_H * 0.32),
        hp: 999,
        hitCd: 0.2,
      };
      const w2: ActiveWeb = {
        id: nextWebId++,
        owner: f.cfg.id,
        x1: Math.round(ARENA_W * 0.18),
        y1: Math.round(ARENA_H * 0.28),
        x2: Math.round(ARENA_W * 0.80),
        y2: Math.round(ARENA_H * 0.72),
        hp: 999,
        hitCd: 0.2,
      };
      webs.push(w1, w2);
      emit({ tick: 1, t: 0.02, type: "webSpawn", webId: w1.id, id: f.cfg.id, x1: w1.x1, y1: w1.y1, x2: w1.x2, y2: w1.y2 });
      emit({ tick: 1, t: 0.02, type: "webSpawn", webId: w2.id, id: f.cfg.id, x1: w2.x1, y1: w2.y1, x2: w2.x2, y2: w2.y2 });
    }
  }

  let timeSinceAction = 0;

  function effectiveSpeed(f: SkillBallState, foe: SkillBallState): number {
    const timeBoost = time > 10 ? 1 + (time - 10) * 0.032 : 1;
    let mul = timeBoost * (1 + f.rageStacks * 0.032);
    if (f.knockbackTimer > 0) mul *= 2.45;
    else if (f.latchedTo) mul *= 1.08; // 吸血鬼吸附猎物期间作为行动主人，挟持猎物高速掠行
    else if (f.slowTimer > 0) mul *= 0.62; // 踩中蛛丝粘滞减速
    return f.cfg.speed * clamp(mul, 0.54, 2.85);
  }

  function evolveBall(f: SkillBallState, tick: number) {
    f.rageStacks = Math.min(8, f.rageStacks + 1);
    if (f.ballSkillKind === "one_punch" || f.ballSkillKind === "vampire_latch") {
      f.bodyScale = Math.min(1.26, 1.08 + f.rageStacks * 0.02);
    }
    const myWebs = webs.filter(w => w.owner === f.cfg.id).length;
    const myClones = clones.filter(c => c.owner === f.cfg.id).length;
    f.statLabel = computeSkillBallLabel(f, myWebs, myClones);
    emit({
      tick,
      t: time,
      type: "buff",
      id: f.cfg.id,
      name: f.cfg.passive.name,
      stacks: f.rageStacks,
      reach: f.reach,
      spinSpeed: f.spinSpeed,
      bladeCount: f.bladeCount,
      bodyScale: Number(f.bodyScale.toFixed(2)),
      statLabel: f.statLabel,
    });
  }

  function applyDamage(
    attacker: SkillBallState,
    target: SkillBallState,
    rawDmg: number,
    tick: number,
    tag?: string,
  ): boolean {
    if (!target.alive) return true;
    // 黄金 23~28s 节奏：前 17s 充分博弈拉扯，17s 后进入狂暴决胜加速
    const overtimeMul = time > 17 ? 1 + (time - 17) * 0.085 : 1;
    const dmg = Math.max(1, Math.round(rawDmg * overtimeMul));
    target.hp -= dmg;
    target.action = "hit";
    target.actionTimer = 0.22;
    timeSinceAction = 0;

    emit({
      tick,
      t: time,
      type: "damage",
      id: target.cfg.id,
      value: dmg,
      from: attacker.cfg.id,
      hp: Math.max(0, target.hp),
      x: Math.round(target.x),
      y: Math.round(target.y),
      tag,
    });

    // 广场舞老太受重击时触发「太极碰瓷反伤」
    if (
      target.alive &&
      target.hp > 0 &&
      target.ballSkillKind === "dance_granny" &&
      dmg >= 72 &&
      target.counterCd <= 0 &&
      attacker.alive
    ) {
      target.counterCd = 1.95;
      const reflect = Math.round(dmg * 0.34);
      const heal = Math.round(28 + target.rageStacks * 2.5);
      target.hp = Math.min(target.cfg.maxHp, target.hp + heal);
      emit({
        tick,
        t: time,
        type: "heal",
        id: target.cfg.id,
        value: heal,
        hp: target.hp,
        text: `碰瓷回血 +${heal}`,
        x: Math.round(target.x),
        y: Math.round(target.y),
      });
      attacker.hp -= reflect;
      emit({
        tick,
        t: time,
        type: "damage",
        id: attacker.cfg.id,
        value: reflect,
        from: target.cfg.id,
        hp: Math.max(0, attacker.hp),
        x: Math.round(attacker.x),
        y: Math.round(attacker.y),
        tag: `碰瓷反伤 -${reflect}`,
      });
      if (attacker.hp <= 0) {
        attacker.hp = 0;
        attacker.alive = false;
        attacker.action = "death";
        emit({ tick, t: time, type: "death", id: attacker.cfg.id, x: Math.round(attacker.x), y: Math.round(attacker.y) });
        emit({ tick, t: time, type: "end", winner: target.cfg.id, duration: time });
        return true;
      }
    }

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.action = "death";
      emit({ tick, t: time, type: "death", id: target.cfg.id, x: Math.round(target.x), y: Math.round(target.y) });
      emit({ tick, t: time, type: "end", winner: attacker.cfg.id, duration: time });
      return true;
    }
    return false;
  }

  function spawnSpiderWeb(spider: SkillBallState, tick: number, x1: number, y1: number, x2: number, y2: number) {
    if (Math.hypot(x2 - x1, y2 - y1) < 160) return;
    if (webs.length >= 14) {
      webs.shift();
    }
    const w: ActiveWeb = {
      id: nextWebId++,
      owner: spider.cfg.id,
      x1: Math.round(x1),
      y1: Math.round(y1),
      x2: Math.round(x2),
      y2: Math.round(y2),
      hp: 999, // 高韧性耐磨蛛丝：整局不断线，持续提供弹性弦反弹与切割伤害
      hitCd: 0.18,
    };
    webs.push(w);
    spider.lastAnchorX = x2;
    spider.lastAnchorY = y2;
    spider.webCastCd = 0.36;
    emit({ tick, t: time, type: "webSpawn", webId: w.id, id: spider.cfg.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
    const myWebs = webs.filter(item => item.owner === spider.cfg.id).length;
    spider.statLabel = computeSkillBallLabel(spider, myWebs, 0);
    if (w.id % 2 === 0) {
      evolveBall(spider, tick);
    }
  }

  const maxTicks = Math.floor(TICK_RATE * maxDuration);
  for (let tick = 1; tick <= maxTicks; tick++) {
    time = tick * DT;
    timeSinceAction += DT;

    for (const w of webs) {
      w.hitCd = Math.max(0, w.hitCd - DT);
    }

    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;
      f.skillCd = Math.max(0, f.skillCd - DT);
      f.invulnCd = Math.max(0, f.invulnCd - DT);
      f.actionTimer = Math.max(0, f.actionTimer - DT);
      f.latchCooldown = Math.max(0, f.latchCooldown - DT);
      f.slowTimer = Math.max(0, f.slowTimer - DT);
      f.knockbackTimer = Math.max(0, f.knockbackTimer - DT);
      f.webCastCd = Math.max(0, f.webCastCd - DT);
      f.webGlobalCd = Math.max(0, f.webGlobalCd - DT);
      f.soundWaveCd = Math.max(0, f.soundWaveCd - DT);
      f.counterCd = Math.max(0, f.counterCd - DT);

      if (f.ballSkillKind === "one_punch") {
        f.punchCharge = Math.min(100, f.punchCharge + 31 * DT);
      }

      // 0. 若当前角色正在被吸血鬼钳制吸附，完全失去自主移动权（由吸血鬼作为行动主人拖拽移动）
      if (foe.latchedTo === f.cfg.id && foe.alive) {
        f.action = "hit";
        // 广场舞老太被吸血鬼钳制时虽无法自主移动，但背上的蓝牙音响仍会自动外放震波并摇人伴舞护主！
        if (f.ballSkillKind === "dance_granny" && f.soundWaveCd <= 0) {
          f.soundWaveCd = Math.max(1.05, 1.42 - f.rageStacks * 0.05);
          const maxR = 315 + f.rageStacks * 20;
          emit({ tick, t: time, type: "soundWave", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
          const waveDmg = Math.round(30 + f.rageStacks * 3.4);
          foe.latchTimer = Math.max(0, foe.latchTimer - 0.22);
          evolveBall(f, tick);
          const myClones = clones.filter(c => c.owner === f.cfg.id);
          if (myClones.length < 5 && f.rageStacks >= myClones.length + 1) {
            const ang = rng() * Math.PI * 2;
            clones.push({
              id: nextCloneId++,
              owner: f.cfg.id,
              x: clamp(f.x + Math.cos(ang) * 72, 60, ARENA_W - 60),
              y: clamp(f.y + Math.sin(ang) * 72, 60, ARENA_H - 60),
              vx: Math.cos(ang) * 425,
              vy: Math.sin(ang) * 425,
              hitCd: 0.35,
            });
            f.statLabel = computeSkillBallLabel(f, 0, myClones.length + 1);
          }
          if (applyDamage(f, foe, waveDmg, tick, `音波震退 -${waveDmg}`)) break;
        }
        continue;
      }

      // 1. 若当前角色是吸血鬼且正处于「钳制吸附」状态：吸血鬼作为行动主人，死死钳住猎物在场内掠行撕咬！
      if (f.latchedTo && foe.alive) {
        f.latchTimer -= DT;
        f.latchTickCd -= DT;

        // 吸血鬼主导移动轨迹（略带盘旋掠食弧线）并处理墙壁反弹
        const curMoveAng = Math.atan2(f.vy, f.vx) + Math.sin(time * 8.5) * 0.035;
        [f.vx, f.vy] = normalize(Math.cos(curMoveAng), Math.sin(curMoveAng), effectiveSpeed(f, foe));
        f.x += f.vx * DT;
        f.y += f.vy * DT;

        const rDom = BALL_R * f.bodyScale + WALL_PAD + 36;
        let domBounced = false;
        if (f.x < rDom) {
          f.x = rDom;
          f.vx = Math.abs(f.vx);
          domBounced = true;
        }
        if (f.x > ARENA_W - rDom) {
          f.x = ARENA_W - rDom;
          f.vx = -Math.abs(f.vx);
          domBounced = true;
        }
        if (f.y < rDom) {
          f.y = rDom;
          f.vy = Math.abs(f.vy);
          domBounced = true;
        }
        if (f.y > ARENA_H - rDom) {
          f.y = ARENA_H - rDom;
          f.vy = -Math.abs(f.vy);
          domBounced = true;
        }
        if (domBounced) {
          const [rvx, rvy] = normalize(f.vx, f.vy, 1);
          const [cvx, cvy] = normalize(ARENA_W * 0.5 - f.x, ARENA_H * 0.5 - f.y, 1);
          [f.vx, f.vy] = normalize(rvx * 0.65 + cvx * 0.35, rvy * 0.65 + cvy * 0.35, effectiveSpeed(f, foe));
          emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
        }

        // 将猎物死死钳制在吸血鬼獠牙正前方并高频撕扯晃动
        const carryBaseAng = Math.atan2(f.vy, f.vx);
        const biteThrash = Math.sin(time * 30) * 0.18;
        const carryAng = carryBaseAng + biteThrash;
        const attachDist = BALL_R * (f.bodyScale + foe.bodyScale) * 0.64;
        foe.x = clamp(f.x + Math.cos(carryAng) * attachDist, BALL_R + WALL_PAD, ARENA_W - BALL_R - WALL_PAD);
        foe.y = clamp(f.y + Math.sin(carryAng) * attachDist, BALL_R + WALL_PAD, ARENA_H - BALL_R - WALL_PAD);
        foe.vx = f.vx;
        foe.vy = f.vy;
        foe.lastAnchorX = foe.x;
        foe.lastAnchorY = foe.y;
        f.facing = foe.x >= f.x ? 1 : -1;
        foe.facing = f.x >= foe.x ? 1 : -1;
        f.action = "skill";
        foe.action = "hit";

        if (f.latchTickCd <= 0) {
          f.latchTickCd = 0.29;
          const biteDmg = Math.round(24 + f.rageStacks * 3.3);
          const healVal = Math.round(16 + f.rageStacks * 2.1);
          f.hp = Math.min(f.cfg.maxHp, f.hp + healVal);
          emit({
            tick,
            t: time,
            type: "heal",
            id: f.cfg.id,
            value: healVal,
            hp: f.hp,
            text: `吸血 +${healVal}`,
            x: Math.round(f.x),
            y: Math.round(f.y),
          });
          emit({
            tick,
            t: time,
            type: "skillEffect",
            id: f.cfg.id,
            kind: "lifesteal",
            name: "鲜血汲取",
            x: Math.round(f.x),
            y: Math.round(f.y),
            tx: Math.round(foe.x),
            ty: Math.round(foe.y),
            stacks: f.rageStacks,
          });
          if (applyDamage(f, foe, biteDmg, tick, `咬血 -${biteDmg}`)) break;
        }

        if (f.latchTimer <= 0) {
          f.latchedTo = null;
          f.latchCooldown = 1.35;
          emit({ tick, t: time, type: "latchEnd", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
          evolveBall(f, tick);
          const dx = foe.x - f.x;
          const dy = foe.y - f.y;
          // 吸血结束瞬间，吸血鬼将猎物狠狠甩飞出去，自身后空翻拉开身位
          [foe.vx, foe.vy] = normalize(dx, dy, effectiveSpeed(foe, f) * 1.28);
          [f.vx, f.vy] = normalize(-dx, -dy, effectiveSpeed(f, foe) * 1.15);
        }
        continue;
      }

      // 2. 正常弹射移动与向心追击
      if (timeSinceAction > 0.65 && f.knockbackTimer <= 0) {
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const [cvx, cvy] = normalize(f.vx, f.vy, 1);
        const steer = f.ballSkillKind === "vampire_latch" ? 0.19 : f.ballSkillKind === "one_punch" ? 0.14 : 0.09;
        [f.vx, f.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, effectiveSpeed(f, foe));
      } else {
        [f.vx, f.vy] = normalize(f.vx, f.vy, effectiveSpeed(f, foe));
      }

      f.x += f.vx * DT;
      f.y += f.vy * DT;
      f.facing = f.vx >= 0 ? 1 : -1;

      // 3. 墙壁反弹与特殊弹墙技能触发
      const r = BALL_R * f.bodyScale + WALL_PAD;
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
        const [rvx, rvy] = normalize(f.vx, f.vy, 1);
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const bias = f.ballSkillKind === "spider_web" ? 0.38 : 0.62;
        [f.vx, f.vy] = normalize(
          rvx * (1 - bias) + tvx * bias + (rng() - 0.5) * 0.22,
          rvy * (1 - bias) + tvy * bias + (rng() - 0.5) * 0.22,
          effectiveSpeed(f, foe),
        );
        emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });

        // 蜘蛛王：每次弹墙直接吐丝拉网！
        if (f.ballSkillKind === "spider_web" && f.webCastCd <= 0) {
          spawnSpiderWeb(f, tick, f.lastAnchorX, f.lastAnchorY, f.x, f.y);
        }

        // 一拳光头：弹墙蓄力 +24%
        if (f.ballSkillKind === "one_punch") {
          f.punchCharge = Math.min(100, f.punchCharge + 24);
        }

        // 被「认真一拳」轰飞期间撞墙：触发「撞墙粉碎」高额二段伤害！
        if (f.knockbackTimer > 0 && f.knockbackFrom) {
          const puncher = f.knockbackFrom === "A" ? A : B;
          const slamDmg = Math.round(33 + puncher.rageStacks * 3.5);
          if (applyDamage(puncher, f, slamDmg, tick, `撞墙粉碎 -${slamDmg}`)) break;
        }
      }

      // 蜘蛛王在场内长距离穿梭时也会中途锚定吐丝
      if (
        f.ballSkillKind === "spider_web" &&
        f.webCastCd <= 0 &&
        Math.hypot(f.x - f.lastAnchorX, f.y - f.lastAnchorY) >= 290
      ) {
        spawnSpiderWeb(f, tick, f.lastAnchorX, f.lastAnchorY, f.x, f.y);
      }

      // 广场舞老太：周期性外放高音蓝牙震波环 + 召唤最多 5 名伴舞大妈分身球
      if (f.ballSkillKind === "dance_granny" && f.soundWaveCd <= 0 && foe.alive) {
        f.soundWaveCd = Math.max(0.96, 1.38 - f.rageStacks * 0.05);
        const maxR = 315 + f.rageStacks * 20;
        emit({ tick, t: time, type: "soundWave", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distToFoe <= maxR * 0.94) {
          const waveDmg = Math.round(30 + f.rageStacks * 3.4);
          // 音波推开对手（若一拳光头已蓄满 95% 进入霸体突进，则仅轻微减速不打断突进）
          const pushScale = foe.ballSkillKind === "one_punch" && foe.punchCharge >= 95 ? 0.55 : 1.12;
          if (pushScale > 0.8) {
            const [px, py] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * pushScale);
            foe.vx = px;
            foe.vy = py;
          }
          evolveBall(f, tick);
          // 逐步摇人召唤最多 5 名伴舞大妈分身球组成广场舞大阵！
          const myClones = clones.filter(c => c.owner === f.cfg.id);
          if (myClones.length < 5 && f.rageStacks >= myClones.length + 1) {
            const ang = rng() * Math.PI * 2;
            clones.push({
              id: nextCloneId++,
              owner: f.cfg.id,
              x: clamp(f.x + Math.cos(ang) * 72, 60, ARENA_W - 60),
              y: clamp(f.y + Math.sin(ang) * 72, 60, ARENA_H - 60),
              vx: Math.cos(ang) * 425,
              vy: Math.sin(ang) * 425,
              hitCd: 0.35,
            });
            f.statLabel = computeSkillBallLabel(f, 0, myClones.length + 1);
          }
          if (applyDamage(f, foe, waveDmg, tick, `音波震退 -${waveDmg}`)) break;
        }
      }
    }

    if (!A.alive || !B.alive) break;

    // 4. 检查对手路过蜘蛛网线 (Verlet 弹性弦物理弹射 + 切割减速)
    for (let i = webs.length - 1; i >= 0; i--) {
      const w = webs[i];
      if (w.hitCd > 0) continue;
      const spider = w.owner === "A" ? A : B;
      const victim = w.owner === "A" ? B : A;
      if (!victim.alive || victim.webGlobalCd > 0) continue;

      const hit = pointToSegment(victim.x, victim.y, w.x1, w.y1, w.x2, w.y2);
      const hitRadius = BALL_R * victim.bodyScale + 14;
      if (hit.dist <= hitRadius) {
        w.hitCd = 0.72;
        victim.webGlobalCd = 0.32;
        victim.slowTimer = 0.75;
        w.hp -= 1;
        const broken = w.hp <= 0;
        const impactVx = Math.round(victim.vx);
        const impactVy = Math.round(victim.vy);
        if (broken) {
          webs.splice(i, 1);
        } else {
          // 物理弹性弦反弹：未崩断的蛛丝像绷紧的橡皮筋一样将猎物弹向法线方向
          const sdx = w.x2 - w.x1;
          const sdy = w.y2 - w.y1;
          const slen = Math.max(1, Math.hypot(sdx, sdy));
          let nx = -sdy / slen;
          let ny = sdx / slen;
          if (victim.vx * nx + victim.vy * ny > 0) {
            nx = -nx;
            ny = -ny;
          }
          [victim.vx, victim.vy] = normalize(
            victim.vx * 0.35 + nx * 380,
            victim.vy * 0.35 + ny * 380,
            effectiveSpeed(victim, spider) * 1.08,
          );
        }
        // 若吸血鬼正钳制蜘蛛掠行时误撞蛛网，蛛网会割伤吸血鬼并削减其钳制时间
        if (victim.latchedTo === spider.cfg.id) {
          victim.latchTimer = Math.max(0, victim.latchTimer - 0.16);
        }
        // 若一拳光头冲撞踩中粘性剧毒蛛丝，蛛网弹性会卸掉其一部分蓄力拳势
        if (victim.ballSkillKind === "one_punch") {
          victim.punchCharge = Math.max(0, victim.punchCharge - 11);
        }
        const webDmg = Math.round(28 + spider.rageStacks * 3.0);
        emit({
          tick,
          t: time,
          type: "webHit",
          webId: w.id,
          id: spider.cfg.id,
          target: victim.cfg.id,
          x: Math.round(hit.cx),
          y: Math.round(hit.cy),
          value: webDmg,
          broken,
          vx: impactVx,
          vy: impactVy,
        });
        const myWebs = webs.filter(item => item.owner === spider.cfg.id).length;
        spider.statLabel = computeSkillBallLabel(spider, myWebs, 0);
        if (applyDamage(spider, victim, webDmg, tick, `蛛丝切割 -${webDmg}`)) break;
      }
    }

    if (!A.alive || !B.alive) break;

    // 5. 更新伴舞大妈分身球移动与围殴碰撞
    if (clones.length > 0) {
      for (const c of clones) {
        c.hitCd = Math.max(0, c.hitCd - DT);
        const foe = c.owner === "A" ? B : A;
        const owner = c.owner === "A" ? A : B;
        const [tvx, tvy] = normalize(foe.x - c.x, foe.y - c.y, 1);
        const [cvx, cvy] = normalize(c.vx, c.vy, 1);
        [c.vx, c.vy] = normalize(cvx * 0.90 + tvx * 0.10, cvy * 0.90 + tvy * 0.10, 420);
        c.x += c.vx * DT;
        c.y += c.vy * DT;
        if (c.x < 48 || c.x > ARENA_W - 48) c.vx *= -1;
        if (c.y < 48 || c.y > ARENA_H - 48) c.vy *= -1;
        c.x = clamp(c.x, 48, ARENA_W - 48);
        c.y = clamp(c.y, 48, ARENA_H - 48);

        const d = Math.hypot(foe.x - c.x, foe.y - c.y);
        if (d <= BALL_R * foe.bodyScale + 36 && c.hitCd <= 0 && foe.alive) {
          c.hitCd = 0.76;
          const [bx, by] = normalize(c.x - foe.x, c.y - foe.y, 435);
          c.vx = bx;
          c.vy = by;
          if (foe.latchedTo === owner.cfg.id) {
            foe.latchTimer = Math.max(0, foe.latchTimer - 0.26);
          }
          if (applyDamage(owner, foe, 21, tick, "伴舞围攻 -21")) break;
        }
      }
      if (tick % MOVE_EVERY === 0) {
        for (const side of ["A", "B"] as Side[]) {
          const sideClones = clones.filter(c => c.owner === side);
          if (sideClones.length > 0) {
            emit({
              tick,
              t: time,
              type: "cloneSync",
              id: side,
              clones: sideClones.map(c => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y) })),
            });
          }
        }
      }
    }

    if (!A.alive || !B.alive) break;

    // 6. 双方主球体近身碰撞与核心技能交互
    const bodyDist = Math.hypot(B.x - A.x, B.y - A.y);
    const minDist = BALL_R * (A.bodyScale + B.bodyScale);

    // 6a. 一拳光头蓄力满 100% 时，近身直接轰出「认真一拳」！
    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;
      if (f.ballSkillKind === "one_punch" && f.punchCharge >= 98 && bodyDist <= minDist + 82 && f.skillCd <= 0) {
        f.punchCharge = 0;
        f.skillCd = 0.86;
        f.action = "skill";
        f.actionTimer = 0.42;
        evolveBall(f, tick);
        const punchDmg = Math.round(86 + f.rageStacks * 9.5);
        emit({
          tick,
          t: time,
          type: "seriousPunch",
          id: f.cfg.id,
          target: foe.cfg.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
          power: f.rageStacks,
        });
        // 将对手以超高速轰飞，触发后续撞墙粉碎
        const [kx, ky] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * 2.65);
        foe.vx = kx;
        foe.vy = ky;
        foe.knockbackTimer = 0.85;
        foe.knockbackFrom = f.cfg.id;
        // 顺带震飞附近的伴舞分身
        for (const c of clones) {
          if (c.owner === foe.cfg.id) {
            const [cx, cy] = normalize(c.x - f.x, c.y - f.y, 580);
            c.vx = cx;
            c.vy = cy;
          }
        }
        if (applyDamage(f, foe, punchDmg, tick, `认真一拳 -${punchDmg}`)) break;
      }
    }

    if (!A.alive || !B.alive) break;

    // 6b. 球体直接碰撞：吸血鬼触发「死死吸附」，或触发蜘蛛剧毒撕咬/肉搏对撞
    if (!A.latchedTo && !B.latchedTo && bodyDist <= minDist + 16) {
      const vamp = A.ballSkillKind === "vampire_latch" ? A : B.ballSkillKind === "vampire_latch" ? B : null;
      const other = vamp === A ? B : A;

      if (vamp && vamp.latchCooldown <= 0) {
        // 触发吸血鬼碰撞钳制吸附！（吸血鬼作为行动主人，双翼与獠牙死死钳住猎物向前掠行撕咬）
        const dur = 1.42 + Math.min(0.95, vamp.rageStacks * 0.16);
        vamp.latchedTo = other.cfg.id;
        vamp.latchTimer = dur;
        vamp.latchTickCd = 0.06;
        vamp.latchAngle = Math.atan2(other.y - vamp.y, other.x - vamp.x);
        [vamp.vx, vamp.vy] = normalize(
          other.x - vamp.x + (rng() - 0.5) * 35,
          other.y - vamp.y + (rng() - 0.5) * 35,
          effectiveSpeed(vamp, other),
        );
        emit({
          tick,
          t: time,
          type: "latchStart",
          id: vamp.cfg.id,
          target: other.cfg.id,
          duration: Number(dur.toFixed(2)),
          x: Math.round(other.x),
          y: Math.round(other.y),
        });
      } else {
        // 普通球体硬碰硬弹开 + 近身撕咬伤害
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.max(0.001, bodyDist);
        const nx = dx / d;
        const ny = dy / d;
        [A.vx, A.vy] = normalize(-nx + (rng() - 0.5) * 0.25, -ny + (rng() - 0.5) * 0.25, effectiveSpeed(A, B) * 1.15);
        [B.vx, B.vy] = normalize(nx + (rng() - 0.5) * 0.25, ny + (rng() - 0.5) * 0.25, effectiveSpeed(B, A) * 1.15);
        const overlap = minDist + 10 - d;
        if (overlap > 0) {
          A.x -= nx * overlap * 0.5;
          A.y -= ny * overlap * 0.5;
          B.x += nx * overlap * 0.5;
          B.y += ny * overlap * 0.5;
        }
        const hitter = A.skillCd <= 0 ? A : B;
        const target = hitter === A ? B : A;
        if (hitter.skillCd <= 0 && target.invulnCd <= 0) {
          hitter.skillCd = 0.38;
          target.invulnCd = 0.22;
          emit({
            tick,
            t: time,
            type: "parry",
            x: Math.round((A.x + B.x) * 0.5),
            y: Math.round((A.y + B.y) * 0.5),
            combo: 1,
          });
          // 蜘蛛近身碰撞时顺势吐出一根封路蛛丝
          if (hitter.ballSkillKind === "spider_web") {
            spawnSpiderWeb(hitter, tick, hitter.lastAnchorX, hitter.lastAnchorY, hitter.x, hitter.y);
          }
          if (applyDamage(hitter, target, 40 + hitter.rageStacks * 4, tick)) break;
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
          latchedTo: f.latchedTo,
          punchCharge: Math.round(f.punchCharge),
          slowed: f.slowTimer > 0,
          vx: Math.round(f.vx),
          vy: Math.round(f.vy),
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

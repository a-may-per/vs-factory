// duel 战斗模拟器：竖屏巨型擂台 + 环绕进化武器碰撞系统（Weapon Ball / Earclacks 爽感模型）
// 核心机制：
// 1. 武器拼刀（Blade vs Blade）：双方旋转武器碰撞触发“弹刀/交锋”，反转旋转方向、短距弹性震开并立刻二次交锋（叮！叮！叮！连弹）。
// 2. 破防命中（Blade vs Body）：武器突破防线斩中对手本体，造成暴击伤害、顿帧击退，并立即触发武器肉眼可见的进化（剑长暴涨 / 转速飙升 / 雷锤分裂 / 巨斧狂化）。
// 3. 向心弹墙与狂暴加速：碰墙反弹自带强向心偏转，杜绝平行死循环；全自动在黄金 15~21s 内迎来满层进化决胜。

export type Side = "A" | "B";
export type CombatMode = "weapon" | "skillball";
export type BallSkillKind =
  | "vampire_latch"
  | "spider_web"
  | "one_punch"
  | "dance_granny"
  | "thunder_rail"
  | "ninja_shuriken"
  | "frost_freeze"
  | "rider_turbo"
  | "alchemist_puddle"
  | "bulldozer_wall"
  | "angler_reel"
  | "courier_box"
  | "billiard_bank"
  | "graffiti_paint"
  | "kebab_skewer"
  | "pinball_bumper"
  | "beyblade_orbit"
  | "fireman_hose"
  | "voodoo_doll"
  | "boxer_rope";
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
      frozen?: boolean;
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
  | { tick: number; t: number; type: "railgunShot"; id: Side; target: Side; x: number; y: number; tx: number; ty: number; power: number }
  | { tick: number; t: number; type: "frostNova"; id: Side; target?: Side; x: number; y: number; maxR: number }
  | { tick: number; t: number; type: "soundWave"; id: Side; x: number; y: number; maxR: number }
  | {
      tick: number;
      t: number;
      type: "ultCast";
      id: Side;
      target: Side;
      kind: BallSkillKind;
      title: string;
      callout: string;
      style: "beam" | "nova" | "rush" | "storm";
      x: number;
      y: number;
      tx: number;
      ty: number;
    }
  | {
      tick: number;
      t: number;
      type: "propHit";
      id: Side;
      target: Side;
      propKind: string;
      x: number;
      y: number;
      tx: number;
      ty: number;
      tag: string;
      value: number;
    }
  | { tick: number; t: number; type: "cloneSync"; id: Side; clones: Array<{ id: number; x: number; y: number }> }
  | { tick: number; t: number; type: "shurikenSync"; id: Side; shurikens: Array<{ id: number; x: number; y: number; angle: number }> }
  | {
      tick: number;
      t: number;
      type: "propSync";
      id: Side;
      props: Array<{ id: number; kind: string; x: number; y: number; r: number; angle?: number; val?: number; tx?: number; ty?: number }>;
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
    const stackSpeedBoost = f.scaleKind === "spin" ? 1 + f.rageStacks * 0.055 : 1 + f.rageStacks * 0.025;
    return f.cfg.speed * Math.min(1.55, stackSpeedBoost);
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
      // 真实镜面反射 + 微量防平行死循环角度扰动
      const spd = currentSpeed(f);
      const [rvx, rvy] = normalize(f.vx, f.vy, 1);
      const [cvx, cvy] = normalize(ARENA_W * 0.5 - f.x, ARENA_H * 0.5 - f.y, 1);
      const mixX = rvx * 0.84 + cvx * 0.16 + (rng() - 0.5) * 0.14;
      const mixY = rvy * 0.84 + cvy * 0.16 + (rng() - 0.5) * 0.14;
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
  frozenTimer: number;
  knockbackTimer: number;
  knockbackFrom: Side | null;
  punchCharge: number;
  webCastCd: number;
  lastAnchorX: number;
  lastAnchorY: number;
  webGlobalCd: number;
  soundWaveCd: number;
  counterCd: number;
  magnetPullCd: number;
  freezeCd: number;
  frozenAtTime: number;
  subHitCd: number;
  lastStandTime: number;
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

interface FlyingShuriken {
  id: number;
  owner: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hitCd: number;
}

interface ArenaProp {
  id: number;
  owner: Side;
  kind:
    | "acid_puddle"
    | "brick_wall"
    | "wrecking_ball"
    | "flying_brick"
    | "fish_hook"
    | "delivery_box"
    | "pool_ball"
    | "paint_splat"
    | "roast_grill"
    | "bumper_peg"
    | "sub_beyblade"
    | "hydrant_jet"
    | "voodoo_effigy"
    | "ring_post";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  val: number;
  hitCd: number;
  tx?: number;
  ty?: number;
}

function computeSkillBallLabel(
  f: SkillBallState,
  webCount: number,
  cloneCount: number,
  shurikenCount = 0,
  propCount = 0,
): string {
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
  if (f.ballSkillKind === "thunder_rail") {
    return `磁炮 ${100 + f.rageStacks * 35}%`;
  }
  if (f.ballSkillKind === "ninja_shuriken") {
    return `飞剑 ×${Math.max(2, shurikenCount)}`;
  }
  if (f.ballSkillKind === "frost_freeze") {
    return `冰封 ${100 + f.rageStacks * 30}%`;
  }
  if (f.ballSkillKind === "rider_turbo") {
    return `时速 ${160 + f.rageStacks * 30}`;
  }
  if (f.ballSkillKind === "alchemist_puddle") {
    return `毒池 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "bulldozer_wall") {
    return `铁球 ${100 + f.rageStacks * 18}%`;
  }
  if (f.ballSkillKind === "angler_reel") {
    return `收线 ${Math.min(100, 30 + f.rageStacks * 10)}%`;
  }
  if (f.ballSkillKind === "courier_box") {
    return `盲盒 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "billiard_bank") {
    return `彩球 ×${Math.max(3, propCount)}`;
  }
  if (f.ballSkillKind === "graffiti_paint") {
    return `涂鸦 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "kebab_skewer") {
    return `火候 ${65 + f.rageStacks * 12}度`;
  }
  if (f.ballSkillKind === "pinball_bumper") {
    return `弹柱 ×${Math.max(3, propCount)}`;
  }
  if (f.ballSkillKind === "beyblade_orbit") {
    return `转速 ${220 + f.rageStacks * 45}%`;
  }
  if (f.ballSkillKind === "fireman_hose") {
    return `水压 ${110 + f.rageStacks * 30}%`;
  }
  if (f.ballSkillKind === "voodoo_doll") {
    return `草人 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "boxer_rope") {
    return `重拳 ${115 + f.rageStacks * 35}%`;
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
  let nextShurikenId = 1;
  let nextPropId = 1;
  const webs: ActiveWeb[] = [];
  const clones: DancerClone[] = [];
  const shurikens: FlyingShuriken[] = [];
  const props: ArenaProp[] = [];

  const makeBall = (cfg: FighterConfig, x: number, y: number, tx: number, ty: number): SkillBallState => {
    const isA = cfg.id === "A";
    const ballSkillKind: BallSkillKind = cfg.ballSkillKind ?? (isA ? "vampire_latch" : "spider_web");
    const baseSpd = Math.max(465, cfg.speed * 1.50);
    const aim = Math.atan2(ty - y, tx - x) + (rng() - 0.5) * 0.06;
    const [vx, vy] = normalize(Math.cos(aim), Math.sin(aim), baseSpd * 1.18);
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
      latchCooldown: 0,
      latchAngle: isA ? 0 : Math.PI,
      slowTimer: 0,
      frozenTimer: 0,
      knockbackTimer: 0,
      knockbackFrom: null,
      punchCharge: ballSkillKind === "one_punch" ? 95 : ballSkillKind === "thunder_rail" ? 92 : 0,
      webCastCd: 0.08,
      lastAnchorX: x,
      lastAnchorY: y,
      webGlobalCd: 0,
      soundWaveCd: 0.22,
      counterCd: 0,
      magnetPullCd: 0.35,
      freezeCd: 0.25,
      frozenAtTime: -10,
      subHitCd: 0,
      lastStandTime: 0,
    };
    st.statLabel = computeSkillBallLabel(
      st,
      ballSkillKind === "spider_web" ? 3 : 0,
      ballSkillKind === "dance_granny" ? 2 : 0,
      ballSkillKind === "ninja_shuriken" ? 2 : 0,
    );
    return st;
  };

  const A = makeBall(cfgA, ARENA_W * 0.28, ARENA_H * 0.43, ARENA_W * 0.52, ARENA_H * 0.51);
  const B = makeBall(cfgB, ARENA_W * 0.72, ARENA_H * 0.57, ARENA_W * 0.48, ARENA_H * 0.49);

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

  // 开局钩子预设：蜘蛛王自带 3 根交叉初始蛛丝，广场舞老太自带 2 名伴舞大妈分身，开打第 1 秒即满屏高能！
  for (const f of [A, B]) {
    if (f.ballSkillKind === "spider_web") {
      const initWebs: Array<[number, number, number, number]> = [
        [ARENA_W * 0.14, ARENA_H * 0.68, ARENA_W * 0.84, ARENA_H * 0.32],
        [ARENA_W * 0.18, ARENA_H * 0.28, ARENA_W * 0.80, ARENA_H * 0.72],
        [ARENA_W * 0.50, ARENA_H * 0.16, ARENA_W * 0.50, ARENA_H * 0.84],
      ];
      for (const [x1, y1, x2, y2] of initWebs) {
        const w: ActiveWeb = {
          id: nextWebId++,
          owner: f.cfg.id,
          x1: Math.round(x1),
          y1: Math.round(y1),
          x2: Math.round(x2),
          y2: Math.round(y2),
          hp: 999,
          hitCd: 0.12,
        };
        webs.push(w);
        emit({ tick: 1, t: 0.02, type: "webSpawn", webId: w.id, id: f.cfg.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
      }
    } else if (f.ballSkillKind === "dance_granny") {
      for (let k = 0; k < 2; k++) {
        const ang = (k === 0 ? -0.9 : 0.9) + (f.cfg.id === "A" ? 0 : Math.PI);
        clones.push({
          id: nextCloneId++,
          owner: f.cfg.id,
          x: Math.round(clamp(f.x + Math.cos(ang) * 96, 60, ARENA_W - 60)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 96, 60, ARENA_H - 60)),
          vx: Math.cos(ang) * 430,
          vy: Math.sin(ang) * 430,
          hitCd: 0.18,
        });
      }
      const sideClones = clones.filter(c => c.owner === f.cfg.id);
      emit({
        tick: 1,
        t: 0.02,
        type: "cloneSync",
        id: f.cfg.id,
        clones: sideClones.map(c => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y) })),
      });
    } else if (f.ballSkillKind === "ninja_shuriken") {
      for (let k = 0; k < 2; k++) {
        const ang = (k === 0 ? -0.65 : 0.65) + (f.cfg.id === "A" ? 0 : Math.PI);
        shurikens.push({
          id: nextShurikenId++,
          owner: f.cfg.id,
          x: Math.round(clamp(f.x + Math.cos(ang) * 105, 58, ARENA_W - 58)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 105, 58, ARENA_H - 58)),
          vx: Math.cos(ang) * 515,
          vy: Math.sin(ang) * 515,
          angle: k * 1.5,
          hitCd: 0.14,
        });
      }
      const sideShurikens = shurikens.filter(s => s.owner === f.cfg.id);
      emit({
        tick: 1,
        t: 0.02,
        type: "shurikenSync",
        id: f.cfg.id,
        shurikens: sideShurikens.map(s => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), angle: Number(s.angle.toFixed(2)) })),
      });
    } else if (f.ballSkillKind === "alchemist_puddle") {
      for (let k = 0; k < 2; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "acid_puddle",
          x: Math.round(ARENA_W * (k === 0 ? 0.32 : 0.68)),
          y: Math.round(ARENA_H * (k === 0 ? 0.34 : 0.66)),
          vx: 0,
          vy: 0,
          r: 68,
          angle: 0,
          val: 3,
          hitCd: 0.12,
        });
      }
    } else if (f.ballSkillKind === "bulldozer_wall") {
      // 暴走拆迁队：自带1颗重型锁链拆迁大铁球环绕甩动 + 场内3堵钢筋红砖墙！
      const initAng = f.cfg.id === "A" ? 0.35 : Math.PI + 0.35;
      props.push({
        id: nextPropId++,
        owner: f.cfg.id,
        kind: "wrecking_ball",
        x: Math.round(f.x + Math.cos(initAng) * 148),
        y: Math.round(f.y + Math.sin(initAng) * 148),
        vx: 0,
        vy: 0,
        r: 42,
        angle: initAng,
        val: 1,
        hitCd: 0.12,
        tx: Math.round(f.x),
        ty: Math.round(f.y),
      });
      const wallCoords: Array<[number, number]> = [
        [ARENA_W * 0.50, ARENA_H * 0.30],
        [ARENA_W * 0.36, ARENA_H * 0.66],
        [ARENA_W * 0.64, ARENA_H * 0.66],
      ];
      for (const [wx, wy] of wallCoords) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "brick_wall",
          x: Math.round(wx),
          y: Math.round(wy),
          vx: 0,
          vy: 0,
          r: 48,
          angle: 0,
          val: 2,
          hitCd: 0.12,
        });
      }
    } else if (f.ballSkillKind === "angler_reel") {
      const foe = f === A ? B : A;
      for (let k = 0; k < 2; k++) {
        const ang = Math.atan2(foe.y - f.y, foe.x - f.x) + (k === 0 ? -0.28 : 0.28);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "fish_hook",
          x: Math.round(f.x + Math.cos(ang) * 140),
          y: Math.round(f.y + Math.sin(ang) * 140),
          vx: Math.cos(ang) * 550,
          vy: Math.sin(ang) * 550,
          r: 42,
          angle: ang,
          val: k + 1,
          hitCd: 0.14,
          tx: Math.round(f.x),
          ty: Math.round(f.y),
        });
      }
    } else if (f.ballSkillKind === "courier_box") {
      for (let k = 0; k < 3; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "delivery_box",
          x: Math.round(ARENA_W * (0.28 + k * 0.22)),
          y: Math.round(ARENA_H * (k % 2 === 0 ? 0.34 : 0.66)),
          vx: 0,
          vy: 0,
          r: 42,
          angle: 0,
          val: k % 2,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "billiard_bank") {
      for (let k = 0; k < 3; k++) {
        const ang = (k * Math.PI * 2) / 3 + 0.4;
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "pool_ball",
          x: Math.round(ARENA_W * 0.5 + Math.cos(ang) * 165),
          y: Math.round(ARENA_H * 0.5 + Math.sin(ang) * 185),
          vx: Math.cos(ang + 1.2) * 460,
          vy: Math.sin(ang + 1.2) * 460,
          r: 34,
          angle: 0,
          val: k + 1,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "graffiti_paint") {
      for (let k = 0; k < 2; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "paint_splat",
          x: Math.round(ARENA_W * (k === 0 ? 0.34 : 0.66)),
          y: Math.round(ARENA_H * (k === 0 ? 0.64 : 0.36)),
          vx: 0,
          vy: 0,
          r: 76,
          angle: k * 1.1,
          val: k,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "kebab_skewer") {
      for (let k = 0; k < 2; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "roast_grill",
          x: Math.round(ARENA_W * (k === 0 ? 0.35 : 0.65)),
          y: Math.round(ARENA_H * 0.5),
          vx: 0,
          vy: 0,
          r: 54,
          angle: 0,
          val: 1,
          hitCd: 0.16,
        });
      }
    } else if (f.ballSkillKind === "pinball_bumper") {
      const coords: Array<[number, number]> = [
        [ARENA_W * 0.5, ARENA_H * 0.33],
        [ARENA_W * 0.34, ARENA_H * 0.62],
        [ARENA_W * 0.66, ARENA_H * 0.62],
      ];
      for (let k = 0; k < coords.length; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "bumper_peg",
          x: Math.round(coords[k][0]),
          y: Math.round(coords[k][1]),
          vx: 0,
          vy: 0,
          r: 48,
          angle: 0,
          val: k + 1,
          hitCd: 0.1,
        });
      }
    } else if (f.ballSkillKind === "beyblade_orbit") {
      for (let k = 0; k < 2; k++) {
        const ang = k * Math.PI + 0.5;
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "sub_beyblade",
          x: Math.round(clamp(f.x + Math.cos(ang) * 120, 60, ARENA_W - 60)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 120, 60, ARENA_H - 60)),
          vx: Math.cos(ang + 1.4) * 510,
          vy: Math.sin(ang + 1.4) * 510,
          r: 32,
          angle: 0,
          val: k + 1,
          hitCd: 0.14,
          tx: Math.round(f.x),
          ty: Math.round(f.y),
        });
      }
    } else if (f.ballSkillKind === "fireman_hose") {
      for (let k = 0; k < 2; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "hydrant_jet",
          x: Math.round(ARENA_W * (k === 0 ? 0.22 : 0.78)),
          y: Math.round(ARENA_H * (k === 0 ? 0.30 : 0.70)),
          vx: 0,
          vy: 0,
          r: 42,
          angle: 0,
          val: 1,
          hitCd: 0.18,
        });
      }
    } else if (f.ballSkillKind === "voodoo_doll") {
      const foe = f === A ? B : A;
      for (let k = 0; k < 2; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "voodoo_effigy",
          x: Math.round(ARENA_W * (k === 0 ? 0.34 : 0.66)),
          y: Math.round(ARENA_H * (k === 0 ? 0.34 : 0.66)),
          vx: 0,
          vy: 0,
          r: 46,
          angle: 0,
          val: 1,
          hitCd: 0.16,
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
        });
      }
    } else if (f.ballSkillKind === "boxer_rope") {
      const posts: Array<[number, number]> = [
        [ARENA_W * 0.16, ARENA_H * 0.24],
        [ARENA_W * 0.84, ARENA_H * 0.24],
        [ARENA_W * 0.16, ARENA_H * 0.76],
        [ARENA_W * 0.84, ARENA_H * 0.76],
      ];
      for (let k = 0; k < posts.length; k++) {
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "ring_post",
          x: Math.round(posts[k][0]),
          y: Math.round(posts[k][1]),
          vx: 0,
          vy: 0,
          r: 42,
          angle: 0,
          val: k + 1,
          hitCd: 0.12,
        });
      }
    }
    const sideProps = props.filter(p => p.owner === f.cfg.id);
    if (sideProps.length > 0) {
      emit({
        tick: 1,
        t: 0.02,
        type: "propSync",
        id: f.cfg.id,
        props: sideProps.map(p => ({
          id: p.id,
          kind: p.kind,
          x: Math.round(p.x),
          y: Math.round(p.y),
          r: p.r,
          angle: Number(p.angle.toFixed(2)),
          val: p.val,
          tx: p.tx,
          ty: p.ty,
        })),
      });
    }
  }

  let timeSinceAction = 0;

  function effectiveSpeed(f: SkillBallState, foe: SkillBallState): number {
    // 恒定物理基准球速（砍掉随时间全局暴涨的 timeBoost，仅速度型技能或受击击退改变瞬时速度）
    let mul = 1 + f.rageStacks * 0.018;
    if (f.ballSkillKind === "rider_turbo") {
      mul *= 1.08 + f.rageStacks * 0.042;
    }
    if (f.knockbackTimer > 0) mul *= 1.85;
    else if (f.latchedTo) mul *= 1.05;
    else if (f.slowTimer > 0) mul *= 0.64;
    return f.cfg.speed * clamp(mul, 0.55, 2.15);
  }

  function evolveBall(f: SkillBallState, tick: number) {
    f.rageStacks = Math.min(12, f.rageStacks + 1);
    if (
      f.ballSkillKind === "one_punch" ||
      f.ballSkillKind === "vampire_latch" ||
      f.ballSkillKind === "thunder_rail" ||
      f.ballSkillKind === "rider_turbo"
    ) {
      f.bodyScale = Math.min(1.26, 1.08 + f.rageStacks * 0.016);
    }
    const myWebs = webs.filter(w => w.owner === f.cfg.id).length;
    const myClones = clones.filter(c => c.owner === f.cfg.id).length;
    const myShurikens = shurikens.filter(s => s.owner === f.cfg.id).length;
    const myProps = props.filter(p => p.owner === f.cfg.id && p.kind !== "flying_brick").length;
    f.statLabel = computeSkillBallLabel(f, myWebs, myClones, myShurikens, myProps);
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
    _isFinisherEligible = true,
  ): boolean {
    if (!target.alive) return true;
    // 100% 真实物理扣血 + 格斗逆风怒气机制（落后方凭血差激发潜能增伤，领先方抑制无脑滚雪球，杜绝满血吊打与假锁血）
    const attackerHpPct = attacker.hp / Math.max(1, attacker.cfg.maxHp);
    const targetHpPct = target.hp / Math.max(1, target.cfg.maxHp);
    const hpDiff = targetHpPct - attackerHpPct; // >0 表示攻击方处于逆风劣势，<0 表示攻击方处于顺风领先
    const comebackMul =
      hpDiff >= 0
        ? 1 + Math.min(0.88, hpDiff * 1.18)
        : Math.max(0.76, 1 + hpDiff * 0.44);
    let finalRawDmg = rawDmg * comebackMul;
    let tagPrefix = tag ? tag.replace(/\s*-\d+$/, "") : "";
    // 急冻冰霜王：对手被冻结后被物理冲撞触发「破冰重击」
    if (
      target.frozenTimer > 0 &&
      time - target.frozenAtTime >= 0.22 &&
      attacker.ballSkillKind === "frost_freeze" &&
      (!tag || !tag.includes("冰霜冻结"))
    ) {
      target.frozenTimer = 0;
      finalRawDmg = finalRawDmg * 1.22;
      tagPrefix = "破冰重击";
      const frostHeal = 10 + attacker.rageStacks * 0.9;
      attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + frostHeal);
      emit({
        tick,
        t: time,
        type: "heal",
        id: attacker.cfg.id,
        value: Math.round(frostHeal),
        hp: attacker.hp,
        text: `破冰重击 +${Math.round(frostHeal)}`,
        x: Math.round(attacker.x),
        y: Math.round(attacker.y),
      });
    }

    // 100% 物理触发觉醒大招 (ultCast)：当蓄力满 95%+ 且本体或召唤物真实命中对手时，引爆全场召唤物协同大招！
    const ultExcluded =
      attacker.ballSkillKind === "one_punch" ||
      attacker.ballSkillKind === "thunder_rail" ||
      attacker.ballSkillKind === "frost_freeze" ||
      attacker.ballSkillKind === "dance_granny" ||
      attacker.ballSkillKind === "vampire_latch";
    if (
      !ultExcluded &&
      attacker.punchCharge >= 95 &&
      !tagPrefix.includes("撞墙粉碎") &&
      !tagPrefix.includes("碰瓷反伤")
    ) {
      attacker.punchCharge = 0;
      attacker.action = "skill";
      attacker.actionTimer = 0.42;
      evolveBall(attacker, tick);
      finalRawDmg = finalRawDmg * 1.26 + 10;

      let ultTitle = `${attacker.cfg.active.name}!!`;
      let ultStyle: "beam" | "nova" | "rush" | "storm" = "nova";
      let ultCallout = `★ ${attacker.cfg.name} 蓄力满载 · 释放「${attacker.cfg.active.name}」 ★`;
      const kind = attacker.ballSkillKind;
      if (kind === "alchemist_puddle") {
        ultTitle = "绝命毒爆!!";
        ultStyle = "nova";
        tagPrefix = "绝命毒爆";
        ultCallout = `★ ${attacker.cfg.name} 引爆全场毒池 · 「绝命毒爆」剧毒蚀骨 ★`;
        target.slowTimer = Math.max(target.slowTimer, 1.05);
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "acid_puddle") p.r = Math.min(92, p.r + 8);
        }
      } else if (kind === "bulldozer_wall") {
        ultTitle = "百吨破墙锤!!";
        ultStyle = "rush";
        tagPrefix = "百吨破墙锤";
        ultCallout = `★ ${attacker.cfg.name} 铁球满载 · 「百吨破墙锤」轰飞对手 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.65);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.44;
        target.knockbackFrom = attacker.cfg.id;
      } else if (kind === "angler_reel") {
        ultTitle = "深海巨鲨咬!!";
        ultStyle = "rush";
        tagPrefix = "巨鲨咬杀";
        ultCallout = `★ ${attacker.cfg.name} 暴力收线 · 「深海巨鲨咬」吞噬猎物 ★`;
        const [pvx, pvy] = normalize(attacker.x - target.x, attacker.y - target.y, effectiveSpeed(target, attacker) * 1.50);
        target.vx = pvx;
        target.vy = pvy;
      } else if (kind === "courier_box") {
        ultTitle = "使命必达!!";
        ultStyle = "rush";
        tagPrefix = "使命必达";
        ultCallout = `★ ${attacker.cfg.name} 超时狂飙 · 「使命必达」全速冲撞 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.48);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.28;
      } else if (kind === "billiard_bank") {
        ultTitle = "一杆清台!!";
        ultStyle = "beam";
        tagPrefix = "一杆清台";
        ultCallout = `★ ${attacker.cfg.name} 激光制导 · 「一杆清台」彩球齐射 ★`;
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "pool_ball") {
            const [bvx, bvy] = normalize(target.x - p.x, target.y - p.y, 550);
            p.vx = bvx;
            p.vy = bvy;
          }
        }
      } else if (kind === "graffiti_paint") {
        ultTitle = "颜料巨浪!!";
        ultStyle = "nova";
        tagPrefix = "颜料巨浪";
        ultCallout = `★ ${attacker.cfg.name} 唤醒街头涂鸦 · 「颜料巨浪」席卷全场 ★`;
        target.slowTimer = Math.max(target.slowTimer, 1.05);
      } else if (kind === "kebab_skewer") {
        ultTitle = "孜然烈焰!!";
        ultStyle = "storm";
        tagPrefix = "孜然烈焰";
        ultCallout = `★ ${attacker.cfg.name} 炭火全开 · 「孜然烈焰」穿串炙烤 ★`;
        const heal = 16;
        attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + heal);
        emit({ tick, t: time, type: "heal", id: attacker.cfg.id, value: heal, hp: attacker.hp, text: `烈焰回血 +${heal}`, x: Math.round(attacker.x), y: Math.round(attacker.y) });
      } else if (kind === "pinball_bumper") {
        ultTitle = "777大奖暴走!!";
        ultStyle = "beam";
        tagPrefix = "大奖暴走";
        ultCallout = `★ ${attacker.cfg.name} 触发 777 大奖 · 全场弹柱高压放电 ★`;
      } else if (kind === "beyblade_orbit") {
        ultTitle = "双星龙卷风!!";
        ultStyle = "storm";
        tagPrefix = "双星龙卷";
        ultCallout = `★ ${attacker.cfg.name} 母子陀螺合围 · 「双星龙卷风」绞杀 ★`;
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "sub_beyblade") {
            const [bvx, bvy] = normalize(target.x - p.x, target.y - p.y, 560);
            p.vx = bvx;
            p.vy = bvy;
          }
        }
      } else if (kind === "fireman_hose") {
        ultTitle = "百吨水炮!!";
        ultStyle = "beam";
        tagPrefix = "百吨水炮";
        ultCallout = `★ ${attacker.cfg.name} 水压拉满 · 「百吨水炮」轰飞敌军 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.52);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.30;
      } else if (kind === "voodoo_doll") {
        ultTitle = "百针连心咒!!";
        ultStyle = "beam";
        tagPrefix = "百针咒杀";
        ultCallout = `★ ${attacker.cfg.name} 刺穿替身草人 · 「百针连心咒」隔空暴击 ★`;
        const heal = 18;
        attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + heal);
        emit({ tick, t: time, type: "heal", id: attacker.cfg.id, value: heal, hp: attacker.hp, text: `咒杀汲取 +${heal}`, x: Math.round(attacker.x), y: Math.round(attacker.y) });
      } else if (kind === "boxer_rope") {
        ultTitle = "冠军重勾拳!!";
        ultStyle = "rush";
        tagPrefix = "冠军重拳";
        ultCallout = `★ ${attacker.cfg.name} 边绳借力 · 「冠军重勾拳」轰飞撞墙 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.78);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.48;
        target.knockbackFrom = attacker.cfg.id;
      } else if (kind === "rider_turbo") {
        ultTitle = "超音速冲撞!!";
        ultStyle = "rush";
        tagPrefix = "飞箱暴击";
        ultCallout = `★ ${attacker.cfg.name} 氮气全开 · 「超音速冲撞」轰飞撞墙 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.75);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.46;
        target.knockbackFrom = attacker.cfg.id;
      } else if (kind === "ninja_shuriken") {
        ultTitle = "万剑归宗!!";
        ultStyle = "storm";
        tagPrefix = "万剑归宗";
        ultCallout = `★ ${attacker.cfg.name} 结印御剑 · 「万剑归宗」飞剑齐射 ★`;
        for (const s of shurikens) {
          if (s.owner === attacker.cfg.id) {
            const [svx, svy] = normalize(target.x - s.x, target.y - s.y, 560);
            s.vx = svx;
            s.vy = svy;
          }
        }
      } else if (kind === "spider_web") {
        ultTitle = "天罗地网!!";
        ultStyle = "storm";
        tagPrefix = "天罗地网";
        ultCallout = `★ ${attacker.cfg.name} 毒丝收网 · 「天罗地网」剧毒绞杀 ★`;
        target.slowTimer = Math.max(target.slowTimer, 1.05);
      }

      emit({
        tick,
        t: time,
        type: "ultCast",
        id: attacker.cfg.id,
        target: target.cfg.id,
        kind: attacker.ballSkillKind,
        title: ultTitle,
        callout: ultCallout,
        style: ultStyle,
        x: Math.round(attacker.x),
        y: Math.round(attacker.y),
        tx: Math.round(target.x),
        ty: Math.round(target.y),
      });
    }

    const dmg = Math.max(1, Math.round(finalRawDmg));
    target.hp -= dmg;

    // 受击激怒充能机制：挨打方（尤其是一拳光头/拳击手/黄骑士等肉搏角色）受击时激怒蓄力，落后层数时自动追赶进化！
    const chargeGain =
      target.ballSkillKind === "one_punch"
        ? 11
        : target.ballSkillKind === "boxer_rope" || target.ballSkillKind === "rider_turbo"
          ? 7
          : 4;
    target.punchCharge = Math.min(100, target.punchCharge + chargeGain);
    if (
      (target.ballSkillKind === "one_punch" ||
        target.ballSkillKind === "boxer_rope" ||
        target.ballSkillKind === "rider_turbo") &&
      target.rageStacks + 2 < attacker.rageStacks
    ) {
      evolveBall(target, tick);
    }

    const finalTag = tagPrefix ? `${tagPrefix} -${dmg}` : undefined;
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
      tag: finalTag,
    });

    // 暗影忍者王受重击时触发「替身闪避」：瞬移闪现至对手身后回血并甩出一枚反击手里剑！
    if (
      target.alive &&
      target.hp > 0 &&
      target.ballSkillKind === "ninja_shuriken" &&
      dmg >= 46 &&
      target.counterCd <= 0 &&
      attacker.alive
    ) {
      target.counterCd = 2.05;
      const heal = Math.round(24 + target.rageStacks * 2.0);
      target.hp = Math.min(target.cfg.maxHp, target.hp + heal);
      target.frozenTimer = 0;
      const blinkAng = Math.atan2(target.y - attacker.y, target.x - attacker.x) + Math.PI * 0.78;
      target.x = clamp(attacker.x + Math.cos(blinkAng) * 185, 80, ARENA_W - 80);
      target.y = clamp(attacker.y + Math.sin(blinkAng) * 185, 80, ARENA_H - 80);
      emit({
        tick,
        t: time,
        type: "heal",
        id: target.cfg.id,
        value: heal,
        hp: target.hp,
        text: `替身闪避 +${heal}`,
        x: Math.round(target.x),
        y: Math.round(target.y),
      });
      const myShurikens = shurikens.filter(s => s.owner === target.cfg.id);
      if (myShurikens.length < 7) {
        const [svx, svy] = normalize(attacker.x - target.x, attacker.y - target.y, 550);
        shurikens.push({
          id: nextShurikenId++,
          owner: target.cfg.id,
          x: Math.round(target.x),
          y: Math.round(target.y),
          vx: svx,
          vy: svy,
          angle: 0,
          hitCd: 0.1,
        });
        target.statLabel = computeSkillBallLabel(target, 0, 0, myShurikens.length + 1);
      }
    }

    // 广场舞老太受重击时触发「太极碰瓷反伤」
    if (
      target.alive &&
      target.hp > 0 &&
      target.ballSkillKind === "dance_granny" &&
      dmg >= 68 &&
      target.counterCd <= 0 &&
      attacker.alive
    ) {
      target.counterCd = 2.45;
      const reflect = Math.round(dmg * 0.25);
      const heal = Math.round(16 + target.rageStacks * 1.4);
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
    if (webs.length >= 10) {
      webs.shift();
    }
    const w: ActiveWeb = {
      id: nextWebId++,
      owner: spider.cfg.id,
      x1: Math.round(x1),
      y1: Math.round(y1),
      x2: Math.round(x2),
      y2: Math.round(y2),
      hp: 4, // 蛛丝具备 4 次高弹切割韧性，被冲断后由蜘蛛弹墙继续补网
      hitCd: 0.24,
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
      f.frozenTimer = Math.max(0, f.frozenTimer - DT);
      f.magnetPullCd = Math.max(0, f.magnetPullCd - DT);
      f.freezeCd = Math.max(0, f.freezeCd - DT);
      f.subHitCd = Math.max(0, f.subHitCd - DT);

      if (f.ballSkillKind === "one_punch") {
        f.punchCharge = Math.min(100, f.punchCharge + 31 * DT);
      } else if (f.ballSkillKind === "thunder_rail") {
        f.punchCharge = Math.min(100, f.punchCharge + 22 * DT);
      } else if (f.ballSkillKind === "rider_turbo") {
        f.punchCharge = Math.min(100, f.punchCharge + 20 * DT);
      } else if (
        f.ballSkillKind !== "vampire_latch" &&
        f.ballSkillKind !== "dance_granny" &&
        f.ballSkillKind !== "frost_freeze"
      ) {
        f.punchCharge = Math.min(100, f.punchCharge + 8.5 * DT);
      }

      // 0a. 若当前角色被急冻冰霜王「绝对零度」冻结在冰块中，原地定身无法移动！
      if (f.frozenTimer > 0) {
        f.action = "hit";
        continue;
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
        } else if (f.ballSkillKind === "frost_freeze" && f.freezeCd <= 0) {
          // 急冻冰霜王被吸血鬼钳制时释放极寒冰封，大幅削减吸血鬼钳制时间并触发冰封反制！
          f.freezeCd = Math.max(1.48, 1.96 - f.rageStacks * 0.05);
          const maxR = 325 + f.rageStacks * 18;
          emit({ tick, t: time, type: "frostNova", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
          foe.latchTimer = Math.max(0, foe.latchTimer - 0.96);
          if (foe.latchTimer <= 0.12) {
            foe.latchedTo = null;
            foe.latchCooldown = 1.42;
            emit({ tick, t: time, type: "latchEnd", id: foe.cfg.id, x: Math.round(foe.x), y: Math.round(foe.y) });
            foe.frozenTimer = 0.62;
            foe.frozenAtTime = time;
            foe.slowTimer = 1.18;
          }
          evolveBall(f, tick);
          const frostDmg = Math.round(31 + f.rageStacks * 3.1);
          if (applyDamage(f, foe, frostDmg, tick, `冰霜冻结 -${frostDmg}`, false)) break;
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
          f.latchTickCd = 0.31;
          const biteDmg = Math.round(23 + f.rageStacks * 2.6);
          const healVal = Math.round(11 + f.rageStacks * 1.2);
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
          f.latchCooldown = 1.62;
          emit({ tick, t: time, type: "latchEnd", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
          const dx = foe.x - f.x;
          const dy = foe.y - f.y;
          // 吸血结束瞬间，吸血鬼将猎物狠狠甩飞出去，自身后空翻拉开身位
          [foe.vx, foe.vy] = normalize(dx, dy, effectiveSpeed(foe, f) * 1.28);
          [f.vx, f.vy] = normalize(-dx, -dy, effectiveSpeed(f, foe) * 1.15);
        }
        continue;
      }

      // 2. 真实直线弹道物理（一拳光头蓄满认真冲刺或肉搏英雄突进时微弱校准方向，防平行死循环）
      if (
        (f.ballSkillKind === "one_punch" && f.punchCharge >= 95) ||
        (timeSinceAction > 1.6 && f.knockbackTimer <= 0)
      ) {
        const steer = f.ballSkillKind === "one_punch" && f.punchCharge >= 95 ? 0.04 : 0.06;
        if (f.ballSkillKind === "one_punch" && f.punchCharge >= 95) {
          f.slowTimer = 0; // 认真一拳满蓄力突进时无视减速泥潭
        }
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const [cvx, cvy] = normalize(f.vx, f.vy, 1);
        [f.vx, f.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, effectiveSpeed(f, foe));
      } else {
        [f.vx, f.vy] = normalize(f.vx, f.vy, effectiveSpeed(f, foe));
      }

      f.x += f.vx * DT;
      f.y += f.vy * DT;
      f.facing = f.vx >= 0 ? 1 : -1;

      // 3. 墙壁镜面反弹与特殊弹墙技能触发
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
        // 真实镜面反射 + 18% 向场心微偏转与微小随机角，避免贴墙平行死循环
        const [rvx, rvy] = normalize(f.vx, f.vy, 1);
        const [cvx, cvy] = normalize(ARENA_W * 0.5 - f.x, ARENA_H * 0.5 - f.y, 1);
        [f.vx, f.vy] = normalize(
          rvx * 0.82 + cvx * 0.18 + (rng() - 0.5) * 0.16,
          rvy * 0.82 + cvy * 0.18 + (rng() - 0.5) * 0.16,
          effectiveSpeed(f, foe),
        );
        emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });

        // 蜘蛛王：每次弹墙直接吐丝拉网！
        if (f.ballSkillKind === "spider_web" && f.webCastCd <= 0) {
          spawnSpiderWeb(f, tick, f.lastAnchorX, f.lastAnchorY, f.x, f.y);
        }

        // 一拳光头 / 雷电磁暴王 / 急冻冰霜王：弹墙蓄力
        if (f.ballSkillKind === "one_punch") {
          f.punchCharge = Math.min(100, f.punchCharge + 24);
        } else if (f.ballSkillKind === "thunder_rail") {
          f.punchCharge = Math.min(100, f.punchCharge + 16);
        } else if (f.ballSkillKind === "frost_freeze") {
          f.punchCharge = Math.min(100, f.punchCharge + 28);
          f.statLabel = computeSkillBallLabel(f, 0, 0, 0);
        }

        // 暗影忍者王：弹墙发射旋转手里剑（最多同时在场 8 枚，平滑递增）
        if (f.ballSkillKind === "ninja_shuriken") {
          const myShurikens = shurikens.filter(s => s.owner === f.cfg.id);
          if (myShurikens.length < 8 && (myShurikens.length < 3 || tick % 2 === 0)) {
            const [svx, svy] = normalize(
              foe.x - f.x + (rng() - 0.5) * 90,
              foe.y - f.y + (rng() - 0.5) * 90,
              525,
            );
            shurikens.push({
              id: nextShurikenId++,
              owner: f.cfg.id,
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: svx,
              vy: svy,
              angle: rng() * Math.PI,
              hitCd: 0.16,
            });
            evolveBall(f, tick);
          } else {
            f.statLabel = computeSkillBallLabel(f, 0, 0, myShurikens.length);
          }
        }

        // 极速黄骑士：每次弹墙蓄满氮气尾焰并加速
        if (f.ballSkillKind === "rider_turbo") {
          f.punchCharge = Math.min(100, f.punchCharge + 24);
        }

        // 12 位新机制英雄弹墙布景与充能：
        const myProps = props.filter(p => p.owner === f.cfg.id);
        if (f.ballSkillKind === "alchemist_puddle") {
          f.punchCharge = Math.min(100, f.punchCharge + 7);
          for (const p of myProps) {
            if (p.kind === "acid_puddle") p.r = Math.min(86, p.r + 3);
          }
          if (myProps.length < 4) {
            // 分散泼洒毒液池，严禁多个毒池重叠在同一个坐标点
            let px = Math.round(clamp(f.x + (ARENA_W * 0.5 - f.x) * 0.5 + (rng() - 0.5) * 260, 130, ARENA_W - 130));
            let py = Math.round(clamp(f.y + (ARENA_H * 0.5 - f.y) * 0.5 + (rng() - 0.5) * 280, 130, ARENA_H - 130));
            for (let tryIdx = 0; tryIdx < 5; tryIdx++) {
              const tooClose = myProps.some(ep => Math.hypot(ep.x - px, ep.y - py) < 185);
              if (!tooClose) break;
              px = Math.round(140 + rng() * (ARENA_W - 280));
              py = Math.round(140 + rng() * (ARENA_H - 280));
            }
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "acid_puddle",
              x: px,
              y: py,
              vx: 0,
              vy: 0,
              r: 68,
              angle: 0,
              val: 3,
              hitCd: 0.22,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "bulldozer_wall") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          const myWalls = myProps.filter(p => p.kind === "brick_wall");
          if (myWalls.length < 4) {
            let wx = Math.round(clamp(f.x + (ARENA_W * 0.5 - f.x) * 0.45 + (rng() - 0.5) * 220, 130, ARENA_W - 130));
            let wy = Math.round(clamp(f.y + (ARENA_H * 0.5 - f.y) * 0.45 + (rng() - 0.5) * 220, 130, ARENA_H - 130));
            for (let tryIdx = 0; tryIdx < 4; tryIdx++) {
              const tooClose = myWalls.some(ew => Math.hypot(ew.x - wx, ew.y - wy) < 160);
              if (!tooClose) break;
              wx = Math.round(150 + rng() * (ARENA_W - 300));
              wy = Math.round(150 + rng() * (ARENA_H - 300));
            }
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "brick_wall",
              x: wx,
              y: wy,
              vx: 0,
              vy: 0,
              r: 48,
              angle: 0,
              val: 2,
              hitCd: 0.16,
            });
          }
        } else if (f.ballSkillKind === "angler_reel") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 3) {
            const ang = Math.atan2(foe.y - f.y, foe.x - f.x) + (rng() - 0.5) * 0.35;
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "fish_hook",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: Math.cos(ang) * 545,
              vy: Math.sin(ang) * 545,
              r: 40,
              angle: ang,
              val: myProps.length + 1,
              hitCd: 0.18,
              tx: Math.round(f.x),
              ty: Math.round(f.y),
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "courier_box") {
          f.punchCharge = Math.min(100, f.punchCharge + 7);
          if (myProps.length < 5) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "delivery_box",
              x: Math.round(clamp(f.x + (foe.x - f.x) * 0.28, 100, ARENA_W - 100)),
              y: Math.round(clamp(f.y + (foe.y - f.y) * 0.28, 100, ARENA_H - 100)),
              vx: 0,
              vy: 0,
              r: 42,
              angle: 0,
              val: myProps.length % 2,
              hitCd: 0.20,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "billiard_bank") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 4) {
            const [bvx, bvy] = normalize(foe.x - f.x, foe.y - f.y, 490);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "pool_ball",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: bvx,
              vy: bvy,
              r: 35,
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.16,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "graffiti_paint") {
          f.punchCharge = Math.min(100, f.punchCharge + 7);
          if (myProps.length < 5) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "paint_splat",
              x: Math.round(clamp(f.x + (foe.x - f.x) * 0.34, 110, ARENA_W - 110)),
              y: Math.round(clamp(f.y + (foe.y - f.y) * 0.34, 110, ARENA_H - 110)),
              vx: 0,
              vy: 0,
              r: 72,
              angle: rng() * Math.PI,
              val: 4,
              hitCd: 0.20,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "kebab_skewer") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 4) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "roast_grill",
              x: Math.round(clamp(f.x + (foe.x - f.x) * 0.36, 120, ARENA_W - 120)),
              y: Math.round(clamp(f.y + (foe.y - f.y) * 0.36, 120, ARENA_H - 120)),
              vx: 0,
              vy: 0,
              r: 54,
              angle: 0,
              val: 1,
              hitCd: 0.18,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "pinball_bumper") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 4) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "bumper_peg",
              x: Math.round(clamp(f.x + (foe.x - f.x) * 0.35, 130, ARENA_W - 130)),
              y: Math.round(clamp(f.y + (foe.y - f.y) * 0.35, 130, ARENA_H - 130)),
              vx: 0,
              vy: 0,
              r: 50,
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.12,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "beyblade_orbit") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 3) {
            const [svx, svy] = normalize(foe.x - f.x, foe.y - f.y, 525);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "sub_beyblade",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: svx,
              vy: svy,
              r: 34,
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.16,
              tx: Math.round(f.x),
              ty: Math.round(f.y),
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "fireman_hose") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 3) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "hydrant_jet",
              x: Math.round(clamp(f.x, 85, ARENA_W - 85)),
              y: Math.round(clamp(f.y, 85, ARENA_H - 85)),
              vx: 0,
              vy: 0,
              r: 42,
              angle: 0,
              val: 1,
              hitCd: 0.24,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "voodoo_doll") {
          f.punchCharge = Math.min(100, f.punchCharge + 8);
          if (myProps.length < 3) {
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "voodoo_effigy",
              x: Math.round(ARENA_W * (0.3 + rng() * 0.4)),
              y: Math.round(ARENA_H * (0.3 + rng() * 0.4)),
              vx: 0,
              vy: 0,
              r: 46,
              angle: 0,
              val: 1,
              hitCd: 0.18,
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "boxer_rope") {
          // 弹力拳击手：边绳借力弹弓！每次撞墙以 1.48 倍极速直射对手
          f.punchCharge = Math.min(100, f.punchCharge + 10);
          evolveBall(f, tick);
          const [dvx, dvy] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(f, foe) * 1.48);
          f.vx = dvx;
          f.vy = dvy;
        }

        // 被「认真一拳」、「冠军勾拳」、「飞箱重击」或「超载电磁炮」轰飞期间撞墙：触发单次「撞墙粉碎」二段伤害！
        if (f.knockbackTimer > 0 && f.knockbackFrom) {
          const puncher = f.knockbackFrom === "A" ? A : B;
          f.knockbackFrom = null;
          const slamDmg = Math.round(32 + puncher.rageStacks * 3.0);
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

      // 雷电磁暴王：仅当对手进入可见磁暴电弧圈内时才产生引力拉扯与近距电磁炮轰击（100% 物理范围判定，杜绝全屏隔空锁定扣血）
      if (f.ballSkillKind === "thunder_rail" && foe.alive) {
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        const coilRadius = 235 + f.rageStacks * 10;
        if (distToFoe <= coilRadius && f.magnetPullCd <= 0) {
          f.magnetPullCd = Math.max(1.05, 1.38 - f.rageStacks * 0.04);
          const [pvx, pvy] = normalize(f.x - foe.x, f.y - foe.y, effectiveSpeed(foe, f) * 1.08);
          foe.vx = foe.vx * 0.45 + pvx * 0.55;
          foe.vy = foe.vy * 0.45 + pvy * 0.55;
          const pulseDmg = Math.round(26 + f.rageStacks * 2.5);
          emit({
            tick,
            t: time,
            type: "skill",
            id: f.cfg.id,
            target: foe.cfg.id,
            name: "电磁脉冲",
            x: Math.round(foe.x),
            y: Math.round(foe.y),
            fx: "bolt",
          });
          if (applyDamage(f, foe, pulseDmg, tick, `电磁脉冲 -${pulseDmg}`, false)) break;
        }
        if (f.punchCharge >= 95 && f.skillCd <= 0 && distToFoe <= coilRadius + 20) {
          f.punchCharge = 0;
          f.skillCd = 1.18;
          f.action = "skill";
          f.actionTimer = 0.45;
          evolveBall(f, tick);
          const railDmg = Math.round(64 + f.rageStacks * 6.0);
          emit({
            tick,
            t: time,
            type: "railgunShot",
            id: f.cfg.id,
            target: foe.cfg.id,
            x: Math.round(f.x),
            y: Math.round(f.y),
            tx: Math.round(foe.x),
            ty: Math.round(foe.y),
            power: f.rageStacks,
          });
          const [kx, ky] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * 1.75);
          foe.vx = kx;
          foe.vy = ky;
          foe.knockbackTimer = 0.45;
          foe.knockbackFrom = f.cfg.id;
          if (applyDamage(f, foe, railDmg, tick, `超载电磁炮 -${railDmg}`)) break;
        }
      }

      // 急冻冰霜王：释放「绝对零度」极寒冰环，将对手直接冻结在冰晶方块中定身！
      if (f.ballSkillKind === "frost_freeze" && f.freezeCd <= 0 && foe.alive) {
        const maxR = 320 + f.rageStacks * 16;
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distToFoe <= maxR * 0.94 || time < 1.0) {
          f.freezeCd = Math.max(1.88, 2.38 - f.rageStacks * 0.04);
          f.punchCharge = 0;
          emit({ tick, t: time, type: "frostNova", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
          const freezeDur = 0.66 + Math.min(0.18, f.rageStacks * 0.02);
          foe.frozenTimer = freezeDur;
          foe.frozenAtTime = time;
          foe.slowTimer = foe.ballSkillKind === "rider_turbo" ? 0.78 : 1.12;
          evolveBall(f, tick);
          const [cvx, cvy] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(f, foe) * 1.18);
          f.vx = f.vx * 0.25 + cvx * 0.75;
          f.vy = f.vy * 0.25 + cvy * 0.75;
          const frostDmg = Math.round(28 + f.rageStacks * 2.6);
          if (applyDamage(f, foe, frostDmg, tick, `冰霜冻结 -${frostDmg}`, false)) break;
        }
      }

      // 极速黄骑士：周期性触发「超时冲刺」引擎喷射，瞬间融化减速并向对手发起超音速尾焰冲撞（取消隔空暗扣血，伤害全部集中在贴脸冲撞！）
      if (f.ballSkillKind === "rider_turbo" && f.soundWaveCd <= 0 && foe.alive) {
        f.soundWaveCd = Math.max(1.32, 1.72 - f.rageStacks * 0.04);
        f.slowTimer = 0;
        evolveBall(f, tick);
        const [dvx, dvy] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(f, foe) * 1.44);
        f.vx = dvx;
        f.vy = dvy;
      }

      // 广场舞老太：周期性外放高音蓝牙震波环 + 召唤最多 4 名伴舞大妈分身球
      if (f.ballSkillKind === "dance_granny" && f.soundWaveCd <= 0 && foe.alive) {
        f.soundWaveCd = Math.max(1.18, 1.58 - f.rageStacks * 0.04);
        const maxR = 305 + f.rageStacks * 18;
        emit({ tick, t: time, type: "soundWave", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distToFoe <= maxR * 0.94) {
          const waveDmg = Math.round(25 + f.rageStacks * 2.6);
          // 音波推开对手（若一拳光头已蓄满 95% 进入霸体突进，则仅轻微减速不打断突进）
          const pushScale = foe.ballSkillKind === "one_punch" && foe.punchCharge >= 95 ? 0.55 : 1.08;
          if (pushScale > 0.8) {
            const [px, py] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * pushScale);
            foe.vx = px;
            foe.vy = py;
          }
          evolveBall(f, tick);
          // 逐步摇人召唤最多 4 名伴舞大妈分身球组成广场舞大阵！
          const myClones = clones.filter(c => c.owner === f.cfg.id);
          if (myClones.length < 4 && f.rageStacks >= myClones.length + 1) {
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
        // 若一拳光头冲撞踩中粘性剧毒蛛丝，蛛网弹性会卸掉其少许蓄力拳势
        if (victim.ballSkillKind === "one_punch") {
          victim.punchCharge = Math.max(0, victim.punchCharge - 5);
        }
        const webDmg = Math.round(24 + spider.rageStacks * 2.4);
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
        if (applyDamage(spider, victim, webDmg, tick, `蛛丝切割 -${webDmg}`, false)) break;
      }
    }

    if (!A.alive || !B.alive) break;

    // 5. 更新伴舞大妈分身球移动与围殴碰撞（增加 subHitCd 间隔，严禁 5 个分身同帧叠伤秒人！）
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
        if (d <= BALL_R * foe.bodyScale + 36 && c.hitCd <= 0 && foe.subHitCd <= 0 && foe.alive) {
          c.hitCd = 0.76;
          foe.subHitCd = 0.26;
          const [bx, by] = normalize(c.x - foe.x, c.y - foe.y, 435);
          c.vx = bx;
          c.vy = by;
          if (foe.latchedTo === owner.cfg.id) {
            foe.latchTimer = Math.max(0, foe.latchTimer - 0.26);
          }
          emit({
            tick,
            t: time,
            type: "propHit",
            id: owner.cfg.id,
            target: foe.cfg.id,
            propKind: "clone",
            x: Math.round(c.x),
            y: Math.round(c.y),
            tx: Math.round(foe.x),
            ty: Math.round(foe.y),
            tag: "伴舞围攻",
            value: 22,
          });
          if (applyDamage(owner, foe, 22, tick, "伴舞围攻 -22", false)) break;
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

    // 5b. 更新暗影忍者王的旋转手里剑弹射与切割（增加 subHitCd 间隔 + 锁 1 滴血交由主球斩杀）
    if (shurikens.length > 0) {
      for (const s of shurikens) {
        s.hitCd = Math.max(0, s.hitCd - DT);
        s.angle = (s.angle + 16 * DT) % (Math.PI * 2);
        const foe = s.owner === "A" ? B : A;
        const owner = s.owner === "A" ? A : B;
        const [tvx, tvy] = normalize(foe.x - s.x, foe.y - s.y, 1);
        const [cvx, cvy] = normalize(s.vx, s.vy, 1);
        [s.vx, s.vy] = normalize(cvx * 0.94 + tvx * 0.06, cvy * 0.94 + tvy * 0.06, 525);
        s.x += s.vx * DT;
        s.y += s.vy * DT;
        if (s.x < 44 || s.x > ARENA_W - 44) s.vx *= -1;
        if (s.y < 44 || s.y > ARENA_H - 44) s.vy *= -1;
        s.x = clamp(s.x, 44, ARENA_W - 44);
        s.y = clamp(s.y, 44, ARENA_H - 44);

        const d = Math.hypot(foe.x - s.x, foe.y - s.y);
        if (d <= BALL_R * foe.bodyScale + 34 && s.hitCd <= 0 && foe.subHitCd <= 0 && foe.alive) {
          s.hitCd = 0.74;
          foe.subHitCd = 0.24;
          const [bx, by] = normalize(s.x - foe.x + (rng() - 0.5) * 40, s.y - foe.y + (rng() - 0.5) * 40, 535);
          s.vx = bx;
          s.vy = by;
          const shurikenDmg = Math.round(21 + owner.rageStacks * 2.1);
          emit({
            tick,
            t: time,
            type: "propHit",
            id: owner.cfg.id,
            target: foe.cfg.id,
            propKind: "shuriken",
            x: Math.round(s.x),
            y: Math.round(s.y),
            tx: Math.round(foe.x),
            ty: Math.round(foe.y),
            tag: "飞剑切割",
            value: shurikenDmg,
          });
          if (applyDamage(owner, foe, shurikenDmg, tick, `飞剑切割 -${shurikenDmg}`, false)) break;
        }
      }
      if (tick % MOVE_EVERY === 0) {
        for (const side of ["A", "B"] as Side[]) {
          const sideShurikens = shurikens.filter(s => s.owner === side);
          if (sideShurikens.length > 0) {
            emit({
              tick,
              t: time,
              type: "shurikenSync",
              id: side,
              shurikens: sideShurikens.map(s => ({
                id: s.id,
                x: Math.round(s.x),
                y: Math.round(s.y),
                angle: Number(s.angle.toFixed(2)),
              })),
            });
          }
        }
      }
    }

    if (!A.alive || !B.alive) break;

    // 5c. 更新场地机关与实体物理碰撞（100% 物理实体碰撞生效，彻底废除隔空定时大招）
    if (props.length > 0) {
      for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        if (!p) continue;
        p.hitCd = Math.max(0, p.hitCd - DT);
        const owner = p.owner === "A" ? A : B;
        const foe = p.owner === "A" ? B : A;
        if (!owner.alive || !foe.alive) break;

        if (p.kind === "wrecking_ball") {
          // 暴走拆迁队：重型锁链大铁球围绕本体高速旋转挥舞！
          const spinDir = owner.cfg.id === "A" ? 1 : -1;
          const spinSpd = 5.8 + owner.rageStacks * 0.28;
          p.angle = (p.angle + spinDir * spinSpd * DT) % (Math.PI * 2);
          const chainLen = 158 + owner.rageStacks * 6;
          p.r = Math.round(42 + owner.rageStacks * 2.0);
          p.x = clamp(owner.x + Math.cos(p.angle) * chainLen, 46, ARENA_W - 46);
          p.y = clamp(owner.y + Math.sin(p.angle) * chainLen, 46, ARENA_H - 46);
          p.tx = Math.round(owner.x);
          p.ty = Math.round(owner.y);

          // 1) 拆迁铁球撞击场地内的红砖墙 -> 当场砸碎砖墙，向对手方向爆射2块高速飞砖碎片！
          for (let wIdx = props.length - 1; wIdx >= 0; wIdx--) {
            const wall = props[wIdx];
            if (!wall || wall.kind !== "brick_wall") continue;
            if (Math.hypot(wall.x - p.x, wall.y - p.y) <= p.r + wall.r) {
              const wx = wall.x;
              const wy = wall.y;
              props.splice(wIdx, 1);
              if (wIdx < i) i--;
              if (tick % 2 === 0) evolveBall(owner, tick);
              emit({
                tick,
                t: time,
                type: "propHit",
                id: owner.cfg.id,
                target: foe.cfg.id,
                propKind: "wall_shatter",
                x: Math.round(wx),
                y: Math.round(wy),
                tx: Math.round(foe.x),
                ty: Math.round(foe.y),
                tag: "铁球破墙",
                value: 0,
              });
              const baseAim = Math.atan2(foe.y - wy, foe.x - wx);
              for (const b of [-0.18, 0.18]) {
                const bAng = baseAim + b;
                props.push({
                  id: nextPropId++,
                  owner: owner.cfg.id,
                  kind: "flying_brick",
                  x: Math.round(wx),
                  y: Math.round(wy),
                  vx: Math.cos(bAng) * 600,
                  vy: Math.sin(bAng) * 600,
                  r: 22,
                  angle: bAng,
                  val: 1,
                  hitCd: 0,
                });
              }
              break;
            }
          }

          // 2) 拆迁铁球直接砸中对手球体 -> 真实重锤伤害 + 切向甩动（不完全封死近战突进）！
          const dFoeBall = Math.hypot(foe.x - p.x, foe.y - p.y);
          if (dFoeBall <= BALL_R * foe.bodyScale + p.r && p.hitCd <= 0) {
            p.hitCd = 0.80;
            evolveBall(owner, tick);
            const smashDmg = Math.round(29 + owner.rageStacks * 2.4);
            const tangAng = p.angle + spinDir * (Math.PI * 0.42);
            const [kx, ky] = normalize(Math.cos(tangAng), Math.sin(tangAng), effectiveSpeed(foe, owner) * 1.16);
            foe.vx = foe.vx * 0.45 + kx * 0.55;
            foe.vy = foe.vy * 0.45 + ky * 0.55;
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "wrecking_ball",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "铁球重砸",
              value: smashDmg,
            });
            if (applyDamage(owner, foe, smashDmg, tick, `铁球重砸 -${smashDmg}`)) break;
          }
          continue;
        } else if (p.kind === "flying_brick") {
          // 破墙飞出的高速红砖碎片：沿直线飞行，命中对手造成砸击伤害，碰墙碎裂消失
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          p.angle = (p.angle + 18 * DT) % (Math.PI * 2);
          if (p.x < 36 || p.x > ARENA_W - 36 || p.y < 36 || p.y > ARENA_H - 36) {
            props.splice(i, 1);
            continue;
          }
          if (Math.hypot(foe.x - p.x, foe.y - p.y) <= BALL_R * foe.bodyScale + p.r) {
            const brickDmg = Math.round(17 + owner.rageStacks * 1.5);
            const [bx, by] = normalize(p.vx, p.vy, effectiveSpeed(foe, owner) * 1.12);
            foe.vx = foe.vx * 0.5 + bx * 0.5;
            foe.vy = foe.vy * 0.5 + by * 0.5;
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "flying_brick",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "飞砖砸击",
              value: brickDmg,
            });
            props.splice(i, 1);
            if (applyDamage(owner, foe, brickDmg, tick, `飞砖砸击 -${brickDmg}`)) break;
            continue;
          }
          continue;
        } else if (p.kind === "pool_ball" || p.kind === "sub_beyblade") {
          const spd = p.kind === "sub_beyblade" ? 525 : 485;
          const steer = p.kind === "sub_beyblade" ? 0.024 : 0.014;
          const [cvx, cvy] = normalize(p.vx || 400, p.vy || 320, 1);
          const [tvx, tvy] = normalize(foe.x - p.x, foe.y - p.y, 1);
          [p.vx, p.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, spd);
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          if (p.x < 48 || p.x > ARENA_W - 48) p.vx *= -1;
          if (p.y < 48 || p.y > ARENA_H - 48) p.vy *= -1;
          p.x = clamp(p.x, 48, ARENA_W - 48);
          p.y = clamp(p.y, 48, ARENA_H - 48);
          if (p.kind === "sub_beyblade") {
            p.angle = (p.angle + 12 * DT) % (Math.PI * 2);
            p.tx = Math.round(owner.x);
            p.ty = Math.round(owner.y);
          } else {
            p.angle = Math.atan2(p.vy, p.vx);
          }
        } else if (p.kind === "fish_hook") {
          p.tx = Math.round(owner.x);
          p.ty = Math.round(owner.y);

          // 状态 A：倒刺死死钉在对手球体边缘，持续 0.45s 强行把对手往垂钓王身上拖拽收线（Hooke's Law 连续拉力约束）！
          if ((p.latchTimer ?? 0) > 0 && foe.alive) {
            p.latchTimer = Math.max(0, (p.latchTimer ?? 0) - DT);
            const dx = owner.x - foe.x;
            const dy = owner.y - foe.y;
            const distToOwner = Math.hypot(dx, dy);
            const angToOwner = Math.atan2(dy, dx);

            // 1) 每帧强行覆写对手速度向量，产生持续加速收线拖拽位移，并挂载短暂受控保护防寻路抵消
            const [pullVx, pullVy] = normalize(dx, dy, effectiveSpeed(foe, owner) * 1.48);
            foe.vx = pullVx;
            foe.vy = pullVy;
            foe.knockbackTimer = Math.max(foe.knockbackTimer, 0.10);
            foe.action = "hit";

            // 2) 鱼钩坐标死死钉在对手朝向垂钓王的球体边缘，绝不穿体飞走
            const rimDist = BALL_R * foe.bodyScale * 0.76;
            p.x = clamp(foe.x + Math.cos(angToOwner) * rimDist, 48, ARENA_W - 48);
            p.y = clamp(foe.y + Math.sin(angToOwner) * rimDist, 48, ARENA_H - 48);
            p.angle = angToOwner + Math.PI;
            p.val = 99; // 标记为「绷紧收线态」供 render.ts 渲染高亮金青绷紧鱼线、收线张力波与破水尾浪

            // 3) 若已拉到垂钓王贴身范围，或 0.45s 收线期满，则脱钩弹开并爆出收线咬合水花
            const minArriveDist = BALL_R * (owner.bodyScale + foe.bodyScale) + 26;
            if (distToOwner <= minArriveDist || p.latchTimer <= 0) {
              p.latchTimer = 0;
              p.val = 1;
              p.hitCd = 0.72;
              const ejectAng = angToOwner + Math.PI * 0.55 * (p.id % 2 === 0 ? 1 : -1);
              p.vx = Math.cos(ejectAng) * 545;
              p.vy = Math.sin(ejectAng) * 545;
              emit({
                tick,
                t: time,
                type: "propHit",
                id: owner.cfg.id,
                target: foe.cfg.id,
                propKind: "fish_hook",
                x: Math.round(p.x),
                y: Math.round(p.y),
                tx: Math.round(owner.x),
                ty: Math.round(owner.y),
                tag: "收线咬合",
                value: 0,
              });
            }
            continue;
          }

          // 状态 B：自由飞行与弹墙搜寻猎物
          p.val = 1;
          const [cvx, cvy] = normalize(p.vx || 420, p.vy || 360, 1);
          const [tvx, tvy] = normalize(foe.x - p.x, foe.y - p.y, 1);
          [p.vx, p.vy] = normalize(cvx * 0.955 + tvx * 0.045, cvy * 0.955 + tvy * 0.045, 545);
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          if (p.x < 48 || p.x > ARENA_W - 48) p.vx *= -1;
          if (p.y < 48 || p.y > ARENA_H - 48) p.vy *= -1;
          p.x = clamp(p.x, 48, ARENA_W - 48);
          p.y = clamp(p.y, 48, ARENA_H - 48);
          p.angle = Math.atan2(p.vy, p.vx);

          const anyHookLatched = props.some(hp => hp.owner === owner.cfg.id && hp.kind === "fish_hook" && (hp.latchTimer ?? 0) > 0);
          if (!anyHookLatched && Math.hypot(foe.x - p.x, foe.y - p.y) <= BALL_R * foe.bodyScale + p.r && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.latchTimer = 0.44; // 进入 0.44s 真实倒刺挂钩拖拽状态
            p.val = 99;
            p.hitCd = 1.25;
            foe.subHitCd = 0.30;
            evolveBall(owner, tick);
            if (foe.latchedTo) foe.latchTimer = Math.max(0, foe.latchTimer - 0.40);
            const heal = Math.round(9 + owner.rageStacks * 0.8);
            owner.hp = Math.min(owner.cfg.maxHp, owner.hp + heal);
            emit({ tick, t: time, type: "heal", id: owner.cfg.id, value: heal, hp: owner.hp, text: `+${heal}`, x: Math.round(owner.x), y: Math.round(owner.y) });
            emit({ tick, t: time, type: "skillEffect", id: owner.cfg.id, kind: "lifesteal", name: "收线汲取", x: Math.round(owner.x), y: Math.round(owner.y), tx: Math.round(foe.x), ty: Math.round(foe.y) });
            const pullDmg = Math.round(28 + owner.rageStacks * 2.5);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "fish_hook",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(owner.x),
              ty: Math.round(owner.y),
              tag: "鱼钩拽击",
              value: pullDmg,
            });
            if (applyDamage(owner, foe, pullDmg, tick, `鱼钩拽击 -${pullDmg}`)) break;
          }
          continue;
        } else if (p.kind === "voodoo_effigy") {
          p.angle = (p.angle + 10 * DT) % (Math.PI * 2);
          p.tx = Math.round(foe.x);
          p.ty = Math.round(foe.y);
          p.curseTimer = (p.curseTimer ?? (0.95 + (p.id % 3) * 0.55)) - DT;

          const dOwner = Math.hypot(owner.x - p.x, owner.y - p.y);
          const dFoe = Math.hypot(foe.x - p.x, foe.y - p.y);

          // 1) 周期性自动扎针传导：每隔 ~2.1s 草人自动扎针抽搐，隔空轰出紫红诅咒闪电击中对手并吸取生命！
          if (p.curseTimer <= 0 && foe.alive) {
            p.curseTimer = Math.max(1.75, 2.25 - owner.rageStacks * 0.05);
            const pulseDmg = Math.round(14 + owner.rageStacks * 1.3);
            const heal = Math.round(5 + owner.rageStacks * 0.5);
            owner.hp = Math.min(owner.cfg.maxHp, owner.hp + heal);
            foe.slowTimer = Math.max(foe.slowTimer, 0.25);
            emit({ tick, t: time, type: "heal", id: owner.cfg.id, value: heal, hp: owner.hp, text: `+${heal}`, x: Math.round(owner.x), y: Math.round(owner.y) });
            emit({ tick, t: time, type: "skillEffect", id: owner.cfg.id, kind: "lifesteal", name: "巫毒汲取", x: Math.round(owner.x), y: Math.round(owner.y), tx: Math.round(foe.x), ty: Math.round(foe.y) });
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "voodoo_effigy",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "咒针穿心",
              value: pulseDmg,
            });
            if (applyDamage(owner, foe, pulseDmg, tick, `咒针穿心 -${pulseDmg}`, false)) break;
          }

          // 2) 巫毒师本体撞击草人 -> 物理弹性反弹 + 触发重型金针贯穿暴击
          if (dOwner <= BALL_R * owner.bodyScale + p.r + 10 && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.72;
            foe.subHitCd = 0.26;
            evolveBall(owner, tick);
            const [obx, oby] = normalize(owner.x - p.x + (foe.x - owner.x) * 0.45, owner.y - p.y + (foe.y - owner.y) * 0.45, effectiveSpeed(owner, foe) * 1.18);
            owner.vx = obx;
            owner.vy = oby;
            const curseDmg = Math.round(28 + owner.rageStacks * 2.5);
            const heal = Math.round(9 + owner.rageStacks * 0.8);
            owner.hp = Math.min(owner.cfg.maxHp, owner.hp + heal);
            emit({ tick, t: time, type: "heal", id: owner.cfg.id, value: heal, hp: owner.hp, text: `+${heal}`, x: Math.round(owner.x), y: Math.round(owner.y) });
            emit({ tick, t: time, type: "skillEffect", id: owner.cfg.id, kind: "lifesteal", name: "扎针传导", x: Math.round(owner.x), y: Math.round(owner.y), tx: Math.round(p.x), ty: Math.round(p.y) });
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "voodoo_effigy",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "扎针传导",
              value: curseDmg,
            });
            if (applyDamage(owner, foe, curseDmg, tick, `扎针传导 -${curseDmg}`)) break;
            continue;
          }

          // 3) 对手直接撞上巫毒草人 -> 严禁穿模！触发「咒偶反噬」强力震退对手 + 毒针爆破
          if (dFoe <= BALL_R * foe.bodyScale + p.r + 6 && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.68;
            foe.subHitCd = 0.26;
            evolveBall(owner, tick);
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.38);
            foe.vx = bx;
            foe.vy = by;
            foe.slowTimer = Math.max(foe.slowTimer, 0.65);
            p.x = clamp(p.x - (bx / 500) * 18, 95, ARENA_W - 95);
            p.y = clamp(p.y - (by / 500) * 18, 95, ARENA_H - 95);
            const trapDmg = Math.round(25 + owner.rageStacks * 2.2);
            const heal = Math.round(8 + owner.rageStacks * 0.7);
            owner.hp = Math.min(owner.cfg.maxHp, owner.hp + heal);
            emit({ tick, t: time, type: "heal", id: owner.cfg.id, value: heal, hp: owner.hp, text: `+${heal}`, x: Math.round(owner.x), y: Math.round(owner.y) });
            emit({ tick, t: time, type: "skillEffect", id: owner.cfg.id, kind: "lifesteal", name: "咒偶反噬", x: Math.round(owner.x), y: Math.round(owner.y), tx: Math.round(foe.x), ty: Math.round(foe.y) });
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "voodoo_effigy",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "咒偶反噬",
              value: trapDmg,
            });
            if (applyDamage(owner, foe, trapDmg, tick, `咒偶反噬 -${trapDmg}`)) break;
          }
          continue;
        } else if (p.kind === "delivery_box") {
          // 若红炸弹外卖盒已被外卖侠踢飞，则沿弹道高速飞行并在墙边反弹！
          if (Math.hypot(p.vx, p.vy) > 10) {
            p.x += p.vx * DT;
            p.y += p.vy * DT;
            if (p.x < 52 || p.x > ARENA_W - 52) p.vx *= -0.88;
            if (p.y < 52 || p.y > ARENA_H - 52) p.vy *= -0.88;
            p.x = clamp(p.x, 52, ARENA_W - 52);
            p.y = clamp(p.y, 52, ARENA_H - 52);
          }
        } else {
          p.angle = (p.angle + 10 * DT) % (Math.PI * 2);
        }

        // 检查自身或对手与机关的物理碰撞
        const dFoe = Math.hypot(foe.x - p.x, foe.y - p.y);
        const dOwner = Math.hypot(owner.x - p.x, owner.y - p.y);
        if (p.kind === "delivery_box" && dOwner <= BALL_R * owner.bodyScale + p.r && p.hitCd <= 0) {
          p.hitCd = 0.65;
          if (p.val === 1) {
            // 珍珠奶茶杯 (val === 1)：外卖侠拾取喝掉，立即回血并消耗！
            const heal = Math.round(22 + owner.rageStacks * 1.8);
            owner.hp = Math.min(owner.cfg.maxHp, owner.hp + heal);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: owner.cfg.id,
              propKind: "milk_tea",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(owner.x),
              ty: Math.round(owner.y),
              tag: "奶茶回血",
              value: heal,
            });
            emit({ tick, t: time, type: "skillEffect", id: owner.cfg.id, kind: "lifesteal", name: "奶茶回血", x: Math.round(owner.x), y: Math.round(owner.y), tx: Math.round(p.x), ty: Math.round(p.y) });
            emit({ tick, t: time, type: "heal", id: owner.cfg.id, value: heal, hp: owner.hp, text: `+${heal}`, x: Math.round(owner.x), y: Math.round(owner.y) });
            props.splice(i, 1);
          } else {
            // 红辣油炸弹盒 (val === 0)：外卖侠碰到时不回血，而是一脚将炸弹盒踢向对手方向轰炸敌人！
            const [kvx, kvy] = normalize(foe.x - p.x, foe.y - p.y, 520);
            p.vx = kvx;
            p.vy = kvy;
          }
          continue;
        } else if (p.kind === "bumper_peg" && dOwner <= BALL_R * owner.bodyScale + p.r && p.hitCd <= 0) {
          p.hitCd = 0.56;
          const [bx, by] = normalize(foe.x - owner.x, foe.y - owner.y, effectiveSpeed(owner, foe) * 1.48);
          owner.vx = bx;
          owner.vy = by;
          evolveBall(owner, tick);
          if (Math.hypot(foe.x - p.x, foe.y - p.y) <= 225) {
            const arcDmg = Math.round(24 + owner.rageStacks * 2.1);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "bumper_arc",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "弹柱放电",
              value: arcDmg,
            });
            if (applyDamage(owner, foe, arcDmg, tick, `弹柱放电 -${arcDmg}`)) break;
          }
        } else if (p.kind === "ring_post" && dOwner <= BALL_R * owner.bodyScale + p.r && p.hitCd <= 0) {
          p.hitCd = 0.58;
          evolveBall(owner, tick);
          const [bx, by] = normalize(foe.x - owner.x, foe.y - owner.y, effectiveSpeed(owner, foe) * 1.50);
          owner.vx = bx;
          owner.vy = by;
          emit({
            tick,
            t: time,
            type: "propHit",
            id: owner.cfg.id,
            target: owner.cfg.id,
            propKind: "ring_post",
            x: Math.round(p.x),
            y: Math.round(p.y),
            tx: Math.round(owner.x),
            ty: Math.round(owner.y),
            tag: "边绳借力",
            value: 0,
          });
        }

        if (p.kind === "hydrant_jet") {
          // 暴躁消防员：高压水柱具有真实线段碰撞体积，对手穿过水柱即被高压激流冲飞扣血！
          p.angle = (p.angle + 2.2 * DT) % (Math.PI * 2);
          const jetLen = p.r * 4.8;
          const jx = p.x + Math.cos(p.angle) * jetLen;
          const jy = p.y + Math.sin(p.angle) * jetLen;
          const segHit = pointToSegment(foe.x, foe.y, p.x, p.y, jx, jy);
          if (segHit.dist <= BALL_R * foe.bodyScale + 20 && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.74;
            foe.subHitCd = 0.26;
            evolveBall(owner, tick);
            const [kx, ky] = normalize(Math.cos(p.angle), Math.sin(p.angle), effectiveSpeed(foe, owner) * 1.32);
            foe.vx = foe.vx * 0.35 + kx * 0.65;
            foe.vy = foe.vy * 0.35 + ky * 0.65;
            const jetDmg = Math.round(29 + owner.rageStacks * 2.6);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "hydrant_jet",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "水柱轰击",
              value: jetDmg,
            });
            if (applyDamage(owner, foe, jetDmg, tick, "水柱轰击")) break;
          }
          continue;
        }

        if (dFoe <= BALL_R * foe.bodyScale + p.r && p.hitCd <= 0 && foe.subHitCd <= 0) {
          p.hitCd = 0.70;
          foe.subHitCd = 0.25;
          // 一拳光头满蓄力「认真冲刺」时直接撞碎敌方路障陷阱，不受反弹减速阻拦！
          if (
            foe.ballSkillKind === "one_punch" &&
            foe.punchCharge >= 95 &&
            (p.kind === "brick_wall" || p.kind === "acid_puddle" || p.kind === "paint_splat" || p.kind === "delivery_box")
          ) {
            props.splice(i, 1);
            continue;
          }
          if (p.kind === "acid_puddle") {
            foe.slowTimer = 0.72;
            foe.vx *= 0.62;
            foe.vy *= 0.62;
            evolveBall(owner, tick);
            const acidDmg = Math.round(28 + owner.rageStacks * 2.5);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "acid_puddle",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "强酸腐蚀",
              value: acidDmg,
            });
            p.val = (p.val || 3) - 1;
            if (p.val <= 0) {
              props.splice(i, 1);
            }
            if (applyDamage(owner, foe, acidDmg, tick, "强酸腐蚀")) break;
          } else if (p.kind === "brick_wall") {
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.18);
            foe.vx = bx;
            foe.vy = by;
            const wallDmg = Math.round(22 + owner.rageStacks * 2.0);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "brick_wall",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "撞墙反弹",
              value: wallDmg,
            });
            p.val -= 1;
            if (p.val <= 0) {
              props.splice(i, 1);
            }
            if (applyDamage(owner, foe, wallDmg, tick, "撞墙反弹")) break;
          } else if (p.kind === "delivery_box") {
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.30);
            foe.vx = bx;
            foe.vy = by;
            const bombDmg = Math.round(33 + owner.rageStacks * 3.0);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "chili_bomb",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "辣油爆破",
              value: bombDmg,
            });
            props.splice(i, 1);
            if (applyDamage(owner, foe, bombDmg, tick, "辣油爆破")) break;
          } else if (p.kind === "pool_ball") {
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, 515);
            p.vx = bx;
            p.vy = by;
            const [kx, ky] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.18);
            foe.vx = foe.vx * 0.45 + kx * 0.55;
            foe.vy = foe.vy * 0.45 + ky * 0.55;
            evolveBall(owner, tick);
            const poolDmg = Math.round(30 + owner.rageStacks * 2.7);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "pool_ball",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "桌球连撞",
              value: poolDmg,
            });
            if (applyDamage(owner, foe, poolDmg, tick, "桌球连撞")) break;
          } else if (p.kind === "paint_splat") {
            foe.slowTimer = 0.76;
            foe.vx *= 0.62;
            foe.vy *= 0.62;
            evolveBall(owner, tick);
            const paintDmg = Math.round(29 + owner.rageStacks * 2.6);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "paint_splat",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "毒漆腐蚀",
              value: paintDmg,
            });
            p.val = (p.val || 4) - 1;
            if (p.val <= 0) {
              props.splice(i, 1);
            }
            if (applyDamage(owner, foe, paintDmg, tick, "毒漆腐蚀")) break;
          } else if (p.kind === "roast_grill") {
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.28);
            foe.vx = bx;
            foe.vy = by;
            foe.slowTimer = Math.max(foe.slowTimer, 0.45);
            evolveBall(owner, tick);
            const grillDmg = Math.round(34 + owner.rageStacks * 3.1);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "roast_grill",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "炭火穿串",
              value: grillDmg,
            });
            if (applyDamage(owner, foe, grillDmg, tick, "炭火穿串")) break;
          } else if (p.kind === "bumper_peg") {
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.50);
            foe.vx = bx;
            foe.vy = by;
            evolveBall(owner, tick);
            const pegDmg = Math.round(35 + owner.rageStacks * 3.1);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "bumper_peg",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "弹柱电击",
              value: pegDmg,
            });
            if (applyDamage(owner, foe, pegDmg, tick, "弹柱电击")) break;
          } else if (p.kind === "sub_beyblade") {
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, 535);
            p.vx = bx;
            p.vy = by;
            const [kx, ky] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.18);
            foe.vx = foe.vx * 0.45 + kx * 0.55;
            foe.vy = foe.vy * 0.45 + ky * 0.55;
            evolveBall(owner, tick);
            const beyDmg = Math.round(30 + owner.rageStacks * 2.7);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "sub_beyblade",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "陀螺绞杀",
              value: beyDmg,
            });
            if (applyDamage(owner, foe, beyDmg, tick, "陀螺绞杀")) break;
          } else if (p.kind === "ring_post") {
            const [bx, by] = normalize(owner.x - foe.x, owner.y - foe.y, effectiveSpeed(foe, owner) * 1.28);
            foe.vx = bx;
            foe.vy = by;
            evolveBall(owner, tick);
            const ropeDmg = Math.round(22 + owner.rageStacks * 2.0);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: owner.cfg.id,
              target: foe.cfg.id,
              propKind: "ring_post",
              x: Math.round(p.x),
              y: Math.round(p.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "边绳弹击",
              value: ropeDmg,
            });
            if (applyDamage(owner, foe, ropeDmg, tick, "边绳弹击")) break;
          }
        }
      }

      if (tick % MOVE_EVERY === 0) {
        for (const side of ["A", "B"] as Side[]) {
          const sideProps = props.filter(p => p.owner === side);
          emit({
            tick,
            t: time,
            type: "propSync",
            id: side,
            props: sideProps.map(p => ({
              id: p.id,
              kind: p.kind,
              x: Math.round(p.x),
              y: Math.round(p.y),
              r: p.r,
              angle: Number(p.angle.toFixed(2)),
              val: p.val,
              tx: p.tx,
              ty: p.ty,
            })),
          });
        }
      }
    }

    if (!A.alive || !B.alive) break;

    // 6. 双方主球体近身碰撞与核心技能交互
    const bodyDist = Math.hypot(B.x - A.x, B.y - A.y);
    const minDist = BALL_R * (A.bodyScale + B.bodyScale);

    // 6a. 一拳光头蓄力满 100% 时，仅在双方球体真实物理接触碰撞时轰出「认真一拳」！
    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;
      if (f.ballSkillKind === "one_punch" && f.punchCharge >= 97 && bodyDist <= minDist + 22 && f.skillCd <= 0) {
        f.punchCharge = 0;
        f.skillCd = 0.88;
        f.action = "skill";
        f.actionTimer = 0.42;
        evolveBall(f, tick);
        const punchDmg = Math.round(68 + f.rageStacks * 6.2);
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
        // 将对手轰飞，若撞墙则触发二段撞墙粉碎
        const [kx, ky] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * 2.05);
        foe.vx = kx;
        foe.vy = ky;
        foe.knockbackTimer = 0.62;
        foe.knockbackFrom = f.cfg.id;
        for (const c of clones) {
          if (c.owner === foe.cfg.id) {
            const [cx, cy] = normalize(c.x - f.x, c.y - f.y, 520);
            c.vx = cx;
            c.vy = cy;
          }
        }
        if (applyDamage(f, foe, punchDmg, tick, `认真一拳 -${punchDmg}`)) break;
      }
    }

    if (!A.alive || !B.alive) break;

    // 6b. 球体直接物理碰撞：100% 公平弹性碰撞与贴身技能触发（无偏袒概率，无碰撞无限加速）
    if (!A.latchedTo && !B.latchedTo && bodyDist <= minDist + 14) {
      const vamp = A.ballSkillKind === "vampire_latch" ? A : B.ballSkillKind === "vampire_latch" ? B : null;
      const other = vamp === A ? B : A;

      if (vamp && vamp.latchCooldown <= 0 && vamp.frozenTimer <= 0) {
        evolveBall(vamp, tick);
        const dur = 1.15 + Math.min(0.75, vamp.rageStacks * 0.10);
        vamp.latchedTo = other.cfg.id;
        vamp.latchTimer = dur;
        vamp.latchTickCd = 0.08;
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
        // 标准弹性法线分离与反弹（不叠加 1.15x 速度膨胀）
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const d = Math.max(0.001, bodyDist);
        const nx = dx / d;
        const ny = dy / d;
        [A.vx, A.vy] = normalize(-nx + (rng() - 0.5) * 0.18, -ny + (rng() - 0.5) * 0.18, effectiveSpeed(A, B));
        [B.vx, B.vy] = normalize(nx + (rng() - 0.5) * 0.18, ny + (rng() - 0.5) * 0.18, effectiveSpeed(B, A));
        const overlap = minDist + 8 - d;
        if (overlap > 0) {
          A.x -= nx * overlap * 0.5;
          A.y -= ny * overlap * 0.5;
          B.x += nx * overlap * 0.5;
          B.y += ny * overlap * 0.5;
        }
        emit({
          tick,
          t: time,
          type: "parry",
          x: Math.round((A.x + B.x) * 0.5),
          y: Math.round((A.y + B.y) * 0.5),
          combo: 1,
        });

        // 双方碰撞公平结算：只要技能冷却完毕且不在冻结中，均可对对方造成碰撞伤害
        const pairs: Array<[SkillBallState, SkillBallState]> = rng() < 0.5 ? [[A, B], [B, A]] : [[B, A], [A, B]];
        for (const [hitter, target] of pairs) {
          if (!hitter.alive || !target.alive) break;
          if (hitter.frozenTimer > 0) continue;
          if (hitter.skillCd <= 0 && target.invulnCd <= 0) {
            hitter.skillCd = 0.36;
            target.invulnCd = 0.16;
            if (hitter.ballSkillKind === "spider_web") {
              spawnSpiderWeb(hitter, tick, hitter.lastAnchorX, hitter.lastAnchorY, hitter.x, hitter.y);
            }
            if (hitter.ballSkillKind === "rider_turbo") {
              evolveBall(hitter, tick);
              const ramDmg = Math.round(52 + hitter.rageStacks * 4.8);
              const [kx, ky] = normalize(target.x - hitter.x, target.y - hitter.y, effectiveSpeed(target, hitter) * 1.62);
              target.vx = kx;
              target.vy = ky;
              target.knockbackTimer = 0.36;
              target.knockbackFrom = hitter.cfg.id;
              if (applyDamage(hitter, target, ramDmg, tick, `飞箱重击 -${ramDmg}`)) break;
            } else if (hitter.ballSkillKind === "boxer_rope") {
              evolveBall(hitter, tick);
              const punchDmg = Math.round(48 + hitter.rageStacks * 4.4);
              const [kx, ky] = normalize(target.x - hitter.x, target.y - hitter.y, effectiveSpeed(target, hitter) * 1.62);
              target.vx = kx;
              target.vy = ky;
              target.knockbackTimer = 0.34;
              target.knockbackFrom = hitter.cfg.id;
              if (applyDamage(hitter, target, punchDmg, tick, `冠军勾拳 -${punchDmg}`)) break;
            } else if (hitter.ballSkillKind === "beyblade_orbit") {
              evolveBall(hitter, tick);
              const spinDmg = Math.round(38 + hitter.rageStacks * 3.6);
              if (applyDamage(hitter, target, spinDmg, tick, `锯齿绞杀 -${spinDmg}`)) break;
            } else {
              if (applyDamage(hitter, target, Math.round(36 + hitter.rageStacks * 3.6), tick, "贴身冲撞")) break;
            }
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
          latchedTo: f.latchedTo,
          punchCharge: Math.round(f.punchCharge),
          slowed: f.slowTimer > 0,
          frozen: f.frozenTimer > 0,
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

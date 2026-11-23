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
  | "snake_tail"
  | "slime_split"
  | "time_stop"
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
  smashTimer?: number;
  smashFrom?: Side | null;
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
  | { tick: number; t: number; type: "timeStopStart"; id: Side; duration: number; x: number; y: number }
  | { tick: number; t: number; type: "timeStopEnd"; id: Side; target: Side; hits: number; totalDmg: number; x: number; y: number; tx: number; ty: number }
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
    return `刀长 ${Math.round((f.reach / f.baseReach) * 100)}%`;
  }
  if (f.scaleKind === "spin") {
    return `转速 ${Math.round((f.spinSpeed / f.baseSpinSpeed) * 100)}%`;
  }
  if (f.scaleKind === "multiweapon") {
    return f.weaponKind === "twinblade" ? `飞刀 ×${f.bladeCount}` : `战锤 ×${f.bladeCount}`;
  }
  return f.weaponKind === "hammer"
    ? `巨锤 ${Math.round((f.reach / f.baseReach) * 100)}%`
    : `巨镰 ${Math.round((f.reach / f.baseReach) * 100)}%`;
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
    const baseReach = cfg.baseReach ?? (weaponKind === "greatsword" || weaponKind === "scythe" ? 182 : 162);
    const baseSpinSpeed = cfg.baseSpinSpeed ?? (scaleKind === "spin" ? 9.0 : 6.4);
    const baseBlades = cfg.baseBlades ?? (scaleKind === "multiweapon" ? 3 : weaponKind === "twinblade" ? 2 : 1);

    // 调整基础球速至高爽感区间 (455+ px/s)
    const baseSpd = Math.max(455, cfg.speed * 1.48);
    const aimAngle = Math.atan2(targetY - y, targetX - x) + (rng() - 0.5) * 0.10;
    const [vx, vy] = normalize(Math.cos(aimAngle), Math.sin(aimAngle), baseSpd * 1.24);

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
      weaponAngle: aimAngle - (isA ? 1 : -1) * 0.65 + (rng() - 0.5) * 0.25,
      spinDir: isA ? 1 : -1,
      baseSpinSpeed,
      spinSpeed: baseSpinSpeed,
      baseReach,
      reach: baseReach,
      baseBlades,
      bladeCount: baseBlades,
      bodyScale: 1.04,
      statLabel: "",
      smashTimer: 0,
      smashFrom: null,
    };
    st.statLabel = computeStatLabel(st);
    return st;
  };

  // 开局近距中场对冲，确保 0.08s~0.14s 内即刻爆发第一记震撼拼刀交锋
  const A = makeState(cfgA, ARENA_W * 0.28, ARENA_H * 0.45, ARENA_W * 0.50, ARENA_H * 0.50);
  const B = makeState(cfgB, ARENA_W * 0.72, ARENA_H * 0.55, ARENA_W * 0.50, ARENA_H * 0.50);

  for (const f of [A, B]) {
    const defaultHook =
      f.scaleKind === "reach"
        ? "★ 越砍刀身越长 · 四十米巨刃横扫 ★"
        : f.scaleKind === "spin"
          ? "★ 越砍转速越快 · 五倍超音速光轮 ★"
          : f.scaleKind === "multiweapon"
            ? "★ 每次命中加飞刀 · 十二刃电扇绞杀 ★"
            : "★ 越砸战锤越大 · 轰飞撞墙粉碎 ★";
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
    if ((f.smashTimer ?? 0) > 0) return f.cfg.speed * 1.78;
    const earlyBoost = time < 5.5 ? 1.15 : 1.0;
    const stackSpeedBoost =
      f.scaleKind === "spin"
        ? 1 + f.rageStacks * 0.052
        : f.scaleKind === "multiweapon"
          ? 1 + f.rageStacks * 0.032
          : 1 + f.rageStacks * 0.022;
    return f.cfg.speed * earlyBoost * Math.min(1.52, stackSpeedBoost);
  }

  function bounceWall(f: FighterState, foe: FighterState, tick: number): boolean {
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
      emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
      // 百吨破墙锤重击轰飞撞墙粉碎判定！
      if ((f.smashTimer ?? 0) > 0 && f.smashFrom && f.alive) {
        f.smashTimer = 0;
        const attacker = f.smashFrom === "A" ? A : B;
        const tempoMul = time > 5.8 ? 1.12 + Math.min(0.96, (time - 5.8) * 0.078) : 1.12;
        const wallDmg = Math.round((52 + attacker.rageStacks * 4.5) * tempoMul);
        f.hp -= wallDmg;
        emit({
          tick,
          t: time,
          type: "damage",
          id: f.cfg.id,
          value: wallDmg,
          from: attacker.cfg.id,
          hp: Math.max(0, f.hp),
          x: Math.round(f.x),
          y: Math.round(f.y),
          tag: "撞墙粉碎",
        });
        if (f.hp <= 0) {
          f.hp = 0;
          f.alive = false;
          f.action = "death";
          emit({ tick, t: time, type: "death", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
          emit({ tick, t: time, type: "end", winner: attacker.cfg.id, duration: time });
          return true;
        }
      }
      const spd = currentSpeed(f);
      const [rvx, rvy] = normalize(f.vx, f.vy, 1);
      const [cvx, cvy] = normalize(ARENA_W * 0.5 - f.x, ARENA_H * 0.5 - f.y, 1);
      const mixX = rvx * 0.80 + cvx * 0.20 + (rng() - 0.5) * 0.14;
      const mixY = rvy * 0.80 + cvy * 0.20 + (rng() - 0.5) * 0.14;
      [f.vx, f.vy] = normalize(mixX, mixY, spd);
    }
    return false;
  }

  function bounceApart(a: FighterState, b: FighterState, impulse = 1.08) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    const jx = (rng() - 0.5) * 0.28;
    const jy = (rng() - 0.5) * 0.28;
    if ((a.smashTimer ?? 0) <= 0) {
      [a.vx, a.vy] = normalize(-nx + jx, -ny + jy, currentSpeed(a) * impulse);
    }
    if ((b.smashTimer ?? 0) <= 0) {
      [b.vx, b.vy] = normalize(nx - jx, ny - jy, currentSpeed(b) * impulse);
    }

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

  /** 拼刀切向错位微滑：只擦出1次火花即贴身绕切破防，彻底消灭旧版“连弹25次不掉血”的打铁闷局！ */
  function parryRecoil(a: FighterState, b: FighterState, combo: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    const tx = -ny;
    const ty = nx;
    const sideSign = combo % 2 === 0 ? 1 : -1;
    [a.vx, a.vy] = normalize(-nx * 0.28 + tx * 0.92 * sideSign, -ny * 0.28 + ty * 0.92 * sideSign, currentSpeed(a) * 0.88);
    [b.vx, b.vy] = normalize(nx * 0.28 - tx * 0.92 * sideSign, ny * 0.28 - ty * 0.92 * sideSign, currentSpeed(b) * 0.88);
  }

  function getBladeSegments(f: FighterState): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    const segs: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const innerR = BASE_RADIUS * f.bodyScale * 0.56;
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
    caster.rageStacks = Math.min(10, caster.rageStacks + 1);
    const s = caster.rageStacks;
    if (caster.scaleKind === "reach") {
      // 四十米大刀：刀长从 186px 暴涨至 406px（横跨半屏，视觉压迫感炸裂且留有近身切入窗口）
      caster.reach = Math.min(Math.round(caster.baseReach * 2.18), Math.round(caster.baseReach * (1 + s * 0.118)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 1.80, caster.baseSpinSpeed * (1 + s * 0.08));
    } else if (caster.scaleKind === "spin") {
      // 超音速双锯 / 风火轮：转速从 100% 狂飙至 520% 等离子全圆光轮！
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 5.2, caster.baseSpinSpeed * (1 + s * 0.42));
      caster.reach = Math.min(Math.round(caster.baseReach * 1.62), Math.round(caster.baseReach * (1 + s * 0.062)));
    } else if (caster.scaleKind === "multiweapon") {
      // 千刃绞肉机：每层进化实打实 +1 把飞刀，从 3 把一路分裂成 12 把全圆电风扇刀轮！
      caster.bladeCount = Math.min(12, caster.baseBlades + s);
      caster.reach = Math.min(Math.round(caster.baseReach * 1.30), Math.round(caster.baseReach * (1 + s * 0.030)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 2.10, caster.baseSpinSpeed * (1 + s * 0.105));
    } else {
      // 百吨破墙锤 / 狂化断头斧：巨锤与球体狂化放大
      caster.bodyScale = Math.min(1.52, 1.04 + s * 0.048);
      caster.reach = Math.min(Math.round(caster.baseReach * 2.08), Math.round(caster.baseReach * (1 + s * 0.108)));
      caster.spinSpeed = Math.min(caster.baseSpinSpeed * 1.88, caster.baseSpinSpeed * (1 + s * 0.088));
    }
    caster.statLabel = computeStatLabel(caster);
  }

  function castWeaponHit(caster: FighterState, target: FighterState, tick: number, hitX: number, hitY: number): boolean {
    if (caster.skillCd > 0 || target.invulnCd > 0) return false;
    const skill = caster.cfg.active;
    const spinRatio = caster.spinSpeed / Math.max(1, caster.baseSpinSpeed);
    let cd = 0.34;
    if (caster.scaleKind === "spin") {
      cd = clamp(0.29 / (0.85 + 0.22 * spinRatio), 0.14, 0.27);
    } else if (caster.scaleKind === "multiweapon") {
      cd = clamp(0.32 - (caster.bladeCount - 3) * 0.013, 0.17, 0.30);
    } else if (caster.weaponKind === "hammer") {
      cd = clamp(0.36 - caster.rageStacks * 0.010, 0.25, 0.36);
    } else {
      cd = clamp(0.35 - caster.rageStacks * 0.010, 0.24, 0.35);
    }
    caster.skillCd = cd;
    target.invulnCd = clamp(cd * 0.68, 0.11, 0.23);
    caster.action = "skill";
    caster.actionTimer = 0.30;
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

    // 针对四大武器流派精准校准单次伤害与 5.8s 后节奏提速曲线（锁定 20.5s~23.5s 完播甜点，胜率 42%~58%）
    let rawBase = 60;
    let stackSlope = 0.105;
    if (caster.scaleKind === "reach") {
      rawBase = 58;
      stackSlope = 0.10;
    } else if (caster.scaleKind === "multiweapon") {
      rawBase = 55;
      stackSlope = 0.095;
    } else if (caster.scaleKind === "spin") {
      rawBase = 50;
      stackSlope = 0.092;
    } else if (caster.weaponKind === "hammer") {
      rawBase = 63;
      stackSlope = 0.102;
    } else {
      // scythe (has modest lifesteal)
      rawBase = 68;
      stackSlope = 0.108;
    }
    const stackMul = 1 + (caster.rageStacks - 1) * stackSlope;
    const tempoMul = time > 5.4 ? 1.15 + Math.min(1.02, (time - 5.4) * 0.084) : 1.15;
    const damage = Math.max(1, Math.round(rawBase * stackMul * tempoMul));
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
      const heal = Math.round(damage * 0.18);
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

    if (caster.weaponKind === "hammer") {
      // 百吨破墙锤：一锤将对手轰向竞技场墙壁，触发撞墙粉碎二段爆伤！
      const dx = target.x - caster.x;
      const dy = target.y - caster.y;
      const [kx, ky] = normalize(dx, dy, 880);
      target.vx = kx;
      target.vy = ky;
      target.smashTimer = 0.42;
      target.smashFrom = caster.cfg.id;
      const [cx, cy] = normalize(-dx, -dy, currentSpeed(caster) * 0.92);
      caster.vx = cx;
      caster.vy = cy;
    } else {
      bounceApart(caster, target, 1.06);
    }
    return false;
  }

  const maxTicks = Math.floor(TICK_RATE * maxDuration);
  for (let tick = 1; tick <= maxTicks; tick++) {
    time = tick * DT;
    parryCd = Math.max(0, parryCd - DT);
    timeSinceInteraction += DT;

    let endedByWallSmash = false;
    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;
      f.skillCd = Math.max(0, f.skillCd - DT);
      f.invulnCd = Math.max(0, f.invulnCd - DT);
      f.actionTimer = Math.max(0, f.actionTimer - DT);
      f.smashTimer = Math.max(0, (f.smashTimer ?? 0) - DT);
      if (f.actionTimer === 0 && f.action !== "death") f.action = "walk";

      // 若双方超过 0.34~0.48 秒未发生交锋，立刻施加直线追击修正，彻底消灭前5秒冷场绕圈时间
      const idleLimit = time < 5.6 ? 0.34 : 0.48;
      if (timeSinceInteraction > idleLimit && (f.smashTimer ?? 0) <= 0) {
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const [cvx, cvy] = normalize(f.vx, f.vy, 1);
        const steer = time < 5.6 ? Math.min(0.28, 0.14 + (timeSinceInteraction - idleLimit) * 0.22) : Math.min(0.24, (timeSinceInteraction - idleLimit) * 0.18);
        [f.vx, f.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, currentSpeed(f));
      }

      f.x += f.vx * DT;
      f.y += f.vy * DT;
      f.facing = f.vx >= 0 ? 1 : -1;

      const overdriveSpin = time > 6 ? 1 + (time - 6) * 0.042 : 1;
      f.weaponAngle += f.spinDir * f.spinSpeed * overdriveSpin * DT;
      if (bounceWall(f, foe, tick)) {
        endedByWallSmash = true;
        break;
      }
    }
    if (endedByWallSmash) break;

    if (A.alive && B.alive) {
      const segsA = getBladeSegments(A);
      const segsB = getBladeSegments(B);
      const rA = BASE_RADIUS * A.bodyScale;
      const rB = BASE_RADIUS * B.bodyScale;

      // 1. 先检查双方旋转刀锋是否发生金属交击 (Weapon-vs-Weapon Parry)：仅拼 1 刀擦出金芒即切入斩肉！
      let parriedThisTick = false;
      if (parryCd <= 0 && parryCombo < 1) {
        let bestParry: { dist: number; px: number; py: number } | null = null;
        for (const sa of segsA) {
          for (const sb of segsB) {
            const clash = segmentToSegment(sa.x1, sa.y1, sa.x2, sa.y2, sb.x1, sb.y1, sb.x2, sb.y2);
            if (clash.dist <= 26 && (!bestParry || clash.dist < bestParry.dist)) {
              bestParry = clash;
            }
          }
        }
        if (bestParry) {
          const hasMultiFan = A.bladeCount >= 5 || B.bladeCount >= 5;
          parryCd = hasMultiFan ? 0.46 : 0.26;
          parryCombo = time - lastParryTime <= 1.6 ? parryCombo + 1 : 1;
          lastParryTime = time;
          timeSinceInteraction = 0;
          A.spinDir = (A.spinDir * -1) as 1 | -1;
          B.spinDir = (B.spinDir * -1) as 1 | -1;
          A.weaponAngle += A.spinDir * 0.32;
          B.weaponAngle += B.spinDir * 0.32;
          emit({
            tick,
            t: time,
            type: "parry",
            x: Math.round(bestParry.px),
            y: Math.round(bestParry.py),
            combo: parryCombo,
          });
          // 拼刀激发武器潜能：落后方获得一层进化，保证双方神兵同步养成奇观
          for (const f of [A, B]) {
            const foe = f === A ? B : A;
            if (f.rageStacks < foe.rageStacks || (f.rageStacks < 4 && rng() < 0.45)) {
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

      // 2. 检查武器命中对手本体 (Weapon-vs-Body)：废除巨剑 +38px 作弊判定，四大流派公平竞技！
      let hitTriggered = false;
      if (!parriedThisTick) {
        const aMargin = A.weaponKind === "hammer" ? 26 : 21;
        const bMargin = B.weaponKind === "hammer" ? 26 : 21;

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

        // 劣势方绝地反击横扫：当血量落后方贴近对手斩击半径内时，概率触发顺势破防反斩，制造丝血翻盘拉锯感
        const centerDist = Math.hypot(B.x - A.x, B.y - A.y);
        if (!aCan && bCan && A.hp < B.hp * 0.92 && A.skillCd <= 0 && B.invulnCd <= 0 && centerDist <= A.reach + rB + 18) {
          if (rng() < 0.48) {
            A.weaponAngle = Math.atan2(B.y - A.y, B.x - A.x);
            aHitPt = { cx: B.x, cy: B.y };
            aCan = true;
          }
        } else if (!bCan && aCan && B.hp < A.hp * 0.92 && B.skillCd <= 0 && A.invulnCd <= 0 && centerDist <= B.reach + rA + 18) {
          if (rng() < 0.48) {
            B.weaponAngle = Math.atan2(A.y - B.y, A.x - B.x);
            bHitPt = { cx: A.x, cy: A.y };
            bCan = true;
          }
        }

        if (aCan && bCan) {
          const aBias = A.hp < B.hp ? 0.58 : 0.42;
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

      // 3. 本体球体近距冲撞：必定触发武器破防斩击！
      const bodyDist = Math.hypot(B.x - A.x, B.y - A.y);
      if (bodyDist <= rA + rB + 14) {
        if (!hitTriggered && !parriedThisTick) {
          const midX = (A.x + B.x) * 0.5;
          const midY = (A.y + B.y) * 0.5;
          const aPrefer = A.hp < B.hp ? 0.58 : A.hp > B.hp ? 0.42 : 0.50;
          const first = rng() < aPrefer ? A : B;
          const second = first === A ? B : A;
          if (first.skillCd <= 0 && second.invulnCd <= 0) {
            if (castWeaponHit(first, second, tick, midX, midY)) break;
          } else if (second.skillCd <= 0 && first.invulnCd <= 0) {
            if (castWeaponHit(second, first, tick, midX, midY)) break;
          } else {
            bounceApart(A, B, 1.04);
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
  splitStage: number;
  timeStopTimer: number;
  timeStopCd: number;
  timeStopStoredDmg: number;
  timeStopHits: number;
  timeStopStrikeCd: number;
  timeStopDirX: number;
  timeStopDirY: number;
  snakeBounceCount: number;
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
    | "snake_seg"
    | "slime_clone"
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
  curseTimer?: number;
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
    return `蛛丝 ×${Math.max(3, webCount)}`;
  }
  if (f.ballSkillKind === "one_punch") {
    return `拳威 ${100 + f.rageStacks * 38}%`;
  }
  if (f.ballSkillKind === "thunder_rail") {
    return `磁炮 ${100 + f.rageStacks * 36}%`;
  }
  if (f.ballSkillKind === "ninja_shuriken") {
    return `飞剑 ×${Math.max(3, shurikenCount)}`;
  }
  if (f.ballSkillKind === "frost_freeze") {
    return `冰封 ${100 + f.rageStacks * 32}%`;
  }
  if (f.ballSkillKind === "rider_turbo") {
    return `时速 ${165 + f.rageStacks * 32}`;
  }
  if (f.ballSkillKind === "alchemist_puddle") {
    return `毒球 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "bulldozer_wall") {
    const wbCount = f.rageStacks >= 7 ? 3 : f.rageStacks >= 3 ? 2 : 1;
    return `铁球 ×${wbCount}`;
  }
  if (f.ballSkillKind === "snake_tail") {
    return `蛇身 ${Math.max(8, propCount) + 1}节`;
  }
  if (f.ballSkillKind === "slime_split") {
    return `分裂 ×${Math.max(1, propCount + 1)}`;
  }
  if (f.ballSkillKind === "time_stop") {
    return f.timeStopTimer > 0 ? "时间静止" : `时停 ${Math.min(100, Math.round(f.punchCharge))}%`;
  }
  if (f.ballSkillKind === "billiard_bank") {
    return `彩球 ×${Math.max(3, propCount)}`;
  }
  if (f.ballSkillKind === "graffiti_paint") {
    return `彩弹 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "kebab_skewer") {
    return `铁签 ${100 + f.rageStacks * 25}%`;
  }
  if (f.ballSkillKind === "pinball_bumper") {
    return `电球 ×${Math.max(3, propCount)}`;
  }
  if (f.ballSkillKind === "beyblade_orbit") {
    return `转速 ${220 + f.rageStacks * 48}%`;
  }
  if (f.ballSkillKind === "fireman_hose") {
    return `水压 ${115 + f.rageStacks * 32}%`;
  }
  if (f.ballSkillKind === "voodoo_doll") {
    return `咒偶 ×${Math.max(2, propCount)}`;
  }
  if (f.ballSkillKind === "boxer_rope") {
    return `重拳 ${115 + f.rageStacks * 36}%`;
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
    const baseSpd = Math.max(472, cfg.speed * 1.52);
    const aim = Math.atan2(ty - y, tx - x) + (rng() - 0.5) * 0.05;
    const [vx, vy] = normalize(Math.cos(aim), Math.sin(aim), baseSpd * 1.25);
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
      bodyScale: ballSkillKind === "slime_split" ? 1.52 : 1.08,
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
      punchCharge:
        ballSkillKind === "one_punch"
          ? 96
          : ballSkillKind === "thunder_rail"
            ? 94
            : ballSkillKind === "time_stop"
              ? 46
              : 0,
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
      splitStage: 0,
      timeStopTimer: 0,
      timeStopCd: 0,
      timeStopStoredDmg: 0,
      timeStopHits: 0,
      timeStopStrikeCd: 0,
      timeStopDirX: 0,
      timeStopDirY: 0,
      snakeBounceCount: 0,
    };
    st.statLabel = computeSkillBallLabel(
      st,
      ballSkillKind === "spider_web" ? 3 : 0,
      ballSkillKind === "dance_granny" ? 2 : 0,
      ballSkillKind === "ninja_shuriken" ? 3 : 0,
      ballSkillKind === "snake_tail" ? 8 : 0,
    );
    return st;
  };

  const A = makeBall(cfgA, ARENA_W * 0.33, ARENA_H * 0.46, ARENA_W * 0.50, ARENA_H * 0.50);
  const B = makeBall(cfgB, ARENA_W * 0.67, ARENA_H * 0.54, ARENA_W * 0.50, ARENA_H * 0.50);

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
        emit({ tick: 0, t: 0, type: "webSpawn", webId: w.id, id: f.cfg.id, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
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
        tick: 0,
        t: 0,
        type: "cloneSync",
        id: f.cfg.id,
        clones: sideClones.map(c => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y) })),
      });
    } else if (f.ballSkillKind === "ninja_shuriken") {
      for (let k = 0; k < 3; k++) {
        const ang = (k - 1) * 0.62 + (f.cfg.id === "A" ? 0 : Math.PI);
        shurikens.push({
          id: nextShurikenId++,
          owner: f.cfg.id,
          x: Math.round(clamp(f.x + Math.cos(ang) * 105, 58, ARENA_W - 58)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 105, 58, ARENA_H - 58)),
          vx: Math.cos(ang) * 525,
          vy: Math.sin(ang) * 525,
          angle: k * 1.1,
          hitCd: 0.14,
        });
      }
      const sideShurikens = shurikens.filter(s => s.owner === f.cfg.id);
      emit({
        tick: 0,
        t: 0,
        type: "shurikenSync",
        id: f.cfg.id,
        shurikens: sideShurikens.map(s => ({ id: s.id, x: Math.round(s.x), y: Math.round(s.y), angle: Number(s.angle.toFixed(2)) })),
      });
    } else if (f.ballSkillKind === "beyblade_orbit") {
      for (let k = 0; k < 2; k++) {
        const ang = k * Math.PI + (f.cfg.id === "A" ? 0.55 : -0.55);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "sub_beyblade",
          x: Math.round(clamp(f.x + Math.cos(ang) * 108, 60, ARENA_W - 60)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 108, 60, ARENA_H - 60)),
          vx: Math.cos(ang + 1.35) * 535,
          vy: Math.sin(ang + 1.35) * 535,
          r: 36,
          angle: 0,
          val: k + 1,
          hitCd: 0.14,
          tx: Math.round(f.x),
          ty: Math.round(f.y),
        });
      }
    } else if (f.ballSkillKind === "alchemist_puddle") {
      // 绝命毒师 V4.0：0静态地滩，开局直接投出2颗高速弹射且越打越巨化的强酸剧毒球！
      for (let k = 0; k < 2; k++) {
        const ang = (k === 0 ? -0.68 : 0.68) + (f.cfg.id === "A" ? 0 : Math.PI);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "acid_puddle",
          x: Math.round(clamp(f.x + Math.cos(ang) * 112, 72, ARENA_W - 72)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 112, 72, ARENA_H - 72)),
          vx: Math.cos(ang) * 435,
          vy: Math.sin(ang) * 435,
          r: 46,
          angle: 0,
          val: 5,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "bulldozer_wall") {
      // 暴走拆迁队 V4.0：彻底清除地面静态砖墙杂物，聚焦锁链流星大铁球（随进化 1->2->3 颗巨型重锤环绕横扫！）
      const initAng = f.cfg.id === "A" ? 0.35 : Math.PI + 0.35;
      props.push({
        id: nextPropId++,
        owner: f.cfg.id,
        kind: "wrecking_ball",
        x: Math.round(f.x + Math.cos(initAng) * 156),
        y: Math.round(f.y + Math.sin(initAng) * 156),
        vx: 0,
        vy: 0,
        r: 46,
        angle: initAng,
        val: 1,
        hitCd: 0.12,
        tx: Math.round(f.x),
        ty: Math.round(f.y),
      });
    } else if (f.ballSkillKind === "snake_tail") {
      // 吞天贪吃蛇 V4.0：0地面杂物，开局第0帧即拖曳 8 节粗壮鳞甲蛇身（共 9 节），随吞噬暴涨至 25 节巨蟒！
      const backAng = Math.atan2(-f.vy, -f.vx);
      let prevX = f.x;
      let prevY = f.y;
      for (let k = 0; k < 8; k++) {
        const spacing = k === 0 ? 48 : 42;
        const curveAng = backAng + Math.sin(k * 0.75 + 0.4) * 0.34;
        const sx = clamp(prevX + Math.cos(curveAng) * spacing, 52, ARENA_W - 52);
        const sy = clamp(prevY + Math.sin(curveAng) * spacing, 52, ARENA_H - 52);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "snake_seg",
          x: Math.round(sx),
          y: Math.round(sy),
          vx: 0,
          vy: 0,
          r: Math.round(Math.max(32, 44 - k * 0.55)),
          angle: Math.atan2(prevY - sy, prevX - sx),
          val: k,
          hitCd: 0.14,
          tx: Math.round(prevX),
          ty: Math.round(prevY),
        });
        prevX = sx;
        prevY = sy;
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
          vx: Math.cos(ang + 1.2) * 485,
          vy: Math.sin(ang + 1.2) * 485,
          r: 36,
          angle: 0,
          val: k + 1,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "graffiti_paint") {
      // 街头涂鸦王 V4.0：0静态地贴，开局发射2颗高速弹射的巨型霓虹彩漆弹球！
      for (let k = 0; k < 2; k++) {
        const ang = (k === 0 ? -0.62 : 0.62) + (f.cfg.id === "A" ? 0 : Math.PI);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "paint_splat",
          x: Math.round(clamp(f.x + Math.cos(ang) * 112, 72, ARENA_W - 72)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 112, 72, ARENA_H - 72)),
          vx: Math.cos(ang) * 455,
          vy: Math.sin(ang) * 455,
          r: 46,
          angle: k * 1.1,
          val: 6,
          hitCd: 0.14,
        });
      }
    } else if (f.ballSkillKind === "pinball_bumper") {
      // 街机弹珠王 V4.0：彻底移除死板静态蘑菇桩，开局射出3颗高速弹射的高压黄金电光球！
      for (let k = 0; k < 3; k++) {
        const ang = (k - 1) * 0.58 + (f.cfg.id === "A" ? 0 : Math.PI);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "pool_ball",
          x: Math.round(clamp(f.x + Math.cos(ang) * 110, 64, ARENA_W - 64)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 110, 64, ARENA_H - 64)),
          vx: Math.cos(ang) * 535,
          vy: Math.sin(ang) * 535,
          r: 38,
          angle: 0,
          val: k + 1,
          hitCd: 0.12,
        });
      }
    } else if (f.ballSkillKind === "voodoo_doll") {
      // 巫毒咒术师 V4.0：0原地木桩，召唤2只满场高速索命追击的飞行诅咒巫毒偶！
      const foe = f === A ? B : A;
      for (let k = 0; k < 2; k++) {
        const ang = (k === 0 ? -0.65 : 0.65) + (f.cfg.id === "A" ? 0 : Math.PI);
        props.push({
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "voodoo_effigy",
          x: Math.round(clamp(f.x + Math.cos(ang) * 114, 76, ARENA_W - 76)),
          y: Math.round(clamp(f.y + Math.sin(ang) * 114, 76, ARENA_H - 76)),
          vx: Math.cos(ang) * 445,
          vy: Math.sin(ang) * 445,
          r: 46,
          angle: 0,
          val: 1,
          hitCd: 0.16,
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
        });
      }
    }
    const sideProps = props.filter(p => p.owner === f.cfg.id);
    if (sideProps.length > 0) {
      emit({
        tick: 0,
        t: 0,
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
    // 恒定物理基准球速 + 前5秒黄金留存肾上腺素加速（0~3.6s +16% 极速交锋，5.5s 前平滑回落常态）
    let mul = 1 + f.rageStacks * 0.018;
    if (time < 5.5) {
      mul *= 1 + 0.16 * clamp(1 - (time - 3.6) / 1.9, 0, 1);
    }
    if (f.ballSkillKind === "rider_turbo") {
      mul *= 1.08 + f.rageStacks * 0.042;
    } else if (f.ballSkillKind === "slime_split") {
      // 巨型本体略沉重，越分裂越轻快狂暴
      mul *= 0.94 + f.splitStage * 0.095;
    } else if (f.ballSkillKind === "snake_tail") {
      mul *= 1.04;
    }
    if (f.timeStopTimer > 0) mul *= 2.25;
    else if (f.knockbackTimer > 0) mul *= 1.85;
    else if (f.latchedTo) mul *= 1.05;
    else if (f.slowTimer > 0) mul *= 0.64;
    return f.cfg.speed * clamp(mul, 0.55, 2.45);
  }

  function evolveBall(f: SkillBallState, tick: number) {
    f.rageStacks = Math.min(12, f.rageStacks + 1);
    if (f.ballSkillKind !== "slime_split") {
      const slope = f.ballSkillKind === "time_stop" ? 0.024 : 0.020;
      f.bodyScale = Math.min(1.34, 1.08 + f.rageStacks * slope);
    }
    // 暴走拆迁队随进化解锁第2颗、第3颗环绕重型锁链大铁球（三头流星锤！）
    if (f.ballSkillKind === "bulldozer_wall") {
      const myBalls = props.filter(p => p.owner === f.cfg.id && p.kind === "wrecking_ball");
      const targetBalls = f.rageStacks >= 7 ? 3 : f.rageStacks >= 3 ? 2 : 1;
      while (myBalls.length < targetBalls) {
        const baseAng = myBalls.length > 0 ? myBalls[0].angle : 0;
        const newIdx = myBalls.length + 1;
        const newAng = baseAng + ((Math.PI * 2) / targetBalls) * (newIdx - 1);
        const nb: ArenaProp = {
          id: nextPropId++,
          owner: f.cfg.id,
          kind: "wrecking_ball",
          x: Math.round(f.x + Math.cos(newAng) * (156 + f.rageStacks * 8)),
          y: Math.round(f.y + Math.sin(newAng) * (156 + f.rageStacks * 8)),
          vx: 0,
          vy: 0,
          r: Math.round(46 + f.rageStacks * 2.2),
          angle: newAng,
          val: newIdx,
          hitCd: 0.2,
          tx: Math.round(f.x),
          ty: Math.round(f.y),
        };
        props.push(nb);
        myBalls.push(nb);
      }
      // 重新均匀排布多颗铁球的环绕相位角，视觉对称霸气
      if (myBalls.length >= 2) {
        const leadAng = myBalls[0].angle;
        for (let bi = 0; bi < myBalls.length; bi++) {
          myBalls[bi].angle = (leadAng + (Math.PI * 2 * bi) / myBalls.length) % (Math.PI * 2);
        }
      }
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

  function appendSnakeSegment(snake: SkillBallState, count: number, tick: number) {
    const mySegs = props
      .filter(p => p.owner === snake.cfg.id && p.kind === "snake_seg")
      .sort((a, b) => a.val - b.val);
    let curLen = mySegs.length;
    const maxSegs = 24; // 加上蛇头共 25 节吞天巨蟒！
    let added = 0;
    while (added < count && curLen < maxSegs) {
      const prev = mySegs.length > 0 ? mySegs[mySegs.length - 1] : null;
      const anchorX = prev ? prev.x : snake.x;
      const anchorY = prev ? prev.y : snake.y;
      const tailAng = prev ? prev.angle + Math.PI : Math.atan2(-snake.vy, -snake.vx);
      const spacing = 42;
      const sx = clamp(anchorX + Math.cos(tailAng) * spacing, 52, ARENA_W - 52);
      const sy = clamp(anchorY + Math.sin(tailAng) * spacing, 52, ARENA_H - 52);
      const segR = Math.round(clamp(44 + snake.rageStacks * 0.7 - curLen * 0.45, 31, 48));
      const newSeg: ArenaProp = {
        id: nextPropId++,
        owner: snake.cfg.id,
        kind: "snake_seg",
        x: Math.round(sx),
        y: Math.round(sy),
        vx: 0,
        vy: 0,
        r: segR,
        angle: tailAng + Math.PI,
        val: curLen,
        hitCd: 0.22,
        tx: Math.round(anchorX),
        ty: Math.round(anchorY),
      };
      props.push(newSeg);
      mySegs.push(newSeg);
      curLen++;
      added++;
    }
    if (added > 0) {
      snake.statLabel = computeSkillBallLabel(snake, 0, 0, 0, curLen);
      if (curLen % 2 === 0) {
        evolveBall(snake, tick);
      }
    }
  }

  function checkSlimeMitosis(slime: SkillBallState, foe: SkillBallState, tick: number) {
    if (slime.ballSkillKind !== "slime_split" || !slime.alive || slime.hp <= 0) return;
    const hpPct = slime.hp / Math.max(1, slime.cfg.maxHp);
    const stageThresholds: Array<{ stage: number; pct: number; scale: number; cloneR: number; targetClones: number; title: string }> = [
      { stage: 1, pct: 0.92, scale: 1.24, cloneR: 52, targetClones: 1, title: "细胞分裂 ×2!!" },
      { stage: 2, pct: 0.66, scale: 1.02, cloneR: 45, targetClones: 3, title: "细胞分裂 ×4!!" },
      { stage: 3, pct: 0.40, scale: 0.88, cloneR: 39, targetClones: 7, title: "暴走分裂 ×8!!" },
      { stage: 4, pct: 0.18, scale: 0.80, cloneR: 35, targetClones: 9, title: "十球狂潮 ×10!!" },
    ];
    for (const st of stageThresholds) {
      if (hpPct <= st.pct && slime.splitStage < st.stage) {
        slime.splitStage = st.stage;
        slime.bodyScale = st.scale;
        slime.invulnCd = Math.max(slime.invulnCd, 0.24);
        slime.frozenTimer = 0;
        slime.slowTimer = 0;

        // 缩放已有史莱姆分身并分裂出新个体
        const existing = props.filter(p => p.owner === slime.cfg.id && p.kind === "slime_clone");
        for (const ep of existing) {
          ep.r = st.cloneR;
        }
        const need = st.targetClones - existing.length;
        for (let k = 0; k < need; k++) {
          const parent = existing.length > 0 && k % 2 === 1 ? existing[k % existing.length] : slime;
          const ang = (Math.PI * 2 * (k + 0.35)) / Math.max(1, need) + (rng() - 0.5) * 0.4;
          const spd = 465 + st.stage * 36;
          const sx = clamp(parent.x + Math.cos(ang) * 58, 60, ARENA_W - 60);
          const sy = clamp(parent.y + Math.sin(ang) * 58, 60, ARENA_H - 60);
          props.push({
            id: nextPropId++,
            owner: slime.cfg.id,
            kind: "slime_clone",
            x: Math.round(sx),
            y: Math.round(sy),
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            r: st.cloneR,
            angle: ang,
            val: st.stage,
            hitCd: 0.28,
          });
        }
        // 本体向反方向弹开模拟有丝分裂张力
        const sepAng = Math.atan2(slime.y - foe.y, slime.x - foe.x) + (rng() - 0.5) * 0.7;
        [slime.vx, slime.vy] = normalize(Math.cos(sepAng), Math.sin(sepAng), effectiveSpeed(slime, foe) * 1.25);

      // 弹性果冻分裂护膜：每次分裂小幅回血稳住阵脚并激发进化
        const splitHeal = 13;
        slime.hp = Math.min(slime.cfg.maxHp, slime.hp + splitHeal);
        emit({ tick, t: time, type: "heal", id: slime.cfg.id, value: splitHeal, hp: slime.hp, text: `+${splitHeal}`, x: Math.round(slime.x), y: Math.round(slime.y) });
        evolveBall(slime, tick);
        emit({
          tick,
          t: time,
          type: "propHit",
          id: slime.cfg.id,
          target: foe.cfg.id,
          propKind: "slime_mitosis",
          x: Math.round(slime.x),
          y: Math.round(slime.y),
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
          tag: st.title,
          value: st.targetClones + 1,
        });
        emit({
          tick,
          t: time,
          type: "ultCast",
          id: slime.cfg.id,
          target: foe.cfg.id,
          kind: slime.ballSkillKind,
          title: st.title,
          callout: `★ ${slime.cfg.name} 触发「${st.title}」· 全场 ${st.targetClones + 1} 只史莱姆狂暴合围 ★`,
          style: "nova",
          x: Math.round(slime.x),
          y: Math.round(slime.y),
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
        });
      }
    }
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
    // 22s 黄金节奏曲线 V4.0：配合中后期紧凑追击（对撞密度+24%），平抑过快秒杀，精准锁定 20.5~23.2s 高完播黄金时长！
    const tempoMul =
      time > 8.5
        ? 0.80 + Math.min(0.60, (time - 8.5) * 0.036)
        : time < 5.5
          ? 0.72
          : 0.78;
    let finalRawDmg = rawDmg * comebackMul * tempoMul;
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
      attacker.ballSkillKind === "vampire_latch" ||
      attacker.ballSkillKind === "time_stop" ||
      attacker.ballSkillKind === "slime_split";
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
        ultCallout = `★ ${attacker.cfg.name} 引爆巨型毒球 · 「绝命毒爆」剧毒蚀骨 ★`;
        target.slowTimer = Math.max(target.slowTimer, 1.05);
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "acid_puddle") {
            p.r = Math.min(72, p.r + 6);
            const [avx, avy] = normalize(target.x - p.x, target.y - p.y, 495);
            p.vx = avx;
            p.vy = avy;
          }
        }
      } else if (kind === "bulldozer_wall") {
        ultTitle = "三头流星锤!!";
        ultStyle = "rush";
        tagPrefix = "三头流星锤";
        ultCallout = `★ ${attacker.cfg.name} 锁链狂舞 · 「三头流星锤」轰飞对手 ★`;
        const [kx, ky] = normalize(target.x - attacker.x, target.y - attacker.y, effectiveSpeed(target, attacker) * 1.65);
        target.vx = kx;
        target.vy = ky;
        target.knockbackTimer = 0.44;
        target.knockbackFrom = attacker.cfg.id;
      } else if (kind === "snake_tail") {
        ultTitle = "万蛇盘阵!!";
        ultStyle = "storm";
        tagPrefix = "巨蟒绞杀";
        ultCallout = `★ ${attacker.cfg.name} 暴食蜕皮 · 「万蛇盘阵」蛇身狂涨盘死猎物 ★`;
        appendSnakeSegment(attacker, 3, tick);
        const heal = 14;
        attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + heal);
        emit({ tick, t: time, type: "heal", id: attacker.cfg.id, value: heal, hp: attacker.hp, text: `+${heal}`, x: Math.round(attacker.x), y: Math.round(attacker.y) });
      } else if (kind === "billiard_bank") {
        ultTitle = "一杆清台!!";
        ultStyle = "beam";
        tagPrefix = "一杆清台";
        ultCallout = `★ ${attacker.cfg.name} 激光制导 · 「一杆清台」彩球齐射 ★`;
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "pool_ball") {
            const [bvx, bvy] = normalize(target.x - p.x, target.y - p.y, 560);
            p.vx = bvx;
            p.vy = bvy;
          }
        }
      } else if (kind === "graffiti_paint") {
        ultTitle = "颜料巨浪!!";
        ultStyle = "nova";
        tagPrefix = "颜料巨浪";
        ultCallout = `★ ${attacker.cfg.name} 唤醒霓虹彩弹 · 「颜料巨浪」席卷全场 ★`;
        target.slowTimer = Math.max(target.slowTimer, 1.05);
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "paint_splat") {
            p.r = Math.min(72, p.r + 6);
            const [pvx, pvy] = normalize(target.x - p.x, target.y - p.y, 510);
            p.vx = pvx;
            p.vy = pvy;
          }
        }
      } else if (kind === "kebab_skewer") {
        ultTitle = "孜然烈焰!!";
        ultStyle = "storm";
        tagPrefix = "孜然烈焰";
        ultCallout = `★ ${attacker.cfg.name} 四十米铁签全开 · 「孜然烈焰」穿串炙烤 ★`;
        const heal = 16;
        attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + heal);
        emit({ tick, t: time, type: "heal", id: attacker.cfg.id, value: heal, hp: attacker.hp, text: `烈焰回血 +${heal}`, x: Math.round(attacker.x), y: Math.round(attacker.y) });
      } else if (kind === "pinball_bumper") {
        ultTitle = "777大奖暴走!!";
        ultStyle = "beam";
        tagPrefix = "大奖暴走";
        ultCallout = `★ ${attacker.cfg.name} 触发 777 大奖 · 满屏电球狂暴弹射 ★`;
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "pool_ball") {
            const [evx, evy] = normalize(target.x - p.x, target.y - p.y, 580);
            p.vx = evx;
            p.vy = evy;
          }
        }
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
        ultCallout = `★ ${attacker.cfg.name} 索命咒偶齐射 · 「百针连心咒」隔空暴击 ★`;
        const heal = 18;
        attacker.hp = Math.min(attacker.cfg.maxHp, attacker.hp + heal);
        emit({ tick, t: time, type: "heal", id: attacker.cfg.id, value: heal, hp: attacker.hp, text: `咒杀汲取 +${heal}`, x: Math.round(attacker.x), y: Math.round(attacker.y) });
        for (const p of props) {
          if (p.owner === attacker.cfg.id && p.kind === "voodoo_effigy") {
            const [vvx, vvy] = normalize(target.x - p.x, target.y - p.y, 505);
            p.vx = vvx;
            p.vy = vvy;
          }
        }
      } else if (kind === "boxer_rope") {
        ultTitle = "冠军重勾拳!!";
        ultStyle = "rush";
        tagPrefix = "冠军重拳";
        ultCallout = `★ ${attacker.cfg.name} 弹簧巨拳满载 · 「冠军重勾拳」轰飞撞墙 ★`;
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
          : target.ballSkillKind === "time_stop" && target.timeStopTimer <= 0
            ? (target.timeStopCd > 0 ? 2.5 : 5)
            : 4;
    if (target.timeStopTimer <= 0) {
      target.punchCharge = Math.min(100, target.punchCharge + chargeGain);
    }
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

    // 分裂史莱姆受击跨越 75% / 50% / 25% 血线时，当场触发有丝分裂（1 -> 2 -> 4 -> 8）！
    if (target.alive && target.hp > 0 && target.ballSkillKind === "slime_split") {
      checkSlimeMitosis(target, attacker, tick);
    }

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
      const wOwner = w.owner === "A" ? A : B;
      const wFoe = w.owner === "A" ? B : A;
      if (wFoe.timeStopTimer > 0 && wFoe.alive) continue;
      void wOwner;
      w.hitCd = Math.max(0, w.hitCd - DT);
    }

    for (const f of [A, B]) {
      if (!f.alive) continue;
      const foe = f === A ? B : A;

      // 00. 若对手正开启「时间静止」领域，当前角色被彻底凝固在静止时空中（不移动、不冷却、不行动）！
      if (foe.timeStopTimer > 0 && foe.alive) {
        f.action = "hit";
        continue;
      }

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
      f.timeStopCd = Math.max(0, f.timeStopCd - DT);

      if (f.ballSkillKind === "one_punch") {
        f.punchCharge = Math.min(100, f.punchCharge + 31 * DT);
      } else if (f.ballSkillKind === "thunder_rail") {
        f.punchCharge = Math.min(100, f.punchCharge + 22 * DT);
      } else if (f.ballSkillKind === "rider_turbo") {
        f.punchCharge = Math.min(100, f.punchCharge + 20 * DT);
      } else if (f.ballSkillKind === "time_stop") {
        if (f.timeStopTimer <= 0) {
          const rate = f.timeStopCd > 0 ? 9.6 : 17.2;
          f.punchCharge = Math.min(100, f.punchCharge + rate * DT);
          if (tick % MOVE_EVERY === 0) {
            f.statLabel = computeSkillBallLabel(f, 0, 0, 0, 0);
          }
        }
      } else if (
        f.ballSkillKind !== "vampire_latch" &&
        f.ballSkillKind !== "dance_granny" &&
        f.ballSkillKind !== "frost_freeze" &&
        f.ballSkillKind !== "slime_split"
      ) {
        f.punchCharge = Math.min(100, f.punchCharge + 8.5 * DT);
      }

      // 00b. 时停钟表王：开场前2.75s先展现全彩高速交锋，蓄满100%瞬间开启 0.92s 紧凑高燃「时间静止」五芒星急斩！
      if (
        f.ballSkillKind === "time_stop" &&
        time >= 2.75 &&
        f.timeStopTimer <= 0 &&
        f.timeStopCd <= 0 &&
        f.punchCharge >= 100 &&
        f.frozenTimer <= 0 &&
        foe.alive
      ) {
        if (foe.latchedTo === f.cfg.id) {
          foe.latchedTo = null;
          foe.latchCooldown = 1.4;
          emit({ tick, t: time, type: "latchEnd", id: foe.cfg.id, x: Math.round(foe.x), y: Math.round(foe.y) });
        }
        const tsDur = 0.92;
        f.timeStopTimer = tsDur;
        f.punchCharge = 0;
        f.timeStopStoredDmg = 0;
        f.timeStopHits = 0;
        f.timeStopStrikeCd = 0.05;
        f.timeStopDirX = 0;
        f.timeStopDirY = 0;
        f.slowTimer = 0;
        f.knockbackTimer = 0;
        f.action = "skill";
        f.actionTimer = tsDur;
        evolveBall(f, tick);
        f.statLabel = computeSkillBallLabel(f, 0, 0, 0, 0);
        emit({
          tick,
          t: time,
          type: "timeStopStart",
          id: f.cfg.id,
          target: foe.cfg.id,
          x: Math.round(f.x),
          y: Math.round(f.y),
          duration: tsDur,
        });
        emit({
          tick,
          t: time,
          type: "ultCast",
          id: f.cfg.id,
          target: foe.cfg.id,
          kind: f.ballSkillKind,
          title: "时间静止!!",
          callout: `★ ${f.cfg.name} 拨停表盘 · 「时间静止」凝固天地万物 ★`,
          style: "nova",
          x: Math.round(f.x),
          y: Math.round(f.y),
          tx: Math.round(foe.x),
          ty: Math.round(foe.y),
        });
      }

      // 00c. 时停钟表王正处于「时间静止」领域内：独自以 2.3x 极速往返穿梭五芒星斩击，悬停蓄积伤害向量！
      if (f.timeStopTimer > 0 && foe.alive) {
        f.timeStopTimer -= DT;
        f.timeStopStrikeCd -= DT;

        if (f.timeStopStrikeCd <= 0 && f.timeStopTimer > 0.08 && f.timeStopHits < 5) {
          f.timeStopHits += 1;
          f.timeStopStrikeCd = 0.14;
          // 按五芒星表盘角度穿过被冻结的猎物，钉入黄金怀表剑针
          const starAng = f.timeStopHits * 2.51 + (f.cfg.id === "A" ? 0.25 : -0.25);
          const destX = clamp(foe.x + Math.cos(starAng) * 190, 85, ARENA_W - 85);
          const destY = clamp(foe.y + Math.sin(starAng) * 190, 85, ARENA_H - 85);
          [f.vx, f.vy] = normalize(destX - f.x, destY - f.y, 1460);

          const strikeDmg = Math.round(41 + f.rageStacks * 3.8);
          f.timeStopStoredDmg += strikeDmg;
          const [kdx, kdy] = normalize(foe.x - f.x, foe.y - f.y, 1);
          f.timeStopDirX += kdx;
          f.timeStopDirY += kdy;

          emit({
            tick,
            t: time,
            type: "propHit",
            id: f.cfg.id,
            target: foe.cfg.id,
            propKind: "chrono_strike",
            x: Math.round(foe.x),
            y: Math.round(foe.y),
            tx: Math.round(f.x),
            ty: Math.round(f.y),
            tag: "时停叠斩",
            value: f.timeStopHits,
          });
        }

        f.x += f.vx * DT;
        f.y += f.vy * DT;
        const rTs = BALL_R * f.bodyScale + WALL_PAD;
        if (f.x < rTs) { f.x = rTs; f.vx = Math.abs(f.vx); }
        if (f.x > ARENA_W - rTs) { f.x = ARENA_W - rTs; f.vx = -Math.abs(f.vx); }
        if (f.y < rTs) { f.y = rTs; f.vy = Math.abs(f.vy); }
        if (f.y > ARENA_H - rTs) { f.y = ARENA_H - rTs; f.vy = -Math.abs(f.vy); }
        f.facing = foe.x >= f.x ? 1 : -1;

        // 时停极速穿梭破网：钟表王在静止时空中高速掠过敌方织出的蛛丝时，怀表剑锋直接斩断1~2根动态毒丝！
        if (foe.ballSkillKind === "spider_web" && f.webGlobalCd <= 0) {
          const foeWebCount = webs.filter(item => item.owner === foe.cfg.id).length;
          if (foeWebCount > 4) {
            for (let wi = webs.length - 1; wi >= 0; wi--) {
              const w = webs[wi];
              if (w.owner !== foe.cfg.id || w.hp >= 500) continue;
              const hit = pointToSegment(f.x, f.y, w.x1, w.y1, w.x2, w.y2);
              if (hit.dist <= BALL_R * f.bodyScale + 12) {
                f.webGlobalCd = 0.68;
                webs.splice(wi, 1);
                const leftWebs = webs.filter(item => item.owner === foe.cfg.id).length;
                foe.statLabel = computeSkillBallLabel(foe, leftWebs, 0);
                emit({
                  tick,
                  t: time,
                  type: "webHit",
                  webId: w.id,
                  id: foe.cfg.id,
                  target: f.cfg.id,
                  x: Math.round(hit.cx),
                  y: Math.round(hit.cy),
                  value: 0,
                  broken: true,
                  vx: Math.round(f.vx * 0.4),
                  vy: Math.round(f.vy * 0.4),
                });
                break;
              }
            }
          }
        }

        // 时间恢复流动瞬间：所有悬停斩击与动能一次性引爆结算，将猎物轰飞砸墙！
        if (f.timeStopTimer <= 0) {
          f.timeStopTimer = 0;
          f.timeStopCd = 4.05;
          f.punchCharge = 0;
          const totalDmg = Math.max(115, f.timeStopStoredDmg);
          const totalHits = Math.max(1, f.timeStopHits);
          const launchX = Math.hypot(f.timeStopDirX, f.timeStopDirY) > 0.1 ? f.timeStopDirX : foe.x - f.x;
          const launchY = Math.hypot(f.timeStopDirX, f.timeStopDirY) > 0.1 ? f.timeStopDirY : foe.y - f.y;
          f.timeStopStoredDmg = 0;
          f.timeStopHits = 0;
          f.statLabel = computeSkillBallLabel(f, 0, 0, 0, 0);

          const [kx, ky] = normalize(launchX, launchY, effectiveSpeed(foe, f) * 2.05);
          foe.vx = kx;
          foe.vy = ky;
          foe.knockbackTimer = 0.56;
          foe.knockbackFrom = f.cfg.id;
          // 冲击波同时震飞敌方史莱姆分身或伴舞分身
          for (const sp of props) {
            if (sp.owner === foe.cfg.id && sp.kind === "slime_clone") {
              const [sx, sy] = normalize(sp.x - foe.x + (rng() - 0.5) * 40, sp.y - foe.y + (rng() - 0.5) * 40, 560);
              sp.vx = sx;
              sp.vy = sy;
            }
          }
          // 钟表王自身沿侧前方切线追击拦截，杜绝反向退到对角产生空场散步真空期
          [f.vx, f.vy] = normalize(kx * 0.42 - ky * 0.72, ky * 0.42 + kx * 0.72, effectiveSpeed(f, foe));

          emit({
            tick,
            t: time,
            type: "timeStopEnd",
            id: f.cfg.id,
            target: foe.cfg.id,
            x: Math.round(foe.x),
            y: Math.round(foe.y),
            tx: Math.round(f.x),
            ty: Math.round(f.y),
            totalDmg,
            hits: totalHits,
          });
          if (applyDamage(f, foe, totalDmg, tick, "时停连斩")) break;
        }
        continue;
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
          f.latchTickCd = 0.29;
          const biteDmg = Math.round(28 + f.rageStacks * 2.9);
          const healVal = Math.round(15 + f.rageStacks * 1.5);
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
          f.latchCooldown = 1.38;
          emit({ tick, t: time, type: "latchEnd", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y) });
          const dx = foe.x - f.x;
          const dy = foe.y - f.y;
          // 吸血结束瞬间，吸血鬼将猎物狠狠甩飞出去，自身后空翻拉开身位
          [foe.vx, foe.vy] = normalize(dx, dy, effectiveSpeed(foe, f) * 1.28);
          [f.vx, f.vy] = normalize(-dx, -dy, effectiveSpeed(f, foe) * 1.15);
        }
        continue;
      }

      // 2. 全场紧凑追击物理 V4.0：全程杜绝超过 0.50s 的对角线散步真空期，让两颗主球与巨型召唤物始终在中场高燃绞杀！
      const idleLimit = time < 5.6 ? 0.36 : 0.50;
      if (
        (f.ballSkillKind === "one_punch" && f.punchCharge >= 95) ||
        (timeSinceAction > idleLimit && f.knockbackTimer <= 0)
      ) {
        const steer =
          f.ballSkillKind === "one_punch" && f.punchCharge >= 95
            ? 0.065
            : time < 5.6
              ? 0.16
              : 0.14;
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
        // 全程弹墙向猎物主动折返（前5.6s 34%，中后期 27%），彻底杜绝两球各据一角溜边冷场！
        const [rvx, rvy] = normalize(f.vx, f.vy, 1);
        const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
        const bias = time < 5.6 ? 0.34 : 0.27;
        [f.vx, f.vy] = normalize(
          rvx * (1 - bias) + tvx * bias + (rng() - 0.5) * 0.12,
          rvy * (1 - bias) + tvy * bias + (rng() - 0.5) * 0.12,
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

        // 暗影忍者王：弹墙发射巨型风魔手里剑（最多同时在场 10 枚，随进化越旋越大！）
        if (f.ballSkillKind === "ninja_shuriken") {
          const myShurikens = shurikens.filter(s => s.owner === f.cfg.id);
          if (myShurikens.length < 10 && (myShurikens.length < 6 || tick % 2 === 0)) {
            const [svx, svy] = normalize(
              foe.x - f.x + (rng() - 0.5) * 90,
              foe.y - f.y + (rng() - 0.5) * 90,
              535,
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

        // 12 位英雄 V4.0 弹墙动态增殖与巨化（100% 零地面静态杂物！）：
        const myProps = props.filter(p => p.owner === f.cfg.id);
        if (f.ballSkillKind === "alchemist_puddle") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 5) {
            const [avx, avy] = normalize(
              foe.x - f.x + (rng() - 0.5) * 110,
              foe.y - f.y + (rng() - 0.5) * 110,
              445,
            );
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "acid_puddle",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: avx,
              vy: avy,
              r: Math.round(Math.min(68, 46 + f.rageStacks * 2.0)),
              angle: 0,
              val: 5,
              hitCd: 0.18,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "bulldozer_wall") {
          f.punchCharge = Math.min(100, f.punchCharge + 10);
          if (f.rageStacks < 10 && tick % 2 === 0) {
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "snake_tail") {
          f.punchCharge = Math.min(100, f.punchCharge + 10);
          f.snakeBounceCount += 1;
          const curSegs = myProps.filter(p => p.kind === "snake_seg").length;
          if (curSegs < 16 || f.snakeBounceCount % 2 === 0) {
            appendSnakeSegment(f, 1, tick);
          }
        } else if (f.ballSkillKind === "time_stop") {
          if (f.timeStopTimer <= 0) {
            f.punchCharge = Math.min(100, f.punchCharge + (f.timeStopCd > 0 ? 4 : 10));
            f.statLabel = computeSkillBallLabel(f, 0, 0, 0, 0);
          }
        } else if (f.ballSkillKind === "slime_split") {
          const [tvx, tvy] = normalize(foe.x - f.x, foe.y - f.y, 1);
          const [cvx, cvy] = normalize(f.vx, f.vy, 1);
          [f.vx, f.vy] = normalize(cvx * 0.76 + tvx * 0.24, cvy * 0.76 + tvy * 0.24, effectiveSpeed(f, foe) * 1.06);
        } else if (f.ballSkillKind === "billiard_bank") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 7) {
            const [bvx, bvy] = normalize(foe.x - f.x + (rng() - 0.5) * 90, foe.y - f.y + (rng() - 0.5) * 90, 495);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "pool_ball",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: bvx,
              vy: bvy,
              r: Math.round(Math.min(46, 36 + f.rageStacks * 1.0)),
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.16,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "graffiti_paint") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 6) {
            const [pvx, pvy] = normalize(foe.x - f.x + (rng() - 0.5) * 105, foe.y - f.y + (rng() - 0.5) * 105, 465);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "paint_splat",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: pvx,
              vy: pvy,
              r: Math.round(Math.min(68, 46 + f.rageStacks * 2.0)),
              angle: rng() * Math.PI,
              val: 6,
              hitCd: 0.18,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "kebab_skewer") {
          f.punchCharge = Math.min(100, f.punchCharge + 12);
        } else if (f.ballSkillKind === "pinball_bumper") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 7) {
            const [evx, evy] = normalize(foe.x - f.x + (rng() - 0.5) * 95, foe.y - f.y + (rng() - 0.5) * 95, 545);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "pool_ball",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: evx,
              vy: evy,
              r: Math.round(Math.min(46, 38 + f.rageStacks * 0.9)),
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.14,
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "beyblade_orbit") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 4) {
            const [svx, svy] = normalize(foe.x - f.x + (rng() - 0.5) * 85, foe.y - f.y + (rng() - 0.5) * 85, 535);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "sub_beyblade",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: svx,
              vy: svy,
              r: Math.round(Math.min(46, 36 + f.rageStacks * 1.1)),
              angle: 0,
              val: myProps.length + 1,
              hitCd: 0.16,
              tx: Math.round(f.x),
              ty: Math.round(f.y),
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "fireman_hose") {
          f.punchCharge = Math.min(100, f.punchCharge + 12);
        } else if (f.ballSkillKind === "voodoo_doll") {
          f.punchCharge = Math.min(100, f.punchCharge + 9);
          if (myProps.length < 4) {
            const [vvx, vvy] = normalize(foe.x - f.x + (rng() - 0.5) * 100, foe.y - f.y + (rng() - 0.5) * 100, 455);
            props.push({
              id: nextPropId++,
              owner: f.cfg.id,
              kind: "voodoo_effigy",
              x: Math.round(f.x),
              y: Math.round(f.y),
              vx: vvx,
              vy: vvy,
              r: Math.round(Math.min(64, 46 + f.rageStacks * 1.6)),
              angle: 0,
              val: 1,
              hitCd: 0.18,
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
            });
            evolveBall(f, tick);
          }
        } else if (f.ballSkillKind === "boxer_rope") {
          // 弹力拳击手：边绳弹弓加速，每次撞墙以 1.34 倍极速直射对手！
          f.punchCharge = Math.min(100, f.punchCharge + 11);
          const [dvx, dvy] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(f, foe) * 1.34);
          f.vx = dvx;
          f.vy = dvy;
        }

        // 被「认真一拳」、「冠军勾拳」、「飞箱重击」或「超载电磁炮」轰飞期间撞墙：触发单次「撞墙粉碎」二段伤害！
        if (f.knockbackTimer > 0 && f.knockbackFrom) {
          const puncher = f.knockbackFrom === "A" ? A : B;
          f.knockbackFrom = null;
          const slamDmg = Math.round(36 + puncher.rageStacks * 3.4);
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

      // 旋转烤肉王 V4.0：贯穿全身高速旋转且越打越巨化的「四十米烈焰铁签」（使用 counterCd 独立冷却，不影响贴身碰撞！）
      if (f.ballSkillKind === "kebab_skewer" && foe.alive) {
        const skDir = f.cfg.id === "A" ? 1 : -1;
        f.weaponAngle = (time * (5.4 + f.rageStacks * 0.22) * skDir) % (Math.PI * 2);
        const halfSpan = 112 + f.rageStacks * 22;
        const cosA = Math.cos(f.weaponAngle);
        const sinA = Math.sin(f.weaponAngle);
        const kx0 = f.x - cosA * halfSpan;
        const ky0 = f.y - sinA * halfSpan;
        const kx1 = f.x + cosA * halfSpan;
        const ky1 = f.y + sinA * halfSpan;
        const skHit = pointToSegment(foe.x, foe.y, kx0, ky0, kx1, ky1);
        if (skHit.dist <= BALL_R * foe.bodyScale + 18 && f.counterCd <= 0) {
          f.counterCd = 0.60;
          evolveBall(f, tick);
          const heal = 8;
          f.hp = Math.min(f.cfg.maxHp, f.hp + heal);
          emit({ tick, t: time, type: "heal", id: f.cfg.id, value: heal, hp: f.hp, text: `+${heal}`, x: Math.round(f.x), y: Math.round(f.y) });
          const tangAng = f.weaponAngle + skDir * (Math.PI * 0.45);
          const [kx, ky] = normalize(Math.cos(tangAng), Math.sin(tangAng), effectiveSpeed(foe, f) * 1.15);
          foe.vx = foe.vx * 0.48 + kx * 0.52;
          foe.vy = foe.vy * 0.48 + ky * 0.52;
          const skDmg = Math.round(34 + f.rageStacks * 3.2);
          emit({
            tick,
            t: time,
            type: "skill",
            id: f.cfg.id,
            target: foe.cfg.id,
            name: "烈焰穿串",
            x: Math.round(skHit.cx),
            y: Math.round(skHit.cy),
            fx: "whirl",
          });
          if (applyDamage(f, foe, skDmg, tick, `烈焰穿串 -${skDmg}`)) break;
        }
      }

      // 弹力拳击手 V4.0：越打越长的百米伸缩弹簧冠军巨拳（使用 counterCd 独立冷却，大招才附带撞墙粉碎！）
      if (f.ballSkillKind === "boxer_rope" && foe.alive) {
        const aimA = Math.atan2(foe.y - f.y, foe.x - f.x);
        f.weaponAngle = aimA;
        const gloveReach = 92 + f.rageStacks * 16;
        const gloveR = 24 + f.rageStacks * 2.2;
        const distFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distFoe <= gloveReach + BALL_R * foe.bodyScale + gloveR * 0.52 && f.counterCd <= 0) {
          f.counterCd = 0.94;
          evolveBall(f, tick);
          const [kx, ky] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * 1.22);
          foe.vx = foe.vx * 0.40 + kx * 0.60;
          foe.vy = foe.vy * 0.40 + ky * 0.60;
          const fistDmg = Math.round(26 + f.rageStacks * 2.3);
          emit({
            tick,
            t: time,
            type: "skill",
            id: f.cfg.id,
            target: foe.cfg.id,
            name: "弹簧巨拳",
            x: Math.round(foe.x),
            y: Math.round(foe.y),
            fx: "bolt",
          });
          if (applyDamage(f, foe, fistDmg, tick, `弹簧巨拳 -${fistDmg}`)) break;
        }
      }

      // 暴躁消防员 V4.0：随身扫射且越打越粗长的巨型高压水龙激流炮（使用 counterCd 独立冷却，均衡冲退！）
      if (f.ballSkillKind === "fireman_hose" && foe.alive) {
        const jetAng = Math.atan2(foe.y - f.y, foe.x - f.x) + Math.sin(time * 4.2) * 0.28;
        f.weaponAngle = jetAng;
        const jetLen = 190 + f.rageStacks * 19;
        const jx = f.x + Math.cos(jetAng) * jetLen;
        const jy = f.y + Math.sin(jetAng) * jetLen;
        const jetHit = pointToSegment(foe.x, foe.y, f.x, f.y, jx, jy);
        if (jetHit.dist <= BALL_R * foe.bodyScale + 24 && f.counterCd <= 0) {
          f.counterCd = 0.78;
          evolveBall(f, tick);
          const [kx, ky] = normalize(Math.cos(jetAng), Math.sin(jetAng), effectiveSpeed(foe, f) * 1.26);
          foe.vx = foe.vx * 0.42 + kx * 0.58;
          foe.vy = foe.vy * 0.42 + ky * 0.58;
          const hoseDmg = Math.round(28 + f.rageStacks * 2.5);
          emit({
            tick,
            t: time,
            type: "skill",
            id: f.cfg.id,
            target: foe.cfg.id,
            name: "百吨水炮",
            x: Math.round(jetHit.cx),
            y: Math.round(jetHit.cy),
            fx: "bolt",
          });
          if (applyDamage(f, foe, hoseDmg, tick, `水龙轰击 -${hoseDmg}`)) break;
        }
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

      // 急冻冰霜王：释放「绝对零度」极寒冰环，紧凑 0.48s 冰封破冰连击，杜绝长时静止冷场！
      if (f.ballSkillKind === "frost_freeze" && time >= 1.65 && f.freezeCd <= 0 && foe.alive) {
        const maxR = 320 + f.rageStacks * 16;
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distToFoe <= maxR * 0.94) {
          f.freezeCd = Math.max(1.88, 2.38 - f.rageStacks * 0.04);
          f.punchCharge = 0;
          emit({ tick, t: time, type: "frostNova", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
          const freezeDur = 0.48 + Math.min(0.10, f.rageStacks * 0.012);
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

      // 广场舞老太：周期性外放高音蓝牙震波环 + 召唤最多 6 名伴舞大妈分身球
      if (f.ballSkillKind === "dance_granny" && f.soundWaveCd <= 0 && foe.alive) {
        f.soundWaveCd = Math.max(1.18, 1.58 - f.rageStacks * 0.04);
        const maxR = 305 + f.rageStacks * 18;
        emit({ tick, t: time, type: "soundWave", id: f.cfg.id, x: Math.round(f.x), y: Math.round(f.y), maxR });
        const distToFoe = Math.hypot(foe.x - f.x, foe.y - f.y);
        if (distToFoe <= maxR * 0.94) {
          const waveDmg = Math.round(25 + f.rageStacks * 2.6);
          const pushScale = foe.ballSkillKind === "one_punch" && foe.punchCharge >= 95 ? 0.55 : 1.08;
          if (pushScale > 0.8) {
            const [px, py] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * pushScale);
            foe.vx = px;
            foe.vy = py;
          }
          evolveBall(f, tick);
          const myClones = clones.filter(c => c.owner === f.cfg.id);
          if (myClones.length < 6 && f.rageStacks >= myClones.length) {
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
      if (victim.timeStopTimer > 0 && victim.alive) continue;
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
        // 若一拳光头或时停钟表王冲撞踩中粘性剧毒蛛丝，蛛网粘滞会阻滞齿轮/拳势充能
        if (victim.ballSkillKind === "one_punch") {
          victim.punchCharge = Math.max(0, victim.punchCharge - 5);
        } else if (victim.ballSkillKind === "time_stop") {
          victim.punchCharge = Math.max(0, victim.punchCharge - 3);
        }
        const webDmg = Math.round(24 + spider.rageStacks * 2.3);
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
        const foe = c.owner === "A" ? B : A;
        const owner = c.owner === "A" ? A : B;
        if (foe.timeStopTimer > 0 && foe.alive) continue;
        c.hitCd = Math.max(0, c.hitCd - DT);
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
        const foe = s.owner === "A" ? B : A;
        const owner = s.owner === "A" ? A : B;
        if (foe.timeStopTimer > 0 && foe.alive) continue;
        s.hitCd = Math.max(0, s.hitCd - DT);
        s.angle = (s.angle + 16 * DT) % (Math.PI * 2);
        const [tvx, tvy] = normalize(foe.x - s.x, foe.y - s.y, 1);
        const [cvx, cvy] = normalize(s.vx, s.vy, 1);
        [s.vx, s.vy] = normalize(cvx * 0.94 + tvx * 0.06, cvy * 0.94 + tvy * 0.06, 525);
        s.x += s.vx * DT;
        s.y += s.vy * DT;
        if (s.x < 44 || s.x > ARENA_W - 44) s.vx *= -1;
        if (s.y < 44 || s.y > ARENA_H - 44) s.vy *= -1;
        s.x = clamp(s.x, 44, ARENA_W - 44);
        s.y = clamp(s.y, 44, ARENA_H - 44);

        const shR = 32 + owner.rageStacks * 2.3;
        const d = Math.hypot(foe.x - s.x, foe.y - s.y);
        if (d <= BALL_R * foe.bodyScale + shR && s.hitCd <= 0 && foe.subHitCd <= 0 && foe.alive) {
          s.hitCd = 0.77;
          foe.subHitCd = 0.24;
          const [bx, by] = normalize(s.x - foe.x + (rng() - 0.5) * 40, s.y - foe.y + (rng() - 0.5) * 40, 540);
          s.vx = bx;
          s.vy = by;
          const shurikenDmg = Math.round(18.5 + owner.rageStacks * 1.72);
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

    // 5c. 更新场地机关与实体物理碰撞（100% 动态巨化物理碰撞生效，0 地面静态杂物！）
    if (props.length > 0) {
      // 5c-0. 吞天贪吃蛇：按头->尾顺序解算 IK 铰链蛇身跟随约束 + 100% 刚性不穿模盘绕碰撞！
      for (const snakeOwner of [A, B]) {
        if (!snakeOwner.alive || snakeOwner.ballSkillKind !== "snake_tail") continue;
        const snakeFoe = snakeOwner === A ? B : A;
        if (!snakeFoe.alive) break;
        if (snakeFoe.timeStopTimer > 0) continue;

        const mySegs = props
          .filter(p => p.owner === snakeOwner.cfg.id && p.kind === "snake_seg")
          .sort((a, b) => a.val - b.val);
        for (let k = 0; k < mySegs.length; k++) {
          const seg = mySegs[k];
          seg.hitCd = Math.max(0, seg.hitCd - DT);
          const parentX = k === 0 ? snakeOwner.x : mySegs[k - 1].x;
          const parentY = k === 0 ? snakeOwner.y : mySegs[k - 1].y;
          const targetGap = k === 0 ? 54 : 42;
          const sdx = seg.x - parentX;
          const sdy = seg.y - parentY;
          const sdist = Math.max(0.001, Math.hypot(sdx, sdy));
          seg.x = clamp(parentX + (sdx / sdist) * targetGap, 44, ARENA_W - 44);
          seg.y = clamp(parentY + (sdy / sdist) * targetGap, 44, ARENA_H - 44);
          seg.r = Math.round(clamp(44 + snakeOwner.rageStacks * 0.7 - k * 0.45, 31, 48));
          seg.val = k;
          seg.angle = Math.atan2(parentY - seg.y, parentX - seg.x);
          seg.tx = Math.round(parentX);
          seg.ty = Math.round(parentY);

          // 1) 敌方史莱姆分身撞上蛇身鳞甲 -> 100% 刚性弹开绝不穿模，且分身啃咬蛇尾末梢可造成群殴磨血！
          let snakeKilledByClone = false;
          for (const sp of props) {
            if (sp.owner === snakeFoe.cfg.id && sp.kind === "slime_clone") {
              const dClone = Math.hypot(sp.x - seg.x, sp.y - seg.y);
              const minCloneDist = sp.r + seg.r;
              if (dClone <= minCloneDist) {
                const cd = Math.max(0.001, dClone);
                const cnx = (sp.x - seg.x) / cd;
                const cny = (sp.y - seg.y) / cd;
                sp.x = clamp(seg.x + cnx * (minCloneDist + 4), 52, ARENA_W - 52);
                sp.y = clamp(seg.y + cny * (minCloneDist + 4), 52, ARENA_H - 52);
                const cSpd = Math.max(470, Math.hypot(sp.vx, sp.vy));
                [sp.vx, sp.vy] = normalize(cnx, cny, cSpd);
                if (sp.hitCd <= 0 && snakeOwner.subHitCd <= 0 && k >= Math.max(4, mySegs.length - 4)) {
                  sp.hitCd = 0.68;
                  snakeOwner.subHitCd = 0.25;
                  const gnawDmg = Math.round(18 + snakeFoe.splitStage * 2.0 + snakeFoe.rageStacks * 1.4);
                  emit({
                    tick,
                    t: time,
                    type: "propHit",
                    id: snakeFoe.cfg.id,
                    target: snakeOwner.cfg.id,
                    propKind: "slime_clone",
                    x: Math.round(sp.x),
                    y: Math.round(sp.y),
                    tx: Math.round(seg.x),
                    ty: Math.round(seg.y),
                    tag: "群殴啃尾",
                    value: gnawDmg,
                  });
                  if (applyDamage(snakeFoe, snakeOwner, gnawDmg, tick, "群殴啃尾", false)) {
                    snakeKilledByClone = true;
                    break;
                  }
                }
              }
            }
          }
          if (snakeKilledByClone || !snakeOwner.alive) break;

          // 1b) 敌方巨型手里剑撞上蛇身鳞甲 -> 物理刚性弹射火花 + 削尾反馈！
          const shHitR = 26 + snakeFoe.rageStacks * 1.8;
          for (const sh of shurikens) {
            if (sh.owner === snakeFoe.cfg.id) {
              const dSh = Math.hypot(sh.x - seg.x, sh.y - seg.y);
              if (dSh <= seg.r + shHitR) {
                const sd = Math.max(0.001, dSh);
                const snx = (sh.x - seg.x) / sd;
                const sny = (sh.y - seg.y) / sd;
                sh.x = clamp(seg.x + snx * (seg.r + shHitR + 4), 52, ARENA_W - 52);
                sh.y = clamp(seg.y + sny * (seg.r + shHitR + 4), 52, ARENA_H - 52);
                [sh.vx, sh.vy] = normalize(snx + (rng() - 0.5) * 0.25, sny + (rng() - 0.5) * 0.25, 545);
                if (sh.hitCd <= 0 && snakeOwner.subHitCd <= 0 && k === mySegs.length - 1) {
                  sh.hitCd = 1.08;
                  snakeOwner.subHitCd = 0.36;
                  const cutDmg = Math.round(12 + snakeFoe.rageStacks * 1.1);
                  emit({
                    tick,
                    t: time,
                    type: "propHit",
                    id: snakeFoe.cfg.id,
                    target: snakeOwner.cfg.id,
                    propKind: "shuriken",
                    x: Math.round(sh.x),
                    y: Math.round(sh.y),
                    tx: Math.round(seg.x),
                    ty: Math.round(seg.y),
                    tag: "飞剑斩鳞",
                    value: cutDmg,
                  });
                  if (applyDamage(snakeFoe, snakeOwner, cutDmg, tick, "飞剑斩鳞", false)) {
                    snakeKilledByClone = true;
                    break;
                  }
                }
              }
            }
          }
          if (snakeKilledByClone || !snakeOwner.alive) break;

          // 2) 敌方主球撞上蛇身鳞甲 -> 刚性弹床反弹 + 鳞甲绞杀扣血与微回血！
          const foeR = BALL_R * snakeFoe.bodyScale;
          const dFoeSeg = Math.hypot(snakeFoe.x - seg.x, snakeFoe.y - seg.y);
          if (dFoeSeg <= foeR + seg.r) {
            const fd = Math.max(0.001, dFoeSeg);
            const fnx = (snakeFoe.x - seg.x) / fd;
            const fny = (snakeFoe.y - seg.y) / fd;
            snakeFoe.x = clamp(seg.x + fnx * (foeR + seg.r + 5), foeR + WALL_PAD, ARENA_W - foeR - WALL_PAD);
            snakeFoe.y = clamp(seg.y + fny * (foeR + seg.r + 5), foeR + WALL_PAD, ARENA_H - foeR - WALL_PAD);
            [snakeFoe.vx, snakeFoe.vy] = normalize(
              fnx + (rng() - 0.5) * 0.16,
              fny + (rng() - 0.5) * 0.16,
              effectiveSpeed(snakeFoe, snakeOwner) * 1.24,
            );
            if (seg.hitCd <= 0 && snakeFoe.subHitCd <= 0) {
              seg.hitCd = 0.50;
              snakeFoe.subHitCd = 0.20;
              const coilDmg = Math.round(43 + snakeOwner.rageStacks * 3.6);
              if (k % 2 === 0) {
                const heal = 4;
                snakeOwner.hp = Math.min(snakeOwner.cfg.maxHp, snakeOwner.hp + heal);
                emit({ tick, t: time, type: "heal", id: snakeOwner.cfg.id, value: heal, hp: snakeOwner.hp, text: `+${heal}`, x: Math.round(snakeOwner.x), y: Math.round(snakeOwner.y) });
              }
              emit({
                tick,
                t: time,
                type: "propHit",
                id: snakeOwner.cfg.id,
                target: snakeFoe.cfg.id,
                propKind: "snake_seg",
                x: Math.round(seg.x),
                y: Math.round(seg.y),
                tx: Math.round(snakeFoe.x),
                ty: Math.round(snakeFoe.y),
                tag: "鳞甲绞杀",
                value: coilDmg,
              });
              if (applyDamage(snakeOwner, snakeFoe, coilDmg, tick, "鳞甲绞杀", false)) break;
            }
          }
        }
      }

      if (!A.alive || !B.alive) break;

      for (let i = props.length - 1; i >= 0; i--) {
        const p = props[i];
        if (!p) continue;
        if (p.kind === "snake_seg") continue;
        const owner = p.owner === "A" ? A : B;
        const foe = p.owner === "A" ? B : A;
        if (!owner.alive || !foe.alive) break;
        // 若对手正在开启「时间静止」，己方所有分身/飞镖/机关全部静止定格！
        if (foe.timeStopTimer > 0) continue;
        p.hitCd = Math.max(0, p.hitCd - DT);

        if (p.kind === "slime_clone") {
          // 分裂史莱姆分身群：Q弹果冻弹跳 + 同伴排斥分散（杜绝重叠成一团）+ 围殴反弹！
          const stage = Math.max(1, owner.splitStage);
          p.val = stage;
          const targetSpd = 465 + stage * 36;
          let sepX = 0;
          let sepY = 0;
          // 与母体保持弹性间距
          const dMom = Math.hypot(p.x - owner.x, p.y - owner.y);
          const minMom = BALL_R * owner.bodyScale + p.r + 16;
          if (dMom < minMom && dMom > 0.01) {
            sepX += ((p.x - owner.x) / dMom) * 1.4;
            sepY += ((p.y - owner.y) / dMom) * 1.4;
          }
          // 与其他史莱姆同伴互相弹开，铺满全场形成包围网
          for (const sib of props) {
            if (sib !== p && sib.owner === p.owner && sib.kind === "slime_clone") {
              const dSib = Math.hypot(p.x - sib.x, p.y - sib.y);
              const minSib = p.r + sib.r + 18;
              if (dSib < minSib && dSib > 0.01) {
                sepX += ((p.x - sib.x) / dSib) * 1.2;
                sepY += ((p.y - sib.y) / dSib) * 1.2;
              }
            }
          }
          const [cvx, cvy] = normalize(p.vx || 420, p.vy || 360, 1);
          const [tvx, tvy] = normalize(foe.x - p.x, foe.y - p.y, 1);
          [p.vx, p.vy] = normalize(
            cvx * 0.90 + tvx * 0.06 + sepX * 0.16,
            cvy * 0.90 + tvy * 0.06 + sepY * 0.16,
            targetSpd,
          );
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          const pad = p.r + WALL_PAD;
          if (p.x < pad) { p.x = pad; p.vx = Math.abs(p.vx); }
          if (p.x > ARENA_W - pad) { p.x = ARENA_W - pad; p.vx = -Math.abs(p.vx); }
          if (p.y < pad) { p.y = pad; p.vy = Math.abs(p.vy); }
          if (p.y > ARENA_H - pad) { p.y = ARENA_H - pad; p.vy = -Math.abs(p.vy); }
          p.angle = Math.atan2(p.vy, p.vx);

          // 若对手是剧毒蜘蛛王：史莱姆分身撞上弹性蛛丝会触发物理蹦床弹射并拨动琴弦（压满8球时还能压断外围蛛丝！）
          if (foe.ballSkillKind === "spider_web" && webs.length > 0) {
            for (let wi = webs.length - 1; wi >= 0; wi--) {
              const w = webs[wi];
              if (w.owner !== foe.cfg.id || w.hitCd > 0) continue;
              const wh = pointToSegment(p.x, p.y, w.x1, w.y1, w.x2, w.y2);
              if (wh.dist <= p.r + 6) {
                w.hitCd = 0.34;
                const sdx = w.x2 - w.x1;
                const sdy = w.y2 - w.y1;
                const slen = Math.max(1, Math.hypot(sdx, sdy));
                let wnx = -sdy / slen;
                let wny = sdx / slen;
                if (p.vx * wnx + p.vy * wny > 0) {
                  wnx = -wnx;
                  wny = -wny;
                }
                [p.vx, p.vy] = normalize(p.vx * 0.32 + wnx * 440, p.vy * 0.32 + wny * 440, targetSpd * 1.12);
                p.angle = Math.atan2(p.vy, p.vx);
                let snapped = false;
                if (w.hp < 500 && webs.length > 4) {
                  w.hp -= 1;
                  if (w.hp <= 0) {
                    webs.splice(wi, 1);
                    snapped = true;
                    const myWebs = webs.filter(item => item.owner === foe.cfg.id).length;
                    foe.statLabel = computeSkillBallLabel(foe, myWebs, 0);
                  }
                }
                emit({
                  tick,
                  t: time,
                  type: "webHit",
                  webId: w.id,
                  id: foe.cfg.id,
                  target: owner.cfg.id,
                  x: Math.round(wh.cx),
                  y: Math.round(wh.cy),
                  value: 0,
                  broken: snapped,
                  vx: Math.round(p.vx * 0.65),
                  vy: Math.round(p.vy * 0.65),
                });
                break;
              }
            }
          }

          const foeR = BALL_R * foe.bodyScale;
          const dFoeClone = Math.hypot(foe.x - p.x, foe.y - p.y);
          if (dFoeClone <= foeR + p.r) {
            const fd = Math.max(0.001, dFoeClone);
            const nx = (p.x - foe.x) / fd;
            const ny = (p.y - foe.y) / fd;
            p.x = clamp(foe.x + nx * (foeR + p.r + 4), pad, ARENA_W - pad);
            p.y = clamp(foe.y + ny * (foeR + p.r + 4), pad, ARENA_H - pad);
            [p.vx, p.vy] = normalize(nx + (rng() - 0.5) * 0.25, ny + (rng() - 0.5) * 0.25, targetSpd * 1.08);
            const [fkx, fky] = normalize(-nx, -ny, effectiveSpeed(foe, owner) * 1.06);
            foe.vx = foe.vx * 0.72 + fkx * 0.28;
            foe.vy = foe.vy * 0.72 + fky * 0.28;

            if (p.hitCd <= 0 && foe.subHitCd <= 0) {
              p.hitCd = 0.72;
              foe.subHitCd = 0.24;
              if (owner.rageStacks < 12 && tick % 3 === 0) {
                evolveBall(owner, tick);
              }
              const webClearBonus = foe.ballSkillKind === "spider_web" ? 3 : 0;
              const slimeDmg = Math.round(19 + webClearBonus + stage * 2.0 + owner.rageStacks * 1.5);
              emit({
                tick,
                t: time,
                type: "propHit",
                id: owner.cfg.id,
                target: foe.cfg.id,
                propKind: "slime_clone",
                x: Math.round(p.x),
                y: Math.round(p.y),
                tx: Math.round(foe.x),
                ty: Math.round(foe.y),
                tag: "分裂围殴",
                value: slimeDmg,
              });
              if (applyDamage(owner, foe, slimeDmg, tick, "分裂围殴", false)) break;
            }
          }
          continue;
        } else if (p.kind === "wrecking_ball") {
          // 暴走拆迁队 V4.0：1~3颗越战越巨化的锁链流星大铁球围绕本体高速旋转横扫！
          const spinDir = owner.cfg.id === "A" ? 1 : -1;
          const spinSpd = 5.6 + owner.rageStacks * 0.26;
          p.angle = (p.angle + spinDir * spinSpd * DT) % (Math.PI * 2);
          const chainLen = 156 + owner.rageStacks * 8;
          p.r = Math.round(46 + owner.rageStacks * 2.2);
          p.x = clamp(owner.x + Math.cos(p.angle) * chainLen, 48, ARENA_W - 48);
          p.y = clamp(owner.y + Math.sin(p.angle) * chainLen, 48, ARENA_H - 48);
          p.tx = Math.round(owner.x);
          p.ty = Math.round(owner.y);

          // 拆迁铁球直接砸中对手球体 -> 真实重锤伤害 + 切向甩动！
          const dFoeBall = Math.hypot(foe.x - p.x, foe.y - p.y);
          if (dFoeBall <= BALL_R * foe.bodyScale + p.r && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.90;
            foe.subHitCd = 0.30;
            evolveBall(owner, tick);
            const smashDmg = Math.round(24 + owner.rageStacks * 2.0);
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
        } else if (p.kind === "pool_ball" || p.kind === "sub_beyblade" || p.kind === "acid_puddle" || p.kind === "paint_splat") {
          const spd =
            p.kind === "sub_beyblade"
              ? 535
              : p.kind === "pool_ball"
                ? owner.ballSkillKind === "pinball_bumper"
                  ? 545
                  : 495
                : p.kind === "paint_splat"
                  ? 465
                  : 445;
          const steer = p.kind === "sub_beyblade" ? 0.024 : 0.018;
          const [cvx, cvy] = normalize(p.vx || 420, p.vy || 340, 1);
          const [tvx, tvy] = normalize(foe.x - p.x, foe.y - p.y, 1);
          [p.vx, p.vy] = normalize(cvx * (1 - steer) + tvx * steer, cvy * (1 - steer) + tvy * steer, spd);
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          if (p.kind === "acid_puddle" || p.kind === "paint_splat") {
            p.r = Math.round(clamp(46 + owner.rageStacks * 2.0, 44, 68));
          } else if (p.kind === "sub_beyblade") {
            p.r = Math.round(clamp(36 + owner.rageStacks * 1.1, 34, 48));
          } else {
            const basePoolR = owner.ballSkillKind === "pinball_bumper" ? 38 : 36;
            p.r = Math.round(clamp(basePoolR + owner.rageStacks * 0.9, 36, 48));
          }
          const padP = p.r + 16;
          if (p.x < padP) { p.x = padP; p.vx = Math.abs(p.vx); }
          if (p.x > ARENA_W - padP) { p.x = ARENA_W - padP; p.vx = -Math.abs(p.vx); }
          if (p.y < padP) { p.y = padP; p.vy = Math.abs(p.vy); }
          if (p.y > ARENA_H - padP) { p.y = ARENA_H - padP; p.vy = -Math.abs(p.vy); }
          if (p.kind === "sub_beyblade") {
            p.angle = (p.angle + 12 * DT) % (Math.PI * 2);
            p.tx = Math.round(owner.x);
            p.ty = Math.round(owner.y);
          } else {
            p.angle = Math.atan2(p.vy, p.vx);
          }
        } else if (p.kind === "voodoo_effigy") {
          const [cvx, cvy] = normalize(p.vx || 410, p.vy || 340, 1);
          const [tvx, tvy] = normalize(foe.x - p.x, foe.y - p.y, 1);
          [p.vx, p.vy] = normalize(cvx * 0.975 + tvx * 0.025, cvy * 0.975 + tvy * 0.025, 455);
          p.x += p.vx * DT;
          p.y += p.vy * DT;
          p.r = Math.round(clamp(46 + owner.rageStacks * 1.6, 44, 64));
          const padV = p.r + 18;
          if (p.x < padV) { p.x = padV; p.vx = Math.abs(p.vx); }
          if (p.x > ARENA_W - padV) { p.x = ARENA_W - padV; p.vx = -Math.abs(p.vx); }
          if (p.y < padV) { p.y = padV; p.vy = Math.abs(p.vy); }
          if (p.y > ARENA_H - padV) { p.y = ARENA_H - padV; p.vy = -Math.abs(p.vy); }
          p.angle = (p.angle + 10 * DT) % (Math.PI * 2);
          p.tx = Math.round(foe.x);
          p.ty = Math.round(foe.y);
          p.curseTimer = (p.curseTimer ?? (0.95 + (p.id % 3) * 0.55)) - DT;

          const dOwner = Math.hypot(owner.x - p.x, owner.y - p.y);
          const dFoe = Math.hypot(foe.x - p.x, foe.y - p.y);

          // 1) 周期性自动扎针传导：咒偶高速巡游期间自动扎针，轰出紫红诅咒闪电击中对手并吸取生命！
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

          // 2) 巫毒师本体撞击索命飞偶 -> 弹性加速反弹 + 触发重型金针贯穿暴击
          if (dOwner <= BALL_R * owner.bodyScale + p.r + 8 && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.72;
            foe.subHitCd = 0.26;
            evolveBall(owner, tick);
            const [obx, oby] = normalize(owner.x - p.x + (foe.x - owner.x) * 0.45, owner.y - p.y + (foe.y - owner.y) * 0.45, effectiveSpeed(owner, foe) * 1.18);
            owner.vx = obx;
            owner.vy = oby;
            const [pvx, pvy] = normalize(foe.x - p.x, foe.y - p.y, 495);
            p.vx = pvx;
            p.vy = pvy;
            const curseDmg = Math.round(27 + owner.rageStacks * 2.4);
            const heal = Math.round(8 + owner.rageStacks * 0.7);
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

          // 3) 对手撞上索命飞偶 -> 刚性弹开不穿模 + 咒偶反噬震退
          if (dFoe <= BALL_R * foe.bodyScale + p.r + 4 && p.hitCd <= 0 && foe.subHitCd <= 0) {
            p.hitCd = 0.70;
            foe.subHitCd = 0.26;
            evolveBall(owner, tick);
            const [bx, by] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.32);
            foe.vx = bx;
            foe.vy = by;
            const [pbx, pby] = normalize(p.x - foe.x, p.y - foe.y, 470);
            p.vx = pbx;
            p.vy = pby;
            foe.slowTimer = Math.max(foe.slowTimer, 0.55);
            const trapDmg = Math.round(25 + owner.rageStacks * 2.2);
            const heal = Math.round(7 + owner.rageStacks * 0.6);
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
        } else {
          p.angle = (p.angle + 10 * DT) % (Math.PI * 2);
        }

        // 检查动态巨化弹体与对手的物理碰撞反弹
        const dFoe = Math.hypot(foe.x - p.x, foe.y - p.y);
        if (dFoe <= BALL_R * foe.bodyScale + p.r && p.hitCd <= 0 && foe.subHitCd <= 0) {
          p.hitCd = 0.72;
          foe.subHitCd = 0.25;
          if (p.kind === "acid_puddle") {
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, 465);
            p.vx = bx;
            p.vy = by;
            foe.slowTimer = 0.68;
            foe.vx *= 0.68;
            foe.vy *= 0.68;
            evolveBall(owner, tick);
            const acidDmg = Math.round(27 + owner.rageStacks * 2.4);
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
            if (applyDamage(owner, foe, acidDmg, tick, "强酸腐蚀")) break;
          } else if (p.kind === "pool_ball") {
            const isElectric = owner.ballSkillKind === "pinball_bumper";
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, isElectric ? 560 : 515);
            p.vx = bx;
            p.vy = by;
            const [kx, ky] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.18);
            foe.vx = foe.vx * 0.45 + kx * 0.55;
            foe.vy = foe.vy * 0.45 + ky * 0.55;
            evolveBall(owner, tick);
            const poolDmg = Math.round(28 + owner.rageStacks * 2.5);
            const hitTag = isElectric ? "电球连击" : "桌球连撞";
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
              tag: hitTag,
              value: poolDmg,
            });
            if (applyDamage(owner, foe, poolDmg, tick, hitTag)) break;
          } else if (p.kind === "paint_splat") {
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, 485);
            p.vx = bx;
            p.vy = by;
            foe.slowTimer = 0.72;
            foe.vx *= 0.68;
            foe.vy *= 0.68;
            evolveBall(owner, tick);
            const paintDmg = Math.round(28 + owner.rageStacks * 2.5);
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
            if (applyDamage(owner, foe, paintDmg, tick, "毒漆腐蚀")) break;
          } else if (p.kind === "sub_beyblade") {
            const [bx, by] = normalize(p.x - foe.x, p.y - foe.y, 545);
            p.vx = bx;
            p.vy = by;
            const [kx, ky] = normalize(foe.x - p.x, foe.y - p.y, effectiveSpeed(foe, owner) * 1.18);
            foe.vx = foe.vx * 0.45 + kx * 0.55;
            foe.vy = foe.vy * 0.45 + ky * 0.55;
            evolveBall(owner, tick);
            const beyDmg = Math.round(26 + owner.rageStacks * 2.25);
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
        f.skillCd = 0.84;
        f.action = "skill";
        f.actionTimer = 0.42;
        evolveBall(f, tick);
        const punchDmg = Math.round(72 + f.rageStacks * 6.4);
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
        // 将对手轰飞，若撞墙则触发二段撞墙粉碎；拳风余波同时震飞史莱姆分身并可斩断长蛇末梢
        const [kx, ky] = normalize(foe.x - f.x, foe.y - f.y, effectiveSpeed(foe, f) * 2.08);
        foe.vx = kx;
        foe.vy = ky;
        foe.knockbackTimer = 0.64;
        foe.knockbackFrom = f.cfg.id;
        for (const c of clones) {
          if (c.owner === foe.cfg.id) {
            const [cx, cy] = normalize(c.x - f.x, c.y - f.y, 520);
            c.vx = cx;
            c.vy = cy;
          }
        }
        for (const sp of props) {
          if (sp.owner === foe.cfg.id && sp.kind === "slime_clone") {
            const [sx, sy] = normalize(sp.x - f.x + (rng() - 0.5) * 40, sp.y - f.y + (rng() - 0.5) * 40, 565);
            sp.vx = sx;
            sp.vy = sy;
            sp.hitCd = Math.max(sp.hitCd, 0.34);
          }
        }
        if (foe.ballSkillKind === "snake_tail" && foe.counterCd <= 0) {
          const tSegs = props
            .filter(p => p.owner === foe.cfg.id && p.kind === "snake_seg")
            .sort((a, b) => a.val - b.val);
          if (tSegs.length >= 9) {
            foe.counterCd = 2.6;
            const severCount = Math.min(2, tSegs.length - 5);
            const tailTip = tSegs[tSegs.length - 1];
            for (let sc = 0; sc < severCount; sc++) {
              const rem = tSegs.pop();
              if (rem) {
                const idx = props.indexOf(rem);
                if (idx >= 0) props.splice(idx, 1);
              }
            }
            foe.statLabel = computeSkillBallLabel(foe, 0, 0, 0, tSegs.length);
            emit({
              tick,
              t: time,
              type: "propHit",
              id: f.cfg.id,
              target: foe.cfg.id,
              propKind: "snake_sever",
              x: Math.round(tailTip.x),
              y: Math.round(tailTip.y),
              tx: Math.round(foe.x),
              ty: Math.round(foe.y),
              tag: "斩断蛇尾",
              value: severCount,
            });
          }
        }
        if (applyDamage(f, foe, punchDmg, tick, `认真一拳 -${punchDmg}`)) break;
      }
    }

    if (!A.alive || !B.alive) break;

    // 6b. 球体直接物理碰撞：100% 公平弹性碰撞与贴身技能触发（时停领域开启期间跳过常规对撞，由钟表王自由穿梭斩击）
    if (A.timeStopTimer <= 0 && B.timeStopTimer <= 0 && !A.latchedTo && !B.latchedTo && bodyDist <= minDist + 14) {
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
            // 正面硬刚贪吃蛇头部克制交互：若贪吃蛇已长到 >=9 节且断尾保护冷却完毕，对手正面撞击蛇头可斩断其末梢 2 节蛇尾！
            if (target.ballSkillKind === "snake_tail" && target.counterCd <= 0) {
              const tSegs = props
                .filter(p => p.owner === target.cfg.id && p.kind === "snake_seg")
                .sort((a, b) => a.val - b.val);
              if (tSegs.length >= 9) {
                target.counterCd = 2.85;
                const severCount = Math.min(2, tSegs.length - 4);
                const tailTip = tSegs[tSegs.length - 1];
                for (let sc = 0; sc < severCount; sc++) {
                  const rem = tSegs.pop();
                  if (rem) {
                    const idx = props.indexOf(rem);
                    if (idx >= 0) props.splice(idx, 1);
                  }
                }
                target.statLabel = computeSkillBallLabel(target, 0, 0, 0, tSegs.length);
                emit({
                  tick,
                  t: time,
                  type: "propHit",
                  id: hitter.cfg.id,
                  target: target.cfg.id,
                  propKind: "snake_sever",
                  x: Math.round(tailTip.x),
                  y: Math.round(tailTip.y),
                  tx: Math.round(target.x),
                  ty: Math.round(target.y),
                  tag: "斩断蛇尾",
                  value: severCount,
                });
              }
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
              const punchDmg = Math.round(42 + hitter.rageStacks * 3.85);
              const [kx, ky] = normalize(target.x - hitter.x, target.y - hitter.y, effectiveSpeed(target, hitter) * 1.48);
              target.vx = kx;
              target.vy = ky;
              if (applyDamage(hitter, target, punchDmg, tick, `冠军勾拳 -${punchDmg}`)) break;
            } else if (hitter.ballSkillKind === "beyblade_orbit") {
              evolveBall(hitter, tick);
              const spinDmg = Math.round(38 + hitter.rageStacks * 3.6);
              if (applyDamage(hitter, target, spinDmg, tick, `锯齿绞杀 -${spinDmg}`)) break;
            } else if (hitter.ballSkillKind === "snake_tail") {
              const fangDmg = Math.round(54 + hitter.rageStacks * 4.6);
              if (applyDamage(hitter, target, fangDmg, tick, "毒牙噬咬")) break;
            } else if (hitter.ballSkillKind === "slime_split") {
              const jellyDmg =
                hitter.splitStage === 0
                  ? Math.round(64 + hitter.rageStacks * 5.0)
                  : Math.round(46 + hitter.rageStacks * 3.8);
              if (hitter.splitStage === 0) {
                const [kx, ky] = normalize(target.x - hitter.x, target.y - hitter.y, effectiveSpeed(target, hitter) * 1.56);
                target.vx = kx;
                target.vy = ky;
                target.knockbackTimer = 0.36;
                target.knockbackFrom = hitter.cfg.id;
              }
              if (applyDamage(hitter, target, jellyDmg, tick, "果冻重压")) break;
            } else if (hitter.ballSkillKind === "time_stop") {
              hitter.punchCharge = Math.min(100, hitter.punchCharge + (hitter.timeStopCd > 0 ? 4 : 9));
              hitter.statLabel = computeSkillBallLabel(hitter, 0, 0, 0, 0);
              const gearDmg = Math.round(44 + hitter.rageStacks * 3.8);
              if (applyDamage(hitter, target, gearDmg, tick, "齿轮重击")) break;
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

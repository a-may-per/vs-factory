// duel 战斗模拟器：擂台漫游弹射模式。
// 英雄持续在空间里移动；碰墙反弹；碰到对方触发技能；技能后双方像弹球一样反弹继续漫游。
// 没有普通攻击、没有主动寻路追人。

export type Side = "A" | "B";

export interface SkillDef {
  name: string;
  cooldown: number;
  damage: number;
  rangeMul: number;
  fx: "bolt" | "whirl";
  description: string;
}

export interface PassiveDef { name: string; description: string }

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
}

export interface FighterState {
  cfg: FighterConfig;
  x: number; y: number;
  vx: number; vy: number;
  hp: number;
  facing: 1 | -1;
  skillCd: number;
  action: "idle" | "walk" | "skill" | "hit" | "death";
  actionTimer: number;
  rageStacks: number;
  alive: boolean;
}

export type SimEvent =
  | { tick: number; t: number; type: "spawn"; id: Side; name: string; title: string; x: number; y: number; color: string; color2: string; passive: string; passiveDesc: string; activeName: string; maxHp: number }
  | { tick: number; t: number; type: "move"; id: Side; x: number; y: number; facing: 1 | -1 }
  | { tick: number; t: number; type: "wallBounce"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "skill"; id: Side; target: Side; name: string; x: number; y: number; fx: SkillDef["fx"] }
  | { tick: number; t: number; type: "damage"; id: Side; value: number; from: Side; hp: number; x: number; y: number }
  | { tick: number; t: number; type: "heal"; id: Side; value: number; hp: number; text: string; x: number; y: number }
  | { tick: number; t: number; type: "buff"; id: Side; name: string; stacks: number }
  | { tick: number; t: number; type: "skillEffect"; id: Side; kind: "lifesteal" | "rage" | "bounce"; name: string; x: number; y: number; tx?: number; ty?: number; stacks?: number }
  | { tick: number; t: number; type: "death"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "end"; winner: Side; duration: number };

export const ARENA_W = 960;
export const ARENA_H = 540;
export const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MOVE_EVERY = 2;
const RADIUS = 42;

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vx: number, vy: number, speed: number): [number, number] {
  const len = Math.max(0.001, Math.hypot(vx, vy));
  return [vx / len * speed, vy / len * speed];
}

export function simulate(cfgA: FighterConfig, cfgB: FighterConfig, seed: number, maxDuration = 45): SimEvent[] {
  const events: SimEvent[] = [];
  const emit = (event: SimEvent) => events.push(event);
  const rng = mulberry32(seed);
  let time = 0;

  const makeState = (cfg: FighterConfig, x: number, y: number, angle: number): FighterState => {
    const [vx, vy] = normalize(Math.cos(angle), Math.sin(angle), cfg.speed);
    return {
      cfg, x, y, vx, vy, hp: cfg.maxHp,
      facing: vx >= 0 ? 1 : -1,
      skillCd: 0, action: "walk", actionTimer: 0,
      rageStacks: 0, alive: true,
    };
  };

  const A = makeState(cfgA, ARENA_W * 0.25, ARENA_H * 0.44, -0.35 + rng() * 0.7);
  const B = makeState(cfgB, ARENA_W * 0.75, ARENA_H * 0.66, Math.PI + 0.25 + rng() * 0.7);

  for (const f of [A, B]) {
    emit({
      tick: 0, t: 0, type: "spawn", id: f.cfg.id, name: f.cfg.name,
      title: f.cfg.title, x: f.x, y: f.y,
      color: f.cfg.color, color2: f.cfg.color2,
      passive: f.cfg.passive.name, passiveDesc: f.cfg.passive.description,
      activeName: f.cfg.active.name, maxHp: f.cfg.maxHp,
    });
  }

  function bounceWall(f: FighterState, tick: number) {
    let bounced = false;
    if (f.x < RADIUS) { f.x = RADIUS; f.vx = Math.abs(f.vx); bounced = true; }
    if (f.x > ARENA_W - RADIUS) { f.x = ARENA_W - RADIUS; f.vx = -Math.abs(f.vx); bounced = true; }
    if (f.y < ARENA_H * 0.45 + RADIUS) { f.y = ARENA_H * 0.45 + RADIUS; f.vy = Math.abs(f.vy); bounced = true; }
    if (f.y > ARENA_H - RADIUS) { f.y = ARENA_H - RADIUS; f.vy = -Math.abs(f.vy); bounced = true; }
    if (bounced) {
      // 加一点角度扰动，避免永远同一条轨道来回弹。
      const speed = f.cfg.speed;
      const jitter = (rng() - 0.5) * 0.35;
      const ang = Math.atan2(f.vy, f.vx) + jitter;
      [f.vx, f.vy] = normalize(Math.cos(ang), Math.sin(ang), speed);
      emit({ tick, t: time, type: "wallBounce", id: f.cfg.id, x: f.x, y: f.y });
    }
  }

  function bounceApart(a: FighterState, b: FighterState, strong = false) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const nx = dx / d;
    const ny = dy / d;
    const impulse = strong ? 1.35 : 1.12;
    [a.vx, a.vy] = normalize(-nx + (rng() - 0.5) * 0.35, -ny + (rng() - 0.5) * 0.35, a.cfg.speed * impulse);
    [b.vx, b.vy] = normalize(nx + (rng() - 0.5) * 0.35, ny + (rng() - 0.5) * 0.35, b.cfg.speed * impulse);
    // 直接把圆分开，避免同帧连续触发。
    const overlap = RADIUS * 2 - d + 4;
    if (overlap > 0) {
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
    }
  }

  function castSkill(caster: FighterState, target: FighterState): boolean {
    if (caster.skillCd > 0) return false;
    const skill = caster.cfg.active;
    caster.skillCd = skill.cooldown;
    caster.action = "skill";
    caster.actionTimer = 0.45;

    emit({ tick: 0, t: time, type: "skill", id: caster.cfg.id, target: target.cfg.id, name: skill.name, x: target.x, y: target.y, fx: skill.fx });

    const rageMultiplier = caster.cfg.passiveKind === "rage" ? 1 + caster.rageStacks * 0.1 : 1;
    const damage = Math.max(1, Math.round(skill.damage * rageMultiplier));
    target.hp -= damage;
    target.action = "hit";
    target.actionTimer = 0.25;
    emit({ tick: 0, t: time, type: "damage", id: target.cfg.id, value: damage, from: caster.cfg.id, hp: Math.max(0, target.hp), x: target.x, y: target.y });

    if (caster.cfg.passiveKind === "lifesteal") {
      const heal = Math.round(damage * 0.3);
      caster.hp = Math.min(caster.cfg.maxHp, caster.hp + heal);
      emit({ tick: 0, t: time, type: "heal", id: caster.cfg.id, value: heal, hp: caster.hp, text: `技能吸血 +${heal}`, x: caster.x, y: caster.y });
      emit({ tick: 0, t: time, type: "skillEffect", id: caster.cfg.id, kind: "lifesteal", name: "血影回响", x: caster.x, y: caster.y, tx: target.x, ty: target.y });
    }

    if (caster.cfg.passiveKind === "rage") {
      caster.rageStacks = Math.min(6, caster.rageStacks + 1);
      emit({ tick: 0, t: time, type: "buff", id: caster.cfg.id, name: "狂暴蓄力", stacks: caster.rageStacks });
      emit({ tick: 0, t: time, type: "skillEffect", id: caster.cfg.id, kind: "rage", name: `狂暴蓄力 ×${caster.rageStacks}`, x: caster.x, y: caster.y, stacks: caster.rageStacks });
    }

    emit({ tick: 0, t: time, type: "skillEffect", id: caster.cfg.id, kind: "bounce", name: "弹开", x: caster.x, y: caster.y, tx: target.x, ty: target.y });

    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.action = "death";
      emit({ tick: 0, t: time, type: "death", id: target.cfg.id, x: target.x, y: target.y });
      emit({ tick: 0, t: time, type: "end", winner: caster.cfg.id, duration: time });
      return true;
    }

    bounceApart(caster, target, skill.fx === "whirl");
    return false;
  }

  const maxTicks = Math.floor(TICK_RATE * maxDuration);
  for (let tick = 1; tick <= maxTicks; tick++) {
    time = tick * DT;
    for (const f of [A, B]) {
      if (!f.alive) continue;
      f.skillCd = Math.max(0, f.skillCd - DT);
      f.actionTimer = Math.max(0, f.actionTimer - DT);
      if (f.actionTimer === 0 && f.action !== "death") f.action = "walk";
      f.x += f.vx * DT;
      f.y += f.vy * DT;
      f.facing = f.vx >= 0 ? 1 : -1;
      bounceWall(f, tick);
    }

    if (A.alive && B.alive) {
      const d = Math.hypot(B.x - A.x, B.y - A.y);
      if (d <= A.cfg.contactRange || d <= B.cfg.contactRange) {
        // 接触时，冷却好了的一方先触发；都冷却好时按种子随机先手。
        const aReady = A.skillCd <= 0;
        const bReady = B.skillCd <= 0;
        if (aReady && bReady) {
          const first = rng() < 0.5 ? A : B;
          const second = first === A ? B : A;
          if (castSkill(first, second)) break;
        } else if (aReady) {
          if (castSkill(A, B)) break;
        } else if (bReady) {
          if (castSkill(B, A)) break;
        } else {
          bounceApart(A, B, false);
        }
      }
    }

    if (tick % MOVE_EVERY === 0) {
      emit({ tick, t: time, type: "move", id: "A", x: Math.round(A.x), y: Math.round(A.y), facing: A.facing });
      emit({ tick, t: time, type: "move", id: "B", x: Math.round(B.x), y: Math.round(B.y), facing: B.facing });
    }
  }
  // 超时保险：如果 45s 内没击杀，按剩余血量百分比判定。
  if (!events.some(e => e.type === "end")) {
    const aPct = A.hp / A.cfg.maxHp;
    const bPct = B.hp / B.cfg.maxHp;
    const winner = aPct >= bPct ? "A" : "B";
    emit({ tick: maxTicks, t: maxDuration, type: "end", winner, duration: maxDuration });
  }
  return events;
}

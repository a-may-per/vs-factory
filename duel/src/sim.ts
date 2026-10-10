// duel 战斗模拟器 v2：斗蛐蛐式交手节奏（突进贴近 → 交手 → 弹开 → 再接近）。
// 暴击/吸血/狂暴/闪避全部走 proc 事件，渲染层做技能式演出。
// 确定性：固定 tick + mulberry32 种子 → JSONL 事件日志，渲染器只回放。

export type Side = "A" | "B";

export interface SkillDef {
  name: string;
  cooldown: number;   // 秒
  damage: number;
  rangeMul: number;   // 施法距离 = attackRange * rangeMul
  fx: "bolt" | "whirl";
  description: string;
}

export interface PassiveDef { name: string; description: string }

export interface FighterConfig {
  id: Side;
  name: string;
  title: string;
  maxHp: number;
  attack: number;
  speed: number;          // 模拟坐标 px/s
  attackRange: number;
  attackInterval: number; // 秒
  color: string;
  color2: string;
  active: SkillDef;
  passive: PassiveDef;
  passiveKind: "lifesteal" | "rage";
  style: "aggressive" | "evasive" | "balanced";
}

export interface FighterState {
  cfg: FighterConfig;
  x: number; y: number;
  hp: number;
  facing: 1 | -1;
  attackTimer: number;
  skillCd: number;
  action: "idle" | "walk" | "attack" | "skill" | "hit" | "death";
  actionTimer: number;
  rageStacks: number;
  alive: boolean;
  kbVx: number; kbVy: number;   // 击退速度（指数衰减滑行）
  recoverT: number;             // 交手后的恢复期（期间不追击不攻击）
}

export interface SimCtx { time: number; rng: () => number }

export type SimEvent =
  | { tick: number; t: number; type: "spawn"; id: Side; name: string; title: string; x: number; y: number; color: string; color2: string; passive: string; passiveDesc: string; activeName: string }
  | { tick: number; t: number; type: "move"; id: Side; x: number; y: number; facing: 1 | -1 }
  | { tick: number; t: number; type: "attack"; id: Side; target: Side; x: number; y: number }
  | { tick: number; t: number; type: "damage"; id: Side; value: number; from: Side; hp: number; crit?: boolean; x: number; y: number }
  | { tick: number; t: number; type: "skill"; id: Side; name: string; x: number; y: number; fx: SkillDef["fx"] }
  | { tick: number; t: number; type: "heal"; id: Side; value: number; hp: number; text: string; x: number; y: number }
  | { tick: number; t: number; type: "buff"; id: Side; name: string; stacks: number }
  | { tick: number; t: number; type: "proc"; id: Side; kind: "crit" | "lifesteal" | "rage" | "dodge"; name: string; x: number; y: number; tx?: number; ty?: number; stacks?: number }
  | { tick: number; t: number; type: "fuse"; text: string }
  | { tick: number; t: number; type: "death"; id: Side; x: number; y: number }
  | { tick: number; t: number; type: "end"; winner: Side; duration: number };

export const ARENA_W = 960, ARENA_H = 540;
export const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const MOVE_EVERY = 2; // 30Hz 采样位置（击退滑行更平滑）

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulate(cfgA: FighterConfig, cfgB: FighterConfig, seed: number, maxDuration = 45): SimEvent[] {
  const events: SimEvent[] = [];
  const emit = (ev: SimEvent) => events.push(ev);
  const rng = mulberry32(seed);
  let time = 0;

  const mkState = (cfg: FighterConfig, x: number, y: number): FighterState => ({
    cfg, x, y, hp: cfg.maxHp, facing: x < ARENA_W / 2 ? 1 : -1,
    attackTimer: 0.8, skillCd: 2.5, action: "idle", actionTimer: 0,
    rageStacks: 0, alive: true, kbVx: 0, kbVy: 0, recoverT: 0,
  });

  const A = mkState(cfgA, ARENA_W * 0.24, ARENA_H * 0.58);
  const B = mkState(cfgB, ARENA_W * 0.76, ARENA_H * 0.58);

  emit({ tick: 0, t: 0, type: "spawn", id: "A", name: cfgA.name, title: cfgA.title, x: A.x, y: A.y, color: cfgA.color, color2: cfgA.color2, passive: cfgA.passive.name, passiveDesc: cfgA.passive.description, activeName: cfgA.active.name });
  emit({ tick: 0, t: 0, type: "spawn", id: "B", name: cfgB.name, title: cfgB.title, x: B.x, y: B.y, color: cfgB.color, color2: cfgB.color2, passive: cfgB.passive.name, passiveDesc: cfgB.passive.description, activeName: cfgB.active.name });

  /** 交手后弹开：受击方被击退，攻击方小幅后撤 */
  function knockback(from: FighterState, to: FighterState, kbTo: number, kbFrom: number, recTo: number, recFrom: number) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.max(0.001, Math.hypot(dx, dy));
    const ux = dx / d, uy = dy / d;
    to.kbVx = ux * kbTo; to.kbVy = uy * kbTo; to.recoverT = recTo;
    from.kbVx = -ux * kbFrom; from.kbVy = -uy * kbFrom; from.recoverT = recFrom;
  }

  function tryAttack(from: FighterState, to: FighterState, id: Side, tid: Side): boolean {
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (dist > from.cfg.attackRange || from.attackTimer > 0 || from.recoverT > 0) return false;
    // evasive 风格 10% 闪避
    if (to.cfg.style === "evasive" && rng() < 0.10) {
      emit({ tick: 0, t: time, type: "proc", id: tid, kind: "dodge", name: "闪避", x: to.x, y: to.y });
      from.attackTimer = from.cfg.attackInterval * 0.5;
      from.recoverT = 0.18;
      return false;
    }
    const roll = 0.9 + rng() * 0.2;                 // ±10% 确定性浮动
    const crit = rng() < 0.15;
    const dmg = Math.max(1, Math.round(from.cfg.attack * roll * (crit ? 1.8 : 1)));
    to.hp -= dmg;
    to.action = "hit"; to.actionTimer = 0.22;
    from.action = "attack"; from.actionTimer = 0.28;
    from.attackTimer = effectiveInterval(from);
    emit({ tick: 0, t: time, type: "attack", id, target: tid, x: from.x, y: from.y });
    emit({ tick: 0, t: time, type: "damage", id: tid, value: dmg, from: id, hp: Math.max(0, to.hp), crit, x: to.x, y: to.y });
    if (crit) emit({ tick: 0, t: time, type: "proc", id, kind: "crit", name: "会心一击", x: to.x, y: to.y });
    if (from.cfg.passiveKind === "lifesteal") {
      const heal = Math.round(dmg * 0.3);
      from.hp = Math.min(from.cfg.maxHp, from.hp + heal);
      emit({ tick: 0, t: time, type: "heal", id, value: heal, hp: Math.round(from.hp), text: `吸血 +${heal}`, x: from.x, y: from.y });
      if (heal >= 14) emit({ tick: 0, t: time, type: "proc", id, kind: "lifesteal", name: "鲜血汲取", x: from.x, y: from.y, tx: to.x, ty: to.y });
    }
    if (to.hp <= 0) {
      to.hp = 0; to.alive = false; to.action = "death";
      emit({ tick: 0, t: time, type: "death", id: tid, x: to.x, y: to.y });
      emit({ tick: 0, t: time, type: "end", winner: id, duration: time });
      return true;
    }
    knockback(from, to, crit ? 340 : 210, 90, 0.24, 0.34);
    return false;
  }

  function trySkill(from: FighterState, to: FighterState, id: Side, tid: Side): boolean {
    const sk = from.cfg.active;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    if (from.skillCd > 0 || from.recoverT > 0 || dist > from.cfg.attackRange * sk.rangeMul) return false;
    from.skillCd = sk.cooldown;
    from.action = "skill"; from.actionTimer = 0.45;
    // 突进近身
    const lungeDist = Math.max(40, from.cfg.attackRange * 0.7);
    from.x = Math.min(ARENA_W - 60, Math.max(60, to.x - ((to.x - from.x) / dist) * lungeDist));
    from.y = Math.min(ARENA_H - 60, Math.max(ARENA_H * 0.45, to.y - ((to.y - from.y) / dist) * lungeDist));
    emit({ tick: 0, t: time, type: "skill", id, name: sk.name, x: to.x, y: to.y, fx: sk.fx });
    const dmg = Math.max(1, Math.round(sk.damage));
    to.hp -= dmg;
    to.action = "hit"; to.actionTimer = 0.3;
    emit({ tick: 0, t: time, type: "damage", id: tid, value: dmg, from: id, hp: Math.max(0, to.hp), x: to.x, y: to.y });
    if (from.cfg.passiveKind === "lifesteal") {
      const heal = Math.round(dmg * 0.3);
      from.hp = Math.min(from.cfg.maxHp, from.hp + heal);
      emit({ tick: 0, t: time, type: "heal", id, value: heal, hp: Math.round(from.hp), text: `吸血 +${heal}`, x: from.x, y: from.y });
      if (heal >= 14) emit({ tick: 0, t: time, type: "proc", id, kind: "lifesteal", name: "鲜血汲取", x: from.x, y: from.y, tx: to.x, ty: to.y });
    }
    if (to.hp <= 0) {
      to.hp = 0; to.alive = false; to.action = "death";
      emit({ tick: 0, t: time, type: "death", id: tid, x: to.x, y: to.y });
      emit({ tick: 0, t: time, type: "end", winner: id, duration: time });
      return true;
    }
    knockback(from, to, 300, 90, 0.26, 0.4);
    return false;
  }

  /** 狂战士被动：生命每降 10%，攻速 +8%（上限 9 层）；层数变化走 proc 演出 */
  function effectiveInterval(st: FighterState): number {
    if (st.cfg.passiveKind !== "rage") return st.cfg.attackInterval;
    const missing = 1 - st.hp / st.cfg.maxHp;
    const stacks = Math.min(9, Math.floor(missing * 10));
    if (stacks !== st.rageStacks) {
      st.rageStacks = stacks;
      emit({ tick: 0, t: time, type: "buff", id: st.cfg.id, name: "狂暴", stacks });
      if (stacks > 0) emit({ tick: 0, t: time, type: "proc", id: st.cfg.id, kind: "rage", name: "狂暴", x: st.x, y: st.y, stacks });
    }
    return st.cfg.attackInterval * (1 - 0.08 * stacks);
  }

  function stepFighter(st: FighterState, foe: FighterState): boolean {
    if (!st.alive) return false;
    effectiveInterval(st);
    st.attackTimer -= DT;
    st.skillCd -= DT;
    st.actionTimer -= DT;
    if (st.actionTimer <= 0 && st.action !== "death") st.action = "idle";

    const dx = foe.x - st.x, dy = foe.y - st.y;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    st.facing = dx >= 0 ? 1 : -1;

    // 交手恢复期：击退滑行，不追击不攻击
    if (st.recoverT > 0) {
      st.recoverT -= DT;
      st.x = Math.min(ARENA_W - 60, Math.max(60, st.x + st.kbVx * DT));
      st.y = Math.min(ARENA_H - 60, Math.max(ARENA_H * 0.45, st.y + st.kbVy * DT));
      const decay = Math.exp(-5.5 * DT);
      st.kbVx *= decay; st.kbVy *= decay;
      return false;
    }

    // 决策：技能 > 普攻 > 突进接近
    if (trySkill(st, foe, st.cfg.id, foe.cfg.id)) return true;
    if (tryAttack(st, foe, st.cfg.id, foe.cfg.id)) return true;

    if (dist > st.cfg.attackRange * 0.9) {
      const sp = st.cfg.speed * (dist > st.cfg.attackRange * 2 ? 1.35 : 1.0);
      st.x = Math.min(ARENA_W - 60, Math.max(60, st.x + (dx / dist) * sp * DT));
      st.y = Math.min(ARENA_H - 60, Math.max(ARENA_H * 0.45, st.y + (dy / dist) * sp * DT));
      if (st.action === "idle") st.action = "walk";
    }
    return false;
  }

  const TICKS = Math.floor(TICK_RATE * maxDuration);
  let fuseAnnounced = false;
  for (let tick = 1; tick <= TICKS; tick++) {
    time = tick * DT;
    if (!fuseAnnounced && time > maxDuration - 8) {
      fuseAnnounced = true;
      emit({ tick, t: time, type: "fuse", text: "激战加时！伤害提升！" });
    }
    if (stepFighter(A, B)) break;
    if (stepFighter(B, A)) break;
    if (tick % MOVE_EVERY === 0) {
      emit({ tick, t: time, type: "move", id: "A", x: Math.round(A.x), y: Math.round(A.y), facing: A.facing });
      emit({ tick, t: time, type: "move", id: "B", x: Math.round(B.x), y: Math.round(B.y), facing: B.facing });
    }
  }
  return events;
}

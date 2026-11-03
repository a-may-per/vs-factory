// siege 核心物理与战术状态机（真正的狭窄漏斗口 + 普通机枪兵一碰即碎 + 单直线前排严格阻挡物理射击 + 35s+ 拉锯悬念）
import {
  ARENA_W,
  ARENA_H,
  CORRIDOR_CX,
  CANYON_WALL_SEGMENTS,
  getCorridorHalfWidth,
  SIEGE_MAPS,
  type SiegeMapId,
  type SiegeMapConfig,
  type GreenRole,
  type RedKind,
} from "./config.ts";

export const SIM_HZ = 60;
const GRID_CELL = 28;
const GRID_COLS = Math.ceil(ARENA_W / GRID_CELL);
const GRID_ROWS = Math.ceil(ARENA_H / GRID_CELL);

export interface RedDot {
  id: number;
  kind: RedKind;
  name?: string;
  isFinalBoss?: boolean;
  laneOffset?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  ghostHp: number;
  speed: number;
  hitFlash: number;
  prevX: number;
  prevY: number;
}

export interface GreenUnit {
  id: string;
  role: GreenRole;
  name: string;
  level: number;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  aimAngle: number;
  cooldown: number;
  ammo: number;
  maxAmmo: number;
  reloadTicks: number;
  maxReloadTicks: number;
  alive: boolean;
  isRetreating: boolean;
  muzzleFlash: number;
  recoilOffset: number;
  kills: number;
  bossKills: number;
}

export interface BarricadeState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  tier: 1 | 2 | 3;
  broken: boolean;
  hitFlash: number;
}

/**
 * 单直线机枪火线状态（从枪口 (x1,y1) 笔直打到最前排第一个受击目标表面 (x2,y2)，严格遵守前排未死后排不伤）
 */
export interface StraightFiringLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hitKind: "boss" | "minion" | "wall";
  adrenaline: boolean;
  pulsePhase: number;
}

/**
 * 机枪抛出的旋转黄铜弹壳
 */
export interface ShellCasing {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  vAngle: number;
  ttl: number;
  maxTtl: number;
}

/**
 * 子弹命中前排目标迸发的火花与飙血粒子
 */
export interface BulletSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: "spark" | "blood";
  ttl: number;
  maxTtl: number;
}

export interface ShockRing {
  x: number;
  y: number;
  maxR: number;
  ttl: number;
  maxTtl: number;
  kind: "breach" | "boss-kill" | "adrenaline";
}

export interface PersistentDecalEvent {
  kind: "blood" | "scorch" | "rubble" | "boss_blood";
  x: number;
  y: number;
  r: number;
  seed: number;
}

export interface SiegeAudioEvent {
  timeSec: number;
  kind: "mg" | "heavy-mg" | "breach" | "boss-spawn" | "boss-kill" | "adrenaline" | "reload";
  gain: number;
  pitch: number;
}

export interface CalloutState {
  text: string;
  kind: "normal" | "crisis" | "overdrive" | "victory";
  ttl: number;
  maxTtl: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class SiegeSimulator {
  readonly seed: number;
  readonly map: SiegeMapConfig;
  readonly maxDurationSec: number;
  readonly maxTicks: number;
  private readonly rng: () => number;

  tick = 0;
  reds: RedDot[] = [];
  greens: GreenUnit[] = [];
  barricades: BarricadeState[] = [];
  firingLine: StraightFiringLine | null = null;
  shells: ShellCasing[] = [];
  sparks: BulletSpark[] = [];
  rings: ShockRing[] = [];
  pendingDecals: PersistentDecalEvent[] = [];
  audioEvents: SiegeAudioEvent[] = [];

  kills = 0;
  totalSpawned = 0;
  bossesSpawned = 0;
  bossesKilled = 0;
  readonly totalBosses: number;
  private spawnedBossIndices = new Set<number>();

  tier1Breached = false;
  tier2Breached = false;
  tier3Breached = false;
  overdriveActive = false;
  spawningEnded = false;

  private reloadCrisis1Done = false;
  private reloadCrisis2Done = false;
  private reloadCrisis3Done = false;

  /** 最近敌人距离机枪兵边缘的生死像素间距（越小越惊险，<=0 即碎） */
  closestThreatDist = 300;
  private lockedTargetId = -1;
  private bottomKiteDir = 1;

  phase: "front" | "retreat1" | "retreat2" | "overdrive" | "victory" = "front";
  isFinished = false;
  private victoryHoldTicks = 0;

  alarmFlash = 0;
  callout: CalloutState | null = null;

  private nextRedId = 1;
  private grid: number[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);

  constructor(seed: number, mapId: SiegeMapId = "canyon-bridge", durationSec?: number) {
    this.seed = seed;
    this.map = SIEGE_MAPS[mapId] ?? SIEGE_MAPS["canyon-bridge"];
    this.maxDurationSec = durationSec ?? 42;
    this.maxTicks = Math.round(this.maxDurationSec * SIM_HZ);
    this.rng = mulberry32(seed);
    this.totalBosses = this.map.bossWaves.length;

    this.barricades = this.map.barricades.map(b => ({
      ...b,
      hp: b.maxHp,
      broken: false,
      hitFlash: 0,
    }));

    const slot = this.map.greenSlots[0];
    this.greens = [
      {
        id: slot.id,
        role: "mg",
        name: "机枪兵",
        level: 1,
        x: CORRIDOR_CX,
        y: 800,
        r: 14,
        hp: 1,
        maxHp: 1,
        aimAngle: -Math.PI / 2,
        cooldown: 0,
        ammo: 220,
        maxAmmo: 220,
        reloadTicks: 0,
        maxReloadTicks: 48,
        alive: true,
        isRetreating: false,
        muzzleFlash: 0,
        recoilOffset: 0,
        kills: 0,
        bossKills: 0,
      },
    ];

    // 开局在上方宽阔大漏斗区预置 160 只丧尸涌向狭窄口子 (y = 580)
    this.prepopulateInitialSwarm(160);
    this.setCallout("窄口死守：机枪兵一碰即碎 · 单线封锁窄口通道！", "normal", 2.8);
  }

  private setCallout(text: string, kind: CalloutState["kind"], durSec: number): void {
    const ticks = Math.round(durSec * SIM_HZ);
    this.callout = { text, kind, ttl: ticks, maxTtl: ticks };
  }

  private emitAudio(kind: SiegeAudioEvent["kind"], gain = 1, pitch = 1): void {
    this.audioEvents.push({
      timeSec: this.tick / SIM_HZ,
      kind,
      gain,
      pitch,
    });
  }

  private prepopulateInitialSwarm(count: number): void {
    for (let i = 0; i < count; i++) {
      // 前 14 只作为先锋小怪顶在窄口最前面，机枪兵先单线点杀这 14 只先锋后，1号重甲泰坦立即顶上最前排挡枪！
      const inVanguard = i < 14;
      const y = inVanguard ? 455 + this.rng() * 120 : 45 + this.rng() * 340;
      const halfW = getCorridorHalfWidth(y) - 14;
      const x = CORRIDOR_CX + (this.rng() * 2 - 1) * halfW * (inVanguard ? 0.65 : 0.88);
      this.spawnRedDot("walker", x, y);
    }
  }

  private spawnRedDot(
    kind: RedKind,
    x: number,
    y: number,
    bossSpec?: { name: string; hp: number; r: number; speed: number; xOffset?: number; isFinalBoss?: boolean },
  ): RedDot {
    const isBoss = kind === "boss";
    const isRunner = kind === "runner";
    const r = isBoss ? (bossSpec?.r ?? 29) : isRunner ? 5.6 : 6.2;
    const maxHp = isBoss ? (bossSpec?.hp ?? 900) : isRunner ? 16 : 22;
    const speed = isBoss
      ? (bossSpec?.speed ?? 1.36)
      : isRunner
        ? 1.52 + this.rng() * 0.22
        : 1.28 + this.rng() * 0.18;

    const halfW = Math.max(r + 4, getCorridorHalfWidth(y) - r - 3);
    const clampedX = clamp(x, CORRIDOR_CX - halfW, CORRIDOR_CX + halfW);

    const dot: RedDot = {
      id: this.nextRedId++,
      kind,
      name: bossSpec?.name,
      isFinalBoss: bossSpec?.isFinalBoss,
      laneOffset: isBoss ? (bossSpec?.xOffset ?? 0) : (this.rng() * 2 - 1) * 280,
      x: clampedX,
      y: clamp(y, r + 8, 1460 - r),
      vx: 0,
      vy: speed * 0.65,
      r,
      hp: maxHp,
      maxHp,
      ghostHp: maxHp,
      speed,
      hitFlash: 0,
      prevX: clampedX,
      prevY: y,
    };
    this.reds.push(dot);
    this.totalSpawned++;
    return dot;
  }

  private resolveSegmentCollision(dot: RedDot, x1: number, y1: number, x2: number, y2: number): void {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp(((dot.x - x1) * vx + (dot.y - y1) * vy) / len2, 0, 1);
    const cx = x1 + vx * t;
    const cy = y1 + vy * t;
    const dx = dot.x - cx;
    const dy = dot.y - cy;
    const d2 = dx * dx + dy * dy;
    const minR = dot.r + 2;
    if (d2 < minR * minR && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = minR - d;
      dot.x += (dx / d) * push;
      dot.y += (dy / d) * push;
    }
  }

  private resolveRectCollision(dot: RedDot, rx: number, ry: number, rw: number, rh: number): boolean {
    const cx = clamp(dot.x, rx, rx + rw);
    const cy = clamp(dot.y, ry, ry + rh);
    const dx = dot.x - cx;
    const dy = dot.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= dot.r * dot.r) return false;

    const d = Math.sqrt(d2);
    if (d > 0.0001) {
      const push = dot.r - d;
      dot.x += (dx / d) * push;
      dot.y += (dy / d) * push;
    } else {
      dot.y = ry - dot.r;
    }
    return true;
  }

  private rebuildSpatialGrid(): void {
    for (let i = 0; i < this.grid.length; i++) {
      this.grid[i].length = 0;
    }
    for (let i = 0; i < this.reds.length; i++) {
      const d = this.reds[i];
      const gx = clamp(Math.floor(d.x / GRID_CELL), 0, GRID_COLS - 1);
      const gy = clamp(Math.floor(d.y / GRID_CELL), 0, GRID_ROWS - 1);
      this.grid[gy * GRID_COLS + gx].push(i);
    }
  }

  /** Advance simulation by 1 tick (1/60s) */
  stepTick(): void {
    this.tick++;
    const tSec = this.tick / SIM_HZ;

    if (this.alarmFlash > 0) this.alarmFlash = Math.max(0, this.alarmFlash - 0.025);

    if (this.callout) {
      this.callout.ttl--;
      if (this.callout.ttl <= 0) this.callout = null;
    }

    // 1. 35s+ 窄口剧本波次、4大泰坦前排挡枪与换弹危机导演
    this.updateDirector(tSec);

    // 2. 重建空间哈希网格
    this.rebuildSpatialGrid();

    // 3. 更新尸潮与泰坦在漏斗及狭窄口子内的挤压推进（泰坦卡在窄口前排挡子弹，后方尸潮积蓄）
    this.updateRedSwarm();

    // 4. 更新一碰即碎的机枪兵走位拉扯 + 单直线前排严格阻挡射击
    this.updateHeroGunner();

    // 5. 更新抛壳、受击火花/飙血粒子与冲击波环
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.vx *= 0.88;
      sh.vy = sh.vy * 0.88 + 0.12;
      sh.angle += sh.vAngle;
      sh.ttl--;
      if (sh.ttl <= 0) this.shells.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.x += sp.vx;
      sp.y += sp.vy;
      sp.vx *= 0.84;
      sp.vy *= 0.84;
      sp.ttl--;
      if (sp.ttl <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].ttl--;
      if (this.rings[i].ttl <= 0) this.rings.splice(i, 1);
    }
    for (const b of this.barricades) {
      if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - 0.1);
    }

    // 6. 自然决出胜负收尾：4 大泰坦全部登场且场上所有丧尸清零后，定格 1.2s 胜利画面
    if (this.spawningEnded && this.bossesSpawned >= this.totalBosses && this.reds.length === 0) {
      if (this.phase !== "victory") {
        this.phase = "victory";
        this.firingLine = null;
        this.setCallout(
          `窄口死守成功 · 零伤亡连斩 ${this.bossesKilled} 大泰坦 · 歼敌 ${this.kills}`,
          "victory",
          3.0,
        );
      }
      this.victoryHoldTicks++;
      if (this.victoryHoldTicks >= Math.round(1.2 * SIM_HZ)) {
        this.isFinished = true;
      }
    }
    if (tSec >= this.maxDurationSec) {
      this.isFinished = true;
    }
  }

  private updateDirector(tSec: number): void {
    const hero = this.greens[0];

    // 1. 依次登场 4 大变异泰坦 Boss
    for (let idx = 0; idx < this.map.bossWaves.length; idx++) {
      if (this.spawnedBossIndices.has(idx)) continue;
      const bw = this.map.bossWaves[idx];
      if (tSec >= bw.spawnSec) {
        this.spawnedBossIndices.add(idx);
        this.bossesSpawned++;
        const bx = CORRIDOR_CX + bw.xOffset;
        const by = bw.ySpawn;
        this.spawnRedDot("boss", bx, by, {
          name: bw.name,
          hp: bw.hp,
          r: bw.r,
          speed: bw.speed,
          xOffset: bw.xOffset,
          isFinalBoss: bw.isFinalBoss,
        });
        this.emitAudio("boss-spawn", 0.9, bw.isFinalBoss ? 0.78 : 0.92);

        if (idx === 0) {
          this.setCallout("「重甲泰坦」卡住窄口最前排挡枪 · 后方尸潮全速聚集！", "normal", 3.2);
        } else if (idx === 1) {
          this.setCallout("「狂暴泰坦」挤入窄口通道 · 机枪兵边打边退！", "crisis", 3.2);
        } else if (idx === 2) {
          this.setCallout("「暗黑泰坦」双路压境 · 窄口防线节节后撤！", "crisis", 3.2);
        } else if (bw.isFinalBoss) {
          this.setCallout("高能预警：「终极尸王」塞满窄口 · 冲击最后底线！", "crisis", 3.6);
        }
      }
    }

    // 2. 持续从顶部宽阔漏斗区涌入尸潮（持续至 26.5s，汇聚在漏斗口并随泰坦推进挤入 136px 窄口）
    if (tSec < 26.5) {
      const maxActiveReds = tSec < 10.0 ? 175 : tSec < 21.0 ? 195 : 135;
      if (this.reds.length < maxActiveReds && this.tick % 3 === 0) {
        const spawnsPerStep = tSec < 10.0 ? 2 : tSec < 21.0 ? 2 : 1;
        for (let s = 0; s < spawnsPerStep; s++) {
          const spawnY = 40 + this.rng() * 210;
          const halfW = getCorridorHalfWidth(spawnY) - 18;
          const spawnX = CORRIDOR_CX + (this.rng() * 2 - 1) * halfW * 0.88;
          const isRunner = tSec > 4.5 && this.rng() < 0.35;
          this.spawnRedDot(isRunner ? "runner" : "walker", spawnX, spawnY);
        }
      }
    } else if (!this.spawningEnded) {
      this.spawningEnded = true;
    }

    // 3. 窄口入口路障破防 (1.8s)
    if (!this.tier1Breached && tSec >= 1.8) {
      this.triggerGateBreach(1);
    }

    // 4. 第一次换弹贴脸危机 (5.6s)：重甲泰坦顶着机枪压进窄口，机枪兵打空弹匣换弹，泰坦逼近至距机枪兵仅 24px！
    if (!this.reloadCrisis1Done && hero && hero.alive && tSec >= 5.6) {
      this.reloadCrisis1Done = true;
      hero.ammo = 0;
      hero.reloadTicks = 48; // 0.80s 断火换弹
      this.alarmFlash = 0.85;
      this.emitAudio("reload", 0.8, 1.0);
      this.setCallout("弹药打空换弹！前排泰坦突进近身 · 一碰即碎！", "crisis", 2.5);
    }

    // 5. 第二阶段推进提示 (12.0s)
    if (this.tier1Breached && !this.tier2Breached && tSec >= 12.0) {
      this.tier2Breached = true;
      this.phase = "retreat2";
    }

    // 6. 第二次换弹贴脸危机 (15.8s)：狂暴泰坦+暗黑泰坦在窄口前后叠盾推进，机枪兵换弹后撤化险为夷
    if (!this.reloadCrisis2Done && hero && hero.alive && tSec >= 15.8) {
      this.reloadCrisis2Done = true;
      hero.ammo = 0;
      hero.reloadTicks = 50;
      this.alarmFlash = 0.92;
      this.emitAudio("reload", 0.85, 0.96);
      this.setCallout("窄口双泰坦叠盾压进 · 机枪兵极限后撤换弹！", "crisis", 2.8);
    }

    // 7. 第三阶段退入底部战壕 (23.0s)：终极尸王冲出狭窄口子，逼迫机枪兵退入底部死守战壕
    if (this.tier2Breached && !this.tier3Breached && tSec >= 23.0) {
      this.tier3Breached = true;
      this.setCallout("终极尸王冲出窄口！机枪兵退至底线背水一战！", "crisis", 3.2);
    }

    // 8. 第三次终极换弹危机 (26.4s) + 27.2s 换装高射速穿甲弹链背水死斗
    if (!this.reloadCrisis3Done && this.tier3Breached && hero && hero.alive && tSec >= 26.4) {
      this.reloadCrisis3Done = true;
      hero.ammo = 0;
      hero.reloadTicks = 46;
      this.alarmFlash = 1.0;
      this.emitAudio("reload", 0.95, 0.92);
      this.setCallout("退无可退：尸王突进至枪口前 · 换装穿甲弹死守！", "crisis", 2.8);
    }

    if (!this.overdriveActive && hero && hero.alive && tSec >= 27.2) {
      this.overdriveActive = true;
      this.phase = "overdrive";
      hero.level = 3;
      this.emitAudio("adrenaline", 0.95, 1.0);
      this.rings.push({
        x: hero.x,
        y: hero.y,
        maxR: 130,
        ttl: 18,
        maxTtl: 18,
        kind: "adrenaline",
      });
      this.setCallout("背水一战：高射速直线点杀终极尸王与涌入尸潮！", "overdrive", 3.6);
    }
  }

  private triggerGateBreach(tier: 1 | 2 | 3): void {
    if (tier === 1) {
      if (this.tier1Breached) return;
      this.tier1Breached = true;
      this.phase = "retreat1";
    } else if (tier === 2) {
      if (this.tier2Breached) return;
      this.tier2Breached = true;
      this.phase = "retreat2";
    } else {
      if (this.tier3Breached) return;
      this.tier3Breached = true;
      this.phase = "retreat2";
    }

    this.emitAudio("breach", 0.85, tier === 3 ? 0.88 : 0.96);
    for (const b of this.barricades) {
      if (b.tier === tier && !b.broken) {
        b.broken = true;
        b.hp = 0;
        const cx = b.x + b.w * 0.5;
        const cy = b.y + b.h * 0.5;
        this.rings.push({
          x: cx,
          y: cy,
          maxR: 95,
          ttl: 18,
          maxTtl: 18,
          kind: "breach",
        });
        this.pendingDecals.push({
          kind: "rubble",
          x: cx,
          y: cy,
          r: 36,
          seed: this.tick + tier * 31,
        });
      }
    }
  }

  private updateRedSwarm(): void {
    const hero = this.greens[0];

    // 找出当前通道内最靠前的 Boss，用于模拟「泰坦卡住窄口，后方百尸拥堵积蓄；泰坦一死，尸潮决堤狂涌」的真实物理奇观
    let frontBoss: RedDot | null = null;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if (r.kind === "boss") {
        if (!frontBoss || r.y > frontBoss.y) {
          frontBoss = r;
        }
      }
    }

    let minGapToHero = 999;

    for (let i = this.reds.length - 1; i >= 0; i--) {
      const d = this.reds[i];
      d.prevX = d.x;
      d.prevY = d.y;
      if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - 0.18);
      if (d.ghostHp > d.hp) {
        d.ghostHp = Math.max(d.hp, d.ghostHp - (d.maxHp * 0.012 + (d.ghostHp - d.hp) * 0.14));
      }

      // 1. 漏斗与窄口导流目标点计算
      let tx = CORRIDOR_CX;
      let ty = hero ? hero.y : 1400;

      if (d.y < 570) {
        // 位于上方大漏斗区：顺着斜坡向 y=585 的狭窄口子中心挤压汇聚
        const funnelProgress = clamp((d.y - 120) / (570 - 120), 0, 1);
        const allowHalfW = (getCorridorHalfWidth(d.y) - d.r - 6) * (1 - funnelProgress * 0.55);
        const rawOffset = (d.laneOffset ?? 0) * (1 - funnelProgress * 0.82);
        tx = CORRIDOR_CX + clamp(rawOffset, -allowHalfW, allowHalfW);
        ty = 595;
      } else if (d.y < 1150) {
        // 位于 136px 极窄咽喉通道内：沿着窄道笔直向下压迫机枪兵
        const throatHalfW = Math.max(8, 68 - d.r - 4);
        const throatOffset = d.kind === "boss"
          ? clamp((d.laneOffset ?? 0) * 0.35, -throatHalfW * 0.6, throatHalfW * 0.6)
          : clamp((d.laneOffset ?? 0) * 0.22, -throatHalfW, throatHalfW);
        tx = CORRIDOR_CX + throatOffset;
        ty = hero ? Math.max(d.y + 60, hero.y) : 1350;
      } else if (hero) {
        // 进入底部退守战壕：直扑机枪兵当前走位坐标
        const pocketOffset = d.kind === "boss" ? 0 : ((d.id % 7) - 3) * 10;
        tx = clamp(hero.x + pocketOffset, 355 + d.r, 629 - d.r);
        ty = hero.y;
      }

      const dx = tx - d.x;
      const dy = ty - d.y;
      const dist = Math.hypot(dx, dy) || 1;
      const isReloadWindow = Boolean(hero && hero.reloadTicks > 0);

      let desiredSpd = d.speed;
      if (isReloadWindow) {
        // 机枪兵换弹断火瞬间：尸潮与泰坦失去弹雨压制，全速猛扑！
        desiredSpd *= 1.65;
      } else if (d.hitFlash > 0.2) {
        // 正在被单直线机枪集火的最前排目标：承受强烈的子弹动能阻滞
        desiredSpd *= d.kind === "boss" ? 0.36 : 0.15;
      }

      // 真实物理窄口拥堵：当泰坦卡在窄口前方时，后方的小丧尸被泰坦庞大的身躯挡住，积蓄在泰坦身后形成密集红海！
      if (
        d.kind !== "boss" &&
        frontBoss &&
        frontBoss.y > 540 &&
        d.y < frontBoss.y - frontBoss.r * 0.35 &&
        d.y > frontBoss.y - 260
      ) {
        const distToBossY = frontBoss.y - d.y;
        if (distToBossY < frontBoss.r + d.r + 22) {
          desiredSpd *= 0.42;
        }
      }

      const steerX = (dx / dist) * desiredSpd;
      const steerY = (dy / dist) * desiredSpd;

      // 2. 空间网格刚性防重叠分离 (PBD)：红点之间绝不叠成一团，泰坦庞大体积真实阻挡周围小怪
      const gx = clamp(Math.floor(d.x / GRID_CELL), 0, GRID_COLS - 1);
      const gy = clamp(Math.floor(d.y / GRID_CELL), 0, GRID_ROWS - 1);
      let pushX = 0;
      let pushY = 0;
      let posPushX = 0;
      let posPushY = 0;
      let neighborsChecked = 0;

      for (let ny = Math.max(0, gy - 1); ny <= Math.min(GRID_ROWS - 1, gy + 1); ny++) {
        for (let nx = Math.max(0, gx - 1); nx <= Math.min(GRID_COLS - 1, gx + 1); nx++) {
          const cell = this.grid[ny * GRID_COLS + nx];
          const len = cell.length;
          if (len === 0) continue;
          const startOffset = (i * 11) % len;
          for (let step = 0; step < len; step++) {
            const otherIdx = cell[(startOffset + step) % len];
            if (otherIdx === i) continue;
            const o = this.reds[otherIdx];
            if (!o) continue;
            const minDist = d.r + o.r + 2.4;
            const odx = d.x - o.x;
            const ody = d.y - o.y;
            const od2 = odx * odx + ody * ody;
            if (od2 < minDist * minDist) {
              const od = Math.sqrt(od2);
              const nxDir = od > 0.001 ? odx / od : Math.cos((i + otherIdx) * 1.7);
              const nyDir = od > 0.001 ? ody / od : Math.sin((i + otherIdx) * 1.7);
              const overlap = minDist - od;
              const f = overlap / minDist;
              const weight =
                d.kind === "boss" && o.kind !== "boss"
                  ? 0.06
                  : o.kind === "boss" && d.kind !== "boss"
                    ? 3.2
                    : 1.45;
              pushX += nxDir * f * weight * 1.6;
              pushY += nyDir * f * weight * 1.6;
              if (d.kind !== "boss") {
                posPushX += nxDir * overlap * (o.kind === "boss" ? 0.65 : 0.34);
                posPushY += nyDir * overlap * (o.kind === "boss" ? 0.65 : 0.34);
              }
            }
            if (++neighborsChecked > 28) break;
          }
          if (neighborsChecked > 28) break;
        }
        if (neighborsChecked > 28) break;
      }

      d.vx = d.vx * 0.45 + (steerX + pushX) * 0.55;
      d.vy = d.vy * 0.45 + (steerY + pushY) * 0.55;
      d.x += d.vx + clamp(posPushX, -4.5, 4.5);
      d.y += d.vy + clamp(posPushY, -4.5, 4.5);

      // 3. 漏斗斜墙与狭窄口子边界精确约束
      for (const seg of CANYON_WALL_SEGMENTS) {
        this.resolveSegmentCollision(d, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      const corridorHalfW = Math.max(d.r + 2, getCorridorHalfWidth(d.y) - d.r - 2.5);
      d.x = clamp(d.x, CORRIDOR_CX - corridorHalfW, CORRIDOR_CX + corridorHalfW);

      // 关键物理约束：当巨型泰坦处于狭窄口子内 (y >= 460) 时，其身后 (id > frontBoss.id 或原本在泰坦后方) 的小丧尸无法穿模越过泰坦庞大的身躯，只能在泰坦身后积蓄成密集尸潮；一旦泰坦被打爆，积蓄的尸潮瞬间决堤涌出！
      if (d.kind !== "boss" && frontBoss && frontBoss.y >= 460 && d.id > frontBoss.id) {
        const maxAllowedY = frontBoss.y - frontBoss.r * 0.55 - d.r;
        if (d.y > maxAllowedY) {
          d.y = maxAllowedY;
        }
      }
      d.y = clamp(d.y, d.r + 6, 1466 - d.r);

      // 4. 窄口路障碰撞
      for (const b of this.barricades) {
        if (b.broken) continue;
        if (this.resolveRectCollision(d, b.x, b.y, b.w, b.h)) {
          const tSec = this.tick / SIM_HZ;
          const canDamage =
            b.tier === 1 ||
            (b.tier === 2 && tSec >= 9.5) ||
            (b.tier === 3 && tSec >= 20.5);
          if (canDamage) {
            b.hp -= d.kind === "boss" ? 9.0 : 0.45;
            b.hitFlash = Math.min(1, b.hitFlash + 0.22);
            if (b.hp <= 0) {
              this.triggerGateBreach(b.tier);
            }
          }
        }
      }

      // 5. 维持「普通机枪兵一碰即碎」的生死距离底线：统计最近威胁距离，并防止模型穿透
      if (hero && hero.alive) {
        const gap = Math.hypot(d.x - hero.x, d.y - hero.y) - d.r - hero.r;
        if (gap < minGapToHero) {
          minGapToHero = gap;
        }
        // 机枪兵紧急后撤闪避：在贴脸毫厘之间 (gap < 16px) 紧急蹬地拉开身位，营造差一点就被扑碎的窒息感！
        if (gap < 18) {
          this.alarmFlash = Math.min(1.0, this.alarmFlash + 0.18);
          const dirX = (d.x - hero.x) / (Math.hypot(d.x - hero.x, d.y - hero.y) || 1);
          const dirY = (d.y - hero.y) / (Math.hypot(d.x - hero.x, d.y - hero.y) || 1);
          d.x = hero.x + dirX * (hero.r + d.r + 18);
          d.y = hero.y + dirY * (hero.r + d.r + 18);
        }
      }
    }

    this.closestThreatDist = minGapToHero;
  }

  /**
   * 普通机枪兵 AI：
   * 1. 一碰即碎：根据最前排敌人逼近距离动态边打边退；当敌人被清空一段距离时，还会小幅向前推进收复窄口阵地，形成真实的拉锯感！
   * 2. 退至底部战壕后沿底墙左右大幅走位拉扯。
   * 3. 单直线射击：始终瞄准最前排威胁，发射一条笔直火线，严格执行「前排没打掉绝不伤后排」！
   */
  private updateHeroGunner(): void {
    const hero = this.greens[0];
    if (!hero || !hero.alive) {
      this.firingLine = null;
      return;
    }

    if (hero.muzzleFlash > 0) hero.muzzleFlash = Math.max(0, hero.muzzleFlash - 0.25);
    if (hero.recoilOffset > 0) hero.recoilOffset = Math.max(0, hero.recoilOffset - 0.9);

    // 找出距离机枪兵最近/最靠前的威胁目标
    let closestEnemy: RedDot | null = null;
    let minEnemyEdgeDist = Infinity;
    let maxFrontEdgeY = 480;

    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const edgeDist = Math.hypot(r.x - hero.x, r.y - hero.y) - r.r;
      if (edgeDist < minEnemyEdgeDist) {
        minEnemyEdgeDist = edgeDist;
        closestEnemy = r;
      }
      if (r.y + r.r > maxFrontEdgeY) {
        maxFrontEdgeY = r.y + r.r;
      }
    }

    const isReloading = hero.reloadTicks > 0;
    // 平时边打边退维持 ~86px 紧凑交火距离；换弹时尸潮与泰坦猛扑拉近距离至 24~38px 制造差一步即碎的窒息悬念！
    const desiredSafeGap = isReloading ? 48 : 86;
    const desiredY = clamp(maxFrontEdgeY + desiredSafeGap, 680, 1422);

    let desiredX = CORRIDOR_CX;
    if (hero.y > 1185 || desiredY > 1185) {
      // 已经退入底部绝境战壕 (width = 296px)：左右大幅横移走位周旋，到达一侧航点后立刻反向拉扯
      const targetSideX = CORRIDOR_CX + this.bottomKiteDir * 96;
      if (Math.abs(hero.x - targetSideX) < 10) {
        this.bottomKiteDir = -this.bottomKiteDir;
      }
      desiredX = clamp(CORRIDOR_CX + this.bottomKiteDir * 96, 376, 608);
    } else {
      // 在 136px 狭窄口子内部：做小幅战术左右微移，对准窄口最前排敌人
      desiredX = CORRIDOR_CX + Math.sin(this.tick * 0.05) * 18;
    }

    const moveDx = desiredX - hero.x;
    const moveDy = desiredY - hero.y;
    const moveDist = Math.hypot(moveDx, moveDy);
    if (moveDist > 1.2) {
      const isBackingUp = moveDy > 0;
      const maxMoveSpd = isBackingUp
        ? isReloading
          ? 1.95
          : this.overdriveActive
            ? 2.25
            : 1.8
        : 1.2;
      const step = Math.min(maxMoveSpd, moveDist);
      hero.x += (moveDx / moveDist) * step;
      hero.y += (moveDy / moveDist) * step;
      hero.isRetreating = isBackingUp && moveDist > 4;
    } else {
      hero.isRetreating = false;
    }

    // 确保机枪兵严格处于通道边界内
    const heroHalfW = Math.max(hero.r + 4, getCorridorHalfWidth(hero.y) - hero.r - 6);
    hero.x = clamp(hero.x, CORRIDOR_CX - heroHalfW, CORRIDOR_CX + heroHalfW);
    hero.y = clamp(hero.y, 720, 1432);

    // 换弹状态：断火无射线
    if (hero.reloadTicks > 0) {
      hero.reloadTicks--;
      this.firingLine = null;
      if (hero.reloadTicks === 0) {
        hero.ammo = hero.maxAmmo;
      }
      return;
    }

    this.fireStraightLineRaycast(hero);
  }

  /**
   * 单直线严格前排阻挡射击（「就一条直线打过去，前面的没打掉就不能打后面」）：
   * 1. 瞄准距离机枪兵最近的最前排敌人（锁定当前最前排目标直到打死，枪线稳健不乱跳）。
   * 2. 从枪口沿直线做精确几何射线检测 (Ray-Circle Intersection)，找出射线上距离枪口最近的第一个敌人 `firstHit`。
   * 3. 直线火线在 `firstHit` 的前表面立即截断终止！只有 `firstHit` 受到伤害与动能击退，后方任何敌人完全无伤！
   */
  private fireStraightLineRaycast(hero: GreenUnit): void {
    const maxRange = 860;

    // 1. 选择最前排瞄准目标（保持微粘滞防抖，打死当前最前排目标再切下一个）
    let bestTarget: RedDot | null = null;
    let bestScore = Infinity;

    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const dist = Math.hypot(r.x - hero.x, r.y - hero.y) - r.r;
      if (dist > maxRange) continue;
      // 粘滞奖励：如果正是上一帧锁定的最前排目标，给予 16px 优先权，保证一条直线稳稳把前排目标打爆再换下一个
      const stickyBonus = r.id === this.lockedTargetId ? -16 : 0;
      const score = dist + stickyBonus;
      if (score < bestScore) {
        bestScore = score;
        bestTarget = r;
      }
    }

    if (!bestTarget) {
      this.firingLine = null;
      return;
    }

    this.lockedTargetId = bestTarget.id;
    const aimAngle = Math.atan2(bestTarget.y - hero.y, bestTarget.x - hero.x);
    hero.aimAngle = aimAngle;
    hero.muzzleFlash = 1.0;
    hero.recoilOffset = this.tick % 2 === 0 ? 3.2 : 1.4;

    if (!this.overdriveActive && this.tick % 2 === 0) {
      hero.ammo = Math.max(1, hero.ammo - 1);
    }

    const ux = Math.cos(aimAngle);
    const uy = Math.sin(aimAngle);
    const muzzleDist = hero.r + 12;
    const mx = hero.x + ux * muzzleDist;
    const my = hero.y + uy * muzzleDist;

    // 2. 计算射线与走廊边界墙体的交点距离 wallDist
    let bestDist = maxRange;
    for (let stepD = 16; stepD <= maxRange; stepD += 12) {
      const px = mx + ux * stepD;
      const py = my + uy * stepD;
      if (py < 6 || py > 1466 || Math.abs(px - CORRIDOR_CX) > getCorridorHalfWidth(py) - 2) {
        bestDist = stepD;
        break;
      }
    }

    // 3. 精确射线-圆相交检测：找出这条直线上最前面的第一个敌人 (minimum tHit > 0)
    let firstHitIdx = -1;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const dx = r.x - mx;
      const dy = r.y - my;
      const proj = dx * ux + dy * uy;
      if (proj <= -r.r || proj - r.r >= bestDist) continue;

      const perp2 = dx * dx + dy * dy - proj * proj;
      const hitR = r.r + 3.0;
      if (perp2 <= hitR * hitR) {
        const halfChord = Math.sqrt(Math.max(0, hitR * hitR - perp2));
        const tHit = Math.max(2, proj - halfChord);
        if (tHit < bestDist) {
          bestDist = tHit;
          firstHitIdx = i;
        }
      }
    }

    const hitX = mx + ux * bestDist;
    const hitY = my + uy * bestDist;

    // 4. 仅对射线上最前面的第一个目标结算伤害与击退，后面目标由于被前排肉体挡住完全不受伤！
    let hitKind: "boss" | "minion" | "wall" = "wall";
    if (firstHitIdx >= 0) {
      const target = this.reds[firstHitIdx];
      hitKind = target.kind === "boss" ? "boss" : "minion";

      // 每 tick 直线持续倾泻机枪火力
      const dmgPerTick = this.overdriveActive
        ? target.kind === "boss"
          ? 7.2
          : 15.0
        : target.kind === "boss"
          ? 4.4
          : 11.5;

      target.hp -= dmgPerTick;
      target.hitFlash = 1.0;

      // 物理击退阻滞：普通小怪被明显顶退，巨型泰坦产生受击顿挫
      const kb = target.kind === "boss"
        ? this.overdriveActive
          ? 0.62
          : 0.38
        : this.overdriveActive
          ? 2.2
          : 1.55;
      target.x += ux * kb;
      target.y += uy * kb;

      // 在最前排受击表面点 (hitX, hitY) 迸发火花与飙血粒子
      if (this.tick % 2 === 0) {
        this.spawnImpactParticles(hitX, hitY, ux, uy, "blood", target.kind === "boss" ? 2 : 1);
      }
      if (target.kind === "boss" && this.tick % 3 === 0) {
        this.spawnImpactParticles(hitX, hitY, ux, uy, "spark", 1);
      }

      if (target.hp <= 0) {
        this.killRedDot(firstHitIdx);
        hero.kills++;
      }
    }

    this.firingLine = {
      x1: mx,
      y1: my,
      x2: hitX,
      y2: hitY,
      hitKind,
      adrenaline: this.overdriveActive,
      pulsePhase: (this.tick * 0.35) % 1,
    };

    // 抛洒旋转黄铜弹壳
    if (this.tick % 2 === 0 && this.shells.length < 42) {
      const ejectAng = aimAngle + Math.PI * 0.58 + (this.rng() - 0.5) * 0.32;
      const ejectSpd = 2.6 + this.rng() * 2.0;
      this.shells.push({
        x: hero.x + ux * 4 + Math.cos(ejectAng) * 6,
        y: hero.y + uy * 4 + Math.sin(ejectAng) * 6,
        vx: Math.cos(ejectAng) * ejectSpd,
        vy: Math.sin(ejectAng) * ejectSpd,
        angle: this.rng() * Math.PI * 2,
        vAngle: (this.rng() - 0.5) * 0.45,
        ttl: 16,
        maxTtl: 16,
      });
    }

    if (this.tick % 3 === 0) {
      this.emitAudio(
        this.overdriveActive ? "heavy-mg" : "mg",
        this.overdriveActive ? 0.28 : 0.24,
        0.92 + this.rng() * 0.16,
      );
    }
  }

  private spawnImpactParticles(
    x: number,
    y: number,
    ux: number,
    uy: number,
    kind: "spark" | "blood",
    count: number,
  ): void {
    if (this.sparks.length > 96) return;
    const baseAng = Math.atan2(uy, ux);
    for (let c = 0; c < count; c++) {
      const ang =
        kind === "blood"
          ? baseAng + Math.PI + (this.rng() - 0.5) * 1.35
          : baseAng + Math.PI + (this.rng() - 0.5) * 1.55;
      const spd = kind === "blood" ? 1.8 + this.rng() * 2.6 : 2.5 + this.rng() * 3.0;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        kind,
        ttl: kind === "blood" ? 8 : 6,
        maxTtl: kind === "blood" ? 8 : 6,
      });
    }
  }

  private killRedDot(idx: number): void {
    const d = this.reds[idx];
    if (!d) return;
    this.kills++;

    const hero = this.greens[0];
    if (d.kind === "boss") {
      this.bossesKilled++;
      if (hero) {
        hero.bossKills++;
        if (hero.level < 2) hero.level = 2;
      }
      this.emitAudio("boss-kill", 1.0, d.isFinalBoss ? 0.82 : 1.0);
      this.rings.push({
        x: d.x,
        y: d.y,
        maxR: d.r * 2.8,
        ttl: 18,
        maxTtl: 18,
        kind: "boss-kill",
      });
      this.pendingDecals.push({
        kind: "boss_blood",
        x: d.x,
        y: d.y,
        r: d.r * 1.1,
        seed: d.id,
      });

      if (d.isFinalBoss) {
        this.setCallout("终极尸王已轰击倒下 · 单线点杀清空涌入尸潮！", "victory", 2.8);
      } else {
        this.setCallout(
          `击破前盾「${d.name}」(${this.bossesKilled}/${this.totalBosses}) · 后方尸潮全速涌出！`,
          "normal",
          2.6,
        );
      }
    } else if (this.kills % 5 === 0) {
      this.pendingDecals.push({
        kind: "blood",
        x: d.x,
        y: d.y,
        r: 9 + (d.id % 5),
        seed: d.id,
      });
    }

    const last = this.reds.pop()!;
    if (idx < this.reds.length) {
      this.reds[idx] = last;
    }
  }
}

// siege 核心物理与战术状态机（大地图2D平滑镜头跟随 + 科学BFS网格寻路 + 门洞拐角CQB搜房 + 2D射线迷雾视野差）
import {
  ARENA_W,
  ARENA_H,
  WORLD_W,
  WORLD_H,
  CORRIDOR_CX,
  getCorridorBounds,
  getOuterWallSegments,
  getDeadCornerWalls,
  getSquadWaypoints,
  isDarkDeadCornerMode,
  SIEGE_MAPS,
  SIEGE_MODE_META,
  type SiegeMapId,
  type SiegeModeId,
  type SiegeMapConfig,
  type TacticalNodeSpec,
  type WallSegment,
  type GreenRole,
  type RedKind,
} from "./config.ts";

export const SIM_HZ = 60;
const GRID_CELL = 32;
const GRID_COLS = Math.ceil(WORLD_W / GRID_CELL);
const GRID_ROWS = Math.ceil(WORLD_H / GRID_CELL);

// 科学 2D 寻路网格（用于尸潮绕过死角隔墙、穿过门洞、绕行反应堆屏蔽岛与S弯的真实 BFS 流场寻路 + 全局小地图探索迷雾记录）
export const NAV_CELL = 36;
export const NAV_COLS = Math.ceil(WORLD_W / NAV_CELL);
export const NAV_ROWS = Math.ceil(WORLD_H / NAV_CELL);

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
  /** 声呐潜行模式下：死角丧尸是否处于沉睡潜伏状态（开枪噪音环扫过后惊醒暴走） */
  dormant?: boolean;
  /** 狂暴飞扑倒计时（前排精英突击尸加速冲锋扑咬尖兵，全程物理位移无瞬移） */
  frenzyTimer?: number;
  /** 新变异枪兵破茧缓冲帧 */
  spawnGraceTicks?: number;
}

export interface GreenUnit {
  id: number;
  role: GreenRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  slotX: number;
  slotY: number;
  r: number;
  hp: number;
  maxHp: number;
  aimAngle: number;
  slotIndex: number;
  alive: boolean;
  muzzleFlash: number;
  recoilOffset: number;
  lockedTargetId: number;
  buffed: boolean;
  /** 迷宫多队汇合模式下的分队编号 (0=中路B监区队, 1=左路A监区队, 2=右路C监区队) */
  subSquad?: number;
}

/**
 * 2D 物理射线手电光锥 / 旋转探照灯光源定义（光锥遇到墙体与死角挡板会被严格物理截断）
 */
export interface LightConeSpec {
  x: number;
  y: number;
  angle: number;
  halfFov: number;
  range: number;
  intensity: number;
  kind: "flashlight" | "spotlight";
}

export interface TacticalNodeState extends TacticalNodeSpec {
  maxHp: number;
  ghostHp: number;
  broken: boolean;
  hitFlash: number;
}

export interface MotherHiveState {
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  ghostHp: number;
  alive: boolean;
  hitFlash: number;
  pulsePhase: number;
}

/**
 * 单条笔直机枪火线（从士兵枪口 (x1,y1) 笔直打到射线上距离最近的第一个目标前表面 (x2,y2)，严格遵守前排不死后排不伤）
 */
export interface StraightFiringLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: GreenRole;
  hitKind: "boss" | "hive" | "node" | "minion" | "wall";
  buffed: boolean;
}

export interface BulletSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: "spark" | "blood" | "bio" | "gold";
  ttl: number;
  maxTtl: number;
}

export interface ShockRing {
  x: number;
  y: number;
  maxR: number;
  ttl: number;
  maxTtl: number;
  kind:
    | "rescue"
    | "multiply"
    | "infect"
    | "boss-kill"
    | "hive-kill"
    | "casualty"
    | "sonar"
    | "noise";
}

export interface FloatingBanner {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: [number, number, number, number];
  ttl: number;
  maxTtl: number;
}

export interface PersistentDecalEvent {
  kind: "blood" | "boss_blood" | "scorch" | "crystals";
  x: number;
  y: number;
  r: number;
  seed: number;
}

export interface SiegeAudioEvent {
  timeSec: number;
  kind:
    | "mg"
    | "heavy-mg"
    | "breach"
    | "boss-spawn"
    | "boss-kill"
    | "adrenaline"
    | "reload"
    | "kill-pop"
    | "hive-blast";
  gain: number;
  pitch: number;
}

export interface CalloutState {
  text: string;
  kind: "normal" | "crisis" | "overdrive" | "victory";
  ttl: number;
  maxTtl: number;
}

export interface InsertionVehicle {
  id: number;
  kind: "bus" | "helicopter";
  x: number;
  y: number;
  startX: number;
  startY: number;
  stopX: number;
  stopY: number;
  angle: number;
  turretAngle: number;
  muzzleFlash: number;
  rotorAngle: number;
  doorOpen: number;
  ropeDrop: number;
  headlightsOn: boolean;
  phase: "inbound" | "deploying" | "parked" | "departing" | "gone";
  subSquad: number;
  deployedCount: number;
  totalToDeploy: number;
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

// 28 个持久化战术 CQB 阵位偏移（每名士兵出生时绑定独立阵位，阵亡或增援绝不引发全队换位瞬移！）
const FORMATION_OFFSETS: ReadonlyArray<{ x: number; y: number }> = [
  // 第 0 排（尖兵，y = -18）
  { x: -28, y: -18 },
  { x: 0, y: -22 },
  { x: 28, y: -18 },
  // 第 1 排（主力前排，y = +10）
  { x: -54, y: 10 },
  { x: -18, y: 8 },
  { x: 18, y: 8 },
  { x: 54, y: 10 },
  // 第 2 排（中坚交叉火网，y = +38）
  { x: -72, y: 38 },
  { x: -36, y: 36 },
  { x: 0, y: 34 },
  { x: 36, y: 36 },
  { x: 72, y: 38 },
  // 第 3 排（侧翼警戒与重火力，y = +66）
  { x: -78, y: 66 },
  { x: -39, y: 64 },
  { x: 0, y: 62 },
  { x: 39, y: 64 },
  { x: 78, y: 66 },
  // 第 4 排（后卫支援，y = +94）
  { x: -82, y: 94 },
  { x: -41, y: 92 },
  { x: 0, y: 90 },
  { x: 41, y: 92 },
  { x: 82, y: 94 },
  // 第 5 排（预备梯队，y = +120）
  { x: -75, y: 120 },
  { x: -45, y: 118 },
  { x: -15, y: 116 },
  { x: 15, y: 116 },
  { x: 45, y: 118 },
  { x: 75, y: 120 },
];

export class SiegeSimulator {
  readonly seed: number;
  readonly map: SiegeMapConfig;
  readonly mode: SiegeModeId;
  readonly maxDurationSec: number;
  readonly maxTicks: number;
  private readonly rng: () => number;

  readonly isDarkMode: boolean;
  readonly outerWalls: WallSegment[];
  readonly deadCornerWalls: WallSegment[];
  readonly waypoints: Array<{ x: number; y: number }>;
  readonly waypointCumLen: number[] = [0];
  readonly totalPathLen: number = 0;
  squadPathDist = 0;
  lightCones: LightConeSpec[] = [];
  blackoutActive = false;
  sonarAwakened = false;

  // 2D 动态平滑跟随镜头左上角世界坐标 (camX, camY) 与小地图已探索网格
  camX = 0;
  camY = 0;
  squadMoveAngle = -Math.PI * 0.5;
  readonly navBlocked = new Uint8Array(NAV_COLS * NAV_ROWS);
  readonly navDist = new Int16Array(NAV_COLS * NAV_ROWS);
  readonly squadNavDist = new Int16Array(NAV_COLS * NAV_ROWS);
  readonly exploredGrid = new Uint8Array(NAV_COLS * NAV_ROWS);
  private readonly bfsQueue = new Int32Array(NAV_COLS * NAV_ROWS);

  tick = 0;
  reds: RedDot[] = [];
  greens: GreenUnit[] = [];
  nodes: TacticalNodeState[] = [];
  hive: MotherHiveState;
  firingLines: StraightFiringLine[] = [];
  sparks: BulletSpark[] = [];
  rings: ShockRing[] = [];
  banners: FloatingBanner[] = [];
  pendingDecals: PersistentDecalEvent[] = [];
  audioEvents: SiegeAudioEvent[] = [];

  kills = 0;
  casualties = 0;
  infectedCount = 0;
  rescuedCount = 0;
  bunkersBuilt = 0;
  bunkerEnergy = 0;
  readonly maxBunkers = 5;

  totalSpawned = 0;
  bossesSpawned = 0;
  bossesKilled = 0;
  readonly totalBosses: number;
  private spawnedBossIndices = new Set<number>();

  squadCenterX = CORRIDOR_CX;
  squadCenterY = 2660;
  squadBuffed = false;
  counterPushActive = false;
  private holdForRescueTicks = 0;

  private earlySacrificeTriggered = false;
  private midSacrificeTriggered = false;
  private lateSacrificeTriggered = false;
  private blackoutTriggered = false;
  private blackoutRecovered = false;
  private mazeLinkedUp = false;
  private finalWaveTriggered = false;
  private lastAttritionTick = 0;

  vehicles: InsertionVehicle[] = [];
  phase: "defend" | "evolve" | "counterpush" | "victory" | "defeat" = "defend";
  isFinished = false;
  private victoryHoldTicks = 0;
  private defeatHoldTicks = 0;

  alarmFlash = 0;
  callout: CalloutState | null = null;

  private nextRedId = 1;
  private nextGreenId = 1;
  private grid: number[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);

  constructor(
    seed: number,
    mapId: SiegeMapId = "canyon-bridge",
    durationSec?: number,
    modeId: SiegeModeId = "combo",
  ) {
    this.seed = seed;
    this.map = SIEGE_MAPS[mapId] ?? SIEGE_MAPS["canyon-bridge"];
    this.mode = modeId;
    this.isDarkMode = isDarkDeadCornerMode(modeId);
    this.outerWalls = getOuterWallSegments(modeId);
    this.deadCornerWalls = getDeadCornerWalls(modeId);
    this.waypoints = getSquadWaypoints(modeId);
    let cum = 0;
    this.waypointCumLen = [0];
    for (let i = 1; i < this.waypoints.length; i++) {
      cum += Math.hypot(
        this.waypoints[i].x - this.waypoints[i - 1].x,
        this.waypoints[i].y - this.waypoints[i - 1].y,
      );
      this.waypointCumLen.push(cum);
    }
    this.totalPathLen = Math.max(1, cum);
    this.squadPathDist = 0;
    this.maxDurationSec = durationSec ?? 42;
    this.maxTicks = Math.round(this.maxDurationSec * SIM_HZ);
    this.rng = mulberry32(seed);
    this.totalBosses = this.map.bossWaves.length;

    // 0. 构建大世界科学寻路障碍网格
    this.initNavObstacles();

    // 1. 初始化北部【丧尸母巢核心】
    const hpSpec = this.map.hivePos;
    this.hive = {
      x: hpSpec.x,
      y: hpSpec.y,
      r: hpSpec.r,
      hp: hpSpec.hp,
      maxHp: hpSpec.hp,
      ghostHp: hpSpec.hp,
      alive: true,
      hitFlash: 0,
      pulsePhase: 0,
    };

    // 2. 初始化南部入口【战术载具入场（重装军用大巴 / 黑鹰武装直升机）】与先遣小队
    const wp0 = this.waypoints[0];
    this.squadCenterX = wp0.x;
    this.squadCenterY = wp0.y;
    this.initInsertionVehicles();

    // 3. 部署大地图各区域战术目标节点（深藏于封闭侧室门后、反应堆双环翼侧、S弯盲区袋与三监区走廊出口）
    this.initTacticalNodes();

    // 4. 在各大房间、拐角盲区、走廊深处与南门入口科学部署伏击尸群
    this.prepopulateInitialSwarm(135);
    this.updateNavFlowField();
    this.rebuildLightCones(0);
    this.updateCamera(true);
  }

  /**
   * 初始化各模式专属战术入场载具（开局全员在车内，先由载具向前推进 330px 扫射/撞击清空第一波尸潮，停稳后才开门/索降下车！）
   */
  private initInsertionVehicles(): void {
    this.vehicles = [];
    if (this.mode === "maze-infect") {
      // 三通道生化监区：3 台防暴押解装甲大巴同时从南门冲入左路 A 监区(x=535)、中路 B 监区(x=925)、右路 C 监区(x=1265)，边推进边扫射清完第一波尸潮后下车！
      const specs = [
        { id: 1, x: 925, subSquad: 0 },
        { id: 2, x: 535, subSquad: 1 },
        { id: 3, x: 1265, subSquad: 2 },
      ];
      for (const s of specs) {
        this.vehicles.push({
          id: s.id,
          kind: "bus",
          x: s.x,
          y: 2885,
          startX: s.x,
          startY: 2885,
          stopX: s.x,
          stopY: 2560,
          angle: -Math.PI * 0.5,
          turretAngle: -Math.PI * 0.5,
          muzzleFlash: 0,
          rotorAngle: 0,
          doorOpen: 0,
          ropeDrop: 0,
          headlightsOn: true,
          phase: "inbound",
          subSquad: s.subSquad,
          deployedCount: 0,
          totalToDeploy: 2,
        });
      }
      this.squadCenterX = 900;
      this.squadCenterY = 2850;
    } else if (this.mode === "blackout" || this.mode === "sonar") {
      // 黑鹰武装直升机 / 声呐潜行直升机：先从 y=2890 低空推进至 y=2560 用双翼加特林机炮+破片火箭弹扫射清空第一波前哨尸潮，再悬停索降 6 名特战队员！
      const lzX = this.mode === "sonar" ? 885 : 900;
      const lzY = 2560;
      this.vehicles.push({
        id: 1,
        kind: "helicopter",
        x: lzX,
        y: 2890,
        startX: lzX,
        startY: 2890,
        stopX: lzX,
        stopY: lzY,
        angle: -Math.PI * 0.5,
        turretAngle: -Math.PI * 0.5,
        muzzleFlash: 0,
        rotorAngle: 0,
        doorOpen: 0,
        ropeDrop: 0,
        headlightsOn: true,
        phase: "inbound",
        subSquad: 0,
        deployedCount: 0,
        totalToDeploy: 6,
      });
      this.squadCenterX = lzX;
      this.squadCenterY = 2850;
    } else {
      // scavenge 及其他模式：重装防暴军用大巴从 y=2885 向前推进至 y=2560，用破障撞角与车顶双联重机枪扫平第一波前哨尸群，急刹开门后士兵才下车！
      const bx = this.squadCenterX;
      this.vehicles.push({
        id: 1,
        kind: "bus",
        x: bx,
        y: 2885,
        startX: bx,
        startY: 2885,
        stopX: bx,
        stopY: 2560,
        angle: -Math.PI * 0.5,
        turretAngle: -Math.PI * 0.5,
        muzzleFlash: 0,
        rotorAngle: 0,
        doorOpen: 0,
        ropeDrop: 0,
        headlightsOn: true,
        phase: "inbound",
        subSquad: 0,
        deployedCount: 0,
        totalToDeploy: 6,
      });
      this.squadCenterY = 2850;
    }
  }

  /**
   * 实时更新入场载具：
   * 1) 第一阶段 (t = 0.0s .. 3.2s)：全员在载具内，载具向前推进 325px 并倾泻车载重机枪/机载加特林/破片火箭弹与撞角碾压，彻底扫清第一波前哨尸群；
   * 2) 第二阶段 (t = 3.2s .. 4.15s)：第一波攻击完成后，载具驻停/悬停并打开车门/放下索降绳，6 名士兵依次下车列阵！
   */
  private updateVehicles(tSec: number): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.phase === "gone") continue;
      if (v.muzzleFlash > 0) v.muzzleFlash = Math.max(0, v.muzzleFlash - 0.25);

      if (v.kind === "helicopter") {
        v.rotorAngle = (v.rotorAngle + 0.48) % (Math.PI * 2);
        if (tSec < 3.2) {
          // 阶段 1：直升机低空突进扫射第一波前哨尸群 (y: 2890 -> 2560)
          const p = clamp(tSec / 3.2, 0, 1);
          const ease = 1 - Math.pow(1 - p, 2.1);
          v.x = v.startX + Math.sin(tSec * 3.6) * 14;
          v.y = v.startY + (v.stopY - v.startY) * ease;
          v.ropeDrop = 0;
          v.phase = "inbound";
          if (this.greens.length === 0) {
            this.squadCenterX = v.x;
            this.squadCenterY = v.y - 25;
          }
          this.fireVehicleWeapons(v, tSec);
        } else if (tSec < 4.35) {
          // 阶段 2：扫清第一波尸群后悬停并放下双侧索降绳，6 名队员依次滑降下机
          v.x = v.stopX + Math.sin(tSec * 4.5) * 3.0;
          v.y = v.stopY + Math.cos(tSec * 3.8) * 2.5;
          v.ropeDrop = clamp((tSec - 3.2) / 0.22, 0.2, 1.0);
          v.phase = "deploying";
          this.clearEntranceStragglers(v);
          this.fireVehicleWeapons(v, tSec);

          if (this.tick % 16 === 2) {
            this.rings.push({
              x: v.x,
              y: v.y,
              maxR: 92,
              ttl: 18,
              maxTtl: 18,
              kind: this.mode === "sonar" ? "sonar" : "rescue",
            });
          }

          const targetDeployed = Math.min(
            v.totalToDeploy,
            Math.floor(Math.max(0, tSec - 3.28) / 0.14) + 1,
          );
          while (v.deployedCount < targetDeployed && tSec >= 3.28) {
            const side = v.deployedCount % 2 === 0 ? -1 : 1;
            const role: GreenRole = v.deployedCount % 3 === 1 ? "shotgun" : "rifle";
            const sx = v.x + side * 34;
            const sy = v.y - 18 - (v.deployedCount >> 1) * 12;
            this.spawnGreenUnit(role, sx, sy);
            this.rings.push({ x: sx, y: sy, maxR: 40, ttl: 12, maxTtl: 12, kind: "rescue" });
            v.deployedCount++;
          }
        } else if (tSec < 5.8) {
          // 阶段 3：全员下机完毕，直升机收起索降绳侧倾盘旋驶离战场
          v.phase = "departing";
          v.ropeDrop = Math.max(0, 1 - (tSec - 4.35) * 2.4);
          const dt = tSec - 4.35;
          v.angle = -Math.PI * 0.5 - clamp(dt * 0.85, 0, 1.15);
          v.x -= dt * 6.2;
          v.y += dt * 4.8;
        } else {
          v.phase = "gone";
          v.headlightsOn = false;
        }
      } else {
        // 军用防暴大巴 / 押解装甲大巴：
        if (tSec < 3.2) {
          // 阶段 1：装甲大巴向前强推 325px (y: 2885 -> 2560)，车顶双联重机枪 + 侧窗射击孔火力全开，车头 V 型破障撞角直接撞碎挡路丧尸！
          const p = clamp(tSec / 3.2, 0, 1);
          const ease = 1 - Math.pow(1 - p, 2.1);
          v.x = v.startX + (v.stopX - v.startX) * ease;
          v.y = v.startY + (v.stopY - v.startY) * ease;
          v.doorOpen = 0;
          v.phase = "inbound";
          if (this.greens.length === 0 && v.id === 1) {
            this.squadCenterX = this.mode === "maze-infect" ? 900 : v.x;
            this.squadCenterY = v.y - 25;
          }

          // 车头 V 型破障撞角物理碾压撞击判定
          for (let ri = this.reds.length - 1; ri >= 0; ri--) {
            const r = this.reds[ri];
            if (r.kind === "boss") continue;
            if (Math.abs(r.x - v.x) <= r.r + 34 && r.y >= v.y - 68 && r.y <= v.y + 50) {
              this.rings.push({ x: r.x, y: r.y, maxR: 42, ttl: 10, maxTtl: 10, kind: "casualty" });
              this.pendingDecals.push({ kind: "blood", x: r.x, y: r.y, r: 15, seed: r.id });
              this.spawnImpactParticles(r.x, r.y, 0, -1, "blood", 5);
              this.spawnImpactParticles(r.x, r.y, 0, -1, "spark", 4);
              this.killRedDot(ri, tSec);
            }
          }

          this.fireVehicleWeapons(v, tSec);
        } else {
          // 阶段 2 & 3：推进一波攻击扫平前哨尸潮后，大巴急刹停稳 (y=2560)，液压装甲门展开，车内士兵依次下车突击！
          v.x = v.stopX;
          v.y = v.stopY;
          v.doorOpen = clamp((tSec - 3.2) / 0.25, 0.2, 1.0);
          v.phase = v.deployedCount < v.totalToDeploy ? "deploying" : "parked";

          if (tSec < 4.25) {
            this.clearEntranceStragglers(v);
          }
          this.fireVehicleWeapons(v, tSec);

          if (this.mode === "maze-infect") {
            const targetDeployed = Math.min(
              v.totalToDeploy,
              Math.floor(Math.max(0, tSec - 3.30) / 0.28) + 1,
            );
            while (v.deployedCount < targetDeployed && tSec >= 3.30) {
              const side = v.deployedCount % 2 === 0 ? -1 : 1;
              const role: GreenRole =
                v.subSquad === 1 && v.deployedCount === 0 ? "shotgun" : "rifle";
              const u = this.spawnGreenUnit(role, v.x + side * 26, v.y - 34);
              u.subSquad = v.subSquad;
              this.rings.push({ x: u.x, y: u.y, maxR: 38, ttl: 12, maxTtl: 12, kind: "rescue" });
              v.deployedCount++;
            }
          } else {
            const targetDeployed = Math.min(
              v.totalToDeploy,
              Math.floor(Math.max(0, tSec - 3.28) / 0.14) + 1,
            );
            while (v.deployedCount < targetDeployed && tSec >= 3.28) {
              const side = v.deployedCount % 2 === 0 ? -1 : 1;
              const role: GreenRole = v.deployedCount % 3 === 0 ? "shotgun" : "rifle";
              const sx = v.x + side * 36;
              const sy = v.y - 26 - (v.deployedCount >> 1) * 12;
              this.spawnGreenUnit(role, sx, sy);
              this.rings.push({ x: sx, y: sy, maxR: 38, ttl: 12, maxTtl: 12, kind: "rescue" });
              v.deployedCount++;
            }
          }
        }
      }
    }
  }

  /**
   * 载具完成开场推进攻击波次准备开门/索降时 (t = 3.2s..4.2s)，肃清着陆区南侧残余零星小怪，确保下车区 100% 安全无贴脸或遗漏
   */
  private clearEntranceStragglers(v: InsertionVehicle): void {
    for (let ri = this.reds.length - 1; ri >= 0; ri--) {
      const r = this.reds[ri];
      if (r.kind === "boss") continue;
      if (r.y >= 2410 && Math.abs(r.x - v.x) <= 260) {
        this.firingLines.push({
          x1: v.x,
          y1: v.y - 14,
          x2: r.x,
          y2: r.y,
          heavy: true,
          hitKind: "minion",
        });
        v.muzzleFlash = 1.0;
        this.pendingDecals.push({ kind: "blood", x: r.x, y: r.y, r: 12, seed: r.id });
        this.spawnImpactParticles(r.x, r.y, 0, -1, "blood", 4);
        this.killRedDot(ri, this.tick / SIM_HZ);
      }
    }
  }

  /**
   * 车载重机枪塔 / 车侧射击孔 / 直升机双翼加特林机炮与破片火箭巢开火逻辑（射程严格限制在 <= 345px）
   */
  private fireVehicleWeapons(v: InsertionVehicle, tSec: number): void {
    const maxRange = 345;
    const mounts: Array<{ ox: number; oy: number; heavy: boolean; dmg: number }> =
      v.kind === "bus"
        ? tSec < 3.6
          ? [
              { ox: 0, oy: -12, heavy: true, dmg: 6.8 },
              { ox: -24, oy: -6, heavy: false, dmg: 4.6 },
              { ox: 24, oy: -6, heavy: false, dmg: 4.6 },
              { ox: 0, oy: -46, heavy: true, dmg: 5.8 },
            ]
          : [{ ox: 0, oy: -12, heavy: true, dmg: 5.5 }]
        : [
            { ox: -30, oy: -6, heavy: true, dmg: 6.2 },
            { ox: 30, oy: -6, heavy: true, dmg: 6.2 },
            { ox: 0, oy: -20, heavy: true, dmg: 6.8 },
          ];

    let firedAny = false;
    for (let mi = 0; mi < mounts.length; mi++) {
      const m = mounts[mi];
      const mx = v.x + m.ox;
      const my = v.y + m.oy;

      let bestIdx = -1;
      let bestScore = Infinity;
      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        const d = Math.hypot(r.x - mx, r.y - my) - r.r;
        if (d > maxRange || r.y > v.y + 65) continue;
        if (!this.hasLineOfSight(mx, my, r.x, r.y)) continue;
        const score = d - (r.y - (v.y - 340)) * 1.4 + ((ri + mi) % 4) * 14;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = ri;
        }
      }

      if (bestIdx < 0) continue;
      const target = this.reds[bestIdx];
      const dx = target.x - mx;
      const dy = target.y - my;
      const aimDist = Math.hypot(dx, dy) || 1;
      const ux = dx / aimDist;
      const uy = dy / aimDist;

      if (mi === 0) {
        v.turretAngle = Math.atan2(dy, dx);
      }

      let bestDist = Math.min(maxRange, aimDist + 10);
      let hitRedIdx = bestIdx;
      const dWall = this.castRayToWalls(mx, my, ux, uy, bestDist);
      if (dWall < bestDist) {
        bestDist = dWall;
        hitRedIdx = -1;
      }

      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        const rdx = r.x - mx;
        const rdy = r.y - my;
        const proj = rdx * ux + rdy * uy;
        if (proj <= -r.r || proj - r.r >= bestDist) continue;
        const perp2 = rdx * rdx + rdy * rdy - proj * proj;
        const hitR = r.r + 3.0;
        if (perp2 <= hitR * hitR) {
          const halfChord = Math.sqrt(Math.max(0, hitR * hitR - perp2));
          const tHit = Math.max(2, proj - halfChord);
          if (tHit < bestDist) {
            bestDist = tHit;
            hitRedIdx = ri;
          }
        }
      }

      const hx = mx + ux * bestDist;
      const hy = my + uy * bestDist;
      this.firingLines.push({
        x1: mx,
        y1: my,
        x2: hx,
        y2: hy,
        heavy: m.heavy,
        hitKind: hitRedIdx >= 0 ? "minion" : "wall",
      });
      firedAny = true;

      if (hitRedIdx >= 0 && this.reds[hitRedIdx]) {
        const hitR = this.reds[hitRedIdx];
        hitR.hp -= m.dmg;
        hitR.hitFlash = 1.0;
        if (this.tick % 2 === 0) {
          this.spawnImpactParticles(hx, hy, ux, uy, "blood", 2);
        }
        if (hitR.hp <= 0) {
          this.killRedDot(hitRedIdx, tSec);
        }
      }
    }

    // 直升机在低空突进阶段 (t < 3.1s) 每隔 28 帧发射一枚机载破片火箭弹轰炸前排尸群
    if (v.kind === "helicopter" && tSec >= 0.45 && tSec <= 3.1 && this.tick % 28 === 10) {
      let clusterIdx = -1;
      let minD = Infinity;
      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        const d = Math.hypot(r.x - v.x, r.y - v.y);
        if (r.y >= 2410 && d < 340 && d < minD) {
          minD = d;
          clusterIdx = ri;
        }
      }
      if (clusterIdx >= 0) {
        const c = this.reds[clusterIdx];
        const rx = c.x;
        const ry = c.y;
        this.rings.push({ x: rx, y: ry, maxR: 72, ttl: 16, maxTtl: 16, kind: "hive-kill" });
        this.pendingDecals.push({ kind: "scorch", x: rx, y: ry, r: 22, seed: this.tick });
        this.spawnImpactParticles(rx, ry, 0, -1, "gold", 8);
        this.emitAudio("heavy-mg", 0.55, 0.78);
        for (let ri = this.reds.length - 1; ri >= 0; ri--) {
          const r = this.reds[ri];
          if (r.kind !== "boss" && Math.hypot(r.x - rx, r.y - ry) <= 56) {
            r.hp -= 95;
            r.hitFlash = 1.0;
            if (r.hp <= 0) {
              this.killRedDot(ri, tSec);
            }
          }
        }
      }
    }

    if (firedAny) {
      v.muzzleFlash = 1.0;
      if (this.tick % 4 === 0) {
        this.emitAudio("heavy-mg", 0.28, 0.88 + this.rng() * 0.14);
      }
    }
  }

  private initTacticalNodes(): void {
    const specs: TacticalNodeSpec[] = [];
    if (this.mode === "scavenge") {
      specs.push(
        { id: "n1", kind: "rescue_cage", label: "+6", subLabel: "", x: 520, y: 2315, r: 26, hp: 195, rewardValue: 6, rewardRole: "rifle" },
        { id: "n2", kind: "multiply_crystal", label: "×2", subLabel: "", x: 1280, y: 1595, r: 26, hp: 235, rewardValue: 2 },
        { id: "n3", kind: "rescue_cage", label: "+7", subLabel: "", x: 520, y: 925, r: 26, hp: 275, rewardValue: 7, rewardRole: "sniper" },
      );
    } else if (this.mode === "blackout") {
      specs.push(
        { id: "n1", kind: "bunker_pad", label: "+2", subLabel: "", x: 540, y: 2130, r: 26, hp: 195, rewardValue: 5, rewardRole: "turret" },
        { id: "n2", kind: "multiply_crystal", label: "×2", subLabel: "", x: 1220, y: 1050, r: 26, hp: 235, rewardValue: 2 },
        { id: "n3", kind: "rescue_cage", label: "+7", subLabel: "", x: 900, y: 650, r: 26, hp: 275, rewardValue: 7, rewardRole: "sniper" },
      );
    } else if (this.mode === "sonar") {
      specs.push(
        { id: "n1", kind: "rescue_cage", label: "+6", subLabel: "", x: 530, y: 2210, r: 26, hp: 195, rewardValue: 6, rewardRole: "rifle" },
        { id: "n2", kind: "multiply_crystal", label: "×2", subLabel: "", x: 1250, y: 1540, r: 26, hp: 235, rewardValue: 2 },
        { id: "n3", kind: "rescue_cage", label: "+7", subLabel: "", x: 540, y: 880, r: 26, hp: 275, rewardValue: 7, rewardRole: "sniper" },
      );
    } else if (this.mode === "maze-infect") {
      specs.push(
        { id: "n1", kind: "rescue_cage", label: "+6", subLabel: "", x: 640, y: 1520, r: 26, hp: 195, rewardValue: 6, rewardRole: "rifle" },
        { id: "n2", kind: "multiply_crystal", label: "×2", subLabel: "", x: 1160, y: 1380, r: 26, hp: 235, rewardValue: 2 },
        { id: "n3", kind: "rescue_cage", label: "+7", subLabel: "", x: 580, y: 840, r: 26, hp: 275, rewardValue: 7, rewardRole: "sniper" },
      );
    } else {
      specs.push(
        { id: "n1", kind: "rescue_cage", label: "+6", subLabel: "", x: 780, y: 2150, r: 26, hp: 260, rewardValue: 6, rewardRole: "rifle" },
        { id: "n2", kind: "multiply_crystal", label: "×2", subLabel: "", x: 1020, y: 1480, r: 26, hp: 320, rewardValue: 2 },
        { id: "n3", kind: "rescue_cage", label: "+7", subLabel: "", x: 780, y: 860, r: 26, hp: 380, rewardValue: 7, rewardRole: "sniper" },
      );
    }

    this.nodes = specs.map(s => ({
      ...s,
      maxHp: s.hp,
      ghostHp: s.hp,
      broken: false,
      hitFlash: 0,
    }));
  }

  private setCallout(text: string, kind: CalloutState["kind"], durSec: number): void {
    const ticks = Math.round(durSec * SIM_HZ);
    this.callout = { text, kind, ttl: ticks, maxTtl: ticks };
  }

  private addBanner(x: number, y: number, text: string, color: [number, number, number, number]): void {
    this.banners.push({
      x,
      y,
      vy: -1.1,
      text,
      color,
      ttl: 46,
      maxTtl: 46,
    });
  }

  private emitAudio(kind: SiegeAudioEvent["kind"], gain = 1, pitch = 1): void {
    this.audioEvents.push({
      timeSec: this.tick / SIM_HZ,
      kind,
      gain,
      pitch,
    });
  }

  /**
   * 确保出生点绝不位于封闭反应堆岛内部或死角隔墙内部，从源头杜绝出生后第 1 帧被墙体弹飞
   */
  private sanitizeSpawnPoint(rawX: number, rawY: number, r: number): { x: number; y: number } {
    const y = clamp(rawY, r + 32, WORLD_H - 42 - r);
    const b = getCorridorBounds(y, this.mode);
    let x = clamp(rawX, b.left + r + 14, b.right - r - 14);

    // blackout 模式下：两座中央反应堆屏蔽岛 (x=760..1040, y=2040..2220 及 y=960..1140) 为实心封闭禁区
    if (this.mode === "blackout") {
      if (y >= 2025 - r && y <= 2235 + r && x >= 748 - r && x <= 1052 + r) {
        x = x < 900 ? 732 - r : 1068 + r;
      }
      if (y >= 945 - r && y <= 1155 + r && x >= 748 - r && x <= 1052 + r) {
        x = x < 900 ? 732 - r : 1068 + r;
      }
    }

    const dummy = { x, y, r };
    for (let iter = 0; iter < 2; iter++) {
      for (const seg of this.outerWalls) {
        this.resolveSegmentCollision(dummy, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      for (const seg of this.deadCornerWalls) {
        this.resolveSegmentCollision(dummy, seg.x1, seg.y1, seg.x2, seg.y2);
      }
    }
    return { x: dummy.x, y: dummy.y };
  }

  /**
   * 为新加入的人类士兵分配当前空闲的最小编号战术阵位（保证老兵阵位绝不跳变）
   */
  private allocateFormationSlot(isTurret: boolean): { slotIndex: number; slotX: number; slotY: number } {
    if (isTurret) {
      const side = this.bunkersBuilt % 2 === 0 ? 1 : -1;
      const rank = Math.floor((this.bunkersBuilt - 1) / 2);
      return {
        slotIndex: 100 + this.bunkersBuilt,
        slotX: side * (52 + rank * 24),
        slotY: -12 + rank * 16,
      };
    }
    const used = new Set<number>();
    for (let i = 0; i < this.greens.length; i++) {
      used.add(this.greens[i].slotIndex);
    }
    let chosen = 0;
    while (used.has(chosen) && chosen < FORMATION_OFFSETS.length - 1) {
      chosen++;
    }
    const off = FORMATION_OFFSETS[chosen % FORMATION_OFFSETS.length];
    return { slotIndex: chosen, slotX: off.x, slotY: off.y };
  }

  private spawnGreenUnit(role: GreenRole, x: number, y: number): GreenUnit {
    const isTurret = role === "turret";
    const r = isTurret ? 14 : 10.5;
    const clean = this.sanitizeSpawnPoint(x, y, r);
    const slot = this.allocateFormationSlot(isTurret);
    const unit: GreenUnit = {
      id: this.nextGreenId++,
      role,
      x: clean.x,
      y: clean.y,
      vx: 0,
      vy: 0,
      prevX: clean.x,
      prevY: clean.y,
      slotX: slot.slotX,
      slotY: slot.slotY,
      r,
      hp: isTurret ? 3 : 1, // 普通士兵 hp=1 一碰即碎！机枪碉堡可抗 3 下
      maxHp: isTurret ? 3 : 1,
      aimAngle: -Math.PI / 2,
      slotIndex: slot.slotIndex,
      alive: true,
      muzzleFlash: 0,
      recoilOffset: 0,
      lockedTargetId: -1,
      buffed: this.squadBuffed,
    };
    this.greens.push(unit);
    return unit;
  }

  /**
   * 构建 2D 科学寻路网格障碍表（外墙以外、反应堆实心核及死角隔墙线段周围标记为不可通行）
   */
  private initNavObstacles(): void {
    this.navBlocked.fill(0);
    for (let gy = 0; gy < NAV_ROWS; gy++) {
      const cy = (gy + 0.5) * NAV_CELL;
      const b = getCorridorBounds(cy, this.mode);
      for (let gx = 0; gx < NAV_COLS; gx++) {
        const cx = (gx + 0.5) * NAV_CELL;
        if (cy < 28 || cy > WORLD_H - 28 || cx < b.left + 16 || cx > b.right - 16) {
          this.navBlocked[gy * NAV_COLS + gx] = 1;
          continue;
        }
        if (this.mode === "blackout") {
          if (
            cx >= 752 &&
            cx <= 1048 &&
            ((cy >= 2032 && cy <= 2228) || (cy >= 952 && cy <= 1148))
          ) {
            this.navBlocked[gy * NAV_COLS + gx] = 1;
            continue;
          }
        }
        for (let wi = 0; wi < this.deadCornerWalls.length; wi++) {
          const w = this.deadCornerWalls[wi];
          const vx = w.x2 - w.x1;
          const vy = w.y2 - w.y1;
          const len2 = vx * vx + vy * vy || 1;
          const t = clamp(((cx - w.x1) * vx + (cy - w.y1) * vy) / len2, 0, 1);
          const px = w.x1 + vx * t;
          const py = w.y1 + vy * t;
          if (Math.hypot(cx - px, cy - py) <= 23) {
            this.navBlocked[gy * NAV_COLS + gx] = 1;
            break;
          }
        }
      }
    }
  }

  /**
   * 实时计算双向科学 BFS 最短路径流场：
   * 1) `navDist`：全图丧尸流向最近人类士兵的绕墙寻路场；
   * 2) `squadNavDist`：侧室解救新兵、隔墙分队士兵流向主队核心/汇合点的绕墙寻路场！
   */
  private updateNavFlowField(): void {
    // 1. 丧尸寻路流场 navDist
    this.navDist.fill(30000);
    let head = 0;
    let tail = 0;

    if (this.greens.length > 0) {
      for (let i = 0; i < this.greens.length; i++) {
        const g = this.greens[i];
        const gx = clamp(Math.floor(g.x / NAV_CELL), 0, NAV_COLS - 1);
        const gy = clamp(Math.floor(g.y / NAV_CELL), 0, NAV_ROWS - 1);
        const idx = gy * NAV_COLS + gx;
        if (this.navDist[idx] > 0) {
          this.navDist[idx] = 0;
          this.bfsQueue[tail++] = idx;
        }
      }
    } else {
      for (let i = 0; i < this.vehicles.length; i++) {
        const v = this.vehicles[i];
        if (v.phase === "gone") continue;
        const gx = clamp(Math.floor(v.x / NAV_CELL), 0, NAV_COLS - 1);
        const gy = clamp(Math.floor(v.y / NAV_CELL), 0, NAV_ROWS - 1);
        const idx = gy * NAV_COLS + gx;
        if (!this.navBlocked[idx] && this.navDist[idx] > 0) {
          this.navDist[idx] = 0;
          this.bfsQueue[tail++] = idx;
        }
      }
    }

    while (head < tail) {
      const curr = this.bfsQueue[head++];
      const d = this.navDist[curr];
      const cx = curr % NAV_COLS;
      const cy = Math.floor(curr / NAV_COLS);

      if (cx > 0) {
        const ni = curr - 1;
        if (!this.navBlocked[ni] && this.navDist[ni] > d + 1) {
          this.navDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cx + 1 < NAV_COLS) {
        const ni = curr + 1;
        if (!this.navBlocked[ni] && this.navDist[ni] > d + 1) {
          this.navDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cy > 0) {
        const ni = curr - NAV_COLS;
        if (!this.navBlocked[ni] && this.navDist[ni] > d + 1) {
          this.navDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cy + 1 < NAV_ROWS) {
        const ni = curr + NAV_COLS;
        if (!this.navBlocked[ni] && this.navDist[ni] > d + 1) {
          this.navDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
    }

    // 2. 人类士兵归队/突围寻路流场 squadNavDist
    this.squadNavDist.fill(30000);
    head = 0;
    tail = 0;

    const anyInLowerMaze =
      this.mode === "maze-infect" && this.greens.some(u => u.y > 2020);
    const rallyX = anyInLowerMaze ? 900 : this.squadCenterX;
    const rallyY = anyInLowerMaze ? 1920 : this.squadCenterY;
    const rgx = clamp(Math.floor(rallyX / NAV_CELL), 0, NAV_COLS - 1);
    const rgy = clamp(Math.floor(rallyY / NAV_CELL), 0, NAV_ROWS - 1);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = clamp(rgx + dx, 0, NAV_COLS - 1);
        const ny = clamp(rgy + dy, 0, NAV_ROWS - 1);
        const ni = ny * NAV_COLS + nx;
        if (!this.navBlocked[ni] && this.squadNavDist[ni] > 0) {
          this.squadNavDist[ni] = 0;
          this.bfsQueue[tail++] = ni;
        }
      }
    }

    while (head < tail) {
      const curr = this.bfsQueue[head++];
      const d = this.squadNavDist[curr];
      const cx = curr % NAV_COLS;
      const cy = Math.floor(curr / NAV_COLS);

      if (cx > 0) {
        const ni = curr - 1;
        if (!this.navBlocked[ni] && this.squadNavDist[ni] > d + 1) {
          this.squadNavDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cx + 1 < NAV_COLS) {
        const ni = curr + 1;
        if (!this.navBlocked[ni] && this.squadNavDist[ni] > d + 1) {
          this.squadNavDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cy > 0) {
        const ni = curr - NAV_COLS;
        if (!this.navBlocked[ni] && this.squadNavDist[ni] > d + 1) {
          this.squadNavDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
      if (cy + 1 < NAV_ROWS) {
        const ni = curr + NAV_COLS;
        if (!this.navBlocked[ni] && this.squadNavDist[ni] > d + 1) {
          this.squadNavDist[ni] = d + 1;
          this.bfsQueue[tail++] = ni;
        }
      }
    }
  }

  /**
   * 采样 (x, y) 处的 BFS 流场方向单位向量（供丧尸或人类士兵科学绕过墙壁与门洞）：
   * - 铁律：只允许采样与当前坐标 (x, y) 之间无任何墙体阻挡 (hasLineOfSight) 的非阻塞网格，彻底杜绝贴墙时采样到墙体背面网格导致撞墙死锁！
   */
  private sampleFlowFromField(
    field: Int16Array,
    x: number,
    y: number,
  ): { fx: number; fy: number; valid: boolean } {
    const gx = clamp(Math.floor(x / NAV_CELL), 0, NAV_COLS - 1);
    const gy = clamp(Math.floor(y / NAV_CELL), 0, NAV_ROWS - 1);
    const curIdx = gy * NAV_COLS + gx;
    let bestD = this.navBlocked[curIdx] ? 30000 : field[curIdx];
    let bestTargetX = x;
    let bestTargetY = y;
    let bestDistSq = Infinity;
    let found = false;

    for (let dy = -2; dy <= 2; dy++) {
      const ny = gy + dy;
      if (ny < 0 || ny >= NAV_ROWS) continue;
      const ncy = ny * NAV_CELL + NAV_CELL * 0.5;
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx + dx;
        if (nx < 0 || nx >= NAV_COLS) continue;
        const ni = ny * NAV_COLS + nx;
        if (this.navBlocked[ni]) continue;
        const nd = field[ni];
        if (nd >= 30000 || nd > bestD) continue;

        const ncx = nx * NAV_CELL + NAV_CELL * 0.5;
        if (!this.hasLineOfSight(x, y, ncx, ncy)) continue;

        const d2 = (ncx - x) * (ncx - x) + (ncy - y) * (ncy - y);
        if (nd < bestD || (nd === bestD && d2 < bestDistSq)) {
          bestD = nd;
          bestTargetX = ncx;
          bestTargetY = ncy;
          bestDistSq = d2;
          found = true;
        }
      }
    }

    if (!found) {
      return { fx: 0, fy: 0, valid: false };
    }
    const vx = bestTargetX - x;
    const vy = bestTargetY - y;
    const len = Math.hypot(vx, vy) || 1;
    return { fx: vx / len, fy: vy / len, valid: true };
  }

  private sampleNavFlow(x: number, y: number): { fx: number; fy: number; valid: boolean } {
    return this.sampleFlowFromField(this.navDist, x, y);
  }

  private sampleSquadFlow(x: number, y: number): { fx: number; fy: number; valid: boolean } {
    return this.sampleFlowFromField(this.squadNavDist, x, y);
  }

  /**
   * 2D 动态平滑镜头跟随（实时追踪小队中心 + 推进方向前瞻偏移，并记录已探索小地图网格）
   */
  private updateCamera(snap = false): void {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (let i = 0; i < this.greens.length; i++) {
      const g = this.greens[i];
      if (g.role === "turret") continue;
      sumX += g.x;
      sumY += g.y;
      count++;
    }
    if (count === 0 && this.vehicles.length > 0) {
      for (let i = 0; i < this.vehicles.length; i++) {
        const v = this.vehicles[i];
        if (v.phase === "gone") continue;
        sumX += v.x;
        sumY += v.y;
        count++;
      }
    }
    const focusX = count > 0 ? sumX / count : this.squadCenterX;
    const focusY = count > 0 ? sumY / count : this.squadCenterY;

    // 镜头前瞻：沿小队当前推进方向偏移，使小队/载具位于视口中下部，前方走廊与房间门洞尽收眼底
    const lookX = Math.cos(this.squadMoveAngle) * 75;
    const lookY = Math.sin(this.squadMoveAngle) * 165 - 85;
    const targetCamX = clamp(focusX + lookX - ARENA_W * 0.5, 0, WORLD_W - ARENA_W);
    const targetCamY = clamp(focusY + lookY - ARENA_H * 0.5, 0, WORLD_H - ARENA_H);

    if (snap) {
      this.camX = targetCamX;
      this.camY = targetCamY;
    } else {
      this.camX += (targetCamX - this.camX) * 0.09;
      this.camY += (targetCamY - this.camY) * 0.09;
    }

    // 更新全局小地图已探索区域（小队/载具周围及手电光锥覆盖过的区域点亮为已探索）
    for (let i = 0; i < this.greens.length; i++) {
      const g = this.greens[i];
      const gx0 = clamp(Math.floor((g.x - 240) / NAV_CELL), 0, NAV_COLS - 1);
      const gx1 = clamp(Math.floor((g.x + 240) / NAV_CELL), 0, NAV_COLS - 1);
      const gy0 = clamp(Math.floor((g.y - 240) / NAV_CELL), 0, NAV_ROWS - 1);
      const gy1 = clamp(Math.floor((g.y + 240) / NAV_CELL), 0, NAV_ROWS - 1);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (Math.hypot((gx + 0.5) * NAV_CELL - g.x, (gy + 0.5) * NAV_CELL - g.y) <= 240) {
            this.exploredGrid[gy * NAV_COLS + gx] = 1;
          }
        }
      }
    }
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.phase === "gone") continue;
      const gx0 = clamp(Math.floor((v.x - 250) / NAV_CELL), 0, NAV_COLS - 1);
      const gx1 = clamp(Math.floor((v.x + 250) / NAV_CELL), 0, NAV_COLS - 1);
      const gy0 = clamp(Math.floor((v.y - 250) / NAV_CELL), 0, NAV_ROWS - 1);
      const gy1 = clamp(Math.floor((v.y + 250) / NAV_CELL), 0, NAV_ROWS - 1);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (Math.hypot((gx + 0.5) * NAV_CELL - v.x, (gy + 0.5) * NAV_CELL - v.y) <= 250) {
            this.exploredGrid[gy * NAV_COLS + gx] = 1;
          }
        }
      }
    }
  }

  private prepopulateInitialSwarm(count: number): void {
    // 0. 经典开场双梯队迎面阻截尸潮（分布在 y = 2290..2790，让载具在 t = 0.0~3.2s 全程边推进边重火力扫射/火箭轰炸/撞角碾压，清完这一波才停下开门下车！）
    if (this.mode === "maze-infect") {
      const lanes = [565, 955, 1235];
      for (const lx of lanes) {
        for (let k = 0; k < 14; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            lx + (this.rng() - 0.5) * 62,
            2310 + (k / 14) * 470 + (this.rng() - 0.5) * 18,
          );
          z.hp = 155;
          z.maxHp = 155;
          z.ghostHp = 155;
        }
      }
    } else {
      for (let k = 0; k < 42; k++) {
        const y = 2290 + (k / 42) * 490 + (this.rng() - 0.5) * 20;
        const b = getCorridorBounds(y, this.mode);
        const x = b.cx + (this.rng() - 0.5) * Math.min(240, b.halfW * 1.15);
        const z = this.spawnRedDot(k % 3 === 0 ? "runner" : "walker", x, y);
        z.hp = 155;
        z.maxHp = 155;
        z.ghostHp = 155;
        if (this.mode === "sonar") {
          z.dormant = false;
        }
      }
    }

    // 1. 沿大地图纵深分布多梯队走廊尸群（maze-infect 模式下主力尸群驻守中北段 y=340..1460，下层三监区由独立伏击点镇守）
    const maxYSpan = this.mode === "maze-infect" ? 1120 : 1850;
    for (let i = 0; i < count; i++) {
      const y = 340 + (i / count) * maxYSpan + (this.rng() - 0.5) * 70;
      const b = getCorridorBounds(y, this.mode);
      const halfW = Math.max(40, b.halfW - 28);
      const x = b.cx + (this.rng() * 2 - 1) * halfW * 0.82;
      const dot = this.spawnRedDot(i % 4 === 0 ? "runner" : "walker", x, y);
      if (this.mode === "sonar" && i > 16) {
        dot.dormant = true;
      }
    }

    // 各大死角模式专属房间/反应堆/S弯盲区/三监区伏击尸群：
    if (this.mode === "scavenge") {
      // 西翼1号军火密室、东翼2号基因密室、西翼3号重装密室内部埋伏护箱尸群
      const pockets = [
        { x: 460, y: 2310, n: 11 },
        { x: 1340, y: 1590, n: 12 },
        { x: 460, y: 920, n: 12 },
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 95,
            p.y + (this.rng() - 0.5) * 90,
          );
        }
      }
    } else if (this.mode === "blackout") {
      // 1号南反应堆与2号北反应堆左右双环盲区埋伏尸群
      const pockets = [
        { x: 460, y: 2130, n: 11 },
        { x: 1340, y: 2130, n: 11 },
        { x: 460, y: 1050, n: 11 },
        { x: 1340, y: 1050, n: 11 },
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 90,
            p.y + (this.rng() - 0.5) * 90,
          );
        }
      }
    } else if (this.mode === "sonar") {
      // 超大跨度 S 弯天然岩壁死角后方潜伏红眼沉睡丧尸 (dormant = true)
      const pockets = [
        { x: 420, y: 2260, n: 12 },
        { x: 680, y: 1920, n: 10 },
        { x: 1360, y: 1580, n: 12 },
        { x: 1120, y: 1240, n: 10 },
        { x: 420, y: 900, n: 12 },
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 80,
            p.y + (this.rng() - 0.5) * 75,
          );
          z.dormant = true;
        }
      }
    } else if (this.mode === "maze-infect") {
      // A/B/C 三条平行封闭监区走廊内埋伏尸群 + 左/右监区拐角预置已被感染突变的「变异枪兵」迎面扑来！
      const e1 = this.spawnRedDot("infected_elite", 560, 2240);
      e1.hp = 68;
      e1.maxHp = 68;
      e1.ghostHp = 68;
      const e2 = this.spawnRedDot("infected_elite", 1240, 2240);
      e2.hp = 68;
      e2.maxHp = 68;
      e2.ghostHp = 68;
      this.infectedCount += 2;
      const pockets = [
        { x: 560, y: 2180, n: 4 },
        { x: 930, y: 2180, n: 5 },
        { x: 1240, y: 2180, n: 4 },
        { x: 520, y: 1460, n: 8 },
        { x: 1280, y: 1460, n: 8 },
        { x: 520, y: 1020, n: 9 },
        { x: 1280, y: 1020, n: 9 },
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 65,
            p.y + (this.rng() - 0.5) * 60,
          );
        }
      }
    }
  }

  private spawnRedDot(
    kind: RedKind,
    x: number,
    y: number,
    bossSpec?: { name: string; hp: number; r: number; speed: number; xOffset?: number; isFinalBoss?: boolean },
  ): RedDot {
    const isBoss = kind === "boss";
    const isCarrier = kind === "carrier";
    const isInfected = kind === "infected_elite";
    const isRunner = kind === "runner";

    const r = isBoss
      ? (bossSpec?.r ?? 29)
      : isCarrier
        ? 14.5
        : isInfected
          ? 12.5
          : isRunner
            ? 5.6
            : 6.2;

    const maxHp = isBoss
      ? (bossSpec?.hp ?? 1500)
      : isCarrier
        ? 220
        : isInfected
          ? 260
          : isRunner
            ? 25
            : 35;

    const speed = isBoss
      ? (bossSpec?.speed ?? 1.45)
      : isCarrier
        ? 1.38
        : isInfected
          ? 1.68
          : isRunner
            ? 1.82 + this.rng() * 0.28
            : 1.46 + this.rng() * 0.22;

    const clean = this.sanitizeSpawnPoint(x, y, r);

    const dot: RedDot = {
      id: this.nextRedId++,
      kind,
      name: isBoss ? bossSpec?.name : isCarrier ? "同化母体" : isInfected ? "变异枪兵" : undefined,
      isFinalBoss: bossSpec?.isFinalBoss,
      laneOffset: isBoss ? (bossSpec?.xOffset ?? 0) : (this.rng() * 2 - 1) * 220,
      x: clean.x,
      y: clean.y,
      vx: 0,
      vy: speed * 0.65,
      r,
      hp: maxHp,
      maxHp,
      ghostHp: maxHp,
      speed,
      hitFlash: 0,
      prevX: clean.x,
      prevY: clean.y,
    };
    this.reds.push(dot);
    this.totalSpawned++;
    return dot;
  }

  private resolveSegmentCollision(dot: { x: number; y: number; r: number }, x1: number, y1: number, x2: number, y2: number): void {
    const vx = x2 - x1;
    const vy = y2 - y1;
    const len2 = vx * vx + vy * vy || 1;
    const t = clamp(((dot.x - x1) * vx + (dot.y - y1) * vy) / len2, 0, 1);
    const cx = x1 + vx * t;
    const cy = y1 + vy * t;
    const dx = dot.x - cx;
    const dy = dot.y - cy;
    const d2 = dx * dx + dy * dy;
    const minR = dot.r + 6;
    if (d2 < minR * minR && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = minR - d;
      dot.x += (dx / d) * push;
      dot.y += (dy / d) * push;
    }
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

  /**
   * 精确 2D 射线与线段交点距离检测（同时服务于手电筒/探照灯 2D 光锥阴影截断与子弹物理阻挡）
   */
  raySegmentDist(
    ox: number,
    oy: number,
    ux: number,
    uy: number,
    maxDist: number,
    seg: WallSegment,
  ): number {
    const sx = seg.x2 - seg.x1;
    const sy = seg.y2 - seg.y1;
    const denom = ux * sy - uy * sx;
    if (Math.abs(denom) < 1e-6) return maxDist;
    const dx = seg.x1 - ox;
    const dy = seg.y1 - oy;
    const t = (dx * sy - dy * sx) / denom;
    if (t <= 0.5 || t >= maxDist) return maxDist;
    const u = (dx * uy - dy * ux) / denom;
    if (u < 0 || u > 1) return maxDist;
    return t;
  }

  /**
   * 计算从 (ox,oy) 沿单位向量 (ux,uy) 出发的射线碰到第一堵外墙或死角隔墙的精确截断距离
   */
  castRayToWalls(ox: number, oy: number, ux: number, uy: number, maxDist: number): number {
    let best = maxDist;
    for (let i = 0; i < this.deadCornerWalls.length; i++) {
      const d = this.raySegmentDist(ox, oy, ux, uy, best, this.deadCornerWalls[i]);
      if (d < best) best = d;
    }
    for (let i = 0; i < this.outerWalls.length; i++) {
      const d = this.raySegmentDist(ox, oy, ux, uy, best, this.outerWalls[i]);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * 判断两点之间是否无死角隔墙与外墙阻挡（用于手电光锥照射判定与死角盲区遮挡）
   */
  hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return true;
    const ux = dx / dist;
    const uy = dy / dist;
    for (let i = 0; i < this.deadCornerWalls.length; i++) {
      const hitD = this.raySegmentDist(x1, y1, ux, uy, dist - 2, this.deadCornerWalls[i]);
      if (hitD < dist - 2) return false;
    }
    for (let i = 0; i < this.outerWalls.length; i++) {
      const hitD = this.raySegmentDist(x1, y1, ux, uy, dist - 2, this.outerWalls[i]);
      if (hitD < dist - 2) return false;
    }
    return true;
  }

  /**
   * 重建当前帧所有 2D 手电筒光锥、载具大灯/探照灯与旋转工业探照灯
   */
  rebuildLightCones(tSec: number): void {
    this.lightCones.length = 0;
    if (!this.isDarkMode) return;

    const flashHalfFov = this.blackoutActive ? 0.36 : 0.46;

    for (let i = 0; i < this.greens.length; i++) {
      const g = this.greens[i];
      const baseRange =
        g.role === "shotgun"
          ? 265
          : g.role === "sniper"
            ? 400
            : g.role === "turret"
              ? 375
              : 335;
      this.lightCones.push({
        x: g.x,
        y: g.y,
        angle: g.aimAngle,
        halfFov: g.role === "turret" ? 0.54 : flashHalfFov,
        range: this.blackoutActive ? 175 : baseRange,
        intensity: this.blackoutActive ? 0.75 : 1.08,
        kind: "flashlight",
      });
    }

    // 战术入场载具（军用大巴双远光大灯 / 黑鹰直升机机鼻探照灯）光锥
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.headlightsOn || v.phase === "gone") continue;
      if (v.kind === "bus") {
        for (const side of [-16, 16]) {
          this.lightCones.push({
            x: v.x + side,
            y: v.y - 44,
            angle: -Math.PI * 0.5 + side * 0.003,
            halfFov: 0.24,
            range: 365,
            intensity: 1.15,
            kind: "spotlight",
          });
        }
      } else {
        this.lightCones.push({
          x: v.x,
          y: v.y - 18,
          angle: v.angle + Math.sin(tSec * 3.8) * 0.22,
          halfFov: 0.44,
          range: 410,
          intensity: 1.18,
          kind: "spotlight",
        });
      }
    }

    // blackout 断电探照灯模式：在 1号南反应堆大厅与 2号北反应堆大厅左右各矗立共 4 座双头旋转工业探照灯塔！
    // 四座灯塔在反应堆过载断电惊魂窗口 (t=11.2~14.8s) 同时熄灭！
    if (this.mode === "blackout" && !this.blackoutActive) {
      const towers = [
        { x: 520, y: 2130, dir: 1 },
        { x: 1280, y: 2130, dir: -1 },
        { x: 520, y: 1050, dir: -1 },
        { x: 1280, y: 1050, dir: 1 },
      ];
      for (const tw of towers) {
        const baseAng = tSec * 1.45 * tw.dir;
        for (const offset of [0, Math.PI]) {
          this.lightCones.push({
            x: tw.x,
            y: tw.y,
            angle: baseAng + offset,
            halfFov: 0.42,
            range: 520,
            intensity: 1.18,
            kind: "spotlight",
          });
        }
      }
    }
  }

  /**
   * 死角光暗模式核心铁律：判断目标点 (tx,ty) 是否被手电筒或探照灯照亮（且未被死角墙挡住）！
   * 只有被照亮的丧尸才能被枪兵瞄准射击！
   */
  isPointLit(tx: number, ty: number, shooter: GreenUnit): boolean {
    if (!this.isDarkMode) return true;
    // 近战夜视自卫光圈（只要没隔着死角墙就能在贴身 220px 内开火自卫）
    const selfDist = Math.hypot(tx - shooter.x, ty - shooter.y);
    if (selfDist <= 220 && this.hasLineOfSight(shooter.x, shooter.y, tx, ty)) {
      return true;
    }

    for (let i = 0; i < this.lightCones.length; i++) {
      const c = this.lightCones[i];
      const dx = tx - c.x;
      const dy = ty - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > c.range) continue;
      let diff = Math.atan2(dy, dx) - c.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= c.halfFov + 0.08) {
        if (this.hasLineOfSight(c.x, c.y, tx, ty)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 声呐潜行模式下：枪声噪音波纹扩散，惊醒半径内所有处于沉睡态的死角丧尸！
   */
  private awakenDormantByNoise(nx: number, ny: number, radius: number): void {
    let newlyWoken = 0;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if (r.dormant && Math.hypot(r.x - nx, r.y - ny) <= radius) {
        r.dormant = false;
        newlyWoken++;
      }
    }
    if (newlyWoken > 0 && !this.sonarAwakened) {
      this.sonarAwakened = true;
      this.alarmFlash = 0.85;
      this.emitAudio("breach", 0.85, 0.95);
    }
  }

  stepTick(): void {
    this.tick++;
    const tSec = this.tick / SIM_HZ;

    if (this.alarmFlash > 0) this.alarmFlash = Math.max(0, this.alarmFlash - 0.025);
    if (this.hive.hitFlash > 0) this.hive.hitFlash = Math.max(0, this.hive.hitFlash - 0.15);
    this.hive.pulsePhase = (this.hive.pulsePhase + 0.06) % (Math.PI * 2);
    if (this.hive.ghostHp > this.hive.hp) {
      this.hive.ghostHp = Math.max(
        this.hive.hp,
        this.hive.ghostHp - (this.hive.maxHp * 0.008 + (this.hive.ghostHp - this.hive.hp) * 0.12),
      );
    }

    for (const n of this.nodes) {
      if (n.hitFlash > 0) n.hitFlash = Math.max(0, n.hitFlash - 0.15);
      if (n.ghostHp > n.hp) {
        n.ghostHp = Math.max(n.hp, n.ghostHp - (n.maxHp * 0.015 + (n.ghostHp - n.hp) * 0.15));
      }
    }

    if (this.callout) {
      this.callout.ttl--;
      if (this.callout.ttl <= 0) this.callout = null;
    }

    // 0.5. 清空本帧弹道并更新战术入场载具（t = 0.0~3.2s 推进清场第一波尸潮 -> t = 3.2~4.2s 急刹开门/悬停索降下车）
    this.firingLines.length = 0;
    this.updateVehicles(tSec);

    // 1. 战场导演：母巢与前方走廊涌怪、4大泰坦登场、减员危机与反推/覆灭阶段切换
    this.updateDirector(tSec);

    // 2. 重建空间哈希网格与每 6 帧更新一次全图科学 BFS 寻路流场
    this.rebuildSpatialGrid();
    if (this.tick % 6 === 1) {
      this.updateNavFlowField();
    }

    // 3. 更新尸潮与泰坦推进（沿 BFS 流场科学绕过墙壁与门洞）+ 触碰我方脆皮士兵时的「一碰即碎 / 感染变丧尸」判定
    this.updateRedSwarm(tSec);

    // 4. 更新我方军团 CQB 折角航点推进 + 360度多扇区手电警戒 + 有限射程笔直交叉火网前排严格阻挡射击
    this.updateGreenArmy(tSec);
    if (this.greens.length === 0) {
      this.rebuildLightCones(tSec);
    }

    // 4.5. 更新 2D 平滑镜头跟随与全局小地图已探索网格
    this.updateCamera(false);

    // 5. 更新粒子、光环与飘字
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
    for (let i = this.banners.length - 1; i >= 0; i--) {
      const b = this.banners[i];
      b.y += b.vy;
      b.ttl--;
      if (b.ttl <= 0) this.banners.splice(i, 1);
    }

    // 6. 胜负收尾：
    // (A) 人类惨胜：当北部【丧尸母巢核心】被彻底轰爆且残余丧尸肃清后，定格 1.3s 惨胜画面
    if (!this.hive.alive && this.reds.length === 0) {
      if (this.phase !== "victory") {
        this.phase = "victory";
        this.firingLines = [];
      }
      this.victoryHoldTicks++;
      if (this.victoryHoldTicks >= Math.round(1.3 * SIM_HZ)) {
        this.isFinished = true;
      }
    }
    // (B) 尸潮大胜（全军覆没全员同化）：当最后一名人类士兵被咬感染为「变异枪兵」后，定格 1.6s 尸潮狂欢画面
    if (this.hive.alive && this.greens.length === 0 && tSec >= 6.5) {
      if (this.phase !== "defeat") {
        this.phase = "defeat";
        this.firingLines = [];
        this.alarmFlash = 1.0;
        this.emitAudio("breach", 1.0, 0.72);
      }
      this.defeatHoldTicks++;
      if (this.defeatHoldTicks >= Math.round(1.6 * SIM_HZ)) {
        this.isFinished = true;
      }
    }
    if (tSec >= this.maxDurationSec) {
      this.isFinished = true;
    }
  }

  /**
   * 判断本局是否为「尸潮大胜 · 人类全军覆没」剧本（blackout 与 maze-infect 两大高危死角模式）
   */
  isOverrunMode(): boolean {
    return this.mode === "blackout" || this.mode === "maze-infect";
  }

  private updateDirector(tSec: number): void {
    if (!this.hive.alive || this.phase === "defeat") return;

    // 1. 按时间轴在前方战区走廊召唤 4 大守护泰坦 Boss
    for (let idx = 0; idx < this.map.bossWaves.length; idx++) {
      if (this.spawnedBossIndices.has(idx)) continue;
      const bw = this.map.bossWaves[idx];
      if (tSec >= bw.spawnSec) {
        this.spawnedBossIndices.add(idx);
        this.bossesSpawned++;
        const spawnY = bw.isFinalBoss
          ? bw.ySpawn
          : clamp(Math.min(bw.ySpawn, this.squadCenterY - 420), 360, WORLD_H - 400);
        const bAtSpawn = getCorridorBounds(spawnY, this.mode);
        const bx = bAtSpawn.cx + bw.xOffset;
        this.spawnRedDot("boss", bx, spawnY, {
          name: bw.name,
          hp: bw.hp,
          r: bw.r,
          speed: bw.speed,
          xOffset: bw.xOffset,
          isFinalBoss: bw.isFinalBoss,
        });
        this.emitAudio("boss-spawn", 0.9, bw.isFinalBoss ? 0.78 : 0.92);

        if (idx === 0) {
          this.setCallout("警报：「重甲泰坦」率尸潮从前方拐角门洞压上 · 前排肉盾挡死枪线！", "normal", 3.0);
        } else if (idx === 1) {
          this.setCallout("危急：「狂暴泰坦」突破中段走廊 · 死角尸潮合围小队！", "crisis", 3.2);
        } else if (idx === 2) {
          this.setCallout("高危：「暗黑泰坦」驻守北翼窄口 · 双泰坦正面阻截！", "crisis", 3.0);
        } else if (bw.isFinalBoss) {
          this.setCallout("终极警报：3400血「终极尸王」死守母巢核心室 · 生死决战降临！", "overdrive", 3.5);
        }
      }
    }

    // 2. 母巢核心与前方未清理战区持续涌出尸潮
    const overrun = this.isOverrunMode();
    const maxActiveReds =
      tSec < 12.0
        ? 165
        : tSec < 24.5
          ? 180
          : overrun
            ? 210
            : tSec < 31.8
              ? 110
              : 0;
    const spawnModulo = tSec < 31.8 || overrun ? 2 : 10;
    if (this.reds.length < maxActiveReds && this.tick % spawnModulo === 0) {
      const spawnsPerStep = tSec < 24.5 ? 3 : overrun ? 4 : tSec < 31.8 ? 2 : 0;
      for (let s = 0; s < spawnsPerStep; s++) {
        if (tSec < 3.05 && this.vehicles.length > 0) {
          const v = this.vehicles[s % this.vehicles.length];
          const rawY = clamp(v.y - 220 - this.rng() * 95, 2320, 2650);
          const b = getCorridorBounds(rawY, this.mode);
          const spawnX =
            this.mode === "maze-infect"
              ? v.x + (this.rng() - 0.5) * 68
              : b.cx + (this.rng() * 2 - 1) * Math.min(220, b.halfW - 45);
          this.spawnRedDot(s % 2 === 0 ? "runner" : "walker", spawnX, rawY);
          continue;
        }
        const fromFrontSector = s % 2 === 0 && this.squadCenterY > 820;
        const rawY = fromFrontSector
          ? Math.max(300, this.squadCenterY - 380 - this.rng() * 190)
          : this.hive.y + this.hive.r + 20 + this.rng() * 80;
        const b = getCorridorBounds(rawY, this.mode);
        const spawnX = b.cx + (this.rng() * 2 - 1) * Math.max(40, b.halfW - 45);
        const isRunner = tSec > 2.5 && this.rng() < (overrun && tSec > 24.0 ? 0.68 : 0.42);
        this.spawnRedDot(isRunner ? "runner" : "walker", spawnX, rawY);
      }
    }

    // 2b. 死角模式专属导演事件：
    // (a) blackout 断电探照灯模式：在 t=13.2s ~ 16.8s 触发「反应堆过载全图断电 3.6 秒」惊魂！
    if (this.mode === "blackout") {
      if (!this.blackoutTriggered && tSec >= 13.2) {
        this.blackoutTriggered = true;
        this.blackoutActive = true;
        this.alarmFlash = 1.0;
        this.emitAudio("breach", 0.92, 0.78);
        this.triggerFrontlineFrenzyAmbush(3, 980);
      }
      if (this.blackoutTriggered && !this.blackoutRecovered && tSec >= 16.8) {
        this.blackoutRecovered = true;
        this.blackoutActive = false;
        this.emitAudio("adrenaline", 0.9, 1.08);
      }
    }

    // (b) sonar 声呐潜行模式：周期性发射青色超声波扫描环探测 S 弯岩壁后方的沉睡尸群
    if (this.mode === "sonar" && this.tick % 95 === 12) {
      this.rings.push({
        x: this.squadCenterX,
        y: this.squadCenterY - 30,
        maxR: 540,
        ttl: 38,
        maxTtl: 38,
        kind: "sonar",
      });
    }

    // (c) maze-infect 三通道生化监狱模式：在 t=8.5s 三支小队冲出 A/B/C 三道监区竖墙，在中庭检疫广场完成汇合！
    if (this.mode === "maze-infect" && !this.mazeLinkedUp && tSec >= 8.5) {
      this.mazeLinkedUp = true;
      this.emitAudio("adrenaline", 0.88, 1.04);
    }

    // (d) 节点保底CQB破拆机制：当小队抵近对应房间门洞且超过破门窗口时，CQB破拆炸药自动引爆该房间战术节点
    for (let ni = 0; ni < this.nodes.length; ni++) {
      const node = this.nodes[ni];
      if (node.broken) continue;
      const unlockSec = ni === 0 ? 9.4 : ni === 1 ? 16.8 : 24.0;
      if (tSec >= unlockSec + 3.0) {
        this.triggerNodeShatter(node);
      }
    }

    // 3. 在 infect 或 combo 或 maze-infect 模式下，定期派出绿光闪烁的【同化母体】
    if (
      (this.mode === "infect" || this.mode === "combo" || this.mode === "maze-infect") &&
      tSec >= 9.5 &&
      tSec <= 25.0 &&
      this.tick % (this.mode === "infect" ? 210 : 320) === 0
    ) {
      const spawnY = Math.max(340, this.squadCenterY - 310);
      const b = getCorridorBounds(spawnY, this.mode);
      const cx = b.cx + (this.rng() * 2 - 1) * 95;
      this.spawnRedDot("carrier", cx, spawnY);
    }

    // 4. 第一幕真实减员危机 (t = 6.8s，maze-infect 模式在三监区小队汇合后 t = 9.4s 触发)
    const earlyAmbushSec = this.mode === "maze-infect" ? 9.4 : 6.8;
    if (!this.earlySacrificeTriggered && tSec >= earlyAmbushSec && this.greens.length >= 5) {
      this.earlySacrificeTriggered = true;
      this.triggerFrontlineFrenzyAmbush(overrun ? 2 : 1, overrun ? 680 : 480);
    }

    // 5. 第二幕中段减员悬念 (t = 16.2s)
    if (!this.midSacrificeTriggered && tSec >= 16.2 && this.greens.length >= 8) {
      this.midSacrificeTriggered = true;
      this.triggerFrontlineFrenzyAmbush(overrun ? 2 : 1, overrun ? 780 : 540);
    }

    // 5b. 第三幕推进途中减员悬念 (t = 23.2s)
    if (!this.lateSacrificeTriggered && tSec >= 23.2 && this.greens.length >= 10) {
      this.lateSacrificeTriggered = true;
      this.triggerFrontlineFrenzyAmbush(overrun ? 2 : 1, overrun ? 880 : 580);
    }

    // 6. 当时间 >= 22.8s，吹响总攻号角向北部母巢大厅强行突进！
    if (!this.counterPushActive && tSec >= 22.8 && this.greens.length >= 8) {
      this.counterPushActive = true;
      this.phase = "counterpush";
      this.emitAudio("adrenaline", 0.95, 1.0);
    }

    // 7. 终局高潮分流（50% 惨胜破巢 vs 50% 尸潮反扑全军覆没）：
    if (overrun) {
      // 【尸潮大胜剧本 (blackout / maze-infect)】：t >= 26.5s 母巢掀起狂暴反扑浪潮，前排丧尸与变异枪兵持续冲锋同化人类，直至全员覆没！
      if (!this.finalWaveTriggered && tSec >= 26.5) {
        this.finalWaveTriggered = true;
        this.alarmFlash = 1.0;
        this.emitAudio("breach", 0.96, 0.82);
      }
      if (tSec >= 26.5 && this.greens.length > 0 && this.tick - this.lastAttritionTick >= 14) {
        this.lastAttritionTick = this.tick;
        this.triggerFrontlineFrenzyAmbush(5, 2250);
      }
    } else {
      // 【人类惨胜剧本 (scavenge / sonar)】：t = 26.8s ~ 34.0s 母巢卫队拼死反扑，将大军一路咬杀削减至最后 4~6 名残血英雄！
      if (!this.finalWaveTriggered && tSec >= 26.8) {
        this.finalWaveTriggered = true;
        this.alarmFlash = 0.85;
      }
      const targetSurvivors = this.mode === "scavenge" ? 5 : 6;
      if (
        tSec >= 26.0 &&
        tSec <= 34.2 &&
        this.greens.length > targetSurvivors &&
        this.tick - this.lastAttritionTick >= 11
      ) {
        this.lastAttritionTick = this.tick;
        // 若母巢前方 360px 内缺乏冲锋怪，从母巢孵化口补出 2 只高速狂奔尸并激活狂暴冲锋
        let closeCount = 0;
        for (const r of this.reds) {
          if (r.kind !== "boss" && Math.hypot(r.x - this.squadCenterX, r.y - this.squadCenterY) <= 380) {
            closeCount++;
          }
        }
        if (closeCount < 5) {
          for (const side of [-65, 0, 65]) {
            this.spawnRedDot("runner", this.squadCenterX + side, Math.max(290, this.squadCenterY - 265));
          }
        }
        this.triggerFrontlineFrenzyAmbush(3, 2850);
      } else if (this.greens.length <= targetSurvivors) {
        // 当仅剩最后 4~6 名孤胆老兵时，立即解除残余小怪的狂暴冲刺并压低残血，确保最后几名幸存英雄浴血死战引爆母巢惨胜！
        for (const r of this.reds) {
          if (r.kind !== "boss") {
            r.frenzyTimer = 0;
            r.speed = Math.min(r.speed, 1.45);
            r.hp = Math.min(r.hp, 45);
          }
        }
      }
    }
  }

  /**
   * 激活前排距小队最近(25~460px)且优先具备直视视线 (hasLineOfSight) 的普通丧尸进入「狂暴飞扑」状态（严禁在士兵脸上凭空刷怪！100% 依靠真实物理冲锋完成近身扑咬与感染！）
   */
  private triggerFrontlineFrenzyAmbush(count: number, frenzyHp = 920): void {
    const candidates: Array<{ idx: number; dist: number; hasLos: boolean }> = [];
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if (r.kind === "boss" || r.frenzyTimer) continue;
      let minD = Infinity;
      let hasLos = false;
      for (let gi = 0; gi < this.greens.length; gi++) {
        const g = this.greens[gi];
        const d = Math.hypot(g.x - r.x, g.y - r.y);
        if (d < minD) minD = d;
        if (d < 460 && this.hasLineOfSight(g.x, g.y, r.x, r.y)) {
          hasLos = true;
        }
      }
      if (minD >= 25 && minD <= 460) {
        candidates.push({ idx: i, dist: minD, hasLos });
      }
    }
    candidates.sort((a, b) => {
      if (a.hasLos !== b.hasLos) return a.hasLos ? -1 : 1;
      return a.dist - b.dist;
    });
    for (let k = 0; k < Math.min(count, candidates.length); k++) {
      const z = this.reds[candidates[k].idx];
      z.dormant = false;
      z.kind = "runner";
      z.frenzyTimer = 185;
      z.hp = Math.max(z.hp, frenzyHp);
      z.maxHp = Math.max(z.maxHp, frenzyHp);
      z.ghostHp = z.hp;
      z.speed = 3.85;
    }
  }

  private updateRedSwarm(tSec: number): void {
    for (let i = this.reds.length - 1; i >= 0; i--) {
      const d = this.reds[i];
      d.prevX = d.x;
      d.prevY = d.y;
      if (d.spawnGraceTicks && d.spawnGraceTicks > 0) d.spawnGraceTicks--;
      if (d.frenzyTimer && d.frenzyTimer > 0) d.frenzyTimer--;
      if (d.hitFlash > 0) d.hitFlash = Math.max(0, d.hitFlash - 0.18);
      if (d.ghostHp > d.hp) {
        d.ghostHp = Math.max(d.hp, d.ghostHp - (d.maxHp * 0.012 + (d.ghostHp - d.hp) * 0.14));
      }

      let nearestGreenIdx = -1;
      let nearestGreenDist = Infinity;
      for (let gi = 0; gi < this.greens.length; gi++) {
        const g = this.greens[gi];
        const gd = Math.hypot(g.x - d.x, g.y - d.y);
        if (gd < nearestGreenDist) {
          nearestGreenDist = gd;
          nearestGreenIdx = gi;
        }
      }

      // 声呐潜行模式下：处于沉睡态 (dormant) 的死角丧尸在小队逼近至 320px 内或纵向进入前线扇区时必定惊醒迎敌（绝不沦为被越过的木桩！）
      if (d.dormant) {
        if (nearestGreenDist < 320 || d.y > this.squadCenterY - 340) {
          d.dormant = false;
        } else {
          d.vx *= 0.2;
          d.vy *= 0.2;
          continue;
        }
      }

      const isFrenzy = (d.frenzyTimer ?? 0) > 0;
      let desiredSpd = isFrenzy ? 3.85 : d.speed;
      if (d.hitFlash > 0.2 && !isFrenzy) {
        desiredSpd *= d.kind === "boss" ? 0.35 : 0.18;
      }
      if (!isFrenzy && (tSec < 9.5 || this.blackoutActive)) {
        desiredSpd *= this.blackoutActive ? 1.28 : 1.15;
      }

      // 科学寻路核心：
      // 1) 若与最近士兵之间无墙体阻挡 (hasLineOfSight) 且距离 < 380px，直接直线扑向该士兵；
      // 2) 若隔着房间墙、反应堆屏蔽岛、S弯岩壁或监区纵墙，则严格顺着 2D BFS 寻路流场梯度 (sampleNavFlow) 绕过墙角穿过门洞！
      let dirX = 0;
      let dirY = 1;
      const ng = nearestGreenIdx >= 0 ? this.greens[nearestGreenIdx] : null;
      if (ng && nearestGreenDist < 380 && this.hasLineOfSight(d.x, d.y, ng.x, ng.y)) {
        const dx = ng.x - d.x;
        const dy = ng.y - d.y;
        const dist = Math.hypot(dx, dy) || 1;
        dirX = dx / dist;
        dirY = dy / dist;
      } else {
        const flow = this.sampleNavFlow(d.x, d.y);
        if (flow.valid) {
          dirX = flow.fx;
          dirY = flow.fy;
        } else if (ng) {
          const dx = ng.x - d.x;
          const dy = ng.y - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirX = dx / dist;
          dirY = dy / dist;
        } else {
          dirX = Math.cos(d.id * 1.3 + tSec * 2.4) * 0.55;
          dirY = 0.72;
        }
      }

      const steerX = dirX * desiredSpd;
      const steerY = dirY * desiredSpd;

      // 空间网格刚性防重叠分离 (PBD)
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
            const minDist = d.r + o.r + 2.2;
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
                  ? 0.08
                  : o.kind === "boss" && d.kind !== "boss"
                    ? 2.2
                    : 1.15;
              pushX += nxDir * f * weight * 1.2;
              pushY += nyDir * f * weight * 1.2;
              if (d.kind !== "boss" && !isFrenzy) {
                posPushX += nxDir * overlap * 0.22;
                posPushY += nyDir * overlap * 0.22;
              }
            }
            if (++neighborsChecked > 24) break;
          }
          if (neighborsChecked > 24) break;
        }
        if (neighborsChecked > 24) break;
      }

      d.vx = d.vx * 0.45 + (steerX + pushX) * 0.55;
      d.vy = d.vy * 0.45 + (steerY + pushY) * 0.55;
      let stepX = d.vx + clamp(posPushX, -1.6, 1.6);
      let stepY = d.vy + clamp(posPushY, -1.6, 1.6);
      const maxRedStep = isFrenzy ? 3.75 : d.kind === "boss" ? 2.4 : 3.25;
      const stepMag = Math.hypot(stepX, stepY);
      if (stepMag > maxRedStep) {
        stepX = (stepX / stepMag) * maxRedStep;
        stepY = (stepY / stepMag) * maxRedStep;
      }
      d.x += stepX;
      d.y += stepY;

      // 外墙折线段与死角内部隔墙刚性碰撞滑动
      for (const seg of this.outerWalls) {
        this.resolveSegmentCollision(d, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      for (const seg of this.deadCornerWalls) {
        this.resolveSegmentCollision(d, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      d.y = clamp(d.y, d.r + 24, WORLD_H - 28 - d.r);

      // 物理铁律保底：单帧合成位移绝不可超过 4.2px/tick（杜绝任何墙角挤压弹射或瞬移）
      const finalRedDX = d.x - d.prevX;
      const finalRedDY = d.y - d.prevY;
      const finalRedDist = Math.hypot(finalRedDX, finalRedDY);
      if (finalRedDist > 4.2) {
        d.x = d.prevX + (finalRedDX / finalRedDist) * 4.2;
        d.y = d.prevY + (finalRedDY / finalRedDist) * 4.2;
      }
    }

    // 5. 严格物理接触判定：任何丧尸只要碰到人类士兵，100% 无条件触发接触感染（绝无免死金牌或擦肩穿过）！
    this.checkAndResolveContactInfections();
  }

  /**
   * 100% 无条件接触感染与刚体阻挡判定（在红方移动后与绿方移动后双重执行，确保零擦肩、零免死接触！）
   */
  private checkAndResolveContactInfections(): void {
    for (let ri = this.reds.length - 1; ri >= 0; ri--) {
      const d = this.reds[ri];
      if (!d) continue;

      for (let gi = this.greens.length - 1; gi >= 0; gi--) {
        const g = this.greens[gi];
        if (!g) continue;
        const dx = d.x - g.x;
        const dy = d.y - g.y;
        const dist = Math.hypot(dx, dy);
        const touchDist = d.r + g.r + 1.0;

        if (dist <= touchDist) {
          if ((d.spawnGraceTicks ?? 0) > 0) {
            const nx = dist > 0.1 ? dx / dist : 0;
            const ny = dist > 0.1 ? dy / dist : -1;
            const push = touchDist - dist + 1.2;
            d.x += nx * push;
            d.y += ny * push;
            continue;
          }
          d.dormant = false;
          if (g.role === "turret") {
            // 重机枪碉堡具备装甲，受击扣血（尸潮反扑终局阶段一击必破）
            g.hp -= this.isOverrunMode() && this.tick / SIM_HZ >= 26.0 ? 3 : 1;
            const nx = dist > 0.1 ? dx / dist : 0;
            const ny = dist > 0.1 ? dy / dist : -1;
            d.vx = nx * 2.2;
            d.vy = Math.min(-1.5, ny * 2.2);
            d.spawnGraceTicks = 14;
            if (g.hp <= 0) {
              this.greens.splice(gi, 1);
              this.casualties++;
              this.rings.push({ x: g.x, y: g.y, maxR: 58, ttl: 18, maxTtl: 18, kind: "casualty" });
            }
            break;
          } else {
            // 普通人类士兵只要被丧尸触碰，100% 无条件当场感染突变为「变异枪兵」！
            this.handleGreenCasualty(gi, ri);
            break;
          }
        }
      }
    }
  }

  /**
   * 人类士兵被杀 -> 原地感染突变为「变异枪兵」丧尸并反扑人类小队（全程遵循连续物理速度，绝无瞬移）！
   */
  private handleGreenCasualty(greenIdx: number, attackerIdx: number): void {
    const g = this.greens[greenIdx];
    if (!g) return;
    const attacker = this.reds[attackerIdx];

    this.casualties++;
    this.infectedCount++;
    this.alarmFlash = Math.min(1.0, this.alarmFlash + 0.65);
    this.emitAudio("breach", 0.78, 1.12);

    const gx = g.x;
    const gy = g.y;

    // 1. 从我方人类队列中移除该阵亡士兵（老兵各自保有独立 slotX/slotY，不会触发换位跳变）
    this.greens.splice(greenIdx, 1);

    // 2. 若扑咬者为普通/突击丧尸，它与受害士兵合体突变为「变异枪兵」（移除原小怪防止 1 只小怪连续重叠秒杀全队）
    if (attacker && attacker.kind !== "boss") {
      this.reds.splice(attackerIdx, 1);
    } else if (attacker && attacker.kind === "boss") {
      attacker.vy = -1.4;
      attacker.spawnGraceTicks = 24;
    }

    // 3. 对周围贴脸丧尸施加连续物理冲击波速度脉冲与短暂硬直（严禁直接修改坐标 r.y -= 32 导致瞬移！）
    for (const r of this.reds) {
      const dx = r.x - gx;
      const dy = r.y - gy;
      const dist = Math.hypot(dx, dy);
      if (dist < 88 && r.kind !== "boss") {
        const pushDirX = dist > 1 ? dx / dist : 0;
        const pushDirY = dist > 1 ? dy / dist : -1;
        r.vx = clamp(r.vx + pushDirX * 2.2, -3.2, 3.2);
        r.vy = clamp(Math.min(r.vy, -1.9) + pushDirY * 1.5, -3.2, 3.2);
        r.frenzyTimer = 0;
        r.spawnGraceTicks = Math.max(r.spawnGraceTicks ?? 0, 22);
      }
    }

    // 4. 阵亡的人类士兵在扑咬交界处突变为「变异枪兵」精英丧尸，掉头扑向昔日队友！
    const spawnX = attacker ? (gx + attacker.x) * 0.5 : gx;
    const spawnY = attacker ? Math.min(gy - 18, attacker.y - 4) : gy - 20;
    const mutated = this.spawnRedDot("infected_elite", spawnX, spawnY);
    const isLastStand = !this.isOverrunMode() && this.greens.length <= 6;
    mutated.hp = isLastStand ? 52 : 135;
    mutated.maxHp = mutated.hp;
    mutated.ghostHp = mutated.hp;
    mutated.vx = 0;
    mutated.vy = isLastStand ? -1.4 : mutated.speed * 0.55;
    mutated.spawnGraceTicks = isLastStand ? 42 : 28;
    if (isLastStand) {
      for (const r of this.reds) {
        if (r.kind !== "boss") {
          r.frenzyTimer = 0;
          r.speed = Math.min(r.speed, 1.35);
          r.hp = Math.min(r.hp, 48);
        }
      }
    }

    this.rings.push({
      x: gx,
      y: gy,
      maxR: 68,
      ttl: 20,
      maxTtl: 20,
      kind: "casualty",
    });
    this.pendingDecals.push({
      kind: "blood",
      x: gx,
      y: gy,
      r: 16,
      seed: this.tick + greenIdx,
    });
    this.spawnImpactParticles(gx, gy, 0, 1, "bio", 8);
    this.spawnImpactParticles(gx, gy, 0, -1, "blood", 6);

    this.addBanner(gx, gy - 14, "+1", [255, 75, 165, 255]);
  }

  /**
   * 计算单名士兵当前的有效战术阵位目标点：
   * - 若士兵与阵位点之间被侧室墙壁、反应堆屏蔽岛或折流墙阻隔，自动将目标点向小队中心收拢，实现过门洞/窄口时的科学队形收缩！
   */
  private getValidFormationGoal(g: GreenUnit): { x: number; y: number } {
    if (this.mode === "maze-infect" && this.squadCenterY > 2010 && g.y > 2020) {
      const targetY = clamp(this.squadCenterY + (g.id % 2 === 0 ? -10 : 10), 1920, 2660);
      let subX = 900;
      if (g.subSquad === 1) {
        // 左路 A 监区 (x=280..690)：绕过 y=2380 左挡墙(x=280..475)
        subX = 575;
      } else if (g.subSquad === 2) {
        // 右路 C 监区 (x=1110..1520)：绕过 y=2380 右挡墙(x=1325..1520)
        subX = 1225;
      } else {
        // 中路 B 监区 (x=690..1110)：绕过 y=2320 左挡墙(x=690..865)
        subX = 965;
      }
      return { x: subX + (g.id % 2 === 0 ? -15 : 15), y: targetY };
    }

    const baseGoalY = clamp(this.squadCenterY + g.slotY, 290, WORLD_H - 80);
    const b = getCorridorBounds(baseGoalY, this.mode);
    const baseGoalX = clamp(this.squadCenterX + g.slotX, b.left + 32, b.right - 32);

    // 若从 squadCenter 到该阵位点畅通无阻且不在障碍格内，直接使用该阵位
    const gx = clamp(Math.floor(baseGoalX / NAV_CELL), 0, NAV_COLS - 1);
    const gy = clamp(Math.floor(baseGoalY / NAV_CELL), 0, NAV_ROWS - 1);
    if (
      !this.navBlocked[gy * NAV_COLS + gx] &&
      this.hasLineOfSight(this.squadCenterX, this.squadCenterY, baseGoalX, baseGoalY)
    ) {
      return { x: baseGoalX, y: baseGoalY };
    }

    // 若阵位点落在隔墙另一侧或反应堆屏蔽岛内，沿连线向 squadCenter 收缩直至无墙体阻隔
    for (const scale of [0.6, 0.35, 0.15]) {
      const tx = this.squadCenterX + (baseGoalX - this.squadCenterX) * scale;
      const ty = this.squadCenterY + (baseGoalY - this.squadCenterY) * scale;
      const tgx = clamp(Math.floor(tx / NAV_CELL), 0, NAV_COLS - 1);
      const tgy = clamp(Math.floor(ty / NAV_CELL), 0, NAV_ROWS - 1);
      if (
        !this.navBlocked[tgy * NAV_COLS + tgx] &&
        this.hasLineOfSight(this.squadCenterX, this.squadCenterY, tx, ty)
      ) {
        return { x: tx, y: ty };
      }
    }
    return { x: this.squadCenterX, y: this.squadCenterY };
  }

  /**
   * 更新我方绿色军团科学 CQB 航点推进（沿折角走廊、门洞、反应堆绕道与S弯稳步向北推进）与笔直交叉火网射击
   */
  private updateGreenArmy(tSec: number): void {
    if (this.greens.length === 0) return;

    // 1. 沿专属 CQB 战术航点折线 (this.waypoints) 的弧长参数 this.squadPathDist 物理匀速/变速推进：
    //    核心铁律：「前排丧尸未肃清前绝不越过、绝不穿怪而过！」
    let hasCloseFrontEnemy = false;
    let maxSouthZombieY = -Infinity;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const ry = r.y + r.r;
      if (ry > this.squadCenterY - 260) {
        if (ry > maxSouthZombieY) maxSouthZombieY = ry;
      }
      const dy = this.squadCenterY - ry;
      if (
        dy > -60 &&
        dy < 165 &&
        (Math.abs(r.x - this.squadCenterX) < 250 ||
          this.hasLineOfSight(this.squadCenterX, this.squadCenterY, r.x, r.y))
      ) {
        hasCloseFrontEnemy = true;
      }
    }

    const scheduleDist = clamp(Math.max(0, tSec - 3.9) / 21.0, 0, 1) * this.totalPathLen;
    const maxSquadSpd =
      tSec < 4.5
        ? 0.95
        : tSec >= 23.0
          ? 3.15
          : this.counterPushActive
            ? 2.75
            : 2.4;
    let pathAdvance = clamp((scheduleDist - this.squadPathDist) * 0.11, 0.7, maxSquadSpd);

    // 若前排仍有丧尸逼近小队前线 (maxSouthZombieY > squadCenterY - 175)，小队原地驻停集火清怪（若压入或处于小队南侧则后撤清剿），绝不越过任何一只活体丧尸！
    if (maxSouthZombieY > this.squadCenterY - 110) {
      pathAdvance = maxSouthZombieY > this.squadCenterY - 20 ? -2.4 : -0.85;
    } else if (maxSouthZombieY > this.squadCenterY - 175) {
      pathAdvance = 0;
    } else if (this.holdForRescueTicks > 0) {
      this.holdForRescueTicks--;
      pathAdvance = Math.min(pathAdvance, 0.55);
    } else if (hasCloseFrontEnemy) {
      pathAdvance = Math.min(pathAdvance, this.counterPushActive ? 0.65 : 0.4);
    }

    this.squadPathDist = clamp(this.squadPathDist + pathAdvance, 0, this.totalPathLen);

    // 根据弧长 this.squadPathDist 在航点折线上精确插值 squadCenterX, squadCenterY 与行进朝向角
    const wps = this.waypoints;
    let segIdx = 0;
    while (
      segIdx < this.waypointCumLen.length - 2 &&
      this.waypointCumLen[segIdx + 1] < this.squadPathDist
    ) {
      segIdx++;
    }
    const segStartD = this.waypointCumLen[segIdx];
    const segEndD = this.waypointCumLen[segIdx + 1];
    const segLen = Math.max(1, segEndD - segStartD);
    const segT = clamp((this.squadPathDist - segStartD) / segLen, 0, 1);
    const wpA = wps[segIdx];
    const wpB = wps[segIdx + 1];
    this.squadCenterX = wpA.x + (wpB.x - wpA.x) * segT;
    this.squadCenterY = wpA.y + (wpB.y - wpA.y) * segT;

    const targetMoveAng = Math.atan2(wpB.y - wpA.y, wpB.x - wpA.x);
    let dAng = targetMoveAng - this.squadMoveAngle;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    this.squadMoveAngle += dAng * 0.1;

    // 2. 每名士兵依靠真实物理速度 (vx, vy) 与双向 BFS 寻路流场向各自固定战术阵位机动（严格限速 <= 3.15px/tick，绝无穿墙或瞬移！）
    let totalUnits = this.greens.length;

    for (let idx = 0; idx < totalUnits; idx++) {
      const g = this.greens[idx];
      g.prevX = g.x;
      g.prevY = g.y;
      if (g.muzzleFlash > 0) g.muzzleFlash = Math.max(0, g.muzzleFlash - 0.25);
      if (g.recoilOffset > 0) g.recoilOffset = Math.max(0, g.recoilOffset - 0.85);

      const goal = this.getValidFormationGoal(g);
      const toGoalX = goal.x - g.x;
      const toGoalY = goal.y - g.y;
      const distToGoal = Math.hypot(toGoalX, toGoalY);
      const maxUnitSpd = g.role === "turret" ? 2.65 : tSec >= 24.5 ? 3.05 : 2.85;

      let steerX = 0;
      let steerY = 0;

      // 若士兵与阵位目标点之间无墙体阻挡，平滑驶向阵位；若隔着侧室墙壁、监区隔墙或反应堆岛，则沿 squadNavDist 流场科学绕出门口！
      if (this.hasLineOfSight(g.x, g.y, goal.x, goal.y)) {
        if (distToGoal > 0.5) {
          const spd = Math.min(maxUnitSpd, distToGoal * 0.22);
          steerX = (toGoalX / distToGoal) * spd;
          steerY = (toGoalY / distToGoal) * spd;
        }
      } else {
        const flow = this.sampleSquadFlow(g.x, g.y);
        if (flow.valid) {
          steerX = flow.fx * maxUnitSpd;
          steerY = flow.fy * maxUnitSpd;
        } else if (distToGoal > 0.5) {
          const spd = Math.min(maxUnitSpd, distToGoal * 0.18);
          steerX = (toGoalX / distToGoal) * spd;
          steerY = (toGoalY / distToGoal) * spd;
        }
      }

      // 单兵 CQB 战术风筝后撤与防越过阻断：
      // 1) 当非狂暴态普通丧尸逼近至 82px 以内时，士兵自动向后风筝拉扯边退边射（绝不傻站或主动撞向普通怪）；
      // 2) 当本兵前方走廊仍有未清丧尸 (r.y + r.r > g.y - 95) 时，严禁该士兵向北跨过丧尸防线！
      let nearestRed: RedDot | null = null;
      let nearestRedDist = Infinity;
      let maxLocalZombieY = -Infinity;
      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        const edgeDist = Math.hypot(r.x - g.x, r.y - g.y) - r.r - g.r;
        if (edgeDist < 220 && this.hasLineOfSight(g.x, g.y, r.x, r.y)) {
          if (edgeDist < nearestRedDist) {
            nearestRedDist = edgeDist;
            nearestRed = r;
          }
          if (Math.abs(r.x - g.x) < 190 && r.y + r.r > maxLocalZombieY) {
            maxLocalZombieY = r.y + r.r;
          }
        }
      }

      if (nearestRed && nearestRedDist < 82 && (nearestRed.frenzyTimer ?? 0) <= 0) {
        const awayX = g.x - nearestRed.x;
        const awayY = Math.max(24, g.y - nearestRed.y);
        const awayLen = Math.hypot(awayX, awayY) || 1;
        steerX = (awayX / awayLen) * maxUnitSpd;
        steerY = (awayY / awayLen) * maxUnitSpd;
      } else if (maxSouthZombieY > g.y + 115) {
        steerY = maxUnitSpd;
      } else if ((maxLocalZombieY > g.y - 95 || maxSouthZombieY > g.y + 45) && steerY < 0) {
        steerY = maxLocalZombieY > g.y - 52 || maxSouthZombieY > g.y + 85 ? 1.55 : 0;
      }

      // 队友间柔和防重叠排斥力
      let repelX = 0;
      let repelY = 0;
      for (let otherIdx = 0; otherIdx < totalUnits; otherIdx++) {
        if (otherIdx === idx) continue;
        const o = this.greens[otherIdx];
        const minD = g.r + o.r + 4.5;
        const dx = g.x - o.x;
        const dy = g.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD * minD && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const overlap = minD - d;
          repelX += (dx / d) * overlap * 0.22;
          repelY += (dy / d) * overlap * 0.22;
        }
      }

      g.vx = g.vx * 0.42 + (steerX + clamp(repelX, -1.2, 1.2)) * 0.58;
      g.vy = g.vy * 0.42 + (steerY + clamp(repelY, -1.2, 1.2)) * 0.58;

      const stepMag = Math.hypot(g.vx, g.vy);
      const maxAllowedStep = maxUnitSpd + 0.25;
      if (stepMag > maxAllowedStep) {
        g.vx = (g.vx / stepMag) * maxAllowedStep;
        g.vy = (g.vy / stepMag) * maxAllowedStep;
      }

      g.x += g.vx;
      g.y += g.vy;

      // 外墙与死角隔墙刚性碰撞排斥：士兵绝不可穿墙！
      for (const seg of this.outerWalls) {
        this.resolveSegmentCollision(g, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      for (const seg of this.deadCornerWalls) {
        this.resolveSegmentCollision(g, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      g.y = clamp(g.y, 280, WORLD_H - 70);

      // 物理铁律保底：单帧合成位移绝不可超过 3.6px/tick
      const finalDX = g.x - g.prevX;
      const finalDY = g.y - g.prevY;
      const finalDist = Math.hypot(finalDX, finalDY);
      if (finalDist > 3.6) {
        g.x = g.prevX + (finalDX / finalDist) * 3.6;
        g.y = g.prevY + (finalDY / finalDist) * 3.6;
      }
    }

    // 士兵位移后再次执行「零免疫接触即感染」判定，确保双向移动均 100% 触发物理感染！
    this.checkAndResolveContactInfections();
    totalUnits = this.greens.length;
    if (totalUnits === 0) return;

    // 先根据最新站位构建手电/探照灯光锥，供瞄准可见性判定 (isPointLit) 使用
    this.rebuildLightCones(tSec);

    // 4. 每名士兵独立执行「CQB 扇区索敌 + 单直线前排严格阻挡射击」
    for (let idx = 0; idx < totalUnits; idx++) {
      this.fireUnitStraightLine(this.greens[idx], idx, totalUnits, tSec);
    }

    // 若射击打破了救兵箱生成新兵，再次执行接触感染判定，确保帧末 100% 零未感染接触！
    this.checkAndResolveContactInfections();

    // 射击后更新手电朝向与枪口爆闪半径
    this.rebuildLightCones(tSec);

    if (this.tick % 3 === 0 && this.firingLines.length > 0) {
      this.emitAudio(
        this.squadBuffed || this.counterPushActive ? "heavy-mg" : "mg",
        0.24,
        0.9 + this.rng() * 0.18,
      );
    }
  }

  /**
   * 单名士兵/机枪塔的笔直火线射线检测与伤害结算：
   * - 铁律：「就一条直线打过去，前面的没打掉就不能打后面」！
   * - 在死角光暗模式 (`isDarkMode`) 下，不仅子弹受死角墙体物理阻挡，而且只有被手电/探照灯/声呐照亮的目标才能被锁定射击！
   */
  private fireUnitStraightLine(
    unit: GreenUnit,
    unitIdx: number,
    totalUnits: number,
    tSec: number,
  ): void {
    // 严格有限 CQB 真实枪械有效射程（霰弹 225px / 步枪 300px / 机枪塔 340px / 狙击 375px，绝不跨越全屏无限射击！）
    const maxRange =
      unit.role === "shotgun"
        ? 225
        : unit.role === "sniper"
          ? 375
          : unit.role === "turret"
            ? 340
            : 300;

    // 声呐潜行模式 (sonar)：前 3.0s 小队保持静默潜行，分扇区左右扫动手电光锥摸排 S 弯盲区，绝不贸然开枪！
    if (this.mode === "sonar" && !this.sonarAwakened && tSec < 3.0) {
      const sectorOffset = ((unitIdx % 3) - 1) * 0.55;
      unit.aimAngle = this.squadMoveAngle + sectorOffset + Math.sin(tSec * 2.6 + unitIdx * 1.1) * 0.38;
      return;
    }

    // 0. 优先检测该士兵近身扇区内是否存在紧迫丧尸威胁 (距离 < 215px 或已压至士兵前方 150px 内)：
    //    若近身有怪，全员100%优先集火肃清贴脸前排怪，绝不分心去打侧面箱子或远处母巢！
    let hasCloseZombieThreat = false;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const dist = Math.hypot(r.x - unit.x, r.y - unit.y) - r.r;
      if (
        (dist < 215 || r.y + r.r > unit.y - 150) &&
        dist <= maxRange &&
        this.hasLineOfSight(unit.x, unit.y, r.x, r.y)
      ) {
        hasCloseZombieThreat = true;
        break;
      }
    }

    // 1. 选择瞄准方向：
    //    - 仅在近身无贴脸丧尸威胁且处于武器有效射程 (maxRange) 内时，侧翼破拆兵将手电与枪口对准附近门洞内的【密码箱 / 备用电闸 / 救兵囚笼】
    //    - 其余情况按 CQB 扇区优先瞄准最靠南（最贴近防线前排）且在有效射程内的已照亮丧尸、泰坦或北部丧尸母巢核心！
    let aimTargetX = CORRIDOR_CX;
    let aimTargetY = this.hive.y;
    let foundTarget = false;

    if (!hasCloseZombieThreat) {
      for (let ni = 0; ni < this.nodes.length; ni++) {
        const node = this.nodes[ni];
        if (node.broken) continue;
        const unlockSec = ni === 0 ? 6.5 : ni === 1 ? 14.0 : 21.2;
        const distToNode = Math.hypot(node.x - unit.x, node.y - unit.y);
        const isNodeShooter =
          tSec >= unlockSec + 1.0
            ? unitIdx % 2 === 0
            : unitIdx === 0 || unitIdx === totalUnits - 1 || unitIdx % 3 === 0;
        if (
          tSec >= unlockSec &&
          distToNode <= maxRange &&
          isNodeShooter &&
          this.hasLineOfSight(unit.x, unit.y, node.x, node.y)
        ) {
          const nodeSpread = ((unitIdx % 3) - 1) * 7;
          aimTargetX = node.x + nodeSpread;
          aimTargetY = node.y;
          foundTarget = true;
          break;
        }
      }
    }

    // 当大军推进进入北部母巢有效射程内且近身无贴脸小怪时，半数士兵向【丧尸母巢核心】倾泻交叉火网！
    if (
      !foundTarget &&
      !hasCloseZombieThreat &&
      this.hive.alive &&
      tSec >= 25.0 &&
      Math.hypot(this.hive.x - unit.x, this.hive.y - unit.y) - this.hive.r <= maxRange &&
      unitIdx % 2 === 1
    ) {
      const spreadOnHive = ((unitIdx % 9) - 4) * 11;
      aimTargetX = this.hive.x + spreadOnHive;
      aimTargetY = this.hive.y + 10;
      foundTarget = true;
    }

    if (!foundTarget) {
      let bestScore = Infinity;
      const sectorBiasX = ((unitIdx / Math.max(1, totalUnits - 1)) - 0.5) * 260;

      for (let i = 0; i < this.reds.length; i++) {
        const r = this.reds[i];
        const dist = Math.hypot(r.x - unit.x, r.y - unit.y) - r.r;
        if (dist > maxRange) continue;

        // 科学视线与迷雾铁律：任何隔着墙壁的目标绝不可穿墙瞄准！且死角光暗模式下普通丧尸必须被手电/探照灯照亮才可锁定！
        if (!this.hasLineOfSight(unit.x, unit.y, r.x, r.y)) {
          continue;
        }
        const isVisibleBoss = r.kind === "boss";
        if (this.isDarkMode && !isVisibleBoss && !this.isPointLit(r.x, r.y, unit)) {
          continue;
        }

        const sticky = r.id === unit.lockedTargetId ? -18 : 0;
        const bossBonus = r.kind === "boss" && !hasCloseZombieThreat ? -115 : r.kind === "boss" ? -35 : 0;
        const carrierBonus = r.kind === "carrier" && unitIdx % 3 === 1 ? -40 : 0;
        // 强烈前排优先权重：越靠南（r.y 越大，越逼近小队防线）或距离 < 175px 的丧尸优先级最高，必须先打死最前面的怪！
        const frontUrgency = -Math.max(0, r.y + r.r - (unit.y - 260)) * 2.15 - (dist < 175 ? 190 : 0);
        const sectorPenalty = Math.abs(r.x - (this.squadCenterX + sectorBiasX)) * 0.9;
        const slotSpreadPenalty = r.kind === "boss" ? 0 : ((i + unitIdx) % 5) * 12;
        const score =
          dist * 0.85 +
          sectorPenalty +
          slotSpreadPenalty +
          sticky +
          bossBonus +
          carrierBonus +
          frontUrgency;
        if (score < bestScore) {
          bestScore = score;
          const aimSpread =
            r.kind === "boss"
              ? ((unitIdx % 7) - 3) * (r.r * 0.24)
              : ((unitIdx % 3) - 1) * 2.2;
          aimTargetX = r.x + aimSpread;
          aimTargetY = r.y;
          unit.lockedTargetId = r.id;
          foundTarget = true;
        }
      }

      if (
        !foundTarget &&
        this.hive.alive &&
        this.hasLineOfSight(unit.x, unit.y, this.hive.x, this.hive.y) &&
        Math.hypot(this.hive.x - unit.x, this.hive.y - unit.y) - this.hive.r <= maxRange
      ) {
        const spreadOnHive = ((unitIdx % 9) - 4) * 11;
        aimTargetX = this.hive.x + spreadOnHive;
        aimTargetY = this.hive.y + 10;
        foundTarget = true;
      }
    }

    if (!foundTarget) {
      // 科学 CQB 多扇区战术手电警戒：
      // - 尖兵 (idx%3===0) 照亮正前方推进走廊；
      // - 左翼兵 (idx%3===1) 转向左侧门洞/死角扫描；
      // - 右翼兵 (idx%3===2) 转向右侧门洞/死角扫描！
      const baseAng = this.squadMoveAngle;
      const roleSector = unitIdx % 3 === 0 ? 0 : unitIdx % 3 === 1 ? -0.68 : 0.68;
      let peekAng = baseAng + roleSector + Math.sin(tSec * 2.4 + unitIdx * 1.3) * 0.35;
      if (unitIdx % 2 === 1) {
        for (const n of this.nodes) {
          if (!n.broken && Math.hypot(n.x - unit.x, n.y - unit.y) < 380) {
            peekAng = Math.atan2(n.y - unit.y, n.x - unit.x) + Math.sin(tSec * 3.0 + unitIdx) * 0.18;
            break;
          }
        }
      }
      unit.aimAngle = peekAng;
      return;
    }

    const aimAngle = Math.atan2(aimTargetY - unit.y, aimTargetX - unit.x);
    unit.aimAngle = aimAngle;
    unit.muzzleFlash = 1.0;
    unit.recoilOffset = (this.tick + unitIdx) % 2 === 0 ? 2.6 : 1.0;

    // 声呐潜行模式 (sonar)：枪声制造强烈噪音波，瞬间惊醒 520px 内所有死角蛰伏丧尸！
    if (this.mode === "sonar" && (this.tick + unitIdx) % 10 === 0) {
      let hasDormant = false;
      for (let i = 0; i < this.reds.length; i++) {
        if (this.reds[i].dormant) {
          hasDormant = true;
          break;
        }
      }
      if (hasDormant) {
        this.rings.push({
          x: unit.x,
          y: unit.y,
          maxR: 420,
          ttl: 22,
          maxTtl: 22,
          kind: "noise",
        });
        this.awakenDormantByNoise(unit.x, unit.y, 520);
      }
    }

    const ux = Math.cos(aimAngle);
    const uy = Math.sin(aimAngle);
    const muzzleDist = unit.r + 8;
    const mx = unit.x + ux * muzzleDist;
    const my = unit.y + uy * muzzleDist;

    // 2. 精确几何射线最近交点检测 (Ray-Circle / Ray-Segment Intersection)：
    //    严格钳制子弹终点距离不超过有效射程 (maxRange) 与瞄准目标距离 (aimDist + 14)，彻底杜绝无限射程贯穿全图！
    const aimDist = Math.hypot(aimTargetX - mx, aimTargetY - my);
    let bestDist = Math.min(maxRange, aimDist + 14);
    let hitType: "boss" | "hive" | "node" | "minion" | "wall" = "wall";
    let hitRedIdx = -1;
    let hitNodeIdx = -1;

    // 2a. 走廊外墙边界交点 + 室内死角隔墙 (deadCornerWalls) 精确阻挡
    const dOuter = this.castRayToWalls(mx, my, ux, uy, bestDist);
    if (dOuter < bestDist) {
      bestDist = dOuter;
      hitType = "wall";
    }

    // 2b. 检测所有丧尸与泰坦 Boss（前排怪结结实实挡住后排！）
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      const dx = r.x - mx;
      const dy = r.y - my;
      const proj = dx * ux + dy * uy;
      if (proj <= -r.r || proj - r.r >= bestDist) continue;

      const perp2 = dx * dx + dy * dy - proj * proj;
      const hitR = r.r + 2.8;
      if (perp2 <= hitR * hitR) {
        const halfChord = Math.sqrt(Math.max(0, hitR * hitR - perp2));
        const tHit = Math.max(2, proj - halfChord);
        if (tHit < bestDist) {
          bestDist = tHit;
          hitType = r.kind === "boss" ? "boss" : "minion";
          hitRedIdx = i;
          hitNodeIdx = -1;
        }
      }
    }

    // 2c. 检测未破开的战场节点（囚笼 / 倍增晶石 / 工事箱）——只有前面没被丧尸和墙壁挡住时才能打中！
    for (let ni = 0; ni < this.nodes.length; ni++) {
      const node = this.nodes[ni];
      if (node.broken) continue;
      const dx = node.x - mx;
      const dy = node.y - my;
      const proj = dx * ux + dy * uy;
      if (proj <= -node.r || proj - node.r >= bestDist) continue;

      const perp2 = dx * dx + dy * dy - proj * proj;
      const hitR = node.r + 3.0;
      if (perp2 <= hitR * hitR) {
        const halfChord = Math.sqrt(Math.max(0, hitR * hitR - perp2));
        const tHit = Math.max(2, proj - halfChord);
        if (tHit < bestDist) {
          bestDist = tHit;
          hitType = "node";
          hitNodeIdx = ni;
          hitRedIdx = -1;
        }
      }
    }

    // 2d. 检测北部【丧尸母巢核心】——同样必须前排无阻挡且在有效射程内才能打到母巢！
    if (this.hive.alive) {
      const dx = this.hive.x - mx;
      const dy = this.hive.y - my;
      const proj = dx * ux + dy * uy;
      if (proj > 0 && proj - this.hive.r < bestDist) {
        const perp2 = dx * dx + dy * dy - proj * proj;
        const hitR = this.hive.r + 3.0;
        if (perp2 <= hitR * hitR) {
          const halfChord = Math.sqrt(Math.max(0, hitR * hitR - perp2));
          const tHit = Math.max(2, proj - halfChord);
          if (tHit < bestDist) {
            bestDist = tHit;
            hitType = "hive";
            hitRedIdx = -1;
            hitNodeIdx = -1;
          }
        }
      }
    }

    const hitX = mx + ux * bestDist;
    const hitY = my + uy * bestDist;

    // 3. 伤害结算
    const overrun = this.isOverrunMode();
    const scaleFactor = totalUnits <= 6 ? 0.92 : 2.95 / Math.pow(totalUnits, 0.52);
    const buffMult = unit.buffed || this.squadBuffed ? 1.18 : 1.0;
    const roleMult = unit.role === "turret" ? 1.22 : unit.role === "sniper" ? 1.15 : 1.0;
    const darkMult = !overrun ? 1.58 : this.isDarkMode ? 1.2 : 1.0;
    const baseDmg = 1.48 * scaleFactor * buffMult * roleMult * darkMult;

    if (hitType === "minion" || hitType === "boss") {
      const target = this.reds[hitRedIdx];
      if (target) {
        const lateBoost = overrun
          ? tSec >= 24.8
            ? 0.78
            : tSec >= 15.0
              ? 1.4
              : 1.08
          : tSec >= 24.5
            ? 2.45
            : tSec >= 14.0
              ? 1.65
              : 1.18;
        const dmg = (target.kind === "boss" ? baseDmg * 1.18 : baseDmg * 1.42) * lateBoost;
        target.hp -= dmg;
        target.hitFlash = 1.0;

        const kb = target.kind === "boss" ? 0.04 : (target.frenzyTimer ?? 0) > 0 ? 0.04 : 0.24;
        target.vx = clamp(target.vx + ux * kb, -3.2, 3.2);
        target.vy = clamp(target.vy + uy * kb, -3.2, 3.2);

        if ((this.tick + unitIdx) % 5 === 0) {
          this.spawnImpactParticles(hitX, hitY, ux, uy, "blood", 1);
        }

        if (target.hp <= 0) {
          this.killRedDot(hitRedIdx, tSec);
        }
      }
    } else if (hitType === "node") {
      const node = this.nodes[hitNodeIdx];
      if (node && !node.broken) {
        const unlockSec = hitNodeIdx === 0 ? 8.5 : hitNodeIdx === 1 ? 15.8 : 22.8;
        if (tSec >= unlockSec) {
          node.hp -= baseDmg * 3.8;
          node.hitFlash = 1.0;
          if ((this.tick + unitIdx) % 4 === 0) {
            this.spawnImpactParticles(hitX, hitY, ux, uy, "gold", 1);
          }
          if (node.hp <= 0) {
            this.triggerNodeShatter(node);
          }
        } else {
          node.hitFlash = 0.35;
        }
      }
    } else if (hitType === "hive" && this.hive.alive) {
      const hiveDmg = overrun
        ? baseDmg * 1.15
        : tSec >= 33.4
          ? baseDmg * 11.5
          : tSec >= 29.8
            ? baseDmg * 4.8
            : tSec >= 25.8
              ? baseDmg * 2.1
              : baseDmg * 0.1;
      this.hive.hp -= hiveDmg;
      this.hive.hitFlash = 1.0;
      if ((this.tick + unitIdx) % 4 === 0) {
        this.spawnImpactParticles(hitX, hitY, ux, uy, "spark", 1);
      }
      if (overrun) {
        // 尸潮大胜模式下，母巢甲壳坚守至最后一名人类沦陷（血量最低保留 18%）
        if (this.hive.hp < this.hive.maxHp * 0.18) {
          this.hive.hp = this.hive.maxHp * 0.18;
        }
      } else {
        if (this.hive.hp <= 0 && tSec >= 34.6) {
          this.triggerHiveDestruction();
        } else if (this.hive.hp < 80 && tSec < 34.6) {
          this.hive.hp = 80;
        }
      }
    }

    // 人类惨胜模式保底引爆：当时间 >= 34.6s 且残存的 3~6 名孤胆老兵浴血坚持到最后时刻时，引爆高能C4彻底炸毁母巢！
    if (!overrun && this.hive.alive && tSec >= 34.6 && this.greens.length > 0) {
      this.triggerHiveDestruction();
    }

    this.firingLines.push({
      x1: mx,
      y1: my,
      x2: hitX,
      y2: hitY,
      role: unit.role,
      hitKind: hitType,
      buffed: unit.buffed || this.squadBuffed,
    });
  }

  /**
   * 打穿前排尸潮后击破战场节点（救兵囚笼 / 倍增晶石 / 碉堡工事箱）的裂变奖励（全程物理移动归队，绝无跨房穿墙瞬移）！
   */
  private triggerNodeShatter(node: TacticalNodeState): void {
    if (node.broken) return;
    node.broken = true;
    node.hp = 0;
    this.phase = this.counterPushActive ? "counterpush" : "evolve";
    this.emitAudio("adrenaline", 0.95, 1.08);

    this.pendingDecals.push({
      kind: "crystals",
      x: node.x,
      y: node.y,
      r: node.r * 1.3,
      seed: this.tick,
    });

    if (node.kind === "rescue_cage") {
      const addCount = Math.min(node.rewardValue, 26 - this.greens.length);
      const role = node.rewardRole ?? "rifle";
      for (let i = 0; i < addCount; i++) {
        const ang = (i / Math.max(1, addCount)) * Math.PI * 2;
        this.spawnGreenUnit(role, node.x + Math.cos(ang) * 16, node.y + Math.sin(ang) * 16);
      }
      this.holdForRescueTicks = Math.max(this.holdForRescueTicks, 68);
      this.rescuedCount += addCount;
      this.rings.push({ x: node.x, y: node.y, maxR: 110, ttl: 20, maxTtl: 20, kind: "rescue" });
      this.addBanner(node.x, node.y - 10, `+${addCount}`, [85, 255, 165, 255]);
    } else if (node.kind === "multiply_crystal") {
      const currentCount = this.greens.length;
      const addCount =
        node.rewardValue === 2
          ? Math.min(currentCount, 26 - currentCount)
          : Math.min(node.rewardValue, 26 - currentCount);
      for (let i = 0; i < addCount; i++) {
        const src = this.greens[i % currentCount];
        const ang = (i / Math.max(1, addCount)) * Math.PI * 2;
        this.spawnGreenUnit(
          i % 2 === 0 ? "shotgun" : "rifle",
          (src ? src.x : node.x) + Math.cos(ang) * 11,
          (src ? src.y : this.squadCenterY) + Math.sin(ang) * 11,
        );
      }
      this.squadBuffed = true;
      for (const g of this.greens) g.buffed = true;
      this.rings.push({ x: node.x, y: node.y, maxR: 125, ttl: 22, maxTtl: 22, kind: "multiply" });
      this.addBanner(node.x, node.y - 10, `×2`, [255, 225, 75, 255]);
    } else if (node.kind === "bunker_pad") {
      // 部署 2 座前线重机枪碉堡 + 4 名护卫步兵（从工事箱位置按物理速度展开阵型）
      for (const side of [-1, 1]) {
        if (this.bunkersBuilt < this.maxBunkers + 2) {
          this.bunkersBuilt++;
          this.spawnGreenUnit("turret", node.x + side * 24, node.y - 14);
        }
      }
      const addInf = Math.min(4, 26 - this.greens.length);
      for (let i = 0; i < addInf; i++) {
        const ang = (i / Math.max(1, addInf)) * Math.PI * 2;
        this.spawnGreenUnit("rifle", node.x + Math.cos(ang) * 16, node.y + Math.sin(ang) * 16);
      }
      this.holdForRescueTicks = Math.max(this.holdForRescueTicks, 45);
      this.squadBuffed = true;
      this.rings.push({ x: node.x, y: node.y, maxR: 115, ttl: 20, maxTtl: 20, kind: "multiply" });
      this.addBanner(node.x, node.y - 10, "+2", [95, 225, 255, 255]);
    }

    if (this.greens.length >= 14) {
      this.squadBuffed = true;
      for (const g of this.greens) g.buffed = true;
      if (!this.counterPushActive) {
        this.counterPushActive = true;
        this.phase = "counterpush";
      }
    }
  }

  /**
   * 轰爆顶部【丧尸母巢核心】：引发全屏连锁冲击波并净化所有残余丧尸！
   */
  private triggerHiveDestruction(): void {
    if (!this.hive.alive) return;
    this.hive.alive = false;
    this.hive.hp = 0;
    this.emitAudio("hive-blast", 1.0, 1.0);

    this.rings.push({
      x: this.hive.x,
      y: this.hive.y,
      maxR: 260,
      ttl: 28,
      maxTtl: 28,
      kind: "hive-kill",
    });
    this.pendingDecals.push({
      kind: "boss_blood",
      x: this.hive.x,
      y: this.hive.y,
      r: 72,
      seed: 999,
    });

    // 母巢崩塌冲击波瞬间引爆场上所有残余丧尸
    for (let i = this.reds.length - 1; i >= 0; i--) {
      const r = this.reds[i];
      this.kills++;
      if (r.kind === "boss") {
        this.bossesKilled++;
      }
      this.spawnImpactParticles(r.x, r.y, 0, -1, "blood", 2);
    }
    this.reds.length = 0;
  }

  private spawnImpactParticles(
    x: number,
    y: number,
    ux: number,
    uy: number,
    kind: "spark" | "blood" | "bio" | "gold",
    count: number,
  ): void {
    if (this.sparks.length > 110) return;
    const baseAng = Math.atan2(uy, ux);
    for (let c = 0; c < count; c++) {
      const ang = baseAng + Math.PI + (this.rng() - 0.5) * 1.45;
      const spd = 1.8 + this.rng() * 2.8;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        kind,
        ttl: 7,
        maxTtl: 7,
      });
    }
  }

  private killRedDot(idx: number, tSec: number): void {
    const d = this.reds[idx];
    if (!d) return;
    this.kills++;

    // 方案 D (bunker) 或全融合模式 (combo)：击杀丧尸积攒工程能量，自动在前线修筑重机枪碉堡！
    if ((this.mode === "bunker" || this.mode === "combo") && this.bunkersBuilt < this.maxBunkers) {
      const gain = this.mode === "bunker" ? 2.4 : 1.35;
      this.bunkerEnergy = Math.min(100, this.bunkerEnergy + gain);
      if (this.bunkerEnergy >= 100 && this.greens.length < 26) {
        this.bunkerEnergy = 0;
        this.bunkersBuilt++;
        const side = this.bunkersBuilt % 2 === 0 ? 1 : -1;
        const bx = this.squadCenterX + side * (55 + (this.bunkersBuilt % 3) * 22);
        const by = clamp(this.squadCenterY - 22, 260, 2750);
        this.spawnGreenUnit("turret", bx, by);
        this.rings.push({ x: bx, y: by, maxR: 68, ttl: 16, maxTtl: 16, kind: "multiply" });
        this.addBanner(bx, by - 10, "+1", [95, 225, 255, 255]);
      }
    }

    // 方案 B (infect) 或全融合模式 (combo)：点杀【同化母体】触发纳米同化，原地将周围丧尸转化为 3~4 名我方新绿兵！
    if (d.kind === "carrier") {
      const addCount = Math.min(this.mode === "infect" ? 4 : 3, 26 - this.greens.length);
      for (let i = 0; i < addCount; i++) {
        this.spawnGreenUnit("rifle", d.x + (i - 1) * 18, Math.max(d.y + 35, this.squadCenterY - 10));
      }
      this.rescuedCount += addCount;
      this.rings.push({ x: d.x, y: d.y, maxR: 95, ttl: 18, maxTtl: 18, kind: "infect" });
      this.addBanner(d.x, d.y - 10, `+${addCount}`, [75, 255, 155, 255]);
    } else if (d.kind === "boss") {
      this.bossesKilled++;
      this.emitAudio("boss-kill", 1.0, d.isFinalBoss ? 0.82 : 1.0);
      this.rings.push({
        x: d.x,
        y: d.y,
        maxR: d.r * 2.8,
        ttl: 20,
        maxTtl: 20,
        kind: "boss-kill",
      });
      this.pendingDecals.push({
        kind: "boss_blood",
        x: d.x,
        y: d.y,
        r: d.r * 1.15,
        seed: d.id,
      });
    }
    if (this.kills % 2 === 0) {
      this.emitAudio("kill-pop", 0.36, 0.9 + (this.kills % 7) * 0.04);
    }
    if (this.kills % 6 === 0 && tSec > 1.0 && d.kind !== "boss" && d.kind !== "carrier") {
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

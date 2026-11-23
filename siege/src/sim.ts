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
  getArchZones,
  getInteriorProps,
  getSquadWaypoints,
  getTacticalNodeSpecs,
  isDarkDeadCornerMode,
  SIEGE_MAPS,
  SIEGE_MODE_META,
  type InteriorPropSpec,
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
  /** 拐角盲区埋伏怪标记（在小队抵近 90° 盲区拐角前潜伏在阴影墙后，切角瞬间暴起扑杀！） */
  cornerAmbush?: boolean;
  /** 士兵被感染瞬间原地抽搐尸变帧数 (24 ticks = 0.40s 等身自然尸变演出) */
  mutatingTicks?: number;
  /** 声呐超声波扫过墙后暗处丧尸时点亮的青色声呐回波余晖帧数 */
  sonarPingTicks?: number;
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
  breachProgress: number;
  openAnim: number;
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
  role?: GreenRole;
  heavy?: boolean;
  corrupted?: boolean;
  hitKind: "boss" | "hive" | "node" | "minion" | "wall";
  buffed?: boolean;
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
  kind: "blood" | "boss_blood" | "scorch" | "crystals" | "tire";
  x: number;
  y: number;
  r: number;
  seed: number;
}

export interface RocketProjectile {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  ttl: number;
}

export interface ShellCasing {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  ttl: number;
  maxTtl: number;
  heavy: boolean;
}

export interface DestructiblePropState extends InteriorPropSpec {
  id: number;
  hp: number;
  maxHp: number;
  intact: boolean;
  indestructible: boolean;
  blocksBulletsFull: boolean;
  hitFlash: number;
  shakeX: number;
  shakeY: number;
  material: "glass" | "wood" | "metal" | "fabric" | "stone";
}

export interface DebrisShard {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  len: number;
  wid: number;
  color: [number, number, number, number];
  ttl: number;
  maxTtl: number;
  shape: "plank" | "glass" | "box";
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
    | "hive-blast"
    | "bus-brake"
    | "rocket-launch"
    | "rocket-blast"
    | "ram-hit"
    | "infect-bite"
    | "glass-break"
    | "prop-smash"
    | "sonar-ping"
    | "power-down";
  gain: number;
  pitch: number;
  pan: number;
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

  get isDarkMode(): boolean {
    return this.mode === "sonar" || (this.mode === "blackout" && this.blackoutActive);
  }
  readonly outerWalls: WallSegment[];
  readonly deadCornerWalls: WallSegment[];
  readonly waypoints: Array<{ x: number; y: number }>;
  readonly waypointCumLen: number[] = [0];
  readonly totalPathLen: number = 0;
  squadPathDist = 0;
  lightCones: LightConeSpec[] = [];
  blackoutActive = false;
  /** 地铁站通电荧光亮度 (1.0=全亮正常供电 -> 10.4~11.6s 短路电弧频闪 -> 0.0=拉闸断电陷入自然战争迷雾) */
  metroPowerLevel = 1.0;
  sonarAwakened = false;
  private hiveHallEnteredSec = -1;

  // 2D 动态平滑跟随镜头左上角世界坐标 (camX, camY)、动态战术变焦倍率 (camZoom)、感染红紫警示脉冲 (infectionFlash) 与微震屏冲击量 (camTrauma)
  camX = 0;
  camY = 0;
  camZoom = 2.05;
  infectionFlash = 0;
  camTrauma = 0;
  camShakeX = 0;
  camShakeY = 0;
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
  props: DestructiblePropState[] = [];
  pillars: Array<{ x: number; y: number; w: number; h: number }> = [];
  pits: Array<{ x: number; y: number; w: number; h: number }> = [];
  debris: DebrisShard[] = [];
  propsDestroyed = 0;
  private navObstaclesDirty = false;
  hive: MotherHiveState;
  firingLines: StraightFiringLine[] = [];
  sparks: BulletSpark[] = [];
  rings: ShockRing[] = [];
  banners: FloatingBanner[] = [];
  rockets: RocketProjectile[] = [];
  shells: ShellCasing[] = [];
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

    // 0. 初始化可破坏室内家具刚体、混凝土柱网、天井坑洞与科学寻路障碍网格
    this.initPropsAndZones();
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
    } else if (this.mode === "sonar") {
      // 声呐潜行模式：双机编队黑鹰潜行武装直升机并排从溶洞南口低空突入扫射，随后悬停双侧索降各 3 名特战队员！
      for (const [id, lzX, rotOff] of [
        [1, 770, 0],
        [2, 1030, 1.1],
      ] as const) {
        this.vehicles.push({
          id,
          kind: "helicopter",
          x: lzX,
          y: 2890,
          startX: lzX,
          startY: 2890,
          stopX: lzX,
          stopY: 2560,
          angle: -Math.PI * 0.5,
          turretAngle: -Math.PI * 0.5,
          muzzleFlash: 0,
          rotorAngle: rotOff,
          doorOpen: 0,
          ropeDrop: 0,
          headlightsOn: true,
          phase: "inbound",
          subSquad: 0,
          deployedCount: 0,
          totalToDeploy: 3,
        });
      }
      this.squadCenterX = 900;
      this.squadCenterY = 2850;
    } else if (this.mode === "blackout") {
      // 重装黑鹰武装直升机：先从 y=2890 低空推进至 y=2560 用双翼加特林机炮+破片火箭弹扫射清空第一波前哨尸潮，再悬停索降 6 名特战队员！
      const lzX = 900;
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

          // 持久化烘焙重型装甲大巴双排加宽防爆轮胎压痕
          if (this.tick % 3 === 0) {
            this.pendingDecals.push({ kind: "tire", x: v.x, y: v.y + 52, r: 24, seed: v.id });
          }

          // 重型车头 V 型液压破障铲物理碾压撞击判定
          let rammedAny = false;
          for (let ri = this.reds.length - 1; ri >= 0; ri--) {
            const r = this.reds[ri];
            if (r.kind === "boss") continue;
            if (Math.abs(r.x - v.x) <= r.r + 46 && r.y >= v.y - 90 && r.y <= v.y + 66) {
              this.rings.push({ x: r.x, y: r.y, maxR: 42, ttl: 10, maxTtl: 10, kind: "casualty" });
              this.pendingDecals.push({ kind: "blood", x: r.x, y: r.y, r: 15, seed: r.id });
              this.spawnImpactParticles(r.x, r.y, 0, -1, "blood", 5);
              this.spawnImpactParticles(r.x, r.y, 0, -1, "spark", 4);
              this.killRedDot(ri, tSec);
              rammedAny = true;
            }
          }
          if (rammedAny) {
            this.addTrauma(0.18);
            this.emitAudio("ram-hit", 0.55, 0.92 + ((this.tick % 5) * 0.04), v.x);
          }

          // 重型装甲大巴车头破障撞碎沿途玻璃展柜与散落手推车/行李箱！
          for (let pi = 0; pi < this.props.length; pi++) {
            const prop = this.props[pi];
            if (!prop.intact || prop.indestructible) continue;
            const cx = clamp(v.x, prop.x, prop.x + prop.w);
            const cy = clamp(v.y - 20, prop.y, prop.y + prop.h);
            if (Math.abs(cx - v.x) <= 46 && cy >= v.y - 92 && cy <= v.y + 62) {
              this.damageProp(prop, 999, 0, -1);
            }
          }

          this.fireVehicleWeapons(v, tSec);
        } else if (tSec < 4.95) {
          // 阶段 2：推进一波攻击扫平前哨尸潮后，大巴急刹停稳 (y=2560)，液压气动刹车泄压声，装甲门展开，车内士兵依次下车突击！
          if (this.tick === Math.round(3.2 * SIM_HZ) && v.id === 1) {
            this.emitAudio("bus-brake", 0.72, 1.0, v.x);
            this.addTrauma(0.16);
          }
          v.x = v.stopX;
          v.y = v.stopY;
          v.doorOpen = clamp((tSec - 3.2) / 0.25, 0.2, 1.0);
          v.phase = v.deployedCount < v.totalToDeploy ? "deploying" : "parked";

          if (tSec < 4.25) {
            this.clearEntranceStragglers(v);
          }
          if (tSec < 4.55) {
            this.fireVehicleWeapons(v, tSec);
          }

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
        } else if (tSec < 6.85) {
          // 阶段 3：全员投送完毕，装甲车门收回，亮起倒车警示灯平稳倒车撤出后方战区，让出完整视野
          v.phase = "departing";
          v.doorOpen = Math.max(0, 1 - (tSec - 4.95) * 3.5);
          const revP = clamp((tSec - 4.95) / 1.9, 0, 1);
          v.y = v.stopY + revP * revP * 380;
          v.turretAngle = -Math.PI * 0.5;
        } else {
          v.phase = "gone";
          v.headlightsOn = false;
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
      let hitPropIdx = -1;
      const dWall = this.castRayToWalls(mx, my, ux, uy, bestDist);
      if (dWall < bestDist) {
        bestDist = dWall;
        hitRedIdx = -1;
      }

      for (let pi = 0; pi < this.props.length; pi++) {
        const prop = this.props[pi];
        if (!prop.intact) continue;
        if (!prop.blocksBulletsFull && (this.tick + mi + prop.id) % 3 !== 0) continue;
        const tProp = this.rayRectDist(mx, my, ux, uy, bestDist, prop.x, prop.y, prop.w, prop.h);
        if (tProp < bestDist) {
          bestDist = tProp;
          hitPropIdx = pi;
          hitRedIdx = -1;
        }
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
            hitPropIdx = -1;
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

      if (mi === 0 && this.tick % 2 === 0) {
        this.spawnShellCasing(mx, my, ux, uy, true);
      }

      if (hitPropIdx >= 0 && this.props[hitPropIdx]) {
        this.damageProp(this.props[hitPropIdx], m.dmg * 2.8, ux, uy);
      } else if (hitRedIdx >= 0 && this.reds[hitRedIdx]) {
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

    // 直升机在低空突进阶段 (t < 3.0s) 交替从左右短翼火箭巢发射可见高速破片火箭弹 (RocketProjectile)！
    if (v.kind === "helicopter" && tSec >= 0.32 && tSec <= 2.98 && this.tick % 20 === 8) {
      let clusterIdx = -1;
      let minD = Infinity;
      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        const d = Math.hypot(r.x - v.x, r.y - v.y);
        if (r.y >= 2390 && d > 55 && d < 345 && d < minD) {
          minD = d;
          clusterIdx = ri;
        }
      }
      if (clusterIdx >= 0) {
        const c = this.reds[clusterIdx];
        const podSide = this.tick % 40 < 20 ? -1 : 1;
        const sx = v.x + podSide * 28;
        const sy = v.y - 10;
        const dx = c.x - sx;
        const dy = c.y - sy;
        const dist = Math.hypot(dx, dy) || 1;
        const spd = 19.5;
        const ttl = Math.max(2, Math.min(22, Math.round(dist / spd)));
        this.rockets.push({
          x: sx,
          y: sy,
          prevX: sx,
          prevY: sy,
          vx: (dx / dist) * spd,
          vy: (dy / dist) * spd,
          targetX: c.x,
          targetY: c.y,
          ttl,
        });
        this.emitAudio("rocket-launch", 0.52, 0.95 + podSide * 0.05, sx);
      }
    }

    if (firedAny) {
      v.muzzleFlash = 1.0;
      if (this.tick % 4 === 0) {
        this.emitAudio("heavy-mg", 0.30, 0.88 + this.rng() * 0.14, v.x);
      }
    }
  }

  private initPropsAndZones(): void {
    const zones = getArchZones(this.mode);
    this.pillars = [];
    this.pits = [];
    for (const z of zones) {
      if (z.kind === "pillar") {
        this.pillars.push({ x: z.x, y: z.y, w: z.w, h: z.h });
      } else if (z.kind === "atrium_pit") {
        this.pits.push({ x: z.x, y: z.y, w: z.w, h: z.h });
      }
    }

    const rawProps = getInteriorProps(this.mode);
    this.props = rawProps.map((p, idx) => {
      const indestructible =
        p.kind === "subway_train" || p.kind === "mri_scanner" || p.kind === "transformer";
      const hp = indestructible
        ? 999999
        : p.kind === "glass_window"
          ? 24
          : p.kind === "cart_clutter"
            ? 34
            : p.kind === "clothes_rack"
              ? 44
              : p.kind === "round_table"
                ? 56
                : p.kind === "seat_row" || p.kind === "cinema_seats" || p.kind === "turnstile_row"
                  ? 66
                  : p.kind === "vending"
                    ? 74
                    : p.kind === "booth_table" || p.kind === "sofa_l" || p.kind === "hospital_bed"
                      ? 80
                      : p.kind === "planter" || p.kind === "surgical_set" || p.kind === "checkout"
                        ? 94
                        : 115;
      const blocksBulletsFull =
        indestructible ||
        p.kind === "glass_window" ||
        p.kind === "shelf_aisle" ||
        p.kind === "vending";
      const material: DestructiblePropState["material"] =
        p.kind === "glass_window"
          ? "glass"
          : p.kind === "round_table" || p.kind === "booth_table" || p.kind === "checkout" || p.kind === "sofa_l"
            ? "wood"
            : p.kind === "planter"
              ? "stone"
              : p.kind === "hospital_bed" || p.kind === "clothes_rack" || p.kind === "cinema_seats"
                ? "fabric"
                : "metal";
      return {
        ...p,
        id: idx + 1,
        hp,
        maxHp: hp,
        intact: true,
        indestructible,
        blocksBulletsFull,
        hitFlash: 0,
        shakeX: 0,
        shakeY: 0,
        material,
      };
    });
  }

  rayRectDist(
    ox: number,
    oy: number,
    ux: number,
    uy: number,
    maxDist: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
  ): number {
    const invX = Math.abs(ux) > 1e-6 ? 1 / ux : ux >= 0 ? 1e9 : -1e9;
    const invY = Math.abs(uy) > 1e-6 ? 1 / uy : uy >= 0 ? 1e9 : -1e9;
    const tx1 = (rx - ox) * invX;
    const tx2 = (rx + rw - ox) * invX;
    const ty1 = (ry - oy) * invY;
    const ty2 = (ry + rh - oy) * invY;
    const tmin = Math.max(Math.min(tx1, tx2), Math.min(ty1, ty2));
    const tmax = Math.min(Math.max(tx1, tx2), Math.max(ty1, ty2));
    if (tmax < 1.0 || tmin > tmax || tmin >= maxDist) return maxDist;
    return tmin >= 1.0 ? tmin : maxDist;
  }

  private resolveCircleRect(
    dot: { x: number; y: number; r: number },
    rx: number,
    ry: number,
    rw: number,
    rh: number,
    pad = 1.2,
  ): boolean {
    const minR = dot.r + pad;
    const cx = clamp(dot.x, rx, rx + rw);
    const cy = clamp(dot.y, ry, ry + rh);
    const dx = dot.x - cx;
    const dy = dot.y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minR * minR) return false;

    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = minR - d;
      dot.x += (dx / d) * push;
      dot.y += (dy / d) * push;
    } else {
      const dLeft = dot.x - rx;
      const dRight = rx + rw - dot.x;
      const dTop = dot.y - ry;
      const dBot = ry + rh - dot.y;
      const m = Math.min(dLeft, dRight, dTop, dBot);
      if (m === dLeft) dot.x = rx - minR;
      else if (m === dRight) dot.x = rx + rw + minR;
      else if (m === dTop) dot.y = ry - minR;
      else dot.y = ry + rh + minR;
    }
    return true;
  }

  isPointInsideObstacle(x: number, y: number, pad = 10): boolean {
    for (let i = 0; i < this.pillars.length; i++) {
      const pl = this.pillars[i];
      if (x > pl.x - pad && x < pl.x + pl.w + pad && y > pl.y - pad && y < pl.y + pl.h + pad) {
        return true;
      }
    }
    for (let i = 0; i < this.pits.length; i++) {
      const pt = this.pits[i];
      if (x > pt.x - pad && x < pt.x + pt.w + pad && y > pt.y - pad && y < pt.y + pt.h + pad) {
        return true;
      }
    }
    for (let i = 0; i < this.props.length; i++) {
      const pr = this.props[i];
      if (!pr.intact) continue;
      if (x > pr.x - pad && x < pr.x + pr.w + pad && y > pr.y - pad && y < pr.y + pr.h + pad) {
        return true;
      }
    }
    return false;
  }

  private resolvePropAndPillarCollisions(
    dot: { x: number; y: number; r: number },
    bashDmg: number,
    dirX: number,
    dirY: number,
  ): void {
    for (let i = 0; i < this.pillars.length; i++) {
      const pl = this.pillars[i];
      this.resolveCircleRect(dot, pl.x, pl.y, pl.w, pl.h, 1.4);
    }
    for (let i = 0; i < this.props.length; i++) {
      const pr = this.props[i];
      if (!pr.intact) continue;
      const touched = this.resolveCircleRect(dot, pr.x, pr.y, pr.w, pr.h, 1.2);
      if (touched && bashDmg > 0 && !pr.indestructible) {
        this.damageProp(pr, bashDmg, dirX, dirY);
      }
    }
  }

  damageProp(prop: DestructiblePropState, dmg: number, ux: number, uy: number): void {
    if (!prop.intact) return;
    const cx = prop.x + prop.w * 0.5;
    const cy = prop.y + prop.h * 0.5;
    if (prop.indestructible) {
      if (this.tick % 4 === 0) {
        this.spawnImpactParticles(cx, cy, ux, uy, "spark", 1);
      }
      return;
    }

    prop.hp -= dmg;
    prop.hitFlash = 1.0;
    const h1 = ((this.tick * 53 + prop.id * 31) % 100) / 50 - 1;
    const h2 = ((this.tick * 29 + prop.id * 17) % 100) / 50 - 1;
    prop.shakeX = h1 * 2.8;
    prop.shakeY = h2 * 2.8;

    // 受击即时崩飞细小木屑/玻璃碴/火花
    if (this.debris.length < 180 && this.tick % 2 === 0) {
      this.spawnPropDebris(prop, ux, uy, 2);
    }

    if (prop.hp <= 0) {
      prop.intact = false;
      prop.hp = 0;
      prop.shakeX = 0;
      prop.shakeY = 0;
      this.propsDestroyed++;
      this.navObstaclesDirty = true;

      this.addTrauma(prop.material === "glass" ? 0.14 : 0.22);
      this.emitAudio(
        prop.material === "glass" ? "glass-break" : "prop-smash",
        prop.material === "glass" ? 0.78 : 0.74,
        0.92 + ((prop.id % 5) * 0.05),
        cx,
      );
      if (prop.kind === "vending") {
        this.rings.push({ x: cx, y: cy, maxR: 48, ttl: 14, maxTtl: 14, kind: "sonar" });
        this.spawnImpactParticles(cx, cy, ux, uy, "spark", 8);
      } else if (prop.material === "glass") {
        this.rings.push({ x: cx, y: cy, maxR: 42, ttl: 10, maxTtl: 10, kind: "rescue" });
      }
      this.spawnPropDebris(prop, ux, uy, prop.material === "glass" ? 16 : 13);
    }
  }

  private spawnPropDebris(prop: DestructiblePropState, ux: number, uy: number, count: number): void {
    const baseAng = Math.atan2(uy || -1, ux || 0);
    for (let k = 0; k < count; k++) {
      if (this.debris.length >= 220) break;
      const hA = ((this.tick * 37 + prop.id * 23 + k * 41) % 100) / 100;
      const hB = ((this.tick * 19 + prop.id * 59 + k * 71) % 100) / 100;
      const hC = ((this.tick * 83 + prop.id * 13 + k * 29) % 100) / 100;
      const sx = prop.x + hA * prop.w;
      const sy = prop.y + hB * prop.h;
      const ang = baseAng + (hC - 0.5) * 2.8;
      const spd = 1.6 + hA * 4.2;
      let col: [number, number, number, number] = [138, 102, 64, 245];
      let shape: DebrisShard["shape"] = "plank";
      let len = 8 + hB * 7;
      let wid = 2.6;

      if (prop.material === "glass") {
        col = k % 2 === 0 ? [185, 240, 255, 240] : [115, 205, 245, 225];
        shape = "glass";
        len = 6 + hB * 6;
        wid = 2.2;
      } else if (prop.kind === "shelf_aisle" || prop.kind === "vending") {
        const goodsPalette: Array<[number, number, number, number]> = [
          [225, 68, 58, 245],
          [65, 165, 235, 245],
          [235, 185, 52, 245],
          [72, 195, 122, 245],
          [148, 162, 178, 245],
        ];
        col = goodsPalette[k % goodsPalette.length];
        shape = k % 3 === 0 ? "plank" : "box";
        len = 5 + hB * 4;
        wid = 4.2;
      } else if (prop.material === "wood") {
        col =
          prop.kind === "round_table" && k % 5 === 0
            ? [225, 232, 240, 245] // 摔碎的白色瓷餐盘碎片！
            : k % 2 === 0
              ? [142, 98, 58, 248]
              : [98, 66, 40, 245];
        shape = "plank";
        len = 8 + hB * 7;
        wid = 2.8;
      } else if (prop.material === "stone") {
        col = k % 2 === 0 ? [56, 162, 88, 245] : [118, 126, 138, 245];
        shape = k % 2 === 0 ? "plank" : "box";
        len = 7 + hB * 5;
        wid = 3.2;
      } else if (prop.material === "fabric") {
        col = k % 2 === 0 ? [195, 212, 230, 240] : [85, 138, 182, 240];
        shape = "box";
        len = 6 + hB * 5;
        wid = 3.6;
      } else {
        col = k % 2 === 0 ? [142, 156, 175, 245] : [88, 98, 114, 245];
        shape = "plank";
        len = 8 + hB * 6;
        wid = 2.5;
      }

      const ttl = 18 + Math.floor(hC * 16);
      this.debris.push({
        x: sx,
        y: sy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        rot: hA * Math.PI * 2,
        vrot: (hB >= 0.5 ? 1 : -1) * (0.22 + hC * 0.36),
        len,
        wid,
        color: col,
        ttl,
        maxTtl: ttl,
        shape,
      });
    }
  }

  private initTacticalNodes(): void {
    const specs = getTacticalNodeSpecs(this.mode);
    this.nodes = specs.map(s => {
      const clean = this.sanitizeSpawnPoint(s.x, s.y, s.r + 2);
      return {
        ...s,
        x: clean.x,
        y: clean.y,
        rot: s.rot ?? 0,
        maxHp: s.hp,
        ghostHp: s.hp,
        broken: false,
        hitFlash: 0,
        breachProgress: 0,
        openAnim: 0,
      };
    });
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

  addTrauma(amount: number): void {
    this.camTrauma = Math.min(1.0, this.camTrauma + amount);
  }

  private spawnShellCasing(x: number, y: number, ux: number, uy: number, heavy: boolean): void {
    if (this.shells.length > 85) return;
    // 向枪机右侧后方高速抛射旋转黄铜弹壳（纯确定性哈希扰动，零 RNG 消耗）
    const h1 = ((this.tick * 73 + Math.round(x) * 19) % 100) / 100 - 0.5;
    const h2 = ((this.tick * 41 + Math.round(y) * 29) % 100) / 100;
    const ejectX = -uy;
    const ejectY = ux;
    const spd = (heavy ? 3.4 : 2.5) + h2 * 1.4;
    this.shells.push({
      x: x - ux * 4 + ejectX * 4,
      y: y - uy * 4 + ejectY * 4,
      vx: ejectX * spd - ux * (0.8 + h2 * 0.7) + h1 * 0.9,
      vy: ejectY * spd - uy * (0.8 + h2 * 0.7) + h1 * 0.9,
      rot: h2 * Math.PI * 2,
      vrot: (h1 >= 0 ? 1 : -1) * (0.35 + h2 * 0.35),
      ttl: heavy ? 22 : 16,
      maxTtl: heavy ? 22 : 16,
      heavy,
    });
  }

  private emitAudio(
    kind: SiegeAudioEvent["kind"],
    gain = 1,
    pitch = 1,
    worldX = CORRIDOR_CX,
  ): void {
    const pan = clamp((worldX - CORRIDOR_CX) / 620, -0.78, 0.78);
    this.audioEvents.push({
      timeSec: this.tick / SIM_HZ,
      kind,
      gain,
      pitch,
      pan,
    });
  }

  /**
   * 确保出生点绝不位于封闭天井、承重柱、完好家具刚体或死角隔墙内部，从源头杜绝穿模或出生弹飞
   */
  private sanitizeSpawnPoint(rawX: number, rawY: number, r: number): { x: number; y: number } {
    const y = clamp(rawY, r + 32, WORLD_H - 42 - r);
    const b = getCorridorBounds(y, this.mode);
    const x = clamp(rawX, b.left + r + 14, b.right - r - 14);

    const dummy = { x, y, r };
    for (let iter = 0; iter < 4; iter++) {
      for (const pt of this.pits) {
        this.resolveCircleRect(dummy, pt.x, pt.y, pt.w, pt.h, 2.5);
      }
      for (const pl of this.pillars) {
        this.resolveCircleRect(dummy, pl.x, pl.y, pl.w, pl.h, 2.0);
      }
      for (const pr of this.props) {
        if (!pr.intact) continue;
        this.resolveCircleRect(dummy, pr.x, pr.y, pr.w, pr.h, 2.0);
      }
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
   * 构建 2D 科学寻路网格障碍表（外墙以外、下沉天井、混凝土柱、大型完好家具及死角隔墙标记为不可通行，家具破碎后实时自动打通！）
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
        let blocked = false;
        for (let i = 0; i < this.pits.length; i++) {
          const pt = this.pits[i];
          if (cx >= pt.x - 10 && cx <= pt.x + pt.w + 10 && cy >= pt.y - 10 && cy <= pt.y + pt.h + 10) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (let i = 0; i < this.pillars.length; i++) {
            const pl = this.pillars[i];
            if (cx >= pl.x - 10 && cx <= pl.x + pl.w + 10 && cy >= pl.y - 10 && cy <= pl.y + pl.h + 10) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked) {
          for (let i = 0; i < this.props.length; i++) {
            const pr = this.props[i];
            if (!pr.intact) continue;
            // 玻璃屏风与小型手推车可被尸群直接撞碎突破，其余完好大型家具纳入寻路绕行障碍
            if (pr.kind === "glass_window" || pr.kind === "cart_clutter") continue;
            if (cx >= pr.x - 8 && cx <= pr.x + pr.w + 8 && cy >= pr.y - 8 && cy <= pr.y + pr.h + 8) {
              blocked = true;
              break;
            }
          }
        }
        if (blocked) {
          this.navBlocked[gy * NAV_COLS + gx] = 1;
          continue;
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
   * 2D 动态战术变焦 + 平滑镜头跟随（开场 2.08x 特写放大巨型载具突击 -> 中期 1.44x 压迫感近景切角搜迷宫 -> 终局拉远至 1.04x 全景决战母巢！）
   */
  private updateCamera(snap = false): void {
    const tSec = this.tick / SIM_HZ;
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

    // 计算当前阶段理想镜头缩放倍率 camZoom：
    // 1) t=0..3.2s：2.08x（双黑鹰 1.72x / 三大巴 1.38x）近景特写放大重型载具机炮火箭洗地，绝不一上来拉到最远！
    // 2) t=3.2..6.2s：平滑退至 1.48x 近距离观看开门/索降下车与首个 90° 拐角破门；
    // 3) 中段迷宫走廊 (squadCenterY > 860)：维持 1.32x..1.45x 幽闭近景，让墙壁死角遮蔽大半屏幕，感染瞬间触发 +0.09x 惊悚变焦冲击！
    // 4) 突入北部母巢大厅 (squadCenterY <= 860)：恢弘拉远至 1.04x 展现巨型母巢与两百尸潮终局大战！
    const entryZoom =
      this.mode === "maze-infect" ? 1.38 : this.mode === "sonar" ? 1.72 : 2.08;
    let targetZoom = 1.05;
    if (tSec < 3.25) {
      targetZoom = entryZoom - (tSec / 3.25) * 0.1;
    } else if (tSec < 6.0) {
      const p = (tSec - 3.25) / 2.75;
      targetZoom = (entryZoom - 0.1) * (1 - p) + 1.48 * p;
    } else if (this.squadCenterY > 860 && tSec < 28.5) {
      const armyPullback = Math.min(0.14, Math.max(0, this.greens.length - 6) * 0.007);
      targetZoom = 1.45 - armyPullback + this.infectionFlash * 0.09;
    } else {
      targetZoom = 1.04 + this.infectionFlash * 0.05;
    }
    targetZoom = clamp(targetZoom, 1.0, 2.15);

    if (snap) {
      this.camZoom = targetZoom;
    } else {
      this.camZoom += (targetZoom - this.camZoom) * 0.065;
    }

    const viewW = ARENA_W / this.camZoom;
    const viewH = ARENA_H / this.camZoom;

    // 镜头前瞻：开场将载具置于画面中下 1/3 处展现前向重火力；进入迷宫后顺着行进方向 (东/西/北) 前瞻照射前方 90° 盲区拐角！
    const lookX =
      tSec < 3.5 ? 0 : Math.cos(this.squadMoveAngle) * (120 / Math.max(1, this.camZoom * 0.85));
    const lookY =
      tSec < 3.5 ? -105 : Math.sin(this.squadMoveAngle) * (135 / Math.max(1, this.camZoom * 0.85));
    const targetCamX = clamp(focusX + lookX - viewW * 0.5, 0, WORLD_W - viewW);
    const targetCamY = clamp(focusY + lookY - viewH * 0.5, 0, WORLD_H - viewH);

    if (snap) {
      this.camX = targetCamX;
      this.camY = targetCamY;
      this.camShakeX = 0;
      this.camShakeY = 0;
    } else {
      this.camX += (targetCamX - this.camX) * 0.095;
      this.camY += (targetCamY - this.camY) * 0.095;
      if (this.camTrauma > 0.005) {
        const shakeAmp = (this.camTrauma * this.camTrauma * 11.5) / this.camZoom;
        this.camShakeX = Math.sin(this.tick * 2.35) * shakeAmp;
        this.camShakeY = Math.cos(this.tick * 3.15) * shakeAmp;
        this.camTrauma = Math.max(0, this.camTrauma - 0.042);
      } else {
        this.camTrauma = 0;
        this.camShakeX = 0;
        this.camShakeY = 0;
      }
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
        for (let k = 0; k < 18; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            lx + (this.rng() - 0.5) * 62,
            2240 + (k / 18) * 540 + (this.rng() - 0.5) * 18,
          );
          z.hp = 165;
          z.maxHp = 165;
          z.ghostHp = 165;
        }
      }
    } else {
      const openCount = this.mode === "sonar" ? 56 : 48;
      const openHp = this.mode === "sonar" ? 205 : 140;
      for (let k = 0; k < openCount; k++) {
        const y = 2385 + (k / openCount) * 435 + (this.rng() - 0.5) * 16;
        const b = getCorridorBounds(y, this.mode);
        const x = b.cx + (this.rng() - 0.5) * Math.min(230, b.halfW * 1.05);
        const z = this.spawnRedDot(k % 3 === 0 ? "runner" : "walker", x, y);
        z.hp = openHp;
        z.maxHp = openHp;
        z.ghostHp = openHp;
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

    // 各大真实室内建筑模式专属【对侧店铺与盲区房间伏击尸群】（潜伏在未照亮商铺/诊室/贵宾厅内，小队靠近或开火时从侧门蜂拥扑出！）：
    if (this.mode === "scavenge") {
      const pockets = [
        { x: 1380, y: 2150, n: 12 }, // 东南数码旗舰店 E1 盲区
        { x: 405, y: 1710, n: 12 },  // 西中段精品店盲区
        { x: 1380, y: 1050, n: 13 }, // 东北影院门厅 E3 盲区
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 95,
            p.y + (this.rng() - 0.5) * 85,
          );
          z.cornerAmbush = true;
        }
      }
    } else if (this.mode === "blackout") {
      const pockets = [
        { x: 440, y: 2160, n: 12 },  // 西侧站厅便利店盲区
        { x: 1340, y: 1640, n: 13 }, // 东侧地下拱廊盲区
        { x: 440, y: 1180, n: 13 },  // 西北换乘暗角盲区
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 90,
            p.y + (this.rng() - 0.5) * 85,
          );
          z.cornerAmbush = true;
        }
      }
    } else if (this.mode === "sonar") {
      // 医院各科室与病房盲区潜伏红眼沉睡丧尸 (dormant = true)
      const pockets = [
        { x: 1380, y: 2160, n: 13 }, // 东候诊病房沉睡尸群
        { x: 410, y: 1710, n: 13 },  // 西住院走廊沉睡尸群
        { x: 410, y: 1260, n: 13 },  // 西核磁影像科沉睡尸群
        { x: 1380, y: 920, n: 13 },  // 东北隔离血库沉睡尸群
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 90,
            p.y + (this.rng() - 0.5) * 80,
          );
          z.dormant = true;
        }
      }
    } else if (this.mode === "maze-infect") {
      // 航站楼安检口与贵宾厅预置等身已感染警卫丧尸（绝不膨胀成小Boss！）+ 盲区尸群伏击！
      for (const [ex, ey] of [
        [565, 2240],
        [1235, 2240],
        [1355, 1740],
        [435, 1300],
      ] as const) {
        const elite = this.spawnRedDot("infected_elite", ex, ey);
        elite.hp = 42;
        elite.maxHp = 42;
        elite.ghostHp = 42;
        elite.cornerAmbush = ey < 2000;
      }
      const pockets = [
        { x: 565, y: 2180, n: 4, ambush: false },
        { x: 955, y: 2180, n: 5, ambush: false },
        { x: 1235, y: 2180, n: 4, ambush: false },
        { x: 1360, y: 1710, n: 11, ambush: true },
        { x: 435, y: 1280, n: 11, ambush: true },
        { x: 1360, y: 890, n: 11, ambush: true },
      ];
      for (const p of pockets) {
        for (let k = 0; k < p.n; k++) {
          const z = this.spawnRedDot(
            k % 3 === 0 ? "runner" : "walker",
            p.x + (this.rng() - 0.5) * 75,
            p.y + (this.rng() - 0.5) * 70,
          );
          if (p.ambush) z.cornerAmbush = true;
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
          ? 7.4
          : isRunner
            ? 5.6
            : 6.2;

    const maxHp = isBoss
      ? (bossSpec?.hp ?? 1500)
      : isCarrier
        ? 220
        : isInfected
          ? 42
          : isRunner
            ? 25
            : 35;

    const speed = isBoss
      ? (bossSpec?.speed ?? 1.45)
      : isCarrier
        ? 1.38
        : isInfected
          ? 1.76
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

    // 自然战争迷雾：放宽单兵柔光扇面角 (~68°~73° 广角柔光)，消除生硬窄手电筒割裂感！
    const flashHalfFov = this.blackoutActive ? 0.58 : 0.64;

    for (let i = 0; i < this.greens.length; i++) {
      const g = this.greens[i];
      const baseRange =
        g.role === "shotgun"
          ? 295
          : g.role === "sniper"
            ? 410
            : g.role === "turret"
              ? 385
              : 355;
      this.lightCones.push({
        x: g.x,
        y: g.y,
        angle: g.aimAngle,
        halfFov: g.role === "turret" ? 0.54 : flashHalfFov,
        range: this.blackoutActive ? Math.round(baseRange * 0.9) : baseRange,
        intensity: this.blackoutActive ? 1.04 : 1.08,
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

    // blackout 断电探照灯模式：在地铁站厅与变电室各矗立一座双头旋转工业探照灯塔（断电惊魂窗口同时熄灭！）
    if (this.mode === "blackout" && !this.blackoutActive) {
      const towers = [
        { x: 1355, y: 2060, dir: 1 },
        { x: 445, y: 1950, dir: -1 },
        { x: 1355, y: 1140, dir: -1 },
        { x: 900, y: 780, dir: 1 },
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
      if ((r.mutatingTicks ?? 0) > 0) continue;
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
    if (this.infectionFlash > 0) this.infectionFlash = Math.max(0, this.infectionFlash - 0.032);
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

    for (let pi = 0; pi < this.props.length; pi++) {
      const pr = this.props[pi];
      if (pr.hitFlash > 0) pr.hitFlash = Math.max(0, pr.hitFlash - 0.18);
      pr.shakeX *= 0.62;
      pr.shakeY *= 0.62;
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

    // 2. 重建空间哈希网格与全图科学 BFS 寻路流场（若有家具刚刚破碎，立即动态更新障碍表打通通路！）
    this.rebuildSpatialGrid();
    if (this.navObstaclesDirty) {
      this.navObstaclesDirty = false;
      this.initNavObstacles();
      this.updateNavFlowField();
    } else if (this.tick % 6 === 1) {
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

    // 5. 更新机载破片火箭弹、旋转抛壳弹壳、粒子、光环与飘字
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const rk = this.rockets[i];
      rk.prevX = rk.x;
      rk.prevY = rk.y;
      rk.x += rk.vx;
      rk.y += rk.vy;
      rk.ttl--;
      if (this.tick % 2 === 0) {
        this.spawnImpactParticles(rk.x, rk.y, rk.vx, rk.vy, "gold", 1);
      }
      if (rk.ttl <= 0 || Math.hypot(rk.targetX - rk.x, rk.targetY - rk.y) <= 16) {
        const rx = rk.x;
        const ry = rk.y;
        this.rings.push({ x: rx, y: ry, maxR: 76, ttl: 16, maxTtl: 16, kind: "hive-kill" });
        this.pendingDecals.push({ kind: "scorch", x: rx, y: ry, r: 26, seed: this.tick + i });
        this.spawnImpactParticles(rx, ry, 0, -1, "gold", 9);
        this.spawnImpactParticles(rx, ry, 0, 1, "blood", 6);
        this.addTrauma(0.38);
        this.emitAudio("rocket-blast", 0.72, 0.86 + (i % 3) * 0.08, rx);
        for (let ri = this.reds.length - 1; ri >= 0; ri--) {
          const r = this.reds[ri];
          if (r.kind !== "boss" && Math.hypot(r.x - rx, r.y - ry) <= 64) {
            r.hp -= 105;
            r.hitFlash = 1.0;
            if (r.hp <= 0) {
              this.killRedDot(ri, tSec);
            }
          }
        }
        for (let pi = 0; pi < this.props.length; pi++) {
          const pr = this.props[pi];
          if (!pr.intact || pr.indestructible) continue;
          const cx = clamp(rx, pr.x, pr.x + pr.w);
          const cy = clamp(ry, pr.y, pr.y + pr.h);
          if (Math.hypot(cx - rx, cy - ry) <= 88) {
            this.damageProp(pr, 120, cx - rx, cy - ry);
          }
        }
        this.rockets.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const db = this.debris[i];
      db.x += db.vx;
      db.y += db.vy;
      db.vx *= 0.87;
      db.vy *= 0.87;
      db.rot += db.vrot;
      db.vrot *= 0.92;
      db.ttl--;
      if (db.ttl <= 0) this.debris.splice(i, 1);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.vx *= 0.86;
      sh.vy = sh.vy * 0.86 + 0.14;
      sh.rot += sh.vrot;
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
      const rg = this.rings[i];
      if (rg.kind === "sonar") {
        const curR = 14 + (1 - rg.ttl / rg.maxTtl) * rg.maxR;
        for (let ri = 0; ri < this.reds.length; ri++) {
          const z = this.reds[ri];
          const d = Math.hypot(z.x - rg.x, z.y - rg.y);
          if (Math.abs(d - curR) <= 30) {
            z.sonarPingTicks = Math.max(z.sonarPingTicks ?? 0, 46);
          }
        }
      }
      rg.ttl--;
      if (rg.ttl <= 0) this.rings.splice(i, 1);
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

    // 2. 母巢核心与前方未清理战区持续涌出尸潮（中段保持科学密度使小队清完每间密室/反应堆后能一路推进 2200px 直抵北部母巢腔体！）
    const overrun = this.isOverrunMode();
    const overrunCollapseActive = overrun && this.finalWaveTriggered;
    const maxActiveReds =
      tSec < 3.2
        ? 165
        : overrunCollapseActive
          ? 215
          : tSec < 24.5
            ? 92
            : tSec < 31.8
              ? 78
              : 0;
    const spawnModulo = tSec < 3.2 || overrunCollapseActive ? 2 : tSec < 31.8 ? 4 : 10;
    if (this.reds.length < maxActiveReds && this.tick % spawnModulo === 0) {
      const spawnsPerStep =
        tSec < 3.2 ? 3 : overrunCollapseActive ? 5 : tSec < 24.5 ? 2 : tSec < 31.8 ? 1 : 0;
      for (let s = 0; s < spawnsPerStep; s++) {
        if (tSec < 3.05 && this.vehicles.length > 0) {
          const v = this.vehicles[s % this.vehicles.length];
          const rawY = clamp(v.y - 195 - this.rng() * 85, 2385, 2680);
          const b = getCorridorBounds(rawY, this.mode);
          const spawnX =
            this.mode === "maze-infect"
              ? v.x + (this.rng() - 0.5) * 68
              : b.cx + (this.rng() * 2 - 1) * Math.min(220, b.halfW - 45);
          this.spawnRedDot(s % 2 === 0 ? "runner" : "walker", spawnX, rawY);
          continue;
        }
        const fromFrontSector =
          !overrunCollapseActive && s === 1 && this.tick % 8 === 0 && this.squadCenterY > 1150;
        const rawY = overrunCollapseActive
          ? Math.max(290, this.squadCenterY - 260 - this.rng() * 110)
          : fromFrontSector
            ? Math.max(300, this.squadCenterY - 560 - this.rng() * 180)
            : this.hive.y + this.hive.r + 20 + this.rng() * 85;
        const b = getCorridorBounds(rawY, this.mode);
        const spawnX = b.cx + (this.rng() * 2 - 1) * Math.max(40, b.halfW - 45);
        const isRunner = tSec > 2.5 && this.rng() < (overrunCollapseActive ? 0.75 : 0.38);
        this.spawnRedDot(isRunner ? "runner" : "walker", spawnX, rawY);
      }
    }

    // 2b. 各大模式专属差异化核心机制导演事件：
    // (a) blackout 地铁站动态拉闸断电模式：
    //     0~10.3s 地铁站正常荧光灯明亮供电 -> 10.3~11.5s 变电站过载电弧频闪 -> 11.5s 彻底拉闸断电坠入自然战争迷雾！
    if (this.mode === "blackout") {
      if (tSec < 10.3) {
        this.metroPowerLevel = 1.0;
        this.blackoutActive = false;
      } else if (tSec < 11.5) {
        const fPhase = (tSec - 10.3) / 1.2;
        const stutter = Math.sin(fPhase * 42) + 0.5 * Math.cos(fPhase * 91);
        this.metroPowerLevel = stutter > 0.15 ? 0.88 - fPhase * 0.25 : 0.08;
        if (this.tick % 14 === 0) {
          this.alarmFlash = Math.max(this.alarmFlash, 0.55);
          this.spawnImpactParticles(this.squadCenterX + (this.tick % 2 === 0 ? -95 : 95), this.squadCenterY - 80, 0, 1, "spark", 5);
        }
      } else {
        if (!this.blackoutTriggered) {
          this.blackoutTriggered = true;
          this.blackoutActive = true;
          this.metroPowerLevel = 0.0;
          this.alarmFlash = 1.0;
          this.addTrauma(0.52);
          this.emitAudio("power-down", 0.96, 0.85);
          this.triggerFrontlineFrenzyAmbush(3, 980);
        }
        // 31.2s 闯入北部终点折返车库后微弱红色应急备用灯亮起，确保终局母巢决战视觉层次分明
        this.metroPowerLevel = tSec >= 31.2 ? Math.min(0.36, (tSec - 31.2) / 3.2 * 0.36) : 0.0;
      }
    }

    // (b) sonar 深层隔离医院声呐潜行模式：每 1.13s 发射青色超声波扫描环，穿墙点亮暗室沉睡尸潮回波轮廓！
    if (this.mode === "sonar" && this.tick % 68 === 10) {
      this.rings.push({
        x: this.squadCenterX,
        y: this.squadCenterY - 24,
        maxR: 640,
        ttl: 42,
        maxTtl: 42,
        kind: "sonar",
      });
      this.emitAudio("sonar-ping", 0.36, 1.02, this.squadCenterX);
    }

    // (c) maze-infect 三通道生化监狱模式：在 t=8.5s 三支小队冲出 A/B/C 三道监区竖墙，在中庭检疫广场完成汇合！
    if (this.mode === "maze-infect" && !this.mazeLinkedUp && tSec >= 8.5) {
      this.mazeLinkedUp = true;
      this.emitAudio("adrenaline", 0.88, 1.04);
    }

    // (d) 真实铁笼逐个破锁解救机制 (`囚笼+1`)：
    //     - 已破锁的铁笼平滑推开铁栏门扇 (`openAnim: 0 -> 1`) 并永久保留在房间地面上；
    //     - 小队抵近未破锁铁笼 (<= 245px 且无墙阻挡) 时，精准切开挂锁放出 1 名被困幸存者！
    let activeLocksThisTick = 0;
    for (let ni = 0; ni < this.nodes.length; ni++) {
      const node = this.nodes[ni];
      if (node.broken) {
        if (node.openAnim < 1.0) {
          node.openAnim = Math.min(1.0, node.openAnim + 0.11);
        }
        continue;
      }
      if (activeLocksThisTick >= 2) continue;

      let nearOperators = 0;
      for (let gi = 0; gi < this.greens.length; gi++) {
        const g = this.greens[gi];
        if (
          Math.hypot(g.x - node.x, g.y - node.y) <= 245 &&
          this.hasLineOfSight(g.x, g.y, node.x, node.y)
        ) {
          nearOperators++;
        }
      }
      const centerDist = Math.hypot(this.squadCenterX - node.x, this.squadCenterY - node.y);
      const centerHasLos =
        centerDist <= 205 &&
        this.hasLineOfSight(this.squadCenterX, this.squadCenterY, node.x, node.y);
      if (nearOperators > 0 || centerHasLos) {
        activeLocksThisTick++;
        if (centerDist <= 175 && node.breachProgress < 0.85) {
          this.holdForRescueTicks = Math.max(this.holdForRescueTicks, 4);
        }
        const baseTicks = node.kind === "bunker_pad" ? 64 : 36;
        const speedBoost = Math.min(1.32, 0.88 + nearOperators * 0.08);
        node.breachProgress = Math.min(1.0, node.breachProgress + (1 / baseTicks) * speedBoost);
        node.hp = Math.max(0, node.maxHp * (1 - node.breachProgress));
        node.hitFlash = Math.max(node.hitFlash, 0.45);
        if (this.tick % 6 === 0) {
          this.spawnImpactParticles(node.x, node.y, 0, -1, "gold", 2);
        }
        if (node.breachProgress >= 1.0) {
          this.triggerNodeShatter(node);
        }
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

    // 7. 终局高潮分流（50% 惨胜破巢 vs 50% 尸潮反扑全军覆没，严格等待大军杀入北部母巢核心室 squadCenterY <= 520 后触发！）：
    if (this.squadCenterY <= 520 && this.hiveHallEnteredSec < 0) {
      this.hiveHallEnteredSec = tSec;
    }

    if (overrun) {
      // 【Near-Win Fail-Ad 功败垂成剧本 (blackout / maze-infect)】：
      // 先放任人类大军完成全部 3 个商铺救援并冲入母巢大厅集火约 2.6 秒把母巢打到半血以下，随后母巢暴走掀起终极反扑浪潮将全军同化！
      const nearWinTrigger =
        (this.hiveHallEnteredSec > 0 &&
          (tSec - this.hiveHallEnteredSec >= 2.6 || this.hive.hp <= this.hive.maxHp * 0.46)) ||
        tSec >= 45.5;
      if (!this.finalWaveTriggered && nearWinTrigger) {
        this.finalWaveTriggered = true;
        this.alarmFlash = 1.0;
        this.addTrauma(0.58);
        this.emitAudio("breach", 0.96, 0.82, this.hive.x);
      }
      if (this.finalWaveTriggered && this.greens.length > 0 && this.tick - this.lastAttritionTick >= 8) {
        this.lastAttritionTick = this.tick;
        const anchorG = this.greens[Math.floor(this.tick / 8) % this.greens.length];
        let closeCount = 0;
        for (const r of this.reds) {
          if (
            r.kind !== "boss" &&
            Math.hypot(r.x - anchorG.x, r.y - anchorG.y) <= 290 &&
            this.hasLineOfSight(r.x, r.y, anchorG.x, anchorG.y)
          ) {
            closeCount++;
          }
        }
        if (closeCount < 14) {
          for (const side of [-78, -26, 26, 78]) {
            const useAnchor = Math.abs(side) === 26;
            let sx = (useAnchor ? anchorG.x : this.squadCenterX) + side;
            let sy = Math.max(285, (useAnchor ? anchorG.y : this.squadCenterY) - 155);
            if (useAnchor && !this.hasLineOfSight(sx, sy, anchorG.x, anchorG.y)) {
              for (let aIdx = 0; aIdx < 8; aIdx++) {
                const ang = (aIdx * Math.PI) / 4;
                const tx = anchorG.x + Math.cos(ang) * 145;
                const ty = anchorG.y + Math.sin(ang) * 145;
                if (this.hasLineOfSight(tx, ty, anchorG.x, anchorG.y)) {
                  sx = tx;
                  sy = ty;
                  break;
                }
              }
            }
            const rz = this.spawnRedDot("runner", sx, sy);
            rz.hp = 960;
            rz.maxHp = 960;
            rz.ghostHp = 960;
          }
        }
        this.triggerFrontlineFrenzyAmbush(8, 3600);
      }
    } else {
      // 【人类惨胜剧本 (scavenge / sonar)】：杀入母巢大厅 (hiveHallEnteredSec > 0) 后母巢重甲卫队拼死反扑，将 26 人大军一路咬杀感染至仅剩 4 名孤胆残血英雄！
      if (!this.finalWaveTriggered && this.hiveHallEnteredSec > 0) {
        this.finalWaveTriggered = true;
        this.alarmFlash = 0.85;
      }
      const targetSurvivors = 4;
      if (
        this.hiveHallEnteredSec > 0 &&
        this.greens.length > targetSurvivors &&
        this.tick - this.lastAttritionTick >= 8
      ) {
        this.lastAttritionTick = this.tick;
        let closeCount = 0;
        for (const r of this.reds) {
          if (r.kind !== "boss" && Math.hypot(r.x - this.squadCenterX, r.y - this.squadCenterY) <= 360) {
            closeCount++;
          }
        }
        if (closeCount < 11) {
          for (const side of [-95, -32, 32, 95]) {
            const rz = this.spawnRedDot(
              "runner",
              this.squadCenterX + side,
              Math.max(285, this.squadCenterY - 180),
            );
            rz.hp = 920;
            rz.maxHp = 920;
            rz.ghostHp = 920;
          }
        }
        this.triggerFrontlineFrenzyAmbush(6, 3600);
      } else if (this.greens.length <= targetSurvivors) {
        // 当仅剩最后 4 名孤胆老兵时，立即解除残余小怪的狂暴冲刺并压低残血，确保最后几名幸存英雄浴血死战引爆母巢惨胜！
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
      if ((r.mutatingTicks ?? 0) > 0) continue;
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

      if (d.sonarPingTicks && d.sonarPingTicks > 0) {
        d.sonarPingTicks--;
      }

      // (a) 被咬感染后的 0.40s 原地抽搐等身尸变演出 (mutatingTicks > 0)：快速痉挛转化为普通等身尸变士兵，绝不膨胀成小Boss！
      if (d.mutatingTicks && d.mutatingTicks > 0) {
        d.mutatingTicks--;
        d.vx = 0;
        d.vy = 0;
        if (d.mutatingTicks === 0) {
          this.rings.push({ x: d.x, y: d.y, maxR: 46, ttl: 13, maxTtl: 13, kind: "casualty" });
          this.spawnImpactParticles(d.x, d.y, 0, -1, "bio", 5);
        }
        continue;
      }

      // (b) 声呐沉睡尸群 (dormant) 与 90° 盲区拐角伏击尸群 (cornerAmbush)：在小队抵近切角半径 (365px) 前潜伏在阴影墙后，切角瞬间暴起扑杀！
      if (d.dormant || d.cornerAmbush) {
        if (nearestGreenDist < 365) {
          d.dormant = false;
          d.cornerAmbush = false;
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

      // 室内完好家具与承重柱刚性碰撞（杜绝穿模！泰坦碾碎挡路家具，尸群抓挠猛砸阻路桌椅与玻璃屏风！）
      const bashDmg = d.kind === "boss" ? 18 : 1.8;
      this.resolvePropAndPillarCollisions(d, bashDmg, dirX, dirY);
      for (const pt of this.pits) {
        this.resolveCircleRect(d, pt.x, pt.y, pt.w, pt.h, 1.5);
      }

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
            // 重机枪碉堡具备装甲，受击扣血并刚性弹开丧尸（尸潮反扑终局阶段一击必破）
            g.hp -= this.isOverrunMode() && this.finalWaveTriggered ? 3 : 1;
            const nx = dist > 0.1 ? dx / dist : 0;
            const ny = dist > 0.1 ? dy / dist : -1;
            const push = touchDist - dist + 1.5;
            d.x += nx * push;
            d.y += ny * push;
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

    // 二次刚性无重叠消解：防止刚进入蛹化抽搐/保护帧的变异体在多人包夹时与相邻士兵产生任何几何重叠 (仅移动变异体，确保 jumpsOver5 === 0 且 postStepTouching === 0！)
    for (let iter = 0; iter < 8; iter++) {
      for (let ri = 0; ri < this.reds.length; ri++) {
        const d = this.reds[ri];
        if ((d.spawnGraceTicks ?? 0) <= 0 && (d.mutatingTicks ?? 0) <= 0) continue;
        for (let gi = 0; gi < this.greens.length; gi++) {
          const g = this.greens[gi];
          const dx = d.x - g.x;
          const dy = d.y - g.y;
          const dist = Math.hypot(dx, dy);
          const minSep = d.r + g.r + 1.6;
          if (dist < minSep) {
            const nx = dist > 0.05 ? dx / dist : Math.cos((ri + gi) * 1.9);
            const ny = dist > 0.05 ? dy / dist : -1;
            const overlap = minSep - dist + 0.5;
            d.x += nx * overlap;
            d.y += ny * overlap;
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
    this.alarmFlash = 1.0;
    this.infectionFlash = 1.0;
    this.addTrauma(0.38);
    this.emitAudio("infect-bite", 0.94, 1.0, g.x);

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

    // 4. 阵亡的人类士兵在被咬位置原地进入 0.40s 等身抽搐尸变 (mutatingTicks = 24)，转化为戴残破头盔的普通等身尸变士兵（绝不变成血牛小Boss！）
    const mutated = this.spawnRedDot("infected_elite", gx, gy);
    mutated.r = 7.4;
    const isLastStand = !this.isOverrunMode() && this.greens.length <= 6;
    mutated.hp = isLastStand ? 28 : 42;
    mutated.maxHp = mutated.hp;
    mutated.ghostHp = mutated.hp;
    mutated.vx = 0;
    mutated.vy = 0;
    mutated.mutatingTicks = isLastStand ? 18 : 24;
    mutated.spawnGraceTicks = isLastStand ? 46 : 40;
    for (let gi = 0; gi < this.greens.length; gi++) {
      const g2 = this.greens[gi];
      const mdx = mutated.x - g2.x;
      const mdy = mutated.y - g2.y;
      const mDist = Math.hypot(mdx, mdy);
      const minSep = mutated.r + g2.r + 1.8;
      if (mDist < minSep) {
        const nx = mDist > 0.1 ? mdx / mDist : Math.cos(gi * 1.7);
        const ny = mDist > 0.1 ? mdy / mDist : -1;
        mutated.x += nx * (minSep - mDist);
        mutated.y += ny * (minSep - mDist);
      }
    }
    mutated.prevX = mutated.x;
    mutated.prevY = mutated.y;
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
      maxR: 92,
      ttl: 24,
      maxTtl: 24,
      kind: "casualty",
    });
    this.pendingDecals.push({
      kind: "boss_blood",
      x: gx,
      y: gy,
      r: 22,
      seed: this.tick + greenIdx,
    });
    this.spawnImpactParticles(gx, gy, 0, 1, "bio", 14);
    this.spawnImpactParticles(gx, gy, 0, -1, "blood", 10);

    this.addBanner(gx, gy - 16, "-1", [255, 55, 185, 255]);
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

    // 将战术阵位 (slotX, slotY) 按当前迷宫行进方向角 squadMoveAngle 实时旋转（横穿东/西走廊时尖兵自动转向走廊前方切角！）
    const rot = this.squadMoveAngle + Math.PI * 0.5;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const rSlotX = g.slotX * cosR - g.slotY * sinR;
    const rSlotY = g.slotX * sinR + g.slotY * cosR;

    const baseGoalY = clamp(this.squadCenterY + rSlotY, 290, WORLD_H - 80);
    const b = getCorridorBounds(baseGoalY, this.mode);
    const baseGoalX = clamp(this.squadCenterX + rSlotX, b.left + 32, b.right - 32);

    // 若从 squadCenter 到该阵位点畅通无阻且不在墙体或完好家具内，直接使用该阵位
    const gx = clamp(Math.floor(baseGoalX / NAV_CELL), 0, NAV_COLS - 1);
    const gy = clamp(Math.floor(baseGoalY / NAV_CELL), 0, NAV_ROWS - 1);
    if (
      !this.navBlocked[gy * NAV_COLS + gx] &&
      !this.isPointInsideObstacle(baseGoalX, baseGoalY, g.r + 2.5) &&
      this.hasLineOfSight(this.squadCenterX, this.squadCenterY, baseGoalX, baseGoalY)
    ) {
      return { x: baseGoalX, y: baseGoalY };
    }

    // 若阵位点落在隔墙另一侧或完好家具内部，沿连线向 squadCenter 收缩直至落点完全合法无穿模！
    for (const scale of [0.72, 0.48, 0.28, 0.12]) {
      const tx = this.squadCenterX + (baseGoalX - this.squadCenterX) * scale;
      const ty = this.squadCenterY + (baseGoalY - this.squadCenterY) * scale;
      const tgx = clamp(Math.floor(tx / NAV_CELL), 0, NAV_COLS - 1);
      const tgy = clamp(Math.floor(ty / NAV_CELL), 0, NAV_ROWS - 1);
      if (
        !this.navBlocked[tgy * NAV_COLS + tgx] &&
        !this.isPointInsideObstacle(tx, ty, g.r + 2.5) &&
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

    // 1. 沿专属 90° 迷宫航点折线 (this.waypoints) 的弧长参数 this.squadPathDist 物理推进：
    //    核心铁律：沿当前走廊朝向单位向量 (fwdX, fwdY) 精确检测前方丧尸——无论小队向东、向西还是向北推进，前方丧尸未肃清前绝不穿怪而过！
    const fwdX = Math.cos(this.squadMoveAngle);
    const fwdY = Math.sin(this.squadMoveAngle);
    let hasCloseFrontEnemy = false;
    let minFrontClearance = Infinity;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if ((r.mutatingTicks ?? 0) > 0) continue;
      if (r.dormant || r.cornerAmbush || (r.mutatingTicks ?? 0) > 0) continue;
      const dx = r.x - this.squadCenterX;
      const dy = r.y - this.squadCenterY;
      const distToSquad = Math.hypot(dx, dy);
      if (distToSquad > 295) continue;
      if (!this.hasLineOfSight(this.squadCenterX, this.squadCenterY, r.x, r.y)) continue;

      const fwdProj = dx * fwdX + dy * fwdY - r.r;
      const sideProj = Math.abs(-dx * fwdY + dy * fwdX);
      if (sideProj > 210) continue;
      if (fwdProj > -55 && fwdProj < minFrontClearance) {
        minFrontClearance = fwdProj;
      }
      if (fwdProj > -45 && fwdProj < 165) {
        hasCloseFrontEnemy = true;
      }
    }

    const paceSpan = 24.2;
    const scheduleDist = clamp(Math.max(0, tSec - 3.9) / paceSpan, 0, 1) * this.totalPathLen;
    const maxSquadSpd =
      tSec < 4.5
        ? 1.65
        : tSec >= 19.5
          ? 4.62
          : this.counterPushActive
            ? 4.45
            : 4.32;
    let pathAdvance = clamp((scheduleDist - this.squadPathDist) * 0.24, 1.85, maxSquadSpd);

    // 若正在商铺内驻停破障救人 (holdForRescueTicks > 0) 或前排有丧尸贴近，小队原地驻停防守门口（让玩家彻底看清破障与救人全过程！）
    if (minFrontClearance < 56) {
      pathAdvance = minFrontClearance < 12 ? -2.0 : -0.75;
    } else if (this.holdForRescueTicks > 0) {
      this.holdForRescueTicks--;
      pathAdvance = 0;
    } else if (minFrontClearance < 76) {
      pathAdvance = 0;
    } else if (hasCloseFrontEnemy) {
      pathAdvance = Math.min(pathAdvance, this.counterPushActive ? 2.75 : 2.25);
    }

    const minDistFloor = this.hiveHallEnteredSec > 0 ? Math.max(0, this.totalPathLen - 145) : 0;
    this.squadPathDist = clamp(this.squadPathDist + pathAdvance, minDistFloor, this.totalPathLen);

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
    this.squadMoveAngle += dAng * 0.14;

    // 2. 每名士兵依靠真实物理速度 (vx, vy) 与双向 BFS 寻路流场向各自战术阵位机动（严格限速 <= 4.65px/tick，绝无穿墙或瞬移！）
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
      const maxUnitSpd = g.role === "turret" ? 3.35 : tSec >= 22.0 ? 4.45 : 4.15;

      let steerX = 0;
      let steerY = 0;

      // 若士兵与阵位目标点之间无墙体阻挡，平滑驶向阵位；若隔着迷宫墙壁，则沿 squadNavDist 流场科学绕过 90° 拐角！
      if (this.hasLineOfSight(g.x, g.y, goal.x, goal.y)) {
        if (distToGoal > 0.5) {
          const spd = Math.min(maxUnitSpd, distToGoal * 0.25);
          steerX = (toGoalX / distToGoal) * spd;
          steerY = (toGoalY / distToGoal) * spd;
        }
      } else {
        const flow = this.sampleSquadFlow(g.x, g.y);
        if (flow.valid) {
          steerX = flow.fx * maxUnitSpd;
          steerY = flow.fy * maxUnitSpd;
        } else if (distToGoal > 0.5) {
          const spd = Math.min(maxUnitSpd, distToGoal * 0.2);
          steerX = (toGoalX / distToGoal) * spd;
          steerY = (toGoalY / distToGoal) * spd;
        }
      }

      // 全向 2D CQB 战术风筝后撤与防穿怪阻断（支持东/西/北任意迷宫走廊方向）：
      let nearestRed: RedDot | null = null;
      let nearestRedDist = Infinity;
      let blockedAlongSteer = false;
      const steerMag = Math.hypot(steerX, steerY);
      const sDirX = steerMag > 0.05 ? steerX / steerMag : fwdX;
      const sDirY = steerMag > 0.05 ? steerY / steerMag : fwdY;

      for (let ri = 0; ri < this.reds.length; ri++) {
        const r = this.reds[ri];
        if (r.dormant || r.cornerAmbush || (r.mutatingTicks ?? 0) > 0) continue;
        const dx = r.x - g.x;
        const dy = r.y - g.y;
        const edgeDist = Math.hypot(dx, dy) - r.r - g.r;
        if (edgeDist < 210 && this.hasLineOfSight(g.x, g.y, r.x, r.y)) {
          if (edgeDist < nearestRedDist) {
            nearestRedDist = edgeDist;
            nearestRed = r;
          }
          const proj = dx * sDirX + dy * sDirY - r.r;
          const lat = Math.abs(-dx * sDirY + dy * sDirX);
          if (proj > -12 && proj < 86 && lat < 68) {
            blockedAlongSteer = true;
          }
        }
      }

      if (nearestRed && nearestRedDist < 78 && (nearestRed.frenzyTimer ?? 0) <= 0) {
        const awayX = g.x - nearestRed.x;
        const awayY = g.y - nearestRed.y;
        const awayLen = Math.hypot(awayX, awayY) || 1;
        steerX = (awayX / awayLen) * (maxUnitSpd * 0.85);
        steerY = (awayY / awayLen) * (maxUnitSpd * 0.85);
      } else if (blockedAlongSteer) {
        const fwdComp = steerX * sDirX + steerY * sDirY;
        if (fwdComp > 0) {
          steerX -= sDirX * fwdComp;
          steerY -= sDirY * fwdComp;
        }
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

      g.vx = g.vx * 0.38 + (steerX + clamp(repelX, -1.3, 1.3)) * 0.62;
      g.vy = g.vy * 0.38 + (steerY + clamp(repelY, -1.3, 1.3)) * 0.62;

      const stepMag = Math.hypot(g.vx, g.vy);
      const maxAllowedStep = maxUnitSpd + 0.18;
      if (stepMag > maxAllowedStep) {
        g.vx = (g.vx / stepMag) * maxAllowedStep;
        g.vy = (g.vy / stepMag) * maxAllowedStep;
      }

      g.x += g.vx;
      g.y += g.vy;

      // 室内完好家具、天井与混凝土柱刚性防穿模排斥（人类士兵 100% 沿桌椅/货架/病床边缘平滑绕行，绝不踩上或穿模家具！）
      this.resolvePropAndPillarCollisions(g, 0, 0, 0);
      for (const pt of this.pits) {
        this.resolveCircleRect(g, pt.x, pt.y, pt.w, pt.h, 1.5);
      }

      // 外墙与死角隔墙刚性碰撞排斥：士兵绝不可穿墙！
      for (const seg of this.outerWalls) {
        this.resolveSegmentCollision(g, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      for (const seg of this.deadCornerWalls) {
        this.resolveSegmentCollision(g, seg.x1, seg.y1, seg.x2, seg.y2);
      }
      g.y = clamp(g.y, 280, WORLD_H - 70);

      // 物理铁律保底：单帧合成位移绝不可超过 4.65px/tick (< 5.0 零瞬移红线！)
      const finalDX = g.x - g.prevX;
      const finalDY = g.y - g.prevY;
      const finalDist = Math.hypot(finalDX, finalDY);
      if (finalDist > 4.65) {
        g.x = g.prevX + (finalDX / finalDist) * 4.65;
        g.y = g.prevY + (finalDY / finalDist) * 4.65;
      }
      // 二次确认完好家具零穿模
      this.resolvePropAndPillarCollisions(g, 0, 0, 0);
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
        this.squadCenterX,
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

    // 0. 优先检测该士兵全向 2D 近身扇区内是否存在紧迫丧尸威胁 (距离 < 210px)：
    //    若近身有怪（如刚从 90° 盲区拐角扑出的丧尸），全员 100% 优先集火肃清贴脸怪！
    let hasCloseZombieThreat = false;
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if ((r.mutatingTicks ?? 0) > 0) continue;
      const dist = Math.hypot(r.x - unit.x, r.y - unit.y) - r.r;
      if (dist < 210 && dist <= maxRange && this.hasLineOfSight(unit.x, unit.y, r.x, r.y)) {
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

    if (!hasCloseZombieThreat && tSec >= 4.4) {
      const isNodeShooter = unitIdx === 0 || unitIdx % 4 === 0;
      if (isNodeShooter) {
        let bestNode: TacticalNodeState | null = null;
        let bestNodeDist = 235;
        for (let ni = 0; ni < this.nodes.length; ni++) {
          const node = this.nodes[ni];
          if (node.broken) continue;
          const distToNode = Math.hypot(node.x - unit.x, node.y - unit.y);
          if (
            distToNode <= Math.min(maxRange, bestNodeDist) &&
            this.hasLineOfSight(unit.x, unit.y, node.x, node.y)
          ) {
            bestNodeDist = distToNode;
            bestNode = node;
          }
        }
        if (bestNode) {
          const rot = bestNode.rot ?? 0;
          // 瞄准铁笼正门挂锁位置精准打飞锁头！
          aimTargetX = bestNode.x - Math.sin(rot) * 14;
          aimTargetY = bestNode.y + Math.cos(rot) * 14;
          foundTarget = true;
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
        if ((r.mutatingTicks ?? 0) > 0) continue;
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
        const traitorBonus = r.kind === "infected_elite" ? -45 : 0;
        // 强烈全向近身优先权重：距离 < 175px 扑出拐角的丧尸优先级最高，必须先打死贴脸怪！
        const frontUrgency = -Math.max(0, 285 - dist) * 2.35 - (dist < 175 ? 215 : 0);
        const sectorPenalty = Math.abs(r.x - (unit.x + sectorBiasX * 0.45)) * 0.45;
        const slotSpreadPenalty = r.kind === "boss" ? 0 : ((i + unitIdx) % 5) * 12;
        const score =
          dist * 0.85 +
          sectorPenalty +
          slotSpreadPenalty +
          sticky +
          bossBonus +
          carrierBonus +
          traitorBonus +
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
    let hitPropIdx = -1;

    // 2a. 走廊外墙边界交点 + 室内死角隔墙 (deadCornerWalls) + 混凝土承重柱精确阻挡
    const dOuter = this.castRayToWalls(mx, my, ux, uy, bestDist);
    if (dOuter < bestDist) {
      bestDist = dOuter;
      hitType = "wall";
    }
    for (let pli = 0; pli < this.pillars.length; pli++) {
      const pl = this.pillars[pli];
      const tPl = this.rayRectDist(mx, my, ux, uy, bestDist, pl.x, pl.y, pl.w, pl.h);
      if (tPl < bestDist) {
        bestDist = tPl;
        hitType = "wall";
      }
    }

    // 2a-2. 室内完好家具与玻璃橱窗弹道拦截：
    //       - 高耸货架/售货机/钢化玻璃窗 100% 物理挡弹直至被打碎坍塌！
    //       - 半高餐桌/沙发/病床/检票闸机 33% 概率擦碰掩体表面飞溅木屑并逐步轰碎！
    for (let pi = 0; pi < this.props.length; pi++) {
      const prop = this.props[pi];
      if (!prop.intact) continue;
      if (!prop.blocksBulletsFull && (this.tick + unitIdx + prop.id) % 3 !== 0) continue;
      const tProp = this.rayRectDist(mx, my, ux, uy, bestDist, prop.x, prop.y, prop.w, prop.h);
      if (tProp < bestDist) {
        bestDist = tProp;
        hitType = "wall";
        hitPropIdx = pi;
      }
    }

    // 2b. 检测所有丧尸与泰坦 Boss（前排怪结结实实挡住后排！）
    for (let i = 0; i < this.reds.length; i++) {
      const r = this.reds[i];
      if ((r.mutatingTicks ?? 0) > 0) continue;
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
          hitPropIdx = -1;
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
          hitPropIdx = -1;
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
            hitPropIdx = -1;
          }
        }
      }
    }

    const hitX = mx + ux * bestDist;
    const hitY = my + uy * bestDist;

    // 3. 伤害结算（降低约 28% 瞬时秒怪 DPS，展现扎实可读的门口火力拉锯与丧尸受击硬直！）
    const overrun = this.isOverrunMode();
    const overrunCollapse = overrun && this.finalWaveTriggered;
    const scaleFactor = totalUnits <= 6 ? 0.92 : 2.95 / Math.pow(totalUnits, 0.54);
    const buffMult = unit.buffed || this.squadBuffed ? 1.16 : 1.0;
    const roleMult = unit.role === "turret" ? 1.2 : unit.role === "sniper" ? 1.14 : 1.0;
    const darkMult = overrunCollapse ? 0.95 : 1.35;
    const baseDmg = 1.08 * scaleFactor * buffMult * roleMult * darkMult;

    if (hitPropIdx >= 0 && this.props[hitPropIdx]) {
      this.damageProp(this.props[hitPropIdx], baseDmg * 5.8, ux, uy);
    } else if (hitType === "minion" || hitType === "boss") {
      const target = this.reds[hitRedIdx];
      if (target) {
        const inHiveAttrition =
          !overrun &&
          this.hiveHallEnteredSec > 0 &&
          this.greens.length > 4 &&
          (target.frenzyTimer ?? 0) > 0;
        const lateBoost = overrunCollapse || inHiveAttrition
          ? 0.65
          : tSec >= 27.0
            ? 2.15
            : tSec >= 15.0
              ? 1.45
              : 1.08;
        const dmg = (target.kind === "boss" ? baseDmg * 1.15 : baseDmg * 1.32) * lateBoost;
        target.hp -= dmg;
        target.hitFlash = 1.0;

        const kb = target.kind === "boss" ? 0.04 : (target.frenzyTimer ?? 0) > 0 ? 0.04 : 0.28;
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
        // 枪兵对路障锁扣进行精确破拆切割（配合约 2 秒环形进度条，绝不一枪秒碎！）
        node.breachProgress = Math.min(1.0, node.breachProgress + 0.00045);
        node.hp = Math.max(0, node.maxHp * (1 - node.breachProgress));
        node.hitFlash = 1.0;
        if ((this.tick + unitIdx) % 5 === 0) {
          this.spawnImpactParticles(hitX, hitY, ux, uy, "gold", 1);
        }
        if (node.breachProgress >= 1.0) {
          this.triggerNodeShatter(node);
        }
      }
    } else if (hitType === "hive" && this.hive.alive) {
      const hiveDmg = overrun
        ? overrunCollapse
          ? baseDmg * 0.55
          : baseDmg * 6.8
        : tSec >= 39.0
          ? baseDmg * 14.5
          : tSec >= 33.5
            ? baseDmg * 6.4
            : tSec >= 27.5
              ? baseDmg * 3.2
              : baseDmg * 0.2;
      this.hive.hp -= hiveDmg;
      this.hive.hitFlash = 1.0;
      if ((this.tick + unitIdx) % 4 === 0) {
        this.spawnImpactParticles(hitX, hitY, ux, uy, "spark", 1);
      }
      if (overrun) {
        if (this.hive.hp < this.hive.maxHp * 0.18) {
          this.hive.hp = this.hive.maxHp * 0.18;
        }
      } else {
        const readyBlast =
          this.hiveHallEnteredSec > 0 &&
          ((this.greens.length <= 5 && tSec - this.hiveHallEnteredSec >= 3.0) ||
            tSec - this.hiveHallEnteredSec >= 7.8);
        if (this.hive.hp <= 0 && readyBlast) {
          this.triggerHiveDestruction();
        } else if (this.hive.hp < 80 && !readyBlast) {
          this.hive.hp = 80;
        }
      }
    }

    // 人类惨胜模式保底引爆：当大军已在母巢前惨烈牺牲至仅剩 <= 5 名孤胆英雄 (进大厅 >= 3.2s) 或在大厅血战满 7.8s 时，引爆高能C4彻底炸毁母巢！
    if (
      !overrun &&
      this.hive.alive &&
      this.hiveHallEnteredSec > 0 &&
      this.greens.length > 0 &&
      ((this.greens.length <= 5 && tSec - this.hiveHallEnteredSec >= 3.2) ||
        tSec - this.hiveHallEnteredSec >= 7.8)
    ) {
      this.triggerHiveDestruction();
    }

    if ((this.tick + unitIdx) % 4 === 0) {
      this.spawnShellCasing(
        mx,
        my,
        ux,
        uy,
        unit.role === "turret" || unit.role === "sniper",
      );
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
    this.addTrauma(0.38);
    this.emitAudio("adrenaline", 0.95, 1.08, node.x);

    this.pendingDecals.push({
      kind: "crystals",
      x: node.x,
      y: node.y,
      r: node.r * 1.3,
      seed: this.tick,
    });

    if (node.kind === "rescue_cage") {
      node.openAnim = 0.14;
      const addCount = Math.min(node.rewardValue, 26 - this.greens.length);
      const role = node.rewardRole ?? "rifle";
      const rot = node.rot ?? 0;
      const doorAng = rot + Math.PI * 0.5;
      for (let i = 0; i < addCount; i++) {
        const sx = node.x + Math.cos(doorAng) * 16 + (i - (addCount - 1) * 0.5) * 10;
        const sy = node.y + Math.sin(doorAng) * 16;
        const clean = this.sanitizeSpawnPoint(sx, sy, 10);
        this.spawnGreenUnit(role, clean.x, clean.y);
      }
      this.holdForRescueTicks = Math.max(this.holdForRescueTicks, 5);
      this.rescuedCount += addCount;
      this.rings.push({ x: node.x, y: node.y, maxR: 58, ttl: 16, maxTtl: 16, kind: "rescue" });
      if (addCount > 0) {
        this.addBanner(node.x, node.y - 12, `+${addCount}`, [85, 255, 165, 255]);
      }
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
      this.addBanner(node.x, node.y - 10, node.label || "x2", [255, 225, 75, 255]);
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
      this.holdForRescueTicks = Math.max(this.holdForRescueTicks, 16);
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
    this.addTrauma(1.0);
    this.emitAudio("hive-blast", 1.0, 1.0, this.hive.x);

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
      this.addTrauma(d.isFinalBoss ? 0.72 : 0.48);
      this.emitAudio("boss-kill", 1.0, d.isFinalBoss ? 0.82 : 1.0, d.x);
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
      this.emitAudio("kill-pop", 0.36, 0.9 + (this.kills % 7) * 0.04, d.x);
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

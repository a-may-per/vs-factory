// siege 窄口防线死守配置（真正的狭窄漏斗口场景 · 机枪兵一碰即碎 · 单直线前排物理阻挡射击 · 35s+ 强悬念拉锯版）
export const ARENA_W = 984;
export const ARENA_H = 1520;
export const CORRIDOR_CX = 492;

export type SiegeMapId = "canyon-bridge" | "twin-corridor" | "cross-bunker";
export type GreenRole = "mg";
export type RedKind = "walker" | "runner" | "boss";

export interface RectWall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BarricadeSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  maxHp: number;
  /** 1 = 窄口入口闸门(y=586), 2 = 窄口中段闸门(y=890), 3 = 窄口底端闸门(y=1146) */
  tier: 1 | 2 | 3;
}

export interface GreenSlotSpec {
  id: string;
  role: GreenRole;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BossWaveSpec {
  spawnSec: number;
  name: string;
  hp: number;
  r: number;
  speed: number;
  xOffset: number;
  ySpawn: number;
  isFinalBoss?: boolean;
}

export interface SpawnZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WaypointFunnel {
  splitY: number;
  funnelX: number;
  funnelHalfW: number;
}

export interface SiegeMapConfig {
  id: SiegeMapId;
  name: string;
  subtitle: string;
  hookTitle: string;
  pinnedComment: string;
  walls: RectWall[];
  barricades: BarricadeSpec[];
  spawns: SpawnZone[];
  funnels: WaypointFunnel[];
  greenSlots: GreenSlotSpec[];
  bossWaves: BossWaveSpec[];
  corePos: { x: number; y: number };
}

/**
 * 计算任意高度 y 处的通道半宽 (half-width around CORRIDOR_CX = 492)：
 * - y = 0..310: 顶部宽阔聚怪大漏斗区 (半宽 360px，全宽 720px: x = 132..852)
 * - y = 310..580: 45° 斜切岩石/合金漏斗壁，将尸潮强行挤压进狭窄口子 (半宽从 360px 收窄至 68px)
 * - y = 580..1150: 核心「狭窄的口子」咽喉通道 (半宽 68px，全宽仅 136px: x = 424..560)
 * - y = 1150..1240: 底部退守战壕过渡斜坡 (半宽从 68px 展开至 148px)
 * - y = 1240..1468: 底部绝境死守战壕 (半宽 148px，全宽 296px: x = 344..640)，y=1468 为退无可退的封底墙
 */
export function getCorridorHalfWidth(y: number): number {
  if (y <= 310) {
    return 360;
  }
  if (y <= 580) {
    const t = (y - 310) / (580 - 310);
    return 360 + (68 - 360) * t;
  }
  if (y <= 1150) {
    return 68;
  }
  if (y <= 1240) {
    const t = (y - 1150) / (1240 - 1150);
    return 68 + (148 - 68) * t;
  }
  return 148;
}

/**
 * 精确物理碰撞线段（左右对称漏斗斜墙 + 中段 136px 极窄峡谷壁 + 底部退守战壕封底墙）
 */
export const CANYON_WALL_SEGMENTS: WallSegment[] = [
  // 左侧漏斗与窄口墙体折线
  { x1: 132, y1: 0, x2: 132, y2: 310 },
  { x1: 132, y1: 310, x2: 424, y2: 580 },
  { x1: 424, y1: 580, x2: 424, y2: 1150 },
  { x1: 424, y1: 1150, x2: 344, y2: 1240 },
  { x1: 344, y1: 1240, x2: 344, y2: 1468 },

  // 右侧漏斗与窄口墙体折线
  { x1: 852, y1: 0, x2: 852, y2: 310 },
  { x1: 852, y1: 310, x2: 560, y2: 580 },
  { x1: 560, y1: 580, x2: 560, y2: 1150 },
  { x1: 560, y1: 1150, x2: 640, y2: 1240 },
  { x1: 640, y1: 1240, x2: 640, y2: 1468 },

  // 底部封底绝境墙
  { x1: 344, y1: 1468, x2: 640, y2: 1468 },
];

const CORRIDOR_BARRICADES: BarricadeSpec[] = [
  // 仅在狭窄口子最前端入口处设一道防爆拒马，破开后整个狭长咽喉通道畅通无阻供机枪兵边打边退与反推拉锯
  { id: "gate-1", x: 424, y: 584, w: 136, h: 22, maxHp: 320, tier: 1 },
];

// 35秒+ 窄口拉锯战的 4 大变异泰坦 Boss 波次（前排肉盾挡枪 + 破盾后尸潮决堤狂涌）
const STANDARD_BOSS_WAVES: BossWaveSpec[] = [
  // 第1波：重甲泰坦顶在窄口最前排充当肉盾，掩护后方百尸积蓄；机枪兵边打边退将其击破后引发第一波尸潮决堤！
  { spawnSec: 0.6, name: "重甲泰坦", hp: 780, r: 28, speed: 1.36, xOffset: 0, ySpawn: 420 },
  // 第2波：狂暴泰坦 + 暗黑泰坦先后挤入窄口，挡住枪线掩护尸潮，机枪兵换弹遇险被一路逼退！
  { spawnSec: 9.2, name: "狂暴泰坦", hp: 880, r: 29, speed: 1.38, xOffset: -18, ySpawn: 430 },
  { spawnSec: 13.8, name: "暗黑泰坦", hp: 980, r: 30, speed: 1.36, xOffset: 18, ySpawn: 410 },
  // 第3波：终极尸王压阵冲出窄口，将一碰即碎的机枪兵逼至底线绝境，贴脸拉锯周旋完成极限反杀！
  { spawnSec: 21.0, name: "终极尸王", hp: 1580, r: 35, speed: 1.38, xOffset: 0, ySpawn: 450, isFinalBoss: true },
];

export const SIEGE_MAPS: Record<SiegeMapId, SiegeMapConfig> = {
  "canyon-bridge": {
    id: "canyon-bridge",
    name: "绝境窄口防线",
    subtitle: "机枪兵一碰即碎 · 窄口单线点杀 · 前排不倒后排无伤",
    hookTitle: "普通机枪兵死守窄口：一碰即碎，能挡住尸潮+4大泰坦吗？",
    pinnedComment: "泰坦顶在窄口前排挡子弹、打爆瞬间后方尸潮涌出来太真实了！",
    walls: [],
    barricades: CORRIDOR_BARRICADES,
    spawns: [
      { x: 180, y: 20, w: 624, h: 90 },
      { x: 240, y: 120, w: 504, h: 90 },
    ],
    funnels: [{ splitY: 580, funnelX: 492, funnelHalfW: 64 }],
    greenSlots: [{ id: "mg-hero", role: "mg", name: "机枪兵", x1: 492, y1: 720, x2: 492, y2: 1410 }],
    bossWaves: STANDARD_BOSS_WAVES,
    corePos: { x: 492, y: 1440 },
  },

  "twin-corridor": {
    id: "twin-corridor",
    name: "峡谷窄口通道",
    subtitle: "机枪兵一碰即碎 · 窄口单线点杀 · 前排不倒后排无伤",
    hookTitle: "普通机枪兵死守窄口：一碰即碎，能挡住尸潮+4大泰坦吗？",
    pinnedComment: "换弹那一下太险了！真实物理前排挡子弹太有悬念了！",
    walls: [],
    barricades: CORRIDOR_BARRICADES,
    spawns: [
      { x: 180, y: 20, w: 624, h: 90 },
      { x: 240, y: 120, w: 504, h: 90 },
    ],
    funnels: [{ splitY: 580, funnelX: 492, funnelHalfW: 64 }],
    greenSlots: [{ id: "mg-hero", role: "mg", name: "机枪兵", x1: 492, y1: 720, x2: 492, y2: 1410 }],
    bossWaves: STANDARD_BOSS_WAVES,
    corePos: { x: 492, y: 1440 },
  },

  "cross-bunker": {
    id: "cross-bunker",
    name: "一线天要塞窄口",
    subtitle: "机枪兵一碰即碎 · 窄口单线点杀 · 前排不倒后排无伤",
    hookTitle: "普通机枪兵死守窄口：一碰即碎，能挡住尸潮+4大泰坦吗？",
    pinnedComment: "35秒全程高能！前排泰坦挡枪让后方尸潮越聚越多太燃了！",
    walls: [],
    barricades: CORRIDOR_BARRICADES,
    spawns: [
      { x: 180, y: 20, w: 624, h: 90 },
      { x: 240, y: 120, w: 504, h: 90 },
    ],
    funnels: [{ splitY: 580, funnelX: 492, funnelHalfW: 64 }],
    greenSlots: [{ id: "mg-hero", role: "mg", name: "机枪兵", x1: 492, y1: 720, x2: 492, y2: 1410 }],
    bossWaves: STANDARD_BOSS_WAVES,
    corePos: { x: 492, y: 1440 },
  },
};

export const SIEGE_MAP_IDS: SiegeMapId[] = ["canyon-bridge", "twin-corridor", "cross-bunker"];

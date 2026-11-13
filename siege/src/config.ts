// siege 大地图动态镜头跟随 + 死角迷雾视野差 + 科学室内CQB折角建筑/反应堆/溶洞/监狱配置
export const ARENA_W = 984;
export const ARENA_H = 1520;

// 大尺寸真实战术世界地图（宽高均显著大于单屏视口 ARENA_W x ARENA_H，配合平滑 2D 镜头跟随 + 右上角全局小地图）
export const WORLD_W = 1800;
export const WORLD_H = 3000;
export const CORRIDOR_CX = 900; // WORLD_W / 2

export type SiegeMapId = "canyon-bridge" | "twin-corridor" | "cross-bunker";
export type SiegeModeId =
  | "rescue"
  | "infect"
  | "multiply"
  | "bunker"
  | "combo"
  | "scavenge"
  | "blackout"
  | "sonar"
  | "maze-infect";

export function isDarkDeadCornerMode(mode: SiegeModeId): boolean {
  return (
    mode === "scavenge" ||
    mode === "blackout" ||
    mode === "sonar" ||
    mode === "maze-infect"
  );
}

export type GreenRole = "rifle" | "shotgun" | "sniper" | "turret";
export type RedKind = "walker" | "runner" | "carrier" | "infected_elite" | "boss";

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TacticalNodeSpec {
  id: string;
  kind: "rescue_cage" | "multiply_crystal" | "bunker_pad";
  label: string;
  subLabel: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  rewardValue: number;
  rewardRole?: GreenRole;
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

export interface SiegeMapConfig {
  id: SiegeMapId;
  name: string;
  subtitle: string;
  hookTitle: string;
  pinnedComment: string;
  bossWaves: BossWaveSpec[];
  hivePos: { x: number; y: number; r: number; hp: number };
}

export interface CorridorBounds {
  left: number;
  right: number;
  cx: number;
  halfW: number;
}

function lerp(a: number, b: number, t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return a + (b - a) * c;
}

/**
 * 根据模式返回世界坐标 y (0..WORLD_H) 处的建筑/洞穴左右外墙边界与通道中心线：
 * - scavenge    (死角搜房): 错层折角地下研究所大楼（西翼1号室 -> 东翼2号室 -> 西翼3号室 -> 北部母巢大厅，拒绝笔直长筒！）
 * - blackout    (断电惊魂): 双八角地下核反应堆大厅（南八角反应堆厅 + 中央防爆气闸窄口 + 北八角反应堆厅）
 * - sonar       (声呐潜行): 超大跨度 S 型蜿蜒深渊溶洞（中心线在 x=490 与 x=1310 之间大幅蛇形摆动，横跨 820px！）
 * - maze-infect (迷宫同化): 1240px 超宽三通道生化监狱街区（下层 A/B/C 三条平行封闭监区 -> 中庭检疫广场汇合 -> 上层折角禁闭区）
 */
export function getCorridorBounds(y: number, mode: SiegeModeId = "combo"): CorridorBounds {
  if (mode === "scavenge") {
    // 错层折角 CQB 实验大楼：随 y 从南入口 -> 西翼实验室 -> 东翼基因区 -> 西翼重装区 -> 北侧母巢核心平滑折转
    let left = 460;
    let right = 1340;
    if (y >= 2620) {
      const t = (y - 2620) / 220;
      left = lerp(260, 520, t);
      right = lerp(1180, 1280, t);
    } else if (y >= 2020) {
      // 西翼 1 号密室区
      left = 260;
      right = 1180;
    } else if (y >= 1860) {
      // 西翼向东翼折转过渡走廊
      const t = (2020 - y) / (2020 - 1860);
      left = lerp(260, 620, t);
      right = lerp(1180, 1540, t);
    } else if (y >= 1320) {
      // 东翼 2 号密室区
      left = 620;
      right = 1540;
    } else if (y >= 1160) {
      // 东翼向西翼折转过渡走廊
      const t = (1320 - y) / (1320 - 1160);
      left = lerp(620, 260, t);
      right = lerp(1540, 1180, t);
    } else if (y >= 660) {
      // 西翼 3 号密室区
      left = 260;
      right = 1180;
    } else if (y >= 520) {
      // 西翼向北部中央母巢大厅过渡
      const t = (660 - y) / (660 - 520);
      left = lerp(260, 460, t);
      right = lerp(1180, 1340, t);
    } else {
      left = 460;
      right = 1340;
    }
    return { left, right, cx: (left + right) * 0.5, halfW: (right - left) * 0.5 };
  }

  if (mode === "blackout") {
    // 双八角核反应堆综合体：南入口窄道 -> 1号南八角反应堆大厅 -> 中央防爆气闸窄口 -> 2号北八角反应堆大厅 -> 北侧母巢反应堆芯
    let halfW = 300;
    if (y >= 2560) {
      halfW = 290;
    } else if (y >= 2400) {
      halfW = lerp(590, 290, (y - 2400) / 160);
    } else if (y >= 1840) {
      halfW = 590; // 1号南八角反应堆巨厅 (宽 1180px)
    } else if (y >= 1680) {
      halfW = lerp(270, 590, (y - 1680) / 160);
    } else if (y >= 1500) {
      halfW = 270; // 中央高压防爆气闸窄口 (宽 540px)
    } else if (y >= 1340) {
      halfW = lerp(590, 270, (y - 1340) / 160);
    } else if (y >= 760) {
      halfW = 590; // 2号北八角反应堆巨厅 (宽 1180px)
    } else if (y >= 600) {
      halfW = lerp(410, 590, (y - 600) / 160);
    } else {
      halfW = 410;
    }
    return { left: CORRIDOR_CX - halfW, right: CORRIDOR_CX + halfW, cx: CORRIDOR_CX, halfW };
  }

  if (mode === "sonar") {
    // 超大跨度 S 型蜿蜒深渊溶洞：中心线在 x=480 (西侧深渊弯) 与 x=1320 (东侧深渊弯) 之间大幅度 S 型摆动
    let cx = CORRIDOR_CX;
    if (y <= 460) {
      cx = 900;
    } else if (y <= 960) {
      const t = (y - 460) / (960 - 460);
      cx = 900 + (485 - 900) * Math.sin(t * Math.PI * 0.5);
    } else if (y <= 1640) {
      const t = (y - 960) / (1640 - 960);
      cx = 485 + (1315 - 485) * (0.5 - 0.5 * Math.cos(t * Math.PI));
    } else if (y <= 2320) {
      const t = (y - 1640) / (2320 - 1640);
      cx = 1315 + (485 - 1315) * (0.5 - 0.5 * Math.cos(t * Math.PI));
    } else {
      const t = Math.min(1, (y - 2320) / (2860 - 2320));
      cx = 485 + (900 - 485) * (0.5 - 0.5 * Math.cos(t * Math.PI));
    }
    const halfW = y <= 480 ? 390 : 285;
    const left = Math.max(120, cx - halfW);
    const right = Math.min(WORLD_W - 120, cx + halfW);
    return { left, right, cx: (left + right) * 0.5, halfW: (right - left) * 0.5 };
  }

  if (mode === "maze-infect") {
    // 大型三通道九宫格生化监狱：下层 (y=1580..2920) 为 1240px 超宽三监区并列街区，上层收窄为折角检疫区
    let halfW = 620;
    if (y < 520) {
      halfW = 420;
    } else if (y < 680) {
      halfW = lerp(420, 520, (y - 520) / 160);
    } else if (y < 1420) {
      halfW = 520;
    } else if (y < 1580) {
      halfW = lerp(520, 620, (y - 1420) / 160);
    }
    return { left: CORRIDOR_CX - halfW, right: CORRIDOR_CX + halfW, cx: CORRIDOR_CX, halfW };
  }

  // 经典沙漏峡谷（等比扩展至大世界尺寸）
  const halfW = getCorridorHalfWidth(y);
  return { left: CORRIDOR_CX - halfW, right: CORRIDOR_CX + halfW, cx: CORRIDOR_CX, halfW };
}

export function getCorridorHalfWidth(y: number): number {
  if (y <= 560) return 420;
  if (y <= 920) {
    const t = (y - 560) / (920 - 560);
    return 420 + (210 - 420) * t;
  }
  if (y <= 2050) return 210;
  if (y <= 2380) {
    const t = (y - 2050) / (2380 - 2050);
    return 210 + (380 - 210) * t;
  }
  return 380;
}

/**
 * 根据模式生成大地图外墙折线段（供 2D 射线光锥截断与高精度装甲外墙渲染使用）
 */
export function getOuterWallSegments(mode: SiegeModeId = "combo"): WallSegment[] {
  const segs: WallSegment[] = [];
  const step = 40;
  for (let y = 20; y < WORLD_H - 20; y += step) {
    const y2 = Math.min(WORLD_H - 20, y + step);
    const b1 = getCorridorBounds(y, mode);
    const b2 = getCorridorBounds(y2, mode);
    segs.push({ x1: b1.left, y1: y, x2: b2.left, y2 });
    segs.push({ x1: b1.right, y1: y, x2: b2.right, y2 });
  }
  const topB = getCorridorBounds(20, mode);
  const botB = getCorridorBounds(WORLD_H - 20, mode);
  segs.push({ x1: topB.left, y1: 20, x2: topB.right, y2: 20 });
  segs.push({ x1: botB.left, y1: WORLD_H - 20, x2: botB.right, y2: WORLD_H - 20 });
  return segs;
}

export const CANYON_WALL_SEGMENTS: WallSegment[] = getOuterWallSegments("combo");

/**
 * 四大死角模式科学室内建筑隔墙与掩体布局（真正阻断南北笔直视线，强制通过门洞与拐角推进！）：
 * - scavenge:    3座带真实门洞的封闭侧室（1号军火室/2号基因室/3号重装室）+ 走廊交错防爆折流墙
 * - blackout:    双八角核反应堆大厅中央的 2 座六角/矩形反应堆屏蔽岛（迫使走左右双环通道）+ 4 角防辐射折流屏
 * - sonar:       S 型大跨度深渊弯道内侧交错伸出的 5 道厚重天然声呐盲区岩壁
 * - maze-infect: 下层 A/B/C 三条平行封闭监区的长纵向隔离墙 + 监区内交错牢房挡墙 + 上层 T 型检疫门廊
 */
export function getDeadCornerWalls(mode: SiegeModeId): WallSegment[] {
  if (mode === "scavenge") {
    return [
      // 1号西翼封闭军火室 (x=260..650, y=2100..2520，东侧墙留 130px 门洞 y=2250..2380)
      { x1: 260, y1: 2100, x2: 650, y2: 2100 },
      { x1: 650, y1: 2100, x2: 650, y2: 2245 },
      { x1: 650, y1: 2385, x2: 650, y2: 2520 },
      { x1: 260, y1: 2520, x2: 650, y2: 2520 },
      // 1号走廊右侧交错阻断墙（封堵右侧直通视线，强制经过 1 号室门前走廊 x=650..940）
      { x1: 940, y1: 2210, x2: 1180, y2: 2210 },

      // 2号东翼封闭基因室 (x=1150..1540, y=1380..1800，西侧墙留 130px 门洞 y=1530..1660)
      { x1: 1150, y1: 1380, x2: 1540, y2: 1380 },
      { x1: 1150, y1: 1380, x2: 1150, y2: 1525 },
      { x1: 1150, y1: 1665, x2: 1150, y2: 1800 },
      { x1: 1150, y1: 1800, x2: 1540, y2: 1800 },
      // 2号走廊左侧交错阻断墙（封堵左侧直通视线，强制经过 2 号室门前走廊 x=860..1150）
      { x1: 620, y1: 1510, x2: 860, y2: 1510 },

      // 3号西翼封闭重装室 (x=260..650, y=720..1120，东侧墙留 130px 门洞 y=860..990)
      { x1: 260, y1: 720, x2: 650, y2: 720 },
      { x1: 650, y1: 720, x2: 650, y2: 855 },
      { x1: 650, y1: 995, x2: 650, y2: 1120 },
      { x1: 260, y1: 1120, x2: 650, y2: 1120 },
      // 3号走廊右侧交错阻断墙
      { x1: 940, y1: 840, x2: 1180, y2: 840 },
    ];
  }

  if (mode === "blackout") {
    return [
      // 1号南八角核反应堆大厅：中央反应堆防爆屏蔽岛 (x=760..1040, y=2040..2220)，阻断中央直线，形成左右双环绕道
      { x1: 760, y1: 2040, x2: 1040, y2: 2040 },
      { x1: 760, y1: 2220, x2: 1040, y2: 2220 },
      { x1: 760, y1: 2040, x2: 760, y2: 2220 },
      { x1: 1040, y1: 2040, x2: 1040, y2: 2220 },
      // 南厅左右外侧 L 型辐射折流屏
      { x1: 300, y1: 1920, x2: 510, y2: 1920 },
      { x1: 1290, y1: 2310, x2: 1500, y2: 2310 },

      // 2号北八角核反应堆大厅：中央反应堆防爆屏蔽岛 (x=760..1040, y=960..1140)
      { x1: 760, y1: 960, x2: 1040, y2: 960 },
      { x1: 760, y1: 1140, x2: 1040, y2: 1140 },
      { x1: 760, y1: 960, x2: 760, y2: 1140 },
      { x1: 1040, y1: 960, x2: 1040, y2: 1140 },
      // 北厅左右外侧 L 型辐射折流屏
      { x1: 1290, y1: 840, x2: 1500, y2: 840 },
      { x1: 300, y1: 1230, x2: 510, y2: 1230 },
    ];
  }

  if (mode === "sonar") {
    return [
      // S型大跨度蜿蜒溶洞：在每个大S弯的内弯侧伸出厚重天然回声盲区岩壁，彻底挡住弯道后方视野！
      { x1: 215, y1: 2440, x2: 555, y2: 2440 },
      { x1: 540, y1: 2040, x2: 830, y2: 2040 },
      { x1: 1230, y1: 1740, x2: 1595, y2: 1740 },
      { x1: 960, y1: 1360, x2: 1260, y2: 1360 },
      { x1: 215, y1: 1040, x2: 555, y2: 1040 },
      { x1: 540, y1: 680, x2: 830, y2: 680 },
    ];
  }

  if (mode === "maze-infect") {
    return [
      // 下层三通道生化监狱：两道纵向钢筋隔离主墙 (x=690 与 x=1110, y=2040..2980) 将南区彻底分隔为 A/B/C 三大独立监区走廊（南端封死绝无绕后）！
      { x1: 690, y1: 2040, x2: 690, y2: 2980 },
      { x1: 1110, y1: 2040, x2: 1110, y2: 2980 },

      // A监区 (左道 x=280..690) 内部牢房死角隔墙
      { x1: 280, y1: 2380, x2: 475, y2: 2380 },

      // B监区 (中道 x=690..1110) 内部牢房死角隔墙
      { x1: 690, y1: 2320, x2: 865, y2: 2320 },

      // C监区 (右道 x=1110..1520) 内部牢房死角隔墙
      { x1: 1325, y1: 2380, x2: 1520, y2: 2380 },

      // 中庭汇合广场与中段双翼检疫隔离室隔墙 (y=1640, y=1220, y=840)
      { x1: 280, y1: 1640, x2: 640, y2: 1640 },
      { x1: 1160, y1: 1640, x2: 1520, y2: 1640 },
      { x1: 380, y1: 1220, x2: 750, y2: 1220 },
      { x1: 1050, y1: 1220, x2: 1420, y2: 1220 },
      { x1: 740, y1: 840, x2: 1060, y2: 840 },
    ];
  }

  return [];
}

export const DEAD_CORNER_WALLS: WallSegment[] = getDeadCornerWalls("scavenge");

/**
 * 各模式下人类战术小队从南部入口 (y=2660) 向北部母巢 (y=420) 科学推进的 CQB 航点序列
 */
export function getSquadWaypoints(mode: SiegeModeId): Array<{ x: number; y: number }> {
  if (mode === "scavenge") {
    return [
      { x: 900, y: 2660 }, // 南部潜入起点
      { x: 765, y: 2325 }, // 推进至西翼 1 号密室门洞外破门搜箱
      { x: 840, y: 1950 }, // 绕过 1 号走廊防爆折流墙向东翼机动
      { x: 1035, y: 1600 }, // 推进至东翼 2 号密室门洞外破门搜箱
      { x: 950, y: 1250 }, // 绕过 2 号走廊防爆折流墙向西翼机动
      { x: 765, y: 925 },  // 推进至西翼 3 号密室门洞外破门搜箱
      { x: 840, y: 620 },  // 突破最后一道安全隔门
      { x: 900, y: 420 },  // 杀入北部母巢核心腔体
    ];
  }

  if (mode === "blackout") {
    return [
      { x: 900, y: 2660 },  // 南入口通道
      { x: 605, y: 2130 },  // 沿 1 号南反应堆大厅左环绕过中央屏蔽岛（靠近左南探照灯塔与备用电闸）
      { x: 900, y: 1580 },  // 穿过中央高压防爆气闸窄口（此处触发反应堆过载断电惊魂！）
      { x: 1195, y: 1050 }, // 沿 2 号北反应堆大厅右环绕过中央屏蔽岛（靠近右北探照灯塔与电容晶石）
      { x: 900, y: 660 },   // 汇入北侧夜战特遣队阵地
      { x: 900, y: 420 },   // 决战北部核反应堆母巢
    ];
  }

  if (mode === "sonar") {
    return [
      { x: 900, y: 2680 },  // 溶洞南口潜入
      { x: 565, y: 2240 },  // 顺 S 弯潜入西侧 1 号深渊回声弯道
      { x: 920, y: 1900 },  // 穿过中南段斜向岩洞走廊
      { x: 1235, y: 1560 }, // 顺 S 弯潜入东侧 2 号深渊回声弯道
      { x: 880, y: 1220 },  // 穿过中北段斜向岩洞走廊
      { x: 565, y: 900 },   // 顺 S 弯潜入西侧 3 号深渊回声弯道
      { x: 900, y: 420 },   // 杀入北部溶洞母巢核心
    ];
  }

  if (mode === "maze-infect") {
    return [
      { x: 900, y: 2660 }, // 三路监区起点基准
      { x: 900, y: 2080 }, // 监区中段推进
      { x: 900, y: 1500 }, // 冲出 A/B/C 三道监区隔离墙，在中庭检疫广场完成三路小队汇合！
      { x: 900, y: 1140 }, // 突破中庭双翼检疫隔离闸门
      { x: 575, y: 840 },  // 沿上层左侧走廊绕过中央折流墙并解救特遣队
      { x: 900, y: 420 },  // 合围北部生化母巢
    ];
  }

  return [
    { x: 900, y: 2660 },
    { x: 900, y: 2050 },
    { x: 900, y: 1450 },
    { x: 900, y: 900 },
    { x: 900, y: 420 },
  ];
}

const STANDARD_BOSS_WAVES: BossWaveSpec[] = [
  { spawnSec: 1.0, name: "重甲泰坦", hp: 1450, r: 28, speed: 1.45, xOffset: 0, ySpawn: 1920 },
  { spawnSec: 9.8, name: "狂暴泰坦", hp: 1850, r: 29, speed: 1.52, xOffset: -65, ySpawn: 1320 },
  { spawnSec: 13.8, name: "暗黑泰坦", hp: 2150, r: 30, speed: 1.48, xOffset: 65, ySpawn: 880 },
  { spawnSec: 21.0, name: "终极尸王", hp: 3400, r: 36, speed: 1.42, xOffset: 0, ySpawn: 380, isFinalBoss: true },
];

export const SIEGE_MODE_META: Record<
  SiegeModeId,
  { name: string; hookTitle: string; subtitle: string }
> = {
  rescue: {
    name: "破笼救兵悬念局",
    hookTitle: "绝境斗蛐蛐：开局仅6人死守窄口，尸潮挡住枪线能救出牢笼队友吗？",
    subtitle: "残酷规则：人类被咬立刻变丧尸反扑 · 子弹严格受前排肉体阻挡",
  },
  infect: {
    name: "双向同化赌局",
    hookTitle: "双向同化赌局：人类被咬变精英丧尸 vs 杀母体爆兵，哪边会被吞噬？",
    subtitle: "残酷规则：双方击杀均可同化敌方 · 物理直线弹道前排严格阻挡",
  },
  multiply: {
    name: "物理阻挡生死局",
    hookTitle: "真物理挡子弹：前排僵尸肉盾挡死枪线，6名脆皮枪兵会被同化团灭吗？",
    subtitle: "残酷规则：人类一碰即感染变丧尸 · 打穿前排尸潮才能触发机关",
  },
  bunker: {
    name: "窄口防线生存局",
    hookTitle: "窄口生存测试：6名脆皮枪兵直面4大泰坦尸潮，防线能撑过30秒吗？",
    subtitle: "残酷规则：人类被扑立刻变丧尸反咬 · 物理直线火网前排严格阻挡",
  },
  combo: {
    name: "窄口生死斗蛐蛐",
    hookTitle: "残酷斗蛐蛐：6名脆皮枪兵 vs 千尸4泰坦，被咬立刻变丧尸能撑多久？",
    subtitle: "残酷规则：人类一碰即感染变丧尸反扑 · 子弹严格受前排肉体阻挡",
  },
  scavenge: {
    name: "死角搜房撤离局",
    hookTitle: "死角搜房惊魂：6名枪兵打手电摸黑搜寻3大密码箱，墙后藏着什么？",
    subtitle: "死角规则：手电光线与子弹均被墙体阻挡 · 未照亮盲区无法开枪",
  },
  blackout: {
    name: "断电探照灯死守局",
    hookTitle: "全黑死角断电测试：仅靠旋转探照灯索敌，中途断电3秒人类能活吗？",
    subtitle: "死角规则：仅被探照灯或手电照亮的丧尸可被射击 · 人类被咬秒变丧尸",
  },
  sonar: {
    name: "声呐潜行惊醒局",
    hookTitle: "死角潜行测试：满图死角沉睡尸潮，第一枪声波惊醒尸王能逃出去吗？",
    subtitle: "死角规则：声呐扫描墙后沉睡红眼尸群 · 开枪噪音波纹将惊醒死角尸潮",
  },
  "maze-infect": {
    name: "死角迷宫汇合局",
    hookTitle: "死角迷宫捉迷藏：3支走散小队打手电摸黑汇合，拐角遇到队友还是丧尸？",
    subtitle: "死角规则：墙体阻挡手电视线 · 阵亡小队将原地尸变在死角伏击昔日队友",
  },
};

export const SIEGE_MAPS: Record<SiegeMapId, SiegeMapConfig> = {
  "canyon-bridge": {
    id: "canyon-bridge",
    name: "绝境窄口生死局",
    subtitle: "残酷规则：人类一碰即感染变丧尸反扑 · 子弹严格受前排肉体阻挡",
    hookTitle: "残酷斗蛐蛐：6名脆皮枪兵 vs 千尸4泰坦，被咬立刻变丧尸能撑多久？",
    pinnedComment: "前排两个枪兵被咬直接变成变异丧尸反扑队友，差点就全军覆没了！",
    bossWaves: STANDARD_BOSS_WAVES,
    hivePos: { x: CORRIDOR_CX, y: 230, r: 58, hp: 5200 },
  },
  "twin-corridor": {
    id: "twin-corridor",
    name: "峡谷窄口同化局",
    subtitle: "残酷规则：人类一碰即感染变丧尸反扑 · 子弹严格受前排肉体阻挡",
    hookTitle: "残酷斗蛐蛐：6名脆皮枪兵 vs 千尸4泰坦，被咬立刻变丧尸能撑多久？",
    pinnedComment: "被杀的人类当场变变异枪兵掉头咬人，这设定太刺激了！",
    bossWaves: STANDARD_BOSS_WAVES,
    hivePos: { x: CORRIDOR_CX, y: 230, r: 58, hp: 5200 },
  },
  "cross-bunker": {
    id: "cross-bunker",
    name: "窄口尸潮困兽局",
    subtitle: "残酷规则：人类一碰即感染变丧尸反扑 · 子弹严格受前排肉体阻挡",
    hookTitle: "残酷斗蛐蛐：6名脆皮枪兵 vs 千尸4泰坦，被咬立刻变丧尸能撑多久？",
    pinnedComment: "看前10秒红条把绿条压到只剩一点点，还以为6个小绿人死定了！",
    bossWaves: STANDARD_BOSS_WAVES,
    hivePos: { x: CORRIDOR_CX, y: 230, r: 58, hp: 5200 },
  },
};

export const SIEGE_MAP_IDS: SiegeMapId[] = ["canyon-bridge", "twin-corridor", "cross-bunker"];
export const SIEGE_MODE_IDS: SiegeModeId[] = [
  "combo",
  "scavenge",
  "blackout",
  "sonar",
  "maze-infect",
  "rescue",
  "multiply",
  "infect",
  "bunker",
];

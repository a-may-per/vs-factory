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
  // 仅 sonar（深层声呐潜行医院）与 blackout（断电后的地铁站）启用黑暗战争迷雾；
  // scavenge（自然天窗采光商场）与 maze-infect（明亮玻璃幕墙航站楼）保持明亮通透的真实室内光感！
  return mode === "sonar" || mode === "blackout";
}

export type GreenRole = "rifle" | "shotgun" | "sniper" | "turret";
export type RedKind = "walker" | "runner" | "carrier" | "infected_elite" | "boss";

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ArchZoneSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "shop" | "atrium_pit" | "bridge_deck" | "counter" | "pillar";
  floorStyle?: "marble" | "wood" | "checker" | "clinical" | "carpet" | "slate" | "tile_warm";
}

export type InteriorPropKind =
  | "shelf_aisle"
  | "checkout"
  | "round_table"
  | "booth_table"
  | "clothes_rack"
  | "planter"
  | "vending"
  | "cart_clutter"
  | "glass_window"
  | "subway_train"
  | "turnstile_row"
  | "transformer"
  | "hospital_bed"
  | "surgical_set"
  | "mri_scanner"
  | "seat_row"
  | "sofa_l"
  | "xray_checkpoint"
  | "cinema_seats";

export interface InteriorPropSpec {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: InteriorPropKind;
  rot?: number;
  variant?: number;
}

export interface DoorwaySpec {
  /** 门轴铰链世界坐标 */
  hx: number;
  hy: number;
  /** 门洞朝向角度（门框沿墙方向：0=水平门洞，PI/2=竖直门洞） */
  wallAngle: number;
  width: number;
  openSign: 1 | -1;
  doubleDoor?: boolean;
  glass?: boolean;
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
  rot?: number;
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
    // 1280px 宽九曲死角 CQB 地下研究所：南侧装甲大巴入口斜坡 -> 三层横贯迷宫翼区 -> 北部母巢核心腔
    let left = 260;
    let right = 1540;
    if (y >= 2640) {
      const t = Math.min(1, (y - 2640) / 220);
      left = lerp(260, 480, t);
      right = lerp(1540, 1320, t);
    } else if (y <= 540) {
      const t = Math.min(1, (540 - y) / 140);
      left = lerp(260, 440, t);
      right = lerp(1540, 1360, t);
    }
    return { left, right, cx: (left + right) * 0.5, halfW: (right - left) * 0.5 };
  }

  if (mode === "blackout") {
    // 1220px 宽核反应堆死角迷宫：南机降坪 -> 双层防辐射交错回廊 -> 北部反应堆母巢大厅
    let halfW = 610;
    if (y >= 2620) {
      halfW = lerp(610, 410, Math.min(1, (y - 2620) / 220));
    } else if (y <= 540) {
      halfW = lerp(610, 440, Math.min(1, (540 - y) / 140));
    }
    return { left: CORRIDOR_CX - halfW, right: CORRIDOR_CX + halfW, cx: CORRIDOR_CX, halfW };
  }

  if (mode === "sonar") {
    // 1320px 超宽深渊发卡弯溶洞迷宫：配合 5 道横跨 78% 宽度的天然声呐盲区岩壁形成深折返死角
    let halfW = 660;
    if (y >= 2620) {
      halfW = lerp(660, 430, Math.min(1, (y - 2620) / 220));
    } else if (y <= 540) {
      halfW = lerp(660, 440, Math.min(1, (540 - y) / 140));
    }
    return { left: CORRIDOR_CX - halfW, right: CORRIDOR_CX + halfW, cx: CORRIDOR_CX, halfW };
  }

  if (mode === "maze-infect") {
    // 1240px 超宽九宫格生化监狱：南区三路封闭牢房走廊 -> 上层交错封锁横廊 -> 北部生化母巢
    let halfW = 620;
    if (y <= 540) {
      halfW = lerp(620, 440, Math.min(1, (540 - y) / 140));
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
 * 四大模式【非对称真实建筑分区】清单（彻底打破三列对称盒子感，还原超市/百货/地铁轨行区/医院科室/航站楼不规则平面图）
 */
export function getArchZones(mode: SiegeModeId): ArchZoneSpec[] {
  if (mode === "scavenge") {
    return [
      // 西南大型综合生活超市 (460px 宽非对称主力店 + 西北冷链库房隔间)
      { x: 262, y: 1942, w: 456, h: 476, kind: "shop", floorStyle: "tile_warm" },
      { x: 262, y: 1942, w: 155, h: 150, kind: "shop", floorStyle: "slate" },
      // 东南数码电器体验馆
      { x: 1212, y: 2002, w: 326, h: 316, kind: "shop", floorStyle: "wood" },
      // 偏东错位南扶梯天井 + 偏西中段跨层扶梯井（告别死板居中对齐！）
      { x: 850, y: 2090, w: 220, h: 230, kind: "atrium_pit" },
      { x: 690, y: 1710, w: 260, h: 140, kind: "atrium_pit" },
      // 东翼美食广场餐饮区 + 后厨不锈钢备餐区
      { x: 1062, y: 1362, w: 476, h: 496, kind: "shop", floorStyle: "checker" },
      { x: 1418, y: 1362, w: 120, h: 320, kind: "shop", floorStyle: "slate" },
      // 西中段潮流服饰买手店与试衣间
      { x: 262, y: 1480, w: 326, h: 368, kind: "shop", floorStyle: "wood" },
      // 偏东错位北采光扶梯天井
      { x: 820, y: 1090, w: 260, h: 220, kind: "atrium_pit" },
      // 西北连锁医药超市与急诊药房
      { x: 262, y: 852, w: 446, h: 456, kind: "shop", floorStyle: "clinical" },
      // 东北巨幕影城售票检票大厅 + 北部 IMAX 放映厅红毯区
      { x: 1162, y: 822, w: 376, h: 416, kind: "shop", floorStyle: "carpet" },
      { x: 340, y: 180, w: 1120, h: 538, kind: "shop", floorStyle: "carpet" },
      // 错落承重混凝土柱网
      { x: 772, y: 2220, w: 26, h: 26, kind: "pillar" },
      { x: 1120, y: 1940, w: 26, h: 26, kind: "pillar" },
      { x: 642, y: 1580, w: 26, h: 26, kind: "pillar" },
      { x: 752, y: 1210, w: 26, h: 26, kind: "pillar" },
      { x: 1105, y: 960, w: 26, h: 26, kind: "pillar" },
    ];
  }

  if (mode === "blackout") {
    return [
      // 东站务票务控制中心
      { x: 1132, y: 1962, w: 376, h: 416, kind: "shop", floorStyle: "slate" },
      // 西南地下便利店 (Konbini)
      { x: 292, y: 2010, w: 356, h: 328, kind: "shop", floorStyle: "tile_warm" },
      // 贯通南北的真实【下沉双线地铁轨行区】+ 中央跨轨行人过街天桥连廊！
      { x: 710, y: 1990, w: 280, h: 350, kind: "atrium_pit" },
      { x: 706, y: 1830, w: 288, h: 160, kind: "bridge_deck" },
      { x: 710, y: 1450, w: 280, h: 380, kind: "atrium_pit" },
      // 西中段地下居酒屋拉面街与杂货铺
      { x: 292, y: 1402, w: 336, h: 456, kind: "shop", floorStyle: "wood" },
      // 北换乘扶梯井
      { x: 710, y: 1090, w: 280, h: 220, kind: "atrium_pit" },
      // 东北高压变电配电所
      { x: 1112, y: 842, w: 396, h: 476, kind: "shop", floorStyle: "clinical" },
      // 北部地铁折返线终点大厅
      { x: 350, y: 180, w: 1100, h: 538, kind: "shop", floorStyle: "slate" },
      { x: 656, y: 2180, w: 26, h: 26, kind: "pillar" },
      { x: 1042, y: 1620, w: 26, h: 26, kind: "pillar" },
      { x: 1042, y: 1180, w: 26, h: 26, kind: "pillar" },
    ];
  }

  if (mode === "sonar") {
    return [
      // 西南 6 床位急诊创伤抢救大厅
      { x: 242, y: 1942, w: 456, h: 456, kind: "shop", floorStyle: "clinical" },
      // 偏东分诊导医台中庭 + 东输液留观室
      { x: 830, y: 2080, w: 250, h: 240, kind: "atrium_pit" },
      { x: 1200, y: 2000, w: 358, h: 318, kind: "shop", floorStyle: "tile_warm" },
      // 中段中心药房取药岛
      { x: 720, y: 1710, w: 260, h: 140, kind: "atrium_pit" },
      // 东翼双手术室无菌外科中心 + 洗手准备间
      { x: 1102, y: 1382, w: 456, h: 476, kind: "shop", floorStyle: "clinical" },
      { x: 1380, y: 1620, w: 178, h: 238, kind: "shop", floorStyle: "slate" },
      // 西翼核磁共振 (MRI) 影像中心
      { x: 242, y: 992, w: 416, h: 446, kind: "shop", floorStyle: "slate" },
      // 中北重症监护采光井
      { x: 780, y: 1110, w: 280, h: 220, kind: "atrium_pit" },
      // 东北冷链血库与病理太平间
      { x: 1142, y: 782, w: 416, h: 546, kind: "shop", floorStyle: "clinical" },
      // 北部三级生物隔离穹顶大厅
      { x: 320, y: 180, w: 1160, h: 498, kind: "shop", floorStyle: "slate" },
      { x: 752, y: 2210, w: 26, h: 26, kind: "pillar" },
      { x: 1035, y: 1580, w: 26, h: 26, kind: "pillar" },
      { x: 712, y: 1220, w: 26, h: 26, kind: "pillar" },
    ];
  }

  if (mode === "maze-infect") {
    return [
      // 南区 A/B/C 三通道安检大厅地坪
      { x: 282, y: 2120, w: 406, h: 730, kind: "shop", floorStyle: "slate" },
      { x: 692, y: 2120, w: 416, h: 730, kind: "shop", floorStyle: "tile_warm" },
      { x: 1112, y: 2120, w: 406, h: 730, kind: "shop", floorStyle: "slate" },
      // 偏西免税名品中岛专柜
      { x: 700, y: 1740, w: 330, h: 160, kind: "atrium_pit" },
      // 东翼 D12 登机口候机大厅
      { x: 1122, y: 1452, w: 396, h: 466, kind: "shop", floorStyle: "carpet" },
      // 西翼头等舱行政酒廊 (VIP Lounge)
      { x: 282, y: 1022, w: 366, h: 446, kind: "shop", floorStyle: "wood" },
      // 北航站楼采光井
      { x: 770, y: 1120, w: 290, h: 230, kind: "atrium_pit" },
      // 东北国际边检联检大厅
      { x: 1142, y: 762, w: 376, h: 586, kind: "shop", floorStyle: "clinical" },
      // 北部主航站指廊圆厅
      { x: 340, y: 180, w: 1120, h: 518, kind: "shop", floorStyle: "carpet" },
      { x: 605, y: 1780, w: 26, h: 26, kind: "pillar" },
      { x: 1072, y: 1240, w: 26, h: 26, kind: "pillar" },
    ];
  }

  return [];
}

/**
 * 四大模式【高密度真实室内陈设家具清单】（货架走廊、收银传送带、翻倒餐桌椅、绿植花坛、自动售货机、脱轨地铁列车、检票闸机、医院病床隔帘、无影灯手术台、核磁共振仪、机场联排座椅、X光安检机等）
 */
export function getInteriorProps(mode: SiegeModeId): InteriorPropSpec[] {
  if (mode === "scavenge") {
    return [
      // 南入口门厅：可撞碎玻璃促销展柜、散落购物车、绿植花坛与售货机
      { x: 845, y: 2635, w: 110, h: 16, kind: "glass_window", variant: 0 },
      { x: 865, y: 2475, w: 54, h: 38, kind: "cart_clutter", rot: 0.28 },
      { x: 665, y: 2535, w: 62, h: 62, kind: "planter", variant: 0 },
      { x: 1075, y: 2510, w: 52, h: 38, kind: "cart_clutter", rot: -0.42 },
      { x: 278, y: 2445, w: 56, h: 24, kind: "vending", variant: 0 },
      { x: 1465, y: 2445, w: 56, h: 24, kind: "vending", variant: 1 },

      // 西南主力超市：可击碎玻璃防风门屏 + 多排满载商品货架走廊 + 收银台传送带
      { x: 385, y: 2392, w: 120, h: 14, kind: "glass_window", variant: 1 },
      { x: 282, y: 2135, w: 42, h: 175, kind: "shelf_aisle", variant: 0 },
      { x: 555, y: 2145, w: 42, h: 170, kind: "shelf_aisle", variant: 1 },
      { x: 648, y: 2145, w: 42, h: 170, kind: "shelf_aisle", variant: 2 },
      { x: 285, y: 1968, w: 95, h: 36, kind: "shelf_aisle", variant: 3 },
      { x: 535, y: 1968, w: 135, h: 36, kind: "shelf_aisle", variant: 0 },
      { x: 332, y: 2340, w: 34, h: 56, kind: "checkout", variant: 0 },
      { x: 552, y: 2340, w: 34, h: 56, kind: "checkout", variant: 1 },
      { x: 458, y: 2225, w: 42, h: 34, kind: "cart_clutter", rot: -0.25 },

      // 东南数码店：展台与玻璃橱窗
      { x: 1218, y: 2015, w: 14, h: 115, kind: "glass_window", variant: 0 },
      { x: 1275, y: 2070, w: 120, h: 42, kind: "shelf_aisle", variant: 2 },
      { x: 1275, y: 2185, w: 120, h: 42, kind: "shelf_aisle", variant: 1 },
      { x: 1465, y: 2090, w: 42, h: 160, kind: "shelf_aisle", variant: 3 },

      // 中庭咖啡外摆区（交火区可打碎圆桌椅与玻璃屏风！）
      { x: 765, y: 2145, w: 56, h: 56, kind: "planter", variant: 1 },
      { x: 1110, y: 2140, w: 52, h: 52, kind: "round_table", rot: 0.2, variant: 0 },
      { x: 995, y: 1985, w: 52, h: 52, kind: "round_table", rot: 0.65, variant: 1 },
      { x: 1095, y: 1885, w: 52, h: 52, kind: "round_table", rot: -0.3, variant: 0 },
      { x: 1035, y: 1930, w: 14, h: 95, kind: "glass_window", variant: 1 },
      { x: 605, y: 1905, w: 56, h: 56, kind: "planter", variant: 0 },

      // 东翼美食广场：可击碎餐桌椅/卡座 + 玻璃隔断 + 后厨灶台 + 饮料机
      { x: 1250, y: 1835, w: 120, h: 14, kind: "glass_window", variant: 0 },
      { x: 1115, y: 1765, w: 52, h: 52, kind: "round_table", rot: 0.15, variant: 1 },
      { x: 1205, y: 1685, w: 52, h: 52, kind: "round_table", rot: 0.82, variant: 0 },
      { x: 1108, y: 1615, w: 76, h: 48, kind: "booth_table", variant: 0 },
      { x: 1215, y: 1555, w: 52, h: 52, kind: "round_table", rot: -0.45, variant: 1 },
      { x: 1115, y: 1388, w: 78, h: 48, kind: "booth_table", variant: 1 },
      { x: 1445, y: 1385, w: 72, h: 118, kind: "checkout", variant: 2 },
      { x: 1445, y: 1555, w: 72, h: 145, kind: "checkout", variant: 2 },
      { x: 1455, y: 1765, w: 62, h: 26, kind: "vending", variant: 2 },

      // 西中段服装精品店：圆形挂衣架与收银台
      { x: 315, y: 1555, w: 56, h: 56, kind: "clothes_rack", variant: 0 },
      { x: 435, y: 1565, w: 56, h: 56, kind: "clothes_rack", variant: 1 },
      { x: 315, y: 1695, w: 56, h: 56, kind: "clothes_rack", variant: 2 },
      { x: 445, y: 1715, w: 96, h: 38, kind: "checkout", variant: 0 },

      // 二层连廊绿植、长椅与玻璃护栏
      { x: 735, y: 1385, w: 56, h: 56, kind: "planter", variant: 1 },
      { x: 895, y: 1385, w: 92, h: 32, kind: "seat_row", variant: 0 },
      { x: 585, y: 1430, w: 14, h: 95, kind: "glass_window", variant: 1 },

      // 西北医药超市：玻璃门屏 + 药品货架矩阵
      { x: 415, y: 1285, w: 120, h: 14, kind: "glass_window", variant: 0 },
      { x: 282, y: 1065, w: 40, h: 175, kind: "shelf_aisle", variant: 3 },
      { x: 555, y: 1065, w: 40, h: 165, kind: "shelf_aisle", variant: 1 },
      { x: 642, y: 1065, w: 40, h: 165, kind: "shelf_aisle", variant: 3 },
      { x: 288, y: 882, w: 125, h: 38, kind: "checkout", variant: 1 },
      { x: 535, y: 882, w: 130, h: 36, kind: "shelf_aisle", variant: 2 },

      // 东北影城大厅与北部巨幕放映厅联排观众席
      { x: 1245, y: 920, w: 145, h: 46, kind: "checkout", variant: 0 },
      { x: 1365, y: 1060, w: 56, h: 56, kind: "round_table", rot: 0.3, variant: 1 },
      { x: 1465, y: 1020, w: 52, h: 26, kind: "vending", variant: 0 },
      { x: 390, y: 510, w: 220, h: 135, kind: "cinema_seats", variant: 0 },
      { x: 1190, y: 510, w: 220, h: 135, kind: "cinema_seats", variant: 1 },
      { x: 410, y: 310, w: 180, h: 110, kind: "cinema_seats", variant: 0 },
      { x: 1210, y: 310, w: 180, h: 110, kind: "cinema_seats", variant: 1 },
    ];
  }

  if (mode === "blackout") {
    return [
      // 南进站大厅：一排自动售票机 + 可打碎不锈钢检票三辊闸机群 + 玻璃安检屏风 + 散落行李
      { x: 310, y: 2420, w: 28, h: 160, kind: "vending", variant: 1 },
      { x: 420, y: 2358, w: 250, h: 34, kind: "turnstile_row", variant: 0 },
      { x: 1030, y: 2430, w: 185, h: 34, kind: "turnstile_row", variant: 1 },
      { x: 845, y: 2635, w: 110, h: 14, kind: "glass_window", variant: 0 },
      { x: 735, y: 2485, w: 54, h: 40, kind: "cart_clutter", rot: 0.4 },

      // 下沉轨行区：真实 3 节编组不锈钢地铁列车（中段一节轻微脱轨偏转！）
      { x: 760, y: 2025, w: 84, h: 285, kind: "subway_train", rot: 0.02, variant: 0 },
      { x: 855, y: 2015, w: 84, h: 285, kind: "subway_train", rot: -0.05, variant: 1 },
      { x: 762, y: 1485, w: 84, h: 310, kind: "subway_train", rot: 0.08, variant: 0 },
      { x: 858, y: 1495, w: 84, h: 295, kind: "subway_train", rot: 0.0, variant: 1 },

      // 东站务控制中心：玻璃售票窗、弧形调度监控台、机柜与长椅
      { x: 1265, y: 2355, w: 120, h: 14, kind: "glass_window", variant: 1 },
      { x: 1435, y: 2040, w: 54, h: 180, kind: "transformer", variant: 0 },
      { x: 1165, y: 1995, w: 115, h: 40, kind: "checkout", variant: 1 },
      { x: 1035, y: 2140, w: 32, h: 96, kind: "seat_row", variant: 1 },

      // 西南地下便利店
      { x: 325, y: 2065, w: 40, h: 180, kind: "shelf_aisle", variant: 0 },
      { x: 445, y: 2085, w: 40, h: 165, kind: "shelf_aisle", variant: 2 },
      { x: 545, y: 2110, w: 68, h: 38, kind: "checkout", variant: 0 },

      // 西地下商业街（玻璃橱窗 + 居酒屋吧台 + 可碎餐桌 + 自动贩卖机群）
      { x: 405, y: 1835, w: 115, h: 14, kind: "glass_window", variant: 0 },
      { x: 308, y: 1525, w: 46, h: 195, kind: "checkout", variant: 2 },
      { x: 542, y: 1555, w: 52, h: 52, kind: "round_table", rot: 0.25, variant: 0 },
      { x: 542, y: 1705, w: 52, h: 52, kind: "round_table", rot: -0.4, variant: 1 },
      { x: 315, y: 1420, w: 120, h: 28, kind: "vending", variant: 2 },
      { x: 1120, y: 1640, w: 88, h: 54, kind: "booth_table", variant: 0 },
      { x: 1320, y: 1580, w: 44, h: 165, kind: "shelf_aisle", variant: 1 },

      // 东北高压变电所：重型油浸变压器阵列与高压开关柜
      { x: 1135, y: 1055, w: 58, h: 155, kind: "transformer", variant: 1 },
      { x: 1415, y: 1045, w: 62, h: 175, kind: "transformer", variant: 0 },
      { x: 1155, y: 875, w: 145, h: 48, kind: "transformer", variant: 2 },
      { x: 1365, y: 875, w: 115, h: 48, kind: "transformer", variant: 1 },

      // 北换乘大厅闸机与座椅
      { x: 420, y: 960, w: 220, h: 34, kind: "turnstile_row", variant: 0 },
      { x: 430, y: 520, w: 190, h: 110, kind: "transformer", variant: 2 },
      { x: 1180, y: 520, w: 190, h: 110, kind: "transformer", variant: 0 },
    ];
  }

  if (mode === "sonar") {
    return [
      // 急诊分诊南大厅：玻璃分诊隔断、导医接待台、联排候诊椅、倾倒担架轮椅
      { x: 845, y: 2635, w: 110, h: 14, kind: "glass_window", variant: 0 },
      { x: 1040, y: 2375, w: 155, h: 44, kind: "checkout", variant: 1 },
      { x: 585, y: 2545, w: 115, h: 34, kind: "seat_row", variant: 0 },
      { x: 1125, y: 2545, w: 115, h: 34, kind: "seat_row", variant: 0 },
      { x: 1225, y: 2445, w: 54, h: 38, kind: "cart_clutter", rot: 0.5 },

      // 西南 6 床位急诊抢救大厅（可击碎玻璃观察窗 + 病床枕头被单、输液架与蓝色隔帘！）
      { x: 390, y: 2375, w: 115, h: 14, kind: "glass_window", variant: 1 },
      { x: 258, y: 2265, w: 88, h: 50, kind: "hospital_bed", variant: 0 },
      { x: 258, y: 2155, w: 88, h: 50, kind: "hospital_bed", variant: 1 },
      { x: 258, y: 2045, w: 88, h: 50, kind: "hospital_bed", variant: 2 },
      { x: 585, y: 2275, w: 88, h: 50, kind: "hospital_bed", rot: Math.PI, variant: 1 },
      { x: 585, y: 2165, w: 88, h: 50, kind: "hospital_bed", rot: Math.PI, variant: 0 },
      { x: 515, y: 1958, w: 88, h: 48, kind: "hospital_bed", variant: 2 },

      // 东输液留观病房联排椅与病床
      { x: 1260, y: 2065, w: 135, h: 34, kind: "seat_row", variant: 0 },
      { x: 1260, y: 2165, w: 135, h: 34, kind: "seat_row", variant: 0 },
      { x: 1435, y: 2055, w: 88, h: 52, kind: "hospital_bed", rot: Math.PI, variant: 1 },

      // 东翼无菌外科中心：无菌观察玻璃窗 + 双无影灯手术台 + 麻醉推车
      { x: 1275, y: 1835, w: 115, h: 14, kind: "glass_window", variant: 0 },
      { x: 1130, y: 1665, w: 102, h: 68, kind: "surgical_set", variant: 0 },
      { x: 1135, y: 1425, w: 102, h: 68, kind: "surgical_set", variant: 1 },
      { x: 1420, y: 1420, w: 112, h: 42, kind: "shelf_aisle", variant: 3 },
      { x: 1420, y: 1680, w: 112, h: 46, kind: "checkout", variant: 2 },

      // 西中段住院走廊病床与药柜
      { x: 310, y: 1620, w: 92, h: 52, kind: "hospital_bed", variant: 0 },
      { x: 310, y: 1730, w: 92, h: 52, kind: "hospital_bed", variant: 2 },
      { x: 530, y: 1660, w: 42, h: 145, kind: "shelf_aisle", variant: 3 },

      // 西翼核磁共振 (MRI) 影像科：真实圆筒形超导磁体腔 + 滑轨检查床！
      { x: 272, y: 1145, w: 138, h: 105, kind: "mri_scanner", variant: 0 },
      { x: 280, y: 1018, w: 125, h: 38, kind: "checkout", variant: 1 },
      { x: 565, y: 1215, w: 58, h: 155, kind: "transformer", variant: 0 },

      // 东北冷链血库与太平间冷柜阵列
      { x: 1165, y: 810, w: 140, h: 44, kind: "shelf_aisle", variant: 3 },
      { x: 1465, y: 845, w: 62, h: 195, kind: "transformer", variant: 1 },
      { x: 1465, y: 1090, w: 62, h: 185, kind: "transformer", variant: 2 },

      // 北部隔离大厅医疗方舱阵列
      { x: 390, y: 470, w: 108, h: 72, kind: "surgical_set", variant: 0 },
      { x: 1290, y: 470, w: 108, h: 72, kind: "surgical_set", variant: 1 },
    ];
  }

  if (mode === "maze-infect") {
    return [
      // 南区 A/B/C 三条平行安检通道：X光行李机 + 可撞碎玻璃安检屏风 + 散落拉杆箱
      { x: 335, y: 2265, w: 64, h: 210, kind: "xray_checkpoint", variant: 0 },
      { x: 745, y: 2245, w: 64, h: 210, kind: "xray_checkpoint", variant: 1 },
      { x: 1395, y: 2265, w: 64, h: 210, kind: "xray_checkpoint", variant: 2 },
      { x: 520, y: 2635, w: 95, h: 14, kind: "glass_window", variant: 0 },
      { x: 910, y: 2635, w: 95, h: 14, kind: "glass_window", variant: 1 },
      { x: 1185, y: 2635, w: 95, h: 14, kind: "glass_window", variant: 0 },
      { x: 475, y: 2480, w: 52, h: 38, kind: "cart_clutter", rot: 0.3 },
      { x: 1015, y: 2460, w: 52, h: 38, kind: "cart_clutter", rot: -0.35 },
      { x: 1185, y: 2490, w: 52, h: 38, kind: "cart_clutter", rot: 0.22 },

      // 免税商业大厅：精品香水圆台、绿植花坛、玻璃幕墙
      { x: 420, y: 1985, w: 60, h: 60, kind: "clothes_rack", variant: 1 },
      { x: 615, y: 1975, w: 56, h: 56, kind: "planter", variant: 0 },
      { x: 1075, y: 1965, w: 56, h: 56, kind: "planter", variant: 1 },
      { x: 545, y: 1715, w: 60, h: 60, kind: "clothes_rack", variant: 0 },
      { x: 365, y: 1715, w: 60, h: 60, kind: "clothes_rack", variant: 2 },

      // 东翼 D12 登机口候机厅：玻璃门屏 + 多排机场联排金属座椅 + 登机柜台 + 咖啡桌
      { x: 1265, y: 1895, w: 115, h: 14, kind: "glass_window", variant: 1 },
      { x: 1148, y: 1825, w: 104, h: 32, kind: "seat_row", variant: 0 },
      { x: 1148, y: 1715, w: 104, h: 32, kind: "seat_row", variant: 0 },
      { x: 1425, y: 1620, w: 68, h: 160, kind: "checkout", variant: 0 },
      { x: 1405, y: 1480, w: 52, h: 52, kind: "round_table", rot: 0.2, variant: 1 },

      // 西翼头等舱 VIP 行政酒廊：玻璃屏风 + 真皮 L 型转角沙发 + 实木茶几 + 雪茄吧台
      { x: 410, y: 1445, w: 115, h: 14, kind: "glass_window", variant: 0 },
      { x: 302, y: 1325, w: 88, h: 82, kind: "sofa_l", variant: 0 },
      { x: 302, y: 1150, w: 88, h: 82, kind: "sofa_l", variant: 1 },
      { x: 562, y: 1215, w: 50, h: 50, kind: "round_table", rot: -0.25, variant: 0 },
      { x: 315, y: 1042, w: 135, h: 38, kind: "checkout", variant: 2 },

      // 东北国际边检联检大厅：错落护照查验亭 + 排队闸机
      { x: 1165, y: 1155, w: 180, h: 34, kind: "turnstile_row", variant: 1 },
      { x: 1415, y: 980, w: 72, h: 145, kind: "checkout", variant: 1 },
      { x: 1215, y: 790, w: 155, h: 42, kind: "turnstile_row", variant: 0 },

      // 北部指廊圆厅联排候机座区
      { x: 410, y: 510, w: 185, h: 110, kind: "cinema_seats", variant: 0 },
      { x: 1205, y: 510, w: 185, h: 110, kind: "cinema_seats", variant: 1 },
    ];
  }

  return [];
}

/**
 * 四大模式真实建筑【推开态门扇与地面开门弧线 (`DoorwaySpec`)】
 * 让每一处商铺/科室/贵宾室出入口都拥有真实的门框、门槛踏板、90° 地面扫掠弧线与半开的玻璃门/防火门！
 */
export function getDoorways(mode: SiegeModeId): DoorwaySpec[] {
  if (mode === "scavenge") {
    return [
      { hx: 360, hy: 2420, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: true }, // 超市南双开玻璃门
      { hx: 720, hy: 1940, wallAngle: Math.PI * 0.5, width: 180, openSign: 1, doubleDoor: true, glass: true }, // 超市东北门
      { hx: 1225, hy: 1860, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: true }, // 美食城南门
      { hx: 1060, hy: 1360, wallAngle: Math.PI * 0.5, width: 195, openSign: -1, doubleDoor: true, glass: false }, // 美食城西北门
      { hx: 390, hy: 1310, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: true }, // 药店南门
      { hx: 710, hy: 850, wallAngle: Math.PI * 0.5, width: 185, openSign: 1, doubleDoor: true, glass: true }, // 药店东北门
      { hx: 750, hy: 720, wallAngle: 0, width: 300, openSign: -1, doubleDoor: true, glass: false }, // IMAX 巨幕厅大门
    ];
  }
  if (mode === "blackout") {
    return [
      { hx: 1245, hy: 2380, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: false }, // 站务室南防火门
      { hx: 1130, hy: 1960, wallAngle: Math.PI * 0.5, width: 170, openSign: -1, doubleDoor: true, glass: false }, // 站务室西北门
      { hx: 380, hy: 1860, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: true }, // 商业街南门
      { hx: 630, hy: 1400, wallAngle: Math.PI * 0.5, width: 180, openSign: 1, doubleDoor: true, glass: true }, // 商业街东北门
      { hx: 1220, hy: 1320, wallAngle: 0, width: 170, openSign: -1, doubleDoor: true, glass: false }, // 变电所南防爆门
      { hx: 1110, hy: 840, wallAngle: Math.PI * 0.5, width: 190, openSign: -1, doubleDoor: true, glass: false }, // 变电所西北门
      { hx: 750, hy: 720, wallAngle: 0, width: 300, openSign: -1, doubleDoor: true, glass: false }, // 北终点厅大门
    ];
  }
  if (mode === "sonar") {
    return [
      { hx: 360, hy: 2400, wallAngle: 0, width: 175, openSign: -1, doubleDoor: true, glass: true }, // 急诊大厅南医用自动门
      { hx: 700, hy: 1940, wallAngle: Math.PI * 0.5, width: 185, openSign: 1, doubleDoor: true, glass: true }, // 急诊东北门
      { hx: 1245, hy: 1860, wallAngle: 0, width: 175, openSign: -1, doubleDoor: true, glass: false }, // 手术中心气密门
      { hx: 1100, hy: 1380, wallAngle: Math.PI * 0.5, width: 185, openSign: -1, doubleDoor: true, glass: false }, // 手术中心西北门
      { hx: 360, hy: 1440, wallAngle: 0, width: 175, openSign: -1, doubleDoor: true, glass: false }, // 核磁科铅防护门
      { hx: 660, hy: 990, wallAngle: Math.PI * 0.5, width: 180, openSign: 1, doubleDoor: true, glass: false }, // 核磁科东北门
      { hx: 750, hy: 680, wallAngle: 0, width: 300, openSign: -1, doubleDoor: true, glass: false }, // 北隔离穹顶大门
    ];
  }
  if (mode === "maze-infect") {
    return [
      { hx: 1235, hy: 1920, wallAngle: 0, width: 175, openSign: -1, doubleDoor: true, glass: true }, // D12 登机厅南玻璃门
      { hx: 1120, hy: 1450, wallAngle: Math.PI * 0.5, width: 180, openSign: -1, doubleDoor: true, glass: true }, // D12 西北门
      { hx: 380, hy: 1470, wallAngle: 0, width: 175, openSign: -1, doubleDoor: true, glass: true }, // 头等舱酒廊南木门
      { hx: 650, hy: 1020, wallAngle: Math.PI * 0.5, width: 185, openSign: 1, doubleDoor: true, glass: true }, // 头等舱酒廊东北门
      { hx: 750, hy: 700, wallAngle: 0, width: 300, openSign: -1, doubleDoor: true, glass: true }, // 主航站圆厅大门
    ];
  }
  return [];
}

/**
 * 真实散落分布的【单人焊接铁笼 (`囚笼+1`)】清单（每笼关押 1 名真实幸存者，带自然摆放倾角 `rot`，彻底告别虚假克隆法阵与制式化大圆圈！）
 */
export function getTacticalNodeSpecs(mode: SiegeModeId): TacticalNodeSpec[] {
  const cage = (id: string, x: number, y: number, rot: number, role: GreenRole = "rifle"): TacticalNodeSpec => ({
    id,
    kind: "rescue_cage",
    label: "+1",
    subLabel: "",
    x,
    y,
    r: 21,
    hp: 420,
    rewardValue: 1,
    rewardRole: role,
    rot,
  });

  if (mode === "scavenge") {
    return [
      // 西南综合超市货架间与冷链库房 (4 座 +1 铁笼)
      cage("c1", 355, 2265, 0.14, "rifle"),
      cage("c2", 505, 2175, -0.18, "shotgun"),
      cage("c3", 355, 2025, 0.22, "rifle"),
      cage("c4", 595, 2035, -0.10, "rifle"),
      // 中庭咖啡外摆区 (2 座 +1 铁笼)
      cage("c5", 895, 1945, 0.16, "shotgun"),
      cage("c6", 1185, 1925, -0.20, "rifle"),
      // 东翼美食广场餐桌与后厨门口 (4 座 +1 铁笼)
      cage("c7", 1365, 1775, -0.14, "rifle"),
      cage("c8", 1285, 1650, 0.19, "shotgun"),
      cage("c9", 1385, 1525, -0.16, "sniper"),
      cage("c10", 1165, 1455, 0.12, "rifle"),
      // 二层天桥连廊与西北医药超市 (4 座 +1 铁笼)
      cage("c11", 695, 1475, -0.15, "rifle"),
      cage("c12", 425, 1215, 0.18, "shotgun"),
      cage("c13", 505, 1085, -0.22, "sniper"),
      cage("c14", 425, 950, 0.11, "rifle"),
      // 北部影城检票厅前 (2 座 +1 铁笼 -> 共 16 座 +1 铁笼 = 22 人满编小队！)
      cage("c15", 795, 925, -0.17, "sniper"),
      cage("c16", 995, 865, 0.15, "rifle"),
    ];
  }

  if (mode === "blackout") {
    return [
      // 东站务室：1 座重机枪武器柜 (+2) + 2 座 +1 铁笼
      { id: "b1", kind: "bunker_pad", label: "+2", subLabel: "", x: 1365, y: 2235, r: 26, hp: 720, rewardValue: 2, rewardRole: "turret", rot: -0.08 },
      cage("c1", 1225, 2165, 0.16, "rifle"),
      cage("c2", 1365, 2035, -0.14, "shotgun"),
      // 跨轨过街天桥与西居酒屋商业街 (5 座 +1 铁笼)
      cage("c3", 985, 1915, 0.18, "rifle"),
      cage("c4", 665, 1905, -0.19, "rifle"),
      cage("c5", 425, 1765, 0.15, "shotgun"),
      cage("c6", 485, 1625, -0.21, "rifle"),
      cage("c7", 435, 1485, 0.12, "sniper"),
      // 北换乘连廊与东北高压变电所 (6 座 +1 铁笼)
      cage("c8", 855, 1385, -0.16, "rifle"),
      cage("c9", 1255, 1225, 0.20, "shotgun"),
      cage("c10", 1345, 1095, -0.15, "sniper"),
      cage("c11", 1245, 955, 0.14, "rifle"),
      cage("c12", 1005, 885, -0.18, "sniper"),
      cage("c13", 815, 855, 0.17, "rifle"),
    ];
  }

  if (mode === "sonar") {
    return [
      // 西南急诊创伤抢救病床间 (4 座 +1 铁笼)
      cage("c1", 395, 2285, 0.15, "rifle"),
      cage("c2", 505, 2175, -0.19, "shotgun"),
      cage("c3", 395, 2045, 0.21, "rifle"),
      cage("c4", 615, 2025, -0.12, "rifle"),
      // 分诊大厅与东无菌手术中心 (5 座 +1 铁笼)
      cage("c5", 1045, 1935, 0.14, "shotgun"),
      cage("c6", 1345, 1765, -0.18, "rifle"),
      cage("c7", 1285, 1635, 0.16, "shotgun"),
      cage("c8", 1345, 1505, -0.20, "sniper"),
      cage("c9", 1015, 1475, 0.13, "rifle"),
      // 西核磁共振中心与东北冷链血库 (7 座 +1 铁笼 -> 共 16 座 +1 铁笼！)
      cage("c10", 675, 1465, -0.17, "rifle"),
      cage("c11", 465, 1325, 0.19, "shotgun"),
      cage("c12", 445, 1165, -0.15, "sniper"),
      cage("c13", 885, 1045, 0.12, "rifle"),
      cage("c14", 1255, 1035, -0.18, "sniper"),
      cage("c15", 1365, 915, 0.16, "rifle"),
      cage("c16", 985, 855, -0.14, "sniper"),
    ];
  }

  if (mode === "maze-infect") {
    return [
      // A/B/C 三条安检通道出口各 1 座被困旅客铁笼 (+1 × 3)
      cage("c1", 535, 2155, 0.16, "rifle"),
      cage("c2", 925, 2145, -0.14, "shotgun"),
      cage("c3", 1265, 2155, 0.19, "rifle"),
      // 三路小队在免税中庭汇合后激活「x2 战术集结通讯站」实现兵力翻倍！
      { id: "m1", kind: "multiply_crystal", label: "x2", subLabel: "", x: 1125, y: 2005, r: 24, hp: 520, rewardValue: 2, rot: 0 },
      // 东翼 D12 登机口重武器补给箱 (+2 重机枪手) + 1 座铁笼
      { id: "b1", kind: "bunker_pad", label: "+2", subLabel: "", x: 1335, y: 1735, r: 25, hp: 620, rewardValue: 2, rewardRole: "turret", rot: 0.08 },
      cage("c4", 1325, 1555, -0.15, "sniper"),
      // 西头等舱行政酒廊被困贵宾 (+1 x 2)
      cage("c5", 455, 1345, -0.15, "rifle"),
      cage("c6", 465, 1185, 0.20, "sniper"),
      // 东北国际边检厅重武器补给箱 (+2) 与主圆厅门前集结通讯站 (+3)
      { id: "b2", kind: "bunker_pad", label: "+2", subLabel: "", x: 1335, y: 935, r: 25, hp: 620, rewardValue: 2, rewardRole: "turret", rot: -0.09 },
      { id: "m2", kind: "multiply_crystal", label: "+3", subLabel: "", x: 985, y: 845, r: 23, hp: 480, rewardValue: 3, rot: 0 },
    ];
  }

  return [
    cage("c1", 820, 2240, 0.14, "rifle"),
    cage("c2", 980, 1980, -0.16, "shotgun"),
    cage("c3", 820, 1680, 0.18, "rifle"),
    cage("c4", 980, 1380, -0.15, "sniper"),
    cage("c5", 860, 1040, 0.12, "rifle"),
  ];
}

/**
 * 四大死角模式【非对称真实建筑墙体结构（含库房隔间、贯通地铁轨行坑、双手术室隔墙、边检通道）】
 */
export function getDeadCornerWalls(mode: SiegeModeId): WallSegment[] {
  if (mode === "scavenge") {
    return [
      // 1. 西南综合生活超市 (x=260..720, y=1940..2420，南门 x=360..530，东北门 y=1940..2120) + 内部西北冷库隔墙
      { x1: 260, y1: 2420, x2: 360, y2: 2420 },
      { x1: 530, y1: 2420, x2: 720, y2: 2420 },
      { x1: 720, y1: 2120, x2: 720, y2: 2420 },
      { x1: 260, y1: 1940, x2: 720, y2: 1940 },
      { x1: 260, y1: 2090, x2: 390, y2: 2090 },

      // 2. 偏东错位南扶梯天井 (x=850..1070, y=2090..2320) + 防火卷帘
      { x1: 720, y1: 2320, x2: 850, y2: 2320 },
      { x1: 850, y1: 2090, x2: 1070, y2: 2090 },
      { x1: 850, y1: 2320, x2: 1070, y2: 2320 },
      { x1: 850, y1: 2090, x2: 850, y2: 2320 },
      { x1: 1070, y1: 2090, x2: 1070, y2: 2320 },
      { x1: 1070, y1: 2320, x2: 1210, y2: 2320 },

      // 3. 东南数码旗舰店 (x=1210..1540, y=2000..2320，西北门洞)
      { x1: 1210, y1: 2140, x2: 1210, y2: 2320 },
      { x1: 1210, y1: 2320, x2: 1540, y2: 2320 },
      { x1: 1340, y1: 2000, x2: 1540, y2: 2000 },

      // 4. 偏西中段跨层扶梯井 (x=690..950, y=1710..1850) + 西侧精品店隔墙
      { x1: 260, y1: 1850, x2: 690, y2: 1850 },
      { x1: 690, y1: 1710, x2: 950, y2: 1710 },
      { x1: 690, y1: 1850, x2: 950, y2: 1850 },
      { x1: 690, y1: 1710, x2: 690, y2: 1850 },
      { x1: 950, y1: 1710, x2: 950, y2: 1850 },
      { x1: 950, y1: 1850, x2: 1060, y2: 1850 },

      // 5. 东翼美食广场餐饮区 (x=1060..1540, y=1360..1860，南门 x=1225..1395，西北门 y=1360..1555) + 后厨隔断
      { x1: 1060, y1: 1860, x2: 1225, y2: 1860 },
      { x1: 1395, y1: 1860, x2: 1540, y2: 1860 },
      { x1: 1060, y1: 1555, x2: 1060, y2: 1860 },
      { x1: 1060, y1: 1360, x2: 1540, y2: 1360 },
      { x1: 1420, y1: 1520, x2: 1540, y2: 1520 },

      // 6. 西中段服装精品店门面墙 + 偏东错位北采光扶梯天井 (x=820..1080, y=1090..1310)
      { x1: 590, y1: 1610, x2: 590, y2: 1850 },
      { x1: 710, y1: 1310, x2: 820, y2: 1310 },
      { x1: 820, y1: 1090, x2: 1080, y2: 1090 },
      { x1: 820, y1: 1310, x2: 1080, y2: 1310 },
      { x1: 820, y1: 1090, x2: 820, y2: 1310 },
      { x1: 1080, y1: 1090, x2: 1080, y2: 1310 },
      { x1: 1080, y1: 1310, x2: 1540, y2: 1310 },

      // 7. 西北连锁医药超市 (x=260..710, y=850..1310，南门 x=390..560，东北门 y=850..1035)
      { x1: 260, y1: 1310, x2: 390, y2: 1310 },
      { x1: 560, y1: 1310, x2: 710, y2: 1310 },
      { x1: 710, y1: 1035, x2: 710, y2: 1310 },
      { x1: 260, y1: 850, x2: 710, y2: 850 },

      // 8. 东北影城大厅与北部 IMAX 巨幕放映厅大门 (y=720)
      { x1: 1160, y1: 990, x2: 1160, y2: 1240 },
      { x1: 1160, y1: 820, x2: 1540, y2: 820 },
      { x1: 260, y1: 720, x2: 750, y2: 720 },
      { x1: 1050, y1: 720, x2: 1540, y2: 720 },
    ];
  }

  if (mode === "blackout") {
    return [
      // 1. 东侧站务票务控制中心 (x=1130..1510, y=1960..2380，南门 x=1245..1415，西北门 y=1960..2130)
      { x1: 1130, y1: 2380, x2: 1245, y2: 2380 },
      { x1: 1415, y1: 2380, x2: 1510, y2: 2380 },
      { x1: 1130, y1: 2130, x2: 1130, y2: 2380 },
      { x1: 1130, y1: 1960, x2: 1510, y2: 1960 },

      // 2. 南段下沉地铁轨行区护栏 (x=710..990, y=1990..2340) + 检票闸机封锁线
      { x1: 290, y1: 2340, x2: 710, y2: 2340 },
      { x1: 710, y1: 1990, x2: 990, y2: 1990 },
      { x1: 710, y1: 2340, x2: 990, y2: 2340 },
      { x1: 710, y1: 1990, x2: 710, y2: 2340 },
      { x1: 990, y1: 1990, x2: 990, y2: 2340 },
      { x1: 990, y1: 2340, x2: 1130, y2: 2340 },

      // 3. 北段下沉地铁轨行区护栏 (x=710..990, y=1450..1830，与南段之间留出 y=1830..1990 跨轨过街天桥！)
      { x1: 710, y1: 1450, x2: 990, y2: 1450 },
      { x1: 710, y1: 1830, x2: 990, y2: 1830 },
      { x1: 710, y1: 1450, x2: 710, y2: 1830 },
      { x1: 990, y1: 1450, x2: 990, y2: 1830 },
      { x1: 990, y1: 1830, x2: 1510, y2: 1830 },

      // 4. 西地下居酒屋商业街 (x=290..630, y=1400..1860，南门 x=380..550，东北门 y=1400..1580)
      { x1: 290, y1: 1860, x2: 380, y2: 1860 },
      { x1: 550, y1: 1860, x2: 630, y2: 1860 },
      { x1: 630, y1: 1580, x2: 630, y2: 1860 },
      { x1: 290, y1: 1400, x2: 630, y2: 1400 },

      // 5. 北换乘扶梯井 (x=710..990, y=1090..1310) + 西卷帘门
      { x1: 290, y1: 1310, x2: 710, y2: 1310 },
      { x1: 710, y1: 1090, x2: 990, y2: 1090 },
      { x1: 710, y1: 1310, x2: 990, y2: 1310 },
      { x1: 710, y1: 1090, x2: 710, y2: 1310 },
      { x1: 990, y1: 1090, x2: 990, y2: 1310 },
      { x1: 990, y1: 1320, x2: 1220, y2: 1320 },

      // 6. 东北高压变电配电所 (x=1110..1510, y=840..1320，南门 x=1220..1390，西北门 y=840..1030)
      { x1: 1390, y1: 1320, x2: 1510, y2: 1320 },
      { x1: 1110, y1: 1030, x2: 1110, y2: 1320 },
      { x1: 1110, y1: 840, x2: 1510, y2: 840 },

      // 7. 北部地铁终点折返大厅大门 (y=720)
      { x1: 290, y1: 720, x2: 750, y2: 720 },
      { x1: 1050, y1: 720, x2: 1510, y2: 720 },
    ];
  }

  if (mode === "sonar") {
    return [
      // 1. 西南 6 床位急诊创伤抢救大厅 (x=240..700, y=1940..2400，南门 x=360..535，东北门 y=1940..2125)
      { x1: 240, y1: 2400, x2: 360, y2: 2400 },
      { x1: 535, y1: 2400, x2: 700, y2: 2400 },
      { x1: 700, y1: 2125, x2: 700, y2: 2400 },
      { x1: 240, y1: 1940, x2: 700, y2: 1940 },

      // 2. 偏东分诊导医台中岛 (x=830..1080, y=2080..2320) + 东输液病房隔墙
      { x1: 700, y1: 2320, x2: 830, y2: 2320 },
      { x1: 830, y1: 2080, x2: 1080, y2: 2080 },
      { x1: 830, y1: 2320, x2: 1080, y2: 2320 },
      { x1: 830, y1: 2080, x2: 830, y2: 2320 },
      { x1: 1080, y1: 2080, x2: 1080, y2: 2320 },
      { x1: 1080, y1: 2320, x2: 1560, y2: 2320 },
      { x1: 1200, y1: 2140, x2: 1200, y2: 2320 },

      // 3. 中心药房取药岛 (x=720..980, y=1710..1850) + 西病房封锁墙
      { x1: 240, y1: 1850, x2: 720, y2: 1850 },
      { x1: 720, y1: 1710, x2: 980, y2: 1710 },
      { x1: 720, y1: 1850, x2: 980, y2: 1850 },
      { x1: 720, y1: 1710, x2: 720, y2: 1850 },
      { x1: 980, y1: 1710, x2: 980, y2: 1850 },
      { x1: 980, y1: 1850, x2: 1100, y2: 1850 },

      // 4. 东无菌外科手术中心 (x=1100..1560, y=1380..1860，南门 x=1245..1420，西北门 y=1380..1565) + 洗手间隔墙
      { x1: 1100, y1: 1860, x2: 1245, y2: 1860 },
      { x1: 1420, y1: 1860, x2: 1560, y2: 1860 },
      { x1: 1100, y1: 1565, x2: 1100, y2: 1860 },
      { x1: 1100, y1: 1380, x2: 1560, y2: 1380 },
      { x1: 1410, y1: 1620, x2: 1560, y2: 1620 },

      // 5. 西核磁共振中心 (x=240..660, y=990..1440，南门 x=360..535，东北门 y=990..1170) + 重症天井 + 东北血库
      { x1: 240, y1: 1440, x2: 360, y2: 1440 },
      { x1: 535, y1: 1440, x2: 660, y2: 1440 },
      { x1: 660, y1: 1170, x2: 660, y2: 1440 },
      { x1: 660, y1: 1330, x2: 780, y2: 1330 },
      { x1: 780, y1: 1110, x2: 1060, y2: 1110 },
      { x1: 780, y1: 1330, x2: 1060, y2: 1330 },
      { x1: 780, y1: 1110, x2: 780, y2: 1330 },
      { x1: 1060, y1: 1110, x2: 1060, y2: 1330 },
      { x1: 1060, y1: 1330, x2: 1560, y2: 1330 },
      { x1: 240, y1: 990, x2: 780, y2: 990 },
      { x1: 1140, y1: 1120, x2: 1140, y2: 1330 },
      { x1: 1140, y1: 780, x2: 1560, y2: 780 },

      // 6. 北生物隔离大厅正门 (y=680)
      { x1: 240, y1: 680, x2: 750, y2: 680 },
      { x1: 1050, y1: 680, x2: 1560, y2: 680 },
    ];
  }

  if (mode === "maze-infect") {
    return [
      // 1. 南区 A/B/C 三条平行安检通道隔墙 + X光机导流挡墙
      { x1: 690, y1: 2120, x2: 690, y2: 2980 },
      { x1: 1110, y1: 2120, x2: 1110, y2: 2980 },
      { x1: 280, y1: 2380, x2: 430, y2: 2380 },
      { x1: 690, y1: 2340, x2: 830, y2: 2340 },
      { x1: 1370, y1: 2380, x2: 1520, y2: 2380 },

      // 2. 偏西免税名品专柜岛台 (x=700..1030, y=1740..1900) + 西侧封锁墙
      { x1: 280, y1: 1900, x2: 700, y2: 1900 },
      { x1: 700, y1: 1740, x2: 1030, y2: 1740 },
      { x1: 700, y1: 1900, x2: 1030, y2: 1900 },
      { x1: 700, y1: 1740, x2: 700, y2: 1900 },
      { x1: 1030, y1: 1740, x2: 1030, y2: 1900 },
      { x1: 1030, y1: 1900, x2: 1120, y2: 1900 },

      // 3. 东翼 D12 登机口候机厅 (x=1120..1520, y=1450..1920，南门 x=1235..1410，西北门 y=1450..1630)
      { x1: 1120, y1: 1920, x2: 1235, y2: 1920 },
      { x1: 1410, y1: 1920, x2: 1520, y2: 1920 },
      { x1: 1120, y1: 1630, x2: 1120, y2: 1920 },
      { x1: 1120, y1: 1450, x2: 1520, y2: 1450 },

      // 4. 北航站楼采光井 (x=770..1060, y=1120..1350) + 东侧防火帘
      { x1: 650, y1: 1450, x2: 1120, y2: 1450 },
      { x1: 770, y1: 1120, x2: 1060, y2: 1120 },
      { x1: 770, y1: 1350, x2: 1060, y2: 1350 },
      { x1: 770, y1: 1120, x2: 770, y2: 1350 },
      { x1: 1060, y1: 1120, x2: 1060, y2: 1350 },

      // 5. 西头等舱行政酒廊 (x=280..650, y=1020..1470，南门 x=380..555，东北门 y=1020..1205)
      { x1: 280, y1: 1470, x2: 380, y2: 1470 },
      { x1: 555, y1: 1470, x2: 650, y2: 1470 },
      { x1: 650, y1: 1205, x2: 650, y2: 1470 },
      { x1: 280, y1: 1020, x2: 650, y2: 1020 },

      // 6. 东北国际边检厅与主航站圆厅大门 (y=700)
      { x1: 280, y1: 970, x2: 1140, y2: 970 },
      { x1: 1140, y1: 1120, x2: 1140, y2: 1350 },
      { x1: 1140, y1: 760, x2: 1520, y2: 760 },
      { x1: 280, y1: 700, x2: 750, y2: 700 },
      { x1: 1050, y1: 700, x2: 1520, y2: 700 },
    ];
  }

  return [];
}

export const DEAD_CORNER_WALLS: WallSegment[] = getDeadCornerWalls("scavenge");

/**
 * 非对称室内建筑逐店搜救 CQB 航点（穿梭货架走廊、过街天桥、病房床位与贵宾厅沙发，沿途逐一破锁解救 +1 铁笼幸存者！）
 */
export function getSquadWaypoints(mode: SiegeModeId): Array<{ x: number; y: number }> {
  if (mode === "scavenge") {
    return [
      { x: 900, y: 2540 },
      { x: 445, y: 2480 },
      { x: 445, y: 2030 },
      { x: 785, y: 2030 },
      { x: 785, y: 1930 },
      { x: 1310, y: 1930 },
      { x: 1310, y: 1465 },
      { x: 475, y: 1465 },
      { x: 475, y: 945 },
      { x: 900, y: 945 },
      { x: 900, y: 430 },
    ];
  }

  if (mode === "blackout") {
    return [
      { x: 900, y: 2540 },
      { x: 1330, y: 2475 },
      { x: 1330, y: 2045 },
      { x: 1060, y: 2045 },
      { x: 1060, y: 1910 },
      { x: 465, y: 1910 },
      { x: 465, y: 1490 },
      { x: 670, y: 1490 },
      { x: 670, y: 1380 },
      { x: 1305, y: 1380 },
      { x: 1305, y: 940 },
      { x: 900, y: 940 },
      { x: 900, y: 430 },
    ];
  }

  if (mode === "sonar") {
    return [
      { x: 900, y: 2540 },
      { x: 445, y: 2480 },
      { x: 445, y: 2030 },
      { x: 765, y: 2030 },
      { x: 765, y: 1935 },
      { x: 1330, y: 1935 },
      { x: 1330, y: 1475 },
      { x: 445, y: 1475 },
      { x: 445, y: 1055 },
      { x: 1345, y: 1055 },
      { x: 1345, y: 885 },
      { x: 900, y: 885 },
      { x: 900, y: 430 },
    ];
  }

  if (mode === "maze-infect") {
    return [
      { x: 900, y: 2560 },
      { x: 900, y: 2015 },
      { x: 1325, y: 2005 },
      { x: 1325, y: 1555 },
      { x: 465, y: 1555 },
      { x: 465, y: 1115 },
      { x: 710, y: 1115 },
      { x: 710, y: 1045 },
      { x: 1330, y: 1045 },
      { x: 1330, y: 865 },
      { x: 900, y: 865 },
      { x: 900, y: 435 },
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
  { spawnSec: 1.2, name: "重甲泰坦", hp: 1450, r: 28, speed: 1.52, xOffset: 0, ySpawn: 2060 },
  { spawnSec: 9.6, name: "狂暴泰坦", hp: 1850, r: 29, speed: 1.58, xOffset: -65, ySpawn: 1560 },
  { spawnSec: 15.2, name: "暗黑泰坦", hp: 2150, r: 30, speed: 1.55, xOffset: 65, ySpawn: 1060 },
  { spawnSec: 22.0, name: "终极尸王", hp: 3400, r: 36, speed: 1.48, xOffset: 0, ySpawn: 380, isFinalBoss: true },
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

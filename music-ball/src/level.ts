// 音频事件轴 -> 横版跑酷关卡。
// 世界坐标向右增长，y 向下；渲染器只消费这里生成的平台和目标点。

export interface AxisEvent {
  t_ms: number;
  strength: number;
  band: string;
  beat: boolean;
  downbeat: boolean;
}

export interface Platform {
  id: number;
  x: number;
  endX: number;
  topY: number;
  kind: "start" | "beat" | "drop" | "finish" | "safe";
  hue: [number, number, number];
}

export interface BeatTarget {
  id: number;
  tSec: number;
  x: number;
  y: number;
  strength: number;
  band: string;
  beat: boolean;
  downbeat: boolean;
  platformId: number;
}

export interface Level {
  duration: number;
  speed: number;
  worldEnd: number;
  platforms: Platform[];
  targets: BeatTarget[];
}

export interface LevelOptions {
  seed?: number;
  speed?: number;
  /** 事件之间至少间隔多少秒才切换一次平台 */
  transitionEvery?: number;
}

function rngFor(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hueFor(event: AxisEvent): [number, number, number] {
  if (event.downbeat) return [255, 192, 70];
  if (event.band === "perc") return [255, 112, 84];
  return [96, 208, 255];
}

/**
 * 生成平台：平台切换只发生在节拍/重拍附近，避免每个 onset 都制造碎平台。
 * transitionEvery 控制关卡复杂度；事件点本身仍全部保留为目标点。
 */
export function buildLevel(
  events: AxisEvent[],
  duration: number,
  options: LevelOptions = {},
): Level {
  const seed = options.seed ?? 17;
  const speed = options.speed ?? 270;
  const transitionEvery = options.transitionEvery ?? 1.35;
  const rand = rngFor(seed);
  const sorted = [...events].sort((a, b) => a.t_ms - b.t_ms);
  const laneYs = [390, 500, 620, 735];
  const transitionEvents: AxisEvent[] = [];
  let lastTransition = -Infinity;

  for (const event of sorted) {
    const t = event.t_ms / 1000;
    if (t - lastTransition >= transitionEvery && (event.beat || event.downbeat)) {
      transitionEvents.push(event);
      lastTransition = t;
    }
  }

  const platforms: Platform[] = [];
  const startY = 500;
  platforms.push({ id: 0, x: -500, endX: 0, topY: startY, kind: "start", hue: [90, 210, 255] });

  let previousX = 0;
  let previousY = startY;
  let platformId = 1;
  for (let i = 0; i < transitionEvents.length; i++) {
    const event = transitionEvents[i];
    const transitionX = Math.max(previousX + 320, event.t_ms / 1000 * speed);
    const gap = 54 + Math.round(rand() * 34);
    const endX = transitionX - gap;
    if (endX > previousX + 100) {
      const lane = laneYs[(i + Math.floor(rand() * 2)) % laneYs.length];
      const kind = lane > previousY + 70 ? "drop" : "beat";
      platforms.push({
        id: platformId++, x: previousX, endX, topY: previousY,
        kind, hue: kind === "drop" ? [150, 126, 255] : [80, 196, 255],
      });
      previousX = transitionX;
      previousY = lane;
    }
  }

  const endX = Math.max(previousX + 500, duration * speed + 260);
  platforms.push({ id: platformId++, x: previousX, endX, topY: previousY, kind: "finish", hue: [112, 240, 176] });
  // 安全底板：落空后真实下坠到这里，不会瞬移或结束视频。
  platforms.push({ id: platformId++, x: -1000, endX: endX + 1000, topY: 850, kind: "safe", hue: [54, 68, 104] });

  const targets: BeatTarget[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i];
    const tSec = event.t_ms / 1000;
    const x = Math.max(24, tSec * speed);
    // 目标落在 x 所在的可视平台上；安全底板只作为失败后的承接层。
    const platform = platforms
      .filter(p => p.kind !== "safe" && x >= p.x && x <= p.endX)
      .sort((a, b) => b.topY - a.topY)[0]
      ?? platforms[platforms.length - 1];
    targets.push({
      id: i,
      tSec,
      x,
      y: platform.topY,
      strength: Math.max(0, Math.min(1, event.strength)),
      band: event.band,
      beat: event.beat,
      downbeat: event.downbeat,
      platformId: platform.id,
    });
  }

  return { duration, speed, worldEnd: endX, platforms, targets };
}

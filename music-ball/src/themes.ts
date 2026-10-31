// 短视频批量生产：多套爆款霓虹视觉主题 + 主角球换装皮肤 + 顶部吸睛 Hook 文案库
import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";

export type MusicBallMode = "corridor" | "hopper" | "rings";
export type ThemeId = "cyber-neon" | "synthwave-sunset" | "emerald-matrix" | "crimson-void" | "aurora-ice";
export type BallSkinId = "visor-bot" | "star-core" | "vinyl-disc" | "plasma-orb" | "cat-neon";

export interface VisualTheme {
  id: ThemeId;
  name: string;
  bgTop: RGBA;
  bgMid: RGBA;
  bgBottom: RGBA;
  gridColor: RGBA;
  wallFill: RGBA;
  wallBorder: RGBA;
  primary: [number, number, number];     // 主节拍亮色
  secondary: [number, number, number];   // 次节拍亮色
  strong: [number, number, number];      // 强拍重音高光色
  accent: [number, number, number];      // 装饰/连击高光色
  ballCore: [number, number, number];
  ballRim: [number, number, number];
}

export const THEMES: Record<ThemeId, VisualTheme> = {
  "cyber-neon": {
    id: "cyber-neon",
    name: "赛博电光",
    bgTop: [6, 10, 26, 255],
    bgMid: [11, 18, 44, 255],
    bgBottom: [5, 8, 20, 255],
    gridColor: [45, 85, 165, 28],
    wallFill: [14, 24, 54, 245],
    wallBorder: [72, 185, 255, 210],
    primary: [68, 215, 255],
    secondary: [165, 118, 255],
    strong: [255, 210, 68],
    accent: [255, 95, 155],
    ballCore: [88, 225, 255],
    ballRim: [255, 220, 92],
  },
  "synthwave-sunset": {
    id: "synthwave-sunset",
    name: "落日合成器",
    bgTop: [22, 8, 38, 255],
    bgMid: [42, 14, 58, 255],
    bgBottom: [14, 6, 26, 255],
    gridColor: [185, 55, 145, 32],
    wallFill: [34, 14, 52, 245],
    wallBorder: [255, 92, 185, 215],
    primary: [255, 92, 188],
    secondary: [120, 220, 255],
    strong: [255, 195, 65],
    accent: [255, 115, 85],
    ballCore: [255, 110, 195],
    ballRim: [255, 225, 95],
  },
  "emerald-matrix": {
    id: "emerald-matrix",
    name: "极光矩阵",
    bgTop: [5, 20, 18, 255],
    bgMid: [9, 34, 30, 255],
    bgBottom: [4, 14, 12, 255],
    gridColor: [42, 165, 120, 30],
    wallFill: [10, 32, 28, 245],
    wallBorder: [64, 245, 175, 210],
    primary: [64, 245, 175],
    secondary: [72, 205, 255],
    strong: [255, 228, 82],
    accent: [165, 255, 95],
    ballCore: [72, 245, 180],
    ballRim: [255, 235, 110],
  },
  "crimson-void": {
    id: "crimson-void",
    name: "猩红超载",
    bgTop: [24, 7, 14, 255],
    bgMid: [40, 11, 22, 255],
    bgBottom: [14, 5, 10, 255],
    gridColor: [175, 45, 72, 30],
    wallFill: [36, 12, 22, 245],
    wallBorder: [255, 82, 108, 215],
    primary: [255, 86, 112],
    secondary: [255, 155, 68],
    strong: [255, 228, 92],
    accent: [95, 225, 255],
    ballCore: [255, 92, 118],
    ballRim: [255, 225, 95],
  },
  "aurora-ice": {
    id: "aurora-ice",
    name: "冰晶极夜",
    bgTop: [8, 16, 34, 255],
    bgMid: [14, 28, 56, 255],
    bgBottom: [6, 12, 24, 255],
    gridColor: [90, 165, 245, 30],
    wallFill: [16, 30, 62, 245],
    wallBorder: [130, 225, 255, 215],
    primary: [125, 230, 255],
    secondary: [175, 150, 255],
    strong: [255, 220, 98],
    accent: [110, 255, 210],
    ballCore: [140, 235, 255],
    ballRim: [255, 240, 150],
  },
};

export const THEME_IDS: ThemeId[] = [
  "cyber-neon",
  "synthwave-sunset",
  "emerald-matrix",
  "crimson-void",
  "aurora-ice",
];

export const BALL_SKIN_IDS: BallSkinId[] = [
  "visor-bot",
  "star-core",
  "vinyl-disc",
  "plasma-orb",
  "cat-neon",
];

export const BALL_SKIN_NAMES: Record<BallSkinId, string> = {
  "visor-bot": "机甲护目镜",
  "star-core": "星核脉冲球",
  "vinyl-disc": "黑胶律动球",
  "plasma-orb": "聚变电弧球",
  "cat-neon": "赛博猫耳球",
};

export const NOTE_NAMES = [
  "C4", "D4", "E4", "G4", "A4",
  "C5", "D5", "E5", "G5", "A5",
];

export const VIRAL_HOOKS: Record<MusicBallMode, string[]> = {
  corridor: [
    "戴上耳机 · 99%的人第3秒就沉陷了",
    "强迫症极度舒适 · 丝滑音阶折返",
    "戴上耳机听前奏 · 全程零失误踩点",
  ],
  hopper: [
    "每一跳都踩在鼓点上 · 极度舒适",
    "戴上耳机 · 感受重力音阶律动",
    "听完这15秒 · 强迫症极度解压",
  ],
  rings: [
    "小球能在音乐结束前冲出所有圆环吗？",
    "重拍破壁 · 强迫症极度解压",
    "看到最后一层圆环碎裂 · 极度舒适",
  ],
};

export const SOOTHING_HOOKS: Record<MusicBallMode, string[]> = {
  corridor: [
    "闭上眼 · 感受音符轻轻落下的治愈瞬间",
    "戴上耳机 · 丝滑钢琴音阶极度舒适",
    "静谧夜曲 · 全程零失误丝滑折返",
  ],
  hopper: [
    "闭上眼 · 感受音符轻轻落下的治愈瞬间",
    "戴上耳机 · 感受空灵音阶温柔律动",
    "听完这15秒 · 强迫症极度舒适解压",
  ],
  rings: [
    "看到最后一层圆环碎裂 · 极度舒适",
    "闭上眼 · 感受音符轻轻落下的治愈瞬间",
    "温柔破壁 · 听完这首心都静下来了",
  ],
};

export function pickTheme(seed: number, explicit?: ThemeId): VisualTheme {
  if (explicit && THEMES[explicit]) return THEMES[explicit];
  return THEMES[THEME_IDS[Math.abs(seed) % THEME_IDS.length]];
}

export function pickBallSkin(seed: number, explicit?: BallSkinId): BallSkinId {
  if (explicit && BALL_SKIN_IDS.includes(explicit)) return explicit;
  return BALL_SKIN_IDS[Math.abs(seed * 3 + 1) % BALL_SKIN_IDS.length];
}

export function drawFitText(
  fb: FrameBuf,
  font: FontAtlas,
  text: string,
  x: number,
  y: number,
  color: RGBA,
  maxWidth: number,
  targetScale: number,
  align: "left" | "center" | "right" = "left",
  outlineWidth = 2,
): void {
  const w1 = font.measure(text, 1);
  const scale = w1 > 0 ? Math.min(targetScale, maxWidth / w1) : targetScale;
  font.drawStyled(fb, text, x, y, color, scale, align, {
    outlineWidth,
    outlineColor: [4, 7, 18, 235],
    shadowOffset: [0, 3],
    shadowColor: [0, 0, 0, 165],
  });
}

/**
 * 绘制主角球（支持 5 套换装皮肤、运动方向形变 Squash & Stretch、碰撞高光、尾迹丝带）
 */
export function drawStylizedBall(
  fb: FrameBuf,
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  skin: BallSkinId,
  theme: VisualTheme,
  hitPulse: number, // 0..1 碰撞瞬间脉冲
  gameT: number,
): void {
  const speed = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  // 碰撞瞬间球体压扁回弹，飞行时沿速度方向轻微拉伸
  const stretch = hitPulse > 0.35
    ? 1 - (hitPulse - 0.35) * 0.36
    : 1 + Math.min(0.20, speed / 2600);
  const squash = 1 / Math.max(0.76, Math.min(1.26, stretch));

  const coreCol: [number, number, number] = hitPulse > 0.2
    ? theme.strong
    : theme.ballCore;

  // 外层霓虹辉光
  fb.drawGlowCircle(x, y, radius * (2.2 + hitPulse * 1.1), [
    coreCol[0],
    coreCol[1],
    coreCol[2],
    Math.round(115 + hitPulse * 95),
  ]);

  // 赛博猫耳皮肤：在球体上方两侧绘制发光猫耳
  if (skin === "cat-neon") {
    const earOffset = radius * 0.68;
    const earY = y - radius * 0.72;
    fb.fillCircle(x - earOffset, earY, radius * 0.42, [coreCol[0], coreCol[1], coreCol[2], 245]);
    fb.fillCircle(x + earOffset, earY, radius * 0.42, [coreCol[0], coreCol[1], coreCol[2], 245]);
    fb.fillCircle(x - earOffset, earY, radius * 0.22, [255, 160, 210, 255]);
    fb.fillCircle(x + earOffset, earY, radius * 0.22, [255, 160, 210, 255]);
  }

  // 外圈亮边与球体主体（带形变椭圆）
  fb.fillRotatedEllipse(
    x,
    y,
    radius * stretch + 3.5,
    radius * squash + 3.5,
    angle,
    [255, 255, 255, 248],
  );
  fb.fillRotatedEllipse(
    x,
    y,
    radius * stretch,
    radius * squash,
    angle,
    [coreCol[0], coreCol[1], coreCol[2], 255],
  );

  // 内层深色能量环与高光
  fb.fillRotatedEllipse(
    x - radius * 0.14,
    y - radius * 0.16,
    radius * 0.62 * stretch,
    radius * 0.56 * squash,
    angle,
    [255, 255, 255, 145],
  );

  const lookX = Math.max(-6, Math.min(6, (vx / 450) * 5));
  const lookY = Math.max(-5, Math.min(5, (vy / 550) * 4));

  if (skin === "visor-bot" || skin === "cat-neon") {
    // 赛博护目镜面罩
    fb.fillRoundRect(
      x - radius * 0.62 + lookX * 0.5,
      y - radius * 0.28 + lookY * 0.5,
      radius * 1.24,
      radius * 0.56,
      radius * 0.25,
      [10, 16, 36, 235],
    );
    const eyeCol: RGBA = hitPulse > 0.25
      ? [255, 235, 95, 255]
      : [110, 245, 255, 255];
    if (hitPulse > 0.35) {
      // 碰撞瞬间兴奋高光眼
      fb.fillCircle(x - radius * 0.26 + lookX, y + lookY * 0.6, 5.2, eyeCol);
      fb.fillCircle(x + radius * 0.26 + lookX, y + lookY * 0.6, 5.2, eyeCol);
      fb.fillCircle(x - radius * 0.26 + lookX, y + lookY * 0.6, 2.5, [255, 255, 255, 255]);
      fb.fillCircle(x + radius * 0.26 + lookX, y + lookY * 0.6, 2.5, [255, 255, 255, 255]);
    } else {
      fb.fillRoundRect(x - radius * 0.36 + lookX, y - 4 + lookY * 0.6, 8, 9, 3, eyeCol);
      fb.fillRoundRect(x + radius * 0.18 + lookX, y - 4 + lookY * 0.6, 8, 9, 3, eyeCol);
    }
  } else if (skin === "star-core") {
    // 星核脉冲球：内部旋转双十字星芒
    const rot = gameT * 4.5;
    for (let k = 0; k < 4; k++) {
      const a = rot + (k * Math.PI) / 2;
      fb.drawLine(
        x + Math.cos(a) * radius * 0.72,
        y + Math.sin(a) * radius * 0.72,
        x - Math.cos(a) * radius * 0.72,
        y - Math.sin(a) * radius * 0.72,
        4,
        [255, 250, 210, 240],
      );
    }
    fb.fillCircle(x, y, radius * 0.32, [255, 255, 255, 255]);
  } else if (skin === "vinyl-disc") {
    // 黑胶律动球：同心声纹环 + 亮色轴心
    fb.fillCircle(x, y, radius * 0.78, [14, 18, 34, 235]);
    fb.strokeRing(x, y, radius * 0.56, 2.2, [coreCol[0], coreCol[1], coreCol[2], 190]);
    fb.strokeRing(x, y, radius * 0.38, 1.8, [255, 220, 95, 190]);
    fb.fillCircle(x, y, radius * 0.22, [255, 220, 95, 255]);
    fb.fillCircle(x, y, radius * 0.08, [14, 18, 34, 255]);
  } else if (skin === "plasma-orb") {
    // 聚变电弧球：双轨道环绕光点
    const rot = gameT * 6.0;
    fb.strokeRing(x, y, radius * 0.64, 2.5, [255, 255, 255, 210]);
    for (let k = 0; k < 3; k++) {
      const a = rot + (k * Math.PI * 2) / 3;
      fb.fillCircle(
        x + Math.cos(a) * radius * 0.64,
        y + Math.sin(a) * radius * 0.64,
        4.5,
        [255, 240, 120, 255],
      );
    }
    fb.fillCircle(x, y, radius * 0.34, [255, 255, 255, 250]);
  }
}

/**
 * 绘制抖音/TikTok 爆款极简无框顶部视觉（去重框化 + 去底部进度条）：
 * 1. 顶部仅保留柔和暗角渐变 + 轻透磨砂小胶囊（曲名 & BPM）+ 无外框高对比度悬浮标题
 * 2. 节拍撞击时仅让中央连击数字或剩余圆环数随鼓点 Q 弹缩放（Beat-Pop），不遮挡主体物理视野
 * 3. 底部彻底移除假进度条（避免与抖音/TikTok 原生底部进度条和文案区冲突）
 */
export function drawShortVideoHud(
  fb: FrameBuf,
  atlas: FontAtlas,
  big: FontAtlas,
  opts: {
    mode: MusicBallMode;
    modeTitle: string;
    songTitle?: string;
    hookText: string;
    tempo: number;
    skinName: string;
    theme: VisualTheme;
    statusText: string;
    isHitStrong: boolean;
    isHitAny: boolean;
    hitPulse?: number;
    combo: number;
    maxCombo: number;
    progress: number;
    currentTime: number;
    duration: number;
    beatMarkers: { t: number; strong: boolean }[];
    extraMetricLabel: string;
    extraMetricValue: string;
    spectrum: number[];
  },
): void {
  const W = fb.w;
  const H = fb.h;
  const { theme } = opts;
  const pulse = opts.hitPulse ?? (opts.isHitStrong ? 0.85 : opts.isHitAny ? 0.45 : 0);

  // 1. 顶部双段柔和暗场过渡（无需厚重背景框即可保证文字清晰可读，同时柔和压暗滚入顶部的踏板/砖块）
  fb.blendGradientRect(0, 0, W, 160, [4, 7, 18, 240], [4, 7, 18, 185], true);
  fb.blendGradientRect(0, 160, W, 110, [4, 7, 18, 185], [4, 7, 18, 0], true);

  // 2. 顶部极简磨砂小胶囊：展示歌名/曲风 + BPM（轻巧不抢戏）
  const trackLabel = opts.songTitle
    ? `♫ ${opts.songTitle} · ${Math.round(opts.tempo)} BPM`
    : `♫ ${opts.modeTitle} · ${Math.round(opts.tempo)} BPM`;
  const pillW = Math.min(W - 160, Math.max(320, Math.round(atlas.measure(trackLabel, 0.34)) + 64));
  const pillX = Math.round((W - pillW) / 2);
  const pillY = 46;
  fb.fillRoundRect(pillX, pillY, pillW, 42, 21, [10, 16, 36, 155]);
  drawFitText(
    fb,
    atlas,
    trackLabel,
    W / 2,
    pillY + 7,
    [210, 232, 255, 235],
    pillW - 36,
    0.34,
    "center",
    2,
  );

  // 3. 顶部核心爆款悬浮钩子大字（无外框，纯描边高对比度呈现）
  drawFitText(
    fb,
    atlas,
    opts.hookText,
    W / 2,
    104,
    [255, 255, 255, 252],
    W - 96,
    0.52,
    "center",
    3,
  );

  // 4. 随节拍 Q 弹跳动的极简无框核心计数（Combo 或 破壁进度）
  const popScale = 1 + pulse * 0.22;
  const numColor: RGBA = opts.isHitStrong
    ? [theme.strong[0], theme.strong[1], theme.strong[2], 255]
    : opts.isHitAny
      ? [theme.primary[0], theme.primary[1], theme.primary[2], 255]
      : [235, 245, 255, 225];

  if (opts.mode === "rings") {
    drawFitText(
      fb,
      atlas,
      `${opts.extraMetricLabel}  ${opts.extraMetricValue}`,
      W / 2,
      168,
      numColor,
      460,
      0.44 * popScale,
      "center",
      2,
    );
  } else if (opts.combo > 0) {
    drawFitText(
      fb,
      big,
      `×${opts.combo}`,
      W / 2,
      162 - Math.round(pulse * 6),
      numColor,
      320,
      0.56 * popScale,
      "center",
      3,
    );
  }

  // 5. 底部彻底取消假进度条！仅保留极轻微的底边呼吸暗角，给平台原生文案/进度条留足干净空间
  fb.blendGradientRect(0, H - 120, W, 120, [4, 7, 18, 0], [4, 7, 18, 145], true);
}

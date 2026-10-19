// 节拍碰撞渲染器：完整二维世界 + 动态镜头 + 局部碰撞特效。
// 所有墙面/踏板在关卡生成时已存在；镜头视野只做裁剪，不按时间临时生成目标。
import { FrameBuf } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { synthSfx, writeWav } from "../../shared/audio/sfx.ts";
import { mixTracks, normalize } from "../../shared/audio/mixer.ts";
import { buildImpactLevel, type AxisEvent, type ImpactTarget, type ShaftWall } from "./impact-level.ts";
import { planSegments, sampleImpactMotion, type ImpactMotionFrame } from "./impact-motion.ts";
import { readFileSync } from "node:fs";

const W = 1920, H = 1080, FPS = 30, SR = 44100;
const INTRO = 1.1, OUTRO = 1.6;
interface Axis { meta: { duration_s: number; tempo: number; events: number }; events: AxisEvent[] }
interface Camera { x: number; y: number; zoom: number }

function readMonoWav(path: string): Float32Array {
  const bytes = readFileSync(path);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("music-ball needs WAV/PCM input");
  let p = 12, channels = 0, bits = 0, data = -1, size = 0;
  while (p + 8 <= bytes.length) {
    const id = bytes.toString("ascii", p, p + 4), n = bytes.readUInt32LE(p + 4), start = p + 8;
    if (id === "fmt ") { if (bytes.readUInt16LE(start) !== 1) throw new Error("only PCM WAV is supported"); channels = bytes.readUInt16LE(start + 2); bits = bytes.readUInt16LE(start + 14); }
    if (id === "data") { data = start; size = Math.min(n, bytes.length - start); break; }
    p = start + n + (n % 2);
  }
  if (data < 0 || channels < 1 || bits !== 16) throw new Error("invalid 16-bit PCM WAV");
  const count = Math.floor(size / 2 / channels), mono = new Float32Array(count);
  for (let i = 0; i < count; i++) { let s = 0; for (let c = 0; c < channels; c++) s += bytes.readInt16LE(data + (i * channels + c) * 2) / 32768; mono[i] = s / channels; }
  return mono;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function screen(worldX: number, worldY: number, cam: Camera): [number, number] {
  return [(worldX - cam.x) * cam.zoom + W * 0.43, (worldY - cam.y) * cam.zoom + H * 0.43];
}
function visible(x: number, y: number, margin = 180): boolean { return x > -margin && x < W + margin && y > -margin && y < H + margin; }

/** 根据当前球和未来两个目标的包围盒确定视野：稀疏时拉远、密集时拉近。 */
function desiredCamera(motion: ImpactMotionFrame, targets: ImpactTarget[], currentId: number, impactPulse: number): Camera {
  const ahead = targets.filter(t => t.id >= Math.max(0, currentId - 1)).slice(0, 4);
  const xs = [motion.x, ...ahead.map(t => t.x)], ys = [motion.y, ...ahead.map(t => t.y)];
  const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
  const fitX = 1050 / Math.max(520, spanX + 300), fitY = 610 / Math.max(360, spanY + 240);
  let zoom = clamp(Math.min(fitX, fitY), 0.70, 1.10);
  zoom *= 1 + impactPulse * 0.025; // 强拍只做很轻的局部推近
  const lead = ahead[1] ?? ahead[0];
  const lookX = lead ? motion.x * 0.66 + lead.x * 0.34 : motion.x;
  const lookY = lead ? motion.y * 0.72 + lead.y * 0.28 : motion.y;
  return { x: lookX, y: lookY, zoom };
}

/** 接触后的局部反馈：踏板压缩/回弹、环和方向性碎片，无全屏闪白。 */
function impactAge(target: ImpactTarget, gameT: number): number { return gameT - target.tSec; }
function impactPulse(target: ImpactTarget | undefined, gameT: number): number {
  if (!target) return 0;
  const age = Math.abs(gameT - target.tSec);
  return age < 0.24 ? 1 - age / 0.24 : 0;
}

function drawCorridorWall(fb: FrameBuf, wall: ShaftWall, cam: Camera, gameT: number): void {
  const x = Math.round((wall.x - cam.x) * cam.zoom + W * 0.43);
  const y = Math.round((wall.yStart + wall.yEnd) / 2 - cam.y);
  const length = (wall.yEnd - wall.yStart) * cam.zoom;
  if (!visible(x, H / 2, length / 2)) return;
  const c = wall.hue;
  // 纵向连续墙：厚基座、内沿灯带、按下坠方向排列的结构刻度。
  fb.fillRotatedRect(x, H * 0.43, wall.thickness * cam.zoom, length, 0, [c[0], c[1], c[2], 245]);
  const inner = wall.side === "left" ? x + wall.thickness * cam.zoom * 0.38 : x - wall.thickness * cam.zoom * 0.38;
  fb.fillRotatedRect(inner, H * 0.43, 10 * cam.zoom, length - 10, 0, [108, 142, 208, 235]);
  for (let mark = wall.yStart + 80; mark < wall.yEnd; mark += 150) {
    const sy = (mark - cam.y) * cam.zoom + H * 0.43;
    fb.fillRect(wall.side === "left" ? x + 8 : x - 48 * cam.zoom, sy, 40 * cam.zoom, 5 * cam.zoom, [185, 207, 255, 135]);
  }
}

function drawTarget(fb: FrameBuf, target: ImpactTarget, cam: Camera, gameT: number): void {
  const [x, y] = screen(target.x, target.y, cam);
  if (!visible(x, y, target.length * cam.zoom)) return;
  const age = impactAge(target, gameT);
  const active = age >= 0 && age < 0.30;
  const pulse = active ? 1 - age / 0.30 : 0;
  const [r, g, b] = target.hue;
  const compress = 1 - pulse * 0.24;
  const rebound = active ? Math.sin(clamp(age / 0.30, 0, 1) * Math.PI) * 8 : 0;
  const length = (target.tier === "strong" ? 168 : target.tier === "beat" ? 42 : 26) * cam.zoom;
  const thick = Math.max(7, (target.tier === "strong" ? 30 : target.tier === "beat" ? 12 : 9) * cam.zoom * compress);
  const angle = target.normalAngle;

  // 普通 beat/weak 只保留墙边短标记；大型独立结构只给 strong。
  fb.fillRotatedRect(x, y + rebound, length + (target.tier === "strong" ? 20 : 8) * cam.zoom, thick + 10 * cam.zoom, angle, [r, g, b, target.tier === "strong" ? 34 : 22]);
  fb.fillRotatedRect(x, y + rebound, length, thick, angle, [r, g, b, 255]);
  fb.fillRotatedRect(x, y + rebound - 3 * cam.zoom, length * 0.82, Math.max(3, thick * 0.20), angle, [245, 252, 255, 210]);

  if (active) {
    // 收缩的双冲击环。
    for (let ring = 0; ring < 2; ring++) {
      const rr = (28 + ring * 22 + age * 120) * cam.zoom;
      const alpha = Math.round((1 - age / 0.30) * (130 - ring * 34));
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        fb.blendCircle(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 3.2 * cam.zoom, [r, g, b, alpha]);
      }
    }
    // 碎片沿踏板法线喷射，位置完全确定，不使用随机数。
    const nx = Math.cos(angle - Math.PI / 2), ny = Math.sin(angle - Math.PI / 2);
    const tx = Math.cos(angle), ty = Math.sin(angle);
    const count = target.tier === "strong" ? 12 : 7;
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const speed = (36 + (i % 4) * 14) * age * 3.3 * cam.zoom;
      const spread = side * (10 + i * 3) * age * cam.zoom;
      const px = x + nx * speed + tx * spread;
      const py = y + ny * speed + ty * spread + 90 * age * age;
      const alpha = Math.round(220 * (1 - age / 0.30));
      fb.fillRotatedRect(px, py, 9 * cam.zoom, 4 * cam.zoom, angle + i * 0.37, [r, g, b, alpha]);
    }
  }
}

function drawAccent(fb: FrameBuf, target: ImpactTarget, cam: Camera): void {
  const [x, y] = screen(target.x, target.y, cam);
  if (!visible(x, y, 70)) return;
  const r = target.radius * cam.zoom;
  fb.blendCircle(x, y, r + 9 * cam.zoom, [target.hue[0], target.hue[1], target.hue[2], 30]);
  fb.fillCircle(x, y, r, [target.hue[0], target.hue[1], target.hue[2], 215]);
  fb.fillCircle(x - r * 0.25, y - r * 0.25, r * 0.25, [245, 238, 255, 210]);
}

function drawBall(fb: FrameBuf, motion: ImpactMotionFrame, cam: Camera, collision: ImpactTarget | undefined, gameT: number): void {
  const [x, y] = screen(motion.x, motion.y, cam);
  const age = collision ? Math.abs(gameT - collision.tSec) : 9;
  const hit = age < 0.16;
  const tierColor: [number, number, number] = collision?.tier === "strong" ? [255, 198, 70] : [96, 214, 255];
  const baseR = 28 * cam.zoom;
  // 撞击 squash，离开时 stretch：用旋转矩形+圆心模拟椭圆轮廓。
  const squeeze = hit ? Math.sin((1 - age / 0.16) * Math.PI / 2) : 0;
  const sx = 1 + squeeze * 0.35, sy = 1 - squeeze * 0.24;
  const trailBoost = hit ? 1.8 : 1;
  const mag = Math.max(1, Math.hypot(motion.vx, motion.vy));
  const ux = motion.vx / mag, uy = motion.vy / mag;
  for (let i = 6; i >= 1; i--) {
    const d = i * 18 * cam.zoom * trailBoost;
    fb.blendCircle(x - ux * d, y - uy * d, Math.max(3, baseR - i * 3.2 * cam.zoom), [tierColor[0], tierColor[1], tierColor[2], Math.round(52 / (i * 0.7))]);
  }
  const angle = Math.atan2(motion.vy, motion.vx);
  fb.fillRotatedEllipse(x, y, baseR * sx, baseR * sy, angle, [tierColor[0], tierColor[1], tierColor[2], 255]);
  // 高光和表情跟随球心，撞击时不会出现方形轮廓。
  fb.fillCircle(x - baseR * 0.30, y - baseR * 0.34, baseR * 0.30, [238, 255, 255, 235]);
  fb.fillCircle(x - baseR * 0.28, y - baseR * 0.02, Math.max(2, baseR * 0.12), [28, 45, 76, 255]);
  fb.fillCircle(x + baseR * 0.28, y - baseR * 0.02, Math.max(2, baseR * 0.12), [28, 45, 76, 255]);
  fb.fillRect(x - baseR * 0.28, y + baseR * 0.32, baseR * 0.56, Math.max(2, baseR * 0.10), [28, 45, 76, 255]);
}

export async function renderImpactMusicBall(axisPath: string, audioPath: string, outMp4: string, seed = 23): Promise<void> {
  const axis = JSON.parse(readFileSync(axisPath, "utf8")) as Axis;
  const level = buildImpactLevel(axis.events, axis.meta.duration_s, seed);
  const segments = planSegments(level, 760);
  const audio = readMonoWav(audioPath);
  const total = INTRO + axis.meta.duration_s + OUTRO;
  const frameCount = Math.ceil(total * FPS);
  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(fontDir + "atlas64.rgba", fontDir + "atlas64.json");
  const big = new FontAtlas(fontDir + "atlas96.rgba", fontDir + "atlas96.json");

  const tracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  for (const target of level.mainTargets) tracks.push({ pcm: synthSfx(target.tier === "strong" ? "crit" : "punch", 1200 + target.id), offsetSec: INTRO + target.tSec, gain: target.tier === "strong" ? 0.48 : 0.24 });
  const mixed = mixTracks(tracks, total);
  const audioOffset = Math.floor(INTRO * SR);
  for (let i = 0; i < audio.length && audioOffset + i < mixed.length; i++) mixed[audioOffset + i] += audio[i] * 0.90;
  const wav = "/tmp/music-ball-impact-mix.wav";
  writeWav(normalize(mixed, 0.9), wav);

  let lastImpact = -1, combo = 0, maxCombo = 0;
  let camera: Camera = { x: level.mainTargets[0]?.x ?? 0, y: level.mainTargets[0]?.y ?? 0, zoom: 0.82 };
  async function* frameGen() {
    for (let frame = 0; frame < frameCount; frame++) {
      const now = frame / FPS, gameT = now - INTRO;
      const motion = sampleImpactMotion(level, Math.max(0, gameT), { gravity: 760 }, segments);
      const nearest = level.mainTargets.reduce<ImpactTarget | undefined>((best, t) => !best || Math.abs(t.tSec - gameT) < Math.abs(best.tSec - gameT) ? t : best, undefined);
      const collision = nearest && Math.abs(nearest.tSec - gameT) < 0.18 ? nearest : undefined;
      if (collision && Math.abs(collision.tSec - gameT) <= 1 / FPS && collision.id !== lastImpact) { combo++; maxCombo = Math.max(maxCombo, combo); lastImpact = collision.id; }
      const pulse = impactPulse(collision, gameT);
      const wanted = desiredCamera(motion, level.mainTargets, motion.targetId, collision?.tier === "strong" ? pulse : pulse * 0.25);
      // 平滑镜头，不因目标切换突然跳变。
      camera.x += (wanted.x - camera.x) * 0.10;
      camera.y += (wanted.y - camera.y) * 0.10;
      camera.zoom += (wanted.zoom - camera.zoom) * 0.09;

      const fb = new FrameBuf(W, H, [8, 12, 30, 255]);
      if (now < INTRO) {
        big.draw(fb, "节拍碰撞", W / 2, 350, [255, 216, 90, 255], 1.7, "center");
        atlas.draw(fb, "完整世界 · 动态视野 · 局部碰撞特效", W / 2, 500, [150, 220, 255, 255], 0.72, "center");
        atlas.draw(fb, `${axis.meta.tempo} BPM · ${level.mainTargets.length + level.accents.length} 个世界物体`, W / 2, 590, [174, 184, 230, 255], 0.56, "center");
      } else {
        // 无限网格背景跟随完整世界，动态 zoom 也影响视差密度。
        const grid = 220 * camera.zoom;
        const sx = ((camera.x * 0.16 * camera.zoom) % grid + grid) % grid;
        const sy = ((camera.y * 0.14 * camera.zoom) % grid + grid) % grid;
        for (let x = -sx - grid; x < W + grid; x += grid) for (let y = -sy - grid; y < H + grid; y += grid) {
          fb.fillRect(x + 18, y + 18, grid * 0.64, grid * 0.56, [24, 35, 72, 150]);
        }

        // 所有物体始终存在，仅按视锥裁剪；不再按时间窗口隐藏。
        for (const accent of level.accents) drawAccent(fb, accent, camera);
        for (const wall of level.walls) drawCorridorWall(fb, wall, camera, gameT);
        for (const target of level.mainTargets) drawTarget(fb, target, camera, gameT);
        drawBall(fb, motion, camera, collision, gameT);

        fb.fillRect(0, 0, W, 118, [6, 10, 26, 225]);
        atlas.draw(fb, "AI 斗蛐蛐 · 节拍碰撞", 58, 28, [180, 220, 255, 255], 0.66);
        atlas.draw(fb, `${axis.meta.tempo} BPM`, 58, 74, [130, 168, 224, 255], 0.48);
        const status = collision?.tier === "strong" ? "重拍反弹" : collision ? "碰撞" : "寻找下一目标";
        atlas.draw(fb, status, W / 2, 36, collision?.tier === "strong" ? [255, 210, 76, 255] : [150, 220, 255, 255], 0.66, "center");
        atlas.draw(fb, `COMBO ${combo}`, W - 58, 28, [255, 208, 90, 255], 0.62, "right");
        atlas.draw(fb, `视野 ${(camera.zoom * 100).toFixed(0)}%`, W - 58, 74, [170, 194, 230, 255], 0.43, "right");
        fb.fillRect(0, H - 24, W, 24, [6, 10, 26, 255]);
        fb.fillRect(0, H - 24, Math.round(W * clamp(gameT / axis.meta.duration_s, 0, 1)), 24, [255, 190, 68, 255]);
      }
      if (gameT > axis.meta.duration_s) {
        const fade = clamp((gameT - axis.meta.duration_s) / OUTRO, 0, 1);
        fb.blendRect(0, 0, W, H, [5, 8, 20, Math.round(205 * fade)]);
        big.draw(fb, "节拍完成", W / 2, 390, [255, 220, 100, 255], 1.6, "center");
        atlas.draw(fb, `最大连击 ${maxCombo} · ${level.mainTargets.length + level.accents.length} 个世界物体`, W / 2, 540, [170, 220, 255, 255], 0.65, "center");
      }
      yield fb;
    }
  }
  await encodeFrames(frameGen(), { width: W, height: H, fps: FPS, outPath: outMp4, audioPath: wav, crf: 19 });
  console.log(`music-ball world rendered -> ${outMp4}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , axis, audio, out, seed] = process.argv;
  if (!axis || !audio || !out) throw new Error("usage: node music-ball/src/render.ts <axis.json> <song.wav> <out.mp4> [seed]");
  await renderImpactMusicBall(axis, audio, out, seed ? Number(seed) : 23);
}

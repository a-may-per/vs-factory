// music-ball 渲染器：吃 JSON 事件轴 → 小球横版跑酷踩点动画 → 1080x1920 竖屏成片。
// 布局：竖屏里赛道横向滚动，小球固定在画面左 1/3，敲击点从右侧迎面而来。
import { FrameBuf } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { synthSfx, writeWav } from "../../shared/audio/sfx.ts";
import { mixTracks, normalize } from "../../shared/audio/mixer.ts";
import type { SimEvent as _Unused } from "../../duel/src/sim.ts";
import { readFileSync } from "node:fs";

const W = 1080, H = 1920, FPS = 30;
const SR = 44100;

interface AxisEvent { t_ms: number; strength: number; band: string; beat: boolean; downbeat: boolean }
interface Axis { meta: { duration_s: number; tempo: number; events: number }; events: AxisEvent[] }

const BALL_X = 340;            // 小球屏幕 x
const TRACK_Y = 1240;          // 赛道基准线 y
const APPROACH_SEC = 1.6;      // 敲击点从右边进入的提前量

export async function renderMusicBall(axisPath: string, audioPath: string, outMp4: string): Promise<void> {
  const axis: Axis = JSON.parse(readFileSync(axisPath, "utf-8"));
  const evs = axis.events;
  const duration = axis.meta.duration_s;

  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(fontDir + "atlas64.rgba", fontDir + "atlas64.json");
  const atlasBig = new FontAtlas(fontDir + "atlas96.rgba", fontDir + "atlas96.json");

  const introSec = 1.0;
  const totalSec = introSec + duration + 1.5;
  const totalFrames = Math.ceil(totalSec * FPS);

  // ---------- 敲击点：把事件映射为赛道上的目标点 ----------
  // 视觉时间轴 = introSec + t_ms/1000。敲击点在击中时刻应位于 BALL_X。
  interface Hit { tSec: number; strength: number; band: string; beat: boolean; downbeat: boolean; y: number; hue: [number, number, number]; hitT: number }
  const hits: Hit[] = [];
  let lastY = TRACK_Y;
  for (const ev of evs) {
    const tSec = introSec + ev.t_ms / 1000;
    // y 在赛道带内随 strength 变化（强拍高一点）
    const band = ev.band === "perc" ? 1 : 0;
    // 蛇形路径：随时间正弦起伏 + 强度调幅
    const wave = Math.sin(ev.t_ms / 1000 * 1.4) * 190;
    let y = TRACK_Y - 120 + wave * 0.9 - (ev.downbeat ? 60 : ev.beat ? 30 : 0) - ev.strength * 90 - band * 40;
    y = Math.max(TRACK_Y - 380, Math.min(TRACK_Y + 40, y));
    y = lastY * 0.55 + y * 0.45;
    lastY = y;
    const hue: [number, number, number] = ev.band === "perc"
      ? [255, 150 + Math.round(ev.strength * 60), 60]   // 鼓点橙
      : [120 + Math.round(ev.strength * 80), 200, 255]; // 和声青
    hits.push({ tSec, strength: ev.strength, band: ev.band, beat: ev.beat, downbeat: ev.downbeat, y, hue, hitT: -1 });
  }
  // 小球命中动画时间
  const hitAnim = new Map<number, number>(); // hit index -> 击中帧时间
  hits.forEach((h, i) => hitAnim.set(i, h.tSec));

  // ---------- 音频 ----------
  const sfxTracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  hits.forEach((h, i) => {
    const kind = h.downbeat ? "crit" : h.beat ? "punch" : "coin";
    sfxTracks.push({ pcm: synthSfx(kind as any, 500 + i), offsetSec: h.tSec, gain: 0.25 + h.strength * 0.35 });
  });
  const sfxPcm = mixTracks(sfxTracks, totalSec);
  // 与原曲混合：读原曲 wav（16bit mono 44100），对齐 introSec 偏移
  const origBytes = readFileSync(audioPath);
  const dataIdx = origBytes.indexOf("data", 12);
  const origPcm = new Float32Array((origBytes.length - dataIdx - 8) / 2);
  for (let i = 0; i < origPcm.length; i++) {
    origPcm[i] = origBytes.readInt16LE(dataIdx + 8 + i * 2) / 32768;
  }
  const full = new Float32Array(Math.floor(totalSec * SR));
  for (let i = 0; i < origPcm.length; i++) {
    const j = Math.floor(introSec * SR) + i;
    if (j < full.length) full[j] += origPcm[i] * 0.9;
  }
  for (let i = 0; i < full.length && i < sfxPcm.length; i++) full[i] += sfxPcm[i];
  const finalPcm = normalize(full, 0.9);
  const mixedWav = "/tmp/mb_mixed.wav";
  writeWav(finalPcm, mixedWav);

  let ballY = TRACK_Y - 60;

  // ---------- 逐帧 ----------
  async function* frameGen() {
    for (let f = 0; f < totalFrames; f++) {
      const tNow = f / FPS;
      const fb = new FrameBuf(W, H);
      // 背景渐变（上深下微亮）
      fb.fillRect(0, 0, W, H, [16, 20, 38, 255]);
      for (let i = 0; i < H; i += 4) {
        const k = i / H;
        fb.blendRect(0, i, W, 4, [30 + k * 20, 36 + k * 26, 60 + k * 30, 255 * 0.35]);
      }
      // 赛道带
      fb.fillRect(0, TRACK_Y - 260, W, 480, [20, 24, 44, 140]);
      // 赛道线
      fb.fillRect(0, TRACK_Y + 60, W, 6, [70, 90, 160, 255]);

      // 小球轨迹曲线（把临近 hit 连成平滑路径并绘制）
      // 敲击点
      for (const h of hits) {
        const dt = h.tSec - tNow;
        if (dt < -0.35 || dt > APPROACH_SEC) continue;
        // 位置：从右侧推进到 BALL_X（线性），x 击中后随小球一起左移出屏
        const prog = 1 - dt / APPROACH_SEC; // 0..1 到达
        const x = W + 60 - (W + 120 - BALL_X) * prog;
        const alpha = dt < 0 ? Math.max(0, 1 + dt / 0.35) : 1;
        const r = 18 + h.strength * 26 + (h.downbeat ? 12 : 0);
        const [cr, cg, cb] = h.hue;
        fb.fillCircle(x, h.y, r, [cr, cg, cb, Math.round(255 * alpha)]);
        // 光环
        fb.blendCircle(x, h.y, r + 12, [cr, cg, cb, Math.round(90 * alpha)]);
        // 赛道地面光柱
        fb.blendRect(x - r * 0.4, TRACK_Y + 20, r * 0.8, 46, [cr, cg, cb, Math.round(60 * alpha)]);
        // 击中波纹
        if (dt >= -0.12 && dt < 0) {
          const k = -dt / 0.12;
          for (let seg = 0; seg < 14; seg++) {
            const ang = (seg / 14) * Math.PI * 2;
            fb.blendCircle(x + Math.cos(ang) * (30 + k * 50), h.y + Math.sin(ang) * (30 + k * 50), 4, [255, 255, 255, Math.round(160 * (1 - k))]);
          }
        }
      }

      // 小球（沿路径：y = 临近下一个 hit 的 y 插值，接近时对齐）
      let targetY = TRACK_Y - 120;
      for (const h of hits) {
        const dt = h.tSec - tNow;
        if (dt >= -0.05) { targetY = h.y; break; }
      }
      // 球心 y 平滑追踪下一个 hit
      ballY = ballY * 0.72 + targetY * 0.28;
      const pulse = 1 + Math.sin(tNow * 8) * 0.04;
      const ballR = 34 * pulse;
      // 拖尾
      for (let i = 1; i <= 5; i++) {
        fb.blendCircle(BALL_X - i * 18, ballY + i * 3, ballR - i * 5, [90, 210, 255, Math.round(60 - i * 10)]);
      }
      fb.fillCircle(BALL_X, ballY, ballR, [110, 220, 255, 255]);
      fb.fillCircle(BALL_X - ballR * 0.3, ballY - ballR * 0.35, ballR * 0.35, [220, 250, 255, 255]); // 高光

      // 进度字幕
      atlas.draw(fb, "AI 斗蛐蛐 · 音乐小球", W / 2, 120, [180, 210, 255, 255], 0.7, "center");
      atlas.draw(fb, `${axis.meta.tempo} BPM · ${hits.length} 连击目标`, W / 2, 200, [120, 150, 210, 255], 0.5, "center");
      // 进度条
      const pw = Math.round((tNow - introSec) / duration * W);
      fb.fillRect(0, H - 14, Math.max(0, Math.min(W, pw)), 14, [90, 210, 255, 255]);

      // 结尾淡出
      if (tNow > introSec + duration + 0.5) {
        const k = Math.min(1, (tNow - introSec - duration - 0.5) / 1.0);
        fb.blendRect(0, 0, W, H, [0, 0, 0, Math.round(255 * k)]);
      }
      yield fb;
    }
  }

  await encodeFrames(frameGen(), { width: W, height: H, fps: FPS, outPath: outMp4, audioPath: mixedWav, crf: 19 });
  console.log(`music-ball rendered -> ${outMp4}`);
}

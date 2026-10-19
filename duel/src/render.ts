// duel 回放渲染器：吃 JSONL 事件日志 → 逐帧光栅化 1080x1920 竖屏。
// 结构：开场 VS 卡（大字报冲击式）→ 战斗（棋盘格擂台+顶/底信息条）→ 结算（胜者+点播引导）。
import { FrameBuf } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { synthSfx, writeWav } from "../../shared/audio/sfx.ts";
import { mixTracks, normalize } from "../../shared/audio/mixer.ts";
import { generateBgm, writeBgmWav } from "../../shared/audio/bgm.ts";
import { ARENA_W, ARENA_H } from "./sim.ts";
import type { SimEvent, Side } from "./sim.ts";
import { readFileSync } from "node:fs";

const W = 1080, H = 1920, FPS = 30;

// 擂台几乎铺满竖屏宽度，居中略偏下（顶部留给 HUD）
const SCALE = 1.12;
const AX = Math.round((W - ARENA_W * SCALE) / 2);
const AY = Math.round(H * 0.36);

interface FighterView {
  x: number; y: number; hp: number; facing: 1 | -1;
  action: string; alive: boolean; name: string; title: string;
  color: string; color2: string; passive: string; passiveDesc: string; activeName: string;
  rageStacks: number; maxHp: number; hitFlash: number; deathT: number;
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function renderDuel(eventsPath: string, outMp4: string, opts: { coldOpen?: boolean; bgm?: boolean } = {}): Promise<void> {
  const { coldOpen = false, bgm = true } = opts;
  const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
  const events: SimEvent[] = lines.map(l => JSON.parse(l));

  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(fontDir + "atlas64.rgba", fontDir + "atlas64.json");
  const atlasBig = new FontAtlas(fontDir + "atlas96.rgba", fontDir + "atlas96.json");

  // 所有动态文字先按容器宽度缩放，避免 HUD、卡片和结算文字越界。
  const drawFit = (
    fb: FrameBuf, font: FontAtlas, text: string, x: number, y: number,
    color: [number, number, number, number], maxWidth: number, baseScale: number,
    align: "left" | "center" | "right",
  ) => {
    const natural = Math.max(1, font.measure(text) * baseScale);
    font.draw(fb, text, x, y, color, baseScale * Math.min(1, maxWidth / natural), align);
  };

  // 动态演出安全区：任何飘字/横幅都必须落在画布和擂台内，不能压 HUD 或越过擂台边线。
  const ARENA_TOP = AY + 22;
  const ARENA_BOTTOM = AY + Math.round(ARENA_H * SCALE) - 26;
  const clampTextY = (y: number, halfHeight = 24) =>
    Math.max(ARENA_TOP + halfHeight, Math.min(ARENA_BOTTOM - halfHeight, y));

  // ---------- 回放视图 ----------
  const spawnEv = events.filter(e => e.type === "spawn") as Extract<SimEvent, { type: "spawn" }>[];
  const byId: Record<Side, FighterView> = {} as any;
  for (const sp of spawnEv) {
    byId[sp.id] = {
      x: sp.x, y: sp.y, hp: 0, facing: 1, action: "idle", alive: true,
      name: sp.name, title: sp.title, color: sp.color, color2: sp.color2,
      passive: sp.passive, passiveDesc: sp.passiveDesc, activeName: sp.activeName,
      rageStacks: 0, maxHp: (sp as any).maxHp ?? 900, hitFlash: 0, deathT: -1,
    };
  }
  const endEv = events.find(e => e.type === "end") as Extract<SimEvent, { type: "end" }> | undefined;
  const duration = endEv ? endEv.duration : 45;

  // ---------- 时间轴段 ----------
  const VS_SEC = coldOpen ? 0 : 2.2;
  const INTRO_SEC = VS_SEC + 0.4;
  const battleSec = Math.min(duration + 1.0, 46);
  const settleSec = 3.0;
  const totalSec = INTRO_SEC + battleSec + settleSec;
  const totalFrames = Math.ceil(totalSec * FPS);

  // ---------- 音频：SFX 混音 + BGM ----------
  const sfxTracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  if (!coldOpen) sfxTracks.push({ pcm: synthSfx("vs-slam"), offsetSec: 0.15, gain: 1.0 });
  for (const ev of events) {
    const at = INTRO_SEC + ev.t;
    if (ev.type === "skill") sfxTracks.push({ pcm: synthSfx("skill", 200 + Math.floor(ev.t * 11)), offsetSec: at, gain: 0.95 });
    else if (ev.type === "skillEffect") {
      const sound = ev.kind === "rage" ? "whoosh" : ev.kind === "lifesteal" ? "coin" : "punch";
      sfxTracks.push({ pcm: synthSfx(sound, 400 + Math.floor(ev.t * 13)), offsetSec: at, gain: ev.kind === "bounce" ? 0.45 : 0.75 });
    }
    else if (ev.type === "death") sfxTracks.push({ pcm: synthSfx("death", 300 + Math.floor(ev.t * 5)), offsetSec: at, gain: 1.0 });
  }
  const mixed = mixTracks(sfxTracks, totalSec);
  if (bgm) {
    const bgmPcm = generateBgm({ bpm: 140, bars: 16, chordRoots: [0, -4, -7, -5], chordType: "minor", melodySeed: 7, lead: "square" });
    // BGM 循环铺满时长
    const need = Math.floor(totalSec * 44100);
    const full = new Float32Array(need);
    for (let i = 0; i < need; i++) full[i] = bgmPcm[i % bgmPcm.length];
    for (let i = 0; i < need; i++) mixed[i] = mixed[i] * 1.0 + full[i] * 0.42;
  }
  const sfxPcm = normalize(mixed, 0.88);
  const sfxWav = "/tmp/duel_audio.wav";
  writeWav(sfxPcm, sfxWav);

  // ---------- 伤害/治疗/技能特效列表（坐标来自事件本身）----------
  interface Fx { t0: number; kind: "dmg" | "heal" | "skillring" | "banner" | "slash"; x: number; y: number; tx?: number; ty?: number; text: string; color: [number, number, number, number]; big?: boolean }
  const fxList: Fx[] = [];
  for (const ev of events) {
    if (ev.type === "damage") {
      const x = ev.x + (ev.id === "A" ? -72 : 72);
      fxList.push({ t0: ev.t, kind: "dmg", x, y: ev.y - 165, text: `-${ev.value}`, color: [255, 96, 84, 255] });
    } else if (ev.type === "heal") {
      const x = ev.x + (ev.id === "A" ? -92 : 92);
      fxList.push({ t0: ev.t, kind: "heal", x, y: ev.y - 82, text: ev.text, color: [96, 230, 140, 255] });
    } else if (ev.type === "skill") {
      fxList.push({ t0: ev.t, kind: "skillring", x: ev.x, y: ev.y, text: ev.name, color: ev.id === "A" ? [255, 90, 130, 255] : [255, 190, 70, 255], big: true });
      fxList.push({ t0: ev.t, kind: "slash", x: ev.x, y: ev.y, text: "", color: [255, 240, 180, 255] });
    } else if (ev.type === "skillEffect" && ev.kind !== "bounce") {
      const text = ev.kind === "lifesteal" ? "技能吸血" : `狂暴蓄力 ×${ev.stacks ?? 1}`;
      const color: [number, number, number, number] = ev.kind === "lifesteal" ? [255, 80, 120, 255] : [255, 130, 30, 255];
      fxList.push({ t0: ev.t, kind: "banner", x: W / 2, y: 300, text, color, big: true });
    }
  }

  // hit-stop（顿帧）与震屏时间轴：大事件时刻索引
  const stops: { t: number; dur: number; shake: number }[] = [];
  for (const ev of events) {
    if (ev.type === "skill") stops.push({ t: ev.t, dur: 0.16, shake: 13 });
    else if (ev.type === "skillEffect" && ev.kind !== "bounce") stops.push({ t: ev.t, dur: 0.1, shake: 7 });
    else if (ev.type === "death") stops.push({ t: ev.t, dur: 0.3, shake: 18 });
  }
  function hitStopAt(tb: number): { freeze: boolean; shake: number } {
    for (const s of stops) {
      if (tb >= s.t && tb < s.t + s.dur) return { freeze: true, shake: s.shake };
      // 震屏在 hit-stop 后延续 0.25s
      if (tb >= s.t + s.dur && tb < s.t + s.dur + 0.25) {
        const k = 1 - (tb - s.t - s.dur) / 0.25;
        return { freeze: false, shake: s.shake * k };
      }
    }
    return { freeze: false, shake: 0 };
  }

  // ---------- 逐帧事件应用游标 ----------
  let evIdx = 0;
  // 视觉位置（平滑追踪模拟位置，产生突进/弹开动画感）
  const visX: Record<Side, number> = { A: byId.A?.x ?? 0, B: byId.B?.x ?? 0 };
  const visY: Record<Side, number> = { A: byId.A?.y ?? 0, B: byId.B?.y ?? 0 };
  const applyEvent = (ev: SimEvent) => {
    if (ev.type === "move") { const v = byId[ev.id]; v.x = ev.x; v.y = ev.y; v.facing = ev.facing; }
    else if (ev.type === "damage") { const v = byId[ev.id]; v.hp = ev.hp; v.hitFlash = 0.16; }
    else if (ev.type === "skill") { const v = byId[ev.id]; v.action = "skill"; }
    else if (ev.type === "death") { const v = byId[ev.id]; v.alive = false; v.action = "death"; v.deathT = ev.t; }
    else if (ev.type === "buff" && (ev.name === "狂暴" || ev.name === "狂暴蓄力")) { byId[ev.id].rageStacks = ev.stacks; }
  };
  // 初始满血
  for (const id of ["A", "B"] as Side[]) byId[id].hp = byId[id].maxHp;

  // ---------- 光栅化 ----------
  const drawArena = (fb: FrameBuf) => {
    fb.fillRect(0, 0, W, H, [13, 11, 22, 255]);
    const aw = Math.round(ARENA_W * SCALE), ah = Math.round(ARENA_H * SCALE);
    fb.fillRect(AX, AY, aw, ah, [30, 28, 48, 255]);
    const cell = 67;
    for (let gy = 0; gy < ah; gy += cell) {
      for (let gx = 0; gx < aw; gx += cell) {
        const odd = (Math.floor(gx / cell) + Math.floor(gy / cell)) % 2 === 0;
        fb.fillRect(AX + gx, AY + gy, cell, cell, odd ? [37, 35, 60, 255] : [29, 27, 47, 255]);
      }
    }
    const bc: [number, number, number, number] = [96, 86, 150, 255];
    fb.fillRect(AX - 5, AY - 5, aw + 10, 5, bc);
    fb.fillRect(AX - 5, AY + ah, aw + 10, 5, bc);
    fb.fillRect(AX - 5, AY, 5, ah, bc);
    fb.fillRect(AX + aw, AY, 5, ah, bc);
    // 顶部角色色光带
    const [r1, g1, b1] = hex(byId.A.color);
    const [r2, g2, b2] = hex(byId.B.color);
    for (let i = 0; i < 80; i++) {
      const a = Math.round(26 * (1 - i / 80));
      fb.blendRect(AX, AY + i, aw / 2, 1, [r1, g1, b1, a]);
      fb.blendRect(AX + aw / 2, AY + i, aw / 2, 1, [r2, g2, b2, a]);
    }
  };

  const drawFighter = (fb: FrameBuf, v: FighterView, tNow: number, shx = 0, shy = 0) => {
    // 视觉位置向模拟位置平滑追踪（每帧收敛 40%），突进/击退自动变成动画
    const id = v === byId.A ? "A" : "B";
    visX[id] += (v.x - visX[id]) * 0.4;
    visY[id] += (v.y - visY[id]) * 0.4;
    const px = AX + visX[id] * SCALE + shx, py = AY + visY[id] * SCALE + shy;
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    // 影子
    fb.blendCircle(px, py + 30 * SCALE, 30 * SCALE, [0, 0, 0, 80]);
    if (!v.alive) {
      // 倒地渐隐
      const fade = Math.max(0, 1 - (v.deathT >= 0 ? 1 : 1) * 0);
      fb.fillRect(px - 34, py + 10, 68, 16, [r2, g2, b2, 255]);
      fb.fillRect(px - 20, py + 2, 40, 12, [r, g, b, 220]);
      return;
    }
    const atk = v.action === "skill";
    const walk = v.action === "walk";
    const bob = walk ? Math.sin(tNow * 16) * 5 : 0;
    const lunge = atk ? v.facing * 14 : 0;
    const bodyH = 52, bodyW = 38;
    const bx = px + lunge;
    // 狂暴光圈（贴身）
    if (v.rageStacks > 0) {
      const a = Math.min(90, 22 + v.rageStacks * 8);
      fb.blendCircle(bx, py - bodyH * 0.5, 52, [255, 120, 26, a]);
    }
    // 身体
    fb.fillRect(bx - bodyW / 2, py - bodyH + bob, bodyW, bodyH, [r, g, b, 255]);
    // 头
    fb.fillCircle(bx, py - bodyH - 15 + bob, 16, [240, 224, 212, 255]);
    // 头发/兜帽
    fb.fillCircle(bx, py - bodyH - 19 + bob, 16, [r2, g2, b2, 255]);
    // 武器
    fb.fillRect(bx + v.facing * (bodyW / 2 + 6), py - bodyH + 8 + bob, 9, 30, [r2, g2, b2, 255]);
    // 受击白闪
    if (v.hitFlash > 0) {
      fb.blendCircle(bx, py - bodyH * 0.55 + bob, 40, [255, 255, 255, Math.round(v.hitFlash * 900)]);
    }
  };

  const drawHud = (fb: FrameBuf, tb: number) => {
    // 顶部血条：左右分侧，中间凹放计时
    for (const id of ["A", "B"] as Side[]) {
      const v = byId[id];
      const isA = id === "A";
      const barW = 400;
      const bx = isA ? 44 : W - 44 - barW;
      const by = 116;
      drawFit(fb, atlas, v.name, isA ? bx : bx + barW, 34, [255, 255, 255, 255], barW - 34, 0.72, isA ? "left" : "right");
      fb.fillRect(bx, by, barW, 30, [38, 34, 54, 255]);
      const frac = Math.max(0, v.hp / v.maxHp);
      const [r, g, b] = hex(v.color);
      const fw = Math.round((barW - 6) * frac);
      fb.fillRect(isA ? bx + 3 : bx + 3 + (barW - 6 - fw), by + 3, fw, 24, [r, g, b, 255]);
      drawFit(fb, atlas, `${Math.ceil(v.hp)} HP`, isA ? bx + barW - 8 : bx + 8, 78, [224, 224, 240, 255], 100, 0.42, isA ? "right" : "left");
      drawFit(fb, atlas, `被动 ${v.passive}`, isA ? bx : bx + barW, 168, [168, 158, 222, 255], barW - 20, 0.5, isA ? "left" : "right");
    }
    // 计时（贴顶，避免和血量数字打架）
    drawFit(fb, atlas, tb.toFixed(0) + "s", W / 2, 52, [255, 216, 110, 255], 100, 0.7, "center");
    // 底部信息条
    fb.fillRect(0, H - 120, W, 120, [9, 8, 16, 225]);
    drawFit(fb, atlas, "你想看谁打谁？评论区点播下期对阵", W / 2, H - 82, [196, 188, 235, 255], W - 64, 0.6, "center");
  };

  const drawFightersShaken = (fb: FrameBuf, tNow: number, shx: number, shy: number) => {
    // 借助 fb 平移：简单做法是给 drawFighter 传偏移
    drawFighter(fb, byId.A, tNow, shx, shy);
    drawFighter(fb, byId.B, tNow, shx, shy);
  };

  const drawFxShaken = (fb: FrameBuf, tb: number, shx: number, shy: number) => {
    for (const fx of fxList) {
      const age = tb - fx.t0;
      if (fx.kind === "banner") continue;
      if (age < 0 || age > 0.9) continue;
      const rise = age * 50;
      const alpha = Math.max(0, 255 - age * 320);
      const sx = Math.max(28, Math.min(W - 28, AX + fx.x * SCALE + shx));
      const rawSy = AY + fx.y * SCALE + shy;
      const sy = clampTextY(rawSy);
      if (fx.kind === "skillring") {
        const rr = 18 + age * 150;
        for (let seg = 0; seg < 22; seg++) {
          const ang = (seg / 22) * Math.PI * 2;
          fb.blendCircle(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr, 6, [fx.color[0], fx.color[1], fx.color[2], Math.round(alpha * 0.6)]);
        }
        drawFit(fb, atlas, fx.text, sx, clampTextY(sy + 70 + rise * 0.2), fx.color, 260, 0.58, "center");
      } else if (fx.kind === "slash") {
        // 斜向斩击线
        const len = 30 + age * 260;
        for (let i = 0; i < 26; i++) {
          const k = i / 26;
          fb.blendCircle(sx - len / 2 + len * k, sy - len / 3 + (len / 3) * k, 5 - k * 3, [fx.color[0], fx.color[1], fx.color[2], Math.round(alpha * (1 - k) * 0.9)]);
        }
      } else {
        drawFit(fb, atlas, fx.text, sx, clampTextY(sy - rise), fx.color, 300, fx.big ? 1.05 : 0.72, "center");
      }
    }
  };

  const [ar, ag, ab] = hex(byId.A.color);
  const [br, bg, bb] = hex(byId.B.color);

  async function* frameGen() {
    for (let f = 0; f < totalFrames; f++) {
      const tNow = f / FPS;
      const fb = new FrameBuf(W, H);
      const tb = tNow - INTRO_SEC;

      if (!coldOpen && tNow < INTRO_SEC) {
        // ====== VS 卡 ======
        fb.fillRect(0, 0, W, H, [12, 10, 22, 255]);
        const k = Math.min(1, tNow / 0.5);
        const slide = (1 - k) * 480;
        const cardW = 400, cardH = 500;
        const ax = 56 - slide * 0.7, ay = 600;
        fb.fillRect(ax, ay, cardW, cardH, [ar, ag, ab, 255]);
        fb.fillRect(ax + 14, ay + 14, cardW - 28, cardH - 28, [Math.round(ar * 0.38), Math.round(ag * 0.38), Math.round(ab * 0.38), 255]);
        drawFit(fb, atlasBig, byId.A.name, ax + cardW / 2, ay + 110, [255, 255, 255, 255], cardW - 28, 1.05, "center");
        drawFit(fb, atlas, byId.A.title, ax + cardW / 2, ay + 240, [255, 228, 228, 255], cardW - 44, 0.66, "center");
        drawFit(fb, atlas, `被动 ${byId.A.passive}`, ax + cardW / 2, ay + 300, [255, 204, 204, 255], cardW - 44, 0.55, "center");
        drawFit(fb, atlas, byId.A.passiveDesc, ax + cardW / 2, ay + 360, [232, 206, 206, 255], cardW - 44, 0.4, "center");
        const bx2 = W - 56 - cardW + slide * 0.7;
        fb.fillRect(bx2, ay, cardW, cardH, [br, bg, bb, 255]);
        fb.fillRect(bx2 + 14, ay + 14, cardW - 28, cardH - 28, [Math.round(br * 0.38), Math.round(bg * 0.38), Math.round(bb * 0.38), 255]);
        drawFit(fb, atlasBig, byId.B.name, bx2 + cardW / 2, ay + 110, [255, 255, 255, 255], cardW - 28, 1.05, "center");
        drawFit(fb, atlas, byId.B.title, bx2 + cardW / 2, ay + 240, [255, 240, 220, 255], cardW - 44, 0.66, "center");
        drawFit(fb, atlas, `被动 ${byId.B.passive}`, bx2 + cardW / 2, ay + 300, [255, 222, 184, 255], cardW - 44, 0.55, "center");
        drawFit(fb, atlas, byId.B.passiveDesc, bx2 + cardW / 2, ay + 360, [240, 220, 200, 255], cardW - 44, 0.4, "center");
        if (tNow > 0.9) {
          const vsK = Math.min(1, (tNow - 0.9) / 0.16);
          drawFit(fb, atlasBig, "VS", W / 2, 740, [255, 238, 88, 255], 260, 3 - vsK * 1.7, "center");
        }
        drawFit(fb, atlas, "AI 斗蛐蛐擂台", W / 2, 330, [204, 194, 244, 255], W - 80, 0.85, "center");
      } else if (tb >= 0) {
        // ====== 战斗 + 结算 ======
        const hs = hitStopAt(tb);
        // hit-stop：冻结事件推进（画面顿帧），但震屏照常
        if (!hs.freeze) {
          while (evIdx < events.length && events[evIdx].t <= tb) applyEvent(events[evIdx++]);
        }

        // 震屏偏移
        const shx = hs.shake > 0 ? Math.round((Math.sin(tNow * 91) * hs.shake)) : 0;
        const shy = hs.shake > 0 ? Math.round((Math.cos(tNow * 77) * hs.shake * 0.6)) : 0;

        // 擂台（带震屏）
        fb.blendRect(0, 0, W, H, [0, 0, 0, 0]); // no-op 保持结构
        drawArena(fb);
        // 角色整体震屏：绘制进偏移层（简化：直接偏移坐标重画）
        drawFightersShaken(fb, tNow, shx, shy);

        // 特效（跟随震屏）
        drawFxShaken(fb, tb, shx, shy);
        drawHud(fb, tb);

        // 技能式横幅（不随震屏，屏幕中央大字）
        for (const fx of fxList) {
          if (fx.kind !== "banner") continue;
          const age = tb - fx.t0;
          if (age < 0 || age > 0.8) continue;
          // 弹性放大入场 + 淡出
          const inK = Math.min(1, age / 0.12);
          const alpha = age > 0.55 ? Math.max(0, 1 - (age - 0.55) / 0.25) : 1;
          // 固定技能槽：用 64px 图集并把实际字高锁在横条内，禁止越过上下边线。
          const bandH = 58;
          const bandY = 300;
          const bandTop = bandY - bandH / 2;
          const bandBottom = bandY + bandH / 2;
          const textScale = 0.43 * (0.92 + inK * 0.08);
          fb.blendRect(0, bandTop, W, bandH, [fx.color[0], fx.color[1], fx.color[2], Math.round(50 * alpha)]);
          fb.fillRect(0, bandTop, W, 3, [fx.color[0], fx.color[1], fx.color[2], Math.round(220 * alpha)]);
          fb.fillRect(0, bandBottom - 3, W, 3, [fx.color[0], fx.color[1], fx.color[2], Math.round(220 * alpha)]);
          drawFit(fb, atlas, fx.text, W / 2, bandTop + 10, [fx.color[0], fx.color[1], fx.color[2], Math.round(255 * alpha)], W - 96, textScale, "center");
        }

        // 死亡时胜者字幕
        const deathEv = events.find(e => e.type === "death") as Extract<SimEvent, { type: "death" }> | undefined;
        if (deathEv && tb >= deathEv.t + 0.3 && tb <= battleSec) {
          const winner = byId[endEv!.winner];
          drawFit(fb, atlasBig, `${winner.name} 胜`, W / 2, H * 0.30, [255, 238, 120, 255], W - 80, 1.9, "center");
        }
        // 结算卡
        if (tb > battleSec) {
          const k = Math.min(1, (tb - battleSec) / 0.4);
          fb.blendRect(0, 0, W, H, [0, 0, 0, Math.round(190 * k)]);
          if (endEv && k > 0.6) {
            const winner = byId[endEv.winner];
            const [wr, wg, wb] = hex(winner.color);
            const cx = W / 2, cy = 700;
            fb.fillRect(cx - 250, cy - 20, 500, 640, [wr, wg, wb, 255]);
            fb.fillRect(cx - 236, cy - 6, 472, 612, [Math.round(wr * 0.32), Math.round(wg * 0.32), Math.round(wb * 0.32), 255]);
            drawFit(fb, atlasBig, "WINNER", cx, cy + 100, [255, 255, 255, 255], 420, 1.0, "center");
            drawFit(fb, atlasBig, winner.name, cx, cy + 260, [255, 255, 255, 255], 440, 1.15, "center");
            drawFit(fb, atlas, `剩余 HP ${Math.ceil(winner.hp)}`, cx, cy + 400, [225, 225, 245, 255], 420, 0.55, "center");
            drawFit(fb, atlas, "想看谁打谁？评论区点播", cx, cy + 480, [255, 228, 150, 255], 440, 0.58, "center");
          }
        }
      } else {
        // coldOpen: VS 信息压缩为顶部常驻（战斗尚未开始，短暂黑场过渡）
        fb.fillRect(0, 0, W, H, [12, 10, 22, 255]);
        drawArena(fb);
      }
      for (const id of ["A", "B"] as Side[]) byId[id].hitFlash = Math.max(0, byId[id].hitFlash - 1 / FPS);
      yield fb;
    }
  }

  await encodeFrames(frameGen(), { width: W, height: H, fps: FPS, outPath: outMp4, audioPath: sfxWav, crf: 19 });
  console.log(`duel rendered -> ${outMp4}`);
}

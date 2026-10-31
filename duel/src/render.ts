// duel 回放渲染器：吃 JSONL 事件日志 → 逐帧光栅化 1080x1920 竖屏高爽感武器碰撞竞技场画面。
// 采用极简全屏巨型竖屏擂台布局（75%+ 视觉占比）：
// 顶部：一句话悬念 Hook + 红蓝对称高对比缓动血条 + 一句话武器进化契约与 Beat-Pop 进化徽章
// 中央：984×1200 巨型竖屏竞技场 + 环绕实体进化武器（巨剑/双刀/雷锤/巨斧）+ 金白十字弹刀火花 + 破防刀光
// 底部：彻底移除冗余数据卡片，仅保留无边框高光事件单行播报。
import { FrameBuf, type RGBA } from "../../shared/render/framebuf.ts";
import { FontAtlas } from "../../shared/render/atlas.ts";
import { SpriteSheet } from "../../shared/render/png.ts";
import { encodeFrames } from "../../shared/render/encoder.ts";
import { synthSfx, writeWav } from "../../shared/audio/sfx.ts";
import { mixTracks, normalize } from "../../shared/audio/mixer.ts";
import { generateBgm } from "../../shared/audio/bgm.ts";
import { ARENA_W, ARENA_H } from "./sim.ts";
import type { SimEvent, Side, WeaponKind, ScaleKind } from "./sim.ts";
import { readFileSync } from "node:fs";

const W = 1080, H = 1920, FPS = 30;

// 全屏巨型竖屏竞技场视口：占据画面中央 75%+ 黄金视觉区 (Y: 350..1550)
const AX = 48;
const AY = 350;
const AW = W - AX * 2; // 984
const AH = 1200;
const SCALE_X = AW / ARENA_W; // 1.0
const SCALE_Y = AH / ARENA_H; // 1.0

interface TrailNode {
  x: number;
  y: number;
  facing: 1 | -1;
  col: number;
  row: number;
  alpha: number;
  weaponAngle: number;
  reach: number;
  bladeCount: number;
  bodyScale: number;
}

interface FighterView {
  id: Side;
  x: number;
  y: number;
  hp: number;
  ghostHp: number;
  facing: 1 | -1;
  action: "idle" | "walk" | "skill" | "hit" | "death";
  actionAge: number;
  alive: boolean;
  name: string;
  title: string;
  color: string;
  color2: string;
  passive: string;
  passiveDesc: string;
  activeName: string;
  rageStacks: number;
  maxHp: number;
  hitFlash: number;
  deathT: number;
  totalDamageDealt: number;
  totalHealed: number;
  skillCasts: number;
  wallBounces: number;
  weaponKind: WeaponKind;
  scaleKind: ScaleKind;
  weaponAngle: number;
  reach: number;
  baseReach: number;
  spinSpeed: number;
  baseSpinSpeed: number;
  bladeCount: number;
  bodyScale: number;
  hookRule: string;
  statLabel: string;
  statPulse: number; // 0..1 武器进化徽章 Beat-Pop 缩放脉冲
  trail: TrailNode[];
}

function hex(c: string): [number, number, number] {
  const clean = c.startsWith("#") ? c.slice(1) : c;
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export async function renderDuel(
  eventsPath: string,
  outMp4: string,
  opts: { coldOpen?: boolean; bgm?: boolean; hookText?: string } = {},
): Promise<void> {
  // 默认开启 0 秒冷启动，第 1 帧直接进入双球高速对冲，~0.4s 爆发首记金属弹刀
  const { coldOpen = true, bgm = true, hookText } = opts;
  const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
  const events: SimEvent[] = lines.map(l => JSON.parse(l));

  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(fontDir + "atlas64.rgba", fontDir + "atlas64.json");
  const atlasBig = new FontAtlas(fontDir + "atlas96.rgba", fontDir + "atlas96.json");

  const artDir = new URL("../godot/art/", import.meta.url).pathname;
  const sheets: Record<Side, SpriteSheet> = {
    A: new SpriteSheet(artDir + "pumpkin_knight_sheet.png", 48, 48),
    B: new SpriteSheet(artDir + "fire_slime_sheet.png", 48, 48),
  };

  const drawFit = (
    fb: FrameBuf,
    font: FontAtlas,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    maxWidth: number,
    baseScale: number,
    align: "left" | "center" | "right",
    outlineWidth = 2,
    outlineColor: RGBA = [8, 7, 16, Math.round(color[3] * 0.92)],
  ) => {
    const natural = Math.max(1, font.measure(text) * baseScale);
    const scale = baseScale * Math.min(1, maxWidth / natural);
    font.drawStyled(fb, text, x, y, color, scale, align, {
      outlineWidth,
      outlineColor,
      shadowOffset: [0, Math.max(2, Math.round(3 * scale))],
      shadowColor: [0, 0, 0, Math.round(color[3] * 0.55)],
    });
  };

  // ---------- 初始化双方视图 ----------
  const spawnEv = events.filter(e => e.type === "spawn") as Extract<SimEvent, { type: "spawn" }>[];
  const byId: Record<Side, FighterView> = {} as any;
  for (const sp of spawnEv) {
    const isA = sp.id === "A";
    byId[sp.id] = {
      id: sp.id,
      x: sp.x,
      y: sp.y,
      hp: sp.maxHp ?? 920,
      ghostHp: sp.maxHp ?? 920,
      facing: isA ? 1 : -1,
      action: "walk",
      actionAge: 0,
      alive: true,
      name: sp.name,
      title: sp.title,
      color: sp.color,
      color2: sp.color2,
      passive: sp.passive,
      passiveDesc: sp.passiveDesc,
      activeName: sp.activeName,
      rageStacks: 0,
      maxHp: sp.maxHp ?? 920,
      hitFlash: 0,
      deathT: -1,
      totalDamageDealt: 0,
      totalHealed: 0,
      skillCasts: 0,
      wallBounces: 0,
      weaponKind: sp.weaponKind ?? (isA ? "greatsword" : "twinblade"),
      scaleKind: sp.scaleKind ?? (isA ? "reach" : "spin"),
      weaponAngle: isA ? 0.3 : Math.PI - 0.3,
      reach: sp.reach ?? 170,
      baseReach: sp.baseReach ?? 170,
      spinSpeed: sp.spinSpeed ?? 6.2,
      baseSpinSpeed: sp.baseSpinSpeed ?? 6.2,
      bladeCount: sp.bladeCount ?? (isA ? 1 : 2),
      bodyScale: sp.bodyScale ?? 1.0,
      hookRule: sp.hookRule ?? (isA ? "★ 命中剑长+20% · 吸血恢复" : "★ 命中转速+32% · 伤害递增"),
      statLabel: sp.statLabel ?? (isA ? "剑长 100%" : "转速 100%"),
      statPulse: 0,
      trail: [],
    };
  }
  const endEv = events.find(e => e.type === "end") as Extract<SimEvent, { type: "end" }> | undefined;
  const duration = endEv ? endEv.duration : 24;

  // ---------- 紧凑时间轴段 ----------
  const VS_SEC = coldOpen ? 0 : 1.8;
  const INTRO_SEC = VS_SEC + (coldOpen ? 0 : 0.25);
  const battleSec = Math.min(duration + 0.9, 28);
  const settleSec = 2.2;
  const totalSec = INTRO_SEC + battleSec + settleSec;
  const totalFrames = Math.ceil(totalSec * FPS);

  // ---------- 音频：高辨识度金属拼刀 SFX + 破防重斩 + 低占比 BGM ----------
  const sfxTracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  if (!coldOpen) sfxTracks.push({ pcm: synthSfx("vs-slam"), offsetSec: 0.12, gain: 0.95 });
  for (const ev of events) {
    const at = INTRO_SEC + ev.t;
    if (ev.type === "parry") {
      // 连续拼刀音高阶梯式上扬 (1.0x -> 1.65x)，产生强烈多巴胺听觉爽感
      const pitch = 1 + Math.min(0.65, (ev.combo - 1) * 0.14);
      sfxTracks.push({
        pcm: synthSfx("parry", 700 + Math.floor(ev.t * 19), pitch),
        offsetSec: at,
        gain: 0.98,
      });
    } else if (ev.type === "skill") {
      sfxTracks.push({ pcm: synthSfx("skill", 200 + Math.floor(ev.t * 11), 1.04), offsetSec: at, gain: 0.92 });
    } else if (ev.type === "damage") {
      const isCrit = ev.value >= 135;
      sfxTracks.push({
        pcm: synthSfx(isCrit ? "crit" : "punch", 310 + Math.floor(ev.t * 13), isCrit ? 1.08 : 1.0),
        offsetSec: at + 0.02,
        gain: isCrit ? 0.88 : 0.72,
      });
    } else if (ev.type === "buff") {
      const pitch = 1 + Math.min(0.5, (ev.stacks - 1) * 0.06);
      sfxTracks.push({
        pcm: synthSfx("whoosh", 520 + Math.floor(ev.t * 15), pitch),
        offsetSec: at + 0.03,
        gain: 0.55,
      });
    } else if (ev.type === "heal") {
      sfxTracks.push({ pcm: synthSfx("coin", 410 + Math.floor(ev.t * 13), 1.12), offsetSec: at + 0.04, gain: 0.52 });
    } else if (ev.type === "wallBounce") {
      sfxTracks.push({ pcm: synthSfx("hit", 600 + Math.floor(ev.t * 17), 0.92), offsetSec: at, gain: 0.18 });
    } else if (ev.type === "death") {
      sfxTracks.push({ pcm: synthSfx("death", 300 + Math.floor(ev.t * 5)), offsetSec: at, gain: 1.0 });
      sfxTracks.push({ pcm: synthSfx("vs-slam", 99), offsetSec: at + 0.35, gain: 0.85 });
    }
  }
  const mixed = mixTracks(sfxTracks, totalSec);
  if (bgm) {
    const bgmPcm = generateBgm({
      bpm: 146,
      bars: 16,
      chordRoots: [0, -4, -7, -5],
      chordType: "minor",
      melodySeed: 7,
      lead: "square",
    });
    const need = Math.floor(totalSec * 44100);
    for (let i = 0; i < need; i++) {
      // 降低 BGM 混音占比至 0.18，让每一次金属弹刀与破防重斩都清晰炸裂
      mixed[i] = mixed[i] + bgmPcm[i % bgmPcm.length] * 0.18;
    }
  }
  const sfxPcm = normalize(mixed, 0.92);
  const sfxWav = "/tmp/duel_audio.wav";
  writeWav(sfxPcm, sfxWav);

  // ---------- 预设特效时间轴 ----------
  interface Fx {
    t0: number;
    kind: "dmg" | "heal" | "skillring" | "slash" | "lifestealOrb" | "wallRipple" | "parrySpark" | "evoPop" | "callout";
    side: Side;
    x: number;
    y: number;
    tx?: number;
    ty?: number;
    text: string;
    subText?: string;
    color: RGBA;
    big?: boolean;
    combo?: number;
    fxStyle?: "bolt" | "whirl";
  }

  const fxList: Fx[] = [];
  for (const ev of events) {
    if (ev.type === "parry") {
      fxList.push({
        t0: ev.t,
        kind: "parrySpark",
        side: "A",
        x: ev.x,
        y: ev.y,
        text: ev.combo >= 2 ? `连弹 ×${ev.combo}` : "弹反!",
        color: ev.combo >= 2 ? [255, 232, 92, 255] : [255, 250, 210, 255],
        combo: ev.combo,
      });
      if (ev.combo >= 2) {
        fxList.push({
          t0: ev.t,
          kind: "callout",
          side: "A",
          x: W / 2,
          y: 1592,
          text: `★ 连续弹反 ×${ev.combo} · 双方武器狂暴加速 ★`,
          color: [255, 230, 98, 255],
        });
      }
    } else if (ev.type === "damage") {
      const offsetX = ev.id === "A" ? -42 : 42;
      const isBig = ev.value >= 135;
      fxList.push({
        t0: ev.t,
        kind: "dmg",
        side: ev.id,
        x: ev.x + offsetX,
        y: ev.y - 88,
        text: isBig ? `暴击 -${ev.value}` : `-${ev.value}`,
        color: isBig ? [255, 222, 72, 255] : [255, 96, 108, 255],
        big: isBig,
      });
    } else if (ev.type === "heal") {
      const offsetX = ev.id === "A" ? -56 : 56;
      fxList.push({
        t0: ev.t,
        kind: "heal",
        side: ev.id,
        x: ev.x + offsetX,
        y: ev.y - 46,
        text: `+${ev.value}`,
        color: [82, 248, 156, 255],
      });
    } else if (ev.type === "skill") {
      const caster = byId[ev.id];
      const [r, g, b] = hex(caster.color);
      fxList.push({
        t0: ev.t,
        kind: "skillring",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: ev.name,
        color: [r, g, b, 240],
        fxStyle: ev.fx,
      });
      fxList.push({
        t0: ev.t,
        kind: "slash",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "",
        color: [r, g, b, 255],
        fxStyle: ev.fx,
      });
    } else if (ev.type === "buff") {
      const caster = byId[ev.id];
      const [r, g, b] = hex(caster.color);
      const stepText =
        caster.scaleKind === "reach"
          ? "剑长+20%"
          : caster.scaleKind === "spin"
            ? "转速+32%"
            : caster.scaleKind === "multiweapon"
              ? ev.statLabel
              : "巨斧+18%";
      fxList.push({
        t0: ev.t,
        kind: "evoPop",
        side: ev.id,
        x: ev.id === "A" ? -30 : 30,
        y: -115,
        text: stepText,
        color: [r, g, b, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ 武器进化 · ${caster.name} 「${ev.statLabel}」 ★`,
        color: [r, g, b, 255],
      });
    } else if (ev.type === "skillEffect" && ev.kind === "lifesteal" && ev.tx !== undefined && ev.ty !== undefined) {
      fxList.push({
        t0: ev.t,
        kind: "lifestealOrb",
        side: ev.id,
        x: ev.tx,
        y: ev.ty,
        tx: ev.x,
        ty: ev.y,
        text: "",
        color: [90, 250, 165, 255],
      });
    } else if (ev.type === "wallBounce") {
      const f = byId[ev.id];
      const [r, g, b] = hex(f.color);
      fxList.push({
        t0: ev.t,
        kind: "wallRipple",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "",
        color: [r, g, b, 220],
      });
    }
  }

  // ---------- 顿帧（Hit-Stop）与镜头震动推拉 ----------
  interface StopWindow {
    tStart: number;
    tEnd: number;
    focusX: number;
    focusY: number;
    zoom: number;
    shake: number;
    flashAlpha: number;
  }
  const stops: StopWindow[] = [];
  for (const ev of events) {
    if (ev.type === "parry") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.05,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.04 + Math.min(0.05, ev.combo * 0.015),
        shake: 10 + Math.min(10, ev.combo * 3),
        flashAlpha: 38,
      });
    } else if (ev.type === "skill") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.08,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.09,
        shake: 15,
        flashAlpha: 55,
      });
    } else if (ev.type === "death") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.36,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.22,
        shake: 24,
        flashAlpha: 105,
      });
    }
  }

  function cameraAndStopAt(tBattle: number): {
    freeze: boolean;
    zoom: number;
    focusX: number;
    focusY: number;
    shake: number;
    flashAlpha: number;
  } {
    let zoom = 1;
    let focusX = ARENA_W / 2;
    let focusY = ARENA_H / 2;
    let freeze = false;
    let shake = 0;
    let flashAlpha = 0;
    for (const s of stops) {
      if (tBattle >= s.tStart && tBattle <= s.tEnd + 0.24) {
        const inStop = tBattle <= s.tEnd;
        if (inStop) freeze = true;
        const decay = inStop ? 1 : 1 - (tBattle - s.tEnd) / 0.24;
        const z = 1 + (s.zoom - 1) * decay;
        if (z > zoom) {
          zoom = z;
          focusX = ARENA_W / 2 + (s.focusX - ARENA_W / 2) * 0.35 * decay;
          focusY = ARENA_H / 2 + (s.focusY - ARENA_H / 2) * 0.35 * decay;
          shake = s.shake * decay;
          flashAlpha = inStop ? s.flashAlpha : Math.round(s.flashAlpha * decay * 0.4);
        }
      }
    }
    return { freeze, zoom, focusX, focusY, shake, flashAlpha };
  }

  // ---------- 事件回放状态推进 ----------
  let evIdx = 0;
  let totalClashes = 0;
  let maxParryCombo = 0;
  let currentParryStreak = 0;
  let lastClashTime = -10;

  const visX: Record<Side, number> = { A: byId.A.x, B: byId.B.x };
  const visY: Record<Side, number> = { A: byId.A.y, B: byId.B.y };

  const applyEvent = (ev: SimEvent) => {
    if (ev.type === "move") {
      const f = byId[ev.id];
      const dx = ev.x - f.x;
      const dy = ev.y - f.y;
      if (Math.hypot(dx, dy) > 6) {
        f.trail.unshift({
          x: f.x,
          y: f.y,
          facing: f.facing,
          col: Math.floor(ev.t * 12) % 6,
          row: f.action === "skill" ? 2 : 1,
          alpha: 0.55,
          weaponAngle: f.weaponAngle,
          reach: f.reach,
          bladeCount: f.bladeCount,
          bodyScale: f.bodyScale,
        });
        if (f.trail.length > 4) f.trail.pop();
      }
      f.x = ev.x;
      f.y = ev.y;
      f.facing = ev.facing;
      f.weaponAngle = ev.weaponAngle;
      f.reach = ev.reach;
      f.bladeCount = ev.bladeCount;
      f.bodyScale = ev.bodyScale;
      f.spinSpeed = ev.spinSpeed;
      if (f.action === "idle") f.action = "walk";
    } else if (ev.type === "parry") {
      totalClashes++;
      currentParryStreak = ev.combo;
      if (ev.combo > maxParryCombo) maxParryCombo = ev.combo;
      lastClashTime = ev.t;
    } else if (ev.type === "damage") {
      const target = byId[ev.id];
      const attacker = byId[ev.from];
      target.hp = ev.hp;
      target.action = "hit";
      target.actionAge = 0;
      target.hitFlash = 0.22;
      attacker.totalDamageDealt += ev.value;
    } else if (ev.type === "heal") {
      const f = byId[ev.id];
      f.hp = ev.hp;
      f.totalHealed += ev.value;
    } else if (ev.type === "skill") {
      const f = byId[ev.id];
      f.action = "skill";
      f.actionAge = 0;
      f.skillCasts += 1;
      totalClashes++;
      currentParryStreak = 0;
      lastClashTime = ev.t;
    } else if (ev.type === "buff") {
      const f = byId[ev.id];
      f.rageStacks = ev.stacks;
      f.reach = ev.reach;
      f.spinSpeed = ev.spinSpeed;
      f.bladeCount = ev.bladeCount;
      f.bodyScale = ev.bodyScale;
      f.statLabel = ev.statLabel;
      f.statPulse = 1.0; // 触发顶部进化徽章 Beat-Pop 缩放动画
    } else if (ev.type === "wallBounce") {
      byId[ev.id].wallBounces += 1;
    } else if (ev.type === "death") {
      const f = byId[ev.id];
      f.alive = false;
      f.action = "death";
      f.actionAge = 0;
      f.deathT = ev.t;
    }
  };

  function worldToScreen(
    wx: number,
    wy: number,
    cam: { zoom: number; focusX: number; focusY: number },
    shx: number,
    shy: number,
  ): [number, number] {
    const cx = AX + AW / 2;
    const cy = AY + AH / 2;
    const sx = cx + (wx - cam.focusX) * SCALE_X * cam.zoom + shx;
    const sy = cy + (wy - cam.focusY) * SCALE_Y * cam.zoom + shy;
    return [sx, sy];
  }

  // ---------- 绘制环绕实体进化武器（Weapon Ball 核心视觉锚点） ----------
  const drawOrbitingWeapons = (
    fb: FrameBuf,
    v: FighterView,
    sx: number,
    sy: number,
    cam: { zoom: number },
    tNow: number,
  ) => {
    if (!v.alive) return;
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    const orbR = 52 * v.bodyScale * cam.zoom;
    const innerR = orbR * 0.56;
    const outerR = v.reach * SCALE_X * cam.zoom;
    const bladeLen = Math.max(40, outerR - innerR);
    const midR = innerR + bladeLen * 0.5;
    const spinRatio = v.spinSpeed / Math.max(1, v.baseSpinSpeed);
    const dirSign = v.id === "A" ? 1 : -1;

    // 高转速时绘制环绕旋风残影外环
    if (spinRatio >= 1.5) {
      const cycloneAlpha = clamp(Math.round((spinRatio - 1.4) * 55), 20, 115);
      fb.strokeRing(sx, sy, outerR * 0.92, Math.max(3, Math.round(6 * cam.zoom)), [r, g, b, cycloneAlpha]);
    }

    for (let k = 0; k < v.bladeCount; k++) {
      const ang = v.weaponAngle + (k * Math.PI * 2) / v.bladeCount;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const hx = sx + cos * innerR;
      const hy = sy + sin * innerR;
      const mx = sx + cos * midR;
      const my = sy + sin * midR;
      const tx = sx + cos * outerR;
      const ty = sy + sin * outerR;

      // 1. 武器挥砍扇形流光拖尾 (Motion Blur Arc)
      const sweepSpan = clamp(0.38 + (spinRatio - 1) * 0.22, 0.35, 1.05);
      const arcStart = dirSign > 0 ? ang - sweepSpan : ang;
      const arcEnd = dirSign > 0 ? ang : ang + sweepSpan;
      fb.drawArc(sx, sy, outerR * 0.86, Math.round(22 * cam.zoom), arcStart, arcEnd, [r, g, b, 92]);
      fb.drawArc(sx, sy, outerR * 0.96, Math.round(10 * cam.zoom), arcStart, arcEnd, [255, 245, 215, 135]);

      if (v.weaponKind === "greatsword") {
        // 万圣巨剑：宽厚暗金护手 + 猩红巨型剑身 + 纯白高能剑脊 + 剑尖星芒
        const w = Math.round((24 + Math.min(12, v.rageStacks * 1.5)) * cam.zoom);
        fb.fillRotatedRect(mx, my, bladeLen, w + 8, ang, [r2, g2, b2, 220]);
        fb.fillRotatedRect(mx, my, bladeLen, w, ang, [r, g, b, 255]);
        fb.fillRotatedRect(mx, my, bladeLen * 0.92, Math.max(6, Math.round(w * 0.38)), ang, [255, 245, 220, 250]);
        // 黄金十字护手
        const gx = sx + cos * (innerR + 10 * cam.zoom);
        const gy = sy + sin * (innerR + 10 * cam.zoom);
        fb.fillRotatedRect(gx, gy, Math.round(14 * cam.zoom), Math.round(w * 2.1), ang, [255, 212, 78, 255]);
        // 剑尖破空光球
        fb.drawGlowCircle(tx, ty, Math.round(28 * cam.zoom), [255, 215, 95, 185]);
        fb.fillCircle(tx, ty, Math.round(9 * cam.zoom), [255, 255, 245, 255]);
      } else if (v.weaponKind === "twinblade") {
        // 狂暴双刀 / 寒霜双剑：凌厉流线型双刃 + 亮青刀锋高光
        const w = Math.round(17 * cam.zoom);
        fb.fillRotatedRect(mx, my, bladeLen, w + 6, ang, [r2, g2, b2, 215]);
        fb.fillRotatedRect(mx, my, bladeLen, w, ang, [r, g, b, 255]);
        fb.fillRotatedRect(mx, my, bladeLen * 0.94, Math.max(5, Math.round(w * 0.42)), ang, [235, 252, 255, 255]);
        // 刀锷
        const gx = sx + cos * (innerR + 8 * cam.zoom);
        const gy = sy + sin * (innerR + 8 * cam.zoom);
        fb.fillRotatedRect(gx, gy, Math.round(11 * cam.zoom), Math.round(w * 1.8), ang, [255, 232, 118, 250]);
        fb.drawGlowCircle(tx, ty, Math.round(22 * cam.zoom), [r, g, b, 190]);
        fb.fillCircle(tx, ty, Math.round(7 * cam.zoom), [255, 255, 255, 255]);
      } else if (v.weaponKind === "scythe") {
        // 噬血巨斧/战镰：修长暗红金属战柄 + 末端巨型新月战斧刃口（随 bodyScale 与 reach 狂暴放大）
        const shaftW = Math.round(14 * v.bodyScale * cam.zoom);
        fb.fillRotatedRect(mx, my, bladeLen * 0.88, shaftW, ang, [210, 185, 195, 245]);
        const headR = outerR * 0.86;
        const headX = sx + cos * headR;
        const headY = sy + sin * headR;
        const axeW = Math.round(38 * v.bodyScale * cam.zoom);
        const axeH = Math.round(96 * v.bodyScale * cam.zoom);
        fb.fillRotatedRect(headX, headY, axeW + 8, axeH + 8, ang, [r2, g2, b2, 235]);
        fb.fillRotatedRect(headX, headY, axeW, axeH, ang, [r, g, b, 255]);
        fb.drawArc(sx, sy, outerR * 0.94, Math.round(18 * v.bodyScale * cam.zoom), ang - 0.46, ang + 0.46, [255, 238, 215, 250]);
        fb.drawGlowCircle(tx, ty, Math.round(34 * v.bodyScale * cam.zoom), [r, g, b, 195]);
      } else {
        // 超载雷锤：能量战柄 + 巨型雷霆方锤头 + 电弧闪烁
        const shaftW = Math.round(13 * cam.zoom);
        fb.fillRotatedRect(mx, my, bladeLen * 0.82, shaftW, ang, [185, 220, 255, 245]);
        const headDist = outerR * 0.86;
        const hx2 = sx + cos * headDist;
        const hy2 = sy + sin * headDist;
        const hw = Math.round(42 * cam.zoom);
        const hh = Math.round(68 * cam.zoom);
        fb.fillRotatedRect(hx2, hy2, hw + 8, hh + 8, ang, [r2, g2, b2, 235]);
        fb.fillRotatedRect(hx2, hy2, hw, hh, ang, [r, g, b, 255]);
        fb.fillRotatedRect(hx2, hy2, Math.round(hw * 0.55), Math.round(hh * 0.78), ang, [240, 252, 255, 255]);
        fb.drawGlowCircle(hx2, hy2, Math.round(36 * cam.zoom), [95, 225, 255, 195]);
        // 锤头四周跳跃雷电光斑
        const sparkAng = tNow * 24 + k * 2.1;
        const lx = hx2 + Math.cos(sparkAng) * 24 * cam.zoom;
        const ly = hy2 + Math.sin(sparkAng) * 24 * cam.zoom;
        fb.drawLine(hx2, hy2, lx, ly, 3, [255, 245, 130, 245]);
      }

      // 握柄连接点高光环
      fb.fillCircle(hx, hy, Math.round(7 * cam.zoom), [255, 236, 150, 240]);
    }
  };

  // ---------- 1. 极简顶部 HUD (Y: 0..335) ----------
  const drawMinimalTopHud = (fb: FrameBuf, tb: number, tNow: number) => {
    const headline = hookText ?? "巨剑无限变长 VS 双剑无限加速，谁能活到最后？";
    // 顶部暗色渐变衬底，无边框高对比大字标题
    fb.blendGradientRect(0, 0, W, 336, [8, 7, 16, 245], [12, 10, 24, 180], true);
    drawFit(fb, atlas, headline, W / 2, 26, [255, 242, 132, 255], W - 72, 0.50, "center", 3, [8, 6, 16, 250]);

    for (const id of ["A", "B"] as Side[]) {
      const v = byId[id];
      const [r, g, b] = hex(v.color);
      const isLeft = id === "A";

      // 角色名称与武器流派副标题 (Y: 88..134)
      const nameX = isLeft ? 48 : W - 48;
      const align = isLeft ? "left" : "right";
      drawFit(
        fb,
        atlas,
        `${v.name} · ${v.title}`,
        nameX,
        92,
        [255, 255, 255, 255],
        420,
        0.46,
        align,
        3,
        [10, 8, 22, 245],
      );

      // 加厚高对比红蓝血条 (Y: 144..186) + 白色受伤残影缓动
      const barW = 426;
      const barH = 42;
      const barX = isLeft ? 48 : W - 48 - barW;
      const barY = 144;
      const hpFrac = clamp(v.hp / v.maxHp, 0, 1);
      const ghostFrac = clamp(v.ghostHp / v.maxHp, hpFrac, 1);

      fb.fillRoundRect(barX - 3, barY - 3, barW + 6, barH + 6, 13, [255, 255, 255, 215]);
      fb.fillRoundRect(barX, barY, barW, barH, 10, [18, 16, 32, 248]);

      // 白色受击残影条
      if (ghostFrac > hpFrac + 0.004) {
        const gw = Math.round(barW * ghostFrac);
        const gx = isLeft ? barX : barX + (barW - gw);
        fb.fillRoundRect(gx, barY + 3, gw, barH - 6, 8, [255, 245, 225, 235]);
      }

      // 真实高饱和血量条
      const fw = Math.round(barW * hpFrac);
      if (fw > 0) {
        const fx = isLeft ? barX : barX + (barW - fw);
        fb.fillRoundRect(fx, barY + 3, fw, barH - 6, 8, [r, g, b, 255]);
        fb.fillRoundRect(fx, barY + 4, fw, Math.round((barH - 6) * 0.42), 6, [255, 255, 255, 78]);
      }

      // 血条内嵌大号 HP 数值
      const hpStr = `${Math.max(0, Math.ceil(v.hp))} / ${v.maxHp}`;
      drawFit(fb, atlas, hpStr, barX + barW / 2, barY + 7, [255, 255, 255, 255], barW - 24, 0.40, "center", 2);

      // 全宽武器进化状态栏 (Y: 198..244)：与上方血条 1:1 对齐，砍掉啰嗦小字，居中大字 + 进化充能进度 + Beat-Pop 脉冲
      const isPulsing = v.statPulse > 0.05;
      const textPulse = 1 + 0.16 * Math.sin(v.statPulse * Math.PI);
      const evoY = 198;
      const evoH = 46;
      const evoFrac = clamp(0.22 + (v.rageStacks / 8) * 0.78, 0.22, 1);

      // 外发光边框与深色底槽
      const borderCol: RGBA = isPulsing ? [255, 232, 98, 255] : [Math.min(255, r + 55), Math.min(255, g + 55), Math.min(255, b + 55), 225];
      fb.fillRoundRect(barX - 2, evoY - 2, barW + 4, evoH + 4, 12, borderCol);
      fb.fillRoundRect(barX, evoY, barW, evoH, 10, [16, 14, 30, 248]);

      // 进化充能进度条（左侧从左往右，右侧从右往左，与血条镜像呼应）
      const evoFillW = Math.round((barW - 6) * evoFrac);
      const evoFillX = isLeft ? barX + 3 : barX + barW - 3 - evoFillW;
      const fillCol: RGBA = isPulsing
        ? [245, 168, 28, 250]
        : [Math.round(r * 0.78), Math.round(g * 0.78), Math.round(b * 0.78), 235];
      fb.fillRoundRect(evoFillX, evoY + 3, evoFillW, evoH - 6, 8, fillCol);
      fb.fillRoundRect(evoFillX, evoY + 4, evoFillW, Math.round((evoH - 6) * 0.42), 6, [255, 255, 255, isPulsing ? 115 : 68]);

      // 8 段进化刻度暗线
      for (let seg = 1; seg < 8; seg++) {
        const sx = barX + Math.round((barW * seg) / 8);
        fb.blendRect(sx, evoY + 4, 2, evoH - 8, [10, 8, 22, 110]);
      }

      // 居中大号进化倍率文字（如 "★ 剑长 255% ★" / "★ 转速 360% ★"）
      const labelText = `★ ${v.statLabel} ★`;
      drawFit(
        fb,
        atlas,
        labelText,
        barX + barW / 2,
        evoY + Math.round((evoH - 28 * textPulse) * 0.5),
        isPulsing ? [255, 252, 210, 255] : [255, 255, 255, 255],
        barW - 20,
        0.40 * textPulse,
        "center",
        3,
        [10, 8, 22, 248],
      );
    }

    // 中央 VS 与交锋计数徽章（纵向贯通血条与进化栏 Y: 140..246）
    const cx = W / 2;
    fb.drawCard(cx - 56, 140, 112, 106, {
      bgTop: [34, 28, 64, 248],
      bgBottom: [18, 14, 36, 252],
      border: [255, 215, 92, 255],
      borderWidth: 3,
      radius: 20,
      shadowAlpha: 130,
      shadowOffsetY: 5,
    });
    drawFit(fb, atlasBig, "VS", cx, 150, [255, 226, 98, 255], 92, 0.46, "center", 3);
    drawFit(fb, atlas, `对决 ${totalClashes}`, cx, 204, [235, 232, 255, 245], 98, 0.30, "center", 2);

    // 拼刀连击或狂暴加速提示 (Y: 278..328)
    if (currentParryStreak >= 2 && tb - lastClashTime < 1.2) {
      const pulse = 1 + 0.08 * Math.sin(tNow * 22);
      drawFit(
        fb,
        atlas,
        `★ 连续弹反 ×${currentParryStreak} · 剑速狂暴 ★`,
        cx,
        282,
        [255, 232, 88, 255],
        640,
        0.44 * pulse,
        "center",
        3,
      );
    } else if (tb >= 10) {
      const pulse = Math.round(215 + 40 * Math.sin(tNow * 12));
      drawFit(
        fb,
        atlas,
        "★ 狂暴时刻 · 全场攻速移速提升 ★",
        cx,
        284,
        [255, 208, 88, pulse],
        620,
        0.38,
        "center",
        2,
      );
    }
  };

  // ---------- 2. 全屏巨型竖屏竞技场 (Y: 350..1550) ----------
  const drawGiantArena = (
    fb: FrameBuf,
    tNow: number,
    tb: number,
    cam: { zoom: number; focusX: number; focusY: number; flashAlpha: number },
    shx: number,
    shy: number,
  ) => {
    // 全局深邃暗色背景
    fb.blendGradientRect(0, 336, W, H - 336, [10, 9, 20, 255], [6, 5, 14, 255], true);

    const ax = AX + shx;
    const ay = AY + shy;

    // 擂台外发光氛围光晕（左红右蓝对撞）
    const [ar, ag, ab] = hex(byId.A.color);
    const [br, bg, bb] = hex(byId.B.color);
    fb.drawGlowCircle(ax + AW * 0.25, ay + AH * 0.45, 420, [ar, ag, ab, 38]);
    fb.drawGlowCircle(ax + AW * 0.75, ay + AH * 0.55, 420, [br, bg, bb, 38]);

    // 擂台深色高对比网格地面（突出前景高饱和武器轨迹与金色弹刀火花）
    fb.fillRoundRect(ax - 8, ay - 8, AW + 16, AH + 16, 26, [6, 5, 14, 240]);
    fb.blendGradientRect(ax, ay, AW, AH, [22, 20, 38, 255], [16, 14, 28, 255], true);

    const cols = 8;
    const rows = 10;
    const tileW = AW / cols;
    const tileH = AH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2 === 0) {
          fb.blendRect(
            Math.round(ax + c * tileW),
            Math.round(ay + r * tileH),
            Math.ceil(tileW),
            Math.ceil(tileH),
            [27, 24, 45, 145],
          );
        }
      }
    }

    // 中央决斗法阵环与微弱 VS 暗纹
    const [cx, cy] = worldToScreen(ARENA_W / 2, ARENA_H / 2, cam, shx, shy);
    const ringR = Math.round(280 * cam.zoom);
    fb.strokeRing(cx, cy, ringR, 3, [82, 74, 138, 95]);
    fb.strokeRing(cx, cy, Math.round(ringR * 0.58), 2, [105, 94, 168, 70]);
    fb.drawLine(ax + 24, cy, ax + AW - 24, cy, 2, [82, 74, 138, 65]);

    // 擂台四周高饱和霓虹边界框（上半左红、下半右蓝能量护栏）
    const borderPulse = Math.round(215 + 40 * Math.sin(tNow * 8));
    fb.strokeRoundRect(ax, ay, AW, AH, 20, 5, [110, 98, 195, 225]);
    fb.drawLine(ax + 16, ay + 2, ax + AW / 2, ay + 2, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW / 2, ay + 2, ax + AW - 16, ay + 2, 5, [br, bg, bb, borderPulse]);
    fb.drawLine(ax + 2, ay + 20, ax + 2, ay + AH - 20, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW - 2, ay + 20, ax + AW - 2, ay + AH - 20, 5, [br, bg, bb, borderPulse]);
    fb.drawLine(ax + 16, ay + AH - 2, ax + AW / 2, ay + AH - 2, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW / 2, ay + AH - 2, ax + AW - 16, ay + AH - 2, 5, [br, bg, bb, borderPulse]);

    // 弹墙冲击波涟漪
    for (const fx of fxList) {
      if (fx.kind !== "wallRipple") continue;
      const age = tb - fx.t0;
      if (age < 0 || age > 0.42) continue;
      const k = age / 0.42;
      const [wx, wy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
      const rad = Math.round((24 + 92 * k) * cam.zoom);
      const alpha = Math.round(220 * (1 - k));
      fb.strokeRing(wx, wy, rad, 4, [fx.color[0], fx.color[1], fx.color[2], alpha]);
    }

    // 拼刀/重斩顿帧瞬间局部半透明闪白（必须使用 blendRect 保留深色竞技场底色）
    if (cam.flashAlpha > 0) {
      fb.blendRect(ax, ay, AW, AH, [255, 248, 225, Math.min(45, cam.flashAlpha)]);
    }
  };

  // ---------- 3. 绘制战斗球体 + 像素角色 + 环绕进化武器 ----------
  const drawFighterWithWeapon = (
    fb: FrameBuf,
    v: FighterView,
    tNow: number,
    cam: { zoom: number; focusX: number; focusY: number },
    shx: number,
    shy: number,
  ) => {
    visX[v.id] += (v.x - visX[v.id]) * 0.48;
    visY[v.id] += (v.y - visY[v.id]) * 0.48;

    const [sx, sy] = worldToScreen(visX[v.id], visY[v.id], cam, shx, shy);
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    const sheet = sheets[v.id];

    // 1. 残影轨迹
    for (let i = v.trail.length - 1; i >= 0; i--) {
      const tr = v.trail[i];
      tr.alpha *= 0.78;
      if (tr.alpha < 0.08) continue;
      const [tx, ty] = worldToScreen(tr.x, tr.y, cam, shx, shy);
      const trR = Math.round(46 * tr.bodyScale * cam.zoom);
      fb.fillCircle(tx, ty, trR, [r, g, b, Math.round(tr.alpha * 65)]);
    }

    // 2. 先绘制环绕实体进化武器（使剑柄自然衔接在球体边缘）
    drawOrbitingWeapons(fb, v, sx, sy, cam, tNow);

    // 3. 脚底立体投影与能量球体光环（Weapon Ball 标志性高对比球体碰撞边界）
    const orbR = Math.round(52 * v.bodyScale * cam.zoom);
    fb.fillRotatedEllipse(sx, sy + orbR * 0.72, orbR * 0.92, Math.round(18 * cam.zoom), 0, [0, 0, 0, 145]);
    fb.drawGlowCircle(sx, sy, Math.round(orbR * 1.45), [r, g, b, v.action === "skill" ? 135 : 75]);
    fb.fillCircle(sx, sy, orbR, [r2, g2, b2, 215]);
    fb.fillCircle(sx, sy, Math.round(orbR * 0.86), [18, 16, 32, 235]);
    fb.strokeRing(sx, sy, orbR, Math.max(4, Math.round(5 * cam.zoom)), [r, g, b, 255]);
    fb.strokeRing(sx, sy, Math.round(orbR * 0.90), 2, [255, 245, 220, 175]);

    // 4. 像素精灵动画绘制于球体中心（行 0..4 为 4 帧有效列 0..3，无头顶重复小血条，保持画面极度干净！）
    let row = 0, col = 0;
    if (!v.alive) {
      row = 4;
      col = Math.min(3, Math.floor(v.actionAge * 6));
    } else if (v.action === "skill") {
      row = 2;
      col = Math.min(3, Math.floor(v.actionAge * 12));
    } else if (v.action === "hit") {
      row = 3;
      col = Math.min(3, Math.floor(v.actionAge * 12));
    } else {
      row = 1;
      col = Math.floor(tNow * 10) % 4;
    }

    const spriteScale = 3.4 * v.bodyScale * cam.zoom * (v.action === "skill" ? 1.10 : 1.0);
    const flipX = v.facing < 0;
    const isHit = v.hitFlash > 0;
    const outlineCol: RGBA = isHit ? [255, 255, 255, 255] : [r, g, b, 255];

    sheet.drawFrame(fb, col, row, sx, sy + Math.round(34 * v.bodyScale * cam.zoom), {
      scale: spriteScale,
      flipX,
      outlineColor: outlineCol,
      outlinePx: 1,
      tint: isHit ? [255, 225, 225, 0.55] : undefined,
      alpha: v.alive ? 1 : clamp(1 - (v.actionAge - 0.5) * 0.8, 0.25, 1),
    });
  };

  // ---------- 4. 擂台碰撞火花、刀光与跳字特效 ----------
  const drawArenaFx = (
    fb: FrameBuf,
    tb: number,
    cam: { zoom: number; focusX: number; focusY: number },
    shx: number,
    shy: number,
  ) => {
    for (const fx of fxList) {
      const age = tb - fx.t0;
      if (age < 0) continue;

      if (fx.kind === "parrySpark") {
        // 武器交锋：金白十字星芒 + 扩散冲击环 + 14 颗飞溅金属火星 + "弹刀!" 跳字
        if (age > 0.46) continue;
        const k = age / 0.46;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const comboScale = 1 + Math.min(0.45, ((fx.combo ?? 1) - 1) * 0.16);

        // 扩散金属震波环
        const ringR = Math.round((28 + 135 * k) * comboScale * cam.zoom);
        const ringAlpha = Math.round(250 * (1 - k));
        fb.strokeRing(px, py, ringR, Math.max(3, Math.round(6 * (1 - k * 0.5))), [255, 232, 110, ringAlpha]);

        // 金白十字刀光星芒 (前 0.22s)
        if (age < 0.22) {
          const sk = 1 - age / 0.22;
          const starLen = Math.round(138 * comboScale * sk * cam.zoom);
          const starW = Math.max(4, Math.round(14 * sk * cam.zoom));
          fb.drawGlowCircle(px, py, Math.round(68 * comboScale * sk * cam.zoom), [255, 230, 105, Math.round(220 * sk)]);
          fb.fillRotatedRect(px, py, starLen, starW, Math.PI * 0.25, [255, 242, 140, 255]);
          fb.fillRotatedRect(px, py, starLen, starW, Math.PI * 0.75, [255, 242, 140, 255]);
          fb.fillRotatedRect(px, py, Math.round(starLen * 0.75), Math.max(3, Math.round(starW * 0.5)), 0, [255, 255, 255, 255]);
          fb.fillRotatedRect(px, py, Math.round(starLen * 0.75), Math.max(3, Math.round(starW * 0.5)), Math.PI * 0.5, [255, 255, 255, 255]);
        }

        // 14 颗高速飞溅金属火花粒子
        const sparkCount = 14;
        for (let i = 0; i < sparkCount; i++) {
          const ang = (i * Math.PI * 2) / sparkCount + (fx.t0 * 7.3);
          const spd = (85 + (i % 3) * 48) * comboScale;
          const dist = spd * Math.pow(k, 0.72) * cam.zoom;
          const sx1 = px + Math.cos(ang) * dist * 0.65;
          const sy1 = py + Math.sin(ang) * dist * 0.65;
          const sx2 = px + Math.cos(ang) * dist;
          const sy2 = py + Math.sin(ang) * dist;
          fb.drawLine(sx1, sy1, sx2, sy2, 4, [255, 236, 118, ringAlpha]);
        }

        // 弹反文字跳字（置于交锋火花下方，与角色头顶进化跳字上下错位不重叠）
        const popScale = easeOutBack(clamp(age / 0.14, 0, 1));
        const textAlpha = age > 0.28 ? Math.round(255 * (1 - (age - 0.28) / 0.18)) : 255;
        drawFit(
          fb,
          atlas,
          fx.text,
          px,
          py + Math.round((24 + 26 * k) * cam.zoom),
          [fx.color[0], fx.color[1], fx.color[2], textAlpha],
          240,
          0.46 * popScale * comboScale,
          "center",
          3,
        );
      } else if (fx.kind === "skillring") {
        if (age > 0.50) continue;
        const k = age / 0.50;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const rad = Math.round((42 + 150 * k) * cam.zoom);
        const alpha = Math.round(235 * (1 - k));
        fb.strokeRing(sx, sy, rad, Math.max(3, Math.round(7 * (1 - k * 0.5))), [fx.color[0], fx.color[1], fx.color[2], alpha]);
      } else if (fx.kind === "slash") {
        if (age > 0.30) continue;
        const k = age / 0.30;
        const [tx, ty] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const alpha = Math.round(255 * (1 - k));
        const rad = Math.round((68 + 64 * k) * cam.zoom);
        fb.drawArc(tx, ty, rad, Math.round(16 * (1 - k * 0.5)), -0.85 + k * 0.4, 1.35 + k * 0.4, [fx.color[0], fx.color[1], fx.color[2], alpha]);
        fb.drawArc(tx, ty, rad * 0.84, Math.round(8 * (1 - k * 0.5)), -0.75 + k * 0.4, 1.25 + k * 0.4, [255, 255, 240, alpha]);
      } else if (fx.kind === "lifestealOrb") {
        if (age > 0.42 || fx.tx === undefined || fx.ty === undefined) continue;
        const k = clamp(age / 0.42, 0, 1);
        const [x0, y0] = worldToScreen(fx.x, fx.y - 36, cam, shx, shy);
        const [x1, y1] = worldToScreen(fx.tx, fx.ty - 36, cam, shx, shy);
        const mx = (x0 + x1) / 2;
        const my = Math.min(y0, y1) - 95;
        const omt = 1 - k;
        const ox = omt * omt * x0 + 2 * omt * k * mx + k * k * x1;
        const oy = omt * omt * y0 + 2 * omt * k * my + k * k * y1;
        fb.drawGlowCircle(ox, oy, 22, [82, 248, 156, 225]);
        fb.fillCircle(ox, oy, 8, [230, 255, 240, 255]);
      } else if (fx.kind === "dmg" || fx.kind === "heal") {
        if (age > 0.72) continue;
        const k = age / 0.72;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const pop = age < 0.14 ? easeOutBack(age / 0.14) : 1 - (age - 0.14) * 0.18;
        const alpha = age > 0.48 ? Math.round(255 * (1 - (age - 0.48) / 0.24)) : 255;
        const baseScale = fx.big ? 0.58 : 0.48;
        drawFit(
          fb,
          atlas,
          fx.text,
          sx,
          sy - Math.round(62 * k),
          [fx.color[0], fx.color[1], fx.color[2], alpha],
          300,
          baseScale * pop,
          "center",
          3,
        );
      } else if (fx.kind === "evoPop") {
        // 角色头顶上方武器进化即时跳字（如 "剑长 220% +"）
        if (age > 0.68) continue;
        const k = age / 0.68;
        const f = byId[fx.side];
        const [sx, sy] = worldToScreen(visX[f.id], visY[f.id], cam, shx, shy);
        const pop = age < 0.15 ? easeOutBack(age / 0.15) : 1;
        const alpha = age > 0.45 ? Math.round(255 * (1 - (age - 0.45) / 0.23)) : 255;
        drawFit(
          fb,
          atlas,
          fx.text,
          sx,
          sy - Math.round((108 + 42 * k) * cam.zoom),
          [255, 238, 118, alpha],
          280,
          0.44 * pop,
          "center",
          3,
        );
      }
    }
  };

  // ---------- 5. 底部极简无边框高光字幕区 (Y: 1555..1920) ----------
  const drawBottomCleanZone = (fb: FrameBuf, tb: number) => {
    // 仅绘制柔和暗角渐变，绝不堆砌任何底部卡片！
    fb.blendGradientRect(0, 1555, W, H - 1555, [8, 7, 16, 40], [4, 3, 10, 235], true);

    // 查找最近一条高光事件字幕（弹刀连击或武器进化）
    let activeCallout: Fx | null = null;
    for (const fx of fxList) {
      if (fx.kind !== "callout") continue;
      const age = tb - fx.t0;
      if (age >= 0 && age <= 1.15) {
        activeCallout = fx;
      }
    }

    if (activeCallout) {
      const age = tb - activeCallout.t0;
      const inK = easeOutBack(clamp(age / 0.16, 0, 1));
      const alpha = age > 0.85 ? Math.round(255 * (1 - (age - 0.85) / 0.30)) : 255;
      drawFit(
        fb,
        atlas,
        activeCallout.text,
        W / 2,
        1588,
        [255, 242, 145, alpha],
        W - 96,
        0.46 * (0.88 + 0.12 * inK),
        "center",
        3,
        [8, 6, 18, alpha],
      );
    }
  };

  // ---------- 6. 极简高燃结算卡 (Victory Card) ----------
  const drawVictoryCard = (fb: FrameBuf, tb: number, tNow: number) => {
    if (!endEv) return;
    const k = clamp((tb - battleSec) / 0.42, 0, 1);
    fb.blendRect(0, 0, W, H, [6, 5, 14, Math.round(215 * k)]);
    if (k < 0.2) return;

    const winner = byId[endEv.winner];
    const loser = byId[endEv.winner === "A" ? "B" : "A"];
    const [wr, wg, wb] = hex(winner.color);

    const cardW = 900, cardH = 1040;
    const cx = W / 2;
    const cardX = cx - cardW / 2;
    const cardY = 390 + (1 - easeOutBack(k)) * 150;

    fb.drawGlowCircle(cx, cardY + 310, 460, [wr, wg, wb, 95]);

    fb.drawCard(cardX, cardY, cardW, cardH, {
      bgTop: [Math.round(wr * 0.42), Math.round(wg * 0.42), Math.round(wb * 0.42), 250],
      bgBottom: [14, 12, 26, 252],
      border: [255, 222, 98, 255],
      borderWidth: 4,
      radius: 32,
      shadowAlpha: 185,
      shadowOffsetY: 16,
      topHighlight: [255, 255, 255, 42],
    });

    fb.drawCard(cx - 270, cardY - 34, 540, 74, {
      bgTop: [255, 205, 68, 255],
      bgBottom: [228, 148, 28, 255],
      border: [255, 248, 210, 255],
      borderWidth: 3,
      radius: 22,
      shadowAlpha: 120,
      shadowOffsetY: 6,
    });
    drawFit(fb, atlasBig, "★ VICTORY · 胜者 ★", cx, cardY - 22, [255, 255, 255, 255], 500, 0.56, "center", 3);

    const stageY = cardY + 320;
    fb.drawGlowCircle(cx, stageY - 75, 185, [wr, wg, wb, 130]);
    fb.fillRotatedEllipse(cx, stageY, 130, 34, 0, [0, 0, 0, 150]);
    fb.strokeRing(cx, stageY, 130, 4, [255, 225, 110, 225]);

    const winCol = Math.floor(tNow * 10) % 6;
    sheets[winner.id].drawFrame(fb, winCol, 5, cx, stageY + 8, {
      scale: 5.2,
      flipX: false,
      outlineColor: [255, 242, 165, 255],
      outlinePx: 1,
    });

    drawFit(fb, atlasBig, winner.name, cx, cardY + 365, [255, 255, 255, 255], 760, 1.0, "center", 4);
    drawFit(
      fb,
      atlas,
      `「${winner.title}」 · 终极进化: ${winner.statLabel}`,
      cx,
      cardY + 475,
      [255, 232, 115, 255],
      760,
      0.54,
      "center",
      3,
    );

    const statY = cardY + 565;
    const stats: [string, string, RGBA][] = [
      ["武器进化", winner.statLabel, [255, 225, 92, 255]],
      ["剩余生命值", `${Math.ceil(winner.hp)} / ${winner.maxHp} HP`, [95, 245, 160, 255]],
      ["累计伤害", `${winner.totalDamageDealt} DMG`, [255, 168, 95, 255]],
      ["决胜时间", `${endEv.duration.toFixed(1)} 秒 (击败 ${loser.name})`, [185, 215, 255, 255]],
    ];

    for (let i = 0; i < stats.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const bx = cardX + 46 + col * 412;
      const by = statY + row * 158;
      fb.drawCard(bx, by, 396, 138, {
        bgTop: [22, 19, 42, 238],
        border: [wr, wg, wb, 150],
        borderWidth: 2,
        radius: 18,
        shadowAlpha: 60,
      });
      drawFit(fb, atlas, stats[i][0], bx + 198, by + 20, [185, 178, 226, 240], 350, 0.40, "center", 1);
      drawFit(fb, atlas, stats[i][1], bx + 198, by + 70, stats[i][2], 360, 0.50, "center", 2);
    }

    drawFit(
      fb,
      atlas,
      "★ 下期想看谁出战？评论区直接点播！ ★",
      cx,
      cardY + 935,
      [255, 232, 120, 255],
      cardW - 90,
      0.52,
      "center",
      2,
    );
  };

  // ---------- 逐帧生成器 ----------
  async function* frameGen() {
    for (let f = 0; f < totalFrames; f++) {
      const tNow = f / FPS;
      const dt = 1 / FPS;
      const fb = new FrameBuf(W, H);
      const tb = Math.max(0, tNow - INTRO_SEC);

      const cam = cameraAndStopAt(tb);
      if (!cam.freeze) {
        while (evIdx < events.length && events[evIdx].t <= tb) {
          applyEvent(events[evIdx++]);
        }
        for (const id of ["A", "B"] as Side[]) {
          const v = byId[id];
          v.actionAge += dt;
          v.statPulse = Math.max(0, v.statPulse - dt * 2.4);
          if (v.action !== "walk" && v.actionAge > 0.38 && v.alive) {
            v.action = "walk";
          }
          if (v.ghostHp > v.hp) {
            v.ghostHp = Math.max(v.hp, v.ghostHp - (v.ghostHp - v.hp) * 0.14 - 1.2);
          } else {
            v.ghostHp = v.hp;
          }
        }
      }

      const shx = cam.shake > 0 ? Math.round(Math.sin(tNow * 95) * cam.shake) : 0;
      const shy = cam.shake > 0 ? Math.round(Math.cos(tNow * 81) * cam.shake * 0.65) : 0;

      // 1. 巨型竖屏竞技场地面与霓虹护栏
      drawGiantArena(fb, tNow, tb, cam, shx, shy);

      // 2. 双方战斗球体 + 环绕实体进化武器 + 像素精灵（按 Y 深度排序）
      const order: Side[] = visY.A <= visY.B ? ["A", "B"] : ["B", "A"];
      for (const id of order) {
        drawFighterWithWeapon(fb, byId[id], tNow, cam, shx, shy);
      }

      // 3. 弹刀十字星芒火花 / 破防刀光 / 伤害跳字
      drawArenaFx(fb, tb, cam, shx, shy);

      // 4. 极简顶部 HUD（悬念标题 + 缓动血条 + Beat-Pop 武器进化徽章）
      drawMinimalTopHud(fb, tb, tNow);

      // 5. 底部极简无边框高光单行字幕
      drawBottomCleanZone(fb, tb);

      // 6. K.O. 决胜横幅
      const deathEv = events.find(e => e.type === "death") as Extract<SimEvent, { type: "death" }> | undefined;
      if (deathEv && tb >= deathEv.t + 0.12 && tb <= battleSec && endEv) {
        const winner = byId[endEv.winner];
        const koAge = tb - (deathEv.t + 0.12);
        const koScale = easeOutBack(clamp(koAge / 0.20, 0, 1));
        fb.drawCard(W / 2 - 340, 840, 680, 168, {
          bgTop: [36, 24, 64, 244],
          bgBottom: [18, 12, 36, 248],
          border: [255, 220, 90, 255],
          borderWidth: 4,
          radius: 28,
          shadowAlpha: 175,
          shadowOffsetY: 12,
        });
        drawFit(
          fb,
          atlasBig,
          `★ K.O. · ${winner.name} 胜 ★`,
          W / 2,
          878,
          [255, 235, 110, 255],
          620,
          0.85 * koScale,
          "center",
          4,
        );
      }

      // 7. 赛后荣誉台
      if (tb > battleSec) {
        drawVictoryCard(fb, tb, tNow);
      }

      for (const id of ["A", "B"] as Side[]) {
        byId[id].hitFlash = Math.max(0, byId[id].hitFlash - dt);
      }
      yield fb;
    }
  }

  await encodeFrames(frameGen(), { width: W, height: H, fps: FPS, outPath: outMp4, audioPath: sfxWav, crf: 19 });
  console.log(`duel rendered -> ${outMp4}`);
}

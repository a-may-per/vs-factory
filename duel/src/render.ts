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
import type { SimEvent, Side, WeaponKind, ScaleKind, CombatMode, BallSkillKind } from "./sim.ts";
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
  combatMode: CombatMode;
  ballSkillKind?: BallSkillKind;
  latchedTo: Side | null;
  punchCharge: number;
  slowed: boolean;
  vx: number;
  vy: number;
  wallSquashT: number;
  wallOrient: number;
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
  statPulse: number; // 0..1 武器/技能进化徽章 Beat-Pop 缩放脉冲
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
  // 默认开启 1.75s 高燃开局对战卡（展示双方环绕武器 + 进化法则契约），随后无缝切入高速拼刀对冲
  const { coldOpen = false, bgm = true, hookText } = opts;
  const lines = readFileSync(eventsPath, "utf-8").trim().split("\n");
  const events: SimEvent[] = lines.map(l => JSON.parse(l));

  const fontDir = new URL("../../shared/fonts/", import.meta.url).pathname;
  const atlas = new FontAtlas(fontDir + "atlas64.rgba", fontDir + "atlas64.json");
  const atlasBig = new FontAtlas(fontDir + "atlas96.rgba", fontDir + "atlas96.json");

  const artDir = new URL("../godot/art/", import.meta.url).pathname;
  const baseKnight = new SpriteSheet(artDir + "pumpkin_knight_sheet.png", 48, 48);
  const baseSlime = new SpriteSheet(artDir + "fire_slime_sheet.png", 48, 48);

  const pickHeroSheet = (name: string, id: Side): SpriteSheet => {
    if (name.includes("吸血鬼")) return baseKnight.withHueShift(-18, 1.48, 1.05);
    if (name.includes("蜘蛛")) return baseSlime.withHueShift(126, 1.42, 1.06);
    if (name.includes("光头")) return baseKnight.withHueShift(38, 1.40, 1.16);
    if (name.includes("老太")) return baseSlime.withHueShift(-52, 1.45, 1.12);
    if (name.includes("冰霜")) return baseKnight.withHueShift(172, 1.32, 1.08);
    if (name.includes("死神")) return baseKnight.withHueShift(-28, 1.40, 0.96);
    if (name.includes("南瓜")) return baseKnight;
    if (name.includes("雷电")) return baseSlime.withHueShift(32, 1.35, 1.08);
    if (name.includes("暗影")) return baseSlime.withHueShift(118, 1.35, 1.04);
    if (name.includes("史莱姆")) return baseSlime;
    return id === "A" ? baseKnight : baseSlime;
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
      combatMode: sp.combatMode ?? "weapon",
      ballSkillKind: sp.ballSkillKind,
      latchedTo: null,
      punchCharge: 0,
      slowed: false,
      vx: 0,
      vy: 0,
      wallSquashT: 0,
      wallOrient: 0,
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
  const sheets: Record<Side, SpriteSheet> = {
    A: pickHeroSheet(byId.A.name, "A"),
    B: pickHeroSheet(byId.B.name, "B"),
  };
  const endEv = events.find(e => e.type === "end") as Extract<SimEvent, { type: "end" }> | undefined;
  const duration = endEv ? endEv.duration : 24;

  // ---------- 紧凑时间轴段 ----------
  const VS_SEC = coldOpen ? 0 : 1.55;
  const INTRO_SEC = coldOpen ? 0 : 1.75;
  const battleSec = Math.min(duration + 0.9, 34);
  const settleSec = 2.2;
  const totalSec = INTRO_SEC + battleSec + settleSec;
  const totalFrames = Math.ceil(totalSec * FPS);

  // ---------- 音频：高辨识度金属拼刀 / 技能触发 SFX + 低占比 BGM ----------
  const sfxTracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  if (!coldOpen) {
    sfxTracks.push({ pcm: synthSfx("whoosh", 120, 1.1), offsetSec: 0.04, gain: 0.75 });
    sfxTracks.push({ pcm: synthSfx("vs-slam"), offsetSec: 0.24, gain: 0.98 });
    sfxTracks.push({ pcm: synthSfx("parry", 888, 1.25), offsetSec: 0.28, gain: 0.85 });
  }
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
    } else if (ev.type === "seriousPunch") {
      sfxTracks.push({ pcm: synthSfx("vs-slam", 500 + Math.floor(ev.t * 17)), offsetSec: at, gain: 1.0 });
      sfxTracks.push({ pcm: synthSfx("crit", 710 + Math.floor(ev.t * 13), 0.92), offsetSec: at + 0.03, gain: 0.95 });
    } else if (ev.type === "latchStart") {
      sfxTracks.push({ pcm: synthSfx("skill", 340 + Math.floor(ev.t * 11), 1.18), offsetSec: at, gain: 0.90 });
    } else if (ev.type === "webHit") {
      sfxTracks.push({ pcm: synthSfx("parry", 620 + Math.floor(ev.t * 17), 1.32), offsetSec: at, gain: 0.82 });
    } else if (ev.type === "soundWave") {
      sfxTracks.push({ pcm: synthSfx("skill", 460 + Math.floor(ev.t * 15), 0.95), offsetSec: at, gain: 0.85 });
    } else if (ev.type === "webSpawn") {
      sfxTracks.push({ pcm: synthSfx("whoosh", 820 + Math.floor(ev.t * 19), 1.45), offsetSec: at, gain: 0.36 });
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
      // 降低 BGM 混音占比至 0.18，让每一次金属弹刀与技能音效都清晰炸裂
      mixed[i] = mixed[i] + bgmPcm[i % bgmPcm.length] * 0.18;
    }
  }
  const sfxPcm = normalize(mixed, 0.92);
  const sfxWav = `/tmp/duel_audio_${process.pid}.wav`;
  writeWav(sfxPcm, sfxWav);

  // ---------- 预设特效时间轴 ----------
  interface Fx {
    t0: number;
    kind:
      | "dmg"
      | "heal"
      | "skillring"
      | "slash"
      | "lifestealOrb"
      | "wallRipple"
      | "parrySpark"
      | "hitBurst"
      | "evoPop"
      | "callout"
      | "seriousPunchWave"
      | "soundWaveRing"
      | "webCutSpark"
      | "latchClamp";
    side: Side;
    x: number;
    y: number;
    tx?: number;
    ty?: number;
    dirX?: number;
    dirY?: number;
    radius?: number;
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
      const isSkillBall = byId.A.combatMode === "skillball";
      fxList.push({
        t0: ev.t,
        kind: "parrySpark",
        side: "A",
        x: ev.x,
        y: ev.y,
        text: isSkillBall ? "硬刚碰撞!" : ev.combo >= 2 ? `连弹 ×${ev.combo}` : "弹反!",
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
          text: isSkillBall
            ? `★ 连续硬刚碰撞 ×${ev.combo} · 全场弹射加速 ★`
            : `★ 连续弹反 ×${ev.combo} · 双方武器狂暴加速 ★`,
          color: [255, 230, 98, 255],
        });
      }
    } else if (ev.type === "latchStart") {
      const vampire = byId[ev.id];
      const [r, g, b] = hex(vampire.color);
      fxList.push({
        t0: ev.t,
        kind: "latchClamp",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: `寄生吸附 ${ev.duration.toFixed(1)}s!`,
        color: [r, g, b, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ ${vampire.name} 死死吸附对手 · 持续咬血 ${ev.duration.toFixed(1)} 秒 ★`,
        color: [255, 92, 128, 255],
      });
    } else if (ev.type === "webHit") {
      fxList.push({
        t0: ev.t,
        kind: "webCutSpark",
        side: ev.target,
        x: ev.x,
        y: ev.y,
        text: ev.broken ? "蛛网崩断!" : "蛛丝切割!",
        color: [56, 250, 152, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.target,
        x: W / 2,
        y: 1592,
        text: `★ 误触剧毒蛛丝 · 切割扣血 -${ev.value} 并粘滞减速 ★`,
        color: [68, 252, 162, 255],
      });
    } else if (ev.type === "seriousPunch") {
      const caster = byId[ev.id];
      const pdx = ev.tx - ev.x;
      const pdy = ev.ty - ev.y;
      const plen = Math.max(1, Math.hypot(pdx, pdy));
      fxList.push({
        t0: ev.t,
        kind: "seriousPunchWave",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        tx: ev.tx,
        ty: ev.ty,
        dirX: pdx / plen,
        dirY: pdy / plen,
        text: "认真一拳!!",
        color: [255, 215, 58, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ ${caster.name} 蓄力 100% · 轰出「认真一拳」击飞对手 ★`,
        color: [255, 224, 72, 255],
      });
    } else if (ev.type === "soundWave") {
      const caster = byId[ev.id];
      const [r, g, b] = hex(caster.color);
      fxList.push({
        t0: ev.t,
        kind: "soundWaveRing",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        radius: ev.maxR,
        text: "高音外放!",
        color: [r, g, b, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ ${caster.name} 音响全开 · 高音震波震退全场 ★`,
        color: [255, 118, 225, 255],
      });
    } else if (ev.type === "damage") {
      const offsetX = ev.id === "A" ? -42 : 42;
      const isBig = ev.value >= 115;
      const attacker = byId[ev.from];
      const [ar, ag, ab] = hex(attacker.color);
      fxList.push({
        t0: ev.t,
        kind: "hitBurst",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "",
        color: [ar, ag, ab, 255],
        big: isBig,
      });
      fxList.push({
        t0: ev.t,
        kind: "dmg",
        side: ev.id,
        x: ev.x + offsetX,
        y: ev.y - 88,
        text: isBig ? `暴击 -${ev.value}` : `-${ev.value}`,
        color: isBig ? [255, 226, 76, 255] : [255, 102, 112, 255],
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
        caster.combatMode === "skillball"
          ? ev.statLabel
          : caster.scaleKind === "reach"
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
      if (caster.combatMode !== "skillball") {
        fxList.push({
          t0: ev.t,
          kind: "callout",
          side: ev.id,
          x: W / 2,
          y: 1592,
          text: `★ 武器进化 · ${caster.name} 「${ev.statLabel}」 ★`,
          color: [r, g, b, 255],
        });
      }
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
      if (byId.A.combatMode !== "skillball" && byId.B.combatMode !== "skillball") {
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
  }

  // ---------- 顿帧（Hit-Stop）与镜头震动推拉（Skill-Ball 模式保持 1.0x 稳定机位、零闪白、仅受击球体局部微震） ----------
  interface StopWindow {
    tStart: number;
    tEnd: number;
    focusX: number;
    focusY: number;
    zoom: number;
    shake: number;
    flashAlpha: number;
    targetSide?: Side;
  }
  const stops: StopWindow[] = [];
  const isSkillBallMode = byId.A.combatMode === "skillball" || byId.B.combatMode === "skillball";
  for (const ev of events) {
    if (isSkillBallMode) {
      if (ev.type === "seriousPunch") {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.068,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 9,
          flashAlpha: 0,
          targetSide: ev.target,
        });
      } else if (ev.type === "latchStart") {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.045,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 6,
          flashAlpha: 0,
          targetSide: ev.target,
        });
      } else if (ev.type === "webHit" && ev.broken) {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.042,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 6,
          flashAlpha: 0,
          targetSide: ev.target,
        });
      } else if (ev.type === "damage" && ev.tag?.includes("撞墙粉碎")) {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.052,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 8,
          flashAlpha: 0,
          targetSide: ev.id,
        });
      } else if (ev.type === "death") {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.16,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 10,
          flashAlpha: 0,
          targetSide: ev.id,
        });
      }
      continue;
    }

    if (ev.type === "parry") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.04,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.02 + Math.min(0.03, ev.combo * 0.01),
        shake: 6 + Math.min(6, ev.combo * 2),
        flashAlpha: 0,
      });
    } else if (ev.type === "skill") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.05,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.03,
        shake: 8,
        flashAlpha: 0,
      });
    } else if (ev.type === "death") {
      stops.push({
        tStart: ev.t,
        tEnd: ev.t + 0.24,
        focusX: ev.x,
        focusY: ev.y,
        zoom: 1.08,
        shake: 12,
        flashAlpha: 0,
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
    targetSide?: Side;
  } {
    let zoom = 1;
    let focusX = ARENA_W / 2;
    let focusY = ARENA_H / 2;
    let freeze = false;
    let shake = 0;
    let flashAlpha = 0;
    let targetSide: Side | undefined = undefined;
    for (const s of stops) {
      if (tBattle >= s.tStart && tBattle <= s.tEnd + 0.22) {
        const inStop = tBattle <= s.tEnd;
        if (inStop) freeze = true;
        const decay = inStop ? 1 : 1 - (tBattle - s.tEnd) / 0.22;
        const z = 1 + (s.zoom - 1) * decay;
        if (z >= zoom && s.shake * decay >= shake) {
          zoom = z;
          focusX = ARENA_W / 2 + (s.focusX - ARENA_W / 2) * 0.35 * decay;
          focusY = ARENA_H / 2 + (s.focusY - ARENA_H / 2) * 0.35 * decay;
          shake = s.shake * decay;
          flashAlpha = inStop ? s.flashAlpha : Math.round(s.flashAlpha * decay * 0.4);
          targetSide = s.targetSide;
        }
      }
    }
    return { freeze, zoom, focusX, focusY, shake, flashAlpha, targetSide };
  }

  // ---------- 预烘焙纯净竞技场底图缓冲区 (Clean Pre-baked Arena Floor Buffer) ----------
  const floorBuf = new FrameBuf(W, H);
  {
    const [ar, ag, ab] = hex(byId.A.color);
    const [br, bg, bb] = hex(byId.B.color);
    floorBuf.blendGradientRect(0, 336, W, H - 336, [10, 9, 20, 255], [6, 5, 14, 255], true);
    floorBuf.drawGlowCircle(AX + AW * 0.25, AY + AH * 0.45, 420, [ar, ag, ab, 28]);
    floorBuf.drawGlowCircle(AX + AW * 0.75, AY + AH * 0.55, 420, [br, bg, bb, 28]);
    floorBuf.fillRoundRect(AX - 8, AY - 8, AW + 16, AH + 16, 26, [6, 5, 14, 240]);
    floorBuf.blendGradientRect(AX, AY, AW, AH, [20, 18, 34, 255], [14, 12, 24, 255], true);

    const cols = 8;
    const rows = 10;
    const tileW = AW / cols;
    const tileH = AH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2 === 0) {
          floorBuf.blendRect(
            Math.round(AX + c * tileW),
            Math.round(AY + r * tileH),
            Math.ceil(tileW),
            Math.ceil(tileH),
            [27, 24, 45, 60],
          );
        }
      }
    }
    const cx = Math.round(AX + AW / 2);
    const cy = Math.round(AY + AH / 2);
    const ringR = 280;
    floorBuf.strokeRing(cx, cy, ringR, 2, [82, 74, 138, 38]);
    floorBuf.strokeRing(cx, cy, Math.round(ringR * 0.58), 2, [105, 94, 168, 26]);
    floorBuf.drawLine(AX + 24, cy, AX + AW - 24, cy, 2, [82, 74, 138, 24]);
  }

  // ---------- 事件回放状态推进 ----------
  let evIdx = 0;
  let totalClashes = 0;
  let maxParryCombo = 0;
  let currentParryStreak = 0;
  let lastClashTime = -10;

  // Skill-Ball 场地实时状态：蜘蛛网丝线（支持 Verlet 弹性弦弯曲振动）与广场舞伴舞大妈分身
  interface WebVisual {
    id: number;
    side: Side;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    tSpawn: number;
    lastHitT: number;
    hitX: number;
    hitY: number;
    hitVx: number;
    hitVy: number;
  }
  const activeWebs = new Map<number, WebVisual>();
  const snappedWebs: Array<{ x1: number; y1: number; x2: number; y2: number; tSnap: number }> = [];
  const activeClones: Record<Side, Array<{ id: number; x: number; y: number }>> = { A: [], B: [] };

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
      f.latchedTo = ev.latchedTo ?? null;
      f.punchCharge = ev.punchCharge ?? 0;
      f.slowed = ev.slowed ?? false;
      f.vx = ev.vx ?? dx * 10;
      f.vy = ev.vy ?? dy * 10;
      if (f.action === "idle") f.action = "walk";
    } else if (ev.type === "webSpawn") {
      activeWebs.set(ev.webId, {
        id: ev.webId,
        side: ev.id,
        x1: ev.x1,
        y1: ev.y1,
        x2: ev.x2,
        y2: ev.y2,
        tSpawn: ev.t,
        lastHitT: -10,
        hitX: (ev.x1 + ev.x2) * 0.5,
        hitY: (ev.y1 + ev.y2) * 0.5,
        hitVx: 0,
        hitVy: 0,
      });
      if (activeWebs.size > 14) {
        const oldestKey = activeWebs.keys().next().value;
        if (oldestKey !== undefined) activeWebs.delete(oldestKey);
      }
    } else if (ev.type === "webHit") {
      totalClashes++;
      const w = activeWebs.get(ev.webId);
      if (w) {
        w.lastHitT = ev.t;
        w.hitX = ev.x;
        w.hitY = ev.y;
        w.hitVx = ev.vx ?? 0;
        w.hitVy = ev.vy ?? 0;
        if (ev.broken) {
          snappedWebs.push({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, tSnap: ev.t });
          activeWebs.delete(ev.webId);
        }
      }
    } else if (ev.type === "latchStart") {
      totalClashes++;
      byId[ev.id].latchedTo = ev.target;
    } else if (ev.type === "latchEnd") {
      byId[ev.id].latchedTo = null;
    } else if (ev.type === "cloneSync") {
      activeClones[ev.id] = ev.clones;
    } else if (ev.type === "seriousPunch") {
      totalClashes++;
      lastClashTime = ev.t;
    } else if (ev.type === "soundWave") {
      totalClashes++;
      lastClashTime = ev.t;
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
      const f = byId[ev.id];
      f.wallBounces += 1;
      f.wallSquashT = 0.14;
      const nearSideWall = ev.x < 130 || ev.x > ARENA_W - 130;
      f.wallOrient = nearSideWall ? Math.PI * 0.5 : 0;
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

  // ---------- 绘制机制小球 / 抽象英雄专属外观与物理交互特效 ----------
  const drawSkillBallFeatures = (
    fb: FrameBuf,
    v: FighterView,
    sx: number,
    sy: number,
    cam: { zoom: number; focusX: number; focusY: number },
    tNow: number,
    shx = 0,
    shy = 0,
  ) => {
    if (!v.alive) return;
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    const orbR = 52 * v.bodyScale * cam.zoom;
    const kind = v.ballSkillKind;

    if (kind === "vampire_latch") {
      // 鲜血吸血鬼：两侧扇动恶魔血蝠翼 + 球体前缘猩红獠牙 + 钳制吸附锁链与咬合血环
      const isDominating = Boolean(v.latchedTo);
      const wingScale = isDominating ? 1.22 : 1.0;
      const flap = Math.sin(tNow * (isDominating ? 28 : 18)) * (isDominating ? 0.42 : 0.34);
      for (const sideSign of [-1, 1]) {
        const wingAng = sideSign * (0.25 + flap);
        const wx1 = sx + sideSign * orbR * 0.85;
        const wy1 = sy - orbR * 0.12;
        const wx2 = wx1 + sideSign * Math.cos(wingAng) * orbR * 1.05 * wingScale;
        const wy2 = wy1 - Math.sin(wingAng) * orbR * 0.85 * wingScale;
        fb.drawLine(wx1, wy1, wx2, wy2, Math.max(4, Math.round(8 * cam.zoom)), [r, g, b, 245]);
        // 3 根翼骨与暗红翼膜
        for (let bIdx = 0; bIdx < 3; bIdx++) {
          const subAng = wingAng + (bIdx + 1) * 0.32 * sideSign;
          const bx = wx1 + sideSign * Math.cos(subAng) * orbR * (0.88 - bIdx * 0.12) * wingScale;
          const by = wy1 + Math.sin(Math.abs(subAng)) * orbR * (0.45 + bIdx * 0.18) * wingScale;
          fb.drawLine(wx2, wy2, bx, by, Math.max(3, Math.round(5 * cam.zoom)), [r2, g2, b2, 220]);
          fb.drawLine(wx1, wy1, bx, by, Math.max(3, Math.round(6 * cam.zoom)), [255, 85, 120, 210]);
        }
      }
      // 球体下方一对纯白带血尖锐獠牙
      for (const fSign of [-1, 1]) {
        const fx1 = sx + fSign * orbR * 0.34;
        const fy1 = sy + orbR * 0.72;
        const fx2 = fx1 + fSign * orbR * 0.06;
        const fy2 = fy1 + orbR * 0.42;
        fb.drawLine(fx1, fy1, fx2, fy2, Math.max(4, Math.round(8 * cam.zoom)), [255, 250, 245, 255]);
        fb.fillCircle(fx2, fy2, Math.max(2, Math.round(4 * cam.zoom)), [255, 36, 72, 255]);
      }

      // 钳制吸附状态：吸血鬼作为行动主人，伸出双道猩红血爪死死钳住猎物拖拽掠行
      if (v.latchedTo) {
        const target = byId[v.latchedTo];
        const [tx, ty] = worldToScreen(visX[target.id], visY[target.id], cam, shx, shy);
        const dx = tx - sx;
        const dy = ty - sy;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const nx = -dy / dist;
        const ny = dx / dist;
        for (const cSign of [-1, 1]) {
          const cx1 = sx + nx * cSign * orbR * 0.55;
          const cy1 = sy + ny * cSign * orbR * 0.55;
          const cx2 = tx + nx * cSign * orbR * 0.62;
          const cy2 = ty + ny * cSign * orbR * 0.62;
          fb.drawLine(cx1, cy1, cx2, cy2, Math.max(5, Math.round(9 * cam.zoom)), [255, 24, 68, 235]);
          fb.drawLine(cx1, cy1, cx2, cy2, Math.max(2, Math.round(3 * cam.zoom)), [255, 225, 235, 245]);
        }
        const bitePulse = 1 + 0.09 * Math.sin(tNow * 28);
        fb.strokeRing(tx, ty, Math.round(64 * bitePulse * cam.zoom), Math.max(4, Math.round(6 * cam.zoom)), [255, 32, 76, 235]);
      }
    } else if (kind === "spider_web") {
      // 剧毒蜘蛛王：左右各 4 条双关节机械毒蛛长腿（被吸血鬼钳制时高频挣扎抽动）
      const foeSide: Side = v.id === "A" ? "B" : "A";
      const isCaptured = byId[foeSide].latchedTo === v.id;
      for (const sideSign of [-1, 1]) {
        for (let leg = 0; leg < 4; leg++) {
          const baseSpread = (leg - 1.5) * 0.34;
          const stepWave = Math.sin(tNow * (isCaptured ? 36 : 16) + leg * 1.4 + (sideSign > 0 ? 0 : Math.PI)) * (isCaptured ? 0.28 : 0.18);
          const ang1 = (sideSign > 0 ? 0 : Math.PI) + baseSpread * sideSign + stepWave;
          const len1 = orbR * 0.95;
          const len2 = orbR * 0.88;
          const rootX = sx + Math.cos(ang1) * orbR * 0.78;
          const rootY = sy + Math.sin(ang1) * orbR * 0.78;
          const kneeX = rootX + Math.cos(ang1 - sideSign * 0.35) * len1;
          const kneeY = rootY + Math.sin(ang1 - sideSign * 0.35) * len1;
          const tipAng = ang1 + sideSign * 0.55;
          const tipX = kneeX + Math.cos(tipAng) * len2;
          const tipY = kneeY + Math.sin(tipAng) * len2;

          fb.drawLine(rootX, rootY, kneeX, kneeY, Math.max(4, Math.round(7 * cam.zoom)), [r2, g2, b2, 245]);
          fb.drawLine(rootX, rootY, kneeX, kneeY, Math.max(2, Math.round(4 * cam.zoom)), [r, g, b, 255]);
          fb.drawLine(kneeX, kneeY, tipX, tipY, Math.max(3, Math.round(5 * cam.zoom)), [195, 255, 225, 255]);
          fb.fillCircle(kneeX, kneeY, Math.max(3, Math.round(5 * cam.zoom)), [255, 255, 255, 240]);
          fb.fillCircle(tipX, tipY, Math.max(2, Math.round(4 * cam.zoom)), [46, 255, 148, 255]);
        }
      }
    } else if (kind === "one_punch") {
      // 一拳光头：飘扬纯白正义披风 + 黄金蓄力进度光环 + 前方一对高饱和红色重拳拳套
      const capeDir = -v.facing;
      const capeWave = Math.sin(tNow * 14) * 14 * cam.zoom;
      const capeLen = orbR * 1.45;
      fb.fillRotatedRect(
        sx + capeDir * orbR * 0.95,
        sy + orbR * 0.12 + capeWave * 0.4,
        capeLen,
        orbR * 1.15,
        capeDir * 0.18 + Math.sin(tNow * 12) * 0.08,
        [245, 248, 255, 235],
      );
      fb.fillRotatedRect(
        sx + capeDir * orbR * 0.95,
        sy + orbR * 0.12 + capeWave * 0.4,
        capeLen * 0.85,
        orbR * 0.85,
        capeDir * 0.18,
        [215, 224, 242, 220],
      );

      // 黄金蓄力环 (0..100%)
      const charge = clamp((v.punchCharge || 35) / 100, 0.08, 1);
      const chargeSpan = charge * Math.PI * 2;
      fb.drawArc(
        sx,
        sy,
        orbR * 1.24,
        Math.max(4, Math.round(8 * cam.zoom)),
        -Math.PI * 0.5,
        -Math.PI * 0.5 + chargeSpan,
        charge >= 0.85 ? [255, 72, 48, 255] : [255, 218, 58, 240],
      );

      // 前方双红拳套（随蓄力高频出拳抖动）
      const punchBob = Math.sin(tNow * 20) * 12 * cam.zoom;
      for (const gSign of [-1, 1]) {
        const gx = sx + v.facing * (orbR * 1.08 + (gSign > 0 ? punchBob : -punchBob));
        const gy = sy + gSign * orbR * 0.38;
        fb.drawGlowCircle(gx, gy, Math.round(28 * cam.zoom), [255, 195, 48, 185]);
        fb.fillCircle(gx, gy, Math.round(20 * cam.zoom), [235, 38, 38, 255]);
        fb.strokeRing(gx, gy, Math.round(20 * cam.zoom), 3, [255, 235, 130, 255]);
        fb.fillCircle(gx - v.facing * 4 * cam.zoom, gy - 5 * cam.zoom, Math.round(6 * cam.zoom), [255, 185, 185, 235]);
      }
    } else if (kind === "dance_granny") {
      // 广场舞老太：球顶/身侧背负大功率霓虹音响 + 跳动频谱柱 + 环绕声波脉冲环
      const spkX = sx - v.facing * orbR * 0.92;
      const spkY = sy - orbR * 0.25;
      const spkW = Math.round(46 * cam.zoom);
      const spkH = Math.round(68 * cam.zoom);
      fb.fillRoundRect(spkX - spkW / 2 - 3, spkY - spkH / 2 - 3, spkW + 6, spkH + 6, 10, [34, 240, 255, 255]);
      fb.fillRoundRect(spkX - spkW / 2, spkY - spkH / 2, spkW, spkH, 8, [24, 18, 42, 250]);
      // 双低音喇叭振膜随节拍缩放
      const beatR = Math.round((10 + 3 * Math.sin(tNow * 24)) * cam.zoom);
      fb.fillCircle(spkX, spkY - Math.round(14 * cam.zoom), beatR, [255, 58, 195, 255]);
      fb.fillCircle(spkX, spkY + Math.round(14 * cam.zoom), beatR, [34, 235, 255, 255]);

      // 环绕球体的霓虹律动音波弧
      for (let wIdx = 0; wIdx < 3; wIdx++) {
        const a = tNow * 5 + (wIdx * Math.PI * 2) / 3;
        fb.drawArc(sx, sy, orbR * (1.22 + 0.12 * Math.sin(tNow * 16 + wIdx)), Math.max(3, Math.round(6 * cam.zoom)), a, a + 0.9, [38, 240, 255, 220]);
      }
    }

    // 被蜘蛛丝减速缠绕时的白色粘丝束缚视觉提示
    if (v.slowed) {
      fb.strokeRing(sx, sy, Math.round(orbR * 1.08), Math.max(3, Math.round(5 * cam.zoom)), [185, 255, 220, 235]);
      fb.drawLine(sx - orbR * 0.9, sy - orbR * 0.5, sx + orbR * 0.9, sy + orbR * 0.5, 4, [235, 255, 245, 235]);
      fb.drawLine(sx - orbR * 0.9, sy + orbR * 0.5, sx + orbR * 0.9, sy - orbR * 0.5, 4, [235, 255, 245, 235]);
    }
  };

  // ---------- 绘制机制小球 / 抽象英雄球体内部专属高辨识度面孔 (Skill-Ball Avatar) ----------
  const drawSkillBallAvatar = (
    fb: FrameBuf,
    kind: BallSkillKind | undefined,
    sx: number,
    sy: number,
    orbR: number,
    facing: 1 | -1,
    isHit: boolean,
    alpha: number,
    tNow: number,
  ) => {
    const a255 = Math.round(255 * alpha);
    const dir = facing >= 0 ? 1 : -1;

    if (kind === "vampire_latch") {
      // 鲜血吸血鬼球体面孔：暗紫苍白伯爵球面 + 竖立红黑披风领 + 猩红斜眼 + 邪魅坏笑与长獠牙（恒定高辨识配色，受击不闪白）
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [48, 22, 42, a255]);
      // 顶部伯爵美人尖黑发
      fb.fillCircle(sx - Math.round(orbR * 0.28), sy - Math.round(orbR * 0.58), Math.round(orbR * 0.32), [16, 10, 24, a255]);
      fb.fillCircle(sx + Math.round(orbR * 0.28), sy - Math.round(orbR * 0.58), Math.round(orbR * 0.32), [16, 10, 24, a255]);
      fb.drawLine(sx, sy - Math.round(orbR * 0.72), sx, sy - Math.round(orbR * 0.35), Math.max(4, Math.round(orbR * 0.22)), [16, 10, 24, a255]);
      // 双眼：猩红发光斜眼 + 纯白竖瞳
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.30 + dir * orbR * 0.05;
        const ey = sy - orbR * 0.12;
        fb.fillRotatedEllipse(ex, ey, Math.round(orbR * 0.20), Math.round(orbR * 0.11), es * 0.32, [255, 28, 68, a255]);
        fb.fillCircle(ex, ey, Math.max(2, Math.round(orbR * 0.06)), [255, 245, 220, a255]);
      }
      // 邪笑嘴线 + 两颗滴血尖锐长獠牙
      const my = sy + orbR * 0.22;
      fb.drawArc(sx + dir * orbR * 0.04, my - orbR * 0.10, orbR * 0.34, Math.max(3, Math.round(orbR * 0.07)), 0.35, Math.PI - 0.35, [255, 72, 105, a255]);
      for (const fs of [-1, 1]) {
        const fx = sx + fs * orbR * 0.20 + dir * orbR * 0.04;
        fb.drawLine(fx, my + orbR * 0.04, fx, my + orbR * 0.32, Math.max(3, Math.round(orbR * 0.11)), [255, 255, 255, a255]);
        fb.fillCircle(fx, my + orbR * 0.34, Math.max(2, Math.round(orbR * 0.06)), [255, 24, 58, a255]);
      }
    } else if (kind === "spider_web") {
      // 剧毒蜘蛛王球体面孔：深绿黑寡妇甲壳 + 额头荧光绿剧毒沙漏纹 + 6 颗复眼矩阵 + 剧毒颚钳（受击不闪白）
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [14, 34, 26, a255]);
      // 额头剧毒荧光绿沙漏纹
      fb.fillRotatedRect(sx, sy - orbR * 0.44, Math.round(orbR * 0.26), Math.round(orbR * 0.26), Math.PI * 0.25, [42, 255, 148, a255]);
      // 6 颗蜘蛛复眼（2 大主眼 + 4 颗副眼）
      for (const es of [-1, 1]) {
        const ex1 = sx + es * orbR * 0.24;
        const ey1 = sy - orbR * 0.06;
        fb.fillCircle(ex1, ey1, Math.round(orbR * 0.15), [255, 36, 78, a255]);
        fb.fillCircle(ex1 + es * 2, ey1 - 2, Math.max(2, Math.round(orbR * 0.06)), [255, 255, 255, a255]);
        const ex2 = sx + es * orbR * 0.48;
        const ey2 = sy - orbR * 0.16;
        fb.fillCircle(ex2, ey2, Math.round(orbR * 0.09), [46, 255, 152, a255]);
        const ex3 = sx + es * orbR * 0.38;
        const ey3 = sy + orbR * 0.12;
        fb.fillCircle(ex3, ey3, Math.round(orbR * 0.07), [46, 255, 152, a255]);
      }
      // 底部一对开合剧毒鳌牙钳
      const pinch = Math.sin(tNow * 18) * orbR * 0.06;
      for (const ps of [-1, 1]) {
        const px0 = sx + ps * orbR * 0.22;
        const py0 = sy + orbR * 0.34;
        const px1 = sx + ps * (orbR * 0.08 + pinch);
        const py1 = sy + orbR * 0.58;
        fb.drawLine(px0, py0, px1, py1, Math.max(3, Math.round(orbR * 0.11)), [62, 255, 162, a255]);
      }
    } else if (kind === "one_punch") {
      // 一拳光头球体面孔：标志性锃亮光头球面 + 头顶高光反光斑 + 认真死鱼眼/怒眉 + 黄色战衣红领拉链（受击不闪白）
      fb.fillCircle(sx, sy, Math.round(orbR * 0.82), [255, 224, 182, a255]);
      // 底部黄色英雄战衣与白色圆领扣
      fb.drawArc(sx, sy, orbR * 0.68, Math.max(6, Math.round(orbR * 0.26)), 0.35, Math.PI - 0.35, [255, 205, 28, a255]);
      fb.fillCircle(sx - orbR * 0.28, sy + orbR * 0.52, Math.max(3, Math.round(orbR * 0.09)), [255, 255, 255, a255]);
      fb.fillCircle(sx + orbR * 0.28, sy + orbR * 0.52, Math.max(3, Math.round(orbR * 0.09)), [255, 255, 255, a255]);
      // 光头头顶标志性锃亮反光白斑
      fb.fillRotatedEllipse(sx - orbR * 0.26, sy - orbR * 0.44, Math.round(orbR * 0.24), Math.round(orbR * 0.11), -0.48, [255, 255, 255, a255]);
      fb.fillCircle(sx - orbR * 0.04, sy - orbR * 0.56, Math.max(2, Math.round(orbR * 0.06)), [255, 255, 255, a255]);
      // 认真一拳死鱼眼 + 陡峭浓眉
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * orbR * 0.06;
        const ey = sy - orbR * 0.06;
        fb.fillRotatedEllipse(ex, ey, Math.round(orbR * 0.16), Math.round(orbR * 0.10), 0, [255, 255, 255, a255]);
        fb.fillCircle(ex + dir * 2, ey, Math.max(2, Math.round(orbR * 0.06)), [18, 16, 24, a255]);
        // 认真斜压黑眉
        fb.drawLine(
          ex - es * orbR * 0.16,
          ey - orbR * 0.12,
          ex + es * orbR * 0.16,
          ey - orbR * 0.20,
          Math.max(3, Math.round(orbR * 0.08)),
          [28, 22, 18, a255],
        );
      }
      // 紧抿的认真嘴线
      fb.drawLine(sx - orbR * 0.14 + dir * 3, sy + orbR * 0.22, sx + orbR * 0.16 + dir * 3, sy + orbR * 0.20, Math.max(3, Math.round(orbR * 0.07)), [95, 52, 38, a255]);
    } else if (kind === "dance_granny") {
      // 广场舞老太球体面孔：蓬松卷发发髻 + 炫酷金框墨镜 + 喜庆大笑嘴 + 红金丝巾领（受击不闪白）
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [255, 226, 196, a255]);
      // 头顶 5 团蓬松时尚卷发泡
      for (let i = -2; i <= 2; i++) {
        const hx = sx + i * orbR * 0.24;
        const hy = sy - orbR * (0.64 - Math.abs(i) * 0.07);
        fb.fillCircle(hx, hy, Math.round(orbR * 0.24), [58, 24, 52, a255]);
        fb.strokeRing(hx, hy, Math.round(orbR * 0.24), 2, [255, 88, 205, a255]);
      }
      // 炫酷金框迪斯科墨镜
      for (const es of [-1, 1]) {
        const gx = sx + es * orbR * 0.26 + dir * orbR * 0.04;
        const gy = sy - orbR * 0.06;
        fb.fillRoundRect(gx - Math.round(orbR * 0.18), gy - Math.round(orbR * 0.12), Math.round(orbR * 0.36), Math.round(orbR * 0.24), 6, [22, 18, 42, a255]);
        fb.strokeRoundRect(gx - Math.round(orbR * 0.18), gy - Math.round(orbR * 0.12), Math.round(orbR * 0.36), Math.round(orbR * 0.24), 6, 3, [255, 218, 68, a255]);
      }
      fb.drawLine(sx - orbR * 0.10, sy - orbR * 0.06, sx + orbR * 0.10, sy - orbR * 0.06, 3, [255, 218, 68, a255]);
      // 喜庆大笑红唇与红脸蛋
      fb.fillCircle(sx - orbR * 0.42, sy + orbR * 0.12, Math.round(orbR * 0.11), [255, 110, 155, Math.round(a255 * 0.75)]);
      fb.fillCircle(sx + orbR * 0.42, sy + orbR * 0.12, Math.round(orbR * 0.11), [255, 110, 155, Math.round(a255 * 0.75)]);
      fb.drawArc(sx + dir * 2, sy + orbR * 0.14, orbR * 0.22, Math.max(3, Math.round(orbR * 0.09)), 0.2, Math.PI - 0.2, [235, 36, 92, a255]);
      // 底部广场舞红金飘带丝巾
      fb.drawArc(sx, sy, orbR * 0.68, Math.max(5, Math.round(orbR * 0.22)), 0.4, Math.PI - 0.4, [255, 42, 118, a255]);
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
      const streakLabel =
        byId.A.combatMode === "skillball"
          ? `★ 连续硬刚 ×${currentParryStreak} · 技能狂暴 ★`
          : `★ 连续弹反 ×${currentParryStreak} · 剑速狂暴 ★`;
      drawFit(
        fb,
        atlas,
        streakLabel,
        cx,
        282,
        [255, 232, 88, 255],
        640,
        0.44 * pulse,
        "center",
        3,
      );
    } else if (tb >= 17) {
      const pulse = Math.round(215 + 40 * Math.sin(tNow * 14));
      drawFit(
        fb,
        atlas,
        "★ 终局狂暴时刻 · 技能进化拉满 · 伤害全面爆发 ★",
        cx,
        284,
        [255, 196, 78, pulse],
        660,
        0.38,
        "center",
        2,
      );
    } else if (tb >= 10) {
      const pulse = Math.round(205 + 35 * Math.sin(tNow * 10));
      drawFit(
        fb,
        atlas,
        "★ 中盘升温 · 技能交锋与场地封锁升级 ★",
        cx,
        284,
        [235, 222, 138, pulse],
        620,
        0.37,
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
    // 直接拷贝持久化地表战损缓冲区（含网格底图 + 整场累积的拳坑裂纹、血滴与毒液印记）
    fb.data.set(floorBuf.data);

    const ax = AX;
    const ay = AY;
    const [ar, ag, ab] = hex(byId.A.color);
    const [br, bg, bb] = hex(byId.B.color);

    // 擂台四周高饱和霓虹边界框（稳固锁死，不随震屏晃动）
    const borderPulse = Math.round(215 + 30 * Math.sin(tNow * 6));
    fb.strokeRoundRect(ax, ay, AW, AH, 20, 5, [110, 98, 195, 225]);
    fb.drawLine(ax + 16, ay + 2, ax + AW / 2, ay + 2, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW / 2, ay + 2, ax + AW - 16, ay + 2, 5, [br, bg, bb, borderPulse]);
    fb.drawLine(ax + 2, ay + 20, ax + 2, ay + AH - 20, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW - 2, ay + 20, ax + AW - 2, ay + AH - 20, 5, [br, bg, bb, borderPulse]);
    fb.drawLine(ax + 16, ay + AH - 2, ax + AW / 2, ay + AH - 2, 5, [ar, ag, ab, borderPulse]);
    fb.drawLine(ax + AW / 2, ay + AH - 2, ax + AW - 16, ay + AH - 2, 5, [br, bg, bb, borderPulse]);

    // 弹墙冲击波涟漪（仅武器模式启用）
    for (const fx of fxList) {
      if (fx.kind !== "wallRipple") continue;
      const age = tb - fx.t0;
      if (age < 0 || age > 0.42) continue;
      const k = age / 0.42;
      const [wx, wy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
      const rad = Math.round((24 + 92 * k) * cam.zoom);
      const alpha = Math.round(160 * (1 - k));
      fb.strokeRing(wx, wy, rad, 3, [fx.color[0], fx.color[1], fx.color[2], alpha]);
    }

    // ---------- Skill-Ball 场地机制 1：剧毒蜘蛛王铺设的盘丝洞弹性毒网丝线（Verlet 拨弦弯曲物理） ----------
    for (const web of activeWebs.values()) {
      const [x1, y1] = worldToScreen(web.x1, web.y1, cam, shx, shy);
      const [x2, y2] = worldToScreen(web.x2, web.y2, cam, shx, shy);
      const hitAge = tb - web.lastHitT;
      const isVibrating = hitAge >= 0 && hitAge < 0.46;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      let nx = -dy / len;
      let ny = dx / len;
      // 让弦的初始弯曲方向顺应球体撞击速度方向
      if (web.hitVx * nx + web.hitVy * ny < 0) {
        nx = -nx;
        ny = -ny;
      }

      // 阻尼简谐拨弦位移：前 0.08s 深度绷紧下凹，随后高速回弹震颤
      const pluckAmp = isVibrating ? Math.exp(-hitAge * 5.6) * Math.cos(hitAge * 42) * 44 * cam.zoom : 0;

      // 分 10 段绘制二阶贝塞尔弹性弓弦曲线
      const segs = 10;
      let px0 = x1;
      let py0 = y1;
      for (let s = 1; s <= segs; s++) {
        const u = s / segs;
        const env = Math.sin(u * Math.PI);
        const harmonic = isVibrating ? Math.sin(u * Math.PI * 2 + tNow * 58) * pluckAmp * 0.18 : 0;
        const disp = pluckAmp * env + harmonic;
        const px1 = x1 + dx * u + nx * disp;
        const py1 = y1 + dy * u + ny * disp;
        // 翠绿高张力毒液丝线 + 纯白蛛丝内芯
        fb.drawLine(px0, py0, px1, py1, Math.max(3, Math.round((isVibrating ? 8 : 5) * cam.zoom)), [36, 238, 138, isVibrating ? 245 : 150]);
        fb.drawLine(px0, py0, px1, py1, Math.max(2, Math.round(2 * cam.zoom)), [230, 255, 240, 225]);
        px0 = px1;
        py0 = py1;
      }

      // 两端蛛网极简锚点小圆点
      for (const [axp, ayp] of [[x1, y1], [x2, y2]]) {
        fb.fillCircle(axp, ayp, Math.round(5 * cam.zoom), [185, 255, 220, 225]);
      }
    }

    // 刚崩断的蜘蛛丝回弹残影
    for (const sw of snappedWebs) {
      const age = tb - sw.tSnap;
      if (age < 0 || age > 0.34) continue;
      const k = age / 0.34;
      const [x1, y1] = worldToScreen(sw.x1, sw.y1, cam, shx, shy);
      const [x2, y2] = worldToScreen(sw.x2, sw.y2, cam, shx, shy);
      const mx = (x1 + x2) * 0.5;
      const my = (y1 + y2) * 0.5;
      const alpha = Math.round(230 * (1 - k));
      fb.drawLine(x1, y1, mx + (x1 - mx) * k, my + (y1 - my) * k, 4, [180, 255, 215, alpha]);
      fb.drawLine(x2, y2, mx + (x2 - mx) * k, my + (y2 - my) * k, 4, [180, 255, 215, alpha]);
    }

    // ---------- Skill-Ball 场地机制 2：广场舞老太召唤的伴舞大妈分身球 ----------
    for (const side of ["A", "B"] as Side[]) {
      const clones = activeClones[side];
      if (!clones || clones.length === 0) continue;
      const owner = byId[side];
      const [r, g, b] = hex(owner.color);
      const [r2, g2, b2] = hex(owner.color2);
      const sheet = sheets[side];
      for (const c of clones) {
        const [cxp, cyp] = worldToScreen(c.x, c.y, cam, shx, shy);
        const cR = Math.round(32 * cam.zoom);
        fb.fillRotatedEllipse(cxp, cyp + cR * 0.72, cR * 0.9, Math.round(11 * cam.zoom), 0, [0, 0, 0, 130]);
        fb.drawGlowCircle(cxp, cyp, Math.round(cR * 1.45), [r, g, b, 110]);
        fb.fillCircle(cxp, cyp, cR, [r2, g2, b2, 225]);
        fb.fillCircle(cxp, cyp, Math.round(cR * 0.84), [20, 16, 36, 240]);
        fb.strokeRing(cxp, cyp, cR, Math.max(3, Math.round(4 * cam.zoom)), [34, 238, 255, 250]);
        const col = Math.floor(tNow * 12 + c.id) % 4;
        if (owner.combatMode === "skillball") {
          drawSkillBallAvatar(fb, owner.ballSkillKind, cxp, cyp, cR, owner.facing, false, 1, tNow + c.id);
        } else {
          sheet.drawFrame(fb, col, 1, cxp, cyp + Math.round(20 * cam.zoom), {
            scale: 2.1 * cam.zoom,
            flipX: owner.facing < 0,
            outlineColor: [255, 245, 190, 255],
            outlinePx: 1,
          });
        }
        drawFit(fb, atlas, "伴舞", cxp, cyp - cR - Math.round(22 * cam.zoom), [255, 238, 128, 245], 90, 0.28, "center", 2);
      }
    }
  };

  // ---------- 3. 绘制战斗球体 + 像素角色 + 环绕进化武器 / 技能球外观（含 Squash & Stretch 形变） ----------
  const drawFighterWithWeapon = (
    fb: FrameBuf,
    v: FighterView,
    tNow: number,
    cam: { zoom: number; focusX: number; focusY: number },
    shx: number,
    shy: number,
    localShakeX = 0,
    localShakeY = 0,
  ) => {
    visX[v.id] += (v.x - visX[v.id]) * 0.48;
    visY[v.id] += (v.y - visY[v.id]) * 0.48;

    const [baseSx, baseSy] = worldToScreen(visX[v.id], visY[v.id], cam, shx, shy);
    const sx = baseSx + localShakeX;
    const sy = baseSy + localShakeY;
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    const sheet = sheets[v.id];

    // 1. 柔和残影轨迹（降低残影不透明度，避免球体高速弹射时拖泥带水）
    for (let i = v.trail.length - 1; i >= 0; i--) {
      const tr = v.trail[i];
      tr.alpha *= 0.72;
      if (tr.alpha < 0.08) continue;
      const [tx, ty] = worldToScreen(tr.x, tr.y, cam, shx, shy);
      const trR = Math.round(44 * tr.bodyScale * cam.zoom);
      fb.fillCircle(tx, ty, trR, [r, g, b, Math.round(tr.alpha * 24)]);
    }

    // 2. 绘制环绕实体武器 (weapon 模式) 或 机制小球专属特征 (skillball 模式)
    if (v.combatMode === "skillball") {
      drawSkillBallFeatures(fb, v, sx, sy, cam, tNow, shx, shy);
    } else {
      drawOrbitingWeapons(fb, v, sx, sy, cam, tNow);
    }

    // 3. 脚底立体投影、刚体挤压拉伸形变 (Squash & Stretch) 与高阶狂暴气焰环
    const orbR = Math.round(52 * v.bodyScale * cam.zoom);
    const isHit = v.hitFlash > 0;
    fb.fillRotatedEllipse(sx, sy + orbR * 0.72, orbR * 0.92, Math.round(18 * cam.zoom), 0, [0, 0, 0, 145]);

    // 终局高阶进化（>=4层）专属狂暴斗气外环
    if (v.rageStacks >= 4) {
      const auraPulse = 1 + 0.07 * Math.sin(tNow * 20 + (v.id === "A" ? 0 : 2));
      fb.strokeRing(
        sx,
        sy,
        Math.round(orbR * 1.18 * auraPulse),
        3,
        [255, 224, 92, Math.min(220, 95 + v.rageStacks * 18)],
      );
    }

    // 刚体物理形变：弹墙瞬间扁平挤压 (Wall Squash) 或 超高速击飞期间流线拉伸 (Velocity Stretch)
    const speedMag = Math.hypot(v.vx, v.vy);
    const moveAng = Math.atan2(v.vy, v.vx);
    if (v.wallSquashT > 0) {
      const sq = v.wallSquashT / 0.14;
      const rx = Math.round(orbR * (1 + 0.24 * sq));
      const ry = Math.round(orbR * (1 - 0.18 * sq));
      fb.fillRotatedEllipse(sx, sy, rx + 4, ry + 4, v.wallOrient, [255, 240, 175, Math.round(185 * sq)]);
    } else if (speedMag > 620 && !v.latchedTo) {
      const stretch = clamp((speedMag - 620) / 550, 0.08, 0.32);
      const rx = Math.round(orbR * (1 + stretch));
      const ry = Math.round(orbR * (1 - stretch * 0.55));
      fb.fillRotatedEllipse(sx, sy, rx + 5, ry + 5, moveAng, [r, g, b, 175]);
    }

    fb.drawGlowCircle(sx, sy, Math.round(orbR * 1.38), [r, g, b, v.action === "skill" ? 110 : 65]);
    fb.fillCircle(sx, sy, orbR, [r2, g2, b2, 215]);
    fb.fillCircle(sx, sy, Math.round(orbR * 0.86), [18, 16, 32, 235]);
    fb.strokeRing(sx, sy, orbR, Math.max(4, Math.round(5 * cam.zoom)), isHit ? [255, 240, 165, 255] : [r, g, b, 255]);
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
    const outlineCol: RGBA = isHit ? [255, 255, 255, 255] : [r, g, b, 255];
    const alphaVal = v.alive ? 1 : clamp(1 - (v.actionAge - 0.5) * 0.8, 0.25, 1);

    if (v.combatMode === "skillball") {
      drawSkillBallAvatar(fb, v.ballSkillKind, sx, sy, orbR, v.facing, isHit, alphaVal, tNow);
    } else {
      sheet.drawFrame(fb, col, row, sx, sy + Math.round(34 * v.bodyScale * cam.zoom), {
        scale: spriteScale,
        flipX,
        outlineColor: outlineCol,
        outlinePx: 1,
        tint: isHit ? [255, 225, 225, 0.55] : undefined,
        alpha: alphaVal,
      });
    }
  };

  // ---------- 4. 擂台碰撞火花、刀光、技能波与跳字特效（清爽分层防遮挡版） ----------
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

      if (fx.kind === "seriousPunchWave") {
        // 一拳光头「认真一拳」：干净凌厉的定向金色拳压光束 + 单道高能音爆弧
        if (age > 0.46) continue;
        const k = age / 0.46;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const [tx, ty] = worldToScreen(fx.tx ?? fx.x, fx.ty ?? fx.y, cam, shx, shy);
        const dirX = fx.dirX ?? 1;
        const dirY = fx.dirY ?? 0;
        const ang = Math.atan2(dirY, dirX);
        const alpha = Math.round(255 * (1 - k));

        // 1 道沿出拳方向推进的定向音爆冲击弧
        const dist = (85 + k * 260) * cam.zoom;
        const cxp = sx + dirX * dist;
        const cyp = sy + dirY * dist;
        const rad = Math.round((68 + k * 95) * cam.zoom);
        fb.drawArc(cxp, cyp, rad, Math.max(5, Math.round(12 * (1 - k * 0.4))), ang - 0.85, ang + 0.85, [255, 82, 48, alpha]);
        fb.strokeRing(cxp, cyp, Math.round(rad * 0.88), Math.max(3, Math.round(6 * (1 - k * 0.5))), [255, 218, 68, alpha]);

        // 拳压主光束
        const beamLen = (190 + k * 340) * cam.zoom;
        const bx = sx + dirX * beamLen * 0.5;
        const by = sy + dirY * beamLen * 0.5;
        fb.fillRotatedRect(bx, by, beamLen, Math.round(42 * (1 - k * 0.4) * cam.zoom), ang, [255, 198, 52, Math.round(alpha * 0.72)]);
        fb.fillRotatedRect(bx, by, beamLen * 0.90, Math.round(18 * (1 - k * 0.4) * cam.zoom), ang, [255, 252, 225, alpha]);

        const popScale = easeOutBack(clamp(age / 0.14, 0, 1));
        drawFit(
          fb,
          atlasBig,
          fx.text,
          tx,
          ty - Math.round((92 + 34 * k) * cam.zoom),
          [255, 232, 75, alpha],
          380,
          0.58 * popScale,
          "center",
          4,
        );
      } else if (fx.kind === "soundWaveRing") {
        // 广场舞老太「高音震波」：干净通透的双色霓虹同心扩散声波环（去掉杂乱车轮放射线）
        if (age > 0.48) continue;
        const k = age / 0.48;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const maxR = (fx.radius ?? 310) * cam.zoom;
        const r1 = Math.round(45 + (maxR - 45) * k);
        const r2 = Math.round(r1 * 0.72);
        const alpha = Math.round(220 * (1 - k));
        fb.strokeRing(sx, sy, r1, Math.max(3, Math.round(6 * (1 - k * 0.5))), [255, 58, 198, alpha]);
        fb.strokeRing(sx, sy, r2, Math.max(2, Math.round(4 * (1 - k * 0.5))), [36, 238, 255, alpha]);
      } else if (fx.kind === "webCutSpark") {
        // 蛛丝切割火花：翠绿十字切割闪光（不重复叠字，把空间留给伤害跳字与底部字幕）
        if (age > 0.36) continue;
        const k = age / 0.36;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const alpha = Math.round(240 * (1 - k));
        fb.strokeRing(px, py, Math.round((22 + 76 * k) * cam.zoom), 3, [48, 252, 152, alpha]);
        if (age < 0.18) {
          const sk = 1 - age / 0.18;
          fb.fillRotatedRect(px, py, Math.round(96 * sk * cam.zoom), Math.max(3, Math.round(8 * sk * cam.zoom)), 0.45, [195, 255, 225, 245]);
          fb.fillRotatedRect(px, py, Math.round(96 * sk * cam.zoom), Math.max(3, Math.round(8 * sk * cam.zoom)), -0.45, [48, 252, 152, 245]);
        }
      } else if (fx.kind === "latchClamp") {
        // 吸血鬼寄生吸附瞬间：猩红血环收缩咬合特效（不重复叠字）
        if (age > 0.38) continue;
        const k = age / 0.38;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const alpha = Math.round(245 * (1 - k));
        const rShrink = Math.round((120 - 65 * k) * cam.zoom);
        fb.strokeRing(px, py, rShrink, 5, [255, 36, 76, alpha]);
      } else if (fx.kind === "parrySpark") {
        if (age > 0.42) continue;
        const k = age / 0.42;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const comboScale = 1 + Math.min(0.45, ((fx.combo ?? 1) - 1) * 0.16);
        const ringR = Math.round((26 + (isSkillBallMode ? 88 : 135) * k) * comboScale * cam.zoom);
        const ringAlpha = Math.round(240 * (1 - k));
        fb.strokeRing(px, py, ringR, Math.max(3, Math.round(5 * (1 - k * 0.5))), [255, 232, 110, ringAlpha]);

        if (!isSkillBallMode && age < 0.22) {
          // 武器模式专属：金白十字刀光星芒
          const sk = 1 - age / 0.22;
          const starLen = Math.round(138 * comboScale * sk * cam.zoom);
          const starW = Math.max(4, Math.round(14 * sk * cam.zoom));
          fb.drawGlowCircle(px, py, Math.round(68 * comboScale * sk * cam.zoom), [255, 230, 105, Math.round(220 * sk)]);
          fb.fillRotatedRect(px, py, starLen, starW, Math.PI * 0.25, [255, 242, 140, 255]);
          fb.fillRotatedRect(px, py, starLen, starW, Math.PI * 0.75, [255, 242, 140, 255]);
          fb.fillRotatedRect(px, py, Math.round(starLen * 0.75), Math.max(3, Math.round(starW * 0.5)), 0, [255, 255, 255, 255]);
          fb.fillRotatedRect(px, py, Math.round(starLen * 0.75), Math.max(3, Math.round(starW * 0.5)), Math.PI * 0.5, [255, 255, 255, 255]);
        }

        const sparkCount = isSkillBallMode ? 6 : 14;
        for (let i = 0; i < sparkCount; i++) {
          const ang = (i * Math.PI * 2) / sparkCount + fx.t0 * 7.3;
          const spd = (75 + (i % 3) * 38) * comboScale;
          const dist = spd * Math.pow(k, 0.72) * cam.zoom;
          const sx1 = px + Math.cos(ang) * dist * 0.65;
          const sy1 = py + Math.sin(ang) * dist * 0.65;
          const sx2 = px + Math.cos(ang) * dist;
          const sy2 = py + Math.sin(ang) * dist;
          fb.drawLine(sx1, sy1, sx2, sy2, 4, [255, 236, 118, ringAlpha]);
        }

        if (!isSkillBallMode) {
          const popScale = easeOutBack(clamp(age / 0.14, 0, 1));
          const textAlpha = age > 0.28 ? Math.round(255 * (1 - (age - 0.28) / 0.14)) : 255;
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
        }
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
        if (age > 0.38 || fx.tx === undefined || fx.ty === undefined) continue;
        const k = clamp(age / 0.38, 0, 1);
        const [x0, y0] = worldToScreen(fx.x, fx.y - 28, cam, shx, shy);
        const [x1, y1] = worldToScreen(fx.tx, fx.ty - 28, cam, shx, shy);
        const mx = (x0 + x1) / 2;
        const my = Math.min(y0, y1) - 70;
        const omt = 1 - k;
        const ox = omt * omt * x0 + 2 * omt * k * mx + k * k * x1;
        const oy = omt * omt * y0 + 2 * omt * k * my + k * k * y1;
        fb.drawGlowCircle(ox, oy, 16, [82, 248, 156, 195]);
        fb.fillCircle(ox, oy, 6, [230, 255, 240, 250]);
      } else if (fx.kind === "hitBurst") {
        // 受击火花：Skill-Ball 模式克制闪光，仅保留简短火星线，绝不遮挡球体表情
        if (age > 0.28) continue;
        const k = age / 0.28;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const burstScale = (fx.big ? 1.2 : 0.9) * cam.zoom;
        const alpha = Math.round(235 * (1 - k));
        if (!isSkillBallMode && age < 0.12) {
          fb.drawGlowCircle(px, py, Math.round(68 * burstScale * (1 - age / 0.12)), [fx.color[0], fx.color[1], fx.color[2], Math.round(180 * (1 - age / 0.12))]);
        }
        const count = isSkillBallMode ? (fx.big ? 8 : 5) : 12;
        for (let i = 0; i < count; i++) {
          const ang = (i * Math.PI * 2) / count + fx.t0 * 11.7;
          const spd = (80 + (i % 3) * 42) * burstScale;
          const dist = spd * Math.pow(k, 0.68);
          const x1 = px + Math.cos(ang) * dist * 0.58;
          const y1 = py + Math.sin(ang) * dist * 0.58;
          const x2 = px + Math.cos(ang) * dist;
          const y2 = py + Math.sin(ang) * dist;
          const col: RGBA = i % 2 === 0 ? [255, 244, 168, alpha] : [fx.color[0], fx.color[1], fx.color[2], alpha];
          fb.drawLine(x1, y1, x2, y2, 3, col);
        }
      } else if (fx.kind === "dmg" || fx.kind === "heal") {
        if (age > 0.64) continue;
        // 防叠字过滤：若同一侧 0.30s 内已经弹出了更新的同类数值，自动隐去旧字，彻底杜绝数字糊成一团
        const hasNewer = fxList.some(
          other =>
            other !== fx &&
            other.kind === fx.kind &&
            other.side === fx.side &&
            other.t0 > fx.t0 &&
            other.t0 <= tb &&
            other.t0 - fx.t0 < 0.30,
        );
        if (hasNewer) continue;

        const k = age / 0.64;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const pop = age < 0.14 ? easeOutBack(age / 0.14) : 1 - (age - 0.14) * 0.18;
        const alpha = age > 0.42 ? Math.round(255 * (1 - (age - 0.42) / 0.22)) : 255;
        const baseScale = fx.big ? 0.64 : 0.50;
        drawFit(
          fb,
          atlas,
          fx.text,
          sx,
          sy - Math.round(56 * k),
          [fx.color[0], fx.color[1], fx.color[2], alpha],
          300,
          baseScale * pop,
          "center",
          3,
        );
      } else if (fx.kind === "evoPop") {
        // Skill-Ball 模式顶部已有全宽进化进度条实时脉冲，不再在球体头顶叠一层进化字以避免与扣血数字打架
        if (isSkillBallMode) continue;
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

  // ---------- 6. 开局高燃对战卡 (VS Intro Battle Card) ----------
  const drawVsIntro = (fb: FrameBuf, tNow: number) => {
    const fadeOut = tNow > VS_SEC ? clamp(1 - (tNow - VS_SEC) / Math.max(0.05, INTRO_SEC - VS_SEC), 0, 1) : 1;
    if (fadeOut <= 0.01) return;

    // 深邃暗色遮罩衬底（顶部 HUD 区 100% 遮蔽不透字，最后 0.2s 平滑退场切入擂台）
    fb.blendRect(0, 0, W, 345, [6, 5, 14, Math.round(255 * fadeOut)]);
    fb.blendRect(0, 345, W, H - 345, [6, 5, 14, Math.round(240 * fadeOut)]);

    const [ar, ag, ab] = hex(byId.A.color);
    const [br, bg, bb] = hex(byId.B.color);
    fb.drawGlowCircle(240, 780, 440, [ar, ag, ab, Math.round(80 * fadeOut)]);
    fb.drawGlowCircle(W - 240, 780, 440, [br, bg, bb, Math.round(80 * fadeOut)]);

    // 顶部大号悬念标题区
    const isSkillBallMatch = byId.A.combatMode === "skillball" || byId.B.combatMode === "skillball";
    const headline = hookText ?? "巨剑无限变长 VS 双剑无限加速，谁能活到最后？";
    drawFit(
      fb,
      atlas,
      isSkillBallMatch
        ? "★ 抽象英雄技能球对决 · 预测谁能活到最后？ ★"
        : "★ 全自动武器进化对决 · 预测谁能活到最后？ ★",
      W / 2,
      68,
      [255, 222, 96, Math.round(255 * fadeOut)],
      W - 80,
      0.44,
      "center",
      3,
    );
    drawFit(
      fb,
      atlas,
      headline,
      W / 2,
      132,
      [255, 255, 255, Math.round(255 * fadeOut)],
      W - 72,
      0.54,
      "center",
      3,
    );

    const cardW = 468;
    const cardH = 1160;
    const cardY = 230 + Math.round((1 - fadeOut) * -60);

    for (const id of ["A", "B"] as Side[]) {
      const v = byId[id];
      const [r, g, b] = hex(v.color);
      const isLeft = id === "A";
      const enterK = easeOutBack(clamp((tNow - (isLeft ? 0 : 0.05)) / 0.30, 0, 1));
      const baseX = isLeft ? 36 : W - 36 - cardW;
      const offsetX = isLeft ? Math.round((1 - enterK) * -420) : Math.round((1 - enterK) * 420);
      const x = baseX + offsetX;
      const cx = x + cardW / 2;

      fb.drawCard(x, cardY, cardW, cardH, {
        bgTop: [Math.round(r * 0.44), Math.round(g * 0.44), Math.round(b * 0.44), Math.round(248 * fadeOut)],
        bgBottom: [14, 12, 28, Math.round(252 * fadeOut)],
        border: [r, g, b, Math.round(255 * fadeOut)],
        borderWidth: 4,
        radius: 28,
        shadowAlpha: Math.round(165 * fadeOut),
        shadowOffsetY: 14,
        topHighlight: [255, 255, 255, Math.round(45 * fadeOut)],
      });

      // 角色展台 + 实时高速旋转的初始环绕武器预览
      const stageY = cardY + 255;
      fb.drawGlowCircle(cx, stageY - 30, 145, [r, g, b, Math.round(115 * fadeOut)]);
      fb.fillRotatedEllipse(cx, stageY + 36, 118, 28, 0, [0, 0, 0, Math.round(155 * fadeOut)]);
      fb.strokeRing(cx, stageY - 18, 92, 3, [r, g, b, Math.round(190 * fadeOut)]);

      const previewFighter: FighterView = {
        ...v,
        alive: true,
        facing: isLeft ? 1 : -1,
        weaponAngle: (isLeft ? 0.4 : Math.PI - 0.4) + (isLeft ? 1 : -1) * tNow * v.baseSpinSpeed * 0.85,
        reach: Math.min(148, v.baseReach * 0.84),
        bodyScale: 1.08,
        punchCharge: v.ballSkillKind === "one_punch" ? Math.round(55 + 35 * Math.sin(tNow * 4)) : 0,
      };
      if (v.combatMode === "skillball") {
        drawSkillBallFeatures(fb, previewFighter, cx, stageY - 18, { zoom: 1.25, focusX: 0, focusY: 0 }, tNow);
        const pOrbR = Math.round(74);
        fb.fillCircle(cx, stageY - 18, pOrbR, [18, 16, 32, Math.round(240 * fadeOut)]);
        fb.strokeRing(cx, stageY - 18, pOrbR, 5, [r, g, b, Math.round(255 * fadeOut)]);
        drawSkillBallAvatar(fb, v.ballSkillKind, cx, stageY - 18, pOrbR, isLeft ? 1 : -1, false, fadeOut, tNow);
      } else {
        drawOrbitingWeapons(fb, previewFighter, cx, stageY - 18, { zoom: 0.76 }, tNow);
        const col = Math.floor(tNow * 10) % 4;
        sheets[id].drawFrame(fb, col, 2, cx, stageY + 18, {
          scale: 4.5,
          flipX: !isLeft,
          outlineColor: [255, 248, 210, Math.round(255 * fadeOut)],
          outlinePx: 1,
          alpha: fadeOut,
        });
      }

      // 英雄主名称与流派副标题徽章
      drawFit(
        fb,
        atlasBig,
        v.name,
        cx,
        cardY + 355,
        [255, 255, 255, Math.round(255 * fadeOut)],
        cardW - 44,
        0.74,
        "center",
        4,
      );

      fb.drawCard(cx - 165, cardY + 452, 330, 56, {
        bgTop: [26, 22, 48, Math.round(240 * fadeOut)],
        border: [r, g, b, Math.round(215 * fadeOut)],
        borderWidth: 2,
        radius: 16,
      });
      drawFit(
        fb,
        atlas,
        `「${v.title}」`,
        cx,
        cardY + 462,
        [255, 232, 118, Math.round(255 * fadeOut)],
        300,
        0.46,
        "center",
        2,
      );

      // 核心武器进化法则专属大面板（彻底解决战斗内小字拥挤问题，开局一眼看懂爽点契约！）
      const ruleY = cardY + 534;
      fb.drawCard(x + 22, ruleY, cardW - 44, 210, {
        bgTop: [30, 24, 54, Math.round(246 * fadeOut)],
        bgBottom: [18, 14, 34, Math.round(250 * fadeOut)],
        border: [255, 215, 88, Math.round(240 * fadeOut)],
        borderWidth: 3,
        radius: 20,
      });
      drawFit(
        fb,
        atlas,
        v.combatMode === "skillball" ? "★ 核心技能法则 ★" : "★ 武器进化法则 ★",
        cx,
        ruleY + 18,
        [255, 222, 92, Math.round(255 * fadeOut)],
        cardW - 80,
        0.40,
        "center",
        2,
      );
      drawFit(
        fb,
        atlas,
        v.hookRule,
        cx,
        ruleY + 76,
        [255, 255, 255, Math.round(255 * fadeOut)],
        cardW - 68,
        0.46,
        "center",
        3,
      );
      drawFit(
        fb,
        atlas,
        v.passiveDesc,
        cx,
        ruleY + 142,
        [205, 218, 255, Math.round(245 * fadeOut)],
        cardW - 68,
        0.38,
        "center",
        2,
      );

      // 三项核心战斗属性栏
      const rows: [string, string, RGBA][] = [
        ["生命值", `${v.maxHp} HP`, [98, 248, 162, Math.round(255 * fadeOut)]],
        ["核心主动技", `「${v.activeName}」`, [255, 216, 102, Math.round(255 * fadeOut)]],
        ["核心被动技", `「${v.passive}」`, [145, 222, 255, Math.round(255 * fadeOut)]],
      ];
      for (let i = 0; i < rows.length; i++) {
        const ry = cardY + 772 + i * 116;
        fb.drawCard(x + 22, ry, cardW - 44, 98, {
          bgTop: [22, 18, 40, Math.round(236 * fadeOut)],
          border: [r, g, b, Math.round(145 * fadeOut)],
          borderWidth: 2,
          radius: 16,
        });
        drawFit(
          fb,
          atlas,
          rows[i][0],
          x + 46,
          ry + 28,
          [188, 182, 228, Math.round(240 * fadeOut)],
          165,
          0.38,
          "left",
          2,
        );
        drawFit(
          fb,
          atlas,
          rows[i][1],
          x + cardW - 46,
          ry + 24,
          rows[i][2],
          230,
          0.46,
          "right",
          3,
        );
      }
    }

    // 中央巨型 VS 徽章重砸登场
    if (tNow >= 0.18) {
      const vsAge = tNow - 0.18;
      const vsPop = easeOutBack(clamp(vsAge / 0.22, 0, 1));
      const vcx = W / 2;
      const vcy = 760;
      if (vsAge < 0.36) {
        const rk = vsAge / 0.36;
        fb.strokeRing(vcx, vcy, Math.round(70 + 220 * rk), 6, [255, 230, 105, Math.round(240 * (1 - rk) * fadeOut)]);
      }
      const boxR = Math.round(78 * vsPop);
      fb.drawGlowCircle(vcx, vcy, Math.round(140 * vsPop), [255, 208, 72, Math.round(165 * fadeOut)]);
      fb.drawCard(vcx - boxR, vcy - boxR, boxR * 2, boxR * 2, {
        bgTop: [255, 208, 68, Math.round(255 * fadeOut)],
        bgBottom: [218, 112, 18, Math.round(255 * fadeOut)],
        border: [255, 250, 215, Math.round(255 * fadeOut)],
        borderWidth: 4,
        radius: 36,
        shadowAlpha: Math.round(185 * fadeOut),
        shadowOffsetY: 10,
      });
      drawFit(
        fb,
        atlasBig,
        "VS",
        vcx,
        vcy - Math.round(44 * vsPop),
        [255, 255, 255, Math.round(255 * fadeOut)],
        140,
        0.96 * vsPop,
        "center",
        4,
      );
    }
  };

  // ---------- 7. 极简高燃结算卡 (Victory Card) ----------
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
    if (winner.combatMode === "skillball") {
      const winPreview: FighterView = { ...winner, alive: true, latchedTo: null, punchCharge: 100 };
      drawSkillBallFeatures(fb, winPreview, cx, stageY - 58, { zoom: 1.45, focusX: 0, focusY: 0 }, tNow);
      const wOrbR = 86;
      fb.fillCircle(cx, stageY - 58, wOrbR, [18, 16, 32, 248]);
      fb.strokeRing(cx, stageY - 58, wOrbR, 6, [wr, wg, wb, 255]);
      drawSkillBallAvatar(fb, winner.ballSkillKind, cx, stageY - 58, wOrbR, 1, false, 1, tNow);
    } else {
      sheets[winner.id].drawFrame(fb, winCol, 5, cx, stageY + 8, {
        scale: 5.2,
        flipX: false,
        outlineColor: [255, 242, 165, 255],
        outlinePx: 1,
      });
    }

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
      [winner.combatMode === "skillball" ? "终极状态" : "武器进化", winner.statLabel, [255, 225, 92, 255]],
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
          v.wallSquashT = Math.max(0, v.wallSquashT - dt);
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

      const shx = isSkillBallMode ? 0 : cam.shake > 0 ? Math.round(Math.sin(tNow * 95) * cam.shake) : 0;
      const shy = isSkillBallMode ? 0 : cam.shake > 0 ? Math.round(Math.cos(tNow * 81) * cam.shake * 0.65) : 0;

      // 1. 巨型竖屏竞技场地面与霓虹护栏
      drawGiantArena(fb, tNow, tb, cam, shx, shy);

      // 2. 双方战斗球体 + 环绕实体进化武器 + 像素精灵（若一方正钳制吸附对手，则吸附方固定在最上层作为行动主人）
      const order: Side[] = byId.A.latchedTo
        ? ["B", "A"]
        : byId.B.latchedTo
          ? ["A", "B"]
          : visY.A <= visY.B
            ? ["A", "B"]
            : ["B", "A"];
      for (const id of order) {
        const isTargetShake = isSkillBallMode && cam.shake > 0 && (!cam.targetSide || cam.targetSide === id);
        const localShx = isTargetShake ? Math.round(Math.sin(tNow * 155) * cam.shake) : 0;
        const localShy = isTargetShake ? Math.round(Math.cos(tNow * 137) * cam.shake * 0.8) : 0;
        drawFighterWithWeapon(fb, byId[id], tNow, cam, shx, shy, localShx, localShy);
      }

      // 3. 弹刀十字星芒火花 / 破防刀光 / 伤害跳字
      drawArenaFx(fb, tb, cam, shx, shy);

      // 4. 极简顶部 HUD（悬念标题 + 缓动血条 + Beat-Pop 武器进化徽章）
      drawMinimalTopHud(fb, tb, tNow);

      // 5. 底部极简无边框高光单行字幕
      drawBottomCleanZone(fb, tb);

      // 6. 开局高燃对战卡（展示双方环绕进化武器与进化法则契约）
      if (!coldOpen && tNow < INTRO_SEC) {
        drawVsIntro(fb, tNow);
      }

      // 7. K.O. 决胜横幅
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

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
  frozen: boolean;
  vx: number;
  vy: number;
  wallSquashT: number;
  wallOrient: number;
  ghostHoldT: number;
  barShakeT: number;
  healFlashT: number;
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
      frozen: false,
      vx: 0,
      vy: 0,
      wallSquashT: 0,
      wallOrient: 0,
      ghostHoldT: 0,
      barShakeT: 0,
      healFlashT: 0,
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

  // ---------- 紧凑时间轴段（首帧满配 VS 海报封面 + 0.35s 闪击立即开打 + 1.35s 绝杀慢放击飞演出） ----------
  const VS_SEC = coldOpen ? 0 : 0.25;
  const INTRO_SEC = coldOpen ? 0 : 0.35;
  const battleSec = Math.min(duration + 1.35, 65);
  const settleSec = 1.40;
  const totalSec = INTRO_SEC + battleSec + settleSec;
  const totalFrames = Math.ceil(totalSec * FPS);

  // ---------- 音频：高辨识度金属拼刀 / 技能触发 SFX + 低占比 BGM ----------
  const sfxTracks: { pcm: Float32Array; offsetSec: number; gain?: number }[] = [];
  if (!coldOpen) {
    sfxTracks.push({ pcm: synthSfx("vs-slam"), offsetSec: 0.02, gain: 0.98 });
    sfxTracks.push({ pcm: synthSfx("parry", 888, 1.25), offsetSec: 0.08, gain: 0.85 });
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
    } else if (ev.type === "railgunShot") {
      sfxTracks.push({ pcm: synthSfx("vs-slam", 580 + Math.floor(ev.t * 17)), offsetSec: at, gain: 0.96 });
      sfxTracks.push({ pcm: synthSfx("skill", 720 + Math.floor(ev.t * 13), 1.38), offsetSec: at + 0.02, gain: 0.92 });
    } else if (ev.type === "frostNova") {
      sfxTracks.push({ pcm: synthSfx("parry", 840 + Math.floor(ev.t * 19), 1.45), offsetSec: at, gain: 0.88 });
      sfxTracks.push({ pcm: synthSfx("skill", 510 + Math.floor(ev.t * 15), 1.18), offsetSec: at + 0.02, gain: 0.82 });
    } else if (ev.type === "ultCast") {
      if (ev.style === "beam") {
        sfxTracks.push({ pcm: synthSfx("vs-slam", 610 + Math.floor(ev.t * 17)), offsetSec: at, gain: 0.94 });
        sfxTracks.push({ pcm: synthSfx("skill", 740 + Math.floor(ev.t * 13), 1.34), offsetSec: at + 0.02, gain: 0.90 });
      } else if (ev.style === "rush") {
        sfxTracks.push({ pcm: synthSfx("vs-slam", 520 + Math.floor(ev.t * 17)), offsetSec: at, gain: 0.96 });
        sfxTracks.push({ pcm: synthSfx("crit", 680 + Math.floor(ev.t * 13), 1.05), offsetSec: at + 0.02, gain: 0.92 });
      } else if (ev.style === "storm") {
        sfxTracks.push({ pcm: synthSfx("parry", 790 + Math.floor(ev.t * 19), 1.38), offsetSec: at, gain: 0.90 });
        sfxTracks.push({ pcm: synthSfx("skill", 590 + Math.floor(ev.t * 15), 1.22), offsetSec: at + 0.03, gain: 0.88 });
      } else {
        sfxTracks.push({ pcm: synthSfx("vs-slam", 560 + Math.floor(ev.t * 15)), offsetSec: at, gain: 0.92 });
        sfxTracks.push({ pcm: synthSfx("skill", 520 + Math.floor(ev.t * 17), 1.14), offsetSec: at + 0.02, gain: 0.88 });
      }
    } else if (ev.type === "propHit") {
      if (
        ev.propKind === "chili_bomb" ||
        ev.propKind === "wall_shatter" ||
        ev.propKind === "wrecking_ball" ||
        ev.propKind === "brick_wall"
      ) {
        sfxTracks.push({ pcm: synthSfx("crit", 520 + Math.floor(ev.t * 17), 1.12), offsetSec: at, gain: 0.86 });
      } else if (
        ev.propKind === "fish_hook" ||
        ev.propKind === "bumper_arc" ||
        ev.propKind === "bumper_peg" ||
        ev.propKind === "voodoo_effigy" ||
        ev.propKind === "sub_beyblade" ||
        ev.propKind === "shuriken"
      ) {
        sfxTracks.push({ pcm: synthSfx("parry", 760 + Math.floor(ev.t * 19), 1.36), offsetSec: at, gain: 0.84 });
      } else if (ev.propKind === "milk_tea") {
        sfxTracks.push({ pcm: synthSfx("coin", 560 + Math.floor(ev.t * 13), 1.25), offsetSec: at, gain: 0.68 });
      } else {
        sfxTracks.push({ pcm: synthSfx("skill", 480 + Math.floor(ev.t * 15), 1.18), offsetSec: at, gain: 0.80 });
      }
    } else if (ev.type === "webSpawn") {
      sfxTracks.push({ pcm: synthSfx("whoosh", 820 + Math.floor(ev.t * 19), 1.45), offsetSec: at, gain: 0.36 });
    } else if (ev.type === "skill") {
      sfxTracks.push({ pcm: synthSfx("skill", 200 + Math.floor(ev.t * 11), 1.04), offsetSec: at, gain: 0.92 });
    } else if (ev.type === "damage") {
      const isCrit = ev.value >= (byId.A.combatMode === "skillball" ? 48 : 135);
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
    const matchHash =
      (byId.A.name.charCodeAt(0) || 7) * 31 +
      (byId.B.name.charCodeAt(0) || 13) * 17 +
      events.length;
    const chordSets: number[][] = [
      [0, -4, -7, -5],
      [0, -5, -2, -7],
      [0, -3, -7, -2],
      [0, -7, -4, -5],
    ];
    const bgmPcm = generateBgm({
      bpm: 146 + (matchHash % 5) * 2,
      bars: 16,
      chordRoots: chordSets[matchHash % chordSets.length],
      chordType: "minor",
      melodySeed: 7 + (matchHash % 19),
      lead: matchHash % 2 === 0 ? "square" : "saw",
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
      | "railgunBeam"
      | "frostNovaRing"
      | "ultBurst"
      | "propBurst"
      | "webCutSpark"
      | "latchClamp"
      | "killExplosion";
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
    val?: number;
    fxStyle?: "bolt" | "whirl";
    ultStyle?: "beam" | "nova" | "rush" | "storm";
    propKind?: string;
  }

  const fxList: Fx[] = [];
  const deathEv = events.find((e): e is Extract<SimEvent, { type: "death" }> => e.type === "death");
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
    } else if (ev.type === "railgunShot") {
      const caster = byId[ev.id];
      const pdx = ev.tx - ev.x;
      const pdy = ev.ty - ev.y;
      const plen = Math.max(1, Math.hypot(pdx, pdy));
      fxList.push({
        t0: ev.t,
        kind: "railgunBeam",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        tx: ev.tx,
        ty: ev.ty,
        dirX: pdx / plen,
        dirY: pdy / plen,
        text: "超载电磁炮!!",
        color: [38, 232, 255, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ ${caster.name} 蓄力 100% · 轰出「超载电磁炮」 ★`,
        color: [68, 238, 255, 255],
      });
    } else if (ev.type === "frostNova") {
      const caster = byId[ev.id];
      fxList.push({
        t0: ev.t,
        kind: "frostNovaRing",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        radius: ev.maxR,
        text: "绝对零度!!",
        color: [48, 244, 255, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: `★ ${caster.name} 释放「绝对零度」 · 冰封定身对手 ★`,
        color: [98, 245, 255, 255],
      });
    } else if (ev.type === "ultCast") {
      const caster = byId[ev.id];
      const [cr, cg, cb] = hex(caster.color);
      const pdx = ev.tx - ev.x;
      const pdy = ev.ty - ev.y;
      const plen = Math.max(1, Math.hypot(pdx, pdy));
      fxList.push({
        t0: ev.t,
        kind: "ultBurst",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        tx: ev.tx,
        ty: ev.ty,
        dirX: pdx / plen,
        dirY: pdy / plen,
        text: ev.title,
        color: [cr, cg, cb, 255],
        ultStyle: ev.style,
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: ev.id,
        x: W / 2,
        y: 1592,
        text: ev.callout,
        color: [Math.min(255, cr + 35), Math.min(255, cg + 35), Math.min(255, cb + 35), 255],
      });
    } else if (ev.type === "propHit") {
      const caster = byId[ev.id];
      const [cr, cg, cb] = hex(caster.color);
      fxList.push({
        t0: ev.t,
        kind: "propBurst",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        tx: ev.tx,
        ty: ev.ty,
        text: ev.tag,
        color: [cr, cg, cb, 255],
        propKind: ev.propKind,
      });
    } else if (ev.type === "damage") {
      const offsetX = ev.id === "A" ? -42 : 42;
      const isSkillBall = byId.A.combatMode === "skillball" || byId.B.combatMode === "skillball";
      const attacker = byId[ev.from];
      const [ar, ag, ab] = hex(attacker.color);
      const nearDeath = Boolean(deathEv && deathEv.id === ev.id && Math.abs(ev.t - deathEv.t) < 0.08);
      const nearUlt = events.some(
        e =>
          (e.type === "seriousPunch" || e.type === "railgunShot" || e.type === "frostNova" || e.type === "ultCast") &&
          Math.abs(e.t - ev.t) < 0.14,
      );
      const rawTag = ev.tag ? ev.tag.replace(/\s*-\d+$/, "").trim() : "";
      const hasSkillTag = Boolean(rawTag && rawTag !== "贴身冲撞");
      const isBig = isSkillBall
        ? ev.value >= 48 || Boolean(ev.tag?.includes("撞墙粉碎")) || nearUlt
        : ev.value >= 115;
      const dmgColor: RGBA = isBig
        ? [255, 232, 72, 255]
        : hasSkillTag
          ? [
              Math.min(255, Math.max(165, ar + 65)),
              Math.min(255, Math.max(165, ag + 65)),
              Math.min(255, Math.max(165, ab + 65)),
              255,
            ]
          : [255, 118, 128, 255];
      fxList.push({
        t0: ev.t,
        kind: "hitBurst",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "",
        color: [ar, ag, ab, 255],
        big: isBig || hasSkillTag,
      });

      // 行业顶尖「零汉字极简滚动合并跳字 (Rolling Damage Coalescing)」：
      // 同一角色在 0.38s 窗口内的连续受击自动累加合并为唯一 1 个纯数字，彻底消灭满屏汉字与多行叠字！
      let merged = false;
      for (let k = fxList.length - 1; k >= 0; k--) {
        const prev = fxList[k];
        if (prev.kind === "dmg" && prev.side === ev.id && ev.t - prev.t0 < 0.38) {
          const sumVal = (prev.val ?? 0) + ev.value;
          const mergedBig = Boolean(prev.big || isBig || sumVal >= 65);
          prev.val = sumVal;
          prev.t0 = ev.t;
          prev.x = ev.x + offsetX;
          prev.y = nearDeath ? ev.y + 84 : ev.y - 84;
          prev.big = mergedBig;
          prev.text = mergedBig ? `-${sumVal}!` : `-${sumVal}`;
          if (mergedBig) prev.color = [255, 232, 72, 255];
          merged = true;
          break;
        }
      }
      if (!merged) {
        fxList.push({
          t0: ev.t,
          kind: "dmg",
          side: ev.id,
          x: ev.x + offsetX,
          y: nearDeath ? ev.y + 84 : ev.y - 84,
          text: isBig ? `-${ev.value}!` : `-${ev.value}`,
          val: ev.value,
          color: dmgColor,
          big: isBig,
        });
      }
    } else if (ev.type === "heal") {
      // 纯视觉翡翠「+」十字粒子 + 血条绿光脉冲，场内 0 汉字干扰！
      fxList.push({
        t0: ev.t,
        kind: "heal",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "",
        val: ev.value,
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
    } else if (ev.type === "death") {
      const loser = byId[ev.id];
      const winnerSide: Side = ev.id === "A" ? "B" : "A";
      const winner = byId[winnerSide];
      const [wr, wg, wb] = hex(winner.color);
      fxList.push({
        t0: ev.t,
        kind: "killExplosion",
        side: ev.id,
        x: ev.x,
        y: ev.y,
        text: "终极绝杀!!",
        color: [wr, wg, wb, 255],
      });
      fxList.push({
        t0: ev.t,
        kind: "callout",
        side: winnerSide,
        x: W / 2,
        y: 1592,
        text: `★ 终极绝杀 · ${winner.name} 正面击败 ${loser.name}！ ★`,
        color: [255, 232, 92, 255],
      });
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
      if (ev.type === "seriousPunch" || ev.type === "railgunShot") {
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
      } else if (ev.type === "ultCast") {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.056,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 8,
          flashAlpha: 0,
          targetSide: ev.target,
        });
      } else if (ev.type === "frostNova") {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.045,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 6,
          flashAlpha: 0,
          targetSide: ev.id === "A" ? "B" : "A",
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
      } else if (
        ev.type === "propHit" &&
        (ev.propKind === "chili_bomb" ||
          ev.propKind === "wrecking_ball" ||
          ev.propKind === "voodoo_effigy" ||
          ev.propKind === "fish_hook" ||
          ev.propKind === "roast_grill")
      ) {
        stops.push({
          tStart: ev.t,
          tEnd: ev.t + 0.032,
          focusX: ARENA_W / 2,
          focusY: ARENA_H / 2,
          zoom: 1.0,
          shake: 5,
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
  const activeShurikens: Record<Side, Array<{ id: number; x: number; y: number; angle: number }>> = { A: [], B: [] };
  const activeProps: Record<
    Side,
    Array<{ id: number; kind: string; x: number; y: number; r: number; angle?: number; val?: number; tx?: number; ty?: number }>
  > = { A: [], B: [] };

  const visX: Record<Side, number> = { A: byId.A.x, B: byId.B.x };
  const visY: Record<Side, number> = { A: byId.A.y, B: byId.B.y };

  // 将战斗中的大招轰击、冰霜冻结、血滴飞溅、轮胎火痕永久烘焙进竞技场底图 floorBuf
  const floorPt = (wx: number, wy: number): [number, number] => [
    clamp(Math.round(AX + wx * SCALE_X), AX + 18, AX + AW - 18),
    clamp(Math.round(AY + wy * SCALE_Y), AY + 18, AY + AH - 18),
  ];

  const bakeCrater = (fx: number, fy: number, rad: number, col: RGBA, _seed: number) => {
    // 仅在地面留下柔和暗色焦痕光晕，绝不烘焙永久线条或辐射裂纹，保持竞技场地面干净高辨识度！
    floorBuf.drawGlowCircle(fx, fy, Math.round(rad * 0.92), [8, 6, 14, 52]);
    floorBuf.drawGlowCircle(fx, fy, Math.round(rad * 0.56), [col[0], col[1], col[2], 24]);
  };

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
      f.frozen = ev.frozen ?? false;
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
      const [fx, fy] = floorPt(ev.x, ev.y);
      floorBuf.drawGlowCircle(fx, fy, 26, [38, 235, 132, 34]);
    } else if (ev.type === "latchStart") {
      totalClashes++;
      byId[ev.id].latchedTo = ev.target;
      const [fx, fy] = floorPt(ev.x, ev.y);
      floorBuf.drawGlowCircle(fx, fy, 38, [225, 22, 58, 45]);
      for (let i = 0; i < 5; i++) {
        const ang = i * 1.25 + ev.t * 3;
        const dist = 14 + (i % 3) * 11;
        floorBuf.fillCircle(
          Math.round(fx + Math.cos(ang) * dist),
          Math.round(fy + Math.sin(ang) * dist),
          4 + (i % 2) * 2,
          [195, 18, 48, 88],
        );
      }
    } else if (ev.type === "latchEnd") {
      byId[ev.id].latchedTo = null;
    } else if (ev.type === "cloneSync") {
      activeClones[ev.id] = ev.clones;
    } else if (ev.type === "shurikenSync") {
      activeShurikens[ev.id] = ev.shurikens;
    } else if (ev.type === "propSync") {
      activeProps[ev.id] = ev.props;
    } else if (
      ev.type === "seriousPunch" ||
      ev.type === "soundWave" ||
      ev.type === "railgunShot" ||
      ev.type === "frostNova" ||
      ev.type === "ultCast"
    ) {
      totalClashes++;
      lastClashTime = ev.t;
      const seed = Math.floor(ev.t * 100);
      if (ev.type === "seriousPunch") {
        const [tx, ty] = floorPt(ev.tx, ev.ty);
        bakeCrater(tx, ty, 64, [255, 205, 58, 255], seed);
      } else if (ev.type === "railgunShot") {
        const [tx, ty] = floorPt(ev.tx, ev.ty);
        bakeCrater(tx, ty, 54, [48, 238, 255, 255], seed);
      } else if (ev.type === "frostNova") {
        const [fx, fy] = floorPt(ev.x, ev.y);
        floorBuf.drawGlowCircle(fx, fy, 78, [65, 235, 255, 28]);
      } else if (ev.type === "soundWave") {
        const [fx, fy] = floorPt(ev.x, ev.y);
        floorBuf.drawGlowCircle(fx, fy, 64, [255, 58, 198, 24]);
      } else if (ev.type === "ultCast") {
        const caster = byId[ev.id];
        const [cr, cg, cb] = hex(caster.color);
        const [tx, ty] = floorPt(ev.tx, ev.ty);
        bakeCrater(tx, ty, 52, [cr, cg, cb, 255], seed);
      }
    } else if (ev.type === "propHit") {
      totalClashes++;
      lastClashTime = ev.t;
      const caster = byId[ev.id];
      const [cr, cg, cb] = hex(caster.color);
      const [fx, fy] = floorPt(ev.x, ev.y);
      if (ev.propKind === "chili_bomb") {
        bakeCrater(fx, fy, 38, [255, 92, 28, 255], Math.floor(ev.t * 91));
      } else if (ev.propKind === "wall_shatter" || ev.propKind === "brick_wall") {
        floorBuf.drawGlowCircle(fx, fy, 28, [215, 76, 36, 32]);
      } else if (ev.propKind === "acid_puddle") {
        floorBuf.drawGlowCircle(fx, fy, 30, [95, 255, 42, 28]);
      } else if (ev.propKind === "paint_splat") {
        floorBuf.drawGlowCircle(fx, fy, 30, [cr, cg, cb, 32]);
      }
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
      target.ghostHoldT = 0.28;
      target.barShakeT = ev.value >= 45 ? 0.24 : 0.14;
      attacker.totalDamageDealt += ev.value;
      const [fx, fy] = floorPt(ev.x, ev.y);
      const [ar, ag, ab] = hex(attacker.color);
      if (ev.value >= 115 || ev.tag?.includes("撞墙粉碎")) {
        bakeCrater(fx, fy, 46, [ar, ag, ab, 255], Math.floor(ev.t * 97));
      } else if (attacker.ballSkillKind === "vampire_latch") {
        floorBuf.drawGlowCircle(fx, fy, 24, [215, 18, 52, 38]);
      } else if (attacker.ballSkillKind === "alchemist_puddle") {
        floorBuf.drawGlowCircle(fx, fy, 28, [88, 245, 42, 36]);
      } else if (attacker.ballSkillKind === "graffiti_paint") {
        floorBuf.drawGlowCircle(fx, fy, 30, [ar, ag, ab, 44]);
      }
    } else if (ev.type === "heal") {
      const f = byId[ev.id];
      f.hp = ev.hp;
      f.totalHealed += ev.value;
      f.healFlashT = 0.36;
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
      if (f.ballSkillKind === "rider_turbo" || f.ballSkillKind === "courier_box") {
        const [fx, fy] = floorPt(ev.x, ev.y);
        floorBuf.drawGlowCircle(fx, fy, 30, [255, 142, 24, 42]);
      }
    } else if (ev.type === "death") {
      const f = byId[ev.id];
      const winnerSide: Side = ev.id === "A" ? "B" : "A";
      const winner = byId[winnerSide];
      const [wr, wg, wb] = hex(winner.color);
      const [fx, fy] = floorPt(ev.x, ev.y);
      bakeCrater(fx, fy, 78, [wr, wg, wb, 255], 999);
      f.alive = false;
      f.action = "death";
      f.actionAge = 0;
      f.deathT = ev.t;
      f.frozen = false;
      f.slowed = false;
      byId.A.latchedTo = null;
      byId.B.latchedTo = null;
      // 赋予败方球体绝杀击飞速度向量（向远离胜者方向高速弹飞撞墙）
      const dx = f.x - winner.x;
      const dy = f.y - winner.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      f.vx = (dx / d) * 680;
      f.vy = (dy / d) * 680;
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
    const [r, g, b] = hex(v.color);
    const [r2, g2, b2] = hex(v.color2);
    const orbR = 52 * v.bodyScale * cam.zoom;
    const kind = v.ballSkillKind;
    const foe = byId[v.id === "A" ? "B" : "A"];
    const spdMag = Math.hypot(v.vx, v.vy);
    const moveAng = spdMag > 24 ? Math.atan2(v.vy, v.vx) : v.facing >= 0 ? 0 : Math.PI;
    const fwdX = Math.cos(moveAng);
    const fwdY = Math.sin(moveAng);
    const perpX = -fwdY;
    const perpY = fwdX;
    const aimAng = Math.atan2(foe.y - v.y, foe.x - v.x);
    const aimX = Math.cos(aimAng);
    const aimY = Math.sin(aimAng);
    const aimPerpX = -aimY;
    const aimPerpY = aimX;

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
      // 一拳光头：随真实运动反方向飘扬的纯白正义披风 + 黄金蓄力进度光环 + 朝对手瞄准的红色重拳拳套
      const capeAng = moveAng + Math.PI + Math.sin(tNow * 14) * 0.12;
      const capeLen = orbR * 1.48;
      const cxp = sx - fwdX * orbR * 0.96;
      const cyp = sy - fwdY * orbR * 0.96;
      fb.fillRotatedRect(cxp, cyp, capeLen, orbR * 1.15, capeAng, [245, 248, 255, 235]);
      fb.fillRotatedRect(cxp, cyp, capeLen * 0.85, orbR * 0.85, capeAng, [215, 224, 242, 220]);

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

      // 朝向对手方向的双红拳套（随蓄力高频出拳抖动）
      const punchBob = Math.sin(tNow * 20) * 12 * cam.zoom;
      for (const gSign of [-1, 1]) {
        const reach = orbR * 1.08 + (gSign > 0 ? punchBob : -punchBob);
        const gx = sx + aimX * reach + aimPerpX * gSign * orbR * 0.42;
        const gy = sy + aimY * reach + aimPerpY * gSign * orbR * 0.42;
        fb.drawGlowCircle(gx, gy, Math.round(28 * cam.zoom), [255, 195, 48, 185]);
        fb.fillCircle(gx, gy, Math.round(20 * cam.zoom), [235, 38, 38, 255]);
        fb.strokeRing(gx, gy, Math.round(20 * cam.zoom), 3, [255, 235, 130, 255]);
        fb.fillCircle(gx - aimX * 4 * cam.zoom, gy - aimY * 4 * cam.zoom, Math.round(6 * cam.zoom), [255, 185, 185, 235]);
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
    } else if (kind === "thunder_rail") {
      // 雷电磁暴王：实时瞄准对手的360度双联电磁轨道炮管 + 旋转蓝白磁暴线圈环 + 跳跃电弧与蓄力光圈
      const charge = clamp((v.punchCharge || 35) / 100, 0.08, 1);
      const chargeSpan = charge * Math.PI * 2;
      fb.drawArc(
        sx,
        sy,
        orbR * 1.24,
        Math.max(4, Math.round(7 * cam.zoom)),
        -Math.PI * 0.5,
        -Math.PI * 0.5 + chargeSpan,
        charge >= 0.85 ? [255, 242, 92, 255] : [36, 232, 255, 245],
      );
      for (const pSign of [-1, 1]) {
        const px = sx + aimX * orbR * 0.98 + aimPerpX * pSign * orbR * 0.36;
        const py = sy + aimY * orbR * 0.98 + aimPerpY * pSign * orbR * 0.36;
        fb.fillRotatedRect(px, py, Math.round(46 * cam.zoom), Math.round(14 * cam.zoom), aimAng, [14, 78, 128, 250]);
        fb.fillRotatedRect(px + aimX * 6 * cam.zoom, py + aimY * 6 * cam.zoom, Math.round(34 * cam.zoom), Math.round(7 * cam.zoom), aimAng, [95, 245, 255, 255]);
        fb.drawGlowCircle(px + aimX * 18 * cam.zoom, py + aimY * 18 * cam.zoom, Math.round(22 * cam.zoom), [42, 235, 255, 195]);
      }
      for (let eIdx = 0; eIdx < 4; eIdx++) {
        const ang = tNow * 14 + (eIdx * Math.PI) / 2;
        const x1 = sx + Math.cos(ang) * orbR * 0.92;
        const y1 = sy + Math.sin(ang) * orbR * 0.92;
        const x2 = sx + Math.cos(ang + 0.38) * orbR * 1.32;
        const y2 = sy + Math.sin(ang + 0.38) * orbR * 1.32;
        fb.drawLine(x1, y1, x2, y2, 3, [155, 248, 255, 235]);
      }
    } else if (kind === "ninja_shuriken") {
      // 暗影忍者王：顺应运动反方向飘逸的猩红双忍巾飘带 + 环绕周身旋转的护体手里剑星刃
      const backAng = moveAng + Math.PI;
      const wave1 = Math.sin(tNow * 18) * 0.16;
      const wave2 = Math.cos(tNow * 18) * 0.16;
      const s1x = sx - fwdX * orbR * 0.98 + perpX * orbR * 0.18;
      const s1y = sy - fwdY * orbR * 0.98 + perpY * orbR * 0.18;
      const s2x = sx - fwdX * orbR * 1.12 - perpX * orbR * 0.14;
      const s2y = sy - fwdY * orbR * 1.12 - perpY * orbR * 0.14;
      fb.fillRotatedRect(s1x, s1y, orbR * 1.38, Math.round(18 * cam.zoom), backAng + 0.18 + wave1, [255, 38, 82, 245]);
      fb.fillRotatedRect(s2x, s2y, orbR * 1.18, Math.round(13 * cam.zoom), backAng - 0.18 + wave2, [215, 24, 68, 225]);
      for (let k = 0; k < 2; k++) {
        const orbitAng = tNow * 9 + k * Math.PI;
        const ox = sx + Math.cos(orbitAng) * orbR * 1.24;
        const oy = sy + Math.sin(orbitAng) * orbR * 1.24;
        const spin = tNow * 24 + k;
        fb.fillRotatedRect(ox, oy, Math.round(30 * cam.zoom), Math.round(8 * cam.zoom), spin, [225, 240, 255, 245]);
        fb.fillRotatedRect(ox, oy, Math.round(30 * cam.zoom), Math.round(8 * cam.zoom), spin + Math.PI * 0.5, [195, 118, 255, 245]);
        fb.fillCircle(ox, oy, Math.round(4 * cam.zoom), [22, 16, 36, 255]);
      }
    } else if (kind === "frost_freeze") {
      // 急冻冰霜王：球顶三叉极寒冰冠 + 环绕周身旋转的六角冰晶雪花与寒气光环
      fb.strokeRing(sx, sy, Math.round(orbR * 1.22), Math.max(3, Math.round(5 * cam.zoom)), [95, 245, 255, 195]);
      for (let i = 0; i < 4; i++) {
        const ang = -tNow * 4.5 + (i * Math.PI) / 2;
        const ix = sx + Math.cos(ang) * orbR * 1.26;
        const iy = sy + Math.sin(ang) * orbR * 1.26;
        const rFlake = Math.round(13 * cam.zoom);
        fb.drawLine(ix - rFlake, iy, ix + rFlake, iy, 3, [225, 252, 255, 245]);
        fb.drawLine(ix, iy - rFlake, ix, iy + rFlake, 3, [225, 252, 255, 245]);
        fb.drawLine(ix - rFlake * 0.7, iy - rFlake * 0.7, ix + rFlake * 0.7, iy + rFlake * 0.7, 2, [115, 245, 255, 235]);
        fb.drawLine(ix - rFlake * 0.7, iy + rFlake * 0.7, ix + rFlake * 0.7, iy - rFlake * 0.7, 2, [115, 245, 255, 235]);
      }
    } else if (kind === "rider_turbo") {
      // 极速黄骑士：沿真实速度反方向挂载黄金保温战箱 + 双排气管超长氮气烈焰 + 前方双层超音速马赫激波锥
      const boxX = sx - fwdX * orbR * 0.88;
      const boxY = sy - fwdY * orbR * 0.88;
      const boxW = Math.round(44 * cam.zoom);
      const boxH = Math.round(52 * cam.zoom);
      fb.fillRotatedRect(boxX, boxY, boxW + 4, boxH + 4, moveAng, [255, 245, 155, 255]);
      fb.fillRotatedRect(boxX, boxY, boxW, boxH, moveAng, [255, 196, 12, 255]);
      fb.fillRotatedRect(boxX, boxY, boxW - 10, 8, moveAng, [32, 24, 18, 235]);

      // 双排气管喷射长尾焰（随进化层数与真实速度向量拉长旋转）
      const flameLen = (58 + v.rageStacks * 11 + Math.sin(tNow * 38) * 16) * cam.zoom;
      for (const fSign of [-1, 1]) {
        const dist = orbR * 0.94 + flameLen * 0.46;
        const fx = sx - fwdX * dist + perpX * fSign * orbR * 0.24;
        const fy = sy - fwdY * dist + perpY * fSign * orbR * 0.24;
        fb.fillRotatedRect(fx, fy, flameLen, Math.round(22 * cam.zoom), moveAng, [255, 86, 22, 235]);
        fb.fillRotatedRect(
          fx + fwdX * flameLen * 0.14,
          fy + fwdY * flameLen * 0.14,
          flameLen * 0.70,
          Math.round(12 * cam.zoom),
          moveAng,
          [255, 242, 108, 255],
        );
      }
      // 前方双层超音速马赫破风激波锥（沿真实运动方向 moveAng 展开）
      fb.drawArc(
        sx + fwdX * orbR * 0.24,
        sy + fwdY * orbR * 0.24,
        orbR * 1.24,
        Math.max(4, Math.round(8 * cam.zoom)),
        moveAng - 0.82,
        moveAng + 0.82,
        [255, 238, 115, 245],
      );
      if (spdMag > 540 || v.rageStacks >= 2) {
        fb.drawArc(
          sx + fwdX * orbR * 0.42,
          sy + fwdY * orbR * 0.42,
          orbR * 1.42,
          Math.max(3, Math.round(5 * cam.zoom)),
          moveAng - 0.62,
          moveAng + 0.62,
          [255, 142, 36, 215],
        );
      }
    } else if (kind === "alchemist_puddle") {
      // 绝命毒师：手持倾倒强酸的三角锥形化学烧瓶 + 环绕3只带塞荧光绿锥形烧瓶与上升毒汽泡
      for (let i = 0; i < 3; i++) {
        const ang = tNow * 2.6 + (i * Math.PI * 2) / 3;
        const bx = sx + Math.cos(ang) * orbR * 1.34;
        const by = sy + Math.sin(ang) * orbR * 1.34;
        const fScale = cam.zoom;
        fb.drawGlowCircle(bx, by, Math.round(24 * fScale), [112, 255, 42, 145]);
        // 锥形烧瓶玻璃外轮廓（宽底三角肚 + 细长瓶颈 + 瓶口塞）
        fb.fillRoundRect(bx - Math.round(14 * fScale), by + Math.round(1 * fScale), Math.round(28 * fScale), Math.round(15 * fScale), 6, [215, 255, 232, 235]);
        fb.fillRoundRect(bx - Math.round(10 * fScale), by - Math.round(7 * fScale), Math.round(20 * fScale), Math.round(12 * fScale), 5, [215, 255, 232, 235]);
        fb.fillRoundRect(bx - Math.round(5 * fScale), by - Math.round(17 * fScale), Math.round(10 * fScale), Math.round(12 * fScale), 3, [225, 255, 240, 245]);
        // 瓶内沸腾荧光绿强酸液面
        fb.fillRoundRect(bx - Math.round(12 * fScale), by + Math.round(3 * fScale), Math.round(24 * fScale), Math.round(11 * fScale), 5, [62, 248, 38, 255]);
        fb.fillRoundRect(bx - Math.round(8 * fScale), by - Math.round(2 * fScale), Math.round(16 * fScale), Math.round(7 * fScale), 3, [158, 255, 64, 255]);
        // 棕色木塞与上升气泡
        fb.fillRoundRect(bx - Math.round(6 * fScale), by - Math.round(20 * fScale), Math.round(12 * fScale), Math.round(5 * fScale), 2, [168, 102, 48, 255]);
        const bubY = by - (18 + ((tNow * 28 + i * 9) % 14)) * fScale;
        fb.fillCircle(bx + Math.sin(tNow * 8 + i) * 4 * fScale, bubY, Math.max(2, Math.round(3.5 * fScale)), [178, 255, 92, 235]);
      }
    } else if (kind === "bulldozer_wall") {
      // 暴走拆迁队：双液压撑杆连接的重型黄黑斜纹推土铲 + 5根破墙钢齿
      const bladeDist = orbR * 1.16;
      const bx = sx + fwdX * bladeDist;
      const by = sy + fwdY * bladeDist;
      for (const sSign of [-1, 1]) {
        const armX0 = sx + fwdX * orbR * 0.72 + perpX * sSign * orbR * 0.44;
        const armY0 = sy + fwdY * orbR * 0.72 + perpY * sSign * orbR * 0.44;
        const armX1 = bx - fwdX * 6 * cam.zoom + perpX * sSign * orbR * 0.52;
        const armY1 = by - fwdY * 6 * cam.zoom + perpY * sSign * orbR * 0.52;
        fb.drawLine(armX0, armY0, armX1, armY1, Math.max(4, Math.round(8 * cam.zoom)), [168, 178, 196, 255]);
        fb.drawLine(armX0, armY0, armX1, armY1, Math.max(2, Math.round(4 * cam.zoom)), [235, 242, 255, 255]);
      }
      // 重型推土钢铲背板与亮黄主铲面
      fb.fillRotatedRect(bx, by, Math.round(32 * cam.zoom), Math.round(orbR * 1.78), moveAng, [28, 24, 22, 255]);
      fb.fillRotatedRect(bx + fwdX * 3 * cam.zoom, by + fwdY * 3 * cam.zoom, Math.round(24 * cam.zoom), Math.round(orbR * 1.66), moveAng, [255, 188, 18, 255]);
      // 黄黑工程警示斜纹 + 前缘5根破墙合金钢齿
      for (let tIdx = -2; tIdx <= 2; tIdx++) {
        const tx = bx + perpX * tIdx * orbR * 0.32;
        const ty = by + perpY * tIdx * orbR * 0.32;
        fb.fillRotatedRect(tx + fwdX * 3 * cam.zoom, ty + fwdY * 3 * cam.zoom, Math.round(22 * cam.zoom), Math.round(9 * cam.zoom), moveAng + 0.45, [28, 24, 20, 245]);
        const toothX = tx + fwdX * 16 * cam.zoom;
        const toothY = ty + fwdY * 16 * cam.zoom;
        fb.fillRotatedRect(toothX, toothY, Math.round(14 * cam.zoom), Math.round(8 * cam.zoom), moveAng, [228, 236, 248, 255]);
      }
    } else if (kind === "angler_reel") {
      // 深海垂钓王：身侧黄金纺车渔轮 + 大弧度弯弓碳素海钓竿 + 垂坠红白浮漂
      const rodBaseX = sx + aimPerpX * orbR * 0.78;
      const rodBaseY = sy + aimPerpY * orbR * 0.78;
      const rodMidX = rodBaseX + aimX * orbR * 0.68 - aimPerpX * orbR * 0.22;
      const rodMidY = rodBaseY + aimY * orbR * 0.68 - aimPerpY * orbR * 0.22 - orbR * 0.35;
      const rodTipX = rodMidX + aimX * orbR * 0.72;
      const rodTipY = rodMidY + aimY * orbR * 0.72 - orbR * 0.25 + Math.sin(tNow * 12) * 8 * cam.zoom;
      // 黄金纺车渔轮
      fb.fillCircle(rodBaseX, rodBaseY, Math.round(14 * cam.zoom), [255, 198, 38, 255]);
      fb.strokeRing(rodBaseX, rodBaseY, Math.round(14 * cam.zoom), 3, [255, 248, 185, 255]);
      fb.fillCircle(rodBaseX, rodBaseY, Math.round(6 * cam.zoom), [32, 48, 72, 255]);
      // 碳素海钓竿两段弯弓竿身与导环
      fb.drawLine(rodBaseX, rodBaseY, rodMidX, rodMidY, Math.max(5, Math.round(8 * cam.zoom)), [38, 52, 76, 255]);
      fb.drawLine(rodBaseX, rodBaseY, rodMidX, rodMidY, Math.max(2, Math.round(4 * cam.zoom)), [92, 218, 255, 255]);
      fb.drawLine(rodMidX, rodMidY, rodTipX, rodTipY, Math.max(3, Math.round(5 * cam.zoom)), [255, 215, 68, 255]);
      fb.fillCircle(rodTipX, rodTipY, Math.round(6 * cam.zoom), [72, 245, 255, 255]);
      // 环绕水波纹光弧
      for (let wIdx = 0; wIdx < 2; wIdx++) {
        const wa = tNow * 4 + wIdx * Math.PI;
        fb.drawArc(sx, sy, orbR * 1.24, Math.max(3, Math.round(5 * cam.zoom)), wa, wa + 1.1, [38, 224, 255, 205]);
      }
    } else if (kind === "courier_box") {
      // 外卖闪电侠：背部蓝黄外卖箱（带红十字丝带与闪电标）+ 双联蓝金离子推进器 + 环身闪电链
      const bx = sx - fwdX * orbR * 1.04;
      const by = sy - fwdY * orbR * 1.04;
      fb.fillRotatedRect(bx, by, Math.round(46 * cam.zoom), Math.round(54 * cam.zoom), moveAng, [18, 108, 245, 255]);
      fb.fillRotatedRect(bx, by, Math.round(38 * cam.zoom), Math.round(46 * cam.zoom), moveAng, [255, 208, 18, 255]);
      fb.fillRotatedRect(bx, by, Math.round(10 * cam.zoom), Math.round(44 * cam.zoom), moveAng, [255, 52, 68, 245]);
      const jetLen = (52 + v.rageStacks * 9 + Math.sin(tNow * 36) * 14) * cam.zoom;
      for (const fSign of [-1, 1]) {
        const jx = sx - fwdX * (orbR * 1.18 + jetLen * 0.42) + perpX * fSign * orbR * 0.25;
        const jy = sy - fwdY * (orbR * 1.18 + jetLen * 0.42) + perpY * fSign * orbR * 0.25;
        fb.fillRotatedRect(jx, jy, jetLen, Math.round(18 * cam.zoom), moveAng, [24, 178, 255, 235]);
        fb.fillRotatedRect(jx, jy, jetLen * 0.68, Math.round(9 * cam.zoom), moveAng, [255, 248, 138, 255]);
      }
      fb.drawArc(
        sx + fwdX * orbR * 0.22,
        sy + fwdY * orbR * 0.22,
        orbR * 1.25,
        Math.max(3, Math.round(6 * cam.zoom)),
        moveAng - 0.72,
        moveAng + 0.72,
        [82, 232, 255, 235],
      );
    } else if (kind === "billiard_bank") {
      // 赛博台球手：实时瞄准对手的修长黄金桌球杆（带伸缩击球动作）+ 青色几何激光瞄准虚线
      const strokeOffset = Math.sin(tNow * 14) * 14 * cam.zoom;
      const cueButtX = sx - aimX * (orbR * 1.68 + strokeOffset) + aimPerpX * orbR * 0.28;
      const cueButtY = sy - aimY * (orbR * 1.68 + strokeOffset) + aimPerpY * orbR * 0.28;
      const cueMidX = sx - aimX * (orbR * 0.25 + strokeOffset) + aimPerpX * orbR * 0.28;
      const cueMidY = sy - aimY * (orbR * 0.25 + strokeOffset) + aimPerpY * orbR * 0.28;
      const cueTipX = sx + aimX * (orbR * 1.28 - strokeOffset) + aimPerpX * orbR * 0.28;
      const cueTipY = sy + aimY * (orbR * 1.28 - strokeOffset) + aimPerpY * orbR * 0.28;
      // 球杆黑金后把 + 枫木前节 + 蓝巧克皮头
      fb.drawLine(cueButtX, cueButtY, cueMidX, cueMidY, Math.max(6, Math.round(11 * cam.zoom)), [48, 32, 22, 255]);
      fb.drawLine(cueButtX, cueButtY, cueMidX, cueMidY, Math.max(3, Math.round(5 * cam.zoom)), [255, 204, 68, 255]);
      fb.drawLine(cueMidX, cueMidY, cueTipX, cueTipY, Math.max(4, Math.round(7 * cam.zoom)), [245, 218, 162, 255]);
      fb.fillCircle(cueTipX, cueTipY, Math.round(6 * cam.zoom), [38, 228, 255, 255]);
      // 前方几何激光瞄准线
      for (let d = 1; d <= 3; d++) {
        const lx0 = cueTipX + aimX * (d * 24 - 10) * cam.zoom;
        const ly0 = cueTipY + aimY * (d * 24 - 10) * cam.zoom;
        const lx1 = cueTipX + aimX * (d * 24 + 2) * cam.zoom;
        const ly1 = cueTipY + aimY * (d * 24 + 2) * cam.zoom;
        fb.drawLine(lx0, ly0, lx1, ly1, 3, [48, 255, 208, 215]);
      }
    } else if (kind === "graffiti_paint") {
      // 街头涂鸦王：左右两侧挂载高压霓虹喷漆罐（银色罐身+荧光色标+白色喷头）+ 实时向外喷射彩漆雾滴
      for (const sSign of [-1, 1]) {
        const canX = sx + perpX * sSign * orbR * 1.12;
        const canY = sy + perpY * sSign * orbR * 1.12;
        const canAng = moveAng + sSign * 0.35;
        const paintCol: RGBA = sSign < 0 ? [255, 38, 178, 255] : [28, 242, 255, 255];
        // 银色金属喷漆罐身 + 霓虹色带 + 白色按压喷嘴
        fb.fillRotatedRect(canX, canY, Math.round(36 * cam.zoom), Math.round(22 * cam.zoom), canAng, [218, 228, 242, 255]);
        fb.fillRotatedRect(canX, canY, Math.round(22 * cam.zoom), Math.round(22 * cam.zoom), canAng, paintCol);
        const nozX = canX + Math.cos(canAng) * 21 * cam.zoom;
        const nozY = canY + Math.sin(canAng) * 21 * cam.zoom;
        fb.fillCircle(nozX, nozY, Math.round(6 * cam.zoom), [255, 255, 255, 255]);
        // 喷嘴向外喷出的扇形彩漆雾滴
        for (let m = 0; m < 3; m++) {
          const mDist = (14 + ((tNow * 45 + m * 9) % 24)) * cam.zoom;
          const mAng = canAng + (m - 1) * 0.28;
          fb.fillCircle(
            nozX + Math.cos(mAng) * mDist,
            nozY + Math.sin(mAng) * mDist,
            Math.max(2, Math.round(4.5 * cam.zoom)),
            paintCol,
          );
        }
      }
    } else if (kind === "kebab_skewer") {
      // 旋转烤肉王：贯穿全身高速旋转的巨型新疆红柳铁签烤串（串着焦香烤肉块、青椒与洋葱圈）
      const ang = tNow * 5.2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);
      const kx0 = sx - cosA * orbR * 1.62;
      const ky0 = sy - sinA * orbR * 1.62;
      const kx1 = sx + cosA * orbR * 1.68;
      const ky1 = sy + sinA * orbR * 1.68;
      // 钢签圆环握柄 + 贯穿铁签 + 红热签尖
      fb.strokeRing(kx0, ky0, Math.round(11 * cam.zoom), 4, [255, 208, 68, 255]);
      fb.drawLine(kx0, ky0, kx1, ky1, Math.max(5, Math.round(8 * cam.zoom)), [220, 232, 248, 255]);
      fb.drawGlowCircle(kx1, ky1, Math.round(22 * cam.zoom), [255, 92, 24, 195]);
      fb.fillCircle(kx1, ky1, Math.round(6 * cam.zoom), [255, 238, 92, 255]);
      // 铁签两端串着的焦香烤肉块、青椒片与孜然油花
      for (const dRatio of [-1.22, -0.96, 0.96, 1.24]) {
        const mx = sx + cosA * orbR * dRatio;
        const my = sy + sinA * orbR * dRatio;
        const isPepper = Math.abs(dRatio) < 1.05;
        if (isPepper) {
          fb.fillRotatedRect(mx, my, Math.round(14 * cam.zoom), Math.round(24 * cam.zoom), ang, [52, 224, 78, 255]);
        } else {
          fb.fillRotatedRect(mx, my, Math.round(22 * cam.zoom), Math.round(28 * cam.zoom), ang + 0.2, [192, 68, 24, 255]);
          fb.fillRotatedRect(mx, my, Math.round(14 * cam.zoom), Math.round(18 * cam.zoom), ang + 0.2, [255, 168, 48, 255]);
        }
      }
    } else if (kind === "pinball_bumper") {
      // 街机弹珠王：前方一对高频拍击的街机弹珠挡板 (Flippers) + 尾部弹簧发射杆 + 霓虹灯珠环
      const flipSwing = Math.sin(tNow * 22) * 0.34;
      for (const fSign of [-1, 1]) {
        const pivotX = sx + aimX * orbR * 0.72 + aimPerpX * fSign * orbR * 0.78;
        const pivotY = sy + aimY * orbR * 0.72 + aimPerpY * fSign * orbR * 0.78;
        const fAng = aimAng - fSign * (0.45 - flipSwing);
        const tipX = pivotX + Math.cos(fAng) * orbR * 0.72;
        const tipY = pivotY + Math.sin(fAng) * orbR * 0.72;
        fb.drawLine(pivotX, pivotY, tipX, tipY, Math.max(7, Math.round(14 * cam.zoom)), [255, 52, 92, 255]);
        fb.drawLine(pivotX, pivotY, tipX, tipY, Math.max(4, Math.round(8 * cam.zoom)), [255, 224, 42, 255]);
        fb.fillCircle(pivotX, pivotY, Math.round(9 * cam.zoom), [255, 255, 255, 255]);
      }
      fb.strokeRing(sx, sy, Math.round(orbR * 1.24), Math.max(3, Math.round(5 * cam.zoom)), [255, 218, 36, 220]);
    } else if (kind === "beyblade_orbit") {
      // 磁悬浮陀螺：高速旋转的六翼斜切金属锯齿攻击环 + 蓝金磨擦火花
      const ang = tNow * 15.0;
      fb.strokeRing(sx, sy, Math.round(orbR * 1.22), Math.max(5, Math.round(8 * cam.zoom)), [195, 218, 245, 245]);
      fb.strokeRing(sx, sy, Math.round(orbR * 1.30), Math.max(3, Math.round(5 * cam.zoom)), [28, 232, 255, 235]);
      for (let i = 0; i < 6; i++) {
        const a = ang + (i * Math.PI) / 3;
        const bx = sx + Math.cos(a) * orbR * 1.28;
        const by = sy + Math.sin(a) * orbR * 1.28;
        const tipX = sx + Math.cos(a + 0.28) * orbR * 1.52;
        const tipY = sy + Math.sin(a + 0.28) * orbR * 1.52;
        fb.fillRotatedRect(bx, by, Math.round(32 * cam.zoom), Math.round(13 * cam.zoom), a + 0.65, [225, 238, 255, 255]);
        fb.drawLine(bx, by, tipX, tipY, Math.max(4, Math.round(7 * cam.zoom)), [255, 208, 42, 255]);
      }
    } else if (kind === "fireman_hose") {
      // 暴躁消防员：背部双联红钢高压水罐 + 朝向对手的黄铜高压水炮枪与喷溅水花
      for (const tSign of [-1, 1]) {
        const tx = sx - aimX * orbR * 0.92 + aimPerpX * tSign * orbR * 0.34;
        const ty = sy - aimY * orbR * 0.92 + aimPerpY * tSign * orbR * 0.34;
        fb.fillRotatedRect(tx, ty, Math.round(36 * cam.zoom), Math.round(20 * cam.zoom), aimAng, [235, 38, 42, 255]);
        fb.fillRotatedRect(tx, ty, Math.round(14 * cam.zoom), Math.round(20 * cam.zoom), aimAng, [255, 215, 52, 255]);
      }
      const nx = sx + aimX * orbR * 1.08;
      const ny = sy + aimY * orbR * 1.08;
      fb.fillRotatedRect(nx, ny, Math.round(42 * cam.zoom), Math.round(24 * cam.zoom), aimAng, [238, 42, 48, 255]);
      fb.fillRotatedRect(nx + aimX * 14 * cam.zoom, ny + aimY * 14 * cam.zoom, Math.round(24 * cam.zoom), Math.round(16 * cam.zoom), aimAng, [255, 215, 48, 255]);
      fb.drawGlowCircle(nx + aimX * 28 * cam.zoom, ny + aimY * 28 * cam.zoom, Math.round(26 * cam.zoom), [68, 232, 255, 210]);
      fb.fillCircle(nx + aimX * 26 * cam.zoom, ny + aimY * 26 * cam.zoom, Math.round(9 * cam.zoom), [225, 252, 255, 255]);
    } else if (kind === "voodoo_doll") {
      // 巫毒咒术师：环绕旋转的3根巨型红头巫毒诅咒银针 + 幽绿灵魂鬼火
      fb.strokeRing(sx, sy, Math.round(orbR * 1.24), Math.max(3, Math.round(5 * cam.zoom)), [178, 52, 255, 205]);
      for (let i = 0; i < 3; i++) {
        const a = -tNow * 3.4 + (i * Math.PI * 2) / 3;
        const pinTipX = sx + Math.cos(a) * orbR * 1.06;
        const pinTipY = sy + Math.sin(a) * orbR * 1.06;
        const pinHeadX = sx + Math.cos(a) * orbR * 1.54;
        const pinHeadY = sy + Math.sin(a) * orbR * 1.54;
        fb.drawLine(pinTipX, pinTipY, pinHeadX, pinHeadY, Math.max(3, Math.round(5 * cam.zoom)), [225, 238, 255, 255]);
        fb.drawGlowCircle(pinHeadX, pinHeadY, Math.round(18 * cam.zoom), [72, 255, 158, 175]);
        fb.fillCircle(pinHeadX, pinHeadY, Math.round(10 * cam.zoom), i % 2 === 0 ? [255, 42, 92, 255] : [62, 255, 152, 255]);
        fb.fillCircle(pinHeadX - 2 * cam.zoom, pinHeadY - 2 * cam.zoom, Math.round(3 * cam.zoom), [255, 255, 255, 255]);
      }
    } else if (kind === "boxer_rope") {
      // 弹力拳击手：银白螺旋弹簧连接的双联重型红金拳击手套
      const jab = Math.sin(tNow * 18) * 14 * cam.zoom;
      for (const sideS of [-1, 1]) {
        const rootX = sx + aimX * orbR * 0.72 + aimPerpX * sideS * orbR * 0.48;
        const rootY = sy + aimY * orbR * 0.72 + aimPerpY * sideS * orbR * 0.48;
        const reach = orbR * 1.22 + (sideS > 0 ? jab : -jab);
        const gx = sx + aimX * reach + aimPerpX * sideS * orbR * 0.50;
        const gy = sy + aimY * reach + aimPerpY * sideS * orbR * 0.50;
        // 3段金属折线弹簧臂
        const mid1X = rootX + (gx - rootX) * 0.33 + aimPerpX * 8 * cam.zoom;
        const mid1Y = rootY + (gy - rootY) * 0.33 + aimPerpY * 8 * cam.zoom;
        const mid2X = rootX + (gx - rootX) * 0.66 - aimPerpX * 8 * cam.zoom;
        const mid2Y = rootY + (gy - rootY) * 0.66 - aimPerpY * 8 * cam.zoom;
        fb.drawLine(rootX, rootY, mid1X, mid1Y, Math.max(3, Math.round(5 * cam.zoom)), [215, 228, 245, 255]);
        fb.drawLine(mid1X, mid1Y, mid2X, mid2Y, Math.max(3, Math.round(5 * cam.zoom)), [215, 228, 245, 255]);
        fb.drawLine(mid2X, mid2Y, gx, gy, Math.max(3, Math.round(5 * cam.zoom)), [215, 228, 245, 255]);
        // 冠军红金拳击手套
        fb.drawGlowCircle(gx, gy, Math.round(28 * cam.zoom), [255, 62, 48, 185]);
        fb.fillCircle(gx, gy, Math.round(22 * cam.zoom), [242, 34, 46, 255]);
        fb.strokeRing(gx, gy, Math.round(22 * cam.zoom), 3, [255, 218, 58, 255]);
        fb.fillCircle(gx + aimX * 4 * cam.zoom, gy + aimY * 4 * cam.zoom, Math.round(7 * cam.zoom), [255, 195, 195, 235]);
      }
    }

    // 通用觉醒蓄力环：除已自带蓄力环的一拳光头/雷电磁暴王外，其余蓄力觉醒英雄达到 35%+ 时外圈显示能量进度弧，满 90% 金光脉冲提示下次碰撞引爆大招！
    if (
      kind !== "one_punch" &&
      kind !== "thunder_rail" &&
      kind !== "vampire_latch" &&
      kind !== "dance_granny" &&
      kind !== "frost_freeze" &&
      (v.punchCharge || 0) >= 35
    ) {
      const charge = clamp((v.punchCharge || 0) / 100, 0.1, 1);
      const ready = charge >= 0.90;
      fb.drawArc(
        sx,
        sy,
        orbR * 1.18,
        Math.max(3, Math.round((ready ? 7 : 4) * cam.zoom)),
        -Math.PI * 0.5,
        -Math.PI * 0.5 + charge * Math.PI * 2,
        ready ? [255, 236, 78, 250] : [r, g, b, 195],
      );
    }

    // 被急冻冰霜王「绝对零度」冻结在冰块中时的半透明六边形寒冰晶块封印特效！
    if (v.frozen) {
      const iceW = Math.round(orbR * 2.28);
      const iceH = Math.round(orbR * 2.28);
      fb.fillRoundRect(sx - iceW / 2, sy - iceH / 2, iceW, iceH, 22, [75, 232, 255, 118]);
      fb.strokeRoundRect(sx - iceW / 2, sy - iceH / 2, iceW, iceH, 22, 5, [215, 252, 255, 245]);
      fb.drawLine(sx - iceW * 0.34, sy - iceH * 0.36, sx + iceW * 0.18, sy - iceH * 0.12, 5, [255, 255, 255, 220]);
      fb.drawLine(sx - iceW * 0.18, sy + iceH * 0.28, sx + iceW * 0.32, sy - iceH * 0.24, 3, [195, 250, 255, 210]);
    }

    // 受减速/腐蚀状态提示：根据敌方英雄技能类型显示对应视觉（蛛丝缠绕 vs 强酸腐蚀冒泡 vs 涂鸦粘漆 vs 冰霜余寒）
    if (v.slowed && !v.frozen) {
      if (foe.ballSkillKind === "alchemist_puddle") {
        fb.strokeRing(sx, sy, Math.round(orbR * 1.08), Math.max(3, Math.round(5 * cam.zoom)), [124, 255, 42, 225]);
        for (let b = 0; b < 3; b++) {
          const bx = sx + (b - 1) * orbR * 0.45;
          const by = sy - orbR * 0.55 - ((tNow * 36 + b * 11) % (orbR * 0.55));
          fb.fillCircle(bx, by, Math.max(3, Math.round(6 * cam.zoom)), [148, 255, 62, 235]);
        }
      } else if (foe.ballSkillKind === "graffiti_paint") {
        fb.strokeRing(sx, sy, Math.round(orbR * 1.08), Math.max(3, Math.round(5 * cam.zoom)), [255, 42, 178, 225]);
        fb.fillCircle(sx - orbR * 0.42, sy + orbR * 0.52, Math.round(8 * cam.zoom), [38, 242, 255, 235]);
        fb.fillCircle(sx + orbR * 0.38, sy + orbR * 0.48, Math.round(7 * cam.zoom), [255, 42, 178, 235]);
      } else if (foe.ballSkillKind === "frost_freeze") {
        fb.strokeRing(sx, sy, Math.round(orbR * 1.08), Math.max(3, Math.round(5 * cam.zoom)), [125, 245, 255, 225]);
      } else {
        fb.strokeRing(sx, sy, Math.round(orbR * 1.08), Math.max(3, Math.round(5 * cam.zoom)), [185, 255, 220, 235]);
        fb.drawLine(sx - orbR * 0.9, sy - orbR * 0.5, sx + orbR * 0.9, sy + orbR * 0.5, 4, [235, 255, 245, 235]);
        fb.drawLine(sx - orbR * 0.9, sy + orbR * 0.5, sx + orbR * 0.9, sy - orbR * 0.5, 4, [235, 255, 245, 235]);
      }
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
    isDead = false,
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
    } else if (kind === "thunder_rail") {
      // 雷电磁暴王球体面孔：深海赛博蓝装甲核 + 额头金色闪电徽章 + 青白高能护目镜 + 电磁格栅嘴
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [14, 34, 58, a255]);
      // 额头闪电皇冠
      fb.drawLine(sx - orbR * 0.12, sy - orbR * 0.68, sx + orbR * 0.06, sy - orbR * 0.42, 5, [255, 232, 78, a255]);
      fb.drawLine(sx + orbR * 0.06, sy - orbR * 0.42, sx - orbR * 0.08, sy - orbR * 0.36, 5, [255, 232, 78, a255]);
      fb.drawLine(sx - orbR * 0.08, sy - orbR * 0.36, sx + orbR * 0.12, sy - orbR * 0.14, 5, [255, 232, 78, a255]);
      // 双眼：赛博电弧斜眼
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.28 + dir * orbR * 0.05;
        const ey = sy - orbR * 0.06;
        fb.fillRotatedRect(ex, ey, Math.round(orbR * 0.34), Math.round(orbR * 0.14), es * 0.22, [36, 238, 255, a255]);
        fb.fillCircle(ex, ey, Math.max(2, Math.round(orbR * 0.06)), [255, 255, 255, a255]);
      }
      // 底部电磁能量格栅嘴
      const gy = sy + orbR * 0.26;
      fb.fillRoundRect(sx - Math.round(orbR * 0.32), gy - Math.round(orbR * 0.10), Math.round(orbR * 0.64), Math.round(orbR * 0.20), 5, [8, 20, 38, a255]);
      for (let i = -2; i <= 2; i++) {
        fb.drawLine(sx + i * orbR * 0.11, gy - orbR * 0.08, sx + i * orbR * 0.11, gy + orbR * 0.08, 3, [85, 245, 255, a255]);
      }
    } else if (kind === "ninja_shuriken") {
      // 暗影忍者王球体面孔：暗紫夜行头巾与下半脸面罩 + 银亮金属护额铁片 + 凌厉杀气忍者眼
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [28, 16, 48, a255]);
      // 眼部裸露肤色横带
      fb.fillRoundRect(sx - Math.round(orbR * 0.56), sy - Math.round(orbR * 0.22), Math.round(orbR * 1.12), Math.round(orbR * 0.32), 8, [252, 222, 192, a255]);
      // 额头红底护额带 + 银色金属护额片
      fb.fillRoundRect(sx - Math.round(orbR * 0.62), sy - Math.round(orbR * 0.48), Math.round(orbR * 1.24), Math.round(orbR * 0.24), 6, [235, 34, 78, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.34), sy - Math.round(orbR * 0.45), Math.round(orbR * 0.68), Math.round(orbR * 0.18), 4, [220, 232, 248, a255]);
      // 凌厉忍者三角眼
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * orbR * 0.05;
        const ey = sy - orbR * 0.06;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.09), [22, 14, 34, a255]);
        fb.fillCircle(ex + dir * 2, ey - 2, Math.max(2, Math.round(orbR * 0.04)), [255, 255, 255, a255]);
        fb.drawLine(ex - es * orbR * 0.18, ey - orbR * 0.06, ex + es * orbR * 0.16, ey - orbR * 0.14, 4, [24, 14, 38, a255]);
      }
      // 下半脸深紫忍者面罩与X型暗纹
      fb.drawLine(sx - orbR * 0.36, sy + orbR * 0.14, sx + orbR * 0.36, sy + orbR * 0.14, 3, [195, 98, 255, a255]);
    } else if (kind === "frost_freeze") {
      // 急冻冰霜王球体面孔：极寒冰晶蓝内核 + 头顶三叉冰雪皇冠 + 菱形冰蓝寒光眼 + 冷酷霜纹嘴
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [16, 56, 88, a255]);
      // 头顶三叉冰晶皇冠
      for (let i = -1; i <= 1; i++) {
        const cxp = sx + i * orbR * 0.28;
        const cyp = sy - orbR * (i === 0 ? 0.62 : 0.52);
        fb.fillRotatedRect(cxp, cyp, Math.round(orbR * 0.24), Math.round(orbR * 0.24), Math.PI * 0.25, [195, 252, 255, a255]);
      }
      // 菱形冰晶发光双瞳
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * orbR * 0.05;
        const ey = sy - orbR * 0.06;
        fb.fillRotatedRect(ex, ey, Math.round(orbR * 0.22), Math.round(orbR * 0.22), Math.PI * 0.25, [85, 248, 255, a255]);
        fb.fillCircle(ex, ey, Math.max(2, Math.round(orbR * 0.06)), [255, 255, 255, a255]);
      }
      // 冰晶锯齿嘴线
      fb.drawLine(sx - orbR * 0.24, sy + orbR * 0.26, sx, sy + orbR * 0.18, 4, [215, 252, 255, a255]);
      fb.drawLine(sx, sy + orbR * 0.18, sx + orbR * 0.24, sy + orbR * 0.26, 4, [215, 252, 255, a255]);
    } else if (kind === "rider_turbo") {
      // 极速黄骑士球体面孔：亮黄头盔 + 头顶萌系袋鼠耳翼 + 炫酷黑青防风护目镜 + 热血冲刺笑脸
      fb.fillCircle(sx, sy, Math.round(orbR * 0.82), [255, 212, 18, a255]);
      // 头盔顶部双侧闪电耳翼
      for (const es of [-1, 1]) {
        fb.fillRotatedEllipse(sx + es * orbR * 0.42, sy - orbR * 0.58, Math.round(orbR * 0.22), Math.round(orbR * 0.11), es * 0.45, [255, 192, 12, a255]);
        fb.fillRotatedEllipse(sx + es * orbR * 0.42, sy - orbR * 0.58, Math.round(orbR * 0.14), Math.round(orbR * 0.06), es * 0.45, [42, 32, 18, a255]);
      }
      // 下半脸元气肤色
      fb.fillRoundRect(sx - Math.round(orbR * 0.48), sy - Math.round(orbR * 0.08), Math.round(orbR * 0.96), Math.round(orbR * 0.54), 14, [255, 226, 192, a255]);
      // 一体式防风竞速护目镜
      fb.fillRoundRect(sx - Math.round(orbR * 0.54), sy - Math.round(orbR * 0.22), Math.round(orbR * 1.08), Math.round(orbR * 0.28), 9, [22, 26, 42, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.54), sy - Math.round(orbR * 0.22), Math.round(orbR * 1.08), Math.round(orbR * 0.28), 9, 3, [255, 255, 255, a255]);
      fb.drawLine(sx - orbR * 0.34, sy - orbR * 0.12, sx + orbR * 0.12, sy - orbR * 0.12, 4, [72, 238, 255, a255]);
      // 自信大笑白牙嘴
      fb.drawArc(sx + dir * 3, sy + orbR * 0.18, orbR * 0.22, Math.max(3, Math.round(orbR * 0.09)), 0.15, Math.PI - 0.15, [235, 58, 38, a255]);
    } else if (kind === "alchemist_puddle") {
      // 绝命毒师：生化黄防化服兜帽 + 双侧外扩滤毒罐 + 荧光绿防化护目镜 + 辐射呼吸阀
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [36, 48, 38, a255]);
      fb.drawArc(sx, sy, orbR * 0.72, Math.max(5, Math.round(orbR * 0.16)), Math.PI + 0.3, Math.PI * 2 - 0.3, [215, 228, 38, a255]);
      // 左右双侧斜向工业滤毒罐
      for (const es of [-1, 1]) {
        const cxp = sx + es * orbR * 0.44;
        const cyp = sy + orbR * 0.28;
        fb.fillRotatedRect(cxp, cyp, Math.round(orbR * 0.32), Math.round(orbR * 0.22), es * 0.42, [28, 34, 30, a255]);
        fb.fillRotatedRect(cxp, cyp, Math.round(orbR * 0.12), Math.round(orbR * 0.22), es * 0.42, [118, 255, 42, a255]);
      }
      // 防化大护目镜 + 邪魅狂热绿瞳 + 压迫怒眉
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.27 + dir * orbR * 0.04;
        const ey = sy - orbR * 0.10;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.23), [18, 24, 20, a255]);
        fb.fillCircle(ex, ey, Math.round(orbR * 0.18), [118, 255, 42, a255]);
        fb.fillCircle(ex + dir * 2, ey, Math.max(2, Math.round(orbR * 0.06)), [18, 32, 16, a255]);
        fb.fillCircle(ex - 3, ey - 4, Math.max(2, Math.round(orbR * 0.05)), [240, 255, 220, a255]);
        fb.drawLine(ex - es * orbR * 0.16, ey - orbR * 0.14, ex + es * orbR * 0.18, ey - orbR * 0.24, 4, [215, 228, 38, a255]);
      }
      // 中央防毒呼吸面罩鼻阀与三叶生化标
      const my = sy + Math.round(orbR * 0.25);
      fb.fillCircle(sx + dir * 2, my, Math.round(orbR * 0.24), [20, 26, 22, a255]);
      fb.strokeRing(sx + dir * 2, my, Math.round(orbR * 0.22), 3, [132, 255, 48, a255]);
      for (let k = 0; k < 3; k++) {
        const va = (k * Math.PI * 2) / 3 - Math.PI * 0.5;
        fb.fillCircle(sx + dir * 2 + Math.cos(va) * orbR * 0.10, my + Math.sin(va) * orbR * 0.10, Math.max(2, Math.round(orbR * 0.05)), [132, 255, 48, a255]);
      }
    } else if (kind === "bulldozer_wall") {
      // 暴走拆迁队：圆顶棱筋工程黄安全帽 + 粗犷络腮胡渣 + 倒八字怒眉 + 咬牙叼雪茄
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [248, 204, 168, a255]);
      // 下颌络腮胡渣阴影
      fb.drawArc(sx, sy + orbR * 0.04, orbR * 0.56, Math.max(6, Math.round(orbR * 0.26)), 0.25, Math.PI - 0.25, [72, 54, 46, Math.round(a255 * 0.65)]);
      // 圆弧工程安全帽顶 + 中央加强筋 + 帽檐 + 黑黄警示铭牌
      fb.fillRoundRect(sx - Math.round(orbR * 0.64), sy - Math.round(orbR * 0.68), Math.round(orbR * 1.28), Math.round(orbR * 0.44), 16, [255, 192, 18, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.14), sy - Math.round(orbR * 0.76), Math.round(orbR * 0.28), Math.round(orbR * 0.48), 8, [255, 218, 58, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.22), sy - Math.round(orbR * 0.48), Math.round(orbR * 0.44), Math.round(orbR * 0.14), 4, [32, 26, 22, a255]);
      fb.drawLine(sx - orbR * 0.74, sy - orbR * 0.24, sx + orbR * 0.74, sy - orbR * 0.24, 6, [232, 138, 12, a255]);
      // 怒目圆睁 + 倒八字粗黑眉
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * orbR * 0.04;
        const ey = sy - orbR * 0.02;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.13), [255, 255, 255, a255]);
        fb.fillCircle(ex + dir * 2, ey, Math.round(orbR * 0.08), [28, 18, 16, a255]);
        fb.drawLine(ex - es * orbR * 0.04, ey - orbR * 0.10, ex + es * orbR * 0.20, ey - orbR * 0.18, 5, [36, 24, 18, a255]);
      }
      // 咬紧白牙格栅嘴（带竖向牙缝线）+ 嘴角火星雪茄
      const mx = sx - Math.round(orbR * 0.30);
      const my = sy + Math.round(orbR * 0.18);
      const mw = Math.round(orbR * 0.60);
      const mh = Math.round(orbR * 0.20);
      fb.fillRoundRect(mx, my, mw, mh, 5, [255, 255, 255, a255]);
      fb.strokeRoundRect(mx, my, mw, mh, 5, 3, [42, 28, 22, a255]);
      for (let t = -1; t <= 1; t++) {
        fb.drawLine(sx + t * orbR * 0.14, my + 2, sx + t * orbR * 0.14, my + mh - 2, 2, [58, 42, 34, a255]);
      }
      fb.drawLine(sx + dir * orbR * 0.24, my + mh * 0.5, sx + dir * orbR * 0.54, my + mh * 0.2, 6, [138, 76, 36, a255]);
      fb.fillCircle(sx + dir * orbR * 0.56, my + mh * 0.18, Math.max(2, Math.round(orbR * 0.06)), [255, 96, 24, a255]);
    } else if (kind === "angler_reel") {
      // 深海垂钓王：深蓝船长海钓帽（饰金鱼钩徽章）+ 浓密海狼络腮胡 + 独眼龙黑眼罩 + 叼木烟斗
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [245, 206, 170, a255]);
      // 灰蓝海狼大胡子包覆下巴
      fb.drawArc(sx, sy + orbR * 0.06, orbR * 0.58, Math.max(8, Math.round(orbR * 0.28)), 0.2, Math.PI - 0.2, [42, 68, 92, a255]);
      // 深蓝防水渔夫帽 + 金色帽带与鱼钩徽章
      fb.fillRoundRect(sx - Math.round(orbR * 0.66), sy - Math.round(orbR * 0.68), Math.round(orbR * 1.32), Math.round(orbR * 0.42), 14, [16, 118, 188, a255]);
      fb.drawLine(sx - orbR * 0.72, sy - orbR * 0.26, sx + orbR * 0.72, sy - orbR * 0.26, 5, [255, 208, 58, a255]);
      // 左眼海盗独眼黑眼罩（带斜向绑带与刀疤）+ 右眼深海金瞳
      fb.drawLine(sx - orbR * 0.56, sy - orbR * 0.22, sx + orbR * 0.18, sy + orbR * 0.08, 3, [22, 20, 28, a255]);
      fb.fillCircle(sx - orbR * 0.26, sy - orbR * 0.04, Math.round(orbR * 0.17), [20, 18, 26, a255]);
      fb.strokeRing(sx - orbR * 0.26, sy - orbR * 0.04, Math.round(orbR * 0.17), 2, [255, 208, 68, a255]);
      fb.fillCircle(sx + orbR * 0.26, sy - orbR * 0.04, Math.round(orbR * 0.14), [24, 22, 32, a255]);
      fb.fillCircle(sx + orbR * 0.26, sy - orbR * 0.04, Math.round(orbR * 0.09), [58, 238, 255, a255]);
      fb.fillCircle(sx + orbR * 0.28, sy - orbR * 0.06, Math.max(2, Math.round(orbR * 0.04)), [255, 255, 255, a255]);
      // 自信海盗坏笑 + 嘴角木烟斗
      fb.drawArc(sx, sy + orbR * 0.16, orbR * 0.22, 4, 0.2, Math.PI - 0.2, [255, 245, 225, a255]);
      fb.drawLine(sx + orbR * 0.18, sy + orbR * 0.22, sx + orbR * 0.48, sy + orbR * 0.12, 5, [142, 72, 28, a255]);
      fb.fillCircle(sx + orbR * 0.50, sy + orbR * 0.08, Math.round(orbR * 0.09), [112, 52, 20, a255]);
    } else if (kind === "courier_box") {
      // 外卖闪电侠：亮黄防风头盔 + 双侧闪电翼耳 + 赛博蓝HUD测速护目镜 + 耳机麦克风
      fb.fillCircle(sx, sy, Math.round(orbR * 0.82), [255, 208, 18, a255]);
      for (const es of [-1, 1]) {
        fb.fillRotatedRect(sx + es * orbR * 0.52, sy - orbR * 0.48, Math.round(orbR * 0.32), Math.round(orbR * 0.14), es * 0.52, [255, 238, 68, a255]);
      }
      // 下半脸肤色与元气笑容
      fb.fillRoundRect(sx - Math.round(orbR * 0.46), sy - Math.round(orbR * 0.04), Math.round(orbR * 0.92), Math.round(orbR * 0.50), 12, [255, 224, 192, a255]);
      // 赛博蓝防风护目镜 + 亮青速度箭头反光
      fb.fillRoundRect(sx - Math.round(orbR * 0.56), sy - Math.round(orbR * 0.24), Math.round(orbR * 1.12), Math.round(orbR * 0.32), 10, [16, 96, 238, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.56), sy - Math.round(orbR * 0.24), Math.round(orbR * 1.12), Math.round(orbR * 0.32), 10, 3, [255, 255, 255, a255]);
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.22 + dir * 3;
        const ey = sy - orbR * 0.08;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.08), [118, 248, 255, a255]);
        fb.fillCircle(ex, ey, Math.max(2, Math.round(orbR * 0.04)), [255, 255, 255, a255]);
      }
      fb.drawArc(sx + dir * 3, sy + orbR * 0.20, orbR * 0.22, 4, 0.2, Math.PI - 0.2, [228, 48, 38, a255]);
    } else if (kind === "billiard_bank") {
      // 赛博台球手：高光黑8球壳 + 额头白底「8」字圆章 + 赛博翡翠激光瞄准护目镜
      fb.fillCircle(sx, sy, Math.round(orbR * 0.82), [16, 18, 26, a255]);
      fb.drawArc(sx - orbR * 0.18, sy - orbR * 0.18, orbR * 0.48, 4, Math.PI * 1.05, Math.PI * 1.48, [255, 255, 255, Math.round(a255 * 0.55)]);
      // 额头经典白圆「8」字徽章
      const b8y = sy - orbR * 0.36;
      fb.fillCircle(sx, b8y, Math.round(orbR * 0.25), [255, 255, 255, a255]);
      fb.strokeRing(sx, b8y - orbR * 0.07, Math.round(orbR * 0.07), 3, [16, 18, 26, a255]);
      fb.strokeRing(sx, b8y + orbR * 0.07, Math.round(orbR * 0.08), 3, [16, 18, 26, a255]);
      // 赛博激光瞄准护目镜 + 红色十字准星瞳
      fb.fillRoundRect(sx - Math.round(orbR * 0.54), sy - Math.round(orbR * 0.04), Math.round(orbR * 1.08), Math.round(orbR * 0.26), 8, [12, 48, 42, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.54), sy - Math.round(orbR * 0.04), Math.round(orbR * 1.08), Math.round(orbR * 0.26), 8, 3, [42, 248, 192, a255]);
      const targetEx = sx + dir * orbR * 0.20;
      const targetEy = sy + orbR * 0.09;
      fb.fillCircle(targetEx, targetEy, Math.round(orbR * 0.09), [255, 48, 78, a255]);
      fb.fillCircle(sx - dir * orbR * 0.22, targetEy, Math.round(orbR * 0.07), [48, 255, 205, a255]);
    } else if (kind === "graffiti_paint") {
      // 街头涂鸦王：霓虹街头鸭舌帽 + 左青X眼右粉星眼 + 荧光绿鲨鱼齿防毒涂鸦面罩
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [38, 20, 56, a255]);
      // 顶部潮牌街头涂鸦帽檐
      fb.fillRoundRect(sx - Math.round(orbR * 0.62), sy - Math.round(orbR * 0.66), Math.round(orbR * 1.24), Math.round(orbR * 0.36), 12, [255, 38, 178, a255]);
      fb.drawLine(sx - orbR * 0.68, sy - orbR * 0.30, sx + orbR * 0.68, sy - orbR * 0.30, 5, [38, 245, 255, a255]);
      // 左眼：荧光青 X 型街头眼；右眼：荧光粉十字星眼
      const lx = sx - orbR * 0.26;
      const rx = sx + orbR * 0.26;
      const ey = sy - orbR * 0.06;
      const er = Math.round(orbR * 0.13);
      fb.drawLine(lx - er, ey - er, lx + er, ey + er, 4, [38, 245, 255, a255]);
      fb.drawLine(lx - er, ey + er, lx + er, ey - er, 4, [38, 245, 255, a255]);
      fb.fillCircle(rx, ey, Math.round(orbR * 0.15), [255, 42, 172, a255]);
      fb.fillCircle(rx, ey, Math.round(orbR * 0.06), [255, 248, 88, a255]);
      // 下半脸鲨鱼齿涂鸦防毒面罩
      const my = sy + Math.round(orbR * 0.14);
      fb.fillRoundRect(sx - Math.round(orbR * 0.46), my, Math.round(orbR * 0.92), Math.round(orbR * 0.30), 8, [22, 18, 34, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.46), my, Math.round(orbR * 0.92), Math.round(orbR * 0.30), 8, 3, [52, 252, 198, a255]);
      for (let t = -2; t <= 2; t++) {
        const tx = sx + t * orbR * 0.15;
        fb.drawLine(tx - 4, my + 4, tx, my + orbR * 0.24, 3, [255, 255, 255, a255]);
        fb.drawLine(tx, my + orbR * 0.24, tx + 4, my + 4, 3, [255, 255, 255, a255]);
      }
    } else if (kind === "kebab_skewer") {
      // 旋转烤肉王：三团云朵高耸白厨师帽（配红金头带）+ 火焰热忱双眼 + 卷翘浓密大八字胡
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [252, 210, 174, a255]);
      // 顶部3团蓬松白色厨师高帽 + 红金民族风帽箍
      for (let i = -1; i <= 1; i++) {
        fb.fillCircle(sx + i * orbR * 0.26, sy - orbR * (i === 0 ? 0.62 : 0.54), Math.round(orbR * 0.25), [255, 255, 255, a255]);
      }
      fb.fillRoundRect(sx - Math.round(orbR * 0.56), sy - Math.round(orbR * 0.38), Math.round(orbR * 1.12), Math.round(orbR * 0.14), 5, [228, 42, 32, a255]);
      // 热情火焰眼 + 浓眉
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * 2;
        const ey = sy - orbR * 0.06;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.12), [32, 18, 14, a255]);
        fb.fillCircle(ex, ey, Math.round(orbR * 0.07), [255, 118, 24, a255]);
        fb.fillCircle(ex - 2, ey - 2, Math.max(2, Math.round(orbR * 0.04)), [255, 255, 255, a255]);
        fb.drawLine(ex - es * orbR * 0.14, ey - orbR * 0.14, ex + es * orbR * 0.14, ey - orbR * 0.18, 4, [68, 36, 20, a255]);
        // 卷翘浓密八字胡
        fb.drawLine(sx, sy + orbR * 0.16, sx + es * orbR * 0.42, sy + orbR * 0.24, 7, [62, 32, 18, a255]);
        fb.fillCircle(sx + es * orbR * 0.44, sy + orbR * 0.20, Math.round(orbR * 0.07), [62, 32, 18, a255]);
      }
      fb.drawArc(sx, sy + orbR * 0.22, orbR * 0.20, 4, 0.2, Math.PI - 0.2, [225, 52, 38, a255]);
    } else if (kind === "pinball_bumper") {
      // 街机弹珠王：紫金铬金属街机球壳 + 顶部大奖皇冠灯 + 霓虹LED像素块双眼与数码笑脸
      fb.fillCircle(sx, sy, Math.round(orbR * 0.82), [34, 18, 62, a255]);
      fb.strokeRing(sx, sy, Math.round(orbR * 0.72), 3, [255, 58, 198, a255]);
      // 额头街机777金星灯饰
      fb.fillRotatedRect(sx, sy - orbR * 0.44, Math.round(orbR * 0.26), Math.round(orbR * 0.26), Math.PI * 0.25, [255, 224, 42, a255]);
      // LED 霓虹像素双眼
      for (const es of [-1, 1]) {
        const ex = sx + es * Math.round(orbR * 0.28);
        const ey = sy - Math.round(orbR * 0.08);
        fb.fillRoundRect(ex - Math.round(orbR * 0.13), ey - Math.round(orbR * 0.13), Math.round(orbR * 0.26), Math.round(orbR * 0.26), 5, [38, 242, 255, a255]);
        fb.fillRoundRect(ex - Math.round(orbR * 0.07), ey - Math.round(orbR * 0.07), Math.round(orbR * 0.14), Math.round(orbR * 0.14), 3, [255, 255, 255, a255]);
      }
      // 霓虹分段数码笑脸
      fb.drawArc(sx, sy + orbR * 0.12, orbR * 0.30, 6, 0.25, Math.PI - 0.25, [255, 224, 38, a255]);
    } else if (kind === "beyblade_orbit") {
      // 磁悬浮陀螺：八角圣兽核心晶片 + 机械青龙战神双目与金色额角（不再是无脸旋转方块！）
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [12, 34, 56, a255]);
      // 内圈高速旋转三叶涡轮底衬
      const turbAng = tNow * 10;
      fb.fillRotatedRect(sx, sy, Math.round(orbR * 1.18), Math.round(orbR * 0.28), turbAng, [22, 92, 148, a255]);
      fb.fillRotatedRect(sx, sy, Math.round(orbR * 1.18), Math.round(orbR * 0.28), turbAng + Math.PI / 3, [22, 92, 148, a255]);
      fb.fillRotatedRect(sx, sy, Math.round(orbR * 1.18), Math.round(orbR * 0.28), turbAng + (Math.PI * 2) / 3, [22, 92, 148, a255]);
      // 中心圣兽八角装甲核心（固定朝向，清晰呈现圣兽战神面孔）
      fb.fillRoundRect(sx - Math.round(orbR * 0.48), sy - Math.round(orbR * 0.44), Math.round(orbR * 0.96), Math.round(orbR * 0.88), 14, [16, 48, 78, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.48), sy - Math.round(orbR * 0.44), Math.round(orbR * 0.96), Math.round(orbR * 0.88), 14, 3, [255, 212, 48, a255]);
      // 圣兽额头黄金V型龙角
      fb.drawLine(sx, sy - orbR * 0.22, sx - orbR * 0.28, sy - orbR * 0.48, 5, [255, 218, 52, a255]);
      fb.drawLine(sx, sy - orbR * 0.22, sx + orbR * 0.28, sy - orbR * 0.48, 5, [255, 218, 52, a255]);
      // 圣兽青白高能机甲斜眼
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.24 + dir * 2;
        const ey = sy + orbR * 0.02;
        fb.fillRotatedRect(ex, ey, Math.round(orbR * 0.28), Math.round(orbR * 0.12), es * 0.28, [52, 248, 255, a255]);
        fb.fillCircle(ex, ey, Math.max(2, Math.round(orbR * 0.05)), [255, 255, 255, a255]);
      }
      fb.fillCircle(sx, sy + orbR * 0.26, Math.round(orbR * 0.10), [255, 212, 48, a255]);
    } else if (kind === "fireman_hose") {
      // 暴躁消防员：正红消防队长头盔（饰金盾徽章）+ 全景防烟呼吸面罩 + 黄铜供气阀
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [252, 212, 178, a255]);
      // 顶部红色消防头盔与金色消防盾徽
      fb.fillRoundRect(sx - Math.round(orbR * 0.66), sy - Math.round(orbR * 0.68), Math.round(orbR * 1.32), Math.round(orbR * 0.44), 14, [238, 34, 38, a255]);
      fb.drawLine(sx - orbR * 0.74, sy - orbR * 0.24, sx + orbR * 0.74, sy - orbR * 0.24, 5, [255, 215, 52, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.16), sy - Math.round(orbR * 0.58), Math.round(orbR * 0.32), Math.round(orbR * 0.28), 6, [255, 218, 48, a255]);
      // 防烟护目面罩与怒目浓眉
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.26 + dir * 2;
        const ey = sy - orbR * 0.02;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.12), [20, 28, 38, a255]);
        fb.fillCircle(ex - 2, ey - 2, Math.max(2, Math.round(orbR * 0.05)), [125, 245, 255, a255]);
        fb.drawLine(ex - es * orbR * 0.04, ey - orbR * 0.10, ex + es * orbR * 0.18, ey - orbR * 0.18, 4, [42, 24, 20, a255]);
      }
      // 下部红色呼吸供气阀口
      fb.fillCircle(sx + dir * 2, sy + Math.round(orbR * 0.25), Math.round(orbR * 0.20), [36, 42, 52, a255]);
      fb.strokeRing(sx + dir * 2, sy + Math.round(orbR * 0.25), Math.round(orbR * 0.20), 3, [255, 208, 48, a255]);
    } else if (kind === "voodoo_doll") {
      // 巫毒咒术师：粗麻布缝线娃娃头 + 额头缝合疤痕 + 左大绿纽扣X眼 / 右粉纽扣+眼 + 缝线拉链嘴
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [74, 46, 88, a255]);
      // 额头斜向缝合线疤痕
      fb.drawLine(sx - orbR * 0.38, sy - orbR * 0.48, sx + orbR * 0.18, sy - orbR * 0.32, 3, [215, 195, 232, a255]);
      for (let s = -1; s <= 1; s++) {
        const sxp = sx - orbR * 0.10 + s * orbR * 0.14;
        const syp = sy - orbR * 0.40 + s * orbR * 0.04;
        fb.drawLine(sxp - 4, syp + 6, sxp + 4, syp - 6, 2, [215, 195, 232, a255]);
      }
      // 左眼：大号翠绿纽扣眼（带十字缝线孔）；右眼：玫红纽扣眼
      const lx = sx - orbR * 0.26;
      const rx = sx + orbR * 0.26;
      const ey = sy - orbR * 0.06;
      fb.fillCircle(lx, ey, Math.round(orbR * 0.22), [62, 255, 152, a255]);
      fb.strokeRing(lx, ey, Math.round(orbR * 0.22), 3, [22, 42, 32, a255]);
      fb.drawLine(lx - 6, ey - 6, lx + 6, ey + 6, 3, [22, 42, 32, a255]);
      fb.drawLine(lx - 6, ey + 6, lx + 6, ey - 6, 3, [22, 42, 32, a255]);
      fb.fillCircle(rx, ey, Math.round(orbR * 0.16), [255, 62, 168, a255]);
      fb.strokeRing(rx, ey, Math.round(orbR * 0.16), 3, [48, 18, 38, a255]);
      fb.drawLine(rx - 5, ey, rx + 5, ey, 3, [48, 18, 38, a255]);
      fb.drawLine(rx, ey - 5, rx, ey + 5, 3, [48, 18, 38, a255]);
      // 粗麻布缝线嘴
      fb.drawLine(sx - orbR * 0.34, sy + orbR * 0.25, sx + orbR * 0.34, sy + orbR * 0.25, 4, [238, 224, 248, a255]);
      for (let i = -2; i <= 2; i++) {
        fb.drawLine(sx + i * orbR * 0.13, sy + orbR * 0.16, sx + i * orbR * 0.13, sy + orbR * 0.34, 3, [238, 224, 248, a255]);
      }
    } else if (kind === "boxer_rope") {
      // 弹力拳击手：专业红金拳击护头盔（带双颊护垫与金拳王徽章）+ 鼻梁止血贴 + 白色护齿热血笑
      fb.fillCircle(sx, sy, Math.round(orbR * 0.80), [252, 208, 172, a255]);
      // 拳击护头盔顶箍与左右双颊护垫
      fb.strokeRing(sx, sy, Math.round(orbR * 0.72), Math.max(6, Math.round(orbR * 0.20)), [238, 34, 48, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.56), sy - Math.round(orbR * 0.56), Math.round(orbR * 1.12), Math.round(orbR * 0.26), 8, [238, 34, 48, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.20), sy - Math.round(orbR * 0.54), Math.round(orbR * 0.40), Math.round(orbR * 0.18), 5, [255, 215, 52, a255]);
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.25 + dir * 2;
        const ey = sy - orbR * 0.06;
        fb.fillCircle(ex, ey, Math.round(orbR * 0.12), [24, 18, 20, a255]);
        fb.fillCircle(ex - 2, ey - 2, Math.max(2, Math.round(orbR * 0.04)), [255, 255, 255, a255]);
        fb.drawLine(ex - es * orbR * 0.04, ey - orbR * 0.10, ex + es * orbR * 0.18, ey - orbR * 0.16, 4, [38, 22, 18, a255]);
      }
      // 鼻梁白色创可贴 + 白色拳击护齿
      fb.fillRoundRect(sx - Math.round(orbR * 0.14), sy + Math.round(orbR * 0.03), Math.round(orbR * 0.28), Math.round(orbR * 0.09), 3, [255, 255, 255, a255]);
      fb.fillRoundRect(sx - Math.round(orbR * 0.28), sy + Math.round(orbR * 0.18), Math.round(orbR * 0.56), Math.round(orbR * 0.18), 6, [255, 255, 255, a255]);
      fb.strokeRoundRect(sx - Math.round(orbR * 0.28), sy + Math.round(orbR * 0.18), Math.round(orbR * 0.56), Math.round(orbR * 0.18), 6, 2, [42, 28, 24, a255]);
    }

    // 败方被绝杀 K.O. 后的眩晕叉叉眼 (X_X) 与张口击飞表情覆盖层
    if (isDead) {
      for (const es of [-1, 1]) {
        const ex = sx + es * orbR * 0.27;
        const ey = sy - orbR * 0.06;
        const xr = Math.round(orbR * 0.16);
        fb.fillCircle(ex, ey, Math.round(orbR * 0.20), [18, 14, 28, a255]);
        fb.drawLine(ex - xr, ey - xr, ex + xr, ey + xr, 5, [255, 68, 82, a255]);
        fb.drawLine(ex - xr, ey + xr, ex + xr, ey - xr, 5, [255, 68, 82, a255]);
        fb.drawLine(ex - xr * 0.85, ey - xr * 0.85, ex + xr * 0.85, ey + xr * 0.85, 2, [255, 245, 210, a255]);
        fb.drawLine(ex - xr * 0.85, ey + xr * 0.85, ex + xr * 0.85, ey - xr * 0.85, 2, [255, 245, 210, a255]);
      }
      fb.fillCircle(sx, sy + Math.round(orbR * 0.25), Math.round(orbR * 0.14), [18, 12, 24, a255]);
      fb.strokeRing(sx, sy + Math.round(orbR * 0.25), Math.round(orbR * 0.14), 3, [255, 224, 110, a255]);
    }
  };

  // ---------- 1. 极简顶部 HUD (Y: 0..335)：纯粹保留双方英雄名称、血量条与当前属性栏，零文字解说干扰 ----------
  const drawMinimalTopHud = (fb: FrameBuf, _tb: number, tNow: number) => {
    fb.blendGradientRect(0, 0, W, 336, [8, 7, 16, 245], [12, 10, 24, 180], true);

    for (const id of ["A", "B"] as Side[]) {
      const v = byId[id];
      const [r, g, b] = hex(v.color);
      const isLeft = id === "A";
      // 顶部对战血条固定采用高辨识度「左红右蓝」竞技配色，彻底杜绝同色系英雄血条撞色
      const [hpR, hpG, hpB]: [number, number, number] = isLeft ? [255, 42, 74] : [24, 162, 255];

      // 角色代表色圆点徽章 + 角色名称与流派副标题 (Y: 78..126)
      const dotX = isLeft ? 62 : W - 62;
      const dotY = 104;
      fb.drawGlowCircle(dotX, dotY, 18, [r, g, b, 185]);
      fb.fillCircle(dotX, dotY, 11, [r, g, b, 255]);
      fb.strokeRing(dotX, dotY, 11, 2, [255, 255, 255, 240]);

      const nameX = isLeft ? 84 : W - 84;
      const align = isLeft ? "left" : "right";
      drawFit(
        fb,
        atlas,
        `${v.name} · ${v.title}`,
        nameX,
        82,
        [255, 255, 255, 255],
        388,
        0.48,
        align,
        3,
        [10, 8, 22, 245],
      );

      // 加厚高对比「左红右蓝」对战血条 (Y: 138..184) + 街机白条延迟崩落 + 受击震动 + 回血翡翠绿光脉冲
      const barW = 426;
      const barH = 46;
      const shakeOffX = v.barShakeT > 0 ? Math.round(Math.sin(tNow * 145) * 6 * (v.barShakeT / 0.24)) : 0;
      const shakeOffY = v.barShakeT > 0 ? Math.round(Math.cos(tNow * 125) * 4 * (v.barShakeT / 0.24)) : 0;
      const barX = (isLeft ? 48 : W - 48 - barW) + shakeOffX;
      const barY = 138 + shakeOffY;
      const hpFrac = clamp(v.hp / v.maxHp, 0, 1);
      const ghostFrac = clamp(v.ghostHp / v.maxHp, hpFrac, 1);
      const healAlpha = v.healFlashT > 0 ? Math.round(215 * (v.healFlashT / 0.36)) : 0;
      const isDanger = v.hp > 0 && hpFrac <= 0.22;
      const dangerBorder: RGBA =
        healAlpha > 0
          ? [82, 255, 162, 255]
          : isDanger && Math.sin(tNow * 24) > 0
            ? [255, 232, 78, 255]
            : [Math.min(255, hpR + 65), Math.min(255, hpG + 65), Math.min(255, hpB + 65), 235];

      fb.fillRoundRect(barX - 3, barY - 3, barW + 6, barH + 6, 13, dangerBorder);
      fb.fillRoundRect(barX, barY, barW, barH, 10, [18, 16, 32, 248]);

      // 1) 街机格斗经典「延迟崩落白金伤血块 (Delayed White Damage Bar)」：受击停顿 0.28s 后急速回缩，余光秒懂掉血体量！
      if (ghostFrac > hpFrac + 0.003) {
        const gw = Math.round(barW * ghostFrac);
        const gx = isLeft ? barX : barX + (barW - gw);
        fb.fillRoundRect(gx, barY + 3, gw, barH - 6, 8, [255, 248, 212, 248]);
      }

      // 2) 真实高饱和「左红右蓝」血量条 + 回血翡翠绿脉冲涨条
      const fw = Math.round(barW * hpFrac);
      if (fw > 0) {
        const fx = isLeft ? barX : barX + (barW - fw);
        fb.fillRoundRect(fx, barY + 3, fw, barH - 6, 8, [hpR, hpG, hpB, 255]);
        if (healAlpha > 0) {
          fb.fillRoundRect(fx, barY + 3, fw, barH - 6, 8, [78, 255, 158, healAlpha]);
        }
        fb.fillRoundRect(fx, barY + 4, fw, Math.round((barH - 6) * 0.42), 6, [255, 255, 255, 88]);
      }

      // 血条内嵌大号 HP 数值
      const hpStr = `${Math.max(0, Math.ceil(v.hp))} / ${v.maxHp}`;
      drawFit(fb, atlas, hpStr, barX + barW / 2, barY + 9, [255, 255, 255, 255], barW - 24, 0.42, "center", 2);

      // 英雄当前属性/成长进度栏 (Y: 198..246)：保留英雄自身代表色，与场内球体/技能颜色呼应
      const isPulsing = v.statPulse > 0.05;
      const textPulse = 1 + 0.14 * Math.sin(v.statPulse * Math.PI);
      const evoY = 198;
      const evoH = 48;
      const evoFrac = clamp(0.18 + (v.rageStacks / 12) * 0.82, 0.18, 1);

      const borderCol: RGBA = isPulsing ? [255, 232, 98, 255] : [Math.min(255, r + 55), Math.min(255, g + 55), Math.min(255, b + 55), 225];
      fb.fillRoundRect(barX - 2, evoY - 2, barW + 4, evoH + 4, 12, borderCol);
      fb.fillRoundRect(barX, evoY, barW, evoH, 10, [16, 14, 30, 248]);

      const evoFillW = Math.round((barW - 6) * evoFrac);
      const evoFillX = isLeft ? barX + 3 : barX + barW - 3 - evoFillW;
      const fillCol: RGBA = isPulsing
        ? [245, 168, 28, 250]
        : [Math.round(r * 0.78), Math.round(g * 0.78), Math.round(b * 0.78), 235];
      fb.fillRoundRect(evoFillX, evoY + 3, evoFillW, evoH - 6, 8, fillCol);
      fb.fillRoundRect(evoFillX, evoY + 4, evoFillW, Math.round((evoH - 6) * 0.42), 6, [255, 255, 255, isPulsing ? 115 : 68]);

      for (let seg = 1; seg < 10; seg++) {
        const sx = barX + Math.round((barW * seg) / 10);
        fb.blendRect(sx, evoY + 4, 2, evoH - 8, [10, 8, 22, 110]);
      }

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

    // 中央 VS 徽章（纵向贯通血条与属性栏 Y: 138..246）
    const cx = W / 2;
    fb.drawCard(cx - 56, 138, 112, 108, {
      bgTop: [34, 28, 64, 248],
      bgBottom: [18, 14, 36, 252],
      border: [255, 215, 92, 255],
      borderWidth: 3,
      radius: 20,
      shadowAlpha: 130,
      shadowOffsetY: 5,
    });
    drawFit(fb, atlasBig, "VS", cx, 148, [255, 226, 98, 255], 92, 0.46, "center", 3);
    drawFit(fb, atlas, `对决 ${totalClashes}`, cx, 204, [235, 232, 255, 245], 98, 0.30, "center", 2);
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
    // 擂台左右半场边框固定采用「左红右蓝」竞技配色，与顶部红蓝血条上下呼应
    const [ar, ag, ab]: [number, number, number] = [255, 42, 74];
    const [br, bg, bb]: [number, number, number] = [24, 162, 255];

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

    // 辅助函数：检测某坐标处的召唤物是否在最近 0.28s 内刚刚触发了攻击，若是则给予 1.38x Hit-Pop 弹跳放大与高亮金白脉冲环！
    const getSummonHitPop = (wx: number, wy: number): number => {
      let best = 0;
      for (const fx of fxList) {
        if (fx.kind !== "propBurst") continue;
        const age = tb - fx.t0;
        if (age < 0 || age > 0.28) continue;
        if (Math.hypot(fx.x - wx, fx.y - wy) < 52) {
          best = Math.max(best, 1 - age / 0.28);
        }
      }
      return best;
    };

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
        const hitPop = getSummonHitPop(c.x, c.y);
        const cR = Math.round(32 * (1 + 0.36 * hitPop) * cam.zoom);
        if (hitPop > 0) {
          fb.strokeRing(cxp, cyp, Math.round(cR * 1.25), 4, [255, 248, 152, Math.round(250 * hitPop)]);
        }
        fb.fillRotatedEllipse(cxp, cyp + cR * 0.72, cR * 0.9, Math.round(11 * cam.zoom), 0, [0, 0, 0, 130]);
        fb.drawGlowCircle(cxp, cyp, Math.round(cR * 1.45), [r, g, b, 110]);
        fb.fillCircle(cxp, cyp, cR, [r2, g2, b2, 225]);
        fb.fillCircle(cxp, cyp, Math.round(cR * 0.84), [20, 16, 36, 240]);
        fb.strokeRing(cxp, cyp, cR, Math.max(3, Math.round(4 * cam.zoom)), [34, 238, 255, 250]);
        const col = Math.floor(tNow * 12 + c.id) % 4;
        if (owner.combatMode === "skillball") {
          drawSkillBallAvatar(fb, owner.ballSkillKind, cxp, cyp, cR, owner.facing, hitPop > 0, 1, tNow + c.id);
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

    // ---------- Skill-Ball 场地机制 3：暗影忍者王发射的满场高速旋转手里剑 ----------
    for (const side of ["A", "B"] as Side[]) {
      const shurikens = activeShurikens[side];
      if (!shurikens || shurikens.length === 0) continue;
      for (const s of shurikens) {
        const [sxp, syp] = worldToScreen(s.x, s.y, cam, shx, shy);
        const hitPop = getSummonHitPop(s.x, s.y);
        const sR = Math.round(30 * (1 + 0.36 * hitPop) * cam.zoom);
        if (hitPop > 0) {
          fb.strokeRing(sxp, syp, Math.round(sR * 1.25), 4, [255, 248, 152, Math.round(250 * hitPop)]);
        }
        fb.drawGlowCircle(sxp, syp, Math.round(sR * 1.45), [195, 78, 255, 135]);
        // 旋转残影环
        fb.strokeRing(sxp, syp, Math.round(sR * 0.92), 3, [85, 242, 255, 175]);
        // 四角寒光金属手里剑十字主刃
        const ang = s.angle + tNow * 18;
        fb.fillRotatedRect(sxp, syp, Math.round(sR * 2.05), Math.round(11 * cam.zoom), ang, [225, 240, 255, 255]);
        fb.fillRotatedRect(sxp, syp, Math.round(sR * 2.05), Math.round(11 * cam.zoom), ang + Math.PI * 0.5, [225, 240, 255, 255]);
        fb.fillRotatedRect(sxp, syp, Math.round(sR * 1.55), Math.round(6 * cam.zoom), ang + Math.PI * 0.25, [195, 95, 255, 245]);
        fb.fillRotatedRect(sxp, syp, Math.round(sR * 1.55), Math.round(6 * cam.zoom), ang + Math.PI * 0.75, [195, 95, 255, 245]);
        // 中心忍者圆孔
        fb.fillCircle(sxp, syp, Math.round(8 * cam.zoom), [18, 14, 32, 255]);
        fb.strokeRing(sxp, syp, Math.round(8 * cam.zoom), 2, [255, 224, 92, 255]);
      }
    }

    // ---------- Skill-Ball 场地机制 4：12位新英雄二阶段场地机关/道具高精渲染 (activeProps) ----------
    for (const side of ["A", "B"] as Side[]) {
      const props = activeProps[side];
      if (!props || props.length === 0) continue;
      const ownerV = byId[side];
      const [oxp, oyp] = worldToScreen(ownerV.x, ownerV.y, cam, shx, shy);
      for (const p of props) {
        const [px, py] = worldToScreen(p.x, p.y, cam, shx, shy);
        const hitPop = getSummonHitPop(p.x, p.y);
        const pr = Math.max(8, Math.round(p.r * (1 + 0.36 * hitPop) * cam.zoom));
        if (hitPop > 0) {
          fb.drawGlowCircle(px, py, Math.round(pr * 1.48), [255, 248, 165, Math.round(165 * hitPop)]);
          fb.strokeRing(px, py, Math.round(pr * 1.18), 4, [255, 250, 175, Math.round(248 * hitPop)]);
        }
        if (p.kind === "acid_puddle") {
          // 绝命毒师「强酸毒池」：不规则泼洒腐蚀液滩 + 倾倒碎裂的三角化学烧瓶 + 中心骷髅毒标 + 垂直上升破裂气泡（彻底告别圆形旋转球视觉！）
          const pulse = 1 + 0.04 * Math.sin(tNow * 6 + p.id);
          fb.drawGlowCircle(px, py, Math.round(pr * 1.28), [96, 255, 38, 85]);
          // 1) 不规则扁平多瓣泼洒毒液滩（无圆形硬描边！）
          fb.fillRotatedEllipse(px, py + 4, Math.round(pr * 1.14 * pulse), Math.round(pr * 0.76 * pulse), (p.id % 3) * 0.35, [18, 118, 38, 165]);
          const lobeAngles = [0.15, 1.08, 2.05, 3.12, 4.18, 5.25];
          const lobeDist = [0.78, 0.64, 0.82, 0.74, 0.62, 0.80];
          const lobeRad = [0.46, 0.38, 0.44, 0.48, 0.36, 0.42];
          for (let lb = 0; lb < 6; lb++) {
            const la = lobeAngles[lb] + p.id * 0.9;
            const lx = px + Math.cos(la) * pr * lobeDist[lb];
            const ly = py + Math.sin(la) * pr * lobeDist[lb] * 0.78;
            const lr = Math.round(pr * lobeRad[lb] * pulse);
            fb.blendCircle(lx, ly, lr, [32, 185, 48, 155]);
            fb.blendCircle(lx, ly, Math.round(lr * 0.68), [118, 255, 48, 135]);
          }
          fb.fillRotatedEllipse(px, py + 2, Math.round(pr * 0.78 * pulse), Math.round(pr * 0.52 * pulse), 0, [132, 255, 52, 148]);

          // 2) 毒池中心醒目的荧光白绿「剧毒骷髅头」警示标志
          const skX = px + Math.round(pr * 0.10);
          const skY = py + Math.round(pr * 0.04);
          const skR = Math.max(10, Math.round(pr * 0.24));
          // 交叉骨头底衬
          fb.drawLine(skX - skR * 1.25, skY - skR * 0.85, skX + skR * 1.25, skY + skR * 0.85, Math.max(3, Math.round(4 * cam.zoom)), [215, 255, 168, 210]);
          fb.drawLine(skX - skR * 1.25, skY + skR * 0.85, skX + skR * 1.25, skY - skR * 0.85, Math.max(3, Math.round(4 * cam.zoom)), [215, 255, 168, 210]);
          // 骷髅头骨与下颚
          fb.fillCircle(skX, skY - Math.round(skR * 0.15), skR, [235, 255, 195, 235]);
          fb.fillRoundRect(skX - Math.round(skR * 0.55), skY + Math.round(skR * 0.35), Math.round(skR * 1.10), Math.round(skR * 0.58), 3, [235, 255, 195, 235]);
          fb.fillCircle(skX - Math.round(skR * 0.38), skY - Math.round(skR * 0.18), Math.max(2, Math.round(skR * 0.28)), [18, 58, 22, 245]);
          fb.fillCircle(skX + Math.round(skR * 0.38), skY - Math.round(skR * 0.18), Math.max(2, Math.round(skR * 0.28)), [18, 58, 22, 245]);

          // 3) 毒池左侧倾倒流淌强酸的玻璃化学烧瓶
          const flX = px - Math.round(pr * 0.52);
          const flY = py - Math.round(pr * 0.24);
          fb.fillRotatedRect(flX, flY, Math.round(pr * 0.42), Math.round(pr * 0.34), 0.55, [220, 255, 238, 235]);
          fb.fillRotatedRect(flX, flY, Math.round(pr * 0.32), Math.round(pr * 0.24), 0.55, [78, 255, 42, 245]);
          fb.fillRotatedRect(flX + Math.round(pr * 0.20), flY + Math.round(pr * 0.12), Math.round(pr * 0.22), Math.round(pr * 0.14), 0.55, [235, 255, 245, 245]);

          // 4) 垂直向上升腾并破裂的强酸腐蚀气泡（由下往上冒，不再绕圈旋转）
          const bOffsets = [-0.46, -0.12, 0.24, 0.52];
          for (let b = 0; b < 4; b++) {
            const cycle = ((tNow * 1.35 + p.id * 0.41 + b * 0.27) % 1);
            const bx = px + bOffsets[b] * pr + Math.sin(tNow * 5 + b) * 4;
            const by = py + pr * 0.22 - cycle * pr * 0.82;
            const br = Math.max(3, Math.round((1 - cycle * 0.45) * pr * 0.12));
            if (cycle > 0.82) {
              fb.strokeRing(bx, by, Math.round(br * 1.4), 2, [225, 255, 168, Math.round(240 * (1 - cycle) * 5)]);
            } else {
              fb.fillCircle(bx, by, br, [198, 255, 118, 220]);
              fb.strokeRing(bx, by, br, 2, [245, 255, 215, 240]);
            }
          }
        } else if (p.kind === "brick_wall") {
          // 暴走拆迁队「钢筋红砖墙」：三层交错红砖砌体 + 顶部水泥压梁 + 底部黄黑施工警示墩 + 战损裂纹
          const bw = Math.round(pr * 1.42);
          const bh = Math.round(pr * 0.96);
          fb.fillRoundRect(px - bw - 4, py - bh - 4, bw * 2 + 8, bh * 2 + 8, 9, [32, 18, 12, 245]);
          fb.fillRoundRect(px - bw, py - bh, bw * 2, bh * 2, 7, [214, 78, 32, 252]);
          // 顶部浅灰混凝土压顶梁 + 底部黄黑工程警示底座
          fb.fillRoundRect(px - bw - 2, py - bh - 4, bw * 2 + 4, Math.round(bh * 0.34), 5, [188, 196, 210, 255]);
          fb.fillRoundRect(px - bw - 2, py + bh - Math.round(bh * 0.28), bw * 2 + 4, Math.round(bh * 0.32), 4, [255, 196, 24, 255]);
          for (let st = -2; st <= 2; st++) {
            fb.fillRotatedRect(px + st * bw * 0.38, py + bh - Math.round(bh * 0.12), Math.round(bw * 0.22), Math.round(bh * 0.26), 0.45, [28, 24, 20, 245]);
          }
          // 交错水泥砖缝与砖面高光
          fb.drawLine(px - bw + 4, py - bh * 0.22, px + bw - 4, py - bh * 0.22, 3, [86, 32, 16, 245]);
          fb.drawLine(px - bw + 4, py + bh * 0.32, px + bw - 4, py + bh * 0.32, 3, [86, 32, 16, 245]);
          fb.drawLine(px, py - bh * 0.65, px, py - bh * 0.22, 3, [86, 32, 16, 245]);
          fb.drawLine(px - bw * 0.46, py - bh * 0.22, px - bw * 0.46, py + bh * 0.32, 3, [86, 32, 16, 245]);
          fb.drawLine(px + bw * 0.46, py - bh * 0.22, px + bw * 0.46, py + bh * 0.32, 3, [86, 32, 16, 245]);
          fb.drawLine(px, py + bh * 0.32, px, py + bh * 0.72, 3, [86, 32, 16, 245]);
          if (p.val === 1) {
            // 受创后墙体出现明显黑色闪电裂痕
            fb.drawLine(px - bw * 0.25, py - bh * 0.55, px + bw * 0.12, py, 4, [24, 14, 10, 250]);
            fb.drawLine(px + bw * 0.12, py, px - bw * 0.18, py + bh * 0.55, 4, [24, 14, 10, 250]);
          }
        } else if (p.kind === "wrecking_ball") {
          // 暴走拆迁队：重型黑铁锁链 + 环绕挥舞的带刺拆迁大铁球！
          const chainLinks = 7;
          for (let lk = 0; lk <= chainLinks; lk++) {
            const u = lk / chainLinks;
            const lx = Math.round(oxp + (px - oxp) * u);
            const ly = Math.round(oyp + (py - oyp) * u);
            fb.fillCircle(lx, ly, Math.round(9 * cam.zoom), [42, 38, 48, 250]);
            fb.strokeRing(lx, ly, Math.round(9 * cam.zoom), 3, [210, 218, 232, 245]);
          }
          // 铁球挥舞弧形破风残影
          const swingAng = p.angle ?? Math.atan2(py - oyp, px - oxp);
          const orbitDist = Math.hypot(px - oxp, py - oyp);
          const dirSign = side === "A" ? 1 : -1;
          const arcStart = dirSign > 0 ? swingAng - 0.65 : swingAng;
          const arcEnd = dirSign > 0 ? swingAng : swingAng + 0.65;
          fb.drawArc(oxp, oyp, orbitDist, Math.round(18 * cam.zoom), arcStart, arcEnd, [255, 162, 32, 115]);

          // 拆迁大铁球本体与8根重型破墙钢刺
          fb.drawGlowCircle(px, py, Math.round(pr * 1.48), [255, 148, 28, 185]);
          for (let sp = 0; sp < 8; sp++) {
            const sa = (p.angle ?? 0) * 1.5 + (sp * Math.PI) / 4;
            const sx1 = px + Math.cos(sa) * pr * 0.85;
            const sy1 = py + Math.sin(sa) * pr * 0.85;
            const sx2 = px + Math.cos(sa) * pr * 1.32;
            const sy2 = py + Math.sin(sa) * pr * 1.32;
            fb.drawLine(sx1, sy1, sx2, sy2, Math.max(4, Math.round(7 * cam.zoom)), [235, 240, 250, 255]);
          }
          fb.fillCircle(px, py, pr, [34, 32, 42, 255]);
          fb.fillCircle(px - Math.round(pr * 0.25), py - Math.round(pr * 0.25), Math.round(pr * 0.45), [86, 88, 108, 240]);
          fb.strokeRing(px, py, pr, 4, [255, 182, 42, 255]);
          fb.strokeRing(px, py, Math.round(pr * 0.58), 3, [255, 118, 24, 235]);
        } else if (p.kind === "flying_brick") {
          // 铁球砸碎砖墙后爆射出的高速旋转红砖块（带双砖孔细节）
          const bAng = (p.angle ?? 0) + tNow * 16;
          fb.drawGlowCircle(px, py, Math.round(pr * 1.55), [255, 128, 38, 185]);
          fb.fillRotatedRect(px, py, Math.round(pr * 1.95), Math.round(pr * 1.15), bAng, [92, 32, 16, 255]);
          fb.fillRotatedRect(px, py, Math.round(pr * 1.72), Math.round(pr * 0.92), bAng, [228, 86, 32, 255]);
          fb.fillCircle(px - Math.cos(bAng) * pr * 0.36, py - Math.sin(bAng) * pr * 0.36, Math.max(2, Math.round(pr * 0.18)), [92, 32, 16, 255]);
          fb.fillCircle(px + Math.cos(bAng) * pr * 0.36, py + Math.sin(bAng) * pr * 0.36, Math.max(2, Math.round(pr * 0.18)), [92, 32, 16, 255]);
        } else if (p.kind === "fish_hook") {
          // 深海垂钓王「深海巨型倒刺锚钩 & 真实绷紧收线拖拽视觉」
          const isReeling = p.val === 99;
          // 1) 鱼线：平时为轻盈半透明青丝 (alpha=115)；一旦挂钩进入 0.45s 收线拖拽态 (isReeling)，化为加粗高亮金青绷紧主线 + 高速向垂钓王回流的收线脉冲珠！
          fb.drawLine(oxp, oyp, px, py, isReeling ? 8 : 3, isReeling ? [255, 218, 58, 245] : [38, 218, 255, 115]);
          fb.drawLine(oxp, oyp, px, py, isReeling ? 3 : 1, isReeling ? [245, 255, 255, 255] : [220, 250, 255, 155]);
          if (isReeling) {
            for (let k = 0; k < 4; k++) {
              const u = 1 - ((tNow * 6.0 + k * 0.25) % 1);
              const rx = Math.round(oxp + (px - oxp) * u);
              const ry = Math.round(oyp + (py - oyp) * u);
              fb.fillCircle(rx, ry, Math.round(8 * cam.zoom), [255, 245, 128, 250]);
              fb.fillCircle(rx, ry, Math.round(4 * cam.zoom), [255, 255, 255, 255]);
            }
            // 挂钩点深海漩涡水链锁环 + V字破水拖拽尾浪
            const pullAng = Math.atan2(oyp - py, oxp - px);
            fb.strokeRing(px, py, Math.round(pr * 1.48), 5, [255, 224, 68, 245]);
            fb.drawArc(px, py, Math.round(pr * 1.72), Math.round(8 * cam.zoom), pullAng - 1.0, pullAng + 1.0, [115, 248, 255, 240]);
          }
          // 2) 鱼线中后段挂载经典红白双色海钓浮漂（收线时高频抖动）
          const jitter = isReeling ? Math.sin(tNow * 52) * 7 * cam.zoom : 0;
          const bobX = Math.round(px * 0.72 + oxp * 0.28 + jitter);
          const bobY = Math.round(py * 0.72 + oyp * 0.28 - jitter);
          fb.fillCircle(bobX, bobY, Math.round(13 * cam.zoom), [255, 255, 255, 255]);
          fb.drawArc(bobX, bobY, Math.round(9 * cam.zoom), Math.round(8 * cam.zoom), Math.PI, Math.PI * 2, [255, 42, 68, 255]);
          fb.strokeRing(bobX, bobY, Math.round(13 * cam.zoom), 2, [24, 38, 58, 255]);

          // 水漩涡光环 + 巨型弯钩主体（金扣环 + 精钢钩柄 + J型弯弧 + 锋利倒刺钩尖）
          fb.drawGlowCircle(px, py, Math.round(pr * 1.48), [24, 212, 255, isReeling ? 235 : 165]);
          const wAng = tNow * (isReeling ? 22 : 10) + p.id;
          fb.drawArc(px, py, pr * 1.12, Math.max(3, Math.round(5 * cam.zoom)), wAng, wAng + 1.8, [125, 245, 255, 215]);
          fb.drawArc(px, py, pr * 1.12, Math.max(3, Math.round(5 * cam.zoom)), wAng + Math.PI, wAng + Math.PI + 1.8, [125, 245, 255, 215]);

          const shankTopX = px - pr * 0.18;
          const shankTopY = py - pr * 0.78;
          const shankBotX = px - pr * 0.18;
          const shankBotY = py + pr * 0.18;
          const bendCx = px + pr * 0.24;
          const bendCy = py + pr * 0.18;
          const bendR = pr * 0.42;
          const tipX = px + pr * 0.66;
          const tipY = py - pr * 0.18;
          // 黄金挂线环
          fb.strokeRing(shankTopX, shankTopY - pr * 0.14, Math.round(pr * 0.18), 4, [255, 212, 58, 255]);
          // 精钢直钩柄与J型大弯钩
          fb.drawLine(shankTopX, shankTopY, shankBotX, shankBotY, Math.max(6, Math.round(10 * cam.zoom)), [210, 228, 248, 255]);
          fb.drawLine(shankTopX, shankTopY, shankBotX, shankBotY, Math.max(3, Math.round(5 * cam.zoom)), [255, 255, 255, 255]);
          fb.drawArc(bendCx, bendCy, bendR, Math.max(6, Math.round(10 * cam.zoom)), 0, Math.PI, [210, 228, 248, 255]);
          fb.drawArc(bendCx, bendCy, bendR, Math.max(3, Math.round(5 * cam.zoom)), 0, Math.PI, [255, 255, 255, 255]);
          // 锋利倒刺钩尖
          fb.drawLine(bendCx + bendR, bendCy, tipX, tipY, Math.max(5, Math.round(9 * cam.zoom)), [235, 248, 255, 255]);
          fb.drawLine(tipX, tipY, tipX - pr * 0.24, tipY + pr * 0.16, Math.max(4, Math.round(6 * cam.zoom)), [255, 255, 255, 255]);
          fb.drawLine(tipX, tipY, tipX + pr * 0.14, tipY + pr * 0.24, Math.max(3, Math.round(5 * cam.zoom)), [95, 245, 255, 255]);
        } else if (p.kind === "delivery_box") {
          if (p.val === 1) {
            // 外卖闪电侠「回血珍珠奶茶杯」：冰爽奶茶杯身 + 白色雪顶盖 + 粗紫斜插吸管 + 杯底黑糖波霸珍珠
            fb.drawGlowCircle(px, py, Math.round(pr * 1.42), [68, 255, 152, 165]);
            const cw = Math.round(pr * 0.78);
            const ch = Math.round(pr * 0.96);
            // 粗紫波霸吸管（斜插出杯顶）
            fb.drawLine(px + cw * 0.15, py - ch * 0.2, px + cw * 0.55, py - ch * 1.38, Math.max(6, Math.round(10 * cam.zoom)), [198, 52, 255, 255]);
            fb.drawLine(px + cw * 0.15, py - ch * 0.2, px + cw * 0.55, py - ch * 1.38, Math.max(2, Math.round(4 * cam.zoom)), [248, 195, 255, 255]);
            // 奶茶杯主体与奶盖
            fb.fillRoundRect(px - cw - 3, py - ch + 6, cw * 2 + 6, ch * 2 - 4, 10, [52, 34, 24, 245]);
            fb.fillRoundRect(px - cw, py - ch + 9, cw * 2, ch * 2 - 10, 8, [242, 198, 142, 255]);
            fb.fillRoundRect(px - cw - 5, py - ch, cw * 2 + 10, Math.round(ch * 0.42), 8, [255, 252, 245, 255]);
            fb.strokeRoundRect(px - cw, py - ch + 9, cw * 2, ch * 2 - 10, 8, 3, [82, 255, 162, 255]);
            // 杯底6颗黑糖珍珠波霸
            for (let b = 0; b < 5; b++) {
              const bx = px + (b - 2) * cw * 0.34;
              const by = py + ch * 0.58 + (b % 2) * 5;
              fb.fillCircle(bx, by, Math.max(3, Math.round(pr * 0.13)), [38, 22, 16, 255]);
              fb.fillCircle(bx - 1, by - 1, Math.max(1, Math.round(pr * 0.05)), [255, 225, 185, 235]);
            }
          } else {
            // 外卖闪电侠「辣油炸弹外卖盒」：红金爆辣外卖箱 + 顶部滋滋冒火花的炸弹引线 + 火辣椒徽章
            const sparkPulse = 1 + 0.12 * Math.sin(tNow * 28 + p.id);
            fb.drawGlowCircle(px, py, Math.round(pr * 1.45 * sparkPulse), [255, 78, 24, 175]);
            const bw = Math.round(pr * 0.92);
            const bh = Math.round(pr * 0.88);
            // 顶部弯曲炸弹引线与爆裂火星
            const fuseX = px + Math.round(bw * 0.35);
            const fuseY = py - bh - Math.round(pr * 0.38);
            fb.drawLine(px, py - bh, fuseX, fuseY, Math.max(3, Math.round(5 * cam.zoom)), [215, 195, 165, 255]);
            fb.drawGlowCircle(fuseX, fuseY, Math.round(18 * sparkPulse * cam.zoom), [255, 218, 38, 235]);
            fb.fillCircle(fuseX, fuseY, Math.round(7 * sparkPulse * cam.zoom), [255, 255, 220, 255]);
            // 外卖盒主体与金色封箱带
            fb.fillRoundRect(px - bw - 3, py - bh - 3, bw * 2 + 6, bh * 2 + 6, 10, [42, 16, 14, 245]);
            fb.fillRoundRect(px - bw, py - bh, bw * 2, bh * 2, 8, [238, 38, 38, 255]);
            fb.strokeRoundRect(px - bw, py - bh, bw * 2, bh * 2, 8, 3, [255, 212, 38, 255]);
            fb.fillRoundRect(px - Math.round(bw * 0.22), py - bh, Math.round(bw * 0.44), bh * 2, 3, [255, 208, 28, 255]);
            fb.fillCircle(px, py, Math.round(pr * 0.34), [38, 18, 16, 255]);
            fb.fillCircle(px, py, Math.round(pr * 0.22), [255, 138, 24, 255]);
          }
        } else if (p.kind === "pool_ball") {
          // 赛博台球手「几何彩球」：专业台球配色（全色球/花色横带球）+ 中心白圆黑字号 + 几何反弹虚线尾迹
          const palette: RGBA[] = [
            [255, 204, 18, 255],
            [28, 128, 255, 255],
            [255, 48, 64, 255],
            [168, 48, 255, 255],
            [255, 128, 24, 255],
            [28, 224, 128, 255],
          ];
          const bCol = palette[p.id % palette.length];
          const moveA = p.angle ?? 0;
          // 前方青色几何瞄准虚线
          const rayX = px + Math.cos(moveA) * pr * 1.95;
          const rayY = py + Math.sin(moveA) * pr * 1.95;
          fb.drawLine(px, py, rayX, rayY, 3, [48, 255, 208, 155]);
          fb.drawGlowCircle(px, py, Math.round(pr * 1.38), [bCol[0], bCol[1], bCol[2], 150]);
          // 花色球先铺白底再画宽彩带，全色球铺纯彩底
          if (p.id % 2 === 0) {
            fb.fillCircle(px, py, pr, [248, 250, 255, 255]);
            fb.fillRoundRect(px - pr + 2, py - Math.round(pr * 0.56), pr * 2 - 4, Math.round(pr * 1.12), 6, bCol);
          } else {
            fb.fillCircle(px, py, pr, bCol);
          }
          fb.strokeRing(px, py, pr, 3, [255, 255, 255, 245]);
          // 中心白圆号牌与数字笔画
          const numR = Math.round(pr * 0.48);
          fb.fillCircle(px, py, numR, [255, 255, 255, 255]);
          fb.drawLine(px, py - numR * 0.52, px, py + numR * 0.52, 4, [18, 20, 28, 255]);
          fb.drawLine(px - numR * 0.35, py + numR * 0.52, px + numR * 0.35, py + numR * 0.52, 3, [18, 20, 28, 255]);
          // 左上角高光白斑
          fb.fillCircle(px - Math.round(pr * 0.35), py - Math.round(pr * 0.35), Math.max(2, Math.round(pr * 0.18)), [255, 255, 255, 235]);
        } else if (p.kind === "paint_splat") {
          // 街头涂鸦王「霓虹喷漆地贴」：不规则飞溅油漆斑块 + 滴落漆泪 + 中心街头涂鸦三尖皇冠（彻底移除生硬黄圆圈！）
          const col: RGBA =
            p.id % 3 === 0
              ? [255, 36, 172, 185]
              : p.id % 3 === 1
                ? [28, 242, 255, 185]
                : [185, 255, 36, 185];
          fb.drawGlowCircle(px, py, Math.round(pr * 1.25), [col[0], col[1], col[2], 95]);
          fb.fillRotatedEllipse(px, py, Math.round(pr * 1.05), Math.round(pr * 0.82), p.id * 0.7, col);
          // 7处不对称飞溅油漆点与流挂漆滴
          const splatAngs = [0.2, 1.05, 1.85, 2.75, 3.6, 4.55, 5.4];
          const splatDists = [0.88, 0.72, 0.94, 0.76, 0.90, 0.74, 0.85];
          const splatRads = [0.42, 0.28, 0.36, 0.44, 0.26, 0.38, 0.30];
          for (let s = 0; s < 7; s++) {
            const sa = splatAngs[s] + p.id * 1.1;
            const sxp = Math.round(px + Math.cos(sa) * pr * splatDists[s]);
            const syp = Math.round(py + Math.sin(sa) * pr * splatDists[s]);
            fb.blendCircle(sxp, syp, Math.round(pr * splatRads[s]), col);
          }
          // 中心街头涂鸦标志性「三尖金皇冠 (Street Crown)」Tag
          const cw = Math.round(pr * 0.44);
          const ch = Math.round(pr * 0.28);
          fb.drawLine(px - cw, py + ch, px + cw, py + ch, 5, [255, 238, 48, 245]);
          fb.drawLine(px - cw, py + ch, px - cw * 0.85, py - ch, 4, [255, 238, 48, 245]);
          fb.drawLine(px - cw * 0.85, py - ch, px - cw * 0.25, py + ch * 0.2, 4, [255, 238, 48, 245]);
          fb.drawLine(px - cw * 0.25, py + ch * 0.2, px, py - ch * 1.25, 4, [255, 238, 48, 245]);
          fb.drawLine(px, py - ch * 1.25, px + cw * 0.25, py + ch * 0.2, 4, [255, 238, 48, 245]);
          fb.drawLine(px + cw * 0.25, py + ch * 0.2, px + cw * 0.85, py - ch, 4, [255, 238, 48, 245]);
          fb.drawLine(px + cw * 0.85, py - ch, px + cw, py + ch, 4, [255, 238, 48, 245]);
        } else if (p.kind === "roast_grill") {
          // 旋转烤肉王「炭火烧烤炉」：铸铁双耳黑炭盆 + 内部通红燃烧木炭 + 4根银亮不锈钢烤网 + 滋滋冒油的烤肉串
          const pulse = 1 + 0.08 * Math.sin(tNow * 14 + p.id);
          fb.drawGlowCircle(px, py, Math.round(pr * 1.52 * pulse), [255, 86, 22, 185]);
          // 左右铸铁炉耳把手
          fb.fillRoundRect(px - Math.round(pr * 1.24), py - Math.round(pr * 0.22), Math.round(pr * 2.48), Math.round(pr * 0.44), 8, [48, 42, 46, 255]);
          fb.strokeRoundRect(px - Math.round(pr * 1.24), py - Math.round(pr * 0.22), Math.round(pr * 2.48), Math.round(pr * 0.44), 8, 3, [255, 195, 58, 245]);
          // 铸铁炭火盆外圈与内部通红燃烧炭火
          fb.fillCircle(px, py, pr, [32, 26, 28, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.84), [218, 42, 18, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.58 * pulse), [255, 168, 28, 250]);
          fb.strokeRing(px, py, pr, 4, [255, 208, 62, 255]);
          // 4根平行不锈钢烧烤架网条
          for (const gOff of [-0.52, -0.18, 0.18, 0.52]) {
            const gy = Math.round(py + gOff * pr);
            const halfSpan = Math.sqrt(Math.max(0.1, 1 - gOff * gOff)) * pr * 0.86;
            fb.drawLine(px - halfSpan, gy, px + halfSpan, gy, 3, [215, 228, 242, 240]);
          }
          // 炉面斜架着的两串焦香烤肉串
          for (const sOff of [-0.26, 0.26]) {
            const sx0 = px - pr * 0.72;
            const sy0 = py + sOff * pr - pr * 0.22;
            const sx1 = px + pr * 0.72;
            const sy1 = py + sOff * pr + pr * 0.22;
            fb.drawLine(sx0, sy0, sx1, sy1, 3, [240, 248, 255, 255]);
            fb.fillCircle((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5, Math.round(pr * 0.20), [185, 62, 22, 255]);
            fb.fillCircle((sx0 + sx1) * 0.5, (sy0 + sy1) * 0.5, Math.round(pr * 0.11), [255, 198, 52, 255]);
          }
        } else if (p.kind === "bumper_peg") {
          // 街机弹珠王「777霓虹蘑菇撞柱」：外围弹簧震波齿圈 + 8颗跑马灯珠 + 中心十字星芒大奖圆顶
          const pulse = 1 + 0.08 * Math.sin(tNow * 18 + p.id);
          fb.drawGlowCircle(px, py, Math.round(pr * 1.62 * pulse), [255, 212, 38, 195]);
          fb.strokeRing(px, py, Math.round(pr * 1.16 * pulse), 3, [48, 245, 255, 225]);
          fb.fillCircle(px, py, pr, [42, 18, 72, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.82), [235, 38, 118, 255]);
          fb.strokeRing(px, py, pr, 5, [255, 228, 52, 255]);
          // 周围8颗闪烁街机跑马灯珠
          for (let b = 0; b < 8; b++) {
            const ba = tNow * 4 + (b * Math.PI) / 4;
            const bx = px + Math.cos(ba) * pr * 0.82;
            const by = py + Math.sin(ba) * pr * 0.82;
            fb.fillCircle(bx, by, Math.max(3, Math.round(pr * 0.11)), b % 2 === 0 ? [255, 248, 92, 255] : [58, 248, 255, 255]);
          }
          // 中心十字星芒高光核
          fb.fillRotatedRect(px, py, Math.round(pr * 0.96 * pulse), Math.round(pr * 0.26), 0, [255, 238, 78, 255]);
          fb.fillRotatedRect(px, py, Math.round(pr * 0.96 * pulse), Math.round(pr * 0.26), Math.PI * 0.5, [255, 238, 78, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.28), [255, 255, 255, 255]);
        } else if (p.kind === "sub_beyblade") {
          // 磁悬浮陀螺「子陀螺」：母子折线等离子电弧连接 + 六翼斜切金属锯齿外环 + 圣兽晶片核
          const midX = (oxp + px) * 0.5 + Math.sin(tNow * 32 + p.id) * 14 * cam.zoom;
          const midY = (oyp + py) * 0.5 + Math.cos(tNow * 32 + p.id) * 14 * cam.zoom;
          fb.drawLine(oxp, oyp, midX, midY, 4, [28, 232, 255, 195]);
          fb.drawLine(midX, midY, px, py, 4, [28, 232, 255, 195]);
          fb.drawLine(oxp, oyp, midX, midY, 2, [235, 255, 255, 240]);
          fb.drawLine(midX, midY, px, py, 2, [235, 255, 255, 240]);

          fb.drawGlowCircle(px, py, Math.round(pr * 1.52), [28, 232, 255, 185]);
          const ang = (p.angle ?? 0) + tNow * 24;
          for (let k = 0; k < 6; k++) {
            const ka = ang + (k * Math.PI) / 3;
            const tx = px + Math.cos(ka) * pr * 1.15;
            const ty = py + Math.sin(ka) * pr * 1.15;
            fb.fillRotatedRect(tx, ty, Math.round(pr * 0.72), Math.round(pr * 0.34), ka + 0.6, [225, 238, 255, 255]);
          }
          fb.fillCircle(px, py, Math.round(pr * 0.92), [16, 48, 82, 255]);
          fb.strokeRing(px, py, Math.round(pr * 0.92), 4, [255, 212, 42, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.42), [58, 248, 255, 255]);
        } else if (p.kind === "hydrant_jet") {
          // 暴躁消防员「高压消防栓 & 激流水柱」：带双侧黄铜水阀的红色消防栓 + 奔涌推进的水浪泡沫环与末端水花飞溅
          const ang = p.angle ?? 0;
          const cosA = Math.cos(ang);
          const sinA = Math.sin(ang);
          const perpA_X = -sinA;
          const perpA_Y = cosA;
          const jetLen = pr * 5.2;
          const jx = px + cosA * jetLen;
          const jy = py + sinA * jetLen;
          // 1) 高压水柱激流主束 + 沿水柱高速向外推进的5道奔涌水浪圈
          fb.drawLine(px, py, jx, jy, Math.max(14, Math.round(24 * cam.zoom)), [24, 158, 255, 150]);
          fb.drawLine(px, py, jx, jy, Math.max(8, Math.round(14 * cam.zoom)), [78, 232, 255, 220]);
          fb.drawLine(px, py, jx, jy, Math.max(4, Math.round(6 * cam.zoom)), [240, 255, 255, 250]);
          for (let w = 0; w < 5; w++) {
            const u = (tNow * 4.8 + w * 0.2 + p.id * 0.3) % 1;
            const wx = px + cosA * jetLen * u;
            const wy = py + sinA * jetLen * u;
            const wr = Math.round((8 + u * 14) * cam.zoom);
            fb.fillCircle(wx + perpA_X * Math.sin(u * 12) * 5, wy + perpA_Y * Math.sin(u * 12) * 5, wr, [215, 252, 255, Math.round(220 * (1 - u * 0.5))]);
          }
          // 水柱末端撞击水花泡沫团
          fb.drawGlowCircle(jx, jy, Math.round(pr * 1.45), [98, 242, 255, 210]);
          for (let sp = 0; sp < 4; sp++) {
            const sa = ang + (sp - 1.5) * 0.55 + Math.sin(tNow * 20 + sp) * 0.15;
            fb.fillCircle(jx + Math.cos(sa) * pr * 0.52, jy + Math.sin(sa) * pr * 0.52, Math.round(pr * 0.28), [235, 255, 255, 235]);
          }
          // 2) 铸铁红色消防栓本体（左右双侧黄铜出水螺母 + 红圆顶 + 顶部银色五角阀帽）
          fb.fillRotatedRect(px, py, Math.round(pr * 0.72), Math.round(pr * 2.38), ang, [255, 208, 48, 255]);
          fb.fillCircle(px, py, pr, [238, 36, 42, 255]);
          fb.strokeRing(px, py, pr, 4, [255, 218, 52, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.52), [255, 78, 78, 255]);
          fb.fillRotatedRect(px, py, Math.round(pr * 0.42), Math.round(pr * 0.42), Math.PI * 0.25, [235, 242, 255, 255]);
        } else if (p.kind === "voodoo_effigy") {
          // 巫毒咒术师「巫毒替身草人」：平时不画常驻实心绿线（彻底杜绝“一直连线却不掉血”的假激光错觉），改为脚下旋转巫毒法阵 + 麻布玩偶 + 胸口红心靶标 + 双巨针！
          const hexPulse = 1 + 0.08 * Math.sin(tNow * 12 + p.id);
          fb.drawGlowCircle(px, py, Math.round(pr * 1.55), [172, 48, 255, 165]);
          fb.strokeRing(px, py, Math.round(pr * 1.24 * hexPulse), 3, [195, 58, 255, 195]);
          for (let rIdx = 0; rIdx < 4; rIdx++) {
            const ra = tNow * 3.5 + (rIdx * Math.PI) / 2;
            fb.fillCircle(
              Math.round(px + Math.cos(ra) * pr * 1.24 * hexPulse),
              Math.round(py + Math.sin(ra) * pr * 1.24 * hexPulse),
              Math.round(5 * cam.zoom),
              [78, 255, 162, 225],
            );
          }

          // 2) 替身草人麻布四肢、躯干与圆头轮廓
          const headY = py - Math.round(pr * 0.36);
          const headR = Math.round(pr * 0.56);
          const bodyY = py + Math.round(pr * 0.34);
          // 张开的麻布双臂与躯干
          fb.fillRotatedRect(px, bodyY - Math.round(pr * 0.12), Math.round(pr * 1.72), Math.round(pr * 0.42), 0, [138, 102, 72, 255]);
          fb.fillRoundRect(px - Math.round(pr * 0.48), bodyY - Math.round(pr * 0.38), Math.round(pr * 0.96), Math.round(pr * 0.96), 10, [158, 118, 82, 255]);
          fb.strokeRoundRect(px - Math.round(pr * 0.48), bodyY - Math.round(pr * 0.38), Math.round(pr * 0.96), Math.round(pr * 0.96), 10, 3, [72, 255, 158, 245]);
          // 胸口鲜红诅咒爱心靶标
          fb.fillCircle(px + Math.round(pr * 0.12), bodyY + Math.round(pr * 0.05), Math.round(pr * 0.22), [255, 36, 78, 255]);
          // 草人头部与一大一小纽扣眼
          fb.fillCircle(px, headY, headR, [168, 128, 92, 255]);
          fb.strokeRing(px, headY, headR, 3, [72, 255, 158, 255]);
          fb.fillCircle(px - Math.round(headR * 0.36), headY - 2, Math.round(headR * 0.28), [68, 255, 158, 255]);
          fb.fillCircle(px + Math.round(headR * 0.36), headY - 2, Math.round(headR * 0.22), [255, 58, 168, 255]);

          // 3) 狠狠扎进草人胸口与头部的2根巨型红头/绿头巫毒诅咒银针
          fb.drawLine(px + pr * 0.12, bodyY + pr * 0.05, px + pr * 0.95, py - pr * 0.72, 4, [235, 245, 255, 255]);
          fb.fillCircle(px + pr * 0.98, py - pr * 0.75, Math.round(pr * 0.24), [255, 38, 82, 255]);
          fb.drawLine(px - pr * 0.15, headY, px - pr * 0.92, py - pr * 0.82, 4, [235, 245, 255, 255]);
          fb.fillCircle(px - pr * 0.95, py - pr * 0.85, Math.round(pr * 0.22), [68, 255, 158, 255]);
        } else if (p.kind === "ring_post") {
          // 弹力拳击手「拳击台金红角柱」
          fb.drawGlowCircle(px, py, Math.round(pr * 1.42), [255, 62, 72, 165]);
          fb.fillRoundRect(px - pr, py - pr, pr * 2, pr * 2, 12, [242, 34, 48, 255]);
          fb.strokeRoundRect(px - pr, py - pr, pr * 2, pr * 2, 12, 4, [255, 218, 58, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.48), [255, 218, 58, 255]);
          fb.fillCircle(px, py, Math.round(pr * 0.22), [32, 24, 28, 255]);
        }
      }
      // 若为弹力拳击手的擂台角柱，额外绘制四角之间的三层高弹力红白金拳击围绳与紧绳扣
      const posts = props.filter((p) => p.kind === "ring_post");
      if (posts.length >= 2) {
        for (let i = 0; i < posts.length; i++) {
          const p0 = posts[i];
          const p1 = posts[(i + 1) % posts.length];
          const [x0, y0] = worldToScreen(p0.x, p0.y, cam, shx, shy);
          const [x1, y1] = worldToScreen(p1.x, p1.y, cam, shx, shy);
          const rdx = x1 - x0;
          const rdy = y1 - y0;
          const rlen = Math.max(1, Math.hypot(rdx, rdy));
          const rnx = (-rdy / rlen) * 8 * cam.zoom;
          const rny = (rdx / rlen) * 8 * cam.zoom;
          fb.drawLine(x0 - rnx, y0 - rny, x1 - rnx, y1 - rny, 5, [255, 42, 68, 225]);
          fb.drawLine(x0, y0, x1, y1, 4, [245, 248, 255, 235]);
          fb.drawLine(x0 + rnx, y0 + rny, x1 + rnx, y1 + rny, 5, [255, 212, 52, 225]);
        }
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

    // 1. 残影轨迹（极速黄骑士与外卖闪电侠额外拉出高燃氮气烈焰尾迹带）
    const isSpeedster = v.ballSkillKind === "rider_turbo" || v.ballSkillKind === "courier_box";
    let prevTx = sx;
    let prevTy = sy;
    for (let i = 0; i < v.trail.length; i++) {
      const tr = v.trail[i];
      tr.alpha *= isSpeedster ? 0.78 : 0.72;
      if (tr.alpha < 0.08) continue;
      const [tx, ty] = worldToScreen(tr.x, tr.y, cam, shx, shy);
      const trR = Math.round(44 * tr.bodyScale * cam.zoom);
      if (isSpeedster) {
        const ribbonW = Math.max(6, Math.round((28 - i * 5) * cam.zoom));
        fb.drawLine(prevTx, prevTy, tx, ty, ribbonW, [255, 118, 24, Math.round(tr.alpha * 145)]);
        fb.drawLine(prevTx, prevTy, tx, ty, Math.max(3, Math.round(ribbonW * 0.45)), [255, 242, 98, Math.round(tr.alpha * 195)]);
        prevTx = tx;
        prevTy = ty;
      } else {
        fb.fillCircle(tx, ty, trR, [r, g, b, Math.round(tr.alpha * 24)]);
      }
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

    // 终局高阶进化（>=4层）专属狂暴斗气外环 + 残血红光危机闪烁环
    if (v.alive && v.hp / v.maxHp <= 0.22) {
      const dangerPulse = 1 + 0.10 * Math.sin(tNow * 28);
      fb.strokeRing(sx, sy, Math.round(orbR * 1.26 * dangerPulse), 4, [255, 48, 72, 235]);
    } else if (v.rageStacks >= 4) {
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
      drawSkillBallAvatar(fb, v.ballSkillKind, sx, sy, orbR, v.facing, isHit, alphaVal, tNow, !v.alive);
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
  const clampTxtX = (x: number, pad = 185) => clamp(Math.round(x), AX + pad, AX + AW - pad);
  const clampTxtY = (y: number, padTop = 85, padBot = 75) => clamp(Math.round(y), AY + padTop, AY + AH - padBot);

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

        // 拳压主光束（0汉字干扰，纯粹靠霸道金色光束与冲击弧呈现）
        const beamLen = (190 + k * 340) * cam.zoom;
        const bx = sx + dirX * beamLen * 0.5;
        const by = sy + dirY * beamLen * 0.5;
        fb.fillRotatedRect(bx, by, beamLen, Math.round(42 * (1 - k * 0.4) * cam.zoom), ang, [255, 198, 52, Math.round(alpha * 0.72)]);
        fb.fillRotatedRect(bx, by, beamLen * 0.90, Math.round(18 * (1 - k * 0.4) * cam.zoom), ang, [255, 252, 225, alpha]);
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
      } else if (fx.kind === "railgunBeam") {
        // 雷电磁暴王「超载电磁炮」：贯穿全屏的高能蓝白电磁激光炮束 + 环绕爆裂电弧
        if (age > 0.46) continue;
        const k = age / 0.46;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const [tx, ty] = worldToScreen(fx.tx ?? fx.x, fx.ty ?? fx.y, cam, shx, shy);
        const dirX = fx.dirX ?? 1;
        const dirY = fx.dirY ?? 0;
        const ang = Math.atan2(dirY, dirX);
        const alpha = Math.round(255 * (1 - k));

        const beamLen = 960 * cam.zoom;
        const bx = sx + dirX * beamLen * 0.46;
        const by = sy + dirY * beamLen * 0.46;
        fb.fillRotatedRect(bx, by, beamLen, Math.round(46 * (1 - k * 0.45) * cam.zoom), ang, [28, 218, 255, Math.round(alpha * 0.76)]);
        fb.fillRotatedRect(bx, by, beamLen * 0.96, Math.round(20 * (1 - k * 0.45) * cam.zoom), ang, [235, 255, 255, alpha]);
        fb.strokeRing(tx, ty, Math.round((42 + 85 * k) * cam.zoom), 4, [95, 245, 255, alpha]);
      } else if (fx.kind === "frostNovaRing") {
        // 急冻冰霜王「绝对零度」：极寒冰雾光盘 + 双环扩散 + 12 道放射冰棱尖刺
        if (age > 0.52) continue;
        const k = age / 0.52;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const maxR = (fx.radius ?? 325) * cam.zoom;
        const r1 = Math.round(48 + (maxR - 48) * k);
        const r2 = Math.round(r1 * 0.72);
        const alpha = Math.round(245 * (1 - k));
        fb.drawGlowCircle(sx, sy, Math.round(r1 * 0.95), [58, 232, 255, Math.round(alpha * 0.36)]);
        fb.strokeRing(sx, sy, r1, Math.max(4, Math.round(8 * (1 - k * 0.4))), [82, 245, 255, alpha]);
        fb.strokeRing(sx, sy, r2, Math.max(2, Math.round(5 * (1 - k * 0.4))), [230, 255, 255, alpha]);
        for (let i = 0; i < 12; i++) {
          const ang = (i * Math.PI) / 6 + k * 0.35;
          const ix = sx + Math.cos(ang) * r1 * (i % 2 === 0 ? 1.0 : 0.78);
          const iy = sy + Math.sin(ang) * r1 * (i % 2 === 0 ? 1.0 : 0.78);
          fb.fillRotatedRect(
            ix,
            iy,
            Math.round((i % 2 === 0 ? 34 : 22) * (1 - k * 0.35) * cam.zoom),
            Math.round(9 * cam.zoom),
            ang,
            [225, 252, 255, alpha],
          );
        }
      } else if (fx.kind === "ultBurst") {
        // 12 位新英雄与极速黄骑士专属大招视觉（分 beam / rush / nova / storm 四种高辨识度呈现）
        if (age > 0.48) continue;
        const k = age / 0.48;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const [tx, ty] = worldToScreen(fx.tx ?? fx.x, fx.ty ?? fx.y, cam, shx, shy);
        const dirX = fx.dirX ?? 1;
        const dirY = fx.dirY ?? 0;
        const ang = Math.atan2(dirY, dirX);
        const alpha = Math.round(255 * (1 - k));
        const [cr, cg, cb] = fx.color;

        // 触发场地上己方机关道具/手里剑/伴舞分身与目标之间的高能连携光线
        const props = activeProps[fx.side] ?? [];
        for (let pi = 0; pi < Math.min(5, props.length); pi++) {
          const p = props[pi];
          const [px, py] = worldToScreen(p.x, p.y, cam, shx, shy);
          fb.drawLine(px, py, tx, ty, Math.max(3, Math.round(7 * (1 - k))), [cr, cg, cb, Math.round(alpha * 0.78)]);
          fb.drawLine(px, py, tx, ty, Math.max(1, Math.round(3 * (1 - k))), [255, 250, 220, Math.round(alpha * 0.85)]);
          fb.strokeRing(px, py, Math.round((28 + 46 * k) * cam.zoom), 3, [255, 240, 128, alpha]);
        }
        const shurikens = activeShurikens[fx.side] ?? [];
        for (let si = 0; si < Math.min(6, shurikens.length); si++) {
          const s = shurikens[si];
          const [px, py] = worldToScreen(s.x, s.y, cam, shx, shy);
          fb.drawLine(px, py, tx, ty, Math.max(2, Math.round(5 * (1 - k))), [cr, cg, cb, Math.round(alpha * 0.72)]);
        }

        if (fx.ultStyle === "beam") {
          const beamLen = 920 * cam.zoom;
          const bx = sx + dirX * beamLen * 0.45;
          const by = sy + dirY * beamLen * 0.45;
          fb.fillRotatedRect(bx, by, beamLen, Math.round(44 * (1 - k * 0.45) * cam.zoom), ang, [cr, cg, cb, Math.round(alpha * 0.78)]);
          fb.fillRotatedRect(bx, by, beamLen * 0.94, Math.round(18 * (1 - k * 0.45) * cam.zoom), ang, [245, 255, 255, alpha]);
          fb.strokeRing(tx, ty, Math.round((46 + 88 * k) * cam.zoom), 4, [cr, cg, cb, alpha]);
        } else if (fx.ultStyle === "rush") {
          const dist = (75 + k * 250) * cam.zoom;
          const cxp = sx + dirX * dist;
          const cyp = sy + dirY * dist;
          const rad = Math.round((64 + k * 92) * cam.zoom);
          fb.drawArc(cxp, cyp, rad, Math.max(5, Math.round(11 * (1 - k * 0.4))), ang - 0.9, ang + 0.9, [cr, cg, cb, alpha]);
          fb.drawArc(cxp, cyp, Math.round(rad * 0.82), Math.max(3, Math.round(6 * (1 - k * 0.4))), ang - 0.7, ang + 0.7, [255, 250, 210, alpha]);
          fb.drawLine(sx, sy, tx, ty, Math.max(6, Math.round(18 * (1 - k * 0.5))), [cr, cg, cb, Math.round(alpha * 0.75)]);
        } else if (fx.ultStyle === "storm") {
          const r1 = Math.round((48 + 260 * k) * cam.zoom);
          fb.strokeRing(tx, ty, r1, Math.max(4, Math.round(7 * (1 - k * 0.4))), [cr, cg, cb, alpha]);
          for (let i = 0; i < 8; i++) {
            const sa = (i * Math.PI) / 4 + k * 2.4;
            const x1 = tx + Math.cos(sa) * r1 * 0.45;
            const y1 = ty + Math.sin(sa) * r1 * 0.45;
            const x2 = tx + Math.cos(sa + 0.4) * r1;
            const y2 = ty + Math.sin(sa + 0.4) * r1;
            fb.drawLine(x1, y1, x2, y2, 4, [245, 252, 255, alpha]);
          }
        } else {
          // nova
          const r1 = Math.round((46 + 275 * k) * cam.zoom);
          fb.drawGlowCircle(tx, ty, Math.round(r1 * 0.85), [cr, cg, cb, Math.round(alpha * 0.34)]);
          fb.strokeRing(tx, ty, r1, Math.max(4, Math.round(8 * (1 - k * 0.4))), [cr, cg, cb, alpha]);
          fb.strokeRing(tx, ty, Math.round(r1 * 0.68), Math.max(2, Math.round(4 * (1 - k * 0.4))), [255, 248, 215, alpha]);
        }
      } else if (fx.kind === "propBurst") {
        // 召唤物 / 场地机关攻击高辨识度结果反馈：一眼看清「是哪个召唤物触发、怎么打中对手、爆出了什么效果」！
        if (age > 0.42) continue;
        const k = age / 0.42;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const [tx, ty] = worldToScreen(fx.tx ?? fx.x, fx.ty ?? fx.y, cam, shx, shy);
        const alpha = Math.round(250 * (1 - k));
        const [cr, cg, cb] = fx.color;
        const pk = fx.propKind ?? "";

        if (pk === "voodoo_effigy") {
          // 巫毒替身偶触发瞬间（高反差爆发）：草人爆开猩红咒印光环 + 粗壮紫红双股诅咒雷霆 + 巨型银针贯穿受击者！
          fb.drawGlowCircle(sx, sy, Math.round((48 + 56 * k) * cam.zoom), [255, 36, 108, Math.round(alpha * 0.65)]);
          fb.strokeRing(sx, sy, Math.round((32 + 72 * k) * cam.zoom), 5, [255, 48, 128, alpha]);
          const dx = tx - sx;
          const dy = ty - sy;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const nx = -dy / dist;
          const ny = dx / dist;
          const m1x = sx + dx * 0.33 + nx * 28 * cam.zoom;
          const m1y = sy + dy * 0.33 + ny * 28 * cam.zoom;
          const m2x = sx + dx * 0.66 - nx * 28 * cam.zoom;
          const m2y = sy + dy * 0.66 - ny * 28 * cam.zoom;
          fb.drawLine(sx, sy, m1x, m1y, 10, [255, 36, 98, alpha]);
          fb.drawLine(m1x, m1y, m2x, m2y, 10, [215, 42, 255, alpha]);
          fb.drawLine(m2x, m2y, tx, ty, 10, [255, 36, 98, alpha]);
          fb.drawLine(sx, sy, m1x, m1y, 4, [255, 245, 255, alpha]);
          fb.drawLine(m1x, m1y, m2x, m2y, 4, [255, 245, 255, alpha]);
          fb.drawLine(m2x, m2y, tx, ty, 4, [255, 245, 255, alpha]);
          // 巨型巫毒飞针直刺目标 + 受击者身上爆开猩红咒杀环
          const pinX = sx + dx * clamp(k * 1.45, 0, 1);
          const pinY = sy + dy * clamp(k * 1.45, 0, 1);
          const pinAng = Math.atan2(dy, dx);
          fb.fillRotatedRect(pinX, pinY, Math.round(58 * cam.zoom), Math.round(8 * cam.zoom), pinAng, [240, 248, 255, alpha]);
          fb.fillCircle(pinX - (dx / dist) * 24 * cam.zoom, pinY - (dy / dist) * 24 * cam.zoom, Math.round(11 * cam.zoom), [255, 38, 88, alpha]);
          fb.strokeRing(tx, ty, Math.round((92 - 36 * k) * cam.zoom), 5, [255, 42, 108, alpha]);
          fb.strokeRing(tx, ty, Math.round((56 + 44 * k) * cam.zoom), 3, [92, 255, 168, alpha]);
        } else if (pk === "fish_hook") {
          // 深海垂钓王鱼钩拽击：挂钩点巨型浪花爆裂 + 金青双色绷紧收线流光拉回本体！
          fb.drawGlowCircle(sx, sy, Math.round((38 + 56 * k) * cam.zoom), [32, 228, 255, Math.round(alpha * 0.50)]);
          fb.strokeRing(sx, sy, Math.round((26 + 78 * k) * cam.zoom), 5, [155, 248, 255, alpha]);
          fb.drawLine(sx, sy, tx, ty, Math.max(4, Math.round(8 * (1 - k * 0.4))), [255, 225, 78, alpha]);
          fb.drawLine(sx, sy, tx, ty, Math.max(2, Math.round(3 * (1 - k * 0.4))), [235, 255, 255, alpha]);
          for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4 + 0.2;
            const d = (24 + 62 * k) * cam.zoom;
            fb.fillCircle(sx + Math.cos(ang) * d, sy + Math.sin(ang) * d, Math.round(6 * (1 - k * 0.4) * cam.zoom), [185, 250, 255, alpha]);
          }
        } else if (pk === "bumper_arc" || pk === "bumper_peg") {
          // 街机弹珠王弹柱放电：弹柱大奖光环扩开 + 高压折线电弧劈向对手！
          fb.drawGlowCircle(sx, sy, Math.round((46 + 52 * k) * cam.zoom), [255, 232, 58, Math.round(alpha * 0.55)]);
          fb.strokeRing(sx, sy, Math.round((34 + 78 * k) * cam.zoom), 5, [255, 238, 72, alpha]);
          fb.strokeRing(sx, sy, Math.round((22 + 48 * k) * cam.zoom), 3, [58, 245, 255, alpha]);
          const dx = tx - sx;
          const dy = ty - sy;
          const dist = Math.max(1, Math.hypot(dx, dy));
          if (dist > 24) {
            const nx = -dy / dist;
            const ny = dx / dist;
            const m1x = sx + dx * 0.35 + nx * 18 * cam.zoom;
            const m1y = sy + dy * 0.35 + ny * 18 * cam.zoom;
            const m2x = sx + dx * 0.70 - nx * 18 * cam.zoom;
            const m2y = sy + dy * 0.70 - ny * 18 * cam.zoom;
            fb.drawLine(sx, sy, m1x, m1y, 6, [255, 238, 68, alpha]);
            fb.drawLine(m1x, m1y, m2x, m2y, 6, [58, 248, 255, alpha]);
            fb.drawLine(m2x, m2y, tx, ty, 6, [255, 238, 68, alpha]);
          }
        } else if (pk === "chili_bomb") {
          // 外卖闪电侠辣油盲盒爆破：原地红金烈焰火球爆炸 + 10 枚飞散火浪碎片（彻底解决盒子凭空消失看不清的问题）！
          const r1 = Math.round((28 + 96 * Math.pow(k, 0.72)) * cam.zoom);
          fb.drawGlowCircle(sx, sy, Math.round(r1 * 1.15), [255, 78, 22, Math.round(alpha * 0.68)]);
          fb.strokeRing(sx, sy, r1, Math.max(4, Math.round(8 * (1 - k * 0.5))), [255, 218, 58, alpha]);
          fb.strokeRing(sx, sy, Math.round(r1 * 0.62), Math.max(3, Math.round(5 * (1 - k * 0.5))), [255, 62, 32, alpha]);
          for (let i = 0; i < 10; i++) {
            const ang = (i * Math.PI * 2) / 10 + k * 0.6;
            const d = (20 + 88 * Math.pow(k, 0.75)) * cam.zoom;
            const px = sx + Math.cos(ang) * d;
            const py = sy + Math.sin(ang) * d;
            fb.fillRotatedRect(
              px,
              py,
              Math.round(18 * (1 - k * 0.4) * cam.zoom),
              Math.round(8 * (1 - k * 0.4) * cam.zoom),
              ang,
              i % 2 === 0 ? [255, 232, 72, alpha] : [255, 68, 28, alpha],
            );
          }
        } else if (pk === "milk_tea") {
          // 珍珠奶茶回血：翠绿奶油双环 + 升腾星芒
          const r1 = Math.round((24 + 68 * k) * cam.zoom);
          fb.drawGlowCircle(sx, sy, r1, [82, 252, 162, Math.round(alpha * 0.48)]);
          fb.strokeRing(sx, sy, r1, 4, [98, 255, 172, alpha]);
          for (let i = 0; i < 6; i++) {
            const ang = (i * Math.PI) / 3;
            const px = sx + Math.cos(ang) * (18 + 38 * k) * cam.zoom;
            const py = sy + Math.sin(ang) * (18 + 38 * k) * cam.zoom - 22 * k * cam.zoom;
            fb.fillCircle(px, py, Math.round(5 * cam.zoom), [235, 255, 220, alpha]);
          }
        } else if (pk === "wall_shatter" || pk === "brick_wall") {
          // 暴走拆迁队铁球破墙 / 撞墙：橙金震波环 + 10 块红砖碎石向四周崩飞！
          const r1 = Math.round((26 + 88 * Math.pow(k, 0.75)) * cam.zoom);
          fb.drawGlowCircle(sx, sy, r1, [255, 138, 36, Math.round(alpha * 0.50)]);
          fb.strokeRing(sx, sy, r1, 4, [255, 198, 68, alpha]);
          for (let i = 0; i < 10; i++) {
            const ang = (i * Math.PI * 2) / 10 + 0.15;
            const d = (18 + 82 * Math.pow(k, 0.78)) * cam.zoom;
            const px = sx + Math.cos(ang) * d;
            const py = sy + Math.sin(ang) * d;
            fb.fillRotatedRect(
              px,
              py,
              Math.round(18 * (1 - k * 0.35) * cam.zoom),
              Math.round(10 * (1 - k * 0.35) * cam.zoom),
              ang + k * 4,
              i % 2 === 0 ? [228, 72, 38, alpha] : [255, 188, 62, alpha],
            );
          }
        } else if (pk === "acid_puddle" || pk === "paint_splat" || pk === "roast_grill") {
          // 强酸毒池 / 街头涂鸦 / 炭火烤炉触发：高对比属性波纹喷发 + 8 颗飞溅液滴/火星直扑目标！
          const r1 = Math.round((32 + 78 * k) * cam.zoom);
          const colMain: RGBA =
            pk === "acid_puddle"
              ? [118, 255, 42, alpha]
              : pk === "paint_splat"
                ? [255, 48, 215, alpha]
                : [255, 118, 24, alpha];
          const colSub: RGBA =
            pk === "acid_puddle"
              ? [225, 255, 145, alpha]
              : pk === "paint_splat"
                ? [38, 245, 255, alpha]
                : [255, 236, 78, alpha];
          fb.drawGlowCircle(sx, sy, r1, [colMain[0], colMain[1], colMain[2], Math.round(alpha * 0.48)]);
          fb.strokeRing(sx, sy, r1, 4, colMain);
          for (let i = 0; i < 8; i++) {
            const ang = (i * Math.PI) / 4 + k * 0.5;
            const d = (22 + 68 * k) * cam.zoom;
            fb.fillCircle(
              sx + Math.cos(ang) * d,
              sy + Math.sin(ang) * d,
              Math.round(7 * (1 - k * 0.4) * cam.zoom),
              i % 2 === 0 ? colMain : colSub,
            );
          }
        } else {
          // 铁球重砸 / 飞砖 / 桌球 / 子陀螺 / 手里剑 / 伴舞分身 / 高压水柱：凌厉十字冲击星芒 + 扩散波纹
          const r1 = Math.round((24 + 74 * k) * cam.zoom);
          fb.drawGlowCircle(sx, sy, r1, [cr, cg, cb, Math.round(alpha * 0.46)]);
          fb.strokeRing(sx, sy, r1, 4, [cr, cg, cb, alpha]);
          if (age < 0.22) {
            const sk = 1 - age / 0.22;
            fb.fillRotatedRect(sx, sy, Math.round(86 * sk * cam.zoom), Math.round(8 * sk * cam.zoom), 0.35, [255, 250, 210, 245]);
            fb.fillRotatedRect(sx, sy, Math.round(86 * sk * cam.zoom), Math.round(8 * sk * cam.zoom), -1.22, [cr, cg, cb, 245]);
          }
        }
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
        // 受击冲击波与火花：外扩清晰受击光环 + 放射高能火星，让每一次技能或召唤物命中都有扎实打击感
        if (age > 0.30) continue;
        const k = age / 0.30;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const burstScale = (fx.big ? 1.28 : 0.96) * cam.zoom;
        const alpha = Math.round(240 * (1 - k));
        if (fx.big && age < 0.14) {
          fb.drawGlowCircle(px, py, Math.round(64 * burstScale * (1 - age / 0.14)), [fx.color[0], fx.color[1], fx.color[2], Math.round(160 * (1 - age / 0.14))]);
        }
        fb.strokeRing(px, py, Math.round((24 + 58 * k) * burstScale), Math.max(2, Math.round(4 * (1 - k * 0.5))), [fx.color[0], fx.color[1], fx.color[2], Math.round(alpha * 0.85)]);
        const count = isSkillBallMode ? (fx.big ? 10 : 7) : 12;
        for (let i = 0; i < count; i++) {
          const ang = (i * Math.PI * 2) / count + fx.t0 * 11.7;
          const spd = (84 + (i % 3) * 44) * burstScale;
          const dist = spd * Math.pow(k, 0.68);
          const x1 = px + Math.cos(ang) * dist * 0.54;
          const y1 = py + Math.sin(ang) * dist * 0.54;
          const x2 = px + Math.cos(ang) * dist;
          const y2 = py + Math.sin(ang) * dist;
          const col: RGBA = i % 2 === 0 ? [255, 244, 168, alpha] : [fx.color[0], fx.color[1], fx.color[2], alpha];
          fb.drawLine(x1, y1, x2, y2, 4, col);
        }
      } else if (fx.kind === "killExplosion") {
        // 绝杀爆裂光波 + 22 枚飞散晶格碎片 + 「终极绝杀!!」高光跳字
        if (age > 0.88) continue;
        const k = age / 0.88;
        const [px, py] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const alpha = Math.round(255 * (1 - k));
        const r1 = Math.round((42 + 295 * Math.pow(k, 0.72)) * cam.zoom);
        const r2 = Math.round(r1 * 0.68);
        fb.strokeRing(px, py, r1, Math.max(4, Math.round(10 * (1 - k * 0.6))), [255, 228, 86, alpha]);
        fb.strokeRing(px, py, r2, Math.max(3, Math.round(6 * (1 - k * 0.6))), [fx.color[0], fx.color[1], fx.color[2], alpha]);
        for (let i = 0; i < 20; i++) {
          const ang = (i * Math.PI * 2) / 20 + k * 0.45;
          const dist = (45 + (i % 3) * 36 + k * 255) * cam.zoom;
          const sxp = px + Math.cos(ang) * dist;
          const syp = py + Math.sin(ang) * dist;
          const col: RGBA = i % 2 === 0 ? [255, 236, 108, alpha] : [fx.color[0], fx.color[1], fx.color[2], alpha];
          fb.fillRotatedRect(sxp, syp, Math.round(24 * (1 - k * 0.45)), Math.round(9 * (1 - k * 0.45)), ang + k * 4, col);
        }
        const popScale = easeOutBack(clamp(age / 0.16, 0, 1));
        drawFit(
          fb,
          atlasBig,
          fx.text,
          clampTxtX(px, 195),
          clampTxtY(py - Math.round((96 + 44 * k) * cam.zoom), 85, 90),
          [255, 236, 88, alpha],
          420,
          0.66 * popScale,
          "center",
          4,
        );
      } else if (fx.kind === "dmg") {
        if (age > 0.62) continue;
        // 严格单角色唯一数字（Single Active Counter）：同一受击角色头顶永远最多只显示最新的 1 个合并纯数字，彻底告别多行堆叠！
        let hasNewer = false;
        for (const other of fxList) {
          if (other !== fx && other.kind === "dmg" && other.side === fx.side && other.t0 > fx.t0 && other.t0 <= tb) {
            hasNewer = true;
            break;
          }
        }
        if (hasNewer) continue;

        const k = age / 0.62;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const pop = age < 0.14 ? easeOutBack(age / 0.14) : 1 - (age - 0.14) * 0.15;
        const alpha = age > 0.42 ? Math.round(255 * (1 - (age - 0.42) / 0.20)) : 255;
        const baseScale = fx.big ? 0.68 : 0.56;
        drawFit(
          fb,
          atlas,
          fx.text,
          clampTxtX(sx, 145),
          clampTxtY(sy - Math.round(52 * k), 72, 68),
          [fx.color[0], fx.color[1], fx.color[2], alpha],
          260,
          baseScale * pop,
          "center",
          3,
        );
      } else if (fx.kind === "heal") {
        // 纯视觉回血替代方案（0汉字）：3枚翡翠「+」十字几何粒子上浮 + 翠绿复苏脉冲光环！
        if (age > 0.54) continue;
        const k = age / 0.54;
        const [sx, sy] = worldToScreen(fx.x, fx.y, cam, shx, shy);
        const alpha = Math.round(245 * (1 - k));
        fb.strokeRing(sx, sy, Math.round((36 + 52 * k) * cam.zoom), 3, [78, 255, 158, Math.round(alpha * 0.78)]);
        const offsets: Array<[number, number, number]> = [
          [-36, -24, 1.0],
          [36, -16, 0.88],
          [0, -52, 1.18],
        ];
        for (let i = 0; i < offsets.length; i++) {
          const [ox, oy, sc] = offsets[i];
          const px = sx + Math.round(ox * cam.zoom);
          const py = sy + Math.round((oy - 56 * k - i * 8) * cam.zoom);
          const arm = Math.round(11 * sc * cam.zoom);
          const thick = Math.max(3, Math.round(4.5 * sc * cam.zoom));
          fb.fillRoundRect(px - arm, py - Math.floor(thick / 2), arm * 2, thick, 2, [72, 255, 158, alpha]);
          fb.fillRoundRect(px - Math.floor(thick / 2), py - arm, thick, arm * 2, 2, [72, 255, 158, alpha]);
          fb.fillCircle(px, py, Math.max(2, Math.round(2.5 * sc * cam.zoom)), [235, 255, 245, alpha]);
        }
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

  // ---------- 5. 底部留白暗角区 (Y: 1555..1920)：不显示任何文字解说字幕 ----------
  const drawBottomCleanZone = (fb: FrameBuf, _tb: number) => {
    fb.blendGradientRect(0, 1555, W, H - 1555, [8, 7, 16, 40], [4, 3, 10, 235], true);
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
        ? "★ 赛博斗球场 · 开局大招直接对轰 ★"
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
      // 首帧 (tNow = 0) 100% 满配定格到位，确保视频号默认第 0 帧封面即为完整高清 VS 海报！
      const baseX = isLeft ? 36 : W - 36 - cardW;
      const x = baseX;
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

    // 中央巨型 VS 徽章在首帧 (tNow = 0) 即完全就位，确保第 0 帧封面拥有完整视觉焦点
    {
      const vsPop = 1.0;
      const vcx = W / 2;
      const vcy = 760;
      if (tNow < 0.25) {
        const rk = tNow / 0.25;
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
          v.ghostHoldT = Math.max(0, v.ghostHoldT - dt);
          v.barShakeT = Math.max(0, v.barShakeT - dt);
          v.healFlashT = Math.max(0, v.healFlashT - dt);
          if (!v.alive) {
            // 败方被绝杀后向远离胜者方向慢动作击飞弹墙（搭配 X_X 眩晕眼，彻底告别原地僵立与瞬间消失！）
            v.x += v.vx * dt * 0.48;
            v.y += v.vy * dt * 0.48;
            v.vx *= 0.96;
            v.vy *= 0.96;
            const rLim = 72;
            if (v.x < rLim) {
              v.x = rLim;
              v.vx = Math.abs(v.vx) * 0.75;
              v.wallSquashT = 0.14;
              v.wallOrient = Math.PI * 0.5;
            } else if (v.x > ARENA_W - rLim) {
              v.x = ARENA_W - rLim;
              v.vx = -Math.abs(v.vx) * 0.75;
              v.wallSquashT = 0.14;
              v.wallOrient = Math.PI * 0.5;
            }
            if (v.y < rLim) {
              v.y = rLim;
              v.vy = Math.abs(v.vy) * 0.75;
              v.wallSquashT = 0.14;
              v.wallOrient = 0;
            } else if (v.y > ARENA_H - rLim) {
              v.y = ARENA_H - rLim;
              v.vy = -Math.abs(v.vy) * 0.75;
              v.wallSquashT = 0.14;
              v.wallOrient = 0;
            }
          } else if (v.action !== "walk" && v.actionAge > 0.38) {
            v.action = "walk";
          }
          if (v.ghostHp > v.hp) {
            if (v.ghostHoldT <= 0) {
              v.ghostHp = Math.max(v.hp, v.ghostHp - (v.ghostHp - v.hp) * 0.16 - 2.2);
            }
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

      // 7. K.O. 决胜横幅（延后至 deathEv.t + 0.58s 弹出，先把最后 0.58 秒绝杀大招、爆裂碎片与败方 X_X 击飞撞墙完整呈现给观众！）
      const deathEv = events.find(e => e.type === "death") as Extract<SimEvent, { type: "death" }> | undefined;
      if (deathEv && tb >= deathEv.t + 0.58 && tb <= battleSec && endEv) {
        const winner = byId[endEv.winner];
        const koAge = tb - (deathEv.t + 0.58);
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

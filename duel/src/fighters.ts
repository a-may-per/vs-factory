// 对阵英雄池：支持双模式生产
// 1. weapon（环绕武器进化模式）：巨剑变长 / 双剑加速 / 雷锤分裂 / 巨斧狂化
// 2. skillball（机制小球 & 抽象英雄技能模式）：吸血鬼碰撞寄生吸附 vs 蜘蛛王吐丝封路 / 一拳光头认真一拳 vs 广场舞老太高音伴舞
import type { FighterConfig } from "./sim.ts";

export const VAMPIRE: FighterConfig = {
  id: "A",
  name: "南瓜骑士",
  title: "万圣巨剑",
  maxHp: 940,
  speed: 345,
  contactRange: 168,
  color: "#ff3358",
  color2: "#9e1432",
  passiveKind: "lifesteal",
  passive: { name: "噬血巨剑", description: "每次命中剑长+20%并汲取生命" },
  active: {
    name: "巨剑重斩",
    cooldown: 0.34,
    damage: 155,
    rangeMul: 1,
    fx: "bolt",
    description: "环绕巨剑重斩，越战剑身越长",
  },
  style: "balanced",
  weaponKind: "greatsword",
  scaleKind: "reach",
  baseReach: 192,
  baseSpinSpeed: 6.6,
  baseBlades: 1,
  hookRule: "★ 命中剑长+20% · 吸血恢复 ★",
};

export const BERSERKER: FighterConfig = {
  id: "B",
  name: "火焰史莱姆",
  title: "狂暴双剑",
  maxHp: 960,
  speed: 358,
  contactRange: 142,
  color: "#1ca8ff",
  color2: "#0e569e",
  passiveKind: "rage",
  passive: { name: "狂暴双剑", description: "每次命中双剑转速+32%伤害递增" },
  active: {
    name: "旋风双剑",
    cooldown: 0.28,
    damage: 148,
    rangeMul: 1,
    fx: "whirl",
    description: "高速旋转双剑连斩，越打转速越快",
  },
  style: "aggressive",
  weaponKind: "twinblade",
  scaleKind: "spin",
  baseReach: 148,
  baseSpinSpeed: 8.4,
  baseBlades: 2,
  hookRule: "★ 命中转速+32% · 伤害递增 ★",
};

export const FROST_KNIGHT: FighterConfig = {
  ...VAMPIRE,
  id: "A",
  name: "冰霜剑圣",
  title: "极速飞剑",
  maxHp: 950,
  speed: 362,
  color: "#00dcff",
  color2: "#095e82",
  passiveKind: "lifesteal",
  passive: { name: "冰霜双剑", description: "命中后双剑极限加速并汲取生命" },
  active: {
    name: "冰霜连斩",
    cooldown: 0.28,
    damage: 146,
    rangeMul: 1,
    fx: "bolt",
    description: "冰霜双剑高速环绕连斩",
  },
  weaponKind: "twinblade",
  scaleKind: "spin",
  baseReach: 158,
  baseSpinSpeed: 8.6,
  baseBlades: 2,
  hookRule: "★ 命中转速+32% · 冰霜吸血 ★",
};

export const THUNDER_SLIME: FighterConfig = {
  ...BERSERKER,
  id: "B",
  name: "雷电魔像",
  title: "超载雷锤",
  maxHp: 980,
  speed: 342,
  color: "#ffb018",
  color2: "#995608",
  passiveKind: "rage",
  passive: { name: "雷锤分裂", description: "每次进化新增环绕雷电战锤" },
  active: {
    name: "超载雷锤",
    cooldown: 0.32,
    damage: 158,
    rangeMul: 1,
    fx: "whirl",
    description: "召唤环绕雷锤轰击对手",
  },
  weaponKind: "hammer",
  scaleKind: "multiweapon",
  baseReach: 154,
  baseSpinSpeed: 7.2,
  baseBlades: 1,
  hookRule: "★ 命中分裂旋转雷锤 · 满屏轰击 ★",
};

export const BLOOD_REAPER: FighterConfig = {
  ...VAMPIRE,
  id: "A",
  name: "猩红死神",
  title: "噬血巨斧",
  maxHp: 960,
  speed: 348,
  color: "#ff2852",
  color2: "#8f0e28",
  passiveKind: "lifesteal",
  passive: { name: "巨斧狂化", description: "每次命中巨斧巨大化并汲取生命" },
  active: {
    name: "猩红重斩",
    cooldown: 0.34,
    damage: 162,
    rangeMul: 1,
    fx: "bolt",
    description: "巨大化猩红战斧横扫全场",
  },
  weaponKind: "scythe",
  scaleKind: "titan",
  baseReach: 188,
  baseSpinSpeed: 6.6,
  baseBlades: 1,
  hookRule: "★ 命中巨斧变大 · 狂暴吸血 ★",
};

export const SHADOW_LORD: FighterConfig = {
  ...BERSERKER,
  id: "B",
  name: "暗影魔王",
  title: "猛毒双匕",
  maxHp: 950,
  speed: 365,
  color: "#22e884",
  color2: "#0e6b38",
  passiveKind: "rage",
  passive: { name: "暗影双匕", description: "每次命中分裂暗影双匕并叠加伤害" },
  active: {
    name: "猛毒连斩",
    cooldown: 0.28,
    damage: 150,
    rangeMul: 1,
    fx: "whirl",
    description: "高速环绕猛毒双匕切割",
  },
  weaponKind: "twinblade",
  scaleKind: "multiweapon",
  baseReach: 152,
  baseSpinSpeed: 8.2,
  baseBlades: 2,
  hookRule: "★ 命中分裂暗影双匕 · 攻速提升 ★",
};

// ====================================================================
// 机制小球 / 抽象英雄技能模式 (Skill-Ball Mode: combatMode === "skillball")
// 不靠环绕冷兵器拼刀，而是靠小球自身的物理动词（碰撞寄生吸附 / 吐丝结网 / 认真一拳 / 外放高音伴舞）交互博弈
// ====================================================================

export const VAMPIRE_BALL: FighterConfig = {
  id: "A",
  name: "鲜血吸血鬼",
  title: "寄生血蝠",
  maxHp: 1720,
  speed: 392,
  contactRange: 120,
  color: "#ff2450",
  color2: "#8a0c28",
  passiveKind: "lifesteal",
  passive: { name: "血蛭寄生", description: "每次寄生延长吸附时间，贴身狂咬吸血" },
  active: {
    name: "血族獠牙",
    cooldown: 0.42,
    damage: 145,
    rangeMul: 1,
    fx: "bolt",
    description: "挂在敌人身上高频撕咬吸血",
  },
  style: "aggressive",
  combatMode: "skillball",
  ballSkillKind: "vampire_latch",
  hookRule: "★ 碰撞死死吸附 · 高频咬血爆发 ★",
};

export const SPIDER_BALL: FighterConfig = {
  id: "B",
  name: "剧毒蜘蛛王",
  title: "盘丝洞主",
  maxHp: 1680,
  speed: 374,
  contactRange: 120,
  color: "#24e888",
  color2: "#0d6e42",
  passiveKind: "rage",
  passive: { name: "盘丝毒网", description: "场内同存14根耐磨毒丝，不断线反复弹射割血" },
  active: {
    name: "织网切割",
    cooldown: 0.42,
    damage: 142,
    rangeMul: 1,
    fx: "whirl",
    description: "全屏拉满弹性毒丝封锁走位",
  },
  style: "balanced",
  combatMode: "skillball",
  ballSkillKind: "spider_web",
  hookRule: "★ 弹墙吐丝结网 · 路过弹射割血 ★",
};

export const ONE_PUNCH_BALL: FighterConfig = {
  id: "A",
  name: "一拳光头",
  title: "认真一拳",
  maxHp: 1960,
  speed: 370,
  contactRange: 125,
  color: "#ffbe18",
  color2: "#b8450a",
  passiveKind: "rage",
  passive: { name: "极限蓄力", description: "移动弹墙充能，蓄满轰飞触发撞墙重伤" },
  active: {
    name: "认真一拳",
    cooldown: 0.50,
    damage: 210,
    rangeMul: 1,
    fx: "bolt",
    description: "一拳轰飞对手触发连环撞墙粉碎",
  },
  style: "aggressive",
  combatMode: "skillball",
  ballSkillKind: "one_punch",
  hookRule: "★ 蓄满认真一拳 · 撞墙碎地重伤 ★",
};

export const DANCE_GRANNY_BALL: FighterConfig = {
  id: "B",
  name: "广场舞老太",
  title: "高音霸主",
  maxHp: 1940,
  speed: 362,
  contactRange: 125,
  color: "#ff38b8",
  color2: "#781470",
  passiveKind: "lifesteal",
  passive: { name: "摇人伴舞", description: "音响震退全场，召唤5名伴舞大妈围攻" },
  active: {
    name: "高音震波",
    cooldown: 0.45,
    damage: 140,
    rangeMul: 1,
    fx: "whirl",
    description: "环形声波震退扣血，受重击触发碰瓷反伤",
  },
  style: "balanced",
  combatMode: "skillball",
  ballSkillKind: "dance_granny",
  hookRule: "★ 外放高音震波 · 召唤5人伴舞团 ★",
};

export const ALL_FIGHTERS: FighterConfig[] = [
  VAMPIRE_BALL,
  SPIDER_BALL,
  ONE_PUNCH_BALL,
  DANCE_GRANNY_BALL,
  VAMPIRE,
  BERSERKER,
  FROST_KNIGHT,
  THUNDER_SLIME,
  BLOOD_REAPER,
  SHADOW_LORD,
];

export interface DuelMatchupPreset {
  id: string;
  title: string;
  fighterA: FighterConfig;
  fighterB: FighterConfig;
  hook: string;
  mode: "skillball" | "weapon";
}

export const SKILLBALL_MATCHUPS: DuelMatchupPreset[] = [
  {
    id: "vampire_vs_spider",
    title: "鲜血吸血鬼 VS 剧毒蜘蛛王",
    fighterA: { ...VAMPIRE_BALL, id: "A", color: "#ff2450", color2: "#8a0c28" },
    fighterB: { ...SPIDER_BALL, id: "B", color: "#24e888", color2: "#0d6e42" },
    hook: "碰撞吸附咬血 VS 满屏吐丝扣血，谁能活到最后？",
    mode: "skillball",
  },
  {
    id: "onepunch_vs_granny",
    title: "一拳光头 VS 广场舞老太",
    fighterA: { ...ONE_PUNCH_BALL, id: "A", color: "#ffbe18", color2: "#b8450a" },
    fighterB: { ...DANCE_GRANNY_BALL, id: "B", color: "#ff38b8", color2: "#781470" },
    hook: "一拳光头 VS 广场舞老太，认真一拳能轰穿大妈团吗？",
    mode: "skillball",
  },
  {
    id: "vampire_vs_granny",
    title: "鲜血吸血鬼 VS 广场舞老太",
    fighterA: { ...VAMPIRE_BALL, id: "A", color: "#ff2450", color2: "#8a0c28" },
    fighterB: { ...DANCE_GRANNY_BALL, id: "B", color: "#22d8ff", color2: "#0e5c8a" },
    hook: "吸血鬼贴身咬血 VS 广场舞大妈外放震波，谁更离谱？",
    mode: "skillball",
  },
  {
    id: "onepunch_vs_spider",
    title: "一拳光头 VS 剧毒蜘蛛王",
    fighterA: { ...ONE_PUNCH_BALL, id: "A", color: "#ffbe18", color2: "#b8450a" },
    fighterB: { ...SPIDER_BALL, id: "B", color: "#24e888", color2: "#0d6e42" },
    hook: "认真一拳撞墙粉碎 VS 盘丝洞天罗地网，谁能活到最后？",
    mode: "skillball",
  },
];

export const WEAPON_MATCHUPS: DuelMatchupPreset[] = [
  {
    id: "frost_vs_thunder",
    title: "冰霜剑圣 VS 雷电魔像",
    fighterA: { ...FROST_KNIGHT, id: "A", color: "#00dcff", color2: "#095e82" },
    fighterB: { ...THUNDER_SLIME, id: "B", color: "#ffb018", color2: "#995608" },
    hook: "极速冰霜双剑 VS 满屏旋转雷锤，谁能活到最后？",
    mode: "weapon",
  },
  {
    id: "reaper_vs_shadow",
    title: "猩红死神 VS 暗影魔王",
    fighterA: { ...BLOOD_REAPER, id: "A", color: "#ff2852", color2: "#8f0e28" },
    fighterB: { ...SHADOW_LORD, id: "B", color: "#22e884", color2: "#0e6b38" },
    hook: "噬血狂化巨斧 VS 暗影分裂双匕，谁能活到最后？",
    mode: "weapon",
  },
  {
    id: "pumpkin_vs_thunder",
    title: "南瓜骑士 VS 雷电魔像",
    fighterA: { ...VAMPIRE, id: "A", color: "#ff3358", color2: "#9e1432" },
    fighterB: { ...THUNDER_SLIME, id: "B", color: "#22b8ff", color2: "#1062a8" },
    hook: "巨剑无限变长 VS 满层雷电战锤，谁能活到最后？",
    mode: "weapon",
  },
  {
    id: "frost_vs_reaper",
    title: "猩红死神 VS 冰霜剑圣",
    fighterA: { ...BLOOD_REAPER, id: "A", color: "#ff2852", color2: "#8f0e28" },
    fighterB: { ...FROST_KNIGHT, id: "B", color: "#00dcff", color2: "#095e82" },
    hook: "无限吸血巨斧 VS 极速冰霜飞剑，谁能活到最后？",
    mode: "weapon",
  },
  {
    id: "pumpkin_vs_shadow",
    title: "南瓜骑士 VS 暗影魔王",
    fighterA: { ...VAMPIRE, id: "A", color: "#ff3358", color2: "#9e1432" },
    fighterB: { ...SHADOW_LORD, id: "B", color: "#22e884", color2: "#0e6b38" },
    hook: "万圣噬血巨剑 VS 暗影猛毒双匕，谁能活到最后？",
    mode: "weapon",
  },
  {
    id: "pumpkin_vs_slime",
    title: "南瓜骑士 VS 火焰史莱姆",
    fighterA: { ...VAMPIRE, id: "A", color: "#ff3358", color2: "#9e1432" },
    fighterB: { ...BERSERKER, id: "B", color: "#1ca8ff", color2: "#0e569e" },
    hook: "巨剑无限变长 VS 双剑无限加速，谁能活到最后？",
    mode: "weapon",
  },
];

export const DUEL_MATCHUPS: DuelMatchupPreset[] = [
  ...SKILLBALL_MATCHUPS,
  ...WEAPON_MATCHUPS,
];

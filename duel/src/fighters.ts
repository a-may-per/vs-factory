// 对阵英雄池：支持单场默认对局与批量短视频多阵容轮换生产。
// 采用“环绕进化武器碰撞”（Weapon Ball / Earclacks）爽感机制：
// 武器交锋触发弹刀火花，斩中本体触发肉眼可见的武器进化（剑长暴涨 / 转速飙升 / 雷锤分裂 / 巨斧狂化）。
import type { FighterConfig } from "./sim.ts";

export const VAMPIRE: FighterConfig = {
  id: "A",
  name: "南瓜骑士",
  title: "万圣巨剑",
  maxHp: 920,
  speed: 285,
  contactRange: 168,
  color: "#ff3358",
  color2: "#9e1432",
  passiveKind: "lifesteal",
  passive: { name: "噬血巨剑", description: "每次命中剑长+20%并汲取生命" },
  active: {
    name: "巨剑重斩",
    cooldown: 0.44,
    damage: 155,
    rangeMul: 1,
    fx: "bolt",
    description: "环绕巨剑重斩，越战剑身越长",
  },
  style: "balanced",
  weaponKind: "greatsword",
  scaleKind: "reach",
  baseReach: 190,
  baseSpinSpeed: 5.8,
  baseBlades: 1,
  hookRule: "★ 命中剑长+20% · 吸血恢复",
};

export const BERSERKER: FighterConfig = {
  id: "B",
  name: "火焰史莱姆",
  title: "狂暴双剑",
  maxHp: 950,
  speed: 295,
  contactRange: 138,
  color: "#1ca8ff",
  color2: "#0e569e",
  passiveKind: "rage",
  passive: { name: "狂暴双剑", description: "每次命中双剑转速+32%伤害递增" },
  active: {
    name: "旋风双剑",
    cooldown: 0.42,
    damage: 148,
    rangeMul: 1,
    fx: "whirl",
    description: "高速旋转双剑连斩，越打转速越快",
  },
  style: "aggressive",
  weaponKind: "twinblade",
  scaleKind: "spin",
  baseReach: 138,
  baseSpinSpeed: 7.4,
  baseBlades: 2,
  hookRule: "★ 命中转速+32% · 伤害递增",
};

export const FROST_KNIGHT: FighterConfig = {
  ...VAMPIRE,
  id: "A",
  name: "冰霜剑圣",
  title: "极速飞剑",
  maxHp: 940,
  speed: 300,
  color: "#ff3864",
  color2: "#991538",
  passive: { name: "冰霜双剑", description: "命中后双剑极限加速并汲取生命" },
  active: {
    name: "冰霜连斩",
    cooldown: 0.42,
    damage: 146,
    rangeMul: 1,
    fx: "bolt",
    description: "冰霜双剑高速环绕连斩",
  },
  weaponKind: "twinblade",
  scaleKind: "spin",
  baseReach: 154,
  baseSpinSpeed: 7.8,
  baseBlades: 2,
  hookRule: "★ 命中转速+32% · 冰霜吸血",
};

export const THUNDER_SLIME: FighterConfig = {
  ...BERSERKER,
  id: "B",
  name: "雷电魔像",
  title: "超载雷锤",
  maxHp: 960,
  speed: 280,
  color: "#22b8ff",
  color2: "#1062a8",
  passive: { name: "雷锤分裂", description: "每次进化新增环绕雷电战锤" },
  active: {
    name: "超载雷锤",
    cooldown: 0.45,
    damage: 158,
    rangeMul: 1,
    fx: "whirl",
    description: "召唤环绕雷锤轰击对手",
  },
  weaponKind: "hammer",
  scaleKind: "multiweapon",
  baseReach: 146,
  baseSpinSpeed: 6.4,
  baseBlades: 1,
  hookRule: "★ 命中分裂旋转雷锤 · 满屏轰击",
};

export const BLOOD_REAPER: FighterConfig = {
  ...VAMPIRE,
  id: "A",
  name: "猩红死神",
  title: "噬血巨斧",
  maxHp: 950,
  speed: 282,
  color: "#ff2e55",
  color2: "#8f1029",
  passive: { name: "巨斧狂化", description: "每次命中巨斧巨大化并汲取生命" },
  active: {
    name: "猩红重斩",
    cooldown: 0.46,
    damage: 162,
    rangeMul: 1,
    fx: "bolt",
    description: "巨大化猩红战斧横扫全场",
  },
  weaponKind: "scythe",
  scaleKind: "titan",
  baseReach: 186,
  baseSpinSpeed: 5.8,
  baseBlades: 1,
  hookRule: "★ 命中巨斧变大 · 狂暴吸血",
};

export interface DuelMatchupPreset {
  id: string;
  title: string;
  fighterA: FighterConfig;
  fighterB: FighterConfig;
  hook: string;
}

export const DUEL_MATCHUPS: DuelMatchupPreset[] = [
  {
    id: "pumpkin_vs_slime",
    title: "南瓜骑士 VS 火焰史莱姆",
    fighterA: VAMPIRE,
    fighterB: BERSERKER,
    hook: "巨剑无限变长 VS 双剑无限加速，谁能活到最后？",
  },
  {
    id: "frost_vs_thunder",
    title: "冰霜剑圣 VS 雷电魔像",
    fighterA: FROST_KNIGHT,
    fighterB: THUNDER_SLIME,
    hook: "极速冰霜双剑 VS 满屏旋转雷锤，谁能活到最后？",
  },
  {
    id: "pumpkin_vs_thunder",
    title: "猩红死神 VS 雷电魔像",
    fighterA: BLOOD_REAPER,
    fighterB: THUNDER_SLIME,
    hook: "无限吸血巨斧 VS 满层雷电战锤，谁能活到最后？",
  },
];

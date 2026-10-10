// 首期对阵：吸血鬼 vs 狂战士。
// 英雄没有普通攻击；接触后直接释放主动技能，被动只改变技能结果。
import type { FighterConfig } from "./sim.ts";

export const VAMPIRE: FighterConfig = {
  id: "A",
  name: "夜伯爵",
  title: "不眠血裔",
  maxHp: 780,
  speed: 240,
  contactRange: 145,
  color: "#b3223a",
  color2: "#5a1440",
  passiveKind: "lifesteal",
  passive: { name: "鲜血汲取", description: "血影突袭命中后恢复造成伤害的 30%" },
  active: {
    name: "血影突袭", cooldown: 2.8, damage: 150, rangeMul: 1,
    fx: "bolt", description: "接触后突进斩击，命中后触发技能吸血",
  },
  style: "balanced",
};

export const BERSERKER: FighterConfig = {
  id: "B",
  name: "断岳",
  title: "血性狂徒",
  maxHp: 820,
  speed: 220,
  contactRange: 145,
  color: "#e07820",
  color2: "#7a4014",
  passiveKind: "rage",
  passive: { name: "狂暴蓄力", description: "每次裂地重斩后蓄力，下一次技能伤害提升" },
  active: {
    name: "裂地重斩", cooldown: 3.2, damage: 165, rangeMul: 1,
    fx: "whirl", description: "接触后重斩并击退，狂暴蓄力后更强",
  },
  style: "aggressive",
};

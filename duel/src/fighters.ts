// 首期对阵：吸血鬼 vs 狂战士。
// 英雄没有普通攻击；接触后直接释放主动技能，被动只改变技能结果。
import type { FighterConfig } from "./sim.ts";

export const VAMPIRE: FighterConfig = {
  id: "A",
  name: "南瓜骑士",
  title: "万圣游侠",
  maxHp: 780,
  speed: 240,
  contactRange: 145,
  color: "#b3223a",
  color2: "#5a1440",
  passiveKind: "lifesteal",
  passive: { name: "南瓜护盾", description: "技能命中后获得短暂护盾" },
  active: {
    name: "南瓜冲锋", cooldown: 2.8, damage: 150, rangeMul: 1,
    fx: "bolt", description: "接触后冲锋斩击，命中后弹开",
  },
  style: "balanced",
};

export const BERSERKER: FighterConfig = {
  id: "B",
  name: "火焰史莱姆",
  title: "熔岩弹弹",
  maxHp: 820,
  speed: 220,
  contactRange: 145,
  color: "#e07820",
  color2: "#7a4014",
  passiveKind: "rage",
  passive: { name: "火焰蓄力", description: "每次火焰技能命中后，下一次技能更强" },
  active: {
    name: "熔岩爆弹", cooldown: 3.2, damage: 165, rangeMul: 1,
    fx: "whirl", description: "接触后爆发火焰并击退，蓄力后更强",
  },
  style: "aggressive",
};

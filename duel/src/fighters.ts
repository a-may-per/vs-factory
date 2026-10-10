// 首期对阵：吸血鬼 vs 狂战士（参数化角色，后续新角色只是新配置对象）
import type { FighterConfig } from "./sim.ts";

export const VAMPIRE: FighterConfig = {
  id: "A",
  name: "夜伯爵",
  title: "不眠血裔",
  maxHp: 900,
  attack: 22,
  speed: 150,
  attackRange: 95,
  attackInterval: 0.85,
  color: "#b3223a",
  color2: "#5a1440",
  passiveKind: "lifesteal",
  passive: { name: "鲜血汲取", description: "造成伤害的 45% 转化为回血" },
  active: {
    name: "血影突袭", cooldown: 5, damage: 34, rangeMul: 1.4,
    fx: "bolt", description: "暗影突进，造成 34 点伤害并吸血",
  },
  style: "balanced",
};

export const BERSERKER: FighterConfig = {
  id: "B",
  name: "断岳",
  title: "血性狂徒",
  maxHp: 950,
  attack: 26,
  speed: 130,
  attackRange: 105,
  attackInterval: 1.25,
  color: "#e07820",
  color2: "#7a4014",
  passiveKind: "rage",
  passive: { name: "狂暴", description: "生命越低 攻速越快 可叠加" },
  active: {
    name: "裂地重斩", cooldown: 6, damage: 42, rangeMul: 1.2,
    fx: "whirl", description: "蓄力重斩，造成 42 点高额伤害",
  },
  style: "aggressive",
};

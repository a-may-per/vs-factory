// duel 一键流水线：模拟 → 事件日志 → 渲染 → 成片
// 用法:
//   npx tsx duel/run.ts [seed] [--a <heroA> --b <heroB>] [--matchup <id|index>] [--cold-open]
// 示例:
//   npx tsx duel/run.ts 808 --a alchemist --b bulldozer
//   npx tsx duel/run.ts 701 --a 暴走拆迁队 --b 一拳光头
import { simulate } from "./src/sim.ts";
import { DUEL_MATCHUPS, ALL_FIGHTERS, findFighter, buildCustomMatchup } from "./src/fighters.ts";
import { renderDuel } from "./src/render.ts";
import { writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJ_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(PROJ_ROOT, "output");
const LEGACY_DUEL_DIR = join(PROJ_ROOT, "output/duel");
mkdirSync(OUT_DIR, { recursive: true });

// 1. 扫描 output 目录，自动递增版本号 (v01, v02, v03...)，统一只在项目根目录 output 下生成一份最终视频
const existingFiles = [
  ...readdirSync(OUT_DIR),
  ...(existsSync(LEGACY_DUEL_DIR) ? readdirSync(LEGACY_DUEL_DIR) : []),
];
let maxVer = 0;
let lastMatchupId = "";
for (const file of existingFiles) {
  const m = file.match(/^duel_v(\d+)_seed\d+_(.+)\.mp4$/);
  if (m) {
    const v = Number(m[1]);
    if (v > maxVer) {
      maxVer = v;
      lastMatchupId = m[2];
    }
  }
}
const nextVer = maxVer + 1;
const verTag = `v${String(nextVer).padStart(2, "0")}`;

function getArgValue(flag: string): string | undefined {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === flag && process.argv[i + 1]) return process.argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

// 2. 解析对局阵容：支持 --a <heroA> --b <heroB> 任选两个英雄自动开打，或 --matchup 指定，或从全英雄池随机挑两个英雄
const argA = getArgValue("--a");
const argB = getArgValue("--b");
const argPair = getArgValue("--pair");
const argMatchup = getArgValue("--matchup");

let matchup = DUEL_MATCHUPS[0];
if (argA || argB) {
  const heroA = (argA ? findFighter(argA) : undefined) ?? ALL_FIGHTERS[0];
  const heroB =
    (argB ? findFighter(argB) : undefined) ??
    ALL_FIGHTERS.find(f => f.name !== heroA.name) ??
    ALL_FIGHTERS[1];
  matchup = buildCustomMatchup(heroA, heroB);
} else if (argPair && argPair.includes("_vs_")) {
  const [leftKey, rightKey] = argPair.split("_vs_");
  const preset = DUEL_MATCHUPS.find(m => m.id === argPair);
  if (preset) {
    matchup = preset;
  } else {
    const heroA = findFighter(leftKey) ?? ALL_FIGHTERS[0];
    const heroB = findFighter(rightKey) ?? ALL_FIGHTERS[1];
    matchup = buildCustomMatchup(heroA, heroB);
  }
} else if (argMatchup) {
  const byId = DUEL_MATCHUPS.find(m => m.id === argMatchup);
  const byIdx = Number.isFinite(Number(argMatchup))
    ? DUEL_MATCHUPS[Number(argMatchup) % DUEL_MATCHUPS.length]
    : undefined;
  matchup = byId ?? byIdx ?? DUEL_MATCHUPS[0];
} else {
  const skillPool = ALL_FIGHTERS.filter(f => f.combatMode === "skillball");
  const idxA = Math.floor(Math.random() * skillPool.length);
  let idxB = Math.floor(Math.random() * (skillPool.length - 1));
  if (idxB >= idxA) idxB += 1;
  matchup = buildCustomMatchup(skillPool[idxA], skillPool[idxB]);
}

// 3. 100% 真实单次物理模拟（不做多局优选剧本，完全由初始种子与实时物理碰撞决定结局）
const flagValues = new Set([argA, argB, argPair, argMatchup].filter(Boolean));
const explicitSeedStr =
  getArgValue("--seed") ??
  process.argv.slice(2).find(a => !a.startsWith("--") && !flagValues.has(a) && /^\d+$/.test(a));
const bestSeed = explicitSeedStr ? Number(explicitSeedStr) : 100 + Math.floor(Math.random() * 899);
const coldOpen = process.argv.includes("--cold-open");
const bestEvents = simulate(matchup.fighterA, matchup.fighterB, bestSeed, 55);

const mp4FileName = `duel_${verTag}_seed${bestSeed}_${matchup.id}.mp4`;
const eventsPath = `/tmp/events_${verTag}_seed${bestSeed}_${matchup.id}.jsonl`;
const outMp4 = join(OUT_DIR, mp4FileName);

console.log(`[1/2] simulating ${verTag} | matchup=${matchup.title} (${matchup.id}) | seed=${bestSeed} ...`);
writeFileSync(eventsPath, bestEvents.map(e => JSON.stringify(e)).join("\n"));
const end = bestEvents.find(e => e.type === "end") as any;
const parryCount = bestEvents.filter(e => e.type === "parry").length;
const hitCount = bestEvents.filter(e => e.type === "skill").length;
console.log(
  `      winner=${end?.winner} dur=${end?.duration.toFixed(1)}s parries=${parryCount} hits=${hitCount} events=${bestEvents.length}`,
);

console.log(`[2/2] rendering -> ${outMp4} ...`);
await renderDuel(eventsPath, outMp4, {
  coldOpen,
  bgm: true,
  hookText: matchup.hook,
});
console.log(`[done] output -> ${outMp4}`);

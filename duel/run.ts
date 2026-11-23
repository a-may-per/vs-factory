// duel 一键流水线：模拟 → 事件日志 → 渲染 → 成片
// 用法:
//   npx tsx duel/run.ts [seed] [--a <heroA> --b <heroB>] [--matchup <id|index>] [--cold-open]
// 示例:
//   npx tsx duel/run.ts 808 --a alchemist --b bulldozer
//   npx tsx duel/run.ts 701 --a 暴走拆迁队 --b 一拳光头
import { simulate } from "./src/sim.ts";
import { DUEL_MATCHUPS, CURATED_HERO_MATCHUPS, ALL_FIGHTERS, findFighter, buildCustomMatchup } from "./src/fighters.ts";
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
function getArgValue(flag: string): string | undefined {
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === flag && process.argv[i + 1]) return process.argv[i + 1];
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

const nextVer = maxVer + 1;
const explicitVer = getArgValue("--ver");
const verTag = explicitVer ?? `v${String(nextVer).padStart(2, "0")}`;

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
  const curatedCandidates = CURATED_HERO_MATCHUPS.filter(m => m.id !== lastMatchupId);
  const pool = curatedCandidates.length > 0 ? curatedCandidates : CURATED_HERO_MATCHUPS;
  matchup = pool[Math.floor(Math.random() * pool.length)];
}

// 3. 真实物理模拟 + 自动高留存种子质检（若未指定固定 seed，则从随机池自动筛选「0.2s首碰 + 21~23s黄金时长 + 丝血绝杀」对局）
const flagValues = new Set([argA, argB, argPair, argMatchup].filter(Boolean));
const explicitSeedStr =
  getArgValue("--seed") ??
  process.argv.slice(2).find(a => !a.startsWith("--") && !flagValues.has(a) && /^\d+$/.test(a));

function evalRetentionMetrics(evs: any[]) {
  const endEv = evs.find(e => e.type === "end") as any;
  const dur = endEv?.duration ?? 55;
  const winner = endEv?.winner ?? "A";
  let curHpA = matchup.fighterA.maxHp;
  let curHpB = matchup.fighterB.maxHp;
  for (const ev of evs) {
    if (ev.type === "damage" || ev.type === "heal") {
      if (ev.id === "A" && typeof ev.hp === "number") curHpA = ev.hp;
      if (ev.id === "B" && typeof ev.hp === "number") curHpB = ev.hp;
    }
  }
  const winMax = winner === "A" ? matchup.fighterA.maxHp : matchup.fighterB.maxHp;
  const winHp = winner === "A" ? curHpA : curHpB;
  const winHpPct = (winHp / Math.max(1, winMax)) * 100;
  const actEvs = evs.filter(e =>
    ["damage", "parry", "skill", "webHit", "propHit", "timeStopStart", "ultCast"].includes(e.type),
  );
  const firstHit = actEvs.length > 0 ? actEvs[0].t : 5;
  const hits2s = actEvs.filter(e => e.t <= 2.0).length;
  const first5 = actEvs.filter(e => e.t <= 5.0).map(e => e.t);
  let maxGap5s = first5.length > 0 ? first5[0] : 5.0;
  for (let i = 1; i < first5.length; i++) maxGap5s = Math.max(maxGap5s, first5[i] - first5[i - 1]);
  if (first5.length > 0) maxGap5s = Math.max(maxGap5s, 5.0 - first5[first5.length - 1]);
  const inSweetDur = dur >= 20.0 && dur <= 23.4;
  const score =
    (inSweetDur ? 60 : -Math.abs(dur - 21.8) * 12) -
    winHpPct * 2.6 -
    maxGap5s * 14 +
    hits2s * 2.5 -
    firstHit * 18;
  return { dur, winner, winHp, winHpPct, firstHit, hits2s, maxGap5s, score };
}

let bestSeed: number;
let bestEvents: any[];
if (explicitSeedStr) {
  bestSeed = Number(explicitSeedStr);
  bestEvents = simulate(matchup.fighterA, matchup.fighterB, bestSeed, 55);
} else {
  const startSeed = 100 + Math.floor(Math.random() * 820);
  bestSeed = startSeed;
  bestEvents = simulate(matchup.fighterA, matchup.fighterB, startSeed, 55);
  let bestScore = evalRetentionMetrics(bestEvents).score;
  for (let offset = 1; offset < 40; offset++) {
    const candSeed = startSeed + offset;
    const candEvs = simulate(matchup.fighterA, matchup.fighterB, candSeed, 55);
    const m = evalRetentionMetrics(candEvs);
    if (m.score > bestScore) {
      bestScore = m.score;
      bestSeed = candSeed;
      bestEvents = candEvs;
    }
  }
}

// 默认启用「0帧直入战场」冷启动模式（消除前1.2s黑底静态卡滑走率）；如需旧版开场卡可传 --intro-card
const coldOpen = !process.argv.includes("--intro-card");
const metrics = evalRetentionMetrics(bestEvents);

const baseStem = `duel_${verTag}_seed${bestSeed}_${matchup.id}`;
const mp4FileName = `${baseStem}.mp4`;
const eventsPath = `/tmp/events_${baseStem}.jsonl`;
const outMp4 = join(OUT_DIR, mp4FileName);
const coverPath = join(OUT_DIR, `${baseStem}_cover_3x4.png`);
const copyPath = join(OUT_DIR, `${baseStem}_upload_copy.txt`);

console.log(`[1/2] simulating ${verTag} | matchup=${matchup.title} (${matchup.id}) | seed=${bestSeed} ...`);
writeFileSync(eventsPath, bestEvents.map(e => JSON.stringify(e)).join("\n"));
const end = bestEvents.find(e => e.type === "end") as any;
const parryCount = bestEvents.filter(e => e.type === "parry").length;
const hitCount = bestEvents.filter(e => e.type === "skill").length;
console.log(
  `      winner=${end?.winner} (hp=${metrics.winHpPct.toFixed(1)}%) dur=${end?.duration.toFixed(2)}s t0=${metrics.firstHit.toFixed(2)}s hits2s=${metrics.hits2s} gap5s=${metrics.maxGap5s.toFixed(2)}s parries=${parryCount} hits=${hitCount}`,
);

console.log(`[2/2] rendering -> ${outMp4} ...`);
await renderDuel(eventsPath, outMp4, {
  coldOpen,
  bgm: true,
  hookText: matchup.hook,
  coverPath,
});

const isWeaponDuel = matchup.fighterA.combatMode !== "skillball" && matchup.fighterB.combatMode !== "skillball";
const tagAlias: Record<string, string> = {
  时停钟表王: "时间停止",
  一拳光头: "一拳超人",
};
const tagA = tagAlias[matchup.fighterA.name] ?? matchup.fighterA.name;
const tagB = tagAlias[matchup.fighterB.name] ?? matchup.fighterB.name;
const rawTags = ["电子大乱斗", "赛博斗蛐蛐", tagA, tagB, matchup.fighterA.title, matchup.fighterB.title];
const uniqueTags = Array.from(new Set(rawTags.filter(Boolean))).slice(0, 6);
const hashLine = uniqueTags.map(t => `#${t}`).join(" ");
const uploadCopy = [
  `【视频描述（短标题 + 精准能力标签，整行直接复制粘贴）】`,
  `${matchup.fighterA.name}VS${matchup.fighterB.name} ${hashLine}`,
  ``,
  `【置顶评论互动话术（发布后粘到首评置顶）】`,
  isWeaponDuel
    ? `开局押对胜方的扣 666 集合！下期想看什么新神兵（比如：血滴子飞轮 / 电磁激光剑 / 万剑归宗球），评论区点播最高赞直接安排上场！`
    : `开局押对胜方的扣 666 集合！下期想看哪两个机制球单挑，或者有什么奇葩新英雄脑洞，评论区点播最高赞直接做出来上场！`,
  ``,
  `【成片留存质检指标（对标 >32% 完播模型）】`,
  `- 首碰爆发时间：${metrics.firstHit.toFixed(2)}s | 前2秒交锋数：${metrics.hits2s} 次 | 前5秒最大空窗：${metrics.maxGap5s.toFixed(2)}s`,
  `- 决战总时长：${(metrics.dur + 0.64).toFixed(2)}s | 胜方（${metrics.winner === "A" ? "红方·" + matchup.fighterA.name : "蓝方·" + matchup.fighterB.name}）剩余血量：${metrics.winHp} (${metrics.winHpPct.toFixed(1)}%)`,
  ``,
  `【发布设置建议（基于 19 期实测相关性 r=0.88）】`,
  `1. 封面选择：务必手动选用同目录生成的 3:4 封面图 -> ${baseStem}_cover_3x4.png`,
  `2. 固定发布窗口：14:00-16:30（控制时间变量，优先吃满下午至晚间推荐池）`,
  ``,
].join("\n");
writeFileSync(copyPath, uploadCopy, "utf8");
console.log(`[done] output -> ${outMp4}`);
console.log(`[done] cover  -> ${coverPath}`);
console.log(`[done] copy   -> ${copyPath}`);

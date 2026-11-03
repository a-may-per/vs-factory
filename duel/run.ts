// duel 一键流水线：模拟 → 事件日志 → 渲染 → 成片
// 用法: node duel/run.ts [seed] [--matchup <index|id>] [--cold-open]
// 特性:
// 1. 自动递增版本号 (v01, v02, v03...)，绝不覆盖历史成片 (如 duel_42.mp4)。
// 2. 随机轮换全英雄池对局阵容 (冰霜剑圣 / 雷电魔像 / 猩红死神 / 暗影魔王 / 南瓜骑士 / 火焰史莱姆)。
// 3. 默认开启 1.75s 高燃开局对战卡（可通过 --cold-open 切换冷启动）。
import { simulate } from "./src/sim.ts";
import { DUEL_MATCHUPS } from "./src/fighters.ts";
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

// 2. 解析对局阵容：支持 --matchup 指定，默认从 6 大英雄对局池中随机选取（且避免与上一版重复）
const matchupArgIdx = process.argv.indexOf("--matchup");
let matchup = DUEL_MATCHUPS[0];
if (matchupArgIdx >= 0 && process.argv[matchupArgIdx + 1]) {
  const val = process.argv[matchupArgIdx + 1];
  const byId = DUEL_MATCHUPS.find(m => m.id === val);
  const byIdx = Number.isFinite(Number(val)) ? DUEL_MATCHUPS[Number(val) % DUEL_MATCHUPS.length] : undefined;
  matchup = byId ?? byIdx ?? DUEL_MATCHUPS[0];
} else {
  const candidates = DUEL_MATCHUPS.filter(m => m.id !== lastMatchupId);
  const pool = candidates.length > 0 ? candidates : DUEL_MATCHUPS;
  matchup = pool[Math.floor(Math.random() * pool.length)];
}

// 3. 解析或随机生成高爽感种子（自动优选 13.5s~20.5s 内高频拼刀决胜局）
const explicitSeedArg = process.argv.slice(2).find(a => !a.startsWith("--") && a !== process.argv[matchupArgIdx + 1]);
const baseSeed = explicitSeedArg ? Number(explicitSeedArg) : 100 + Math.floor(Math.random() * 899);
const coldOpen = process.argv.includes("--cold-open");

let bestSeed = baseSeed;
let bestEvents = simulate(matchup.fighterA, matchup.fighterB, baseSeed, 34);
let bestScore = -1;

for (let offset = 0; offset < (explicitSeedArg ? 1 : 12); offset++) {
  const candSeed = baseSeed + offset * 7;
  const evs = simulate(matchup.fighterA, matchup.fighterB, candSeed, 34);
  const endEv = evs.find(e => e.type === "end") as { winner: string; duration: number } | undefined;
  if (!endEv) continue;
  const clashes = evs.filter(
    e =>
      e.type === "parry" ||
      e.type === "skill" ||
      e.type === "webHit" ||
      e.type === "latchStart" ||
      e.type === "seriousPunch" ||
      e.type === "soundWave",
  ).length;
  // 黄金短视频时长窗口：战斗本体 21.0s~25.5s（加上 1.75s 对战卡 + 2.2s 结算台 = 总成片 25s~29.5s）
  const inGoldenWindow = endEv.duration >= 21.0 && endEv.duration <= 25.5 ? 200 : 0;
  const score = inGoldenWindow + clashes;
  if (score > bestScore) {
    bestScore = score;
    bestSeed = candSeed;
    bestEvents = evs;
  }
}

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

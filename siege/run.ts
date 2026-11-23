// siege 一键流水线：窄口绝境死守 / 死角光暗手电搜房 / 断电探照灯 / 声呐潜行 / 多队迷宫汇合 → 26人交叉火网反推丧尸母巢
// 用法:
//   node --experimental-strip-types siege/run.ts [seed] [--mode combo|rescue|infect|multiply|bunker|scavenge|blackout|sonar|maze-infect|random] [--map canyon-bridge|twin-corridor|cross-bunker] [--duration 42] [--optimize] [--bgm path/to/bgm.mp3]
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIEGE_MAPS,
  SIEGE_MAP_IDS,
  SIEGE_MODE_IDS,
  SIEGE_MODE_META,
  type SiegeMapId,
  type SiegeModeId,
} from "./src/config.ts";
import { findGoldenSeed } from "./src/optimizer.ts";
import { renderSiegeVideo } from "./src/render.ts";

const PROJ_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SIEGE_OUT_DIR = join(PROJ_ROOT, "output/siege");
mkdirSync(SIEGE_OUT_DIR, { recursive: true });

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

// 1. 自动递增版本号 (v01, v02, v03...)，永不覆盖历史成片
const existingFiles = readdirSync(SIEGE_OUT_DIR);
let maxVer = 0;
let lastMapId = "";
for (const file of existingFiles) {
  const m = file.match(/^siege_v(\d+)_seed\d+_(.+)\.mp4$/);
  if (m) {
    const v = Number(m[1]);
    if (v > maxVer) {
      maxVer = v;
      lastMapId = m[2];
    }
  }
}
const nextVer = maxVer + 1;
const verTag = `v${String(nextVer).padStart(2, "0")}`;

// 2. 解析地图：支持 --map 指定，默认轮换不同窄口地图
const mapArg = getFlag("--map") as SiegeMapId | undefined;
let mapId: SiegeMapId = "canyon-bridge";
if (mapArg && SIEGE_MAPS[mapArg]) {
  mapId = mapArg;
} else {
  const candidates = SIEGE_MAP_IDS.filter(id => id !== lastMapId);
  mapId = candidates[0] ?? "canyon-bridge";
}
const mapCfg = SIEGE_MAPS[mapId];

// 3. 解析种子与时长
const explicitSeedArg = process.argv
  .slice(2)
  .find(a => !a.startsWith("--") && /^\d+$/.test(a) && a !== getFlag("--duration"));
const seed = explicitSeedArg ? Number(explicitSeedArg) : 200 + nextVer * 17;
const rawDur = getFlag("--duration");
const durationSec = rawDur ? Math.max(15, Number(rawDur) || 42) : undefined;

// 4. 解析玩法模式 (--mode combo|rescue|infect|multiply|bunker|random)
const modeArg = getFlag("--mode");
let modeId: SiegeModeId = "combo";
if (modeArg === "random") {
  modeId = SIEGE_MODE_IDS[seed % SIEGE_MODE_IDS.length];
} else if (modeArg && modeArg in SIEGE_MODE_META) {
  modeId = modeArg as SiegeModeId;
}
const modeMeta = SIEGE_MODE_META[modeId];

// 5. 支持 --optimize 蒙特卡洛黄金种子寻优
let finalSeed = seed;
if (process.argv.includes("--optimize")) {
  const opt = findGoldenSeed(modeId, seed, 80, mapId);
  finalSeed = opt.best.seed;
  console.log(
    `[0/2] Monte Carlo optimized seed=${finalSeed} (score=${opt.best.totalScore}/100, passed=${opt.passedCount}/${opt.scannedCount})`,
  );
}

const customOut = getFlag("--out");
const bgmPath = getFlag("--bgm");
const mp4FileName = `siege_${verTag}_seed${finalSeed}_${mapId}_${modeId}.mp4`;
const outMp4 = customOut ?? join(SIEGE_OUT_DIR, mp4FileName);

console.log(
  `[1/2] starting siege ${verTag} | mode=${modeMeta.name} (${modeId}) | map=${mapCfg.name} (${mapId}) | seed=${finalSeed} | dur=${durationSec ? `${durationSec}s` : "auto(反推母巢决胜)"}${bgmPath ? ` | bgm=${bgmPath}` : " | bgm=Stereo-3-Act-Phonk+ASMR"} ...`,
);
const stats = await renderSiegeVideo({
  mapId,
  modeId,
  seed: finalSeed,
  durationSec,
  outMp4,
  hookTitle: modeMeta.hookTitle,
  bgmPath,
});

console.log(
  `[2/2] finished -> ${outMp4} | dur=${stats.durationSec}s | mode=${stats.modeId} | kills=${stats.kills} | bosses=${stats.bossesKilled}/${stats.totalBosses} | squad=${stats.aliveGreens} | rescued=${stats.rescuedCount} | casualties=${stats.casualties}`,
);

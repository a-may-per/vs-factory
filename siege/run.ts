// siege 一键流水线：窄口防线死守模拟 → 持久化战损渲染 → 1080x1920 竖屏成片
// 用法:
//   npx tsx siege/run.ts [seed] [--map canyon-bridge|twin-corridor|cross-bunker] [--duration 19] [--out output/siege/demo.mp4]
import { mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SIEGE_MAPS, SIEGE_MAP_IDS, type SiegeMapId } from "./src/config.ts";
import { renderSiegeVideo } from "./src/render.ts";

const PROJ_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOP_OUT_DIR = join(PROJ_ROOT, "output");
const SIEGE_OUT_DIR = join(PROJ_ROOT, "output/siege");
mkdirSync(TOP_OUT_DIR, { recursive: true });
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
const durationSec = rawDur ? Math.max(10, Number(rawDur) || 20) : undefined;

const customOut = getFlag("--out");
const mp4FileName = `siege_${verTag}_seed${seed}_${mapId}.mp4`;
const outMp4 = customOut ?? join(SIEGE_OUT_DIR, mp4FileName);
const topOutMp4 = join(TOP_OUT_DIR, mp4FileName);

console.log(
  `[1/2] starting siege ${verTag} | map=${mapCfg.name} (${mapId}) | seed=${seed} | dur=${durationSec ? `${durationSec}s` : "auto(决出胜负)"} ...`,
);
const stats = await renderSiegeVideo({
  mapId,
  seed,
  durationSec,
  outMp4,
  hookTitle: mapCfg.hookTitle,
});

console.log(
  `[2/2] finished -> ${outMp4} | dur=${stats.durationSec}s | kills=${stats.kills} | bosses=${stats.bossesKilled}/${stats.totalBosses} | aliveGreens=${stats.aliveGreens}/${stats.totalGreens}`,
);

if (!customOut) {
  copyFileSync(outMp4, topOutMp4);
  console.log(`[done] also copied to top-level output -> ${topOutMp4}`);
}

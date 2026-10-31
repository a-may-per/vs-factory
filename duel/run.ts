// duel 一键流水线：模拟 → 事件日志 → 渲染 → 成片
// 用法: node duel/run.ts [seed] [--intro]
import { simulate } from "./src/sim.ts";
import { VAMPIRE, BERSERKER, DUEL_MATCHUPS } from "./src/fighters.ts";
import { renderDuel } from "./src/render.ts";
import { writeFileSync, mkdirSync } from "node:fs";

const seed = Number(process.argv[2] ?? 42) || 42;
const coldOpen = !process.argv.includes("--intro");
const explicitColdSuffix = process.argv.includes("--cold-open") ? "_cold" : "";
mkdirSync("out/duel", { recursive: true });

console.log(`[1/2] simulating seed=${seed} ...`);
const events = simulate(VAMPIRE, BERSERKER, seed, 26);
writeFileSync(`out/duel/events${seed}.jsonl`, events.map(e => JSON.stringify(e)).join("\n"));
const end = events.find(e => e.type === "end") as any;
console.log(`      winner=${end?.winner} dur=${end?.duration.toFixed(1)}s events=${events.length}`);

console.log("[2/2] rendering ...");
await renderDuel(`out/duel/events${seed}.jsonl`, `out/duel/duel_${seed}${explicitColdSuffix}.mp4`, {
  coldOpen,
  bgm: true,
  hookText: DUEL_MATCHUPS[0].hook,
});

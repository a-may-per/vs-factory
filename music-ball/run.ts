// music-ball 一键流水线：音频 → 事件轴 → 渲染 → 成片
// 用法: node music-ball/run.ts <song.wav|mp3> [out.mp4]
import { execSync } from "node:child_process";
import { renderMusicBall } from "./src/render.ts";
import { mkdirSync, existsSync } from "node:fs";

const song = process.argv[2];
if (!song || !existsSync(song)) { console.error("usage: node music-ball/run.ts <song.wav|mp3> [out.mp4]"); process.exit(1); }
const out = process.argv[3] ?? `out/music-ball/${song.split("/").pop()?.replace(/\.\w+$/, "") ?? "sample"}.mp4`;
mkdirSync("out/music-ball", { recursive: true });

console.log("[1/2] analyzing audio ...");
execSync(`music-ball/.venv/bin/python music-ball/tools/analyze.py "${song}" /tmp/mb_axis.json`, { stdio: "inherit" });
console.log("[2/2] rendering ...");
await renderMusicBall("/tmp/mb_axis.json", song, out);

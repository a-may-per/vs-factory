// music-ball 一键流水线：音频 → 事件轴 → 横版关卡 → 重力跑酷 → 成片
// 用法: node music-ball/run.ts <song.wav|mp3> [out.mp4] [seed]
import { spawnSync } from "node:child_process";
import { renderNaturalMusicBall } from "./src/natural-render.ts";
import { mkdirSync, existsSync } from "node:fs";

const song = process.argv[2];
if (!song || !existsSync(song)) {
  console.error("usage: node music-ball/run.ts <song.wav|mp3> [out.mp4] [seed]");
  process.exit(1);
}
const out = process.argv[3] ?? `out/music-ball/${song.split("/").pop()?.replace(/\.\w+$/, "") ?? "sample"}.mp4`;
const seed = Number(process.argv[4] ?? 17);
mkdirSync("out/music-ball", { recursive: true });

console.log("[1/3] analyzing audio ...");
const analysis = spawnSync("music-ball/.venv/bin/python", ["music-ball/tools/analyze.py", song, "/tmp/mb_axis.json"], { stdio: "inherit" });
if (analysis.status !== 0) process.exit(analysis.status ?? 1);

// 渲染器消费标准 PCM WAV；MP3 等输入先由 ffmpeg 转成临时 WAV，避免 TS 端绑定音频解码库。
const wav = "/tmp/music-ball-input.wav";
console.log("[2/3] normalizing audio to PCM WAV ...");
const convert = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", song, "-ac", "1", "-ar", "44100", "-sample_fmt", "s16", wav], { stdio: "inherit" });
if (convert.status !== 0) process.exit(convert.status ?? 1);

console.log("[3/3] rendering horizontal platform runner ...");
await renderNaturalMusicBall("/tmp/mb_axis.json", wav, out, seed);

// music-ball 一键短视频生成流水线：
// 1. 支持外部音乐文件（.mp3 / .wav / .m4a / .flac / .mp4）直接输入，支持：
//    - 指定片段截取：--clip 00:42-00:58 或 --start 42 --duration 16
//    - 整首长歌自动副歌/高潮识别：未传 --start/--clip 且原曲 > 20s 时，自动扫描全曲能量峰值截取最燃高潮片段（加 --full 可禁用）
//    - 截取后自动添加平滑淡入淡出（Fade-In / Fade-Out），并在切片后的音频上执行节拍提取，确保 100% 严丝合缝踩点！
// 2. 未提供外部音频时，使用内置多曲风无版权电音合成器生成曲目与节拍轴。
//
// 用法示例:
//   node music-ball/run.ts ./my_song.mp3 --clip 00:42-00:57 --mode corridor --title "Alan Walker - Faded"
//   node music-ball/run.ts ./my_song.mp3 --start 01:15 --duration 15 --mode rings
//   node music-ball/run.ts ./full_song.mp3 --mode all                  # 自动识别整首歌最燃的 15s 副歌片段
//   node music-ball/run.ts --mode all --genre phonk                    # 使用内置电音合成器
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMusicBallVideo } from "./src/render.ts";
import { generateSynthSongAndAxis, type SynthGenre } from "./src/synth-song.ts";
import { prepareAudioClip, analyzeAudioAxis } from "./src/audio-clip.ts";
import type { BallSkinId, MusicBallMode, ThemeId } from "./src/themes.ts";

const MB_DIR = dirname(fileURLToPath(import.meta.url));
const PROJ_ROOT = dirname(MB_DIR);

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

function hasBoolFlag(name: string): boolean {
  return process.argv.includes(name);
}

const BOOL_FLAGS = new Set(["--full"]);

const positional = process.argv.slice(2).filter((arg, i, arr) => {
  if (arg.startsWith("--")) return false;
  if (i > 0 && arr[i - 1].startsWith("--") && !BOOL_FLAGS.has(arr[i - 1])) return false;
  return true;
});

const songArg = getFlag("--song") ?? positional[0];
const outArg = getFlag("--out") ?? positional[1];
const seed = Number(positional[2] ?? getFlag("--seed") ?? 77) || 77;
const modeFlag = (getFlag("--mode") ?? "corridor") as MusicBallMode | "all";
const themeFlag = getFlag("--theme") as ThemeId | undefined;
const skinFlag = getFlag("--skin") as BallSkinId | undefined;
const genreFlag = getFlag("--genre") as SynthGenre | undefined;
const clipFlag = getFlag("--clip");
const startFlag = getFlag("--start");
const durationFlag = getFlag("--duration");
const titleFlag = getFlag("--title");
const fullFlag = hasBoolFlag("--full");

const wavPath = `/tmp/music-ball-input-${seed}.wav`;
const axisPath = `/tmp/mb_axis_${seed}.json`;
let resolvedSongTitle = titleFlag;

if (songArg && existsSync(songArg)) {
  console.log(`[1/3] preparing audio clip from: ${songArg} ...`);
  const clipMeta = prepareAudioClip(songArg, wavPath, {
    clip: clipFlag,
    start: startFlag,
    duration: durationFlag ? Number(durationFlag) : undefined,
    autoClimax: !fullFlag,
    defaultClipDuration: 15.0,
  });
  resolvedSongTitle = titleFlag ?? clipMeta.title;
  const tag = clipMeta.isAutoClimax
    ? "auto-detected climax/chorus"
    : clipFlag || startFlag !== undefined
      ? "custom time slice"
      : "full track";
  console.log(
    `      segment: ${clipMeta.startSec.toFixed(2)}s .. ${clipMeta.endSec.toFixed(2)}s (${clipMeta.durationSec.toFixed(2)}s, ${tag})`,
  );

  console.log(`[2/3] analyzing beat & onset axis on sliced audio ...`);
  analyzeAudioAxis(wavPath, axisPath, MB_DIR);
} else {
  const synthDur = durationFlag ? Math.max(5, Number(durationFlag)) : 15.0;
  console.log(`[1/2] synthesizing copyright-free electronic track & beat axis (seed=${seed}, duration=${synthDur}s) ...`);
  const info = generateSynthSongAndAxis(wavPath, axisPath, {
    genre: genreFlag,
    seed,
    durationSec: synthDur,
  });
  resolvedSongTitle = titleFlag ?? info.title;
  console.log(`      genre=${info.genre} (${info.title}) tempo=${info.tempo}BPM events=${info.events.length}`);
}

const modes: MusicBallMode[] = modeFlag === "all"
  ? ["corridor", "hopper", "rings"]
  : [modeFlag];

for (let i = 0; i < modes.length; i++) {
  const m = modes[i];
  const targetOut = modes.length === 1 && outArg
    ? outArg
    : join(PROJ_ROOT, "out/music-ball", `${m}_${seed}.mp4`);
  mkdirSync(dirname(targetOut), { recursive: true });
  console.log(`[Render] mode=${m} -> ${targetOut} ...`);
  await renderMusicBallVideo(axisPath, wavPath, targetOut, {
    seed: seed + i * 19,
    mode: m,
    theme: themeFlag,
    skin: skinFlag,
    songTitle: resolvedSongTitle,
  });
}

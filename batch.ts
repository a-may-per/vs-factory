// vs-factory 批量短视频矩阵生产流水线 (Batch Short-Video Factory)
// 支持一键批量生产 Music-Ball（corridor 琴键回廊 / hopper 重力跳台 / rings 破壁圆环）与 Duel（红蓝擂台对战）1080×1920 竖屏成片，
// 支持：
//   1. 单首长歌自动拆条（--song ./full_song.mp3 --count 3）：自动识别整首歌能量最高的 N 个高潮/副歌片段，一首歌批量切出多条爆款视频！
//   2. 指定音乐片段（--song ./my.mp3 --clip 00:42-00:57 或 --start 42 --duration 15）：精准截取指定时间段并自动淡入淡出+重算节拍轴。
//   3. 外部曲库目录扫描（--audio-dir ./songs --count 10）：扫描目录下所有 mp3/wav/m4a/flac/mp4，自动提取每首歌的高潮片段批量成片。
//   4. 无外部音乐时自动使用内置 4 大无版权电音合成器。
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMusicBallVideo } from "./music-ball/src/render.ts";
import { prepareAudioClip, analyzeAudioAxis } from "./music-ball/src/audio-clip.ts";
import {
  BALL_SKIN_IDS,
  BALL_SKIN_NAMES,
  THEME_IDS,
  THEMES,
  VIRAL_HOOKS,
  type BallSkinId,
  type MusicBallMode,
  type ThemeId,
} from "./music-ball/src/themes.ts";
import {
  SYNTH_GENRE_LIST,
  SYNTH_GENRES,
  generateSynthSongAndAxis,
  type SynthGenre,
} from "./music-ball/src/synth-song.ts";
import { simulate } from "./duel/src/sim.ts";
import { DUEL_MATCHUPS } from "./duel/src/fighters.ts";
import { renderDuel } from "./duel/src/render.ts";

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

export interface BatchItemMetadata {
  index: number;
  id: string;
  workflow: "music-ball" | "duel";
  mode: string;
  outMp4: string;
  resolution: "1080x1920";
  durationSec: number;
  seed: number;
  theme: string;
  skinOrMatchup: string;
  bgmInfo: string;
  publishTitle: string;
  pinnedComment: string;
  hashtags: string[];
}

const workflow = (getFlag("--workflow") ?? "music-ball") as "music-ball" | "duel" | "all";
const count = Math.max(1, Number(getFlag("--count") ?? 3) || 3);
const modeFilter = (getFlag("--mode") ?? "all") as MusicBallMode | "all";
const outDir = getFlag("--out-dir") ?? "out/batch";
const audioDir = getFlag("--audio-dir");
const singleSong = getFlag("--song");
const clipFlag = getFlag("--clip");
const startFlag = getFlag("--start");
const titleFlag = getFlag("--title");
const durationSec = Math.max(6, Number(getFlag("--duration") ?? 14) || 14);
const baseSeed = Number(getFlag("--seed") ?? 101) || 101;

mkdirSync(outDir, { recursive: true });

// 收集外部音乐池（支持 --song 单曲多切，或 --audio-dir 目录扫描）
const externalSongs: string[] = [];
if (singleSong && existsSync(singleSong)) {
  externalSongs.push(singleSong);
}
if (audioDir && existsSync(audioDir)) {
  for (const name of readdirSync(audioDir)) {
    if (/\.(mp3|wav|m4a|flac|ogg|mp4|mov)$/i.test(name)) {
      externalSongs.push(join(audioDir, name));
    }
  }
}

const modesPool: MusicBallMode[] = modeFilter === "all"
  ? ["corridor", "hopper", "rings"]
  : [modeFilter];

const manifest: BatchItemMetadata[] = [];

console.log(`============================================================`);
console.log(`🚀 vs-factory 批量短视频生产工厂启动`);
console.log(`   工作流: ${workflow} | 计划产出: ${count} 条 | 输出目录: ${outDir}`);
if (externalSongs.length > 0) {
  console.log(`   外部曲库: 已加载 ${externalSongs.length} 首音频（支持指定片段截取 & 自动副歌高潮提取）`);
}
console.log(`============================================================`);

for (let i = 0; i < count; i++) {
  const seed = baseSeed + i * 37;
  const isDuel = workflow === "duel" || (workflow === "all" && i % 4 === 3);

  if (!isDuel) {
    const mode = modesPool[i % modesPool.length];
    const themeId: ThemeId = THEME_IDS[i % THEME_IDS.length];
    const skinId: BallSkinId = BALL_SKIN_IDS[(i * 2) % BALL_SKIN_IDS.length];
    const genre: SynthGenre = SYNTH_GENRE_LIST[i % SYNTH_GENRE_LIST.length];
    const hooks = VIRAL_HOOKS[mode];
    const hookText = hooks[i % hooks.length];

    const id = `mb_${String(i + 1).padStart(2, "0")}_${mode}_${themeId}`;
    const outMp4 = join(outDir, `${id}.mp4`);
    const wavPath = `/tmp/batch_mb_${seed}.wav`;
    const axisPath = `/tmp/batch_mb_${seed}.json`;

    let bgmLabel = "";
    let songTitleForHud = titleFlag;
    let actualDuration = durationSec;

    if (externalSongs.length > 0) {
      const song = externalSongs[i % externalSongs.length];
      // 当只传入 1 首长歌且未锁死 --clip/--start 时，自动按序提取第 0, 1, 2... 高能量副歌片段，实现“一歌多切”！
      const segIdx = Math.floor(i / externalSongs.length);
      const clipMeta = prepareAudioClip(song, wavPath, {
        clip: clipFlag,
        start: startFlag,
        duration: durationSec,
        autoClimax: true,
        segmentIndex: segIdx,
        totalSegments: Math.ceil(count / externalSongs.length),
        defaultClipDuration: durationSec,
      });
      analyzeAudioAxis(wavPath, axisPath, join(dirname(fileURLToPath(import.meta.url)), "music-ball"));
      songTitleForHud = titleFlag ?? clipMeta.title;
      bgmLabel = `${songTitleForHud} [${clipMeta.startSec.toFixed(1)}s-${clipMeta.endSec.toFixed(1)}s]`;
      actualDuration = clipMeta.durationSec + 0.9;
    } else {
      const synthInfo = generateSynthSongAndAxis(wavPath, axisPath, {
        genre,
        seed,
        durationSec,
      });
      songTitleForHud = titleFlag ?? SYNTH_GENRES[genre].title;
      bgmLabel = `${SYNTH_GENRES[genre].title} (${synthInfo.tempo} BPM)`;
      actualDuration = synthInfo.durationSec + 0.9;
    }

    console.log(`\n[${i + 1}/${count}] 正在渲染 Music-Ball (${mode}) | 曲目:${bgmLabel} | 主题:${THEMES[themeId].name} ...`);
    await renderMusicBallVideo(axisPath, wavPath, outMp4, {
      seed,
      mode,
      theme: themeId,
      skin: skinId,
      hookText,
      songTitle: songTitleForHud,
      aspect: "9:16",
    });

    const modeCn = mode === "corridor"
      ? "赛博琴键回廊"
      : mode === "hopper"
        ? "重力音阶跳台"
        : "破壁同心圆环";

    manifest.push({
      index: i + 1,
      id,
      workflow: "music-ball",
      mode,
      outMp4,
      resolution: "1080x1920",
      durationSec: Number(actualDuration.toFixed(1)),
      seed,
      theme: THEMES[themeId].name,
      skinOrMatchup: BALL_SKIN_NAMES[skinId],
      bgmInfo: bgmLabel,
      publishTitle: `【${modeCn}】${hookText.replace(/[★⚡♫]/g, "").trim()}！${bgmLabel} 全连击实机挑战`,
      pinnedComment: "你想听哪首歌或者哪个时间段的专属踩点挑战？评论区留言【歌名+秒数】，下期直接安排！🎧",
      hashtags: ["#音乐小球", "#卡点视频", "#强迫症极度舒适", "#解压视频", "#节奏大师", `#${modeCn}`],
    });
  } else {
    const preset = DUEL_MATCHUPS[i % DUEL_MATCHUPS.length];
    const id = `duel_${String(i + 1).padStart(2, "0")}_${preset.id}_s${seed}`;
    const eventsPath = join(outDir, `${id}.jsonl`);
    const outMp4 = join(outDir, `${id}.mp4`);

    console.log(`\n[${i + 1}/${count}] 正在模拟并渲染 Duel 对战 (${preset.title}, seed=${seed}) ...`);
    const events = simulate(preset.fighterA, preset.fighterB, seed, 26);
    writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join("\n"));
    await renderDuel(eventsPath, outMp4, { coldOpen: true, bgm: true, hookText: preset.hook });

    const endEv = events.find(e => e.type === "end") as any;
    const winnerName = endEv?.winner === "A" ? preset.fighterA.name : preset.fighterB.name;

    manifest.push({
      index: i + 1,
      id,
      workflow: "duel",
      mode: "arena-duel",
      outMp4,
      resolution: "1080x1920",
      durationSec: Number(((endEv?.duration ?? 20) + 3.1).toFixed(1)),
      seed,
      theme: "红蓝电竞擂台",
      skinOrMatchup: preset.title,
      bgmInfo: "程序化战斗交响电子乐",
      publishTitle: `【电子斗蛐蛐】${preset.title}！${preset.hook}`,
      pinnedComment: `恭喜【${winnerName}】极限拿下本场胜利！下期想看哪两个流派互殴？评论区点播！⚔️`,
      hashtags: ["#电子斗蛐蛐", "#AI对战", "#游戏解说", "#解压競技", `#${preset.fighterA.name}`, `#${preset.fighterB.name}`],
    });
  }
}

const manifestPath = join(outDir, "batch_manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const mdLines: string[] = [
  "# 🎬 `vs-factory` 批量短视频产出与发布文案清单",
  "",
  `| # | 工作流 / 模式 | 成片文件 | 分辨率 | 时长 | 视觉主题 & 皮肤/阵容 | 配乐 / 片段 |`,
  `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
  ...manifest.map(
    m =>
      `| ${m.index} | \`${m.workflow}\` / \`${m.mode}\` | \`${m.outMp4}\` | \`${m.resolution}\` | \`${m.durationSec}s\` | ${m.theme} · ${m.skinOrMatchup} | ${m.bgmInfo} |`,
  ),
  "",
  "## 📋 平台一键发布标题与互动话术",
  "",
  ...manifest.flatMap(m => [
    `### ${m.index}. \`${m.id}.mp4\``,
    `- **发布标题**：${m.publishTitle}`,
    `- **置顶评论话术**：${m.pinnedComment}`,
    `- **推荐话题标签**：\`${m.hashtags.join(" ")}\``,
    "",
  ]),
];
const mdPath = join(outDir, "batch_publish_sheet.md");
writeFileSync(mdPath, mdLines.join("\n"));

console.log(`\n✅ 批量生产全部完成！共生成 ${manifest.length} 条 1080×1920 竖屏短视频：`);
console.log(`   - 元数据清单: ${manifestPath}`);
console.log(`   - 发布文案表: ${mdPath}`);

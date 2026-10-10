# 分支：音乐小球 (music-ball)

> 2026-10-09 定稿；选型已回填（2026-10-09 调研报告，关键工具均经 PyPI/GitHub API 实测核实）

## 一句话
横版跑酷小球踩点动画：歌曲自动分析出节拍/重音 → 自动生成关卡 → 小球一路敲击点，配原曲。

## 关键结论：不需要谱面 ✅
- 音频分析（onset + beat tracking）从 MP3 自动提取「什么时刻有声音」→ 自动生成敲击点/关卡。
  换歌 = 丢 MP3 重新生成，零人工
- 已知瑕疵：弱音/滑音可能漏检；分析端输出保留 strength 让关卡端过滤，不写死阈值

## 已定
- 小球-音乐关系：音频分析驱动（无谱面、无 MIDI）
- 画面：2D 横版——小球从左到右穿过关卡，路径上布满对齐歌曲事件的敲击点
- BGM：热门歌曲（预览可烧音轨；正式发布用平台站内曲库规避版权）
- 产出目标：先出小样

## 选型（2026-10-09 回填）
- [x] 音频分析：**librosa 1.0 单库方案**——onset_detect + onset_strength + beat_track + 内置 HPSS（不装 torch 粗分鼓点/谐波），
      输出统一 JSON 事件轴 `{t_ms, strength, band, beat, downbeat}`，渲染端只吃 JSON。
      实测：[1.0.0](https://pypi.org/project/librosa/) / 2026-08-11 发布 / ISC / **需 Python ≥3.12**
- [x] 升级路径（按需触发，互不阻塞）：踩点漂移 → [beat-this 1.1](https://github.com/CPJKU/beat_this)（MIT，ISMIR 2024 SOTA）；
      假敲击多 → [Demucs 4.1](https://pypi.org/project/demucs/)（用 adefossez 活跃 fork，MIT；htdemucs 模型仅限非商用）
- [x] 排除项：aubio（7 年未发版+GPL 编译门槛）、madmom（模型 CC BY-NC 禁商用+PyPI 已死）、
      spleeter（Python<3.12 锁死）、essentia（AGPL 传染）
- [x] 渲染栈：**复用 duel 的 PixiJS+ffmpeg 管线**——两线同一套渲染/导出/发布代码，只是数据源不同
- [ ] 画面风格（霓虹几何/像素/卡通）：待参考视频到位后定
- [x] 小球角色化：**主角球+换装**（2026-10-09 拍板）——全系列同一只主角球，
      通过换装/换色/换表情适配不同歌，观众认脸，制作最省
- [x] 故事性：**纯跑酷**——球只管跑酷踩点，无剧情无死亡，纯解压

## MVP 验收标准
丢入任意一首歌 → 自动产出一条 30~60s 踩点视频，全程无手工谱面。

## 风险
- **BGM 版权张力**：踩点按成片内音轨生成，抖音站内换曲会破坏音画同步 → 曲库有同名曲才站内换轨，否则改用 CC0/已购授权曲烧录
- 本机 Python 3.9.6 < librosa 要求的 3.12 → 首周用 brew/uv 装新版

## 实现记录（2026-10-10 初版代码完成）
- [x] 音频分析：music-ball/tools/analyze.py（librosa onset+beat+HPSS → JSON 事件轴 {t_ms,strength,band,beat,downbeat}），
      120ms 去重；实测 35.9s 曲子提取 128 敲击点，BPM 误差 2%
- [x] 渲染：复用共享 TS 光栅器+ffmpeg 管线；蛇形赛道 + 命中波纹 + 光柱 + 拖尾小球；
      音频 = 原曲 + 程序化敲击音效混合
- [x] 一键：`node music-ball/run.ts <song.wav|mp3> [out.mp4]`
- 样片：out/music-ball/chill_demo.mp4（38.4s，程序化生成的 CC0 测试曲）
- 已知短板（下轮迭代）：画面上半 40% 空置（可加音量波形可视化）；小球未角色化（主角球+换装待做）；
  mp3 输入未实测（librosa 需 ffmpeg/audioread 支持）；热门歌版权策略未接

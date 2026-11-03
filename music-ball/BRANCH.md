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
- [x] 渲染栈：**复用 duel 的 TS 软件光栅器 + ffmpeg 管线**——两线同一套渲染/导出/发布代码；不依赖 PixiJS 原生模块，平台/跑酷只换数据源
- [ ] 画面风格（霓虹几何/像素/卡通）：待参考视频到位后定
- [x] 小球角色化：**主角球+换装**（2026-10-09 拍板）——全系列同一只主角球，
      通过换装/换色/换表情适配不同歌，观众认脸，制作最省
- [x] 故事性：**纯跑酷**——球只管跑酷踩点，无剧情无死亡，纯解压

## MVP 验收标准
丢入任意一首歌 → 自动产出一条 30~60s 踩点视频，全程无手工谱面。

## 风险
- **BGM 版权张力**：踩点按成片内音轨生成，抖音站内换曲会破坏音画同步 → 曲库有同名曲才站内换轨，否则改用 CC0/已购授权曲烧录
- 本机 Python 3.9.6 < librosa 要求的 3.12 → 首周用 brew/uv 装新版

## 实现记录（2026-10-10 节拍碰撞成品）
- [x] 音频分析：`tools/analyze.py`（librosa onset + beat + HPSS），输出
      `{t_ms,strength,band,beat,downbeat,tier}`；用节拍网格做主轴，strong/beat/weak 三层卡点
- [x] 碰撞关卡：`src/impact-level.ts` 将强拍生成大跳板、普通拍生成墙面/板、弱拍生成装饰块；
      seed 保证同一歌曲重复生成同一布局，强拍目标不会漏掉
- [x] 必达轨迹：`src/impact-motion.ts` 用重力抛物线连接相邻主目标，端点严格落在下一个目标；
      视觉有斜向下坠/反弹，数值上保证关键节点命中
- [x] 渲染：`src/render.ts` 共享 TS 光栅器 + ffmpeg，强拍爆闪/震动/碰撞波纹/拖尾/连击；输出 1920×1080
- [x] 一键：`npx tsx music-ball/run.ts <song.wav|mp3> [output/music-ball/out.mp4] [seed]`；输入先由 ffmpeg 统一为 44.1kHz 单声道 WAV
- 样片：`output/music-ball/maze_demo.mp4`、`output/music-ball/staircase_demo.mp4`、`output/music-ball/pendulum_demo.mp4`
- [x] 完整世界：所有 strong/beat/weak 对象在生成关卡时即存在；渲染只按镜头视锥裁剪，不再按时间窗口临时出现
- [x] 动态视野：根据小球与未来 3~4 个目标的包围盒自动缩放，目标稀疏时拉远看到更多，密集时拉近
- [x] 新碰撞特效：移除全屏白闪，改踏板压缩回弹、局部双冲击环、法线方向碎片、短时拖尾增强、球体椭圆 squash/stretch
- [x] 流行音乐自动卡点：MP3/热门歌 → ffmpeg 标准化 → beat 网格 + onset 强度分层 → 必达碰撞目标 → 混音成片
  - `strong`：downbeat 或强度前 32%，大跳板/强爆闪/重音
  - `beat`：beat_track 的普通节拍，墙面/普通板
  - `weak`：节拍外强 onset，小碰撞块/装饰，不干扰主轨迹
  - 主轨迹按相邻目标时间差反推抛物线，因此关键强拍不会漏撞
- 已知限制：节拍极弱、rubato 或现场演奏的歌曲会降低 beat_track 准确率；正式发布热门歌仍应使用平台曲库/合法授权
- 下一步可选：真实流行歌曲 A/B 校准阈值与目标密度，增加可配置的视觉主题和小球换装

# vs-factory — AI 斗蛐蛐短视频工厂

> 2026-10-09 梳理定稿，2026-10-10 初版代码 + 两线样片完成 ✅

## 一句话
全自动流水线把「AI 对战」变成竖屏短视频：配置/音频进 → 成片出，中间不进剪辑软件。

## 目录（分支即目录）
- [duel/](duel/BRANCH.md) — 技能小人对战线（先做）：**已出样片**
- [music-ball/](music-ball/BRANCH.md) — 音乐小球线：**已出样片**
- shared/ — 公共设施：软件光栅器 / ffmpeg 编码器 / 字形图集 / 音效合成 / BGM 生成 / 混音器

## 快速开始
```bash
# duel：一键对战成片（换 seed 换战局）
node duel/run.ts 77            # → out/duel/duel_77.mp4 (1080x1920, ~30s)
node duel/run.ts 42 --cold-open  # 先打后卡版本

# music-ball：任意音频 → 横版平台跑酷成片
node music-ball/run.ts your-song.mp3 out.mp4
# 可选 seed：同一首歌换 seed 生成不同平台布局
node music-ball/run.ts your-song.mp3 out.mp4 17
```
依赖：ffmpeg（brew）、Node 22+（原生跑 TS）、music-ball/.venv（librosa，已建）

## 架构
```
duel:  角色配置 + seed → TS 确定性模拟器(60Hz) → JSONL 事件日志 → 光栅回放渲染 → ffmpeg → mp4
ball:  歌曲 → librosa 分析(onset/beat/HPSS) → JSON 事件轴 → 同一套渲染管线 → mp4
共享:  FrameBuf 光栅器 / FontAtlas 中文字形 / sfx 程序化音效 / BGM 生成器 / 混音 / 编码器
```
- 渲染选型变更（2026-10-10）：PixiJS 需原生依赖安装受阻 → 改纯 TS 软件光栅器（零依赖零编译），细节见 duel/BRANCH.md
- 音效零素材：jsfxr 式程序化合成；BGM 零版权：程序化生成（正式版音乐小球可换授权曲）

## 状态
- [x] 两线 MVP 链路 + 样片（out/duel/、out/music-ball/）
- [ ] 视觉打磨：重击推拉镜头、血条缓动、死亡演出
- [x] 角色视觉升级方案：Godot 2D + Q版像素 Sprite，南瓜骑士 vs 火焰史莱姆；素材提示词已准备
- [x] duel 交手机制修订：无普通攻击，接触即技能，技能后弹开并重新寻路
- [x] music-ball 节拍碰撞成品：完整二维世界、动态视野、必达抛物线、局部碰撞环/碎片/踏板回弹/球体形变（out/music-ball/impact_world_fx_final.mp4）
- [x] music-ball 自动卡点：beat_track 主节拍骨架 + onset_strength 强弱 + HPSS 音色分层；强拍必达、弱音装饰
- [ ] music-ball：用 2~3 首真实不同节奏歌曲校准卡点密度、强拍阈值和目标布局
- [x] music-ball mp3：入口自动用 ffmpeg 转成 44.1kHz 单声道 PCM WAV 后分析/渲染
- [ ] 热门歌版权策略
- [ ] 参考视频（仍缺，风格定案的唯一阻塞项）
- [ ] 系列名候选（早先后台生成流程未跑完，重启即可）
- [ ] 平台实测：直接发平台，前 5 条只跟自己比（完播>30%、点赞>3%）

## 已定决策（摘要）
见各 BRANCH.md「已定/选型/包装」节：实时自动混战 / 纯数值技能+被动开场亮明 / 完整包装 / 棋盘格擂台 /
固定机位+重击推拉 / 大字报 VS 卡（开场即卡，--cold-open 可切）/ 胜者+点播引导结算 /
直接发平台四渠道分发 / 小球角色化（主角球+换装）/ 纯跑酷无剧情

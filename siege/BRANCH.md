# 分支：窄口死角攻防斗蛐蛐 (siege)

> 2026-11-04 定稿：9:16 竖屏「窄口攻防 & 死角 2D 射线光暗遮挡 + 人类阵亡原地尸变反扑 + 笔直火网前排物理阻挡 + 反推顶部丧尸母巢」短视频生成流水线

## 核心机制与视觉规范
- **零剧透「电子斗蛐蛐」悬念拉锯 HUD**：
  - 顶部采用悬念提问式 Hook 标题 + 红绿双阵营实时动态战力拉锯条 + 「幸存人类 / 已变丧尸 / 泰坦进度 / 在场尸潮与击杀」实时指标，不提前剧透胜负。
- **人类阵亡原地尸变反扑 (`infected_elite` / 「变异枪兵」)**：
  - 普通人类枪兵 `hp = 1` 一碰即碎；每名被丧尸扑咬阵亡的人类士兵会**当场变异为 260 血的「变异枪兵」**（半残绿甲 + 紫红肉瘤甲壳 + 歪斜步枪与利爪），立刻掉头扑向昔日队友。
- **真物理笔直弹道 & 前排/墙体严格阻挡**：
  - 所有枪兵与重机枪碉堡发射笔直射线弹道，严格执行几何射线最近交点检测（`Ray-Circle / Ray-Segment Intersection`）：**前面的丧尸或死角隔墙没打穿，绝不能打到后面的目标**。
- **到处是死角 + 2D 射线光暗遮挡 (`scavenge` / `blackout` / `sonar` / `maze-infect`)**：
  - 室内 6 处 L 型防爆死角隔墙 (`DEAD_CORNER_WALLS`) 同时物理阻挡角色移动、直线子弹与手电/探照灯视线；
  - 36 射线 2D 阴影裁剪光锥 (`applyDeadCornerRaycastLighting`) + 死角阴影内丧尸嗜血红眼闪烁；只有被手电筒、旋转探照灯或声呐脉冲照亮的目标才能被枪兵锁定射击。
- **三幕式 132 BPM Drift Phonk / Dark-Synth BGM + ASMR 战斗音效 + 侧链闪避 (`Sidechain Ducking`)**：
  - 内置三幕式情绪推进 BGM（支持 `--bgm` 传入外部音频）与抛壳枪声、爆浆气泡音、破笼水晶琶音、母巢核爆重低音。

## 一键生成命令 (`siege/run.ts`)
```bash
# 1. 死角搜房撤离模式 (scavenge)
node --experimental-strip-types siege/run.ts 209 --mode scavenge --map canyon-bridge

# 2. 全黑断电旋转探照灯模式 (blackout)
node --experimental-strip-types siege/run.ts 209 --mode blackout --map twin-corridor

# 3. 声呐潜行 + 开枪噪音惊醒尸潮模式 (sonar)
node --experimental-strip-types siege/run.ts 209 --mode sonar --map cross-bunker

# 4. 死角迷宫 3 小队摸黑汇合/同化模式 (maze-infect)
node --experimental-strip-types siege/run.ts 209 --mode maze-infect --map canyon-bridge
```

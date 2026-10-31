# vs-factory — AI 斗蛐蛐 & 赛博音游短视频批量工厂

> 2026-10-30 全面升级：9:16 竖屏爆款视觉 + 真实物理零穿模 + 一键矩阵批量生产 ✅

## 一句话
全自动流水线把「AI 技能对战」与「赛博音乐小球」直接变成 `1080×1920` (9:16) 竖屏短视频：配置/音频进 → 成片与爆款发布文案出，零人工剪辑。

## 目录结构
- [`batch.ts`](batch.ts) — **矩阵化批量短视频生产 CLI**（多模式 × 多主题 × 多球体皮肤 × 多流派合成电音/外部音乐目录 → 一键批量成片 + `batch_publish_sheet.md` 文案表）
- [`music-ball/`](music-ball/BRANCH.md) — **音乐小球竖屏线 (`1080×1920`)**：三大短视频爆款物理模式（赛博琴键回廊 / 重力音阶跳台 / 破壁同心圆环）
- [`duel/`](duel/BRANCH.md) — **技能小人对战竖屏线 (`1080×1920`)**：多英雄组合对战、街机 HUD、像素立绘动画与必杀震屏演出
- [`shared/`](shared/) — 公共引擎：纯 TS 软件光栅器 (`FrameBuf`) / 2000+ 汉字抗锯齿字形图集 (`font.ts` + `supplement.ts`) / 程序化音效 (`sfx.ts`) / 电子音乐合成 / FFmpeg H.264 编码器

---

## 快速开始

### 1. 一键批量生产短视频矩阵 (`batch.ts`)
```bash
# 批量生成 3 条不同模式、不同霓虹主题、不同球体皮肤与配乐的 9:16 音乐小球视频
node batch.ts --workflow music-ball --count 3

# 混合批量生成（音乐小球 + AI 技能对战）共 6 条竖屏短视频
node batch.ts --workflow all --count 6 --seed 100

# 使用你自己的热门音频目录（.mp3 / .wav）批量生成卡点短视频
node batch.ts --workflow music-ball --audio-dir ./my-songs --count 10
```
批量输出将保存在 `out/batch/` 下，并自动生成：
- `batch_publish_sheet.md`：每条视频配套的抖音/TikTok/快手/Shorts **爆款标题、黄金前3秒钩子、置顶评论互动话术、热门话题标签**
- `batch_manifest.json`：结构化元信息清单（供自动发布脚本直接消费）

### 2. 单条音乐小球视频生成 (`music-ball/run.ts`)
支持三大短视频平台爆款物理模式（默认 `1080×1920` 竖屏，加 `--aspect 16:9` 可切换横屏）：

```bash
# 模式 1：赛博琴键回廊 (corridor) —— 左右垂直霓虹琴键墙体 + 45°折线激光反弹 + 键位受击回缩
node music-ball/run.ts song.mp3 out/corridor.mp4 17 --mode corridor --theme cyber-neon --skin visor-bot

# 模式 2：重力音阶跳台 (hopper) —— 4车道交错3D发光跳板 + 因果向上高抛物线跳跃 + 弹簧踏板下压
node music-ball/run.ts song.mp3 out/hopper.mp4 29 --mode hopper --theme synthwave-sunset --skin star-core

# 模式 3：破壁同心圆环 (rings) —— 旋转多层霓虹同心圆环 + 弦向反弹 + 重拍整环碎裂解压爆破
node music-ball/run.ts song.mp3 out/rings.mp4 42 --mode rings --theme emerald-matrix --skin vinyl-disc
```

可选参数：
- `--mode`: `corridor` | `hopper` | `rings`（兼容旧别名 `natural` / `impact`）
- `--theme`: `cyber-neon` | `synthwave-sunset` | `emerald-matrix` | `crimson-void` | `aurora-ice`
- `--skin`: `visor-bot` | `star-core` | `vinyl-disc` | `plasma-orb` | `cat-neon`
- `--aspect`: `9:16`（默认竖屏 `1080×1920`）| `16:9`（横屏 `1920×1080`）

### 3. 单条 AI 技能对战视频生成 (`duel/run.ts`)
```bash
node duel/run.ts 77              # → out/duel/duel_77.mp4 (1080x1920, ~30s)
node duel/run.ts 42 --cold-open  # 先打后卡黄金前3秒版本
```
支持 4 组宿命对决阵容（根据 seed 自动轮换）：
1. 南瓜骑士 vs 火焰史莱姆（反伤荆棘 vs 狂暴连击）
2. 冰霜女巫 vs 雷霆狂战（极寒叠毒 vs 雷霆斩杀）
3. 暗影刺客 vs 圣光机甲（暴击流血 vs 圣盾反震）
4. 虚空术士 vs 荒野巨兽（深渊腐蚀 vs 蛮荒冲撞）

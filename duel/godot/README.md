# duel Godot 回放层

角色设定：南瓜骑士 vs 火焰史莱姆。

- TS 继续负责漫游、碰墙反弹、接触触发技能、技能效果与胜负。
- Godot 负责 2D 回放、Sprite Sheet、Q版像素角色、粒子和镜头。
- ChatGPT 图像生成规范见 `prompts/character-sheet.md`。
- Godot 未在当前机器 PATH 中发现；安装 Godot 4.x 后打开此目录即可运行。
- 当前 `replay.gd` 含可运行的几何占位角色，待将生成的 288x288 Sprite Sheet 放入 `art/` 后替换。

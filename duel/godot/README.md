# duel Godot 回放层

当前已经接入真实 Sprite Sheet 播放，不再使用几何占位角色。

角色：南瓜骑士 vs 火焰史莱姆。

- `art/pumpkin_knight_sheet.png`：真实 RGBA 像素 Sprite Sheet
- `art/fire_slime_sheet.png`：真实 RGBA 像素 Sprite Sheet
- `events.jsonl`：由当前 TS 模拟器生成的回放事件
- `scripts/replay.gd`：按 JSONL 事件播放 idle / walk / cast / hit / death / skill
- `scenes/replay.tscn`：加载两张真实纹理

TS 继续负责漫游、碰墙反弹、接触触发技能、技能效果与胜负；Godot 负责 Sprite、动画、
小型技能粒子和回放画面。当前机器未检测到 Godot 4.x，安装后打开 `project.godot` 即可运行。

ChatGPT 角色生成提示词见 `prompts/character-sheet.md`。当前内置 PNG 是可运行的第一版像素
资产，之后可以直接用 ChatGPT 生成并裁切后的同名 PNG 替换。

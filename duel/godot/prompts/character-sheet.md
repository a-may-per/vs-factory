# ChatGPT 图像生成提示词：48px Q版像素 Sprite Sheet

## 共用前缀
```text
Create a clean 48x48 pixel-art sprite sheet for a vertical short-video arena game.
Cute chibi proportions, bold dark 1px outline, saturated readable colors,
transparent background, strict nearest-neighbor pixel edges, no anti-aliasing,
front-facing side-view character, all cells aligned to an exact 48x48 grid.
Do not add text, labels, shadows outside the cells, scenery, UI, or extra characters.
Use the same character design, palette, proportions, weapon/accessory and face in every frame.
```

## 南瓜骑士
```text
A tiny cute pumpkin knight: orange pumpkin helmet with one green leaf,
small navy cape, cream tunic, stubby brown boots, short teal sword and round shield.
Warm orange / teal / cream palette. Brave but funny expression.
```

## 火焰史莱姆
```text
A tiny cute fire slime: translucent red-orange jelly body, yellow-orange core,
small flame tuft on top, two expressive eyes, tiny ember particles kept inside the cell.
Warm red / orange / yellow palette. Mischievous happy expression.
```

## 帧布局

Generate one sheet with 6 rows and 6 columns, transparent background, no gutters:

| row | animation | frames |
|---|---|---:|
| 1 | idle | 4 frames, repeat + 2 empty cells |
| 2 | walk | 4 frames, repeat + 2 empty cells |
| 3 | cast | 4 frames, repeat + 2 empty cells |
| 4 | hit | 4 frames, repeat + 2 empty cells |
| 5 | death | 4 frames, repeat + 2 empty cells |
| 6 | signature skill | 6 frames |

After generation, inspect at 800% and export PNG with nearest-neighbor scaling. The AI image is
an art source, not a trusted grid: manually align/crop every 48x48 cell before importing Godot.

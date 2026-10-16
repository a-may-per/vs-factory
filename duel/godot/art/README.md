# Godot art assets

The current files are real transparent RGBA Sprite Sheets generated for the first playable replay:

- `pumpkin_knight_sheet.png` — 288x288, 6×6 cells, 48px per cell
- `fire_slime_sheet.png` — 288x288, 6×6 cells, 48px per cell

Rows are `idle`, `walk`, `cast`, `hit`, `death`, `skill`; base actions use four frames and the
skill row uses six. They are deliberately simple first-pass Q-style pixel art. Replace these
files with ChatGPT-generated sheets using the prompt in `../prompts/character-sheet.md`; the
Godot scene and frame protocol remain unchanged.

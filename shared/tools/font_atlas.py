#!/usr/bin/env python3
"""从字体生成字形图集 (PNG) + 度量 (JSON)，供 TS 光栅器做 drawtext。
用法: font_atlas.py <font_path> <font_index> <size> <charset_file> <out_png> <out_json>
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

def main():
    font_path, font_index, size, charset_file, out_png, out_json = sys.argv[1:7]
    font_index, size = int(font_index), int(size)
    font = ImageFont.truetype(font_path, size, index=font_index)
    chars = open(charset_file, encoding="utf-8").read()
    chars = "".join(dict.fromkeys(c for c in chars if not c.isspace() or c == " "))
    pad = 2
    # 度量
    asc, desc = font.getmetrics()
    tiles = []
    x = 0
    per_row = 24
    rows = (len(chars) + per_row - 1) // per_row
    tile_w = size + pad * 2
    img = Image.new("RGBA", (per_row * tile_w, rows * tile_w), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    meta = {"size": size, "tile_w": tile_w, "per_row": per_row, "asc": asc, "desc": desc, "glyphs": {}}
    for i, ch in enumerate(chars):
        gx, gy = (i % per_row) * tile_w, (i // per_row) * tile_w
        d.text((gx + pad, gy + pad), ch, font=font, fill=(255, 255, 255, 255))
        w = font.getlength(ch)
        meta["glyphs"][ch] = {"x": gx, "y": gy, "w": round(w), "aw": round(w) + pad * 2}
    img.save(out_png)
    open(out_png.replace(".png", ".rgba"), "wb").write(img.tobytes())
    meta["img_w"], meta["img_h"] = img.size
    json.dump(meta, open(out_json, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"atlas: {len(chars)} glyphs -> {out_png}")

if __name__ == "__main__":
    main()

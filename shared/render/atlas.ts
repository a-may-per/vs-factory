// 字形图集：加载 .rgba + .json，提供 alpha 混合贴字（水平排版 + 缩放）。
import { readFileSync } from "node:fs";
import type { FrameBuf, RGBA } from "./framebuf.ts";

export interface GlyphMeta {
  size: number; tile_w: number; per_row: number; asc: number; desc: number;
  img_w: number; img_h: number;
  glyphs: Record<string, { x: number; y: number; w: number; aw: number }>;
}

export class FontAtlas {
  readonly meta: GlyphMeta;
  readonly rgba: Uint8Array;

  constructor(rgbaPath: string, jsonPath: string) {
    this.meta = JSON.parse(readFileSync(jsonPath, "utf-8"));
    this.rgba = readFileSync(rgbaPath);
    const expect = this.meta.img_w * this.meta.img_h * 4;
    if (this.rgba.length !== expect) throw new Error(`atlas size mismatch: ${this.rgba.length} != ${expect}`);
  }

  /** 文本像素宽 */
  measure(text: string): number {
    let w = 0;
    for (const ch of text) {
      const g = this.meta.glyphs[ch];
      if (g) w += g.aw; else w += this.meta.size * 0.5;
    }
    return w;
  }

  /** 将一行文字 alpha 混合到 fb。scale 可缩小放大（最近邻）。 */
  draw(fb: FrameBuf, text: string, x: number, y: number, color: RGBA, scale = 1, align: "left"|"center"|"right" = "left"): void {
    const textW = this.measure(text) * scale;
    let cx = align === "center" ? x - textW / 2 : align === "right" ? x - textW : x;
    const top = y;
    for (const ch of text) {
      const g = this.meta.glyphs[ch];
      if (!g) { cx += this.meta.size * 0.5 * scale; continue; }
      this.blitGlyph(fb, g, Math.round(cx), Math.round(top), color, scale);
      cx += g.aw * scale;
    }
  }

  private blitGlyph(fb: FrameBuf, g: {x:number;y:number;w:number;aw:number}, dx: number, dy: number, color: RGBA, scale: number): void {
    const m = this.meta;
    const gw = Math.min(g.w + 4, m.tile_w - 2), gh = Math.min(m.size + 2, m.tile_w - 2);
    const tw = m.img_w;
    const a = color[3] / 255;
    const x0 = Math.max(0, dx - 2), y0 = Math.max(0, dy - 2);
    const x1 = Math.min(fb.w - 1, dx + gw * scale + 2), y1 = Math.min(fb.h - 1, dy + gh * scale + 2);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        // 目标像素 -> 图集坐标（最近邻）
        const sx = g.x + Math.floor((px - dx) / scale);
        const sy = g.y + Math.floor((py - dy) / scale);
        if (sx < g.x || sx >= g.x + gw || sy < g.y || sy >= g.y + gh) continue;
        const si = (sy * tw + sx) * 4 + 3; // alpha 通道
        const sa = this.rgba[si] / 255 * a;
        if (sa <= 0) continue;
        const di = (py * fb.w + px) * 4;
        fb.data[di]   = fb.data[di]*(1-sa) + color[0]*sa;
        fb.data[di+1] = fb.data[di+1]*(1-sa) + color[1]*sa;
        fb.data[di+2] = fb.data[di+2]*(1-sa) + color[2]*sa;
        fb.data[di+3] = 255;
      }
    }
  }
}

// Pre-rendered glyph atlas loader & blitter with bilinear smoothing,
// supplemental CJK/symbol glyph fallback, 8-way outlines, and drop shadows.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { FrameBuf, type RGBA } from "./framebuf.ts";
import {
  SUPPLEMENT_ALPHA_B64,
  SUPPLEMENT_GLYPHS,
  SUPPLEMENT_SIZE,
  SUPPLEMENT_TILE,
} from "../fonts/supplement.ts";

interface GlyphInfo {
  x: number;
  y: number;
  w: number;
  aw: number;
  ox?: number;
}

// Proportional advance-width & horizontal draw-offset overrides (at base size 64)
// Fixes full-tile (aw=68) padding on left-aligned or right-aligned punctuation in atlas64/96.
const PROPORTIONAL_PUNCT_64: Record<string, { aw: number; ox?: number }> = {
  "·": { aw: 26, ox: -5 },
  "，": { aw: 34 },
  "。": { aw: 36 },
  "、": { aw: 34 },
  "！": { aw: 34 },
  "？": { aw: 38 },
  "：": { aw: 32 },
  "；": { aw: 32 },
  "（": { aw: 34, ox: -34 },
  "）": { aw: 34 },
  "「": { aw: 34, ox: -34 },
  "」": { aw: 34 },
  "『": { aw: 36, ox: -32 },
  "』": { aw: 36 },
  "《": { aw: 40, ox: -24 },
  "》": { aw: 40 },
  "♪": { aw: 42 },
  "×": { aw: 42 },
  "в": { aw: 40 },
  "о": { aw: 40 },
  "п": { aw: 40 },
  "р": { aw: 40 },
  "с": { aw: 40 },
  "а": { aw: 40 },
  "х": { aw: 40 },
};

interface AtlasMeta {
  size: number;
  tile_w: number;
  per_row: number;
  asc: number;
  desc: number;
  img_w: number;
  img_h: number;
  glyphs: Record<string, GlyphInfo>;
}

export interface TextStyleOptions {
  outlineWidth?: number;
  outlineColor?: RGBA;
  shadowOffset?: [number, number];
  shadowColor?: RGBA;
  letterSpacing?: number;
}

let cachedSupplementAlpha: Uint8Array | null = null;
function getSupplementAlpha(): Uint8Array {
  if (cachedSupplementAlpha) return cachedSupplementAlpha;
  const zbuf = Buffer.from(SUPPLEMENT_ALPHA_B64, "base64");
  const packed = inflateRawSync(zbuf.subarray(2, zbuf.length - 4));
  const out = new Uint8Array(packed.length * 2);
  for (let i = 0; i < packed.length; i++) {
    const b = packed[i];
    const hi = (b >> 4) & 0x0f;
    const lo = b & 0x0f;
    out[i * 2] = hi * 17;
    out[i * 2 + 1] = lo * 17;
  }
  cachedSupplementAlpha = out;
  return out;
}

export class FontAtlas {
  readonly size: number;
  readonly tile: number;
  readonly imgW: number;
  readonly imgH: number;
  readonly glyphs: Record<string, GlyphInfo>;
  readonly rgba: Uint8Array;

  constructor(rgbaPath: string, jsonPath: string) {
    const meta = JSON.parse(readFileSync(jsonPath, "utf8")) as AtlasMeta;
    this.size = meta.size;
    this.tile = meta.tile_w;
    this.imgW = meta.img_w;
    this.imgH = meta.img_h;
    this.glyphs = meta.glyphs;
    const sizeRatio = this.size / 64;
    for (const [ch, fix] of Object.entries(PROPORTIONAL_PUNCT_64)) {
      const g = this.glyphs[ch];
      if (g) {
        g.aw = Math.round(fix.aw * sizeRatio);
        if (fix.ox !== undefined) {
          g.ox = fix.ox * sizeRatio;
        }
      }
    }
    this.rgba = new Uint8Array(readFileSync(rgbaPath));
  }

  private getCharAdvance(ch: string): number {
    const g = this.glyphs[ch];
    if (g) return g.aw;
    const sg = SUPPLEMENT_GLYPHS[ch];
    if (sg) return sg[2] * (this.size / SUPPLEMENT_SIZE);
    return ch.charCodeAt(0) > 127 ? this.size : this.size * 0.45;
  }

  /**
   * 测量字符串在指定缩放倍率下的像素宽度（默认 scale = 1 即原始字号）。
   */
  measure(text: string, scale = 1, letterSpacing = 0): number {
    let w = 0;
    let count = 0;
    for (const ch of text) {
      w += this.getCharAdvance(ch) * scale;
      count++;
    }
    if (count > 1 && letterSpacing !== 0) {
      w += (count - 1) * letterSpacing;
    }
    return w;
  }

  private alignX(
    text: string,
    x: number,
    scale: number,
    align: "left" | "center" | "right",
    letterSpacing = 0,
  ): number {
    if (align === "left") return x;
    const w = this.measure(text, scale, letterSpacing);
    return align === "center" ? x - w * 0.5 : x - w;
  }

  /**
   * 绘制单层平滑文本（scale 为相对字集原始尺寸的缩放倍率，如 0.5、1.0）。
   */
  draw(
    fb: FrameBuf,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    scale = 1,
    align: "left" | "center" | "right" = "left",
    letterSpacing = 0,
  ): void {
    const alpha = (color[3] ?? 255) / 255;
    if (alpha <= 0.005 || !text || scale <= 0.01) return;
    let cx = this.alignX(text, x, scale, align, letterSpacing);
    const [r, g, b] = color;
    const suppRatio = this.size / SUPPLEMENT_SIZE;

    for (const ch of text) {
      const gi = this.glyphs[ch];
      if (gi) {
        const drawX = cx + (gi.ox ?? 0) * scale;
        this.blitGlyphBilinear(fb, gi, drawX, y, scale, r, g, b, alpha);
        cx += gi.aw * scale + letterSpacing;
        continue;
      }
      const sg = SUPPLEMENT_GLYPHS[ch];
      if (sg) {
        const suppScale = scale * suppRatio;
        this.blitSupplementGlyph(fb, sg[0], cx, y, suppScale, r, g, b, alpha);
        cx += sg[2] * suppScale + letterSpacing;
        continue;
      }
      cx += (ch.charCodeAt(0) > 127 ? this.size : this.size * 0.45) * scale + letterSpacing;
    }
  }

  /**
   * 绘制带投影与 8 向描边的立体电竞文本。
   */
  drawStyled(
    fb: FrameBuf,
    text: string,
    x: number,
    y: number,
    color: RGBA,
    scale = 1,
    align: "left" | "center" | "right" = "left",
    opts: TextStyleOptions = {},
  ): void {
    const mainAlphaFrac = (color[3] ?? 255) / 255;
    if (mainAlphaFrac <= 0.005 || !text || scale <= 0.01) return;
    const spacing = opts.letterSpacing ?? 0;
    const startX = this.alignX(text, x, scale, align, spacing);

    if (opts.shadowOffset && opts.shadowColor) {
      const [sx, sy] = opts.shadowOffset;
      const sc: RGBA = [
        opts.shadowColor[0],
        opts.shadowColor[1],
        opts.shadowColor[2],
        Math.round(opts.shadowColor[3] * mainAlphaFrac),
      ];
      this.draw(fb, text, startX + sx, y + sy, sc, scale, "left", spacing);
    }

    if (opts.outlineWidth && opts.outlineWidth > 0 && opts.outlineColor) {
      const ow = opts.outlineWidth;
      const oc: RGBA = [
        opts.outlineColor[0],
        opts.outlineColor[1],
        opts.outlineColor[2],
        Math.round(opts.outlineColor[3] * mainAlphaFrac),
      ];
      const d = ow * 0.72;
      const dirs: Array<[number, number]> = [
        [-ow, 0],
        [ow, 0],
        [0, -ow],
        [0, ow],
        [-d, -d],
        [d, -d],
        [-d, d],
        [d, d],
      ];
      for (const [dx, dy] of dirs) {
        this.draw(fb, text, startX + dx, y + dy, oc, scale, "left", spacing);
      }
    }

    this.draw(fb, text, startX, y, color, scale, "left", spacing);
  }

  private blitGlyphBilinear(
    fb: FrameBuf,
    g: GlyphInfo,
    x: number,
    y: number,
    scale: number,
    r: number,
    gr: number,
    b: number,
    alpha: number,
  ): void {
    const tile = this.tile;
    const dw = Math.ceil(tile * scale);
    const dh = Math.ceil(tile * scale);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const invScale = 1 / scale;
    const imgW = this.imgW;
    const rgba = this.rgba;
    const fbW = fb.w;
    const fbH = fb.h;
    const data = fb.data;

    const dyStart = Math.max(0, -y0);
    const dyEnd = Math.min(dh, fbH - y0);
    const dxStart = Math.max(0, -x0);
    const dxEnd = Math.min(dw, fbW - x0);

    for (let dy = dyStart; dy < dyEnd; dy++) {
      const py = y0 + dy;
      const fy = dy * invScale;
      const sy0 = Math.min(tile - 1, fy | 0);
      const sy1 = Math.min(tile - 1, sy0 + 1);
      const wy = fy - sy0;
      const row0 = (g.y + sy0) * imgW + g.x;
      const row1 = (g.y + sy1) * imgW + g.x;
      const pyRow = py * fbW;

      for (let dx = dxStart; dx < dxEnd; dx++) {
        const fx = dx * invScale;
        const sx0 = Math.min(tile - 1, fx | 0);
        const sx1 = Math.min(tile - 1, sx0 + 1);
        const wx = fx - sx0;

        const a00 = rgba[(row0 + sx0) * 4 + 3];
        const a10 = rgba[(row0 + sx1) * 4 + 3];
        const a01 = rgba[(row1 + sx0) * 4 + 3];
        const a11 = rgba[(row1 + sx1) * 4 + 3];
        if ((a00 | a10 | a01 | a11) === 0) continue;

        const top = a00 + (a10 - a00) * wx;
        const bot = a01 + (a11 - a01) * wx;
        const sa = top + (bot - top) * wy;
        const a = (sa / 255) * alpha;
        if (a <= 0.01) continue;

        const di = (pyRow + x0 + dx) * 4;
        const inv = 1 - a;
        data[di] = (data[di] * inv + r * a) | 0;
        data[di + 1] = (data[di + 1] * inv + gr * a) | 0;
        data[di + 2] = (data[di + 2] * inv + b * a) | 0;
        data[di + 3] = 255;
      }
    }
  }

  private blitSupplementGlyph(
    fb: FrameBuf,
    glyphIdx: number,
    x: number,
    y: number,
    scale: number,
    r: number,
    gr: number,
    b: number,
    alpha: number,
  ): void {
    const supp = getSupplementAlpha();
    const tile = SUPPLEMENT_TILE;
    const baseOffset = glyphIdx * tile * tile;
    const dw = Math.ceil(tile * scale);
    const dh = Math.ceil(tile * scale);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const invScale = 1 / scale;
    const fbW = fb.w;
    const fbH = fb.h;
    const data = fb.data;

    const dyStart = Math.max(0, -y0);
    const dyEnd = Math.min(dh, fbH - y0);
    const dxStart = Math.max(0, -x0);
    const dxEnd = Math.min(dw, fbW - x0);

    for (let dy = dyStart; dy < dyEnd; dy++) {
      const py = y0 + dy;
      const fy = dy * invScale;
      const sy0 = Math.min(tile - 1, fy | 0);
      const sy1 = Math.min(tile - 1, sy0 + 1);
      const wy = fy - sy0;
      const row0 = baseOffset + sy0 * tile;
      const row1 = baseOffset + sy1 * tile;
      const pyRow = py * fbW;

      for (let dx = dxStart; dx < dxEnd; dx++) {
        const fx = dx * invScale;
        const sx0 = Math.min(tile - 1, fx | 0);
        const sx1 = Math.min(tile - 1, sx0 + 1);
        const wx = fx - sx0;

        const a00 = supp[row0 + sx0];
        const a10 = supp[row0 + sx1];
        const a01 = supp[row1 + sx0];
        const a11 = supp[row1 + sx1];
        if ((a00 | a10 | a01 | a11) === 0) continue;

        const top = a00 + (a10 - a00) * wx;
        const bot = a01 + (a11 - a01) * wx;
        const sa = top + (bot - top) * wy;
        const a = (sa / 255) * alpha;
        if (a <= 0.01) continue;

        const di = (pyRow + x0 + dx) * 4;
        const inv = 1 - a;
        data[di] = (data[di] * inv + r * a) | 0;
        data[di + 1] = (data[di + 1] * inv + gr * a) | 0;
        data[di + 2] = (data[di + 2] * inv + b * a) | 0;
        data[di + 3] = 255;
      }
    }
  }
}

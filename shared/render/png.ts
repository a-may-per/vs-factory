// 零依赖 PNG 解码器 + 像素精灵图集渲染器（支持缩放、镜像、受击闪白、描边发光、残影）。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import type { FrameBuf, RGBA } from "./framebuf.ts";

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array; // RGBA 8-bit
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(path: string): DecodedPng {
  const buf = readFileSync(path);
  // Check PNG signature
  if (
    buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47 ||
    buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a
  ) {
    throw new Error(`Invalid PNG file: ${path}`);
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (type === "IHDR") {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4; // skip CRC
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format (bitDepth=${bitDepth}, colorType=${colorType}) in ${path}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const out = new Uint8Array(width * height * 4);
  const prevRow = new Uint8Array(stride);
  const curRow = new Uint8Array(stride);

  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    for (let i = 0; i < stride; i++) {
      const x = raw[inPos++];
      const a = i >= bpp ? curRow[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 0xff;
      else if (filter === 2) val = (x + b) & 0xff;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) val = (x + paethPredictor(a, b, c)) & 0xff;
      curRow[i] = val;
    }

    const rowOut = y * width * 4;
    if (bpp === 4) {
      out.set(curRow, rowOut);
    } else {
      for (let x = 0; x < width; x++) {
        const si = x * 3;
        const di = rowOut + x * 4;
        out[di] = curRow[si];
        out[di + 1] = curRow[si + 1];
        out[di + 2] = curRow[si + 2];
        out[di + 3] = 255;
      }
    }
    prevRow.set(curRow);
  }

  return { width, height, data: out };
}

export interface SpriteBlitOptions {
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  flipX?: boolean;
  alpha?: number;
  /** 受击闪白或染色混合 [r, g, b, mix(0..1)] */
  tint?: [number, number, number, number];
  /** 外发光/描边颜色 [r, g, b, a] */
  outlineColor?: RGBA;
  /** 像素级描边宽度（以源像素为单位，默认 1） */
  outlinePx?: number;
}

export class SpriteSheet {
  readonly png: DecodedPng;
  readonly cellW: number;
  readonly cellH: number;
  readonly cols: number;
  readonly rows: number;

  constructor(path: string, cellW = 48, cellH = 48) {
    this.png = decodePng(path);
    this.cellW = cellW;
    this.cellH = cellH;
    this.cols = Math.floor(this.png.width / cellW);
    this.rows = Math.floor(this.png.height / cellH);
  }

  /**
   * 将指定帧 (col, row) 绘制到 FrameBuf，锚点 (anchorX, anchorY) 为精灵底部中心。
   */
  drawFrame(
    fb: FrameBuf,
    col: number,
    row: number,
    anchorX: number,
    anchorY: number,
    opts: SpriteBlitOptions = {},
  ): void {
    const c = ((col % this.cols) + this.cols) % this.cols;
    const r = Math.max(0, Math.min(this.rows - 1, row));
    const baseScale = opts.scale ?? 1;
    const sx = Math.max(0.05, opts.scaleX ?? baseScale);
    const sy = Math.max(0.05, opts.scaleY ?? baseScale);
    const flipX = Boolean(opts.flipX);
    const alphaMul = Math.max(0, Math.min(1, opts.alpha ?? 1));
    if (alphaMul <= 0.001) return;

    const dstW = this.cellW * sx;
    const dstH = this.cellH * sy;
    const left = anchorX - dstW * 0.5;
    const top = anchorY - dstH;

    const x0 = Math.max(0, Math.floor(left - 4));
    const x1 = Math.min(fb.w - 1, Math.ceil(left + dstW + 4));
    const y0 = Math.max(0, Math.floor(top - 4));
    const y1 = Math.min(fb.h - 1, Math.ceil(top + dstH + 4));

    const srcX0 = c * this.cellW;
    const srcY0 = r * this.cellH;
    const imgW = this.png.width;
    const src = this.png.data;

    const tint = opts.tint;
    const outline = opts.outlineColor;
    const outDist = opts.outlinePx ?? 1;

    const sampleAlpha = (lx: number, ly: number): number => {
      if (lx < 0 || lx >= this.cellW || ly < 0 || ly >= this.cellH) return 0;
      return src[((srcY0 + ly) * imgW + (srcX0 + lx)) * 4 + 3];
    };

    for (let py = y0; py <= y1; py++) {
      const uY = (py + 0.5 - top) / dstH;
      const ly = Math.floor(uY * this.cellH);
      if (ly < -outDist || ly >= this.cellH + outDist) continue;

      for (let px = x0; px <= x1; px++) {
        let uX = (px + 0.5 - left) / dstW;
        if (flipX) uX = 1 - uX;
        const lx = Math.floor(uX * this.cellW);
        if (lx < -outDist || lx >= this.cellW + outDist) continue;

        let sr = 0, sg = 0, sb = 0, sa = 0;
        if (lx >= 0 && lx < this.cellW && ly >= 0 && ly < this.cellH) {
          const si = ((srcY0 + ly) * imgW + (srcX0 + lx)) * 4;
          sr = src[si];
          sg = src[si + 1];
          sb = src[si + 2];
          sa = src[si + 3];
        }

        if (sa < 16) {
          // 检查是否在描边范围内
          if (outline && outline[3] > 0) {
            const neighborAlpha = Math.max(
              sampleAlpha(lx - 1, ly),
              sampleAlpha(lx + 1, ly),
              sampleAlpha(lx, ly - 1),
              sampleAlpha(lx, ly + 1),
            );
            if (neighborAlpha >= 64) {
              const oa = (outline[3] / 255) * alphaMul;
              const di = (py * fb.w + px) * 4;
              fb.data[di] = fb.data[di] * (1 - oa) + outline[0] * oa;
              fb.data[di + 1] = fb.data[di + 1] * (1 - oa) + outline[1] * oa;
              fb.data[di + 2] = fb.data[di + 2] * (1 - oa) + outline[2] * oa;
              fb.data[di + 3] = 255;
            }
          }
          continue;
        }

        if (tint && tint[3] > 0) {
          const tm = Math.max(0, Math.min(1, tint[3]));
          sr = sr * (1 - tm) + tint[0] * tm;
          sg = sg * (1 - tm) + tint[1] * tm;
          sb = sb * (1 - tm) + tint[2] * tm;
        }

        const a = (sa / 255) * alphaMul;
        const di = (py * fb.w + px) * 4;
        if (a >= 0.995) {
          fb.data[di] = sr;
          fb.data[di + 1] = sg;
          fb.data[di + 2] = sb;
          fb.data[di + 3] = 255;
        } else {
          fb.data[di] = fb.data[di] * (1 - a) + sr * a;
          fb.data[di + 1] = fb.data[di + 1] * (1 - a) + sg * a;
          fb.data[di + 2] = fb.data[di + 2] * (1 - a) + sb * a;
          fb.data[di + 3] = 255;
        }
      }
    }
  }
}

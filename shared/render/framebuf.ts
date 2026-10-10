// 最小软件光栅器：RGBA 帧缓冲 + 填充矩形 + 字形图集贴字。零依赖。

export type RGBA = [number, number, number, number];

export class FrameBuf {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number, bg?: RGBA) {
    this.w = w; this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
    if (bg) this.fillRect(0, 0, w, h, bg);
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      let i = (py * this.w + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.data[i] = c[0]; this.data[i+1] = c[1]; this.data[i+2] = c[2]; this.data[i+3] = c[3];
        i += 4;
      }
    }
  }

  // alpha 混合矩形（用于光效/暗场）
  blendRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const a = c[3] / 255;
    if (a >= 1) { this.fillRect(x, y, w, h, c); return; }
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      let i = (py * this.w + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.data[i]   = this.data[i]   * (1-a) + c[0] * a;
        this.data[i+1] = this.data[i+1] * (1-a) + c[1] * a;
        this.data[i+2] = this.data[i+2] * (1-a) + c[2] * a;
        this.data[i+3] = 255; i += 4;
      }
    }
  }

  /** 画描边圆（实心） */
  fillCircle(cx: number, cy: number, r: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        if (dx*dx + dy*dy <= r2) {
          const i = (py * this.w + px) * 4;
          this.data[i] = c[0]; this.data[i+1] = c[1]; this.data[i+2] = c[2]; this.data[i+3] = c[3];
        }
      }
    }
  }

  blendCircle(cx: number, cy: number, r: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - cx, dy = py - cy;
        if (dx*dx + dy*dy <= r2) {
          const i = (py * this.w + px) * 4;
          const a = c[3] / 255;
          this.data[i]   = this.data[i]*(1-a) + c[0]*a;
          this.data[i+1] = this.data[i+1]*(1-a) + c[1]*a;
          this.data[i+2] = this.data[i+2]*(1-a) + c[2]*a;
          this.data[i+3] = 255;
        }
      }
    }
  }

  /** 给 ffmpeg 的 rawvideo 管道。ffmpeg 期望 rgba 数据带每行 padding=0。 */
  readonly bytes: Uint8Array = new Uint8Array(0);

  *rows(): IterableIterator<Uint8Array> {
    for (let y = 0; y < this.h; y++) {
      yield this.data.subarray(y * this.w * 4, (y+1) * this.w * 4);
    }
  }
}

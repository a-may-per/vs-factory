// 软件光栅器：RGBA 帧缓冲 + 抗锯齿圆角矩形/渐变/圆弧/发光/电竞 HUD 组件。零依赖。

export type RGBA = [number, number, number, number];

export interface CardStyle {
  bgTop: RGBA;
  bgBottom?: RGBA;
  border?: RGBA;
  borderWidth?: number;
  radius?: number;
  shadowAlpha?: number;
  shadowOffsetY?: number;
  topHighlight?: RGBA;
  accentColor?: RGBA;
  accentSide?: "left" | "right" | "top" | "bottom";
}

export interface ProgressBarStyle {
  radius?: number;
  bgColor?: RGBA;
  borderColor?: RGBA;
  fgStart: RGBA;
  fgEnd?: RGBA;
  ghostFrac?: number;
  ghostColor?: RGBA;
  alignRight?: boolean;
  gloss?: boolean;
  segments?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 圆角矩形有向距离函数（SDF）：负值在内部，0 在边界，正值在外部。 */
function sdRoundRect(px: number, py: number, cx: number, cy: number, halfW: number, halfH: number, r: number): number {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const outDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inDist = Math.min(Math.max(qx, qy), 0);
  return outDist + inDist - r;
}

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
    if (a <= 0) return;
    if (a >= 1) { this.fillRect(x, y, w, h, c); return; }
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    const invA = 1 - a;
    const cr = c[0] * a, cg = c[1] * a, cb = c[2] * a;
    for (let py = y0; py < y1; py++) {
      let i = (py * this.w + x0) * 4;
      for (let px = x0; px < x1; px++) {
        this.data[i]   = this.data[i]   * invA + cr;
        this.data[i+1] = this.data[i+1] * invA + cg;
        this.data[i+2] = this.data[i+2] * invA + cb;
        this.data[i+3] = 255; i += 4;
      }
    }
  }

  /** 线性渐变矩形（支持垂直或水平渐变） */
  blendGradientRect(x: number, y: number, w: number, h: number, cStart: RGBA, cEnd: RGBA, vertical = true): void {
    if (w <= 0 || h <= 0) return;
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      const ty = h > 1 ? clamp((py - y) / h, 0, 1) : 0;
      let i = (py * this.w + x0) * 4;
      for (let px = x0; px < x1; px++) {
        const t = vertical ? ty : (w > 1 ? clamp((px - x) / w, 0, 1) : 0);
        const a = (cStart[3] + (cEnd[3] - cStart[3]) * t) / 255;
        if (a > 0) {
          const r = cStart[0] + (cEnd[0] - cStart[0]) * t;
          const g = cStart[1] + (cEnd[1] - cStart[1]) * t;
          const b = cStart[2] + (cEnd[2] - cStart[2]) * t;
          const invA = 1 - a;
          this.data[i]   = this.data[i]   * invA + r * a;
          this.data[i+1] = this.data[i+1] * invA + g * a;
          this.data[i+2] = this.data[i+2] * invA + b * a;
          this.data[i+3] = 255;
        }
        i += 4;
      }
    }
  }

  /** 抗锯齿圆角矩形填充（SDF） */
  fillRoundRect(x: number, y: number, w: number, h: number, radius: number, c: RGBA): void {
    this.blendRoundRect(x, y, w, h, radius, c);
  }

  /** 抗锯齿圆角矩形混合（SDF） */
  blendRoundRect(x: number, y: number, w: number, h: number, radius: number, c: RGBA): void {
    if (w <= 0 || h <= 0 || c[3] <= 0) return;
    const r = Math.max(0, Math.min(radius, w * 0.5, h * 0.5));
    const cx = x + w * 0.5, cy = y + h * 0.5;
    const halfW = w * 0.5, halfH = h * 0.5;
    const x0 = Math.max(0, Math.floor(x - 1)), x1 = Math.min(this.w - 1, Math.ceil(x + w + 1));
    const y0 = Math.max(0, Math.floor(y - 1)), y1 = Math.min(this.h - 1, Math.ceil(y + h + 1));
    const baseA = c[3] / 255;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = sdRoundRect(px + 0.5, py + 0.5, cx, cy, halfW, halfH, r);
        if (d >= 0.75) continue;
        const cov = d <= -0.75 ? 1 : clamp(0.5 - d / 1.5, 0, 1);
        const a = baseA * cov;
        if (a <= 0) continue;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]   * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 抗锯齿渐变圆角矩形（SDF） */
  blendGradientRoundRect(
    x: number, y: number, w: number, h: number, radius: number,
    cStart: RGBA, cEnd: RGBA, vertical = true,
  ): void {
    if (w <= 0 || h <= 0) return;
    const r = Math.max(0, Math.min(radius, w * 0.5, h * 0.5));
    const cx = x + w * 0.5, cy = y + h * 0.5;
    const halfW = w * 0.5, halfH = h * 0.5;
    const x0 = Math.max(0, Math.floor(x - 1)), x1 = Math.min(this.w - 1, Math.ceil(x + w + 1));
    const y0 = Math.max(0, Math.floor(y - 1)), y1 = Math.min(this.h - 1, Math.ceil(y + h + 1));

    for (let py = y0; py <= y1; py++) {
      const ty = h > 1 ? clamp((py + 0.5 - y) / h, 0, 1) : 0;
      for (let px = x0; px <= x1; px++) {
        const d = sdRoundRect(px + 0.5, py + 0.5, cx, cy, halfW, halfH, r);
        if (d >= 0.75) continue;
        const cov = d <= -0.75 ? 1 : clamp(0.5 - d / 1.5, 0, 1);
        const t = vertical ? ty : (w > 1 ? clamp((px + 0.5 - x) / w, 0, 1) : 0);
        const baseA = (cStart[3] + (cEnd[3] - cStart[3]) * t) / 255;
        const a = baseA * cov;
        if (a <= 0) continue;
        const cr = cStart[0] + (cEnd[0] - cStart[0]) * t;
        const cg = cStart[1] + (cEnd[1] - cStart[1]) * t;
        const cb = cStart[2] + (cEnd[2] - cStart[2]) * t;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]   * invA + cr * a;
        this.data[i+1] = this.data[i+1] * invA + cg * a;
        this.data[i+2] = this.data[i+2] * invA + cb * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 抗锯齿圆角矩形描边（SDF） */
  strokeRoundRect(x: number, y: number, w: number, h: number, radius: number, thickness: number, c: RGBA): void {
    if (w <= 0 || h <= 0 || thickness <= 0 || c[3] <= 0) return;
    const r = Math.max(0, Math.min(radius, w * 0.5, h * 0.5));
    const cx = x + w * 0.5, cy = y + h * 0.5;
    const halfW = w * 0.5, halfH = h * 0.5;
    const halfT = thickness * 0.5;
    const x0 = Math.max(0, Math.floor(x - halfT - 2)), x1 = Math.min(this.w - 1, Math.ceil(x + w + halfT + 2));
    const y0 = Math.max(0, Math.floor(y - halfT - 2)), y1 = Math.min(this.h - 1, Math.ceil(y + h + halfT + 2));
    const baseA = c[3] / 255;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        // 仅在边界附近计算
        const d = sdRoundRect(px + 0.5, py + 0.5, cx, cy, halfW, halfH, r);
        const ringDist = Math.abs(d + halfT) - halfT;
        if (ringDist >= 0.75) continue;
        const cov = ringDist <= -0.75 ? 1 : clamp(0.5 - ringDist / 1.5, 0, 1);
        const a = baseA * cov;
        if (a <= 0) continue;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]   * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 画描边圆（实心） */
  fillCircle(cx: number, cy: number, r: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    const baseA = c[3] / 255;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - r;
        if (d >= 0.75) continue;
        const cov = d <= -0.75 ? 1 : clamp(0.5 - d / 1.5, 0, 1);
        const a = baseA * cov;
        const i = (py * this.w + px) * 4;
        if (a >= 0.995) {
          this.data[i] = c[0]; this.data[i+1] = c[1]; this.data[i+2] = c[2]; this.data[i+3] = 255;
        } else {
          const invA = 1 - a;
          this.data[i]   = this.data[i]   * invA + c[0] * a;
          this.data[i+1] = this.data[i+1] * invA + c[1] * a;
          this.data[i+2] = this.data[i+2] * invA + c[2] * a;
          this.data[i+3] = 255;
        }
      }
    }
  }

  blendCircle(cx: number, cy: number, r: number, c: RGBA): void {
    if (r <= 0 || c[3] <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    const baseA = c[3] / 255;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - r;
        if (d >= 0.75) continue;
        const cov = d <= -0.75 ? 1 : clamp(0.5 - d / 1.5, 0, 1);
        const a = baseA * cov;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]*invA + c[0]*a;
        this.data[i+1] = this.data[i+1]*invA + c[1]*a;
        this.data[i+2] = this.data[i+2]*invA + c[2]*a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 柔和径向发光圆（中心最亮，平方衰减到边缘为 0） */
  drawGlowCircle(cx: number, cy: number, r: number, c: RGBA): void {
    if (r <= 0 || c[3] <= 0) return;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    const baseA = c[3] / 255;
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      const dy2 = dy * dy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const d2 = dx * dx + dy2;
        if (d2 >= r2) continue;
        const falloff = 1 - Math.sqrt(d2) / r;
        const a = baseA * falloff * falloff;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]   * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 抗锯齿圆环 */
  strokeRing(cx: number, cy: number, r: number, thickness: number, c: RGBA): void {
    if (r <= 0 || thickness <= 0 || c[3] <= 0) return;
    const halfT = thickness * 0.5;
    const outer = r + halfT + 1;
    const inner = Math.max(0, r - halfT - 1);
    const inner2 = inner * inner;
    const outer2 = outer * outer;
    const x0 = Math.max(0, Math.floor(cx - outer)), x1 = Math.min(this.w - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer)), y1 = Math.min(this.h - 1, Math.ceil(cy + outer));
    const baseA = c[3] / 255;

    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - cy;
      const dy2 = dy * dy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const d2 = dx * dx + dy2;
        if (d2 < inner2 || d2 > outer2) continue;
        const dist = Math.abs(Math.sqrt(d2) - r) - halfT;
        if (dist >= 0.75) continue;
        const cov = dist <= -0.75 ? 1 : clamp(0.5 - dist / 1.5, 0, 1);
        const a = baseA * cov;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i]   = this.data[i]   * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 圆弧/刀光（支持渐变宽度或满圆弧） */
  drawArc(
    cx: number, cy: number, r: number, thickness: number,
    startAngle: number, endAngle: number, c: RGBA, taper = false,
  ): void {
    const span = endAngle - startAngle;
    const steps = Math.max(8, Math.ceil(Math.abs(span) * r / Math.max(1.5, thickness * 0.35)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = startAngle + span * t;
      const wFactor = taper ? Math.sin(t * Math.PI) : 1;
      const rad = Math.max(1, (thickness * 0.5) * wFactor);
      const alpha = taper ? Math.round(c[3] * (0.35 + 0.65 * wFactor)) : c[3];
      this.blendCircle(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, rad, [c[0], c[1], c[2], alpha]);
    }
  }

  /** 旋转矩形：用于斜踏板/墙面。angle 为弧度。 */
  fillRotatedRect(cx: number, cy: number, w: number, h: number, angle: number, c: RGBA): void {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const rx = Math.abs(ca) * w / 2 + Math.abs(sa) * h / 2;
    const ry = Math.abs(sa) * w / 2 + Math.abs(ca) * h / 2;
    const x0 = Math.max(0, Math.floor(cx - rx - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + ry + 1));
    const halfW = w * 0.5, halfH = h * 0.5;
    const baseA = c[3] / 255;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
        const lx = Math.abs(dx * ca + dy * sa) - halfW;
        const ly = Math.abs(-dx * sa + dy * ca) - halfH;
        const d = Math.max(lx, ly);
        if (d >= 0.75) continue;
        const cov = d <= -0.75 ? 1 : clamp(0.5 - d / 1.5, 0, 1);
        const a = baseA * cov;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i] = this.data[i] * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 旋转椭圆：用于球体 squash/stretch。 */
  fillRotatedEllipse(cx: number, cy: number, rx: number, ry: number, angle: number, c: RGBA): void {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const bx = Math.abs(ca) * rx + Math.abs(sa) * ry;
    const by = Math.abs(sa) * rx + Math.abs(ca) * ry;
    const x0 = Math.max(0, Math.floor(cx - bx - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + bx + 1));
    const y0 = Math.max(0, Math.floor(cy - by - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + by + 1));
    const baseA = c[3] / 255;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx, dy = py + 0.5 - cy;
        const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
        const normDist = Math.sqrt((lx * lx) / (rx * rx) + (ly * ly) / (ry * ry));
        if (normDist >= 1.04) continue;
        const cov = normDist <= 0.96 ? 1 : clamp((1.04 - normDist) / 0.08, 0, 1);
        const a = baseA * cov;
        const i = (py * this.w + px) * 4;
        const invA = 1 - a;
        this.data[i] = this.data[i] * invA + c[0] * a;
        this.data[i+1] = this.data[i+1] * invA + c[1] * a;
        this.data[i+2] = this.data[i+2] * invA + c[2] * a;
        this.data[i+3] = 255;
      }
    }
  }

  /** 粗线段：以连续圆点绘制，适合轨迹/法线提示。 */
  drawLine(x0: number, y0: number, x1: number, y1: number, width: number, c: RGBA): void {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, width * 0.45)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blendCircle(x0 + dx * t, y0 + dy * t, width / 2, c);
    }
  }

  /** 电竞毛玻璃卡片（带投影、渐变底色、高光内沿、描边与侧边强调条） */
  drawCard(x: number, y: number, w: number, h: number, style: CardStyle): void {
    const r = style.radius ?? 16;
    const shadowA = style.shadowAlpha ?? 110;
    const shadowOffY = style.shadowOffsetY ?? 8;
    if (shadowA > 0) {
      this.blendRoundRect(x + 2, y + shadowOffY, w, h, r + 2, [0, 0, 0, shadowA]);
    }
    if (style.bgBottom) {
      this.blendGradientRoundRect(x, y, w, h, r, style.bgTop, style.bgBottom, true);
    } else {
      this.blendRoundRect(x, y, w, h, r, style.bgTop);
    }
    if (style.topHighlight) {
      this.blendRoundRect(x + 3, y + 2, w - 6, Math.min(18, h * 0.25), Math.max(2, r - 2), style.topHighlight);
    }
    if (style.accentColor && style.accentSide) {
      const ac = style.accentColor;
      if (style.accentSide === "left") {
        this.blendRoundRect(x + 2, y + 6, 6, h - 12, 3, ac);
      } else if (style.accentSide === "right") {
        this.blendRoundRect(x + w - 8, y + 6, 6, h - 12, 3, ac);
      } else if (style.accentSide === "top") {
        this.blendRoundRect(x + 8, y + 2, w - 16, 5, 2.5, ac);
      } else if (style.accentSide === "bottom") {
        this.blendRoundRect(x + 8, y + h - 7, w - 16, 5, 2.5, ac);
      }
    }
    if (style.border) {
      this.strokeRoundRect(x, y, w, h, r, style.borderWidth ?? 2, style.border);
    }
  }

  /** 电竞血条/进度条（支持缓动残影条、渐变填充、高光玻璃质感、分格刻度） */
  drawBar(x: number, y: number, w: number, h: number, frac: number, style: ProgressBarStyle): void {
    const r = style.radius ?? h * 0.45;
    const bg = style.bgColor ?? [18, 16, 30, 235];
    this.blendRoundRect(x, y, w, h, r, bg);

    const pad = 3;
    const innerW = Math.max(0, w - pad * 2);
    const innerH = Math.max(2, h - pad * 2);
    const innerR = Math.max(2, r - pad);

    const f = clamp(frac, 0, 1);
    const gf = clamp(style.ghostFrac ?? f, f, 1);

    // 残影缓冲条（白色/亮金受击延迟条）
    if (gf > f + 0.004) {
      const gw = Math.round(innerW * gf);
      const gx = style.alignRight ? x + pad + (innerW - gw) : x + pad;
      const gc = style.ghostColor ?? [255, 235, 195, 220];
      this.blendRoundRect(gx, y + pad, gw, innerH, innerR, gc);
    }

    // 主进度条
    if (f > 0.002) {
      const fw = Math.max(Math.round(innerR * 1.4), Math.round(innerW * f));
      const fx = style.alignRight ? x + pad + (innerW - fw) : x + pad;
      if (style.fgEnd) {
        this.blendGradientRoundRect(fx, y + pad, fw, innerH, innerR, style.fgStart, style.fgEnd, false);
      } else {
        this.blendRoundRect(fx, y + pad, fw, innerH, innerR, style.fgStart);
      }
      if (style.gloss !== false) {
        this.blendRoundRect(fx + 2, y + pad + 1, Math.max(2, fw - 4), Math.max(2, innerH * 0.38), innerR * 0.6, [255, 255, 255, 68]);
      }
    }

    // 分格刻度线（类似 MOBA/格斗游戏血条分格）
    if (style.segments && style.segments > 1) {
      for (let s = 1; s < style.segments; s++) {
        const sx = Math.round(x + pad + (innerW * s) / style.segments);
        this.blendRect(sx, y + pad, 2, innerH, [10, 10, 18, 120]);
      }
    }

    if (style.borderColor) {
      this.strokeRoundRect(x, y, w, h, r, 2, style.borderColor);
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

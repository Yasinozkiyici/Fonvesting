/**
 * Monotone cubic X (Steffen / d3-shape mantığı): tüm düğümlerden geçer,
 * X artan seride gereksiz overshoot yapmaz. Ara veri noktası uydurmaz.
 * @see https://github.com/d3/d3-shape/blob/main/src/curve/monotone.js
 */

export type ChartPathPoint = { x: number; y: number };

/** Aynı x üzerinde tekrarlayan noktalar monotone eğimi bozabilir; son y değeri tutulur. */
export function dedupeChartPointsByX(points: ChartPathPoint[], eps = 1e-6): ChartPathPoint[] {
  const out: ChartPathPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (out.length === 0) {
      out.push({ x: p.x, y: p.y });
      continue;
    }
    const last = out[out.length - 1]!;
    if (Math.abs(p.x - last.x) <= eps) {
      out[out.length - 1] = { x: last.x, y: p.y };
    } else if (p.x > last.x + eps) {
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

function sign(x: number): number {
  return x < 0 ? -1 : 1;
}

function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -1 : 1) * Number.EPSILON);
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -1 : 1) * Number.EPSILON);
  const p = (s0 * h1 + s1 * h0) / (h0 + h1 || Number.EPSILON);
  const v = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  return Number.isFinite(v) ? v : 0;
}

function slope2(x0: number, y0: number, x1: number, y1: number, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

function appendBezier(
  parts: string[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t0: number,
  t1: number
): void {
  const dx = (x1 - x0) / 3;
  const c1x = x0 + dx;
  const c1y = y0 + dx * t0;
  const c2x = x1 - dx;
  const c2y = y1 - dx * t1;
  if (
    !Number.isFinite(c1x) ||
    !Number.isFinite(c1y) ||
    !Number.isFinite(c2x) ||
    !Number.isFinite(c2y) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1)
  ) {
    // Monotone eğim üretimi NaN/Inf dönerse güvenli lineer segmente düş.
    parts.push(`L ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    return;
  }
  parts.push(
    `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)}`
  );
}

/**
 * Kapalı alan: üstte monotone çizgi, altta düz taban (linear x üzerinde kapanır).
 */
export function buildMonotoneClosedAreaPathD(points: ChartPathPoint[], bottomY: number): string | null {
  const line = buildMonotoneXPathD(points);
  if (!line || points.length < 2) return null;
  const x0 = points[0]!.x;
  const x1 = points[points.length - 1]!.x;
  return `${line} L ${x1.toFixed(2)} ${bottomY.toFixed(2)} L ${x0.toFixed(2)} ${bottomY.toFixed(2)} Z`;
}

export function buildMonotoneXPathD(points: ChartPathPoint[]): string | null {
  if (points.length < 2) return null;
  const pts = dedupeChartPointsByX(points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  if (pts.length < 2) return null;

  const parts: string[] = [];
  let x0 = NaN;
  let y0 = NaN;
  let x1 = NaN;
  let y1 = NaN;
  let t0 = NaN;
  let pointPhase = 0;

  const lineEnd = () => {
    if (pointPhase === 2) {
      parts.push(`L ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    } else if (pointPhase === 3) {
      appendBezier(parts, x0, y0, x1, y1, t0, slope2(x0, y0, x1, y1, t0));
    }
  };

  for (let i = 0; i < pts.length; i += 1) {
    const x = pts[i]!.x;
    const y = pts[i]!.y;
    if (x === x1 && y === y1) continue;

    switch (pointPhase) {
      case 0:
        pointPhase = 1;
        parts.push(`M ${x.toFixed(2)} ${y.toFixed(2)}`);
        break;
      case 1:
        pointPhase = 2;
        break;
      case 2:
        pointPhase = 3;
        {
          const t1 = slope3(x0, y0, x1, y1, x, y);
          appendBezier(parts, x0, y0, x1, y1, slope2(x0, y0, x1, y1, t1), t1);
        }
        break;
      default: {
        const t1 = slope3(x0, y0, x1, y1, x, y);
        appendBezier(parts, x0, y0, x1, y1, t0, t1);
        t0 = t1;
      }
    }
    x0 = x1;
    y0 = y1;
    x1 = x;
    y1 = y;
  }

  lineEnd();
  return parts.join(" ");
}

export function buildLinearPathD(points: ChartPathPoint[]): string | null {
  if (points.length < 2) return null;
  const d: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const { x, y } = points[i]!;
    d.push(`${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return d.join(" ");
}

export function buildLinearClosedAreaPathD(points: ChartPathPoint[], bottomY: number): string | null {
  const line = buildLinearPathD(points);
  if (!line || points.length < 2) return null;
  const x0 = points[0]!.x;
  const x1 = points[points.length - 1]!.x;
  return `${line} L ${x1.toFixed(2)} ${bottomY.toFixed(2)} L ${x0.toFixed(2)} ${bottomY.toFixed(2)} Z`;
}

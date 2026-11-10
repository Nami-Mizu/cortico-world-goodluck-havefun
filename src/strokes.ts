/**
 * 笔画数据：模型交给 World 的就是一组折线，World 只做校验与落库，
 * 真正的成像在面板里（canvas），所以两边必须共用同一套坐标规则。
 *
 * 坐标是 0–1000 的归一化空间，原点左上；面板按画布尺寸等比放大。
 * 限制写死在这里，别在提示词里另说一套数字。
 */

/** 归一化坐标上界。 */
export const STROKE_SPACE = 1000;
/** 一局最多几笔。 */
export const MAX_STROKES = 40;
/** 一笔最多几个点。 */
export const MAX_POINTS_PER_STROKE = 60;
/** 笔宽范围（归一化单位）。 */
export const MIN_STROKE_WIDTH = 1;
export const MAX_STROKE_WIDTH = 40;

export type Point = [number, number];

export interface Stroke {
  /** 折线点，按绘制顺序。 */
  points: Point[];
  /** 笔宽。 */
  width: number;
}

export interface Drawing {
  strokes: Stroke[];
}

export interface DrawingRejected {
  ok: false;
  reason: string;
}

export interface DrawingAccepted {
  ok: true;
  drawing: Drawing;
}

export type DrawingCheck = DrawingAccepted | DrawingRejected;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 校验并规范化；任何一项不合法都返回原因，让模型自己改。 */
export function validateDrawing(input: unknown): DrawingCheck {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'strokes 必须是一个数组。' };
  }
  const raw = (input as { strokes?: unknown }).strokes;
  if (!Array.isArray(raw)) return { ok: false, reason: 'strokes 必须是一个数组。' };
  if (raw.length === 0) return { ok: false, reason: '至少要有一笔。' };
  if (raw.length > MAX_STROKES) {
    return { ok: false, reason: `最多 ${MAX_STROKES} 笔，这次给了 ${raw.length} 笔。` };
  }
  const strokes: Stroke[] = [];
  for (const [index, item] of raw.entries()) {
    const label = `第 ${index + 1} 笔`;
    if (typeof item !== 'object' || item === null) return { ok: false, reason: `${label}不是一个对象。` };
    const width = (item as { width?: unknown }).width;
    if (!isFiniteNumber(width) || width < MIN_STROKE_WIDTH || width > MAX_STROKE_WIDTH) {
      return {
        ok: false,
        reason: `${label}的 width 要在 ${MIN_STROKE_WIDTH}–${MAX_STROKE_WIDTH} 之间。`,
      };
    }
    const points = (item as { points?: unknown }).points;
    if (!Array.isArray(points) || points.length < 2) {
      return { ok: false, reason: `${label}至少要两个点。` };
    }
    if (points.length > MAX_POINTS_PER_STROKE) {
      return {
        ok: false,
        reason: `${label}最多 ${MAX_POINTS_PER_STROKE} 个点，这次有 ${points.length} 个。`,
      };
    }
    const normalized: Point[] = [];
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) {
        return { ok: false, reason: `${label}的每个点都要写成 [x, y]。` };
      }
      const [x, y] = point as unknown[];
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        return { ok: false, reason: `${label}里有非数字坐标。` };
      }
      if (x < 0 || x > STROKE_SPACE || y < 0 || y > STROKE_SPACE) {
        return { ok: false, reason: `${label}的坐标要落在 0–${STROKE_SPACE} 之间（原点左上）。` };
      }
      normalized.push([Math.round(x), Math.round(y)]);
    }
    strokes.push({ points: normalized, width: Math.round(width) });
  }
  return { ok: true, drawing: { strokes } };
}

/** 一笔的总长度（归一化单位），用来判断是不是「几乎没画」。 */
export function drawingInk(drawing: Drawing): number {
  let ink = 0;
  for (const stroke of drawing.strokes) {
    for (let i = 1; i < stroke.points.length; i++) {
      const [x0, y0] = stroke.points[i - 1]!;
      const [x1, y1] = stroke.points[i]!;
      ink += Math.hypot(x1 - x0, y1 - y0);
    }
  }
  return Math.round(ink);
}

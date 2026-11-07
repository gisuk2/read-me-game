import type { Vec2 } from './geometry';

/**
 * 공격 판정 모양과 계산 (순수 함수).
 * 그리기(점선 외곽선)와 맞았는지 판정이 같은 모양 정의를 쓰므로, 보이는 범위 = 실제 판정 범위.
 */

/** 중심(cx, cy)에서 angle 방향으로 펼쳐진 부채꼴 */
export interface SectorShape {
  kind: 'sector';
  cx: number;
  cy: number;
  radius: number;
  angle: number;
  arcRad: number;
}

/** (x, y)에서 angle 방향으로 length만큼 뻗고, 폭이 width인 직사각형 */
export interface RectShape {
  kind: 'rect';
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
}

export interface CircleShape {
  kind: 'circle';
  cx: number;
  cy: number;
  radius: number;
}

export type AttackShape = SectorShape | RectShape | CircleShape;

/** 각도 차이를 -π ~ π 범위로 맞춘다 (예: 350°와 10°의 차이는 20°) */
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** 원(플레이어 등)이 공격 모양과 겹치는가 */
export function circleHitsShape(px: number, py: number, pr: number, shape: AttackShape): boolean {
  switch (shape.kind) {
    case 'circle':
      return Math.hypot(px - shape.cx, py - shape.cy) <= shape.radius + pr;

    case 'sector': {
      const d = Math.hypot(px - shape.cx, py - shape.cy);
      if (d > shape.radius + pr) return false;
      if (d <= pr) return true; // 원이 부채꼴의 중심을 덮음
      const diff = Math.abs(wrapAngle(Math.atan2(py - shape.cy, px - shape.cx) - shape.angle));
      // 원의 반지름만큼 각도 여유를 준다 (가장자리에 걸친 경우)
      const margin = Math.asin(Math.min(1, pr / d));
      return diff <= shape.arcRad / 2 + margin;
    }

    case 'rect': {
      // 원의 중심을 직사각형 기준 좌표로 옮긴다: u = 뻗는 방향, v = 옆 방향
      const dx = px - shape.x;
      const dy = py - shape.y;
      const cos = Math.cos(shape.angle);
      const sin = Math.sin(shape.angle);
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      // 직사각형 안에서 원 중심에 가장 가까운 점까지의 거리
      const cu = Math.max(0, Math.min(shape.length, u));
      const cv = Math.max(-shape.width / 2, Math.min(shape.width / 2, v));
      return Math.hypot(u - cu, v - cv) <= pr;
    }
  }
}

/** 모양의 외곽선 꼭짓점 (닫힌 도형, 마지막 점 → 첫 점으로 이어짐) */
export function shapeOutline(shape: AttackShape, segments = 40): Vec2[] {
  switch (shape.kind) {
    case 'circle':
      return Array.from({ length: segments }, (_, i) => {
        const a = (i / segments) * Math.PI * 2;
        return { x: shape.cx + Math.cos(a) * shape.radius, y: shape.cy + Math.sin(a) * shape.radius };
      });

    case 'sector': {
      const points: Vec2[] = [{ x: shape.cx, y: shape.cy }];
      const start = shape.angle - shape.arcRad / 2;
      for (let i = 0; i <= segments; i++) {
        const a = start + (i / segments) * shape.arcRad;
        points.push({ x: shape.cx + Math.cos(a) * shape.radius, y: shape.cy + Math.sin(a) * shape.radius });
      }
      return points;
    }

    case 'rect': {
      const cos = Math.cos(shape.angle);
      const sin = Math.sin(shape.angle);
      const hw = shape.width / 2;
      const at = (u: number, v: number): Vec2 => ({ x: shape.x + u * cos - v * sin, y: shape.y + u * sin + v * cos });
      return [at(0, -hw), at(shape.length, -hw), at(shape.length, hw), at(0, hw)];
    }
  }
}

/** 모양을 바깥쪽으로 offset만큼 키운 모양 (이중 점선의 바깥 줄용) */
export function expandShape(shape: AttackShape, offset: number): AttackShape {
  switch (shape.kind) {
    case 'circle':
      return { ...shape, radius: shape.radius + offset };
    case 'sector':
      return { ...shape, radius: shape.radius + offset };
    case 'rect': {
      const cos = Math.cos(shape.angle);
      const sin = Math.sin(shape.angle);
      return { ...shape, x: shape.x - cos * offset, y: shape.y - sin * offset, length: shape.length + offset * 2, width: shape.width + offset * 2 };
    }
  }
}

/**
 * 꺾은선을 점선 조각들로 나눈다. 반환값: [시작점, 끝점] 쌍의 목록.
 * Phaser 4에는 점선 그리기 기능이 없어서 직접 계산한다.
 */
export function dashPolyline(points: Vec2[], dash: number, gap: number, closed: boolean): Array<[Vec2, Vec2]> {
  const pts = closed && points.length > 1 ? [...points, points[0]] : points;
  const segments: Array<[Vec2, Vec2]> = [];
  const period = dash + gap;
  let offset = 0; // 지금까지 이어 온 길이 (선분이 바뀌어도 점선 무늬가 이어지도록)

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;

    let t = 0;
    while (t < len) {
      const phase = (offset + t) % period;
      if (phase < dash) {
        const end = Math.min(len, t + (dash - phase));
        segments.push([
          { x: a.x + ux * t, y: a.y + uy * t },
          { x: a.x + ux * end, y: a.y + uy * end },
        ]);
        t = end;
      } else {
        t = Math.min(len, t + (period - phase));
      }
    }
    offset += len;
  }
  return segments;
}

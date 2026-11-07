import { describe, expect, it } from 'vitest';
import { circleHitsShape, dashPolyline, expandShape, shapeOutline, type AttackShape } from '../src/utils/shapes';

const PR = 12; // 플레이어 반지름

describe('원형 판정', () => {
  const circle: AttackShape = { kind: 'circle', cx: 0, cy: 0, radius: 100 };

  it('경계에 딱 닿으면 맞고, 조금이라도 떨어지면 안 맞는다', () => {
    expect(circleHitsShape(100 + PR, 0, PR, circle)).toBe(true);
    expect(circleHitsShape(100 + PR + 0.01, 0, PR, circle)).toBe(false);
  });
});

describe('부채꼴 판정', () => {
  // 오른쪽(0 라디안)을 향한 반지름 100, 90도 부채꼴
  const sector: AttackShape = { kind: 'sector', cx: 0, cy: 0, radius: 100, angle: 0, arcRad: Math.PI / 2 };

  it('정면 안쪽은 맞는다', () => {
    expect(circleHitsShape(60, 0, PR, sector)).toBe(true);
  });

  it('등 뒤는 맞지 않는다', () => {
    expect(circleHitsShape(-60, 0, PR, sector)).toBe(false);
  });

  it('반지름 밖은 맞지 않는다', () => {
    expect(circleHitsShape(100 + PR + 1, 0, PR, sector)).toBe(false);
  });

  it('부채꼴 가장자리 바로 바깥이라도 몸이 걸치면 맞는다', () => {
    // 50도 방향 (부채꼴 끝은 45도) → 중심은 밖이지만 반지름 12의 몸이 걸침
    const a = (50 * Math.PI) / 180;
    expect(circleHitsShape(Math.cos(a) * 60, Math.sin(a) * 60, PR, sector)).toBe(true);
    // 80도 방향은 충분히 멀다
    const b = (80 * Math.PI) / 180;
    expect(circleHitsShape(Math.cos(b) * 60, Math.sin(b) * 60, PR, sector)).toBe(false);
  });
});

describe('직사각형 판정', () => {
  // (0,0)에서 오른쪽으로 길이 200, 폭 40
  const rect: AttackShape = { kind: 'rect', x: 0, y: 0, angle: 0, length: 200, width: 40 };

  it('직사각형 안은 맞는다', () => {
    expect(circleHitsShape(150, 0, PR, rect)).toBe(true);
  });

  it('옆으로 폭/2 + 반지름보다 멀면 맞지 않는다', () => {
    expect(circleHitsShape(100, 20 + PR + 0.5, PR, rect)).toBe(false);
    expect(circleHitsShape(100, 20 + PR - 0.5, PR, rect)).toBe(true);
  });

  it('시작점 뒤쪽과 끝 너머는 맞지 않는다', () => {
    expect(circleHitsShape(-PR - 1, 0, PR, rect)).toBe(false);
    expect(circleHitsShape(200 + PR + 1, 0, PR, rect)).toBe(false);
  });

  it('회전된 직사각형도 판정된다 (아래쪽 90도)', () => {
    const down: AttackShape = { ...rect, angle: Math.PI / 2 };
    expect(circleHitsShape(0, 150, PR, down)).toBe(true);
    expect(circleHitsShape(150, 0, PR, down)).toBe(false);
  });
});

describe('외곽선과 점선', () => {
  it('직사각형 외곽선은 꼭짓점 4개', () => {
    expect(shapeOutline({ kind: 'rect', x: 0, y: 0, angle: 0, length: 10, width: 4 }).length).toBe(4);
  });

  it('바깥으로 키운 원은 반지름이 offset만큼 커진다', () => {
    const grown = expandShape({ kind: 'circle', cx: 0, cy: 0, radius: 50 }, 6);
    expect(grown.kind === 'circle' && grown.radius).toBe(56);
  });

  it('길이 100 직선을 대시 10 / 간격 10으로 나누면 길이 10짜리 조각 5개', () => {
    const segs = dashPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 10, false);
    expect(segs.length).toBe(5);
    for (const [a, b] of segs) expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 5);
  });

  it('닫힌 도형의 점선 총길이는 둘레 × 대시 비율이다 (모서리에서도 무늬가 이어짐)', () => {
    const square = [{ x: 0, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 25 }, { x: 0, y: 25 }];
    const segs = dashPolyline(square, 10, 10, true);
    const total = segs.reduce((s, [a, b]) => s + Math.hypot(b.x - a.x, b.y - a.y), 0);
    expect(total).toBeCloseTo(50, 5);
  });
});

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 벡터를 길이 1로 만든다. 길이가 0이면 (0, 0)을 반환한다.
 * 대각선 이동 시 (1, 1)의 길이는 약 1.414라서, 정규화하지 않으면 대각선이 더 빨라진다.
 */
export function normalize(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  if (length === 0) return { x: 0, y: 0 };
  return { x: x / length, y: y / length };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

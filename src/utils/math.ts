/**
 * value를 [min, max] 범위 안으로 제한한다.
 * 화면 경계 처리뿐 아니라, 이후 밴딧 가중치 제한(기본값의 0.8~1.3배) 등에도 쓰인다.
 * Phaser에 의존하지 않는 순수 함수라서 테스트하기 쉽다.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new Error(`clamp: min(${min})이 max(${max})보다 큽니다.`);
  }
  return Math.min(Math.max(value, min), max);
}

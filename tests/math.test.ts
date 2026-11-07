import { describe, expect, it } from 'vitest';
import { clamp } from '../src/utils/math';

describe('clamp', () => {
  it('범위 안의 값은 그대로 반환한다', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('최솟값보다 작으면 최솟값을 반환한다', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it('최댓값보다 크면 최댓값을 반환한다', () => {
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('min이 max보다 크면 에러를 던진다', () => {
    expect(() => clamp(1, 10, 0)).toThrow();
  });
});

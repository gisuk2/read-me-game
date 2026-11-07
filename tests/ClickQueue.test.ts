import { describe, expect, it } from 'vitest';
import { ClickQueue } from '../src/input/ClickQueue';

describe('클릭 대기열', () => {
  it('쌓인 클릭은 한 번만 꺼내진다', () => {
    const q = new ClickQueue();
    q.pushAttack();
    expect(q.take()).toEqual({ attack: true, parry: false });
    expect(q.take()).toEqual({ attack: false, parry: false });
  });

  it('clear()하면 쌓인 클릭이 버려진다 (일시정지 해제 시 메뉴 클릭이 공격으로 새지 않음)', () => {
    const q = new ClickQueue();
    q.pushAttack();
    q.pushParry();
    q.clear();
    expect(q.take()).toEqual({ attack: false, parry: false });
  });
});

import { describe, expect, it } from 'vitest';
import { BOSS } from '../src/config/bossBalance';
import { BossModel, choosePattern, type BossEvent, type Rng } from '../src/entities/boss/BossModel';

const BOUNDS = { width: 1000, height: 1000 };
const STEP_MS = 10;

/** 재현 가능한 난수 (선형 합동 생성기) */
function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function run(boss: BossModel, target: { x: number; y: number }, ms: number): BossEvent[] {
  const all: BossEvent[] = [];
  for (let t = 0; t < ms; t += STEP_MS) all.push(...boss.update(target, STEP_MS));
  return all;
}

const pattern = (id: string) => BOSS.patterns.find((p) => p.id === id)!;

describe('공격 고르기', () => {
  it('가까울 때는 찌르기·점프 내려찍기를 고르지 않는다 (최소 거리)', () => {
    const rng = seeded(1);
    for (let i = 0; i < 300; i++) {
      const id = choosePattern(BOSS, 40, null, rng).id;
      expect(id === 'thrust' || id === 'slam').toBe(false);
    }
  });

  it('멀 때는 점프 내려찍기가 가장 자주 뽑힌다 (사거리 안 공격이 우선)', () => {
    const rng = seeded(2);
    const count: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const id = choosePattern(BOSS, 400, null, rng).id;
      count[id] = (count[id] ?? 0) + 1;
    }
    for (const id of ['sweep', 'thrust', 'spin']) expect(count.slam).toBeGreaterThan(count[id] ?? 0);
  });

  it('다른 후보가 있으면 직전 공격은 다시 고르지 않는다', () => {
    expect(choosePattern(BOSS, 40, 'sweep', () => 0).id).toBe('spin');
    expect(choosePattern(BOSS, 40, 'spin', () => 0).id).toBe('sweep');
  });
});

describe('보스 상태 머신', () => {
  it('고른 공격의 사거리 밖이면 플레이어 쪽으로 다가간다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0); // 거리 150 → 휘두르기(사거리 90) 선택
    const target = { x: 650, y: 500 };
    run(boss, target, 200);
    expect(boss.plannedPattern?.id).toBe('sweep');
    expect(boss.x).toBeGreaterThan(500);
    expect(boss.state).toBe('approach');
  });

  it('사거리 안이어도 관찰 시간(minIdleMs)이 지나야 예고를 시작한다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const target = { x: 550, y: 500 };
    run(boss, target, BOSS.minIdleMs - 50);
    expect(boss.state).toBe('approach');
    const events = run(boss, target, 60);
    expect(boss.state).toBe('telegraph');
    expect(events.some((e) => e.type === 'telegraphStart')).toBe(true);
  });

  it('예고가 시작되면 조준이 고정된다 (플레이어가 움직여도 범위가 따라오지 않음)', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    run(boss, { x: 550, y: 500 }, BOSS.minIdleMs + STEP_MS); // 오른쪽을 조준하고 예고 시작
    const angleAtStart = boss.attack!.shape.kind === 'sector' ? boss.attack!.shape.angle : NaN;
    run(boss, { x: 500, y: 600 }, 200); // 플레이어가 아래로 이동
    const shape = boss.attack!.shape;
    expect(shape.kind === 'sector' && shape.angle).toBeCloseTo(angleAtStart, 10);
    expect(boss.facing).toBeCloseTo(angleAtStart, 10);
  });

  it('예고 → 판정 → 경직 → 관찰 순서로 정해진 시간만큼 진행된다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const target = { x: 550, y: 500 };
    run(boss, target, BOSS.minIdleMs + STEP_MS);
    const sweep = pattern('sweep');

    const toActive = run(boss, target, sweep.telegraphMs);
    expect(boss.state).toBe('active');
    expect(toActive.some((e) => e.type === 'attackActive')).toBe(true);

    run(boss, target, sweep.activeMs);
    expect(boss.state).toBe('recovery');

    const toEnd = run(boss, target, sweep.recoveryMs);
    expect(boss.state).toBe('watch');
    expect(toEnd.some((e) => e.type === 'attackEnd' && e.patternId === 'sweep')).toBe(true);
  });

  it('점프 내려찍기: 공중에 떴다가 예고 시작 순간의 플레이어 위치에 착지하고, 경직 후 숨을 고른다', () => {
    const boss = new BossModel(200, 200, BOUNDS, BOSS, () => 0.99); // 멀리서 → 마지막 후보(점프 내려찍기)
    const target = { x: 700, y: 600 };
    run(boss, target, BOSS.minIdleMs + STEP_MS);
    expect(boss.attack?.pattern.id).toBe('slam');

    const slam = pattern('slam');
    run(boss, { x: 100, y: 900 }, slam.telegraphMs / 2); // 플레이어가 도망가도
    expect(boss.z).toBeGreaterThan(0);

    run(boss, { x: 100, y: 900 }, slam.telegraphMs / 2 + STEP_MS);
    expect(boss.state).toBe('active');
    expect(boss.z).toBe(0);
    expect(boss.x).toBeCloseTo(700, 5); // 예고 시작 때의 위치에 착지
    expect(boss.y).toBeCloseTo(600, 5);

    const rest = run(boss, target, slam.activeMs + slam.recoveryMs);
    expect(boss.isResting).toBe(true);
    expect(rest.some((e) => e.type === 'restStart')).toBe(true);
    run(boss, target, slam.restMs);
    expect(boss.state).toBe('watch');
  });

  it('회전 속도에 제한이 있어 갑자기 뒤돌지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const before = boss.facing; // 아래쪽
    run(boss, { x: 900, y: 500 }, 100); // 오른쪽 멀리
    expect(Math.abs(boss.facing - before)).toBeLessThan(BOSS.turnSpeed * 0.1 + 1e-9);
  });
});

/** 공격 하나를 끝까지 진행시켜 관찰 상태로 만든다 */
function runUntilWatch(boss: BossModel, target: { x: number; y: number }): BossEvent[] {
  const all: BossEvent[] = [];
  for (let i = 0; i < 1000 && boss.state !== 'watch'; i++) all.push(...boss.update(target, STEP_MS));
  return all;
}

describe('관찰 (공격 후 멈추는 시간)', () => {
  it('공격이 끝나면 관찰하고, 관찰 시간 동안에는 다음 예고를 시작하지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0); // 관찰 시간 = 최소값
    const target = { x: 550, y: 500 };
    const events = runUntilWatch(boss, target);
    expect(events.some((e) => e.type === 'watchStart')).toBe(true);

    const during = run(boss, target, BOSS.watch.minMs - STEP_MS * 2);
    expect(boss.state).toBe('watch');
    expect(during.some((e) => e.type === 'telegraphStart')).toBe(false);

    run(boss, target, STEP_MS * 3);
    expect(boss.state).toBe('approach');
  });

  it('관찰 시간은 설정한 최소~최대 범위 안이다', () => {
    for (const r of [0, 0.5, 0.999]) {
      const boss = new BossModel(500, 500, BOUNDS, BOSS, () => r);
      const watch = runUntilWatch(boss, { x: 550, y: 500 }).find((e) => e.type === 'watchStart');
      expect(watch?.type === 'watchStart' && watch.durationMs >= BOSS.watch.minMs).toBe(true);
      expect(watch?.type === 'watchStart' && watch.durationMs <= BOSS.watch.maxMs).toBe(true);
    }
  });

  it('관찰 중 플레이어가 너무 가까우면 물러난다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const target = { x: 550, y: 500 };
    runUntilWatch(boss, target);
    const before = Math.hypot(target.x - boss.x, target.y - boss.y);
    expect(before).toBeLessThan(BOSS.watch.retreatDistance);
    run(boss, target, 300);
    expect(Math.hypot(target.x - boss.x, target.y - boss.y)).toBeGreaterThan(before);
  });

  it('옆으로 도는 관찰은 거리를 거의 유지한 채 위치만 바뀐다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0.5); // 0.5 → 왼쪽으로 돌기
    runUntilWatch(boss, { x: 550, y: 500 });
    expect(boss.currentWatchMode).toBe('strafeLeft');

    const far = { x: boss.x + 200, y: boss.y }; // 물러날 거리 밖
    const start = { x: boss.x, y: boss.y };
    run(boss, far, 300);
    expect(Math.hypot(boss.x - start.x, boss.y - start.y)).toBeGreaterThan(5);
    expect(Math.abs(Math.hypot(far.x - boss.x, far.y - boss.y) - 200)).toBeLessThan(3);
  });
});

describe('체력·자세 게이지', () => {
  const P = BOSS.posture;

  it('맞으면 체력이 줄고 자세 게이지가 쌓인다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    boss.applyHit(10);
    expect(boss.hp).toBe(BOSS.maxHp - 10);
    expect(boss.posture).toBeCloseTo(10 * P.perDamage, 10);
  });

  it('자세 게이지가 가득 차면 자세 붕괴: 공격이 끊기고, 받는 피해가 배로 들어간다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    run(boss, { x: 550, y: 500 }, BOSS.minIdleMs + STEP_MS); // 예고 중
    expect(boss.attack).not.toBeNull();
    boss.posture = P.max - 1;
    const r = boss.applyHit(10);
    expect(r.staggerStarted).toBe(true);
    expect(boss.isStaggered).toBe(true);
    expect(boss.attack).toBeNull();

    const before = boss.hp;
    expect(boss.applyHit(10).dealt).toBe(10 * BOSS.staggerDamageMultiplier);
    expect(boss.hp).toBe(before - 10 * BOSS.staggerDamageMultiplier);
  });

  it('자세 붕괴가 끝나면 게이지가 0이 되고 관찰로 돌아간다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    boss.posture = P.max - 1;
    boss.applyHit(10);
    run(boss, { x: 600, y: 500 }, BOSS.staggerMs + STEP_MS);
    expect(boss.isStaggered).toBe(false);
    expect(boss.posture).toBe(0);
    expect(boss.state).toBe('watch');
  });

  it('공격받지 않으면 지연 시간 뒤부터 자세 게이지가 서서히 줄어든다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    boss.applyHit(50);
    const built = boss.posture;
    run(boss, { x: 900, y: 900 }, P.decayDelayMs - 100);
    expect(boss.posture).toBe(built);
    run(boss, { x: 900, y: 900 }, 1000);
    expect(boss.posture).toBeLessThan(built);
  });

  it('패링당하면 자세 게이지가 크게 쌓이고 움찔하며 공격이 끊긴다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    run(boss, { x: 550, y: 500 }, BOSS.minIdleMs + STEP_MS);
    boss.onParried();
    expect(boss.posture).toBe(P.perParry);
    expect(boss.state).toBe('flinch');
    expect(boss.attack).toBeNull();
    run(boss, { x: 550, y: 500 }, BOSS.flinchMs + STEP_MS);
    expect(boss.state).toBe('watch');
  });

  it('체력이 0이 되면 쓰러지고 더 이상 움직이지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    expect(boss.applyHit(BOSS.maxHp).died).toBe(true);
    expect(boss.isDead).toBe(true);
    run(boss, { x: 900, y: 500 }, 500);
    expect(boss.x).toBe(500);
  });

  it('공격(예고)마다 공격 번호(attackSerial)가 늘어난다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const target = { x: 550, y: 500 };
    run(boss, target, BOSS.minIdleMs + STEP_MS);
    const first = boss.attackSerial;
    runUntilWatch(boss, target);
    for (let i = 0; i < 1000 && boss.state !== 'telegraph'; i++) boss.update(target, STEP_MS);
    expect(boss.attackSerial).toBe(first + 1);
  });
});

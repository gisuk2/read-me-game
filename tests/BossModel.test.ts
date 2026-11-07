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
/** 한 타짜리 패턴의 타 설정 */
const only = (id: string) => pattern(id).steps[0];

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

  it('예고 앞부분에는 조준이 플레이어를 따라오고, 고정된 뒤에는 움직여도 따라오지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0); // 휘두르기
    run(boss, { x: 550, y: 500 }, BOSS.minIdleMs + STEP_MS); // 오른쪽을 조준하고 예고 시작
    const sweep = only('sweep');
    const angleOf = () => (boss.attack!.shape.kind === 'sector' ? boss.attack!.shape.angle : NaN);
    const start = angleOf();
    expect(boss.attack!.locked).toBe(false);

    // 추적 구간: 아래로 움직이면 조준이 따라 내려옴 (회전 속도 제한 안에서)
    run(boss, { x: 500, y: 600 }, 200);
    expect(angleOf()).toBeGreaterThan(start + 0.1);
    expect(angleOf() - start).toBeLessThanOrEqual(BOSS.aimTrackSpeed * 0.21 + 1e-9);

    // 고정 이후: 다시 움직여도 그대로
    run(boss, { x: 500, y: 600 }, sweep.telegraphMs * sweep.trackRatio - 200 + STEP_MS);
    expect(boss.attack!.locked).toBe(true);
    const lockedAngle = angleOf();
    run(boss, { x: 400, y: 500 }, 150);
    expect(angleOf()).toBeCloseTo(lockedAngle, 10);
  });

  it('예고 → 판정 → 경직 → 관찰 순서로 정해진 시간만큼 진행된다', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    const target = { x: 550, y: 500 };
    run(boss, target, BOSS.minIdleMs + STEP_MS);
    const sweep = only('sweep');

    const toActive = run(boss, target, sweep.telegraphMs);
    expect(boss.state).toBe('active');
    expect(toActive.some((e) => e.type === 'attackActive')).toBe(true);

    run(boss, target, sweep.activeMs);
    expect(boss.state).toBe('recovery');

    const toEnd = run(boss, target, sweep.recoveryMs);
    expect(boss.state).toBe('watch');
    expect(toEnd.some((e) => e.type === 'attackEnd' && e.patternId === 'sweep')).toBe(true);
  });

  it('점프 내려찍기: 착지 지점이 고정 전까지 따라오고, 고정 뒤 도망가도 그 지점에 착지한 뒤 숨을 고른다', () => {
    const boss = new BossModel(200, 200, BOUNDS, BOSS, () => 0.99); // 멀리서 → 마지막 후보(점프 내려찍기)
    run(boss, { x: 700, y: 600 }, BOSS.minIdleMs + STEP_MS);
    expect(boss.attack?.pattern.id).toBe('slam');
    const slam = only('slam');

    run(boss, { x: 650, y: 650 }, slam.telegraphMs * slam.trackRatio); // 추적 구간에 조금 이동 → 따라옴, 그리고 고정
    expect(boss.attack!.locked).toBe(true);
    expect(boss.z).toBeGreaterThan(0);

    run(boss, { x: 100, y: 900 }, slam.telegraphMs * (1 - slam.trackRatio) + STEP_MS); // 고정 뒤 도망
    expect(boss.state).toBe('active');
    expect(boss.z).toBe(0);
    expect(boss.x).toBeCloseTo(650, 5);
    expect(boss.y).toBeCloseTo(650, 5);

    const rest = run(boss, { x: 650, y: 650 }, slam.activeMs + slam.recoveryMs);
    expect(boss.isResting).toBe(true);
    expect(rest.some((e) => e.type === 'restStart')).toBe(true);
    run(boss, { x: 650, y: 650 }, pattern('slam').restMs);
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

/** 원하는 패턴만 들어 있는 설정 (고르기 결과를 고정) */
const only1 = (id: string) => ({ ...BOSS, patterns: [pattern(id)] });

/** 다음 상태(들) 중 하나가 될 때까지 진행 */
function runUntil(boss: BossModel, target: { x: number; y: number }, ok: () => boolean, maxMs = 10000): BossEvent[] {
  const all: BossEvent[] = [];
  for (let t = 0; t < maxMs && !ok(); t += STEP_MS) all.push(...boss.update(target, STEP_MS));
  return all;
}

describe('카테고리', () => {
  it('일반 패턴은 패링 가능, 강 패턴은 패링 불가', () => {
    for (const p of BOSS.patterns) {
      const boss = new BossModel(500, 500, BOUNDS, only1(p.id), () => 0);
      runUntil(boss, { x: 560, y: 500 }, () => boss.attack !== null);
      expect(boss.attack!.parryable).toBe(p.category === 'normal');
    }
  });
});

describe('돌진', () => {
  it('판정 때 조준 방향으로 돌진 거리만큼 미끄러지고, 예고 범위는 처음부터 돌진한 위치에 있다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('sweep'), () => 0);
    const target = { x: 560, y: 500 }; // 오른쪽
    runUntil(boss, target, () => boss.attack !== null);
    const lunge = only('sweep').lungeDistance;
    const shape = boss.attack!.shape;
    expect(shape.kind === 'sector' && shape.cx).toBeCloseTo(500 + lunge, 5);

    runUntil(boss, target, () => boss.state === 'recovery');
    expect(boss.x).toBeCloseTo(500 + lunge, 5);
    expect(boss.y).toBeCloseTo(500, 5);
  });

  it('경기장 밖으로는 돌진하지 않는다', () => {
    const boss = new BossModel(BOUNDS.width - BOSS.radius, 500, BOUNDS, only1('sweep'), () => 0);
    runUntil(boss, { x: BOUNDS.width - 1, y: 500 }, () => boss.state === 'recovery');
    expect(boss.x).toBeLessThanOrEqual(BOUNDS.width - BOSS.radius);
  });
});

describe('연속 베기', () => {
  const combo = pattern('combo');

  it('정해진 타 수만큼 예고·판정을 반복하고, 타마다 공격 번호가 바뀐다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('combo'), () => 0);
    const target = { x: 560, y: 500 };
    const serials = new Set<number>();
    const events: BossEvent[] = [];
    for (let t = 0; t < 10000 && boss.state !== 'watch'; t += STEP_MS) {
      events.push(...boss.update(target, STEP_MS));
      if (boss.attack?.phase === 'active') serials.add(boss.attackSerial);
    }
    const actives = events.filter((e) => e.type === 'attackActive');
    expect(actives.map((e) => e.type === 'attackActive' && e.step)).toEqual(combo.steps.map((_, i) => i));
    expect(serials.size).toBe(combo.steps.length);
    expect(events.filter((e) => e.type === 'attackEnd').length).toBe(1);
  });

  it('중간 타를 패링당해도 계속 몰아치고, 마지막 타를 패링당하면 움찔한다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('combo'), () => 0);
    const target = { x: 560, y: 500 };
    runUntil(boss, target, () => boss.attack?.phase === 'active');
    boss.onParried();
    expect(boss.posture).toBe(BOSS.posture.perParry);
    expect(boss.state).toBe('active');
    expect(boss.attack!.step).toBe(0);

    runUntil(boss, target, () => boss.attack?.phase === 'active' && boss.attack.step === combo.steps.length - 1);
    boss.onParried();
    expect(boss.state).toBe('flinch');
  });

  it('끊는 지점: 정해진 타 수 이전에는 끊을 수 없고, 이후 틈에서는 끊고 다른 공격으로 이어간다', () => {
    const cfg = { ...BOSS, patterns: [combo, pattern('sweep')] }; // 난수 0 → 연속 베기 먼저
    const boss = new BossModel(500, 500, BOUNDS, cfg, () => 0);
    const target = { x: 560, y: 500 };
    const after = combo.cancelAfterHits!;

    runUntil(boss, target, () => boss.attack?.phase === 'telegraph' && boss.attack.step === 0);
    expect(boss.cancelCombo()).toBe(false); // 예고 중

    for (let hit = 1; hit < after; hit++) {
      runUntil(boss, target, () => boss.attack?.phase === 'recovery' && boss.attack.step === hit - 1);
      expect(boss.cancelCombo()).toBe(false); // 아직 이름
    }
    runUntil(boss, target, () => boss.attack?.phase === 'recovery' && boss.attack.step === after - 1);
    expect(boss.cancelCombo('sweep')).toBe(true);
    expect(boss.attack).toBeNull();
    expect(boss.plannedPattern?.id).toBe('sweep');
  });

  it('마지막 타 뒤에는 끊을 것이 없다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('combo'), () => 0);
    const target = { x: 560, y: 500 };
    runUntil(boss, target, () => boss.attack?.phase === 'recovery' && boss.attack.step === combo.steps.length - 1);
    expect(boss.cancelCombo()).toBe(false);
  });

  it('끊을 수 없는 패턴은 끊기지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('sweep'), () => 0);
    runUntil(boss, { x: 560, y: 500 }, () => boss.attack?.phase === 'recovery');
    expect(boss.cancelCombo()).toBe(false);
  });
});

describe('자세 게이지 배율', () => {
  it('배율만큼 자세 게이지가 더 쌓인다 (체력 피해는 그대로)', () => {
    const boss = new BossModel(500, 500, BOUNDS, BOSS, () => 0);
    boss.applyHit(10, 2);
    expect(boss.hp).toBe(BOSS.maxHp - 10);
    expect(boss.posture).toBeCloseTo(10 * BOSS.posture.perDamage * 2, 10);
  });
});

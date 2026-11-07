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
    runUntil(boss, { x: 700, y: 600 }, () => boss.attack !== null); // 해머로 바꿔 든 뒤 예고 시작
    expect(boss.attack?.pattern.id).toBe('slam');
    expect(boss.weapon).toBe('hammer');
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
    expect(boss.state === 'approach' || boss.state === 'swap').toBe(true); // 다음 공격 무기가 다르면 바꿔 드는 중
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

describe('무기', () => {
  it('처음에는 시작 무기를 들고 있다', () => {
    expect(new BossModel(500, 500, BOUNDS, BOSS, () => 0).weapon).toBe(BOSS.startWeapon);
  });

  it('고른 패턴의 무기가 다르면 정해진 시간 동안 바꿔 든 뒤 공격한다 (그동안은 공격 없음)', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('thrust'), () => 0); // 찌르기 = 창
    const target = { x: 600, y: 500 };
    const events = run(boss, target, STEP_MS);
    expect(boss.state).toBe('swap');
    expect(events.some((e) => e.type === 'weaponSwap' && e.from === BOSS.startWeapon && e.to === 'spear')).toBe(true);

    run(boss, target, BOSS.weaponSwapMs - STEP_MS * 2);
    expect(boss.state).toBe('swap');
    expect(boss.attack).toBeNull();
    expect(boss.weapon).toBe(BOSS.startWeapon); // 교체가 끝나기 전엔 이전 무기

    run(boss, target, STEP_MS * 2);
    expect(boss.weapon).toBe('spear');
    runUntil(boss, target, () => boss.attack !== null);
    expect(boss.attack!.pattern.id).toBe('thrust');
  });

  it('같은 무기를 쓰는 패턴이면 바꾸지 않는다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('sweep'), () => 0); // 휘두르기 = 대검 (시작 무기)
    const events = runUntil(boss, { x: 560, y: 500 }, () => boss.attack !== null);
    expect(events.some((e) => e.type === 'weaponSwap')).toBe(false);
  });

  it('교체 중에 자세가 무너지면 교체가 취소되고 이전 무기를 그대로 든다', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('thrust'), () => 0);
    run(boss, { x: 600, y: 500 }, STEP_MS * 5);
    expect(boss.state).toBe('swap');
    boss.posture = BOSS.posture.max - 1;
    boss.applyHit(10);
    expect(boss.isStaggered).toBe(true);
    expect(boss.weapon).toBe(BOSS.startWeapon);
    expect(boss.weaponSwap).toBeNull();
  });

  it('모든 패턴에 무기가 정해져 있고, 연속 베기는 쌍검 4번 베기 + 마무리 돌진이다', () => {
    for (const p of BOSS.patterns) expect(typeof p.weapon).toBe('string');
    const combo = pattern('combo');
    expect(combo.weapon).toBe('twinblades');
    expect(combo.steps.length).toBe(5);
    expect(combo.steps[4].shape?.kind).toBe('dashRect');
  });

  it('무기마다 이동 속도가 다르다: 쌍검이 대검보다 빨리 다가간다', () => {
    const cfg = (w: 'twinblades' | 'greatsword') => ({ ...BOSS, startWeapon: w, patterns: [{ ...pattern('sweep'), weapon: w }] });
    const fast = new BossModel(200, 500, BOUNDS, cfg('twinblades'), () => 0);
    const slow = new BossModel(200, 500, BOUNDS, cfg('greatsword'), () => 0);
    run(fast, { x: 900, y: 500 }, 500);
    run(slow, { x: 900, y: 500 }, 500);
    expect(fast.x - 200).toBeCloseTo((BOSS.weaponMoveSpeed.twinblades * 500) / 1000, 0);
    expect(slow.x - 200).toBeCloseTo((BOSS.weaponMoveSpeed.greatsword * 500) / 1000, 0);
  });
});

describe('쌍검 마무리 돌진', () => {
  const combo = pattern('combo');
  const last = combo.steps.length - 1;

  it('베기 4번은 패링 가능, 마무리 돌진은 패링 불가', () => {
    const boss = new BossModel(500, 500, BOUNDS, only1('combo'), () => 0);
    const target = { x: 560, y: 500 };
    const parryable: boolean[] = [];
    for (let t = 0; t < 20000 && boss.state !== 'watch'; t += STEP_MS) {
      boss.update(target, STEP_MS);
      const a = boss.attack;
      if (a && a.phase === 'telegraph' && parryable.length === a.step) parryable.push(a.parryable);
    }
    expect(parryable).toEqual([true, true, true, true, false]);
  });

  it('예고를 시작한 자리에서 뻗는 직사각형이고, 판정 동안 그 길을 따라 빠르게 돌진한다', () => {
    const boss = new BossModel(300, 500, BOUNDS, only1('combo'), () => 0);
    // 오른쪽 멀리: 베기 4번의 돌진(30×4)으로도 지나치지 않는 거리 (지나치면 보스가 돌아서서 반대로 돌진함)
    const target = { x: 700, y: 500 };
    runUntil(boss, target, () => boss.attack?.phase === 'telegraph' && boss.attack.step === last);
    const startX = boss.x;
    const shape = boss.attack!.shape;
    expect(shape.kind).toBe('rect');
    expect(shape.kind === 'rect' && shape.x).toBeCloseTo(startX, 5);
    expect(shape.kind === 'rect' && shape.length).toBe(combo.steps[last].shape!.length);

    runUntil(boss, target, () => boss.attack?.phase === 'recovery' && boss.attack.step === last);
    expect(boss.x - startX).toBeCloseTo(combo.steps[last].lungeDistance, 0);
  });
});

describe('창 3연속 찌르기', () => {
  it('세 번 찌르고(모두 패링 가능), 세 번째는 두 번째보다 늦게 온다', () => {
    const thrust = pattern('thrust');
    expect(thrust.weapon).toBe('spear');
    expect(thrust.steps.length).toBe(3);
    expect(thrust.steps.every((s) => s.category === undefined)).toBe(true);
    expect(thrust.category).toBe('normal');
    expect(thrust.steps[2].telegraphMs).toBeGreaterThan(thrust.steps[1].telegraphMs);
  });
});

describe('무기 2부: 원거리 타·지연 내려찍기·새 무기', () => {
  it('사격: 판정 순간 탄을 쏘고(fire 이벤트), 근접 판정은 없다', () => {
    const boss = new BossModel(200, 300, BOUNDS, only1('shot'), () => 0);
    const target = { x: 700, y: 300 };
    const events = runUntil(boss, target, () => boss.attack?.phase === 'active');
    expect(boss.attack!.melee).toBe(false);
    expect(boss.attack!.fire).toBe('bullet');
    const fire = events.find((e) => e.type === 'fire');
    expect(fire && fire.type === 'fire' && fire.parryable).toBe(true);
    expect(fire && fire.type === 'fire' && Math.abs(fire.angle)).toBeLessThan(0.05); // 오른쪽(플레이어 쪽)으로
  });

  it('지면 파동은 패링 불가 충격파를 쏜다', () => {
    const boss = new BossModel(200, 300, BOUNDS, only1('wave'), () => 0);
    const events = runUntil(boss, { x: 700, y: 300 }, () => boss.attack?.phase === 'active');
    const fire = events.find((e) => e.type === 'fire');
    expect(fire && fire.type === 'fire' && fire.kind).toBe('wave');
    expect(fire && fire.type === 'fire' && fire.parryable).toBe(false);
  });

  it('지연 내려찍기: 공중에서 멈칫하는 동안 높이가 유지되고 착지 지점을 따라다닌다', () => {
    const p = pattern('delayedSlam');
    if (p.shape !== 'circle' || !p.hang) throw new Error('지연 내려찍기 설정이 원형+멈칫이어야 함');
    const boss = new BossModel(200, 300, BOUNDS, only1('delayedSlam'), () => 0);
    runUntil(boss, { x: 700, y: 300 }, () => boss.attack !== null);
    const T = p.steps[0].telegraphMs;
    run(boss, { x: 700, y: 300 }, T * (p.hang.from + 0.05));
    const z1 = boss.z;
    run(boss, { x: 600, y: 350 }, T * 0.2); // 멈칫 중 이동 → 따라옴 (아직 고정 전)
    expect(boss.z).toBeCloseTo(z1, 5);
    expect(z1).toBeCloseTo(p.jumpHeight!, 0);
    expect(boss.x).toBeCloseTo(600, 0);
    runUntil(boss, { x: 600, y: 350 }, () => boss.state === 'active');
    expect(boss.z).toBe(0);
  });

  it('새 패턴: 잡기·몸통 돌진은 맨손(패링 불가), 추격 베기는 대검 3타(패링 가능)', () => {
    expect(pattern('grab').weapon).toBe('bare');
    expect(pattern('charge').weapon).toBe('bare');
    expect(pattern('grab').category).toBe('heavy');
    expect(pattern('charge').category).toBe('heavy');
    expect(pattern('pursuit').weapon).toBe('greatsword');
    expect(pattern('pursuit').steps.length).toBe(3);
    expect(pattern('pursuit').category).toBe('normal');
  });

  it('카테고리 수: 일반 5, 강 6', () => {
    expect(BOSS.patterns.filter((p) => p.category === 'normal').length).toBe(5);
    expect(BOSS.patterns.filter((p) => p.category === 'heavy').length).toBe(6);
  });
});

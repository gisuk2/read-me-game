import { describe, expect, it } from 'vitest';
import { CombatSystem, separation, type CombatBoss, type CombatPlayer } from '../src/combat/CombatSystem';
import type { AttackShape } from '../src/utils/shapes';
import { PlayerModel } from '../src/entities/player/PlayerModel';
import { BossModel } from '../src/entities/boss/BossModel';
import { BOSS } from '../src/config/bossBalance';
import { NO_INPUT } from '../src/input/types';

/** 테스트용 가짜 플레이어: 필요한 값만 직접 정하고, 맞은 기록을 남긴다 */
function fakePlayer(over: Partial<CombatPlayer> = {}): CombatPlayer & { hits: number[] } {
  const hits: number[] = [];
  return {
    x: 0,
    y: 0,
    radius: 12,
    isDead: false,
    isInvulnerable: false,
    isParryActive: false,
    attack: null,
    hits,
    applyHit(damage: number) {
      hits.push(damage);
      return { died: false };
    },
    ...over,
  };
}

/** 테스트용 가짜 보스 */
function fakeBoss(over: Partial<CombatBoss> = {}): CombatBoss & { hits: number[]; multipliers: number[]; parried: number } {
  const state = { hits: [] as number[], multipliers: [] as number[], parried: 0 };
  return {
    x: 100,
    y: 0,
    z: 0,
    radius: 40,
    isDead: false,
    attackSerial: 1,
    attack: null,
    get hits() {
      return state.hits;
    },
    get parried() {
      return state.parried;
    },
    get multipliers() {
      return state.multipliers;
    },
    applyHit(damage: number, postureMultiplier = 1) {
      state.hits.push(damage);
      state.multipliers.push(postureMultiplier);
      return { died: false, staggerStarted: false, dealt: damage };
    },
    onParried() {
      state.parried += 1;
      return { staggerStarted: false };
    },
    ...over,
  };
}

const rules = { bossHittableMaxZ: 20 };

/** 플레이어 위치(0,0)를 덮는 보스 공격 */
const circleOnPlayer: AttackShape = { kind: 'circle', cx: 0, cy: 0, radius: 50 };
const bossAttack = (parryable: boolean) => ({
  phase: 'active' as const,
  pattern: { id: 'sweep' as const, damage: 20 },
  parryable,
  melee: true,
  shape: circleOnPlayer,
});

/** 오른쪽(보스 쪽)을 향한 플레이어 공격 판정 */
const playerSwing = (serial: number, postureMultiplier = 1) => ({
  serial,
  phase: 'active' as const,
  shape: { kind: 'sector' as const, cx: 0, cy: 0, radius: 70, angle: 0, arcRad: Math.PI / 2 },
  damage: 10,
  postureMultiplier,
});

describe('플레이어 → 보스', () => {
  it('공격 판정이 보스에 닿으면 피해를 준다', () => {
    const combat = new CombatSystem(rules);
    const boss = fakeBoss();
    const events = combat.resolve(fakePlayer({ attack: playerSwing(1) }), boss);
    expect(boss.hits).toEqual([10]);
    expect(events.some((e) => e.type === 'playerHitBoss')).toBe(true);
  });

  it('한 번 휘두르면 판정 시간 동안 여러 프레임이 지나도 한 번만 맞는다', () => {
    const combat = new CombatSystem(rules);
    const boss = fakeBoss();
    const player = fakePlayer({ attack: playerSwing(1) });
    combat.resolve(player, boss);
    combat.resolve(player, boss);
    combat.resolve(player, boss);
    expect(boss.hits.length).toBe(1);
    combat.resolve(fakePlayer({ attack: playerSwing(2) }), boss); // 다음 타
    expect(boss.hits.length).toBe(2);
  });

  it('공격의 자세 게이지 배율을 보스에게 전달한다 (3타)', () => {
    const combat = new CombatSystem(rules);
    const boss = fakeBoss();
    combat.resolve(fakePlayer({ attack: playerSwing(1, 2) }), boss);
    expect(boss.multipliers).toEqual([2]);
  });

  it('준비 단계에서는 맞지 않는다 (판정 단계에서만)', () => {
    const combat = new CombatSystem(rules);
    const boss = fakeBoss();
    combat.resolve(fakePlayer({ attack: { ...playerSwing(1), phase: 'startup' } }), boss);
    expect(boss.hits.length).toBe(0);
  });

  it('점프해서 떠 있는 보스는 맞지 않는다', () => {
    const combat = new CombatSystem(rules);
    const boss = fakeBoss({ z: 60 });
    combat.resolve(fakePlayer({ attack: playerSwing(1) }), boss);
    expect(boss.hits.length).toBe(0);
  });
});

describe('보스 → 플레이어', () => {
  it('판정에 닿으면 피해를 주고, 같은 공격으로는 한 번만 맞는다', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer();
    const boss = fakeBoss({ attack: bossAttack(true) });
    combat.resolve(player, boss);
    combat.resolve(player, boss);
    expect(player.hits).toEqual([20]);
  });

  it('원거리 타는 근접 판정이 없다 (조준선은 예고일 뿐, 맞히는 건 날아가는 탄)', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer();
    const events = combat.resolve(player, fakeBoss({ attack: { ...bossAttack(true), melee: false } }));
    expect(player.hits).toEqual([]);
    expect(events.length).toBe(0);
  });

  it('연속기: 다음 타(공격 번호가 바뀜)는 다시 맞는다', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer();
    const step1 = fakeBoss({ attack: bossAttack(true), attackSerial: 1 });
    const step2 = fakeBoss({ attack: bossAttack(true), attackSerial: 2 });
    combat.resolve(player, step1);
    combat.resolve(player, step1);
    combat.resolve(player, step2);
    combat.resolve(player, step2);
    expect(player.hits).toEqual([20, 20]);
  });

  it('대시 무적 중에는 피해 없이 회피로 기록된다 (한 공격당 한 번)', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer({ isInvulnerable: true });
    const boss = fakeBoss({ attack: bossAttack(true) });
    const e1 = combat.resolve(player, boss);
    const e2 = combat.resolve(player, boss);
    expect(player.hits.length).toBe(0);
    expect(e1.filter((e) => e.type === 'playerDodged').length).toBe(1);
    expect(e2.filter((e) => e.type === 'playerDodged').length).toBe(0);
  });

  it('무적이 끝났는데 아직 판정 안에 있으면 맞는다 (타이밍이 늦은 회피)', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer({ isInvulnerable: true });
    const boss = fakeBoss({ attack: bossAttack(true) });
    combat.resolve(player, boss);
    (player as { isInvulnerable: boolean }).isInvulnerable = false; // 무적 시간이 끝남
    combat.resolve(player, boss);
    expect(player.hits).toEqual([20]);
  });

  it('패링 판정 중 + 패링 가능한 공격 → 피해 없이 패링 성공', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer({ isParryActive: true });
    const boss = fakeBoss({ attack: bossAttack(true) });
    const events = combat.resolve(player, boss);
    expect(player.hits.length).toBe(0);
    expect(boss.parried).toBe(1);
    expect(events.some((e) => e.type === 'playerParried')).toBe(true);
  });

  it('패링 불가 공격은 패링 중이어도 맞는다', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer({ isParryActive: true });
    const boss = fakeBoss({ attack: bossAttack(false) });
    combat.resolve(player, boss);
    expect(player.hits).toEqual([20]);
    expect(boss.parried).toBe(0);
  });

  it('예고 단계에서는 맞지 않는다', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer();
    combat.resolve(player, fakeBoss({ attack: { ...bossAttack(true), phase: 'telegraph' } }));
    expect(player.hits.length).toBe(0);
  });

  it('쓰러진 뒤에는 아무 판정도 하지 않는다', () => {
    const combat = new CombatSystem(rules);
    const player = fakePlayer({ isDead: true });
    expect(combat.resolve(player, fakeBoss({ attack: bossAttack(true) }))).toEqual([]);
  });
});

describe('몸 겹침 밀어내기', () => {
  it('겹친 만큼 바깥쪽으로 밀어낸다', () => {
    const push = separation(30, 0, 12, 0, 0, 40); // 겹침 22
    expect(push.dx).toBeCloseTo(22, 10);
    expect(push.dy).toBeCloseTo(0, 10);
  });

  it('겹치지 않으면 밀지 않는다', () => {
    expect(separation(100, 0, 12, 0, 0, 40)).toEqual({ dx: 0, dy: 0 });
  });
});

describe('실제 플레이어·보스 모델로 연결 확인', () => {
  // 가짜 객체가 실제 클래스와 어긋나지 않는지 확인하는 통합 테스트
  it('플레이어가 보스를 때리면 실제로 보스 체력이 준다', () => {
    const bounds = { width: 1000, height: 1000 };
    const player = new PlayerModel(500, 500, bounds);
    const boss = new BossModel(560, 500, bounds, BOSS, () => 0); // 오른쪽 60px
    const combat = new CombatSystem({ bossHittableMaxZ: BOSS.hittableMaxZ });

    player.update({ ...NO_INPUT, attack: true, aimAngle: 0 }, 10);
    for (let t = 0; t < 400; t += 10) {
      player.update({ ...NO_INPUT, aimAngle: 0 }, 10);
      combat.resolve(player, boss);
    }
    expect(boss.hp).toBe(BOSS.maxHp - 10);
  });

  it('보스의 휘두르기에 서 있으면 쓰러지고, 판정 순간 패링하면 막는다', () => {
    const bounds = { width: 1000, height: 1000 };

    const runFight = (parryAtActive: boolean) => {
      const player = new PlayerModel(560, 500, bounds);
      const boss = new BossModel(500, 500, bounds, BOSS, () => 0); // 거리 60 → 휘두르기
      const combat = new CombatSystem({ bossHittableMaxZ: BOSS.hittableMaxZ });
      let parried = false;
      for (let t = 0; t < 3000; t += 10) {
        const parry = parryAtActive && !parried && boss.attack?.phase === 'telegraph' && boss.attack.phaseProgress > 0.95;
        if (parry) parried = true;
        player.update({ ...NO_INPUT, parry }, 10);
        boss.update({ x: player.x, y: player.y }, 10);
        combat.resolve(player, boss);
        if (boss.state === 'watch' || boss.state === 'flinch') break;
      }
      return { player, boss };
    };

    const stood = runFight(false);
    expect(stood.player.isDead).toBe(true); // 한 방 사망

    const parried = runFight(true);
    expect(parried.player.isDead).toBe(false);
    expect(parried.boss.posture).toBe(BOSS.posture.perParry);
  });
});

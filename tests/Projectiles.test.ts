import { describe, expect, it } from 'vitest';
import { ProjectileSystem, PROJECTILE_RULES, type ProjectileSpawn } from '../src/combat/Projectiles';
import type { CombatBoss, CombatPlayer } from '../src/combat/CombatSystem';

const BOUNDS = { width: 1000, height: 600 };

function fakePlayer(over: Partial<CombatPlayer> = {}): CombatPlayer & { hits: number } {
  const state = { hits: 0 };
  return {
    x: 500,
    y: 300,
    radius: 12,
    isDead: false,
    isInvulnerable: false,
    isParryActive: false,
    attack: null,
    applyHit() {
      state.hits += 1;
      return { died: true };
    },
    get hits() {
      return state.hits;
    },
    ...over,
  };
}

function fakeBoss(over: Partial<CombatBoss> = {}): CombatBoss & { hits: { damage: number; mult: number }[] } {
  const hits: { damage: number; mult: number }[] = [];
  return {
    x: 100,
    y: 300,
    z: 0,
    radius: 40,
    isDead: false,
    attackSerial: 0,
    attack: null,
    applyHit(damage: number, mult = 1) {
      hits.push({ damage, mult });
      return { died: false, staggerStarted: false, dealt: damage };
    },
    onParried() {
      return { staggerStarted: false };
    },
    hits,
    ...over,
  };
}

/** 보스(왼쪽)가 플레이어(오른쪽)를 향해 쏜 탄 */
const shotAtPlayer = (over: Partial<ProjectileSpawn> = {}): ProjectileSpawn => ({
  kind: 'bullet',
  x: 150,
  y: 300,
  angle: 0,
  speed: 500,
  radius: 7,
  damage: 15,
  parryable: true,
  patternId: 'shot',
  ...over,
});

/** 탄이 다 사라지거나 maxMs가 될 때까지 진행 */
function run(sys: ProjectileSystem, player: CombatPlayer, boss: CombatBoss, maxMs = 3000) {
  const events = [];
  for (let t = 0; t < maxMs && sys.projectiles.length > 0; t += 10) events.push(...sys.update(10, player, boss));
  return events;
}

describe('날아가는 물체', () => {
  it('속도대로 움직인다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    sys.spawn(shotAtPlayer({ x: 0, y: 0, angle: Math.PI / 2, speed: 100 }));
    sys.update(500, fakePlayer({ x: 900, y: 500 }), fakeBoss());
    expect(sys.projectiles[0].x).toBeCloseTo(0, 5);
    expect(sys.projectiles[0].y).toBeCloseTo(50, 5);
  });

  it('경기장 밖으로 나가면 사라진다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    sys.spawn(shotAtPlayer({ angle: Math.PI })); // 왼쪽 벽으로
    run(sys, fakePlayer(), fakeBoss({ x: 900 }));
    expect(sys.projectiles.length).toBe(0);
  });

  it('플레이어에게 맞으면 피해를 주고 사라진다 (한 번만)', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const player = fakePlayer();
    sys.spawn(shotAtPlayer());
    const events = run(sys, player, fakeBoss());
    expect(player.hits).toBe(1);
    expect(events.filter((e) => e.type === 'bossHitPlayer').length).toBe(1);
    expect(events.some((e) => e.type === 'playerDied')).toBe(true);
  });

  it('대시 무적이면 통과하고 회피로 한 번만 기록된다 (물체는 계속 날아감)', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const player = fakePlayer({ isInvulnerable: true });
    sys.spawn(shotAtPlayer());
    const events = run(sys, player, fakeBoss());
    expect(player.hits).toBe(0);
    expect(events.filter((e) => e.type === 'playerDodged').length).toBe(1);
  });

  it('패링하면 탄이 보스에게 되돌아가 피해와 큰 자세 게이지를 준다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const player = fakePlayer({ isParryActive: true });
    const boss = fakeBoss();
    sys.spawn(shotAtPlayer());
    const events = run(sys, player, boss);
    expect(player.hits).toBe(0);
    expect(events.some((e) => e.type === 'playerParried')).toBe(true);
    expect(boss.hits).toEqual([{ damage: 15, mult: PROJECTILE_RULES.reflectPostureMultiplier }]);
    expect(events.some((e) => e.type === 'playerHitBoss')).toBe(true);
  });

  it('패링 불가 물체(충격파)는 패링 중이어도 맞는다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const player = fakePlayer({ isParryActive: true });
    sys.spawn(shotAtPlayer({ kind: 'wave', parryable: false, radius: 30, patternId: 'wave' }));
    run(sys, player, fakeBoss());
    expect(player.hits).toBe(1);
  });

  it('튕겨낸 탄은 점프 중인 보스에게는 맞지 않는다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const boss = fakeBoss({ z: PROJECTILE_RULES.bossHittableMaxZ + 1 });
    sys.spawn(shotAtPlayer());
    run(sys, fakePlayer({ isParryActive: true }), boss);
    expect(boss.hits.length).toBe(0);
  });

  it('쓰러진 플레이어는 맞지 않는다', () => {
    const sys = new ProjectileSystem(BOUNDS);
    const player = fakePlayer({ isDead: true });
    sys.spawn(shotAtPlayer());
    run(sys, player, fakeBoss());
    expect(player.hits).toBe(0);
  });
});

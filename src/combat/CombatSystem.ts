import type { BossPatternId } from '../config/bossBalance';
import { circleHitsShape, type AttackShape } from '../utils/shapes';

/**
 * 전투 판정 (순수 로직, Phaser 의존 없음).
 *
 * 매 프레임 플레이어와 보스를 보고 "누가 누구를 맞혔는지"를 정한다.
 * 여기서 나오는 이벤트(패링 성공, 대시로 회피, 피격…)가 이후 보스가 학습하는 데이터가 된다.
 *
 * 테스트에서 가짜 객체를 넣을 수 있도록, 필요한 기능만 인터페이스로 받는다.
 */

export interface CombatPlayer {
  x: number;
  y: number;
  readonly radius: number;
  readonly isDead: boolean;
  readonly isInvulnerable: boolean;
  readonly isParryActive: boolean;
  readonly attack: {
    serial: number;
    phase: 'startup' | 'active' | 'recovery';
    angle: number;
    range: number;
    arcRad: number;
    damage: number;
  } | null;
  applyHit(damage: number, fromX: number, fromY: number): { died: boolean };
}

export interface CombatBoss {
  x: number;
  y: number;
  z: number;
  readonly radius: number;
  readonly isDead: boolean;
  readonly attackSerial: number;
  readonly attack: {
    phase: 'telegraph' | 'active' | 'recovery';
    pattern: { id: BossPatternId; damage: number; parryable: boolean };
    shape: AttackShape;
  } | null;
  applyHit(damage: number): { died: boolean; staggerStarted: boolean; dealt: number };
  onParried(): { staggerStarted: boolean };
}

export type CombatEvent =
  | { type: 'playerHitBoss'; damage: number }
  | { type: 'bossHitPlayer'; damage: number; patternId: BossPatternId }
  | { type: 'playerDodged'; patternId: BossPatternId }
  | { type: 'playerParried'; patternId: BossPatternId }
  | { type: 'bossStaggered' }
  | { type: 'playerDied' }
  | { type: 'bossDied' };

export interface CombatRules {
  /** 이 높이보다 높이 떠 있는 보스(점프 중)는 맞지 않는다 */
  bossHittableMaxZ: number;
}

export class CombatSystem {
  /** 이미 보스를 맞힌 플레이어 공격 번호 (한 번 휘두르면 한 번만 맞음) */
  private lastPlayerSwing = -1;
  /** 이미 결과(피격·패링)가 정해진 보스 공격 번호 */
  private lastBossAttackResolved = -1;
  /** 이미 "회피" 기록을 남긴 보스 공격 번호 (한 공격당 한 번만 기록) */
  private lastBossAttackDodged = -1;

  constructor(private readonly rules: CombatRules) {}

  resolve(player: CombatPlayer, boss: CombatBoss): CombatEvent[] {
    const events: CombatEvent[] = [];
    if (player.isDead || boss.isDead) return events;

    this.resolvePlayerAttack(player, boss, events);
    if (!boss.isDead) this.resolveBossAttack(player, boss, events);
    return events;
  }

  private resolvePlayerAttack(player: CombatPlayer, boss: CombatBoss, events: CombatEvent[]): void {
    const atk = player.attack;
    if (!atk || atk.phase !== 'active' || atk.serial === this.lastPlayerSwing) return;
    if (boss.z > this.rules.bossHittableMaxZ) return; // 점프 중인 보스는 맞지 않음

    const shape: AttackShape = { kind: 'sector', cx: player.x, cy: player.y, radius: atk.range, angle: atk.angle, arcRad: atk.arcRad };
    if (!circleHitsShape(boss.x, boss.y, boss.radius, shape)) return;

    this.lastPlayerSwing = atk.serial;
    const result = boss.applyHit(atk.damage);
    events.push({ type: 'playerHitBoss', damage: result.dealt });
    if (result.staggerStarted) events.push({ type: 'bossStaggered' });
    if (result.died) events.push({ type: 'bossDied' });
  }

  /**
   * 보스 공격 판정 순서:
   *   1. 대시 무적 중 → 회피 (판정 시간이 남아 있으면 무적이 끝난 뒤 맞을 수 있음)
   *   2. 패링 판정 중 + 패링 가능한 공격 → 패링 성공
   *   3. 그 외 → 피격 (패링 불가 공격은 패링 중에도 맞음)
   */
  private resolveBossAttack(player: CombatPlayer, boss: CombatBoss, events: CombatEvent[]): void {
    const atk = boss.attack;
    if (!atk || atk.phase !== 'active' || boss.attackSerial === this.lastBossAttackResolved) return;
    if (!circleHitsShape(player.x, player.y, player.radius, atk.shape)) return;

    const id = atk.pattern.id;

    if (player.isInvulnerable) {
      if (this.lastBossAttackDodged !== boss.attackSerial) {
        this.lastBossAttackDodged = boss.attackSerial;
        events.push({ type: 'playerDodged', patternId: id });
      }
      return;
    }

    this.lastBossAttackResolved = boss.attackSerial;

    if (player.isParryActive && atk.pattern.parryable) {
      const result = boss.onParried();
      events.push({ type: 'playerParried', patternId: id });
      if (result.staggerStarted) events.push({ type: 'bossStaggered' });
      return;
    }

    const result = player.applyHit(atk.pattern.damage, boss.x, boss.y);
    events.push({ type: 'bossHitPlayer', damage: atk.pattern.damage, patternId: id });
    if (result.died) events.push({ type: 'playerDied' });
  }
}

/**
 * 두 원이 겹치면, 첫 번째 원을 밀어낼 벡터를 돌려준다 (겹치지 않으면 0).
 * 플레이어가 보스 몸을 통과하지 못하게 할 때 쓴다.
 */
export function separation(ax: number, ay: number, ar: number, bx: number, by: number, br: number): { dx: number; dy: number } {
  const dx = ax - bx;
  const dy = ay - by;
  const dist = Math.hypot(dx, dy);
  const overlap = ar + br - dist;
  if (overlap <= 0) return { dx: 0, dy: 0 };
  if (dist === 0) return { dx: overlap, dy: 0 };
  return { dx: (dx / dist) * overlap, dy: (dy / dist) * overlap };
}

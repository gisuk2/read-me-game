import type { BossPatternId } from '../config/bossBalance';
import type { Bounds } from '../entities/player/PlayerModel';
import type { CombatBoss, CombatEvent, CombatPlayer } from './CombatSystem';

/**
 * 날아가는 물체 (탄·충격파). 순수 로직.
 *
 * 판정 규칙 (보스가 쏜 것 → 플레이어):
 *   1. 대시 무적 중이면 통과 (회피로 한 번 기록, 물체는 계속 날아감)
 *   2. 패링 판정 중 + 패링 가능한 물체(탄) → **튕겨냄**: 보스를 향해 더 빠르게 되돌아감
 *   3. 그 외에는 맞음 → 물체는 사라짐
 * 튕겨낸 탄 → 보스: 맞으면 피해 + 자세 게이지 배율 (점프 중인 보스는 지나감)
 * 경기장 밖으로 나가면 사라진다.
 */
export type ProjectileKind = 'bullet' | 'wave';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  parryable: boolean;
  /** 누가 쏜 것인가 (튕겨내면 player) */
  owner: 'boss' | 'player';
  patternId: BossPatternId;
  /** 대시로 피한 것으로 이미 기록했는가 */
  dodged: boolean;
}

export interface ProjectileSpawn {
  kind: ProjectileKind;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
  damage: number;
  parryable: boolean;
  patternId: BossPatternId;
}

export interface ProjectileRules {
  /** 튕겨낼 때 속도 배율 */
  reflectSpeedMultiplier: number;
  /** 튕겨낸 탄이 보스에게 주는 자세 게이지 배율 */
  reflectPostureMultiplier: number;
  /** 이 높이보다 떠 있는 보스는 맞지 않는다 */
  bossHittableMaxZ: number;
}

export const PROJECTILE_RULES: ProjectileRules = {
  reflectSpeedMultiplier: 1.3,
  reflectPostureMultiplier: 2,
  bossHittableMaxZ: 20,
};

export class ProjectileSystem {
  projectiles: Projectile[] = [];
  private nextId = 1;

  constructor(
    private readonly bounds: Bounds,
    private readonly rules: ProjectileRules = PROJECTILE_RULES,
  ) {}

  spawn(s: ProjectileSpawn): Projectile {
    const p: Projectile = {
      id: this.nextId++,
      kind: s.kind,
      x: s.x,
      y: s.y,
      vx: Math.cos(s.angle) * s.speed,
      vy: Math.sin(s.angle) * s.speed,
      radius: s.radius,
      damage: s.damage,
      parryable: s.parryable,
      owner: 'boss',
      patternId: s.patternId,
      dodged: false,
    };
    this.projectiles.push(p);
    return p;
  }

  /** 움직이고 판정한다. 맞은 물체와 경기장 밖 물체는 사라진다 */
  update(dtMs: number, player: CombatPlayer, boss: CombatBoss): CombatEvent[] {
    const events: CombatEvent[] = [];
    const sec = dtMs / 1000;
    const keep: Projectile[] = [];

    for (const p of this.projectiles) {
      p.x += p.vx * sec;
      p.y += p.vy * sec;
      if (this.isOutside(p)) continue;
      const consumed = p.owner === 'boss' ? this.hitPlayer(p, player, boss, events) : this.hitBoss(p, boss, events);
      if (!consumed) keep.push(p);
    }
    this.projectiles = keep;
    return events;
  }

  clear(): void {
    this.projectiles = [];
  }

  /** @returns 물체가 사라졌으면 true */
  private hitPlayer(p: Projectile, player: CombatPlayer, boss: CombatBoss, events: CombatEvent[]): boolean {
    if (player.isDead || !overlaps(p, player.x, player.y, player.radius)) return false;

    if (player.isInvulnerable) {
      if (!p.dodged) {
        p.dodged = true;
        events.push({ type: 'playerDodged', patternId: p.patternId });
      }
      return false;
    }
    if (player.isParryActive && p.parryable) {
      // 튕겨냄: 보스를 향해 되돌아감
      const speed = Math.hypot(p.vx, p.vy) * this.rules.reflectSpeedMultiplier;
      const ang = Math.atan2(boss.y - p.y, boss.x - p.x);
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
      p.owner = 'player';
      events.push({ type: 'playerParried', patternId: p.patternId });
      return false;
    }
    const result = player.applyHit(p.damage, p.x - p.vx * 0.05, p.y - p.vy * 0.05);
    events.push({ type: 'bossHitPlayer', damage: p.damage, patternId: p.patternId });
    if (result.died) events.push({ type: 'playerDied' });
    return true;
  }

  private hitBoss(p: Projectile, boss: CombatBoss, events: CombatEvent[]): boolean {
    if (boss.isDead || boss.z > this.rules.bossHittableMaxZ || !overlaps(p, boss.x, boss.y, boss.radius)) return false;
    const result = boss.applyHit(p.damage, this.rules.reflectPostureMultiplier);
    events.push({ type: 'playerHitBoss', damage: result.dealt });
    if (result.staggerStarted) events.push({ type: 'bossStaggered' });
    if (result.died) events.push({ type: 'bossDied' });
    return true;
  }

  private isOutside(p: Projectile): boolean {
    const m = p.radius;
    return p.x < -m || p.y < -m || p.x > this.bounds.width + m || p.y > this.bounds.height + m;
  }
}

const overlaps = (p: Projectile, x: number, y: number, r: number): boolean => {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy <= (p.radius + r) * (p.radius + r);
};

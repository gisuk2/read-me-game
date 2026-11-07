import { BOSS, type BossConfig, type BossPatternConfig, type BossPatternId } from '../../config/bossBalance';
import { clamp } from '../../utils/math';
import { degToRad, type Vec2 } from '../../utils/geometry';
import { wrapAngle, type AttackShape } from '../../utils/shapes';
import type { Bounds } from '../player/PlayerModel';

export type BossState = 'watch' | 'approach' | 'telegraph' | 'active' | 'recovery' | 'rest' | 'flinch' | 'staggered' | 'dead';
/** 관찰 중 행동: 노려보기 / 왼쪽으로 돌기 / 오른쪽으로 돌기 */
export type WatchMode = 'stare' | 'strafeLeft' | 'strafeRight';
export type BossAttackPhase = 'telegraph' | 'active' | 'recovery';

/** 보스가 한 일. 이후 이벤트 버스를 통해 판정·학습·NPC·로그로 전달된다. */
export type BossEvent =
  | { type: 'telegraphStart'; patternId: BossPatternId }
  | { type: 'attackActive'; patternId: BossPatternId }
  | { type: 'attackEnd'; patternId: BossPatternId }
  | { type: 'restStart' }
  | { type: 'watchStart'; mode: WatchMode; durationMs: number };

export interface BossAttackInfo {
  pattern: BossPatternConfig;
  phase: BossAttackPhase;
  /** 현재 단계 안에서의 진행률 0~1 */
  phaseProgress: number;
  /** 화면에 그리는 범위 = 실제 판정 범위 */
  shape: AttackShape;
}

/** 0 이상 1 미만의 난수를 돌려주는 함수. 테스트에서는 고정된 값을 넣는다. */
export type Rng = () => number;

/**
 * 다음 공격 고르기 (순수 함수).
 * - 거리가 minDistance보다 가까운 공격은 후보에서 뺀다.
 * - 지금 거리가 사거리 안인 공격은 원래 확률, 사거리 밖(다가가야 하는) 공격은 outOfRangeWeight 배.
 * - 다른 후보가 있으면 직전 공격은 다시 고르지 않는다.
 */
export function choosePattern(
  cfg: BossConfig,
  distance: number,
  lastId: BossPatternId | null,
  rng: Rng,
): BossPatternConfig {
  let candidates = cfg.patterns.filter((p) => distance >= p.minDistance);
  if (candidates.length === 0) candidates = cfg.patterns;
  if (candidates.length > 1 && lastId) {
    const withoutLast = candidates.filter((p) => p.id !== lastId);
    if (withoutLast.length > 0) candidates = withoutLast;
  }

  const weightOf = (p: BossPatternConfig): number =>
    distance <= p.maxDistance ? p.weight : p.weight * cfg.outOfRangeWeight;
  const total = candidates.reduce((sum, p) => sum + weightOf(p), 0);

  let r = rng() * total;
  for (const p of candidates) {
    r -= weightOf(p);
    if (r < 0) return p;
  }
  return candidates[candidates.length - 1];
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * 보스의 순수 로직 (Phaser에 의존하지 않음).
 *
 * 상태 전이:
 *   approach ─(사거리 안 + minIdleMs 지남)→ telegraph ─→ active ─→ recovery ─┬────────────→ watch ─→ approach
 *                                                                          └(restMs > 0)→ rest ─┘
 *   watch(관찰): 공격 후 바로 다가가지 않고 노려보거나 옆으로 돌며 거리를 잰다. 너무 가까우면 물러난다.
 *   (공격 중) ─(패링당함)→ flinch(움찔) ─→ watch
 *   (어느 상태든) ─(자세 게이지 가득)→ staggered(자세 붕괴: 받는 피해 증가) ─→ watch
 *   체력 0 → dead
 *
 * 공정성 원칙:
 *   - 조준은 예고 시작 순간의 플레이어 위치로 고정한다. 예고가 보여준 범위가 그대로 판정 범위다.
 *   - 예고 중에는 회전하지 않는다.
 */
export class BossModel {
  x: number;
  y: number;
  /** 바라보는 방향 (라디안) */
  facing = Math.PI / 2;
  /** 높이 (점프 내려찍기용, 2.5D 표현) */
  z = 0;
  hp: number;
  /** 자세 게이지 (0 ~ cfg.posture.max) */
  posture = 0;
  /** 맞았을 때 반짝이는 남은 시간 (그리기용) */
  hitFlashMs = 0;
  private msSinceHurt = Number.POSITIVE_INFINITY;
  private _attackSerial = 0;

  private _state: BossState = 'approach';
  private stateTimeMs = 0;
  private watchMode: WatchMode = 'stare';
  private watchDurationMs = 0;
  private pattern: BossPatternConfig | null = null;
  private lastPatternId: BossPatternId | null = null;

  private aimAngle = 0;
  private origin: Vec2 = { x: 0, y: 0 };
  private landing: Vec2 = { x: 0, y: 0 };

  private events: BossEvent[] = [];

  constructor(
    x: number,
    y: number,
    private readonly bounds: Bounds,
    private readonly cfg: BossConfig = BOSS,
    private readonly rng: Rng = Math.random,
  ) {
    this.x = x;
    this.y = y;
    this.hp = cfg.maxHp;
  }

  get state(): BossState {
    return this._state;
  }

  get isResting(): boolean {
    return this._state === 'rest';
  }

  get radius(): number {
    return this.cfg.radius;
  }

  get isDead(): boolean {
    return this._state === 'dead';
  }

  get isStaggered(): boolean {
    return this._state === 'staggered';
  }

  /** 공격(예고)마다 1씩 늘어나는 번호. 한 공격이 한 번만 맞도록 판정에서 쓴다 */
  get attackSerial(): number {
    return this._attackSerial;
  }

  /**
   * 플레이어 공격에 맞음 (CombatSystem이 호출).
   * 자세 붕괴 중이면 피해가 배로 들어가고, 아니면 자세 게이지가 쌓인다.
   */
  applyHit(damage: number): { died: boolean; staggerStarted: boolean; dealt: number } {
    if (this._state === 'dead') return { died: false, staggerStarted: false, dealt: 0 };
    const dealt = this.isStaggered ? damage * this.cfg.staggerDamageMultiplier : damage;
    this.hp = Math.max(0, this.hp - dealt);
    this.hitFlashMs = 100;
    this.msSinceHurt = 0;
    if (this.hp === 0) {
      this.cancelAttack();
      this.enter('dead');
      return { died: true, staggerStarted: false, dealt };
    }
    if (this.isStaggered) return { died: false, staggerStarted: false, dealt };
    return { died: false, staggerStarted: this.addPosture(damage * this.cfg.posture.perDamage), dealt };
  }

  /** 공격이 패링당함 (CombatSystem이 호출). 자세 게이지가 크게 쌓이고 공격이 끊긴다 */
  onParried(): { staggerStarted: boolean } {
    if (this._state === 'dead' || this.isStaggered) return { staggerStarted: false };
    this.msSinceHurt = 0;
    if (this.addPosture(this.cfg.posture.perParry)) return { staggerStarted: true };
    this.cancelAttack();
    this.enter('flinch');
    return { staggerStarted: false };
  }

  /** 관찰 중이면 행동 종류, 아니면 null */
  get currentWatchMode(): WatchMode | null {
    return this._state === 'watch' ? this.watchMode : null;
  }

  /** 다음에 쓰려고 고른 공격 (다가가는 중일 때 포함) */
  get plannedPattern(): BossPatternConfig | null {
    return this.pattern;
  }

  /** 공격 중(예고·판정·경직)이면 정보, 아니면 null */
  get attack(): BossAttackInfo | null {
    if (this._state !== 'telegraph' && this._state !== 'active' && this._state !== 'recovery') return null;
    const p = this.pattern;
    if (!p) return null;
    const duration = this._state === 'telegraph' ? p.telegraphMs : this._state === 'active' ? p.activeMs : p.recoveryMs;
    return {
      pattern: p,
      phase: this._state,
      phaseProgress: Math.min(1, this.stateTimeMs / duration),
      shape: this.shapeOf(p),
    };
  }

  update(target: Vec2, dtMs: number): BossEvent[] {
    this.events = [];
    if (this._state === 'dead') return this.events;
    this.stateTimeMs += dtMs;
    this.msSinceHurt += dtMs;
    this.hitFlashMs = Math.max(0, this.hitFlashMs - dtMs);
    this.decayPosture(dtMs);

    switch (this._state) {
      case 'flinch':
        if (this.stateTimeMs >= this.cfg.flinchMs) this.startWatch();
        break;
      case 'staggered':
        if (this.stateTimeMs >= this.cfg.staggerMs) {
          this.posture = 0;
          this.startWatch();
        }
        break;
      case 'watch':
        this.updateWatch(target, dtMs);
        break;
      case 'approach':
        this.updateApproach(target, dtMs);
        break;
      case 'telegraph':
        this.updateTelegraph();
        break;
      case 'active':
        if (this.stateTimeMs >= this.pattern!.activeMs) this.enter('recovery');
        break;
      case 'recovery':
        this.updateRecovery();
        break;
      case 'rest':
        if (this.stateTimeMs >= this.pattern!.restMs) this.finishAttack();
        break;
    }
    return this.events;
  }

  // ───────────────────────── 상태별 처리 ─────────────────────────

  private updateApproach(target: Vec2, dtMs: number): void {
    this.turnToward(target, dtMs);
    const dist = Math.hypot(target.x - this.x, target.y - this.y);

    // 쫓아가도 사거리에 못 붙으면 지금 거리 기준으로 다시 고른다
    if (!this.pattern || this.stateTimeMs >= this.cfg.chaseTimeoutMs) {
      this.pattern = choosePattern(this.cfg, dist, this.lastPatternId, this.rng);
      if (this.stateTimeMs >= this.cfg.chaseTimeoutMs) this.stateTimeMs = this.cfg.minIdleMs;
    }

    if (dist > this.pattern.maxDistance) {
      const step = this.cfg.moveSpeed * (dtMs / 1000);
      this.setPosition(this.x + ((target.x - this.x) / dist) * step, this.y + ((target.y - this.y) / dist) * step);
      return;
    }
    if (this.stateTimeMs >= this.cfg.minIdleMs) this.startTelegraph(target);
  }

  private startTelegraph(target: Vec2): void {
    const p = this.pattern!;
    this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
    this.facing = this.aimAngle;
    this.origin = { x: this.x, y: this.y };
    this._attackSerial += 1;
    if (p.shape === 'circle' && p.anchor === 'target') {
      const r = this.cfg.radius;
      this.landing = {
        x: clamp(target.x, r, this.bounds.width - r),
        y: clamp(target.y, r, this.bounds.height - r),
      };
    }
    this.enter('telegraph');
    this.events.push({ type: 'telegraphStart', patternId: p.id });
  }

  /** 점프 내려찍기면 예고 동안 착지 지점으로 날아가며 포물선으로 뛰어오른다 */
  private updateTelegraph(): void {
    const p = this.pattern!;
    const t = Math.min(1, this.stateTimeMs / p.telegraphMs);

    if (p.shape === 'circle' && p.anchor === 'target') {
      const e = easeInOut(t);
      this.x = this.origin.x + (this.landing.x - this.origin.x) * e;
      this.y = this.origin.y + (this.landing.y - this.origin.y) * e;
      this.z = (p.jumpHeight ?? 0) * 4 * t * (1 - t);
    }

    if (this.stateTimeMs >= p.telegraphMs) {
      this.z = 0;
      this.enter('active');
      this.events.push({ type: 'attackActive', patternId: p.id });
    }
  }

  private updateRecovery(): void {
    const p = this.pattern!;
    if (this.stateTimeMs < p.recoveryMs) return;
    if (p.restMs > 0) {
      this.enter('rest');
      this.events.push({ type: 'restStart' });
      return;
    }
    this.finishAttack();
  }

  private finishAttack(): void {
    const p = this.pattern!;
    this.events.push({ type: 'attackEnd', patternId: p.id });
    this.lastPatternId = p.id;
    this.pattern = null;
    this.startWatch();
  }

  private startWatch(): void {
    const w = this.cfg.watch;
    const modes: WatchMode[] = ['stare', 'strafeLeft', 'strafeRight'];
    this.watchMode = modes[Math.min(modes.length - 1, Math.floor(this.rng() * modes.length))];
    this.watchDurationMs = w.minMs + this.rng() * (w.maxMs - w.minMs);
    this.enter('watch');
    this.events.push({ type: 'watchStart', mode: this.watchMode, durationMs: this.watchDurationMs });
  }

  /** 관찰: 플레이어를 바라보며 노려보거나 옆으로 돈다. 너무 가까우면 물러난다. */
  private updateWatch(target: Vec2, dtMs: number): void {
    const w = this.cfg.watch;
    this.turnToward(target, dtMs);
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 0) {
      const ux = dx / dist;
      const uy = dy / dist;
      const sec = dtMs / 1000;
      if (dist < w.retreatDistance) {
        this.setPosition(this.x - ux * w.retreatSpeed * sec, this.y - uy * w.retreatSpeed * sec);
      } else if (this.watchMode !== 'stare') {
        // 플레이어를 중심으로 접선 방향 (왼쪽: 반시계, 오른쪽: 시계)
        const sign = this.watchMode === 'strafeLeft' ? -1 : 1;
        this.setPosition(this.x - uy * sign * w.strafeSpeed * sec, this.y + ux * sign * w.strafeSpeed * sec);
      }
    }

    if (this.stateTimeMs >= this.watchDurationMs) this.enter('approach');
  }

  // ───────────────────────── 자세 게이지 ─────────────────────────

  /** 자세 게이지를 올리고, 가득 차면 자세 붕괴를 시작한다. 붕괴가 시작되면 true */
  private addPosture(amount: number): boolean {
    this.posture = Math.min(this.cfg.posture.max, this.posture + amount);
    if (this.posture < this.cfg.posture.max) return false;
    this.cancelAttack();
    this.enter('staggered');
    return true;
  }

  /** 공격받지 않은 지 decayDelayMs가 지나면 서서히 줄어든다 (붕괴 중에는 그대로) */
  private decayPosture(dtMs: number): void {
    if (this.isStaggered || this.msSinceHurt < this.cfg.posture.decayDelayMs) return;
    this.posture = Math.max(0, this.posture - this.cfg.posture.decayPerSec * (dtMs / 1000));
  }

  /** 하던 공격을 끊는다 (점프 중이었다면 그 자리에 내려온다) */
  private cancelAttack(): void {
    if (this.pattern) this.lastPatternId = this.pattern.id;
    this.pattern = null;
    this.z = 0;
  }

  // ───────────────────────── 보조 ─────────────────────────

  private shapeOf(p: BossPatternConfig): AttackShape {
    switch (p.shape) {
      case 'sector':
        return { kind: 'sector', cx: this.origin.x, cy: this.origin.y, radius: p.radius, angle: this.aimAngle, arcRad: degToRad(p.arcDeg) };
      case 'rect':
        return { kind: 'rect', x: this.origin.x, y: this.origin.y, angle: this.aimAngle, length: p.length, width: p.width };
      case 'circle': {
        const c = p.anchor === 'target' ? this.landing : this.origin;
        return { kind: 'circle', cx: c.x, cy: c.y, radius: p.radius };
      }
    }
  }

  /** 초당 turnSpeed만큼만 돌아간다 (갑자기 뒤돌지 않음) */
  private turnToward(target: Vec2, dtMs: number): void {
    const desired = Math.atan2(target.y - this.y, target.x - this.x);
    const diff = wrapAngle(desired - this.facing);
    const step = this.cfg.turnSpeed * (dtMs / 1000);
    this.facing = wrapAngle(this.facing + clamp(diff, -step, step));
  }

  private enter(state: BossState): void {
    this._state = state;
    this.stateTimeMs = 0;
  }

  private setPosition(x: number, y: number): void {
    const r = this.cfg.radius;
    this.x = clamp(x, r, this.bounds.width - r);
    this.y = clamp(y, r, this.bounds.height - r);
  }
}

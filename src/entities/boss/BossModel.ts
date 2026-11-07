import { BOSS, isParryable, type AttackStep, type BossConfig, type BossPatternConfig, type BossPatternId, type WeaponId } from '../../config/bossBalance';
import { clamp } from '../../utils/math';
import { degToRad, type Vec2 } from '../../utils/geometry';
import { wrapAngle, type AttackShape } from '../../utils/shapes';
import type { Bounds } from '../player/PlayerModel';

export type BossState = 'watch' | 'approach' | 'swap' | 'telegraph' | 'active' | 'recovery' | 'rest' | 'flinch' | 'staggered' | 'dead';
/** 관찰 중 행동: 노려보기 / 왼쪽으로 돌기 / 오른쪽으로 돌기 */
export type WatchMode = 'stare' | 'strafeLeft' | 'strafeRight';
export type BossAttackPhase = 'telegraph' | 'active' | 'recovery';

/** 보스가 한 일. 이후 이벤트 버스를 통해 판정·학습·NPC·로그로 전달된다. */
export type BossEvent =
  | { type: 'telegraphStart'; patternId: BossPatternId; step: number }
  | { type: 'aimLocked'; patternId: BossPatternId; step: number }
  | { type: 'attackActive'; patternId: BossPatternId; step: number }
  | { type: 'comboCancelled'; patternId: BossPatternId; afterHits: number; next: BossPatternId | null }
  | { type: 'attackEnd'; patternId: BossPatternId }
  | { type: 'restStart' }
  | { type: 'weaponSwap'; from: WeaponId; to: WeaponId }
  /** 원거리 타 발사: 받는 쪽(ProjectileSystem)이 날아가는 물체를 만든다 */
  | {
      type: 'fire';
      patternId: BossPatternId;
      x: number;
      y: number;
      angle: number;
      kind: 'bullet' | 'wave';
      speed: number;
      radius: number;
      damage: number;
      parryable: boolean;
    }
  | { type: 'watchStart'; mode: WatchMode; durationMs: number };

export interface BossAttackInfo {
  pattern: BossPatternConfig;
  /** 지금 몇 번째 타인가 (0부터) */
  step: number;
  stepCount: number;
  /** 패링 가능 여부 (카테고리로 정해짐) */
  parryable: boolean;
  /** 조준이 고정되었는가 (고정 전에는 예고 범위가 플레이어를 따라온다) */
  locked: boolean;
  /** 근접 판정이 있는가 (원거리 타는 false: 판정은 날아가는 물체가 함) */
  melee: boolean;
  /** 원거리 타면 무엇을 쏘는가 */
  fire: 'bullet' | 'wave' | null;
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
 *   approach ─(고른 패턴의 무기가 다름)→ swap(무기 교체) ─→ approach
 *   approach ─(사거리 안 + minIdleMs 지남)→ telegraph ─→ active ─→ recovery ─┬────────────→ watch ─→ approach
 *                                                                          └(restMs > 0)→ rest ─┘
 *   watch(관찰): 공격 후 바로 다가가지 않고 노려보거나 옆으로 돌며 거리를 잰다. 너무 가까우면 물러난다.
 *   (공격 중) ─(패링당함)→ flinch(움찔) ─→ watch
 *   (어느 상태든) ─(자세 게이지 가득)→ staggered(자세 붕괴: 받는 피해 증가) ─→ watch
 *   체력 0 → dead
 *
 * 한 패턴은 여러 타(step)로 이루어질 수 있다 (연속기):
 *   telegraph(타 0) → active → recovery ─(남은 타 있음)→ telegraph(타 1) → … → 마지막 recovery → (rest) → watch
 *
 * 공정성 원칙:
 *   - 예고 앞부분(trackRatio)에는 조준이 플레이어를 따라오지만 회전 속도에 제한이 있고, 이후 고정된다.
 *   - 고정 뒤에는 예고 범위 = 판정 범위. 돌진(lunge)하는 공격은 돌진한 뒤의 위치에 예고가 그려진다.
 *   - 연속기는 마지막 타를 패링당했을 때만 움찔한다 (중간 타 패링은 자세 게이지만 쌓임).
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
  private _weapon: WeaponId;
  private swapTo: WeaponId | null = null;

  private _state: BossState = 'approach';
  private stateTimeMs = 0;
  private watchMode: WatchMode = 'stare';
  private watchDurationMs = 0;
  private pattern: BossPatternConfig | null = null;
  private lastPatternId: BossPatternId | null = null;
  private stepIndex = 0;

  private aimAngle = 0;
  private locked = false;
  /** 예고를 시작한 위치 (점프 내려찍기의 출발점) */
  private origin: Vec2 = { x: 0, y: 0 };
  /** 판정이 나는 위치 = 돌진한 뒤의 보스 중심 */
  private strikeOrigin: Vec2 = { x: 0, y: 0 };
  /** 판정이 켜질 때의 위치 (돌진 출발점) */
  private lungeFrom: Vec2 = { x: 0, y: 0 };
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
    this._weapon = cfg.startWeapon;
  }

  /** 지금 들고 있는 무기 (교체 중이면 아직 이전 무기) */
  get weapon(): WeaponId {
    return this._weapon;
  }

  /** 무기 교체 중이면 정보, 아니면 null */
  get weaponSwap(): { from: WeaponId; to: WeaponId; progress: number } | null {
    if (this._state !== 'swap' || !this.swapTo) return null;
    return { from: this._weapon, to: this.swapTo, progress: Math.min(1, this.stateTimeMs / this.cfg.weaponSwapMs) };
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
   * 자세 붕괴 중이면 피해가 배로 들어가고, 아니면 자세 게이지가 쌓인다 (postureMultiplier: 3타 등 강한 공격의 배율).
   */
  applyHit(damage: number, postureMultiplier = 1): { died: boolean; staggerStarted: boolean; dealt: number } {
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
    return { died: false, staggerStarted: this.addPosture(damage * this.cfg.posture.perDamage * postureMultiplier), dealt };
  }

  /** 공격이 패링당함 (CombatSystem이 호출). 자세 게이지가 크게 쌓이고 공격이 끊긴다 */
  onParried(): { staggerStarted: boolean } {
    if (this._state === 'dead' || this.isStaggered) return { staggerStarted: false };
    this.msSinceHurt = 0;
    if (this.addPosture(this.cfg.posture.perParry)) return { staggerStarted: true };
    // 연속기 중간 타: 막혀도 계속 몰아친다
    if (this.pattern && this.stepIndex < this.pattern.steps.length - 1) return { staggerStarted: false };
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

  /**
   * 연속기를 지금 끊는다 (학습 단계에서 "끊고 다른 기술로"에 쓸 자리).
   * 타와 타 사이의 틈(경직)이고, cancelAfterHits 이상 친 뒤이고, 아직 남은 타가 있을 때만 가능.
   * next를 주면 그 공격을 바로 이어서 준비한다.
   */
  cancelCombo(next?: BossPatternId): boolean {
    const p = this.pattern;
    if (!p || this._state !== 'recovery' || p.cancelAfterHits === undefined) return false;
    const hitsDone = this.stepIndex + 1;
    if (hitsDone < p.cancelAfterHits || hitsDone >= p.steps.length) return false;

    this.events.push({ type: 'comboCancelled', patternId: p.id, afterHits: hitsDone, next: next ?? null });
    this.lastPatternId = p.id;
    const nextPattern = next ? this.cfg.patterns.find((q) => q.id === next) ?? null : null;
    if (nextPattern) {
      this.pattern = nextPattern;
      this.enter('approach');
      this.stateTimeMs = this.cfg.minIdleMs; // 사거리 안이면 다음 프레임에 바로 예고
    } else {
      this.pattern = null;
      this.startWatch();
    }
    return true;
  }

  /** 공격 중(예고·판정·경직)이면 정보, 아니면 null */
  get attack(): BossAttackInfo | null {
    if (this._state !== 'telegraph' && this._state !== 'active' && this._state !== 'recovery') return null;
    const p = this.pattern;
    if (!p) return null;
    const s = this.step;
    const duration = this._state === 'telegraph' ? s.telegraphMs : this._state === 'active' ? s.activeMs : s.recoveryMs;
    return {
      pattern: p,
      step: this.stepIndex,
      stepCount: p.steps.length,
      parryable: isParryable(p, s),
      locked: this.locked,
      melee: !s.fire,
      fire: s.fire?.kind ?? null,
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
      case 'swap':
        this.turnToward(target, dtMs);
        if (this.stateTimeMs >= this.cfg.weaponSwapMs) {
          this._weapon = this.swapTo!;
          this.swapTo = null;
          this.enter('approach');
        }
        break;
      case 'telegraph':
        this.updateTelegraph(target, dtMs);
        break;
      case 'active':
        this.updateActive();
        break;
      case 'recovery':
        this.updateRecovery(target);
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

    // 다른 무기가 필요하면 먼저 바꿔 든다
    if (this.pattern.weapon !== this._weapon) {
      this.swapTo = this.pattern.weapon;
      this.enter('swap');
      this.events.push({ type: 'weaponSwap', from: this._weapon, to: this.swapTo });
      return;
    }

    if (dist > this.pattern.maxDistance) {
      const step = this.cfg.weaponMoveSpeed[this._weapon] * (dtMs / 1000);
      this.setPosition(this.x + ((target.x - this.x) / dist) * step, this.y + ((target.y - this.y) / dist) * step);
      return;
    }
    if (this.stateTimeMs >= this.cfg.minIdleMs) this.startTelegraph(target);
  }

  private get step(): AttackStep {
    return this.pattern!.steps[this.stepIndex];
  }

  /** 패턴의 첫 타를 시작한다 */
  private startTelegraph(target: Vec2): void {
    this.aimAngle = Math.atan2(target.y - this.y, target.x - this.x);
    this.startStep(0, target);
  }

  /** i번째 타의 예고를 시작한다. 다음 타는 직전 조준에서 이어서 따라온다 */
  private startStep(i: number, target: Vec2): void {
    const p = this.pattern!;
    this.stepIndex = i;
    this.facing = this.aimAngle;
    this.origin = { x: this.x, y: this.y };
    this._attackSerial += 1;
    this.locked = false;
    if (p.shape === 'circle' && p.anchor === 'target') this.landing = this.clampToArena(target);
    this.updateStrikeOrigin();
    this.enter('telegraph');
    this.events.push({ type: 'telegraphStart', patternId: p.id, step: i });
    if (this.step.trackRatio <= 0) this.lockAim();
  }

  /**
   * 예고: 앞부분은 조준이 따라오고(회전 속도 제한), 이후 고정.
   * 점프 내려찍기면 착지 지점으로 날아가며 포물선으로 뛰어오른다.
   */
  private updateTelegraph(target: Vec2, dtMs: number): void {
    const p = this.pattern!;
    const s = this.step;
    const t = Math.min(1, this.stateTimeMs / s.telegraphMs);

    if (!this.locked) {
      if (t < s.trackRatio) {
        const desired = Math.atan2(target.y - this.y, target.x - this.x);
        const step = this.cfg.aimTrackSpeed * (dtMs / 1000);
        this.aimAngle = wrapAngle(this.aimAngle + clamp(wrapAngle(desired - this.aimAngle), -step, step));
        this.facing = this.aimAngle;
        if (p.shape === 'circle' && p.anchor === 'target') this.landing = this.clampToArena(target);
        this.updateStrikeOrigin();
      } else {
        this.lockAim();
      }
    }

    if (p.shape === 'circle' && p.anchor === 'target') {
      const h = p.jumpHeight ?? 0;
      if (p.hang) {
        // 지연 내려찍기: 올라가며 착지 지점 위로 이동 → 공중에서 멈칫(착지 지점을 따라다님) → 떨어짐
        const { from, to } = p.hang;
        if (t < from) {
          const e = easeInOut(t / from);
          this.x = this.origin.x + (this.landing.x - this.origin.x) * e;
          this.y = this.origin.y + (this.landing.y - this.origin.y) * e;
          this.z = h * Math.sin((t / from) * (Math.PI / 2));
        } else {
          this.x = this.landing.x;
          this.y = this.landing.y;
          const k = t < to ? 0 : (t - to) / (1 - to);
          this.z = h * (1 - k * k);
        }
      } else {
        const e = easeInOut(t);
        this.x = this.origin.x + (this.landing.x - this.origin.x) * e;
        this.y = this.origin.y + (this.landing.y - this.origin.y) * e;
        this.z = h * 4 * t * (1 - t);
      }
    }

    if (this.stateTimeMs >= s.telegraphMs) {
      if (!this.locked) this.lockAim();
      this.z = 0;
      this.lungeFrom = { x: this.x, y: this.y };
      this.enter('active');
      this.events.push({ type: 'attackActive', patternId: p.id, step: this.stepIndex });
      if (s.fire) {
        // 몸 앞에서 발사
        this.events.push({
          type: 'fire',
          patternId: p.id,
          x: this.x + Math.cos(this.aimAngle) * this.cfg.radius,
          y: this.y + Math.sin(this.aimAngle) * this.cfg.radius,
          angle: this.aimAngle,
          kind: s.fire.kind,
          speed: s.fire.speed,
          radius: s.fire.radius,
          damage: p.damage,
          parryable: isParryable(p, s),
        });
      }
    }
  }

  private lockAim(): void {
    this.locked = true;
    this.updateStrikeOrigin();
    this.events.push({ type: 'aimLocked', patternId: this.pattern!.id, step: this.stepIndex });
  }

  /** 판정: 앞부분(절반) 동안 돌진 지점까지 미끄러진다. 판정 범위는 처음부터 돌진 지점 기준 */
  private updateActive(): void {
    const s = this.step;
    if (s.lungeDistance > 0) {
      const k = Math.min(1, this.stateTimeMs / (s.activeMs * 0.5));
      this.x = this.lungeFrom.x + (this.strikeOrigin.x - this.lungeFrom.x) * k;
      this.y = this.lungeFrom.y + (this.strikeOrigin.y - this.lungeFrom.y) * k;
    }
    if (this.stateTimeMs >= s.activeMs) this.enter('recovery');
  }

  private updateRecovery(target: Vec2): void {
    const p = this.pattern!;
    if (this.stateTimeMs < this.step.recoveryMs) return;
    if (this.stepIndex < p.steps.length - 1) {
      this.startStep(this.stepIndex + 1, target);
      return;
    }
    if (p.restMs > 0) {
      this.enter('rest');
      this.events.push({ type: 'restStart' });
      return;
    }
    this.finishAttack();
  }

  /** 돌진한 뒤의 보스 중심 (경기장 밖으로 나가지 않게) */
  private updateStrikeOrigin(): void {
    const lunge = this.pattern ? this.step.lungeDistance : 0;
    this.strikeOrigin = this.clampToArena({
      x: this.x + Math.cos(this.aimAngle) * lunge,
      y: this.y + Math.sin(this.aimAngle) * lunge,
    });
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
    const k = this.speedScale;
    this.turnToward(target, dtMs);
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 0) {
      const ux = dx / dist;
      const uy = dy / dist;
      const sec = dtMs / 1000;
      if (dist < w.retreatDistance) {
        this.setPosition(this.x - ux * w.retreatSpeed * k * sec, this.y - uy * w.retreatSpeed * k * sec);
      } else if (this.watchMode !== 'stare') {
        // 플레이어를 중심으로 접선 방향 (왼쪽: 반시계, 오른쪽: 시계)
        const sign = this.watchMode === 'strafeLeft' ? -1 : 1;
        this.setPosition(this.x - uy * sign * w.strafeSpeed * k * sec, this.y + ux * sign * w.strafeSpeed * k * sec);
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
    this.swapTo = null; // 교체 중이었다면 이전 무기를 그대로 든다
    this.z = 0;
  }

  // ───────────────────────── 보조 ─────────────────────────

  /** 무기에 따른 이동 속도 배율 (기준 moveSpeed 대비) */
  private get speedScale(): number {
    return this.cfg.weaponMoveSpeed[this._weapon] / this.cfg.moveSpeed;
  }

  private shapeOf(p: BossPatternConfig): AttackShape {
    const fire = this.step.fire;
    if (fire) {
      // 원거리 타의 예고 = 조준선 (발사 방향으로 경기장 끝까지)
      const reach = Math.hypot(this.bounds.width, this.bounds.height);
      return { kind: 'rect', x: this.x, y: this.y, angle: this.aimAngle, length: reach, width: Math.max(6, fire.radius * 2) };
    }
    const override = this.step.shape;
    if (override?.kind === 'dashRect') {
      // 예고를 시작한 자리에서 뻗는 직사각형 (돌진하며 지나가는 길 전체)
      return { kind: 'rect', x: this.origin.x, y: this.origin.y, angle: this.aimAngle, length: override.length, width: override.width };
    }
    switch (p.shape) {
      case 'sector':
        return { kind: 'sector', cx: this.strikeOrigin.x, cy: this.strikeOrigin.y, radius: p.radius, angle: this.aimAngle, arcRad: degToRad(p.arcDeg) };
      case 'rect':
        return { kind: 'rect', x: this.strikeOrigin.x, y: this.strikeOrigin.y, angle: this.aimAngle, length: p.length, width: p.width };
      case 'circle': {
        const c = p.anchor === 'target' ? this.landing : this.strikeOrigin;
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
    const c = this.clampToArena({ x, y });
    this.x = c.x;
    this.y = c.y;
  }

  private clampToArena(v: Vec2): Vec2 {
    const r = this.cfg.radius;
    return { x: clamp(v.x, r, this.bounds.width - r), y: clamp(v.y, r, this.bounds.height - r) };
  }
}

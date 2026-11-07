import { PLAYER, type AttackHitConfig, type PlayerConfig } from '../../config/balance';
import type { PlayerInput } from '../../input/types';
import { clamp } from '../../utils/math';
import { degToRad, normalize, type Vec2 } from '../../utils/geometry';

export type PlayerState = 'idle' | 'move' | 'dash' | 'attack' | 'parry' | 'potion' | 'hit' | 'dead';
export type AttackPhase = 'startup' | 'active' | 'recovery';

/**
 * 플레이어가 한 일을 알리는 이벤트.
 * 지금은 HUD·디버그용이지만, 이후 이벤트 버스를 통해 보스 두뇌(학습)·NPC·로그로 전달된다.
 */
export type PlayerEvent =
  | { type: 'dash'; dirX: number; dirY: number; cancelledAttack: boolean }
  | { type: 'attackStart'; comboIndex: number; angle: number }
  | { type: 'parryStart' }
  | { type: 'potionStart' }
  | { type: 'potionHealed'; amount: number }
  | { type: 'staminaDenied'; action: 'dash' | 'attack' | 'parry' };

export interface AttackInfo {
  /** 휘두를 때마다 1씩 늘어나는 번호. 한 번 휘두르면 한 번만 맞도록 판정에서 쓴다 */
  serial: number;
  comboIndex: number;
  phase: AttackPhase;
  /** 현재 단계 안에서의 진행률 0~1 (모션 그리기용) */
  phaseProgress: number;
  angle: number;
  range: number;
  arcRad: number;
  damage: number;
  /** 지금 대시로 캔슬할 수 있는가 (경직 후반부) */
  canDashCancel: boolean;
}

export interface ParryInfo {
  phase: 'active' | 'recovery';
  phaseProgress: number;
}

export interface Bounds {
  width: number;
  height: number;
}

/**
 * 플레이어의 순수 로직 (Phaser에 의존하지 않음).
 *
 * 매 프레임 update(input, dtMs)를 호출하면:
 *   입력 → 현재 상태에 따라 허용되는 행동만 처리 → 위치·자원·상태 갱신 → 이벤트 반환
 *
 * 상태 전이 요약:
 *   idle/move ─(대시)→ dash ─(시간 끝)→ idle
 *             ─(공격)→ attack ─(경직 comboLinkFrom 지점 + 예약/누르고 있음)→ attack(다음 타)
 *                             ─(경직 후반부 + 대시)→ dash (후딜 캔슬)
 *                             ─(시간 끝)→ idle
 *             ─(패링)→ parry ─(시간 끝)→ idle
 *             ─(포션)→ potion ─(시간 끝, 회복)→ idle
 *   (어느 상태든) ─(피격)→ hit ─(경직 끝)→ idle   /   체력 0 → dead
 *   준비·판정 중에는 대시·패링으로 취소되지 않는다 (동작 고정).
 *   단, 1·2타는 공격 중에도 느리게 움직일 수 있다 (moveSpeedRatio). 3타는 제자리.
 */
export class PlayerModel {
  x: number;
  y: number;
  /** 바라보는 방향 (라디안) */
  facing = 0;
  hp: number;
  stamina: number;
  potions: number;

  private _state: PlayerState = 'idle';
  private stateTimeMs = 0;
  private msSinceStaminaSpent = Number.POSITIVE_INFINITY;

  private dashStart: Vec2 = { x: 0, y: 0 };
  private dashDir: Vec2 = { x: 1, y: 0 };

  private comboIndex = 0;
  private attackSerial = 0;
  private attackAngle = 0;
  private hitStart: Vec2 = { x: 0, y: 0 };
  private hitDir: Vec2 = { x: 0, y: 0 };
  /** 공격 중 클릭으로 다음 타를 예약했는가 */
  private attackBuffered = false;

  private events: PlayerEvent[] = [];

  constructor(
    x: number,
    y: number,
    private readonly bounds: Bounds,
    private readonly cfg: PlayerConfig = PLAYER,
  ) {
    this.x = x;
    this.y = y;
    this.hp = cfg.maxHp;
    this.stamina = cfg.maxStamina;
    this.potions = cfg.potion.count;
  }

  get state(): PlayerState {
    return this._state;
  }

  get radius(): number {
    return this.cfg.radius;
  }

  get isDead(): boolean {
    return this._state === 'dead';
  }

  /** 대시 시작 후 invulnMs 동안 무적 */
  get isInvulnerable(): boolean {
    return this._state === 'dash' && this.stateTimeMs < this.cfg.dash.invulnMs;
  }

  /** 패링 판정이 켜져 있는가 */
  get isParryActive(): boolean {
    return this._state === 'parry' && this.stateTimeMs < this.cfg.parry.activeMs;
  }

  get dashDirection(): Vec2 {
    return { ...this.dashDir };
  }

  /** 공격 중이면 현재 타의 정보, 아니면 null */
  get attack(): AttackInfo | null {
    if (this._state !== 'attack') return null;
    const hit = this.currentHit();
    const phase = this.attackPhase(hit);
    return {
      serial: this.attackSerial,
      comboIndex: this.comboIndex,
      phase,
      phaseProgress: this.attackPhaseProgress(hit, phase),
      angle: this.attackAngle,
      range: hit.range,
      arcRad: degToRad(hit.arcDeg),
      damage: hit.damage,
      canDashCancel: this.canDashCancel(hit, phase),
    };
  }

  /** 패링 중이면 단계와 진행률, 아니면 null */
  get parry(): ParryInfo | null {
    if (this._state !== 'parry') return null;
    const { activeMs, recoveryMs } = this.cfg.parry;
    if (this.stateTimeMs < activeMs) return { phase: 'active', phaseProgress: this.stateTimeMs / activeMs };
    return { phase: 'recovery', phaseProgress: Math.min(1, (this.stateTimeMs - activeMs) / recoveryMs) };
  }

  /** 포션을 마시는 중이면 진행률 0~1, 아니면 null */
  get potionProgress(): number | null {
    if (this._state !== 'potion') return null;
    return Math.min(1, this.stateTimeMs / this.cfg.potion.drinkMs);
  }

  update(input: PlayerInput, dtMs: number): PlayerEvent[] {
    this.events = [];
    if (this._state === 'dead') return this.events;

    this.stateTimeMs += dtMs;
    this.msSinceStaminaSpent += dtMs;

    switch (this._state) {
      case 'idle':
      case 'move':
        this.updateFree(input, dtMs);
        break;
      case 'dash':
        this.updateDash();
        break;
      case 'attack':
        this.updateAttack(input, dtMs);
        break;
      case 'hit':
        this.updateHit();
        break;
      case 'parry':
        this.updateParry();
        break;
      case 'potion':
        this.updatePotion();
        break;
    }

    this.regenStamina(dtMs);
    return this.events;
  }

  // ───────────────────────── 상태별 처리 ─────────────────────────

  /** 자유 상태(idle/move): 행동 우선순위 = 대시 > 공격 > 패링 > 포션 > 이동 */
  private updateFree(input: PlayerInput, dtMs: number): void {
    this.facing = input.aimAngle;

    if (input.dash) {
      if (this.trySpend(this.cfg.dash.staminaCost)) {
        this.startDash(input, false);
        return;
      }
      this.events.push({ type: 'staminaDenied', action: 'dash' });
    }

    // 클릭(눌린 순간) 또는 누르고 있음 → 공격 시작
    if (input.attack || input.attackHeld) {
      if (this.trySpend(this.cfg.attackHits[0].staminaCost)) {
        this.startAttack(0);
        return;
      }
      // 누르고 있는 동안 매 프레임 알리지 않도록, 클릭한 순간에만 알린다
      if (input.attack) this.events.push({ type: 'staminaDenied', action: 'attack' });
    }

    if (input.parry) {
      if (this.trySpend(this.cfg.parry.staminaCost)) {
        this.enter('parry');
        this.events.push({ type: 'parryStart' });
        return;
      }
      this.events.push({ type: 'staminaDenied', action: 'parry' });
    }

    if (input.potion && this.potions > 0) {
      this.potions -= 1;
      this.enter('potion');
      this.events.push({ type: 'potionStart' });
      return;
    }

    const dir = normalize(input.moveX, input.moveY);
    const step = this.cfg.moveSpeed * (dtMs / 1000);
    this.setPosition(this.x + dir.x * step, this.y + dir.y * step);
    this._state = dir.x !== 0 || dir.y !== 0 ? 'move' : 'idle';
  }

  /** 대시 방향: 이동키 방향, 이동키가 없으면 조준 방향 */
  private startDash(input: PlayerInput, cancelledAttack: boolean): void {
    const moveDir = normalize(input.moveX, input.moveY);
    this.dashDir =
      moveDir.x !== 0 || moveDir.y !== 0
        ? moveDir
        : { x: Math.cos(input.aimAngle), y: Math.sin(input.aimAngle) };
    this.dashStart = { x: this.x, y: this.y };
    this.enter('dash');
    this.events.push({ type: 'dash', dirX: this.dashDir.x, dirY: this.dashDir.y, cancelledAttack });
  }

  /** 경과 시간 비율로 위치를 계산 → 프레임 속도와 무관하게 정확히 distance만큼 이동 */
  private updateDash(): void {
    const { distance, durationMs } = this.cfg.dash;
    const progress = Math.min(this.stateTimeMs, durationMs) / durationMs;
    this.setPosition(
      this.dashStart.x + this.dashDir.x * distance * progress,
      this.dashStart.y + this.dashDir.y * distance * progress,
    );
    if (this.stateTimeMs >= durationMs) this.enter('idle');
  }

  private startAttack(comboIndex: number): void {
    this.attackSerial += 1;
    this.comboIndex = comboIndex;
    this.attackAngle = this.facing; // 공격 방향은 시작 순간에 고정
    this.attackBuffered = false;
    this.enter('attack');
    this.events.push({ type: 'attackStart', comboIndex, angle: this.attackAngle });
  }

  /**
   * 공격 처리.
   * - 준비·판정 중: 어떤 입력도 받지 않는다 (클릭은 다음 타 "예약"만 해 둔다).
   * - 경직 후반부(attackDashCancelFrom 이후): 대시로 캔슬할 수 있다. 다음 타 예약보다 우선한다.
   * - 경직이 comboLinkFrom만큼 지난 시점: 예약했거나 버튼을 누르고 있으면 다음 타로 잇는다.
   *   (경직을 건너뛰지 않으므로 휘두른 뒤 멈추는 순간이 생긴다.
   *    누르고 있다가 그 전에 손을 떼면 그 타에서 멈춘다)
   */
  private updateAttack(input: PlayerInput, dtMs: number): void {
    if (input.attack) this.attackBuffered = true;

    const hit = this.currentHit();
    // 1·2타는 느리게 이동 가능 (방향은 그대로), 3타는 제자리
    if (hit.moveSpeedRatio > 0) {
      const dir = normalize(input.moveX, input.moveY);
      const step = this.cfg.moveSpeed * hit.moveSpeedRatio * (dtMs / 1000);
      this.setPosition(this.x + dir.x * step, this.y + dir.y * step);
    }
    const phase = this.attackPhase(hit);
    const totalMs = hit.startupMs + hit.activeMs + hit.recoveryMs;
    const hasNextHit = this.comboIndex < this.cfg.attackHits.length - 1;

    if (phase === 'recovery') {
      if (input.dash && this.canDashCancel(hit, phase)) {
        if (this.trySpend(this.cfg.dash.staminaCost)) {
          this.facing = input.aimAngle;
          this.startDash(input, true);
          return;
        }
        this.events.push({ type: 'staminaDenied', action: 'dash' });
      }

      const linkReady = this.attackPhaseProgress(hit, phase) >= hit.comboLinkFrom;
      const wantsNext = this.attackBuffered || input.attackHeld;
      if (linkReady && wantsNext && hasNextHit) {
        const next = this.cfg.attackHits[this.comboIndex + 1];
        if (this.trySpend(next.staminaCost)) {
          this.startAttack(this.comboIndex + 1);
          return;
        }
        if (this.attackBuffered) this.events.push({ type: 'staminaDenied', action: 'attack' });
        this.attackBuffered = false; // 스태미나 부족이면 예약 취소
      }
    }

    if (this.stateTimeMs >= totalMs) this.enter('idle');
  }

  private updateParry(): void {
    const { activeMs, recoveryMs } = this.cfg.parry;
    if (this.stateTimeMs >= activeMs + recoveryMs) this.enter('idle');
  }

  private updatePotion(): void {
    const { drinkMs, heal } = this.cfg.potion;
    if (this.stateTimeMs >= drinkMs) {
      const before = this.hp;
      this.hp = Math.min(this.cfg.maxHp, this.hp + heal);
      this.events.push({ type: 'potionHealed', amount: this.hp - before });
      this.enter('idle');
    }
  }

  // ───────────────────────── 피격 ─────────────────────────

  /**
   * 공격에 맞음 (CombatSystem이 호출). 하던 행동은 끊긴다 (마시던 포션은 소모된 채로 사라짐).
   * 맞은 반대 방향으로 밀려나고, 경직 동안 아무것도 못 한다.
   */
  applyHit(damage: number, fromX: number, fromY: number): { died: boolean } {
    if (this._state === 'dead') return { died: false };
    this.hp = Math.max(0, this.hp - damage);
    if (this.hp === 0) {
      this.enter('dead');
      return { died: true };
    }
    const away = normalize(this.x - fromX, this.y - fromY);
    this.hitDir = away.x !== 0 || away.y !== 0 ? away : { x: -Math.cos(this.facing), y: -Math.sin(this.facing) };
    this.hitStart = { x: this.x, y: this.y };
    this.enter('hit');
    return { died: false };
  }

  /** 보스 몸과 겹치지 않도록 밀어낼 때 사용 */
  nudge(dx: number, dy: number): void {
    this.setPosition(this.x + dx, this.y + dy);
  }

  private updateHit(): void {
    const { stunMs, knockback } = this.cfg.hit;
    const t = Math.min(1, this.stateTimeMs / stunMs);
    const eased = 1 - Math.pow(1 - t, 3);
    this.setPosition(this.hitStart.x + this.hitDir.x * knockback * eased, this.hitStart.y + this.hitDir.y * knockback * eased);
    if (this.stateTimeMs >= stunMs) this.enter('idle');
  }

  // ───────────────────────── 보조 ─────────────────────────

  private currentHit(): AttackHitConfig {
    return this.cfg.attackHits[this.comboIndex];
  }

  private attackPhase(hit: AttackHitConfig): AttackPhase {
    if (this.stateTimeMs < hit.startupMs) return 'startup';
    if (this.stateTimeMs < hit.startupMs + hit.activeMs) return 'active';
    return 'recovery';
  }

  private attackPhaseProgress(hit: AttackHitConfig, phase: AttackPhase): number {
    const t = this.stateTimeMs;
    if (phase === 'startup') return t / hit.startupMs;
    if (phase === 'active') return (t - hit.startupMs) / hit.activeMs;
    return Math.min(1, (t - hit.startupMs - hit.activeMs) / hit.recoveryMs);
  }

  private canDashCancel(hit: AttackHitConfig, phase: AttackPhase): boolean {
    return phase === 'recovery' && this.attackPhaseProgress(hit, phase) >= this.cfg.attackDashCancelFrom;
  }

  private enter(state: PlayerState): void {
    this._state = state;
    this.stateTimeMs = 0;
  }

  /** 스태미나가 충분하면 소모하고 true, 부족하면 아무것도 하지 않고 false */
  private trySpend(cost: number): boolean {
    if (this.stamina < cost) return false;
    this.stamina -= cost;
    this.msSinceStaminaSpent = 0;
    return true;
  }

  /** 대시·공격 중에는 회복하지 않고, 마지막 소모 후 지연 시간이 지나야 회복 */
  private regenStamina(dtMs: number): void {
    if (this._state === 'dash' || this._state === 'attack') return;
    if (this.msSinceStaminaSpent < this.cfg.staminaRegenDelayMs) return;
    this.stamina = Math.min(this.cfg.maxStamina, this.stamina + this.cfg.staminaRegenPerSec * (dtMs / 1000));
  }

  private setPosition(x: number, y: number): void {
    const r = this.cfg.radius;
    this.x = clamp(x, r, this.bounds.width - r);
    this.y = clamp(y, r, this.bounds.height - r);
  }
}

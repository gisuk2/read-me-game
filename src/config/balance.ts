/**
 * 게임 수치 모음. 모든 값은 임시값이며 플레이테스트로 조정한다.
 * 시간 단위: ms / 거리 단위: px / 각도 단위: 도(deg, 코드에서 라디안으로 변환)
 */

export interface AttackHitConfig {
  /** 공격 판정이 나오기 전 준비 시간 (이 동안도 취소 불가) */
  startupMs: number;
  /** 공격 판정이 켜져 있는 시간 */
  activeMs: number;
  /** 공격 후 경직 */
  recoveryMs: number;
  /**
   * 다음 타로 이어지는 시점 (경직 시간 대비 비율, 0~1).
   * 0.5 → 경직의 절반을 거친 뒤 다음 타가 나간다. 마지막 타에서는 쓰이지 않는다.
   * 공격 입력은 공격 중 언제든 예약되며, 실제로 나가는 시점만 이 값으로 정해진다.
   */
  comboLinkFrom: number;
  damage: number;
  /** 부채꼴 판정의 반지름 */
  range: number;
  /** 부채꼴 판정의 각도 (도) */
  arcDeg: number;
  staminaCost: number;
}

export interface PlayerConfig {
  radius: number;
  moveSpeed: number;
  maxHp: number;
  maxStamina: number;
  staminaRegenPerSec: number;
  /** 스태미나를 쓴 뒤 회복이 시작되기까지의 지연 */
  staminaRegenDelayMs: number;
  dash: {
    distance: number;
    durationMs: number;
    /** 대시 시작부터 무적인 시간 (durationMs 이하) */
    invulnMs: number;
    staminaCost: number;
  };
  /** 콤보 순서대로 1타, 2타, 3타 */
  attackHits: AttackHitConfig[];
  /**
   * 공격 경직(recovery) 중 대시로 캔슬할 수 있게 되는 시점 (경직 시간 대비 비율, 0~1).
   * 0.4 → 경직의 앞 40%는 캔슬 불가, 뒤 60%는 대시로 캔슬 가능.
   * 준비(startup)·판정(active) 중에는 항상 캔슬 불가 (동작 고정).
   */
  attackDashCancelFrom: number;
  parry: {
    /** 패링 판정이 켜져 있는 시간 */
    activeMs: number;
    /** 패링 후 경직 */
    recoveryMs: number;
    staminaCost: number;
  };
  potion: {
    count: number;
    /** 마시는 시간. 이 동안 움직일 수 없다 */
    drinkMs: number;
    heal: number;
  };
}

export const PLAYER: PlayerConfig = {
  radius: 12,
  moveSpeed: 220,
  maxHp: 100,
  maxStamina: 100,
  staminaRegenPerSec: 40,
  staminaRegenDelayMs: 500,
  dash: {
    distance: 140,
    durationMs: 180,
    invulnMs: 160,
    staminaCost: 25,
  },
  attackHits: [
    { startupMs: 220, activeMs: 100, recoveryMs: 300, comboLinkFrom: 0.5, damage: 10, range: 56, arcDeg: 100, staminaCost: 12 },
    { startupMs: 200, activeMs: 100, recoveryMs: 320, comboLinkFrom: 0.7, damage: 10, range: 56, arcDeg: 100, staminaCost: 12 },
    { startupMs: 380, activeMs: 120, recoveryMs: 480, comboLinkFrom: 1, damage: 18, range: 66, arcDeg: 140, staminaCost: 18 },
  ],
  attackDashCancelFrom: 0.4,
  parry: {
    activeMs: 150,
    recoveryMs: 250,
    staminaCost: 8,
  },
  potion: {
    count: 3,
    drinkMs: 900,
    heal: 40,
  },
};

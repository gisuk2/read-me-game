/**
 * 보스 수치 모음. 모든 값은 임시값이며 플레이테스트로 조정한다.
 * 시간 단위: ms / 거리 단위: px / 각도 단위: 도(deg)
 */

export type BossPatternId = 'sweep' | 'thrust' | 'spin' | 'slam';

interface PatternBase {
  id: BossPatternId;
  /** 화면·로그에 쓰는 이름 */
  name: string;
  /** 빨간 점선 예고 시간 */
  telegraphMs: number;
  /** 판정이 켜져 있는 시간 */
  activeMs: number;
  /** 공격 후 경직 (빈틈) */
  recoveryMs: number;
  /** 경직 뒤 추가로 쉬는 시간 (큰 빈틈). 없으면 0 */
  restMs: number;
  damage: number;
  /** 패링으로 막을 수 있는가. false면 예고가 이중 점선으로 표시된다 */
  parryable: boolean;
  /** 이 거리 이상일 때만 후보가 된다 */
  minDistance: number;
  /** 이 거리 안으로 들어오면 예고를 시작한다 (밖이면 다가간다) */
  maxDistance: number;
  /** 후보 중 뽑힐 상대적 확률 */
  weight: number;
}

/** 보스 앞쪽 부채꼴 */
export interface SectorPattern extends PatternBase {
  shape: 'sector';
  radius: number;
  arcDeg: number;
}

/** 보스 중심에서 앞으로 뻗는 직사각형 */
export interface RectPattern extends PatternBase {
  shape: 'rect';
  length: number;
  width: number;
}

/** 원형. 'self' = 보스 주변, 'target' = 예고 시작 순간의 플레이어 위치(보스가 뛰어올라 그곳에 착지) */
export interface CirclePattern extends PatternBase {
  shape: 'circle';
  radius: number;
  anchor: 'self' | 'target';
  /** anchor가 'target'일 때 뛰어오르는 최대 높이 (2.5D 표현용) */
  jumpHeight?: number;
}

export type BossPatternConfig = SectorPattern | RectPattern | CirclePattern;

export interface BossConfig {
  /** 육각형의 외접원 반지름 */
  radius: number;
  /** 화면·로그에 쓰는 이름 (가칭) */
  name: string;
  maxHp: number;
  /**
   * 자세 게이지. 가득 차면 자세 붕괴 → staggerMs 동안 무너지고 받는 피해가 staggerDamageMultiplier배.
   * 공격받지 않으면 decayDelayMs 뒤부터 서서히 회복(감소)한다.
   */
  posture: {
    max: number;
    /** 플레이어 공격 피해 1당 쌓이는 양 */
    perDamage: number;
    /** 패링 성공 시 쌓이는 양 */
    perParry: number;
    decayPerSec: number;
    decayDelayMs: number;
  };
  staggerMs: number;
  staggerDamageMultiplier: number;
  /** 패링당했을 때 움찔하는 시간 (공격이 끊김) */
  flinchMs: number;
  /** 공격이 판정되는 높이 한계. 이보다 높이 떠 있으면(점프 중) 맞지 않는다 */
  hittableMaxZ: number;
  moveSpeed: number;
  /** 초당 회전 속도 (라디안) */
  turnSpeed: number;
  /** 다가가기 시작 후 사거리 안이어도 예고까지 기다리는 최소 시간 */
  minIdleMs: number;
  /** 고른 공격의 사거리까지 이만큼 쫓아가도 못 붙으면 공격을 다시 고른다 */
  chaseTimeoutMs: number;
  /** 사거리 밖(다가가야 하는) 공격이 후보로 뽑힐 때의 확률 배율 */
  outOfRangeWeight: number;
  /**
   * 관찰: 공격이 끝난 뒤 바로 다가가지 않고 거리를 재는 시간.
   * 플레이어가 먼저 들어갈지, 포션을 마실지 고르는 시간이 된다.
   */
  watch: {
    minMs: number;
    maxMs: number;
    /** 플레이어 주위를 옆으로 도는 속도 */
    strafeSpeed: number;
    /** 이보다 가까우면 한 걸음 물러난다 */
    retreatDistance: number;
    retreatSpeed: number;
  };
  patterns: BossPatternConfig[];
}

/**
 * 1막 수치 (정직하고 읽기 쉬운 보스).
 * 처음 값(예고 0.6~1.0초, 이동 110, 회전 5)은 최종 페이즈 수준이라 이후 "막별 배율"로 되살린다.
 */
export const BOSS: BossConfig = {
  radius: 40,
  name: 'UNIT-01',
  maxHp: 400,
  posture: {
    max: 100,
    perDamage: 0.6,
    perParry: 30,
    decayPerSec: 12,
    decayDelayMs: 1500,
  },
  staggerMs: 2000,
  staggerDamageMultiplier: 2,
  flinchMs: 500,
  hittableMaxZ: 20,
  moveSpeed: 80,
  turnSpeed: 3,
  minIdleMs: 300,
  chaseTimeoutMs: 3000,
  outOfRangeWeight: 0.2,
  watch: {
    minMs: 800,
    maxMs: 1600,
    strafeSpeed: 45,
    retreatDistance: 120,
    retreatSpeed: 60,
  },
  patterns: [
    {
      id: 'sweep', name: '휘두르기', shape: 'sector', radius: 110, arcDeg: 130,
      telegraphMs: 900, activeMs: 120, recoveryMs: 600, restMs: 0,
      damage: 20, parryable: true, minDistance: 0, maxDistance: 105, weight: 3,
    },
    {
      id: 'thrust', name: '찌르기', shape: 'rect', length: 260, width: 50,
      telegraphMs: 1050, activeMs: 120, recoveryMs: 700, restMs: 0,
      damage: 25, parryable: true, minDistance: 70, maxDistance: 210, weight: 3,
    },
    {
      id: 'spin', name: '회전 베기', shape: 'circle', radius: 130, anchor: 'self',
      telegraphMs: 1350, activeMs: 160, recoveryMs: 750, restMs: 0,
      damage: 25, parryable: false, minDistance: 0, maxDistance: 115, weight: 2,
    },
    {
      id: 'slam', name: '점프 내려찍기', shape: 'circle', radius: 90, anchor: 'target', jumpHeight: 130,
      telegraphMs: 1500, activeMs: 140, recoveryMs: 500, restMs: 1200,
      damage: 30, parryable: false, minDistance: 230, maxDistance: Number.POSITIVE_INFINITY, weight: 2,
    },
  ],
};

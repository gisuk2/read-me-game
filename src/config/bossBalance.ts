/**
 * 보스 수치 모음. 모든 값은 임시값이며 플레이테스트로 조정한다.
 * 시간 단위: ms / 거리 단위: px / 각도 단위: 도(deg)
 */

export type BossPatternId =
  | 'sweep' | 'thrust' | 'spin' | 'combo' | 'slam'
  | 'shot' | 'pursuit' | 'wave' | 'delayedSlam' | 'grab' | 'charge';

/**
 * 패턴 카테고리 (docs/design/boss-patterns.md §0)
 *  - normal(일반): 패링 가능. 무기·탄환 공격
 *  - heavy(강): 패링 불가. 몸 전체·낙하·에너지. 바닥 예고가 이중 점선, 무기가 붉게 빛남
 */
export type PatternCategory = 'normal' | 'heavy';

/**
 * 보스 무기. 패턴마다 쓰는 무기가 정해져 있고, 다른 무기가 필요하면 바꿔 든다 (weaponSwapMs).
 * 실루엣만 봐도 다음 공격 계열이 읽히게 하는 것이 목적 (한 방 사망의 공정성).
 */
export type WeaponId = 'greatsword' | 'spear' | 'hammer' | 'twinblades' | 'gun' | 'bare';

export const WEAPON_NAME: Record<WeaponId, string> = {
  greatsword: '대검',
  spear: '창',
  hammer: '해머',
  twinblades: '쌍검',
  gun: '총',
  bare: '맨손',
};

/**
 * 공격 한 타. 한 패턴은 1타 이상으로 이루어진다 (연속기 = 여러 타).
 *
 *   예고(telegraph) ──→ 판정(active) ──→ 경직(recovery) ──→ 다음 타 예고 or 패턴 끝
 *   └ trackRatio까지는 플레이어를 따라 조준, 이후 고정
 */
export interface AttackStep {
  /** 예고(준비 동작) 시간 */
  telegraphMs: number;
  /**
   * 예고 중 조준을 따라가는 구간 (0~1). 0.6이면 예고의 처음 60% 동안 플레이어를 따라 돌고, 나머지 40%는 고정.
   * → 너무 일찍 구르면 따라와서 맞고, 고정된 뒤에 움직여야 피한다.
   */
  trackRatio: number;
  /** 판정 순간 앞으로 미끄러져 나가는 거리. 예고 범위는 돌진한 뒤의 위치에 그려진다 (예고 = 판정) */
  lungeDistance: number;
  /** 판정이 켜져 있는 시간 */
  activeMs: number;
  /** 이 타 뒤의 경직. 마지막 타가 아니면 다음 타까지의 틈 */
  recoveryMs: number;
  /** 이 타만 카테고리를 바꿈 (예: 쌍검 마무리 돌진 = 강, 패링 불가) */
  category?: PatternCategory;
  /**
   * 이 타만 판정 모양을 바꿈. 'dashRect' = 예고를 시작한 자리에서 조준 방향으로 뻗는 직사각형
   * (몸통으로 돌파하는 돌진: 지나가는 길 전체가 판정)
   */
  shape?: { kind: 'dashRect'; length: number; width: number };
  /**
   * 원거리 타: 판정이 켜지는 순간 날아가는 물체를 하나 쏜다 (근접 판정 없음).
   * 예고는 조준선 (발사 방향의 긴 직사각형). bullet = 탄 / wave = 땅을 타는 충격파
   */
  fire?: { kind: 'bullet' | 'wave'; speed: number; radius: number };
}

interface PatternBase {
  id: BossPatternId;
  /** 화면·로그에 쓰는 이름 */
  name: string;
  category: PatternCategory;
  weapon: WeaponId;
  steps: AttackStep[];
  /** 마지막 타의 경직 뒤 추가로 쉬는 시간 (큰 빈틈). 없으면 0 */
  restMs: number;
  /** 한 타당 피해 */
  damage: number;
  /**
   * 연속기를 도중에 끊을 수 있는 시점: 이만큼의 타가 끝난 뒤의 틈부터 끊을 수 있다.
   * 학습 단계에서 "끊고 다른 기술로 넘어가기"에 쓴다. 없으면 끊을 수 없음.
   */
  cancelAfterHits?: number;
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

/**
 * 원형. 'self' = 보스 주변,
 * 'target' = 플레이어 위치(보스가 뛰어올라 그곳에 착지). 조준 고정 전까지는 착지 지점이 플레이어를 따라간다.
 */
export interface CirclePattern extends PatternBase {
  shape: 'circle';
  radius: number;
  anchor: 'self' | 'target';
  /** anchor가 'target'일 때 뛰어오르는 최대 높이 (2.5D 표현용) */
  jumpHeight?: number;
  /**
   * 공중에서 멈칫하는 구간 (예고 진행률 from~to). 이 동안 최고 높이에서 착지 지점을 따라다니다가 떨어진다.
   * 지연 내려찍기용. 없으면 포물선으로 한 번에.
   */
  hang?: { from: number; to: number };
}

export type BossPatternConfig = SectorPattern | RectPattern | CirclePattern;

/** 일반 = 패링 가능, 강 = 패링 불가. 타에 카테고리가 따로 있으면 그것을 따른다 */
export const isParryable = (p: { category: PatternCategory }, step?: { category?: PatternCategory }): boolean =>
  (step?.category ?? p.category) === 'normal';

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
  /** 패링당했을 때 움찔하는 시간 (공격이 끊김). 연속기는 마지막 타를 패링당했을 때만 움찔한다 */
  flinchMs: number;
  /** 공격이 판정되는 높이 한계. 이보다 높이 떠 있으면(점프 중) 맞지 않는다 */
  hittableMaxZ: number;
  moveSpeed: number;
  /** 초당 회전 속도 (라디안) */
  turnSpeed: number;
  /** 예고 중 조준을 따라가는 초당 회전 속도 (라디안). 너무 빠르면 피할 수 없다 */
  aimTrackSpeed: number;
  /** 무기별 이동 속도 (다가가기). 관찰 중 옆으로 돌기·물러나기도 같은 비율 (moveSpeed 기준) */
  weaponMoveSpeed: Record<WeaponId, number>;
  /** 처음 들고 있는 무기 */
  startWeapon: WeaponId;
  /** 무기를 바꿔 드는 시간 (이 동안 공격하지 않음 = 작은 빈틈) */
  weaponSwapMs: number;
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

/** 한 타짜리 패턴의 타 설정을 줄여 쓰기 위한 도우미 */
const single = (s: AttackStep): AttackStep[] => [s];

/**
 * 1막 수치 (정직하고 읽기 쉬운 보스). 예고 시간은 튜토리얼용으로 2c-1 값의 1.25배.
 * 처음 값(예고 0.6~1.0초, 이동 110, 회전 5)은 최종 페이즈 수준이라 이후 "막별 배율"로 되살린다.
 *
 * 패턴 순서는 고르기 결과에 영향을 준다 (같은 난수면 앞쪽부터). 새 패턴은 slam 앞에 넣는다.
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
    decayDelayMs: 4000,
  },
  staggerMs: 2000,
  staggerDamageMultiplier: 2,
  flinchMs: 500,
  hittableMaxZ: 20,
  moveSpeed: 80,
  turnSpeed: 3,
  aimTrackSpeed: 4,
  weaponMoveSpeed: { twinblades: 100, spear: 80, greatsword: 65, hammer: 65, gun: 75, bare: 90 },
  startWeapon: 'greatsword',
  weaponSwapMs: 400,
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
  // 범위·사거리는 2c-1 값의 1.2배 (조정 2)
  patterns: [
    {
      id: 'sweep', name: '휘두르기', category: 'normal', weapon: 'greatsword', shape: 'sector', radius: 132, arcDeg: 130,
      steps: single({ telegraphMs: 1125, trackRatio: 0.6, lungeDistance: 25, activeMs: 120, recoveryMs: 600 }),
      restMs: 0, damage: 20, minDistance: 0, maxDistance: 126, weight: 3,
    },
    {
      // 창 3연속 찌르기: 타마다 다시 조준하며 전진, 세 번째는 박자를 늦춰 미리 움직인 플레이어를 잡는다
      id: 'thrust', name: '3연속 찌르기', category: 'normal', weapon: 'spear', shape: 'rect', length: 312, width: 60,
      steps: [
        { telegraphMs: 1310, trackRatio: 0.65, lungeDistance: 40, activeMs: 120, recoveryMs: 250 },
        { telegraphMs: 520, trackRatio: 0.5, lungeDistance: 30, activeMs: 110, recoveryMs: 250 },
        { telegraphMs: 900, trackRatio: 0.55, lungeDistance: 50, activeMs: 130, recoveryMs: 700 },
      ],
      restMs: 0, damage: 25, minDistance: 84, maxDistance: 252, weight: 3,
    },
    {
      id: 'spin', name: '회전 베기', category: 'heavy', weapon: 'greatsword', shape: 'circle', radius: 156, anchor: 'self',
      steps: single({ telegraphMs: 1690, trackRatio: 0, lungeDistance: 0, activeMs: 160, recoveryMs: 750 }),
      restMs: 0, damage: 25, minDistance: 0, maxDistance: 138, weight: 2,
    },
    {
      // 쌍검: 좌우 번갈아 4번 베기(패링 가능) → 마무리 빠른 돌진(패링 불가).
      // 4번 베기는 패링하거나 뒤로 빠지고, 돌진은 옆으로 피한다 → 정답이 나뉘어 읽는 맛이 생김.
      // 3타 뒤 짧게 멈칫(4타 지연). 돌진은 빠르므로 조준을 일찍 고정해 예고 범위를 오래 보여준다.
      id: 'combo', name: '연속 베기', category: 'normal', weapon: 'twinblades', shape: 'sector', radius: 102, arcDeg: 110,
      steps: [
        { telegraphMs: 900, trackRatio: 0.7, lungeDistance: 30, activeMs: 90, recoveryMs: 150 },
        { telegraphMs: 400, trackRatio: 0.5, lungeDistance: 30, activeMs: 90, recoveryMs: 150 },
        { telegraphMs: 400, trackRatio: 0.5, lungeDistance: 30, activeMs: 90, recoveryMs: 260 },
        { telegraphMs: 650, trackRatio: 0.6, lungeDistance: 30, activeMs: 90, recoveryMs: 200 },
        {
          telegraphMs: 900, trackRatio: 0.35, lungeDistance: 200, activeMs: 160, recoveryMs: 900,
          category: 'heavy', shape: { kind: 'dashRect', length: 240, width: 70 },
        },
      ],
      restMs: 0, damage: 12, cancelAfterHits: 2, minDistance: 0, maxDistance: 132, weight: 3,
    },
    {
      // 총 2발. 조준선이 따라오다 고정 → 빠른 탄. 패링하면 탄이 튕겨 보스에게 돌아간다
      id: 'shot', name: '사격', category: 'normal', weapon: 'gun', shape: 'rect', length: 0, width: 0,
      steps: [
        { telegraphMs: 1000, trackRatio: 0.6, lungeDistance: 0, activeMs: 60, recoveryMs: 350, fire: { kind: 'bullet', speed: 650, radius: 7 } },
        { telegraphMs: 650, trackRatio: 0.5, lungeDistance: 0, activeMs: 60, recoveryMs: 700, fire: { kind: 'bullet', speed: 650, radius: 7 } },
      ],
      restMs: 0, damage: 15, minDistance: 180, maxDistance: Number.POSITIVE_INFINITY, weight: 2,
    },
    {
      // 대검 추격 베기: 타마다 다시 조준하며 크게 돌진, 세 번째는 늦게 와서 미리 구른 플레이어를 잡는다
      id: 'pursuit', name: '추격 베기', category: 'normal', weapon: 'greatsword', shape: 'sector', radius: 120, arcDeg: 100,
      steps: [
        { telegraphMs: 1000, trackRatio: 0.65, lungeDistance: 70, activeMs: 120, recoveryMs: 220 },
        { telegraphMs: 600, trackRatio: 0.55, lungeDistance: 70, activeMs: 120, recoveryMs: 220 },
        { telegraphMs: 950, trackRatio: 0.6, lungeDistance: 80, activeMs: 130, recoveryMs: 750 },
      ],
      restMs: 0, damage: 20, minDistance: 100, maxDistance: 220, weight: 2,
    },
    {
      // 해머로 땅을 쳐서 직선으로 퍼지는 충격파. 옆으로 비키거나 대시 무적으로 통과
      id: 'wave', name: '지면 파동', category: 'heavy', weapon: 'hammer', shape: 'rect', length: 0, width: 0,
      steps: [
        { telegraphMs: 1300, trackRatio: 0.6, lungeDistance: 0, activeMs: 80, recoveryMs: 800, fire: { kind: 'wave', speed: 330, radius: 30 } },
      ],
      restMs: 0, damage: 25, minDistance: 180, maxDistance: Number.POSITIVE_INFINITY, weight: 2,
    },
    {
      // 뛰어올라 공중에서 멈칫하며 착지 지점이 따라온다 → 고정 → 떨어짐. 일찍 구르면 맞는다
      id: 'delayedSlam', name: '지연 내려찍기', category: 'heavy', weapon: 'hammer', shape: 'circle', radius: 108, anchor: 'target',
      jumpHeight: 150, hang: { from: 0.3, to: 0.82 },
      steps: single({ telegraphMs: 2200, trackRatio: 0.72, lungeDistance: 0, activeMs: 140, recoveryMs: 500 }),
      restMs: 1200, damage: 30, minDistance: 150, maxDistance: Number.POSITIVE_INFINITY, weight: 1,
    },
    {
      // 맨손 잡기: 짧고 빠른 돌진. 좁은 범위라 옆으로 피한다
      id: 'grab', name: '잡기', category: 'heavy', weapon: 'bare', shape: 'sector', radius: 70, arcDeg: 70,
      steps: single({ telegraphMs: 1100, trackRatio: 0.55, lungeDistance: 90, activeMs: 110, recoveryMs: 900 }),
      restMs: 0, damage: 30, minDistance: 0, maxDistance: 150, weight: 2,
    },
    {
      // 맨손 몸통 돌진: 길게 일직선. 옆으로 비킨다
      id: 'charge', name: '몸통 돌진', category: 'heavy', weapon: 'bare', shape: 'sector', radius: 60, arcDeg: 90,
      steps: single({
        telegraphMs: 1250, trackRatio: 0.45, lungeDistance: 300, activeMs: 220, recoveryMs: 900,
        shape: { kind: 'dashRect', length: 340, width: 90 },
      }),
      restMs: 0, damage: 30, minDistance: 120, maxDistance: 340, weight: 2,
    },
    {
      id: 'slam', name: '점프 내려찍기', category: 'heavy', weapon: 'hammer', shape: 'circle', radius: 108, anchor: 'target', jumpHeight: 130,
      steps: single({ telegraphMs: 1875, trackRatio: 0.6, lungeDistance: 0, activeMs: 140, recoveryMs: 500 }),
      restMs: 1200, damage: 30, minDistance: 230, maxDistance: Number.POSITIVE_INFINITY, weight: 2,
    },
  ],
};

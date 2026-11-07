import type { BossPatternId, WeaponId } from '../config/bossBalance';

/**
 * 헬퍼의 안내 (데이터). 대사는 코드가 아니라 데이터로 관리한다 (계획서 §5.2 데이터 주도).
 *
 * 안내 방식 (docs/design/learning-feedback.md §6.1):
 *   1. 처음 접속: 인사 세 줄만
 *   2. 패턴이 처음 나올 때: 잠깐 느려지며 헬퍼 말풍선 한 줄 (HELPER_HINTS)
 *   3. 일시정지 메뉴 "패턴 안내": 무기별 그림 카드 (WEAPON_CARDS)
 *
 * 스토리상 이 "정석"들은 보스가 이미 전부 알고 있다 (docs/design/story.md §3 헬퍼).
 * 학습 단계에서 변칙 패턴이 나오면, 카드에서 더 이상 맞지 않는 칸이 노이즈로 깨진다.
 */
export const HELPER_INTRO: readonly string[] = [
  '안녕하세요, 테스터님! 안내 AI 헬퍼예요.',
  '한 번 맞으면 신호가 끊기지만, 바로 직전부터 다시 할 수 있어요.',
  '처음 보는 공격은 그때그때 알려드릴게요!',
];

/** 패턴이 처음 나올 때 말풍선 한 줄 (짧게) */
export const HELPER_HINTS: Record<BossPatternId, string> = {
  sweep: '대검을 젖혔어요! 뒤로 빠지거나 패링!',
  thrust: '창이에요! 옆으로! 세 번째는 늦게 와요!',
  spin: '몸에 감았어요! 패링 안 돼요, 멀리!',
  combo: '쌍검! 베기는 뒤로, 붉은 돌진은 옆으로!',
  slam: '뛰어올라요! 착지 순간에 대시!',
  shot: '총! 조준선이 진해지면 피하거나 패링!',
  pursuit: '따라와요! 세 번째가 늦어요!',
  wave: '충격파! 옆으로 비켜요!',
  delayedSlam: '공중에서 멈췄어요! 떨어질 때 대시!',
  grab: '잡으러 와요! 옆으로!',
  charge: '돌진! 옆으로 비켜요!',
};

/** 그림 카드의 대응법 표시 (짧은 꼬리표). 노이즈 처리 단위가 된다 */
export const HELPER_ANSWERS: Record<BossPatternId, readonly string[]> = {
  sweep: ['뒤로', '패링'],
  thrust: ['옆으로', '3번째 늦음'],
  spin: ['멀리'],
  combo: ['뒤로', '패링', '돌진은 옆'],
  slam: ['착지 때 대시'],
  shot: ['옆으로', '패링 = 반사'],
  pursuit: ['3번째 늦음'],
  wave: ['옆으로', '대시 통과'],
  delayedSlam: ['떨어질 때 대시'],
  grab: ['옆으로'],
  charge: ['옆으로'],
};

/** 그림 카드에 쓰는 무기 순서 (카드 6장) */
export const WEAPON_ORDER: readonly WeaponId[] = ['greatsword', 'spear', 'twinblades', 'hammer', 'gun', 'bare'];

/**
 * 한 프레임 동안의 플레이어 입력.
 * 키보드·마우스(InputReader)든 테스트·봇이든 이 형태로만 PlayerModel에 전달한다.
 * → PlayerModel은 입력이 어디서 왔는지 모른다 (봇 플레이어로 학습 검증이 가능해지는 이유).
 */
export interface PlayerInput {
  /** 이동 방향: -1, 0, 1 (정규화는 PlayerModel이 한다) */
  moveX: number;
  moveY: number;
  /** 조준 각도 (라디안). 0 = 오른쪽, 시계 방향으로 증가 (화면 좌표계) */
  aimAngle: number;
  /** 이번 프레임에 "눌린 순간"이면 true (누르고 있는 동안 계속 true가 아님) */
  attack: boolean;
  /** 공격 버튼을 누르고 있는 중이면 true (꾹 누르기 콤보용) */
  attackHeld: boolean;
  parry: boolean;
  dash: boolean;
  potion: boolean;
}

export const NO_INPUT: Readonly<PlayerInput> = Object.freeze({
  moveX: 0,
  moveY: 0,
  aimAngle: 0,
  attack: false,
  attackHeld: false,
  parry: false,
  dash: false,
  potion: false,
});

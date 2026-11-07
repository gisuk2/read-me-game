/**
 * 마우스 클릭(공격·패링)을 "다음 프레임에 한 번만" 전달하기 위한 대기열.
 * Phaser에 의존하지 않아 테스트할 수 있다.
 *
 * 일시정지 메뉴에서 "계속하기"를 누른 클릭이 공격으로 새어 들어가지 않도록
 * 게임을 재개할 때 clear()로 비운다.
 */
export class ClickQueue {
  private attack = false;
  private parry = false;

  pushAttack(): void {
    this.attack = true;
  }

  pushParry(): void {
    this.parry = true;
  }

  /** 쌓인 클릭을 꺼내고 비운다 (한 번 꺼내면 다음 호출에는 false) */
  take(): { attack: boolean; parry: boolean } {
    const result = { attack: this.attack, parry: this.parry };
    this.clear();
    return result;
  }

  clear(): void {
    this.attack = false;
    this.parry = false;
  }
}

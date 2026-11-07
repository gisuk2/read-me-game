/**
 * 결과 화면 (HTML/CSS로 게임 화면 위에 겹침). 요소는 index.html에 있다.
 * 시뮬레이션 설정에 맞춰 시스템 메시지처럼 보여준다.
 */
export class ResultScreen {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly restartButton: HTMLElement;
  private readonly onClick: () => void;

  constructor(onRestart: () => void) {
    this.overlay = ResultScreen.el('result-screen');
    this.title = ResultScreen.el('result-title');
    this.subtitle = ResultScreen.el('result-subtitle');
    this.restartButton = ResultScreen.el('result-restart');
    this.onClick = () => {
      this.restartButton.blur();
      onRestart();
    };
    this.restartButton.addEventListener('click', this.onClick);
    this.hide();
  }

  showDefeat(): void {
    this.show('SIMULATION TERMINATED', '테스터의 신호가 끊어졌습니다.');
  }

  showVictory(): void {
    this.show('SIMULATION COMPLETE', '전투 데이터가 기록되었습니다.');
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  /** 씬이 재시작되면 버튼 연결을 풀어 중복 연결을 막는다 */
  destroy(): void {
    this.restartButton.removeEventListener('click', this.onClick);
    this.hide();
  }

  private show(title: string, subtitle: string): void {
    this.title.textContent = title;
    this.subtitle.textContent = subtitle;
    this.overlay.hidden = false;
  }

  private static el(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`index.html에 #${id} 요소가 없습니다.`);
    return found;
  }
}

/**
 * 일시정지 메뉴 (HTML/CSS로 게임 화면 위에 겹쳐 그림).
 * 요소는 index.html에 있고, 이 클래스는 보이기/숨기기와 버튼 연결만 한다.
 */
export interface PauseMenuHandlers {
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  /** 헬퍼의 패턴 안내 다시 보기 */
  onBriefing: () => void;
}

export class PauseMenu {
  private readonly overlay: HTMLElement;
  private readonly pauseButton: HTMLElement;
  private readonly resumeButton: HTMLElement;
  private readonly restartButton: HTMLElement;
  private readonly briefingButton: HTMLElement;
  private readonly listeners: Array<[HTMLElement, () => void]> = [];

  constructor(handlers: PauseMenuHandlers) {
    this.overlay = PauseMenu.el('pause-menu');
    this.pauseButton = PauseMenu.el('pause-button');
    this.resumeButton = PauseMenu.el('resume-button');
    this.restartButton = PauseMenu.el('restart-button');
    this.briefingButton = PauseMenu.el('briefing-button');

    this.listen(this.pauseButton, handlers.onPause);
    this.listen(this.resumeButton, handlers.onResume);
    this.listen(this.restartButton, handlers.onRestart);
    this.listen(this.briefingButton, handlers.onBriefing);
    this.hide();
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  show(): void {
    this.overlay.hidden = false;
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  /** 씬이 재시작되면 버튼 연결을 풀어 중복 연결을 막는다 */
  destroy(): void {
    for (const [el, fn] of this.listeners) el.removeEventListener('click', fn);
    this.listeners.length = 0;
    this.hide();
  }

  private listen(el: HTMLElement, fn: () => void): void {
    const handler = (): void => {
      el.blur(); // 버튼에 포커스가 남아 Space 키가 버튼을 누르지 않도록
      fn();
    };
    el.addEventListener('click', handler);
    this.listeners.push([el, handler]);
  }

  private static el(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`index.html에 #${id} 요소가 없습니다.`);
    return found;
  }
}

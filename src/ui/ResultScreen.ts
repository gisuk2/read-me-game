import type { Bounds } from '../entities/player/PlayerModel';
import type { DeathRecord } from '../run/Telemetry';
import { drawDeathMap } from './DeathMap';

/** 패배 화면에 보여줄 내용 */
export interface DefeatInfo {
  arena: Bounds;
  deaths: readonly DeathRecord[];
  /** 이번 사망의 위치 (deaths 안의 번호) */
  latestIndex: number | null;
  /** 이번 사망 설명 한 줄 (예: "휘두르기 (대검)에 사망") */
  causeLine: string;
  /** 누적 통계 한 줄 */
  statsLine: string;
  /** 다시 시작 지점 안내 */
  restartNote: string;
}

const SMALL = { w: 288, h: 162 };
const BIG = { w: 640, h: 360 };

/**
 * 결과 화면 (HTML/CSS로 게임 화면 위에 겹침). 요소는 index.html에 있다.
 * 시뮬레이션 설정에 맞춰 시스템 메시지처럼 보여준다.
 * 패배 시에는 "QA 텔레메트리" 사망 지도를 함께 보여준다 (Tab으로 크게 보기).
 */
export class ResultScreen {
  private readonly overlay: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly restartButton: HTMLElement;
  private readonly telemetry: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly cause: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly restartNote: HTMLElement;
  private readonly onClick: () => void;
  private info: DefeatInfo | null = null;
  private big = false;

  constructor(onRestart: () => void) {
    this.overlay = ResultScreen.el('result-screen');
    this.title = ResultScreen.el('result-title');
    this.subtitle = ResultScreen.el('result-subtitle');
    this.restartButton = ResultScreen.el('result-restart');
    this.telemetry = ResultScreen.el('telemetry');
    this.canvas = ResultScreen.el('death-map') as HTMLCanvasElement;
    this.cause = ResultScreen.el('death-cause');
    this.stats = ResultScreen.el('death-stats');
    this.restartNote = ResultScreen.el('restart-note');
    this.onClick = () => {
      this.restartButton.blur();
      onRestart();
    };
    this.restartButton.addEventListener('click', this.onClick);
    this.hide();
  }

  get isShown(): boolean {
    return !this.overlay.hidden;
  }

  /** 같은 구간에서 정해진 횟수만큼 죽었을 때 (체크포인트로 돌아가기 전) */
  showDefeat(info: DefeatInfo): void {
    this.info = info;
    this.big = false;
    this.cause.textContent = info.causeLine;
    this.stats.textContent = info.statsLine;
    this.restartNote.textContent = info.restartNote;
    this.telemetry.hidden = false;
    this.renderMap();
    this.show('SIMULATION TERMINATED', '같은 구간에서 신호가 여러 번 끊어졌습니다. 체크포인트로 되돌립니다.');
  }

  showVictory(): void {
    this.info = null;
    this.telemetry.hidden = true;
    this.show('SIMULATION COMPLETE', '전투 데이터가 기록되었습니다.');
  }

  /** Tab: 사망 지도 크게 보기 ↔ 작게 */
  toggleBigMap(): void {
    if (!this.info || this.overlay.hidden) return;
    this.big = !this.big;
    this.renderMap();
  }

  hide(): void {
    this.overlay.hidden = true;
  }

  /** 씬이 재시작되면 버튼 연결을 풀어 중복 연결을 막는다 */
  destroy(): void {
    this.restartButton.removeEventListener('click', this.onClick);
    this.hide();
  }

  private renderMap(): void {
    if (!this.info) return;
    const size = this.big ? BIG : SMALL;
    this.canvas.width = size.w;
    this.canvas.height = size.h;
    this.overlay.classList.toggle('big-map', this.big);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    drawDeathMap(ctx, size.w, size.h, this.info.arena, this.info.deaths, this.info.latestIndex);
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

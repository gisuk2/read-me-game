/**
 * 보스 체력 단계 체크포인트 (순수 로직). docs/design/learning-feedback.md §5.2
 *
 * 보스 체력 바를 stages칸으로 나눈다. 한 칸을 깎을 때마다 저장되고,
 * 죽으면 마지막으로 저장된 칸의 맨 위 체력으로 다시 시작한다. (보스의 학습은 유지 — 학습 단계에서)
 */

/** tutorial = 죽으면 처음부터 / checkpoint = 저장된 칸부터 */
export type RunMode = 'tutorial' | 'checkpoint';

export class CheckpointTracker {
  private _saved: number;

  constructor(
    readonly stages = 5,
    saved = 0,
  ) {
    this._saved = Math.max(0, Math.min(stages - 1, saved));
  }

  /** 저장된 칸 수 (0 = 저장 없음) */
  get saved(): number {
    return this._saved;
  }

  /**
   * 보스 체력 비율을 보고 저장할 칸이 늘었으면 저장한다. 새로 저장했으면 true.
   * 마지막 칸(체력 0)은 승리이므로 저장하지 않는다. 체력이 올라도 저장은 되돌아가지 않는다.
   */
  update(bossHpRatio: number): boolean {
    const EPS = 1e-9;
    const cleared = Math.floor((1 - bossHpRatio) * this.stages + EPS);
    const next = Math.min(this.stages - 1, cleared);
    if (next <= this._saved) return false;
    this._saved = next;
    return true;
  }

  /** 다시 시작할 때의 보스 체력 비율 */
  restoreHpRatio(): number {
    return 1 - this._saved / this.stages;
  }
}

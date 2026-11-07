/**
 * 처음 보는 패턴 안내 (순수 로직). 패턴마다 한 번만 헬퍼가 한 줄로 알려준다.
 * 이번 접속 동안만 기억한다 (새로 고치면 다시 알려줌).
 */
export class HintTracker<T extends string = string> {
  private readonly shown = new Set<T>();

  /** 처음이면 true를 돌려주고 "알려줌"으로 기록한다 */
  take(id: T): boolean {
    if (this.shown.has(id)) return false;
    this.shown.add(id);
    return true;
  }

  has(id: T): boolean {
    return this.shown.has(id);
  }
}

/**
 * 빠른 부활 (순수 로직). docs/design/learning-feedback.md §5
 *
 * 죽으면 바로 직전 패턴이 시작되기 전으로 되감는다 (카타나 제로처럼 빠르게).
 * 같은 구간에서 maxRevives번 죽으면 그때 체크포인트(보스 체력 단계)로 돌아가고 사망 지도를 보여준다.
 * 새 체크포인트가 저장되면 횟수가 다시 채워진다.
 */
export type DeathOutcome = 'revive' | 'checkpoint';

export class ReviveCounter {
  private deaths = 0;

  constructor(readonly maxDeaths = 5) {}

  /** 지금 구간에서 죽은 횟수 */
  get count(): number {
    return this.deaths;
  }

  /** 체크포인트로 돌아가기 전까지 남은 사망 횟수 */
  get remaining(): number {
    return this.maxDeaths - this.deaths;
  }

  /** 죽음을 기록하고 어떻게 다시 시작할지 알려준다. 'checkpoint'면 횟수는 다시 채워진다 */
  onDeath(): DeathOutcome {
    this.deaths += 1;
    if (this.deaths < this.maxDeaths) return 'revive';
    this.deaths = 0;
    return 'checkpoint';
  }

  /** 새 체크포인트가 저장됨 → 횟수 초기화 */
  reset(): void {
    this.deaths = 0;
  }
}

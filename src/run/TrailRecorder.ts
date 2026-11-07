import type { Vec2 } from '../utils/geometry';

/**
 * 최근 움직임 기록 (순수 로직). 사망 직전 1초 궤적을 남기는 데 쓴다.
 * 이후 잔상 시스템(보스 패턴 §2)의 녹화기로 확장한다.
 */
export class TrailRecorder {
  private points: { x: number; y: number; t: number }[] = [];
  private nowMs = 0;
  private sinceSampleMs = Number.POSITIVE_INFINITY;

  constructor(
    /** 몇 ms마다 한 점을 남기는가 */
    private readonly sampleMs = 50,
    /** 몇 ms 전까지 남기는가 */
    private readonly keepMs = 1000,
  ) {}

  push(x: number, y: number, dtMs: number): void {
    this.nowMs += dtMs;
    this.sinceSampleMs += dtMs;
    if (this.sinceSampleMs >= this.sampleMs) {
      this.points.push({ x, y, t: this.nowMs });
      this.sinceSampleMs = 0;
    }
    const cutoff = this.nowMs - this.keepMs;
    while (this.points.length > 0 && this.points[0].t < cutoff) this.points.shift();
  }

  /** 오래된 것 → 최근 순서의 위치 목록 (복사본) */
  snapshot(): Vec2[] {
    return this.points.map((p) => ({ x: p.x, y: p.y }));
  }
}

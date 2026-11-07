import Phaser from 'phaser';
import type { AttackInfo, PlayerModel } from './PlayerModel';
import { shapeOutline } from '../../utils/shapes';

const BLACK = 0x000000;
const WHITE = 0xffffff;
const GREY = 0x555555;

/** 쉬고 있을 때 검이 몸 옆으로 비껴 있는 각도와 길이 비율 */
const REST_ANGLE_OFFSET = 0.8;
const REST_LENGTH_RATIO = 0.55;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/**
 * PlayerModel의 상태를 화면에 그리기만 한다 (로직 없음).
 * 모든 모션은 모델이 알려주는 "단계 + 진행률"로 계산하므로,
 * 화면의 움직임과 실제 판정 타이밍이 항상 일치한다.
 */
export class PlayerView {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly radius: number,
  ) {
    // 그리는 순서: 보스 예고(0) → 플레이어(1) → 보스 몸체(2) → HUD(10)
    this.g = scene.add.graphics().setDepth(1);
  }

  draw(m: PlayerModel): void {
    const g = this.g;
    g.clear();

    if (m.state === 'dash') this.drawDashTrail(m);
    this.drawSword(m);
    this.drawBody(m);
    this.drawShield(m);
  }

  // ───────────────────────── 몸체 ─────────────────────────

  private drawBody(m: PlayerModel): void {
    const g = this.g;
    const r = this.radius;
    // 쓰러짐: 속이 빈 원 + X
    if (m.isDead) {
      g.lineStyle(2, BLACK, 0.6);
      g.strokeCircle(m.x, m.y, r);
      g.lineBetween(m.x - r * 0.6, m.y - r * 0.6, m.x + r * 0.6, m.y + r * 0.6);
      g.lineBetween(m.x + r * 0.6, m.y - r * 0.6, m.x - r * 0.6, m.y + r * 0.6);
      return;
    }
    // 맞아서 경직 중: 회색
    if (m.state === 'hit') {
      g.fillStyle(GREY, 1);
      g.fillCircle(m.x, m.y, r);
      return;
    }
    // 무적이면 속이 빈 원
    if (m.isInvulnerable) {
      g.lineStyle(2, BLACK, 1);
      g.strokeCircle(m.x, m.y, r);
    } else {
      g.fillStyle(BLACK, 1);
      g.fillCircle(m.x, m.y, r);
    }
    // 바라보는 방향 표시 (작은 흰 점)
    g.fillStyle(WHITE, 1);
    g.fillCircle(m.x + Math.cos(m.facing) * r * 0.55, m.y + Math.sin(m.facing) * r * 0.55, 2.5);
  }

  /** 대시 중: 진행 반대 방향으로 옅은 잔상 3개 */
  private drawDashTrail(m: PlayerModel): void {
    const g = this.g;
    const d = m.dashDirection;
    [0.22, 0.13, 0.06].forEach((alpha, i) => {
      const back = (i + 1) * 14;
      g.fillStyle(BLACK, alpha);
      g.fillCircle(m.x - d.x * back, m.y - d.y * back, this.radius);
    });
  }

  // ───────────────────────── 검 ─────────────────────────

  /**
   * 검 모션
   *  - 쉬는 중: 몸 옆에 짧게
   *  - 준비(startup): 쉬는 자세 → 뒤로 당긴 자세 (3타는 더 크게 당김)
   *  - 판정(active): 부채꼴을 따라 휘두름 (1타 →, 2타 ←, 3타 크게 →) + 지나간 자리 표시
   *  - 경직(recovery): 휘두른 끝에 머무름. 대시 캔슬 가능 구간에 들어가면 검이 내려감
   */
  private drawSword(m: PlayerModel): void {
    const atk = m.attack;
    const r = this.radius;

    if (!atk) {
      // 쉬는 자세 (포션 마시는 중·쓰러짐엔 검을 그리지 않음)
      if (m.isDead) return;
      const len = 56 * REST_LENGTH_RATIO;
      this.drawBlade(m.x, m.y, m.facing + REST_ANGLE_OFFSET, r, len, 3, 1);
      return;
    }

    if (atk.kind === 'dash') {
      this.drawThrust(m, atk);
      return;
    }

    // 3타 충전: 몸 둘레에 가는 원이 차오름 (눈에 띄되 살짝만)
    if (atk.comboIndex === 2 && atk.phase === 'startup') {
      const g = this.g;
      g.lineStyle(2, BLACK, 0.15);
      g.strokeCircle(m.x, m.y, r + 8);
      g.lineStyle(2, BLACK, 0.55);
      g.beginPath();
      g.arc(m.x, m.y, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * atk.phaseProgress, false);
      g.strokePath();
    }

    const { from, to, windup } = this.sweepAngles(atk);
    const thickness = atk.comboIndex === 2 ? 5 : 3;
    const restLen = atk.range * REST_LENGTH_RATIO;
    const fullLen = atk.range - r;

    if (atk.phase === 'startup') {
      const t = easeOutCubic(atk.phaseProgress);
      // 공격 범위 예고: 옅은 테두리
      this.strokeSlice(m.x, m.y, atk.range, atk.angle - atk.arcRad / 2, atk.angle + atk.arcRad / 2, 0.2);
      const angle = lerp(atk.angle + REST_ANGLE_OFFSET, windup, t);
      this.drawBlade(m.x, m.y, angle, r, lerp(restLen, fullLen, t), thickness, 1);
      return;
    }

    if (atk.phase === 'active') {
      const t = easeOutCubic(atk.phaseProgress);
      const angle = lerp(from, to, t);
      // 지나간 자리
      this.fillSlice(m.x, m.y, atk.range, Math.min(from, angle), Math.max(from, angle), 0.22);
      this.drawBlade(m.x, m.y, angle, r, fullLen, thickness, 1);
      return;
    }

    // recovery
    if (atk.canDashCancel) {
      const t = easeOutCubic(atk.phaseProgress);
      this.drawBlade(m.x, m.y, to, r, lerp(fullLen, restLen, t), thickness - 1, 0.6);
    } else {
      this.drawBlade(m.x, m.y, to, r, fullLen, thickness, 1);
    }
  }

  /**
   * 대시 찌르기: 준비 = 검을 뒤로 당김, 판정 = 앞으로 쭉 뻗음 + 판정 범위 옅게, 경직 = 뻗은 채로 흐려짐
   */
  private drawThrust(m: PlayerModel, atk: AttackInfo): void {
    const r = this.radius;
    const back = atk.angle;
    if (atk.phase === 'startup') {
      const t = easeOutCubic(atk.phaseProgress);
      this.drawBlade(m.x, m.y, back, r - 10 * t, atk.range * 0.45, 4, 1);
      return;
    }
    if (atk.phase === 'active') {
      const g = this.g;
      const pts = shapeOutline(atk.shape);
      g.fillStyle(BLACK, 0.18);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      this.drawBlade(m.x, m.y, back, r, atk.range - r, 4, 1);
      return;
    }
    this.drawBlade(m.x, m.y, back, r, lerp(atk.range - r, atk.range * 0.45, easeOutCubic(atk.phaseProgress)), 3, 0.7);
  }

  /** 타마다 휘두르는 방향과 당기는 정도 */
  private sweepAngles(atk: AttackInfo): { from: number; to: number; windup: number } {
    const half = atk.arcRad / 2;
    const reverse = atk.comboIndex === 1; // 2타는 반대 방향
    const from = reverse ? atk.angle + half : atk.angle - half;
    const to = reverse ? atk.angle - half : atk.angle + half;
    const pullBack = atk.comboIndex === 2 ? 0.9 : 0.35; // 3타는 크게 당김
    const dir = Math.sign(to - from);
    return { from, to, windup: from - dir * pullBack };
  }

  private drawBlade(x: number, y: number, angle: number, inner: number, length: number, width: number, alpha: number): void {
    const g = this.g;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    g.lineStyle(width, BLACK, alpha);
    g.lineBetween(x + cos * inner, y + sin * inner, x + cos * (inner + length), y + sin * (inner + length));
  }

  private fillSlice(x: number, y: number, radius: number, start: number, end: number, alpha: number): void {
    const g = this.g;
    g.fillStyle(BLACK, alpha);
    g.beginPath();
    g.slice(x, y, radius, start, end, false);
    g.closePath();
    g.fillPath();
  }

  private strokeSlice(x: number, y: number, radius: number, start: number, end: number, alpha: number): void {
    const g = this.g;
    g.lineStyle(1, BLACK, alpha);
    g.beginPath();
    g.slice(x, y, radius, start, end, false);
    g.closePath();
    g.strokePath();
  }

  // ───────────────────────── 방패 (패링) ─────────────────────────

  /**
   * 패링 모션
   *  - 판정(active): 앞쪽에 반원 방패가 빠르게 펼쳐지며 들림
   *  - 경직(recovery): 방패가 흐려지며 내려감
   */
  private drawShield(m: PlayerModel): void {
    const parry = m.parry;
    if (!parry) return;
    const g = this.g;
    const r = this.radius;

    if (parry.phase === 'active') {
      const spread = lerp(0.35, 1.0, easeOutCubic(Math.min(1, parry.phaseProgress / 0.3)));
      g.lineStyle(5, BLACK, 1);
      g.beginPath();
      g.arc(m.x, m.y, r + 7, m.facing - spread, m.facing + spread, false);
      g.strokePath();
      return;
    }

    const t = parry.phaseProgress;
    g.lineStyle(3, BLACK, 1 - t);
    g.beginPath();
    g.arc(m.x, m.y, lerp(r + 7, r + 3, t), m.facing - 0.8, m.facing + 0.8, false);
    g.strokePath();
  }
}

import Phaser from 'phaser';
import type { Vec2 } from '../../utils/geometry';
import { dashPolyline, expandShape, shapeOutline } from '../../utils/shapes';
import type { BossModel } from './BossModel';

const BLACK = 0x000000;
const WHITE = 0xffffff;
const RED = 0xd62828;
const REST_GREY = 0x777777;

/**
 * 꼭짓점을 이어 닫힌 경로를 만든다. 이후 fillPath / strokePath로 칠한다.
 * (Phaser 4의 fillPoints는 Phaser.Math.Vector2 배열만 받으므로, {x, y}를 그대로 받는 moveTo/lineTo를 쓴다)
 */
function tracePolygon(g: Phaser.GameObjects.Graphics, points: Vec2[]): void {
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
}

const DASH = 10;
const GAP = 7;
/** 패링 불가 공격의 바깥쪽 두 번째 점선 간격 */
const DOUBLE_LINE_OFFSET = 6;

/**
 * 보스와 공격 범위를 그린다 (로직 없음).
 *
 * 예고 규칙 ("빨강 = 위험" 하나만 쓴다)
 *  - 예고: 빨간 점선 + 점점 진해지는 옅은 채움 (언제 터지는지 감을 줌)
 *  - 패링 불가 공격: 점선이 이중
 *  - 판정: 빨간 실선 + 진한 채움
 *  - 경직: 옅은 실선이 사라짐
 */
export class BossView {
  /** 바닥에 깔리는 것 (예고·그림자). 플레이어보다 아래 */
  private readonly ground: Phaser.GameObjects.Graphics;
  /** 보스 몸체. 플레이어보다 위 */
  private readonly body: Phaser.GameObjects.Graphics;

  constructor(
    scene: Phaser.Scene,
    private readonly radius: number,
  ) {
    this.ground = scene.add.graphics().setDepth(0);
    this.body = scene.add.graphics().setDepth(2);
  }

  draw(m: BossModel): void {
    this.ground.clear();
    this.body.clear();
    this.drawAttack(m);
    this.drawShadow(m);
    this.drawBody(m);
  }

  // ───────────────────────── 공격 범위 ─────────────────────────

  private drawAttack(m: BossModel): void {
    const atk = m.attack;
    if (!atk) return;
    const g = this.ground;
    const outline = shapeOutline(atk.shape);

    if (atk.phase === 'telegraph') {
      g.fillStyle(RED, 0.04 + 0.14 * atk.phaseProgress);
      tracePolygon(g, outline);
      g.fillPath();
      this.dashed(outline, 2, 1);
      if (!atk.pattern.parryable) this.dashed(shapeOutline(expandShape(atk.shape, DOUBLE_LINE_OFFSET)), 2, 1);
      return;
    }

    if (atk.phase === 'active') {
      g.fillStyle(RED, 0.45);
      tracePolygon(g, outline);
      g.fillPath();
      g.lineStyle(2, RED, 1);
      tracePolygon(g, outline);
      g.strokePath();
      return;
    }

    // recovery: 사라지는 외곽선
    g.lineStyle(1, RED, 0.35 * (1 - atk.phaseProgress));
    tracePolygon(g, outline);
    g.strokePath();
  }

  private dashed(points: Vec2[], width: number, alpha: number): void {
    const g = this.ground;
    g.lineStyle(width, RED, alpha);
    for (const [a, b] of dashPolyline(points, DASH, GAP, true)) g.lineBetween(a.x, a.y, b.x, b.y);
  }

  // ───────────────────────── 보스 ─────────────────────────

  /** 공중에 있을 때만 바닥 그림자 (높을수록 작고 옅게) */
  private drawShadow(m: BossModel): void {
    if (m.z <= 0) return;
    const k = Math.max(0.4, 1 - m.z / 200);
    this.ground.fillStyle(BLACK, 0.25 * k);
    this.ground.fillEllipse(m.x, m.y, this.radius * 2 * k, this.radius * 1.1 * k);
  }

  /**
   * 육각형 몸체. 높이(z)만큼 위로 올려 그리고 살짝 크게 → 뛰어오른 느낌 (2.5D)
   *  - 숨 고르기(큰 빈틈)·자세 붕괴 중: 회색 → 지금이 공격 기회라는 신호
   *  - 자세 붕괴: 굵은 테두리가 깜빡임
   *  - 움찔(패링당함): 바라보는 반대쪽으로 살짝 밀려 보임
   *  - 맞은 순간: 흰 테두리가 번쩍
   *  - 쓰러짐: 속이 빈 육각형
   */
  private drawBody(m: BossModel): void {
    const g = this.body;
    const scale = 1 + m.z / 400;
    const r = this.radius * scale;
    let cx = m.x;
    let cy = m.y - m.z;
    if (m.state === 'flinch') {
      cx -= Math.cos(m.facing) * 4;
      cy -= Math.sin(m.facing) * 4;
    }

    const hex: Vec2[] = Array.from({ length: 6 }, (_, i) => {
      const a = m.facing + (i / 6) * Math.PI * 2;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
    });

    if (m.isDead) {
      g.lineStyle(2, BLACK, 0.6);
      tracePolygon(g, hex);
      g.strokePath();
      return;
    }

    g.fillStyle(m.isResting || m.isStaggered ? REST_GREY : BLACK, 1);
    tracePolygon(g, hex);
    g.fillPath();

    if (m.isStaggered && Math.floor(Date.now() / 150) % 2 === 0) {
      g.lineStyle(5, BLACK, 1);
      tracePolygon(g, hex);
      g.strokePath();
    }
    if (m.hitFlashMs > 0) {
      g.lineStyle(4, WHITE, 1);
      tracePolygon(g, hex);
      g.strokePath();
    }

    // 바라보는 방향: 흰 삼각형
    const f = m.facing;
    const tip = { x: cx + Math.cos(f) * r * 0.75, y: cy + Math.sin(f) * r * 0.75 };
    const left = { x: cx + Math.cos(f + 2.5) * r * 0.3, y: cy + Math.sin(f + 2.5) * r * 0.3 };
    const right = { x: cx + Math.cos(f - 2.5) * r * 0.3, y: cy + Math.sin(f - 2.5) * r * 0.3 };
    g.fillStyle(WHITE, 1);
    g.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
  }
}

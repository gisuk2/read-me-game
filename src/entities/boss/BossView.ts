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
/** 무기 날 길이 */
const WEAPON_LEN = 58;

/**
 * 보스와 공격 범위를 그린다 (로직 없음).
 *
 * 몸짓 규칙 (바닥 예고 없이도 읽히도록)
 *  - 무기: 패턴마다 다른 준비 자세 (휘두르기 = 뒤로 젖힘, 찌르기 = 뒤로 당김, 회전 = 감아 돌림, 내려찍기 = 치켜듦)
 *  - 연속 베기는 타마다 젖히는 방향이 좌우로 바뀜
 *  - 강패턴(패링 불가)은 준비 중 무기가 붉게 빛남
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
    this.drawWeapon(m);
    this.drawBody(m);
  }

  // ───────────────────────── 공격 범위 ─────────────────────────

  private drawAttack(m: BossModel): void {
    const atk = m.attack;
    if (!atk) return;
    const g = this.ground;
    const outline = shapeOutline(atk.shape);

    if (atk.phase === 'telegraph') {
      // 조준을 따라오는 동안은 가늘고 옅게, 고정되면 굵고 진하게 → "이제 움직여도 된다"는 신호
      const width = atk.locked ? 2.5 : 1.5;
      const alpha = atk.locked ? 1 : 0.55;
      g.fillStyle(RED, (0.04 + 0.14 * atk.phaseProgress) * (atk.locked ? 1 : 0.6));
      tracePolygon(g, outline);
      g.fillPath();
      this.dashed(outline, width, alpha);
      if (!atk.parryable) this.dashed(shapeOutline(expandShape(atk.shape, DOUBLE_LINE_OFFSET)), width, alpha);
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

  // ───────────────────────── 무기 ─────────────────────────

  /**
   * 무기 = 몸 가장자리에서 뻗은 굵은 선.
   * 각도(wa)와 손 위치(hand: 중심에서의 거리), 날 길이(len)를 상태별로 정한다.
   */
  private drawWeapon(m: BossModel): void {
    if (m.isDead) return;
    const r = this.radius;
    const cx = m.x;
    const cy = m.y - m.z;
    const atk = m.attack;
    let wa = m.facing + 1.1;
    let hand = r * 0.75;
    let len = WEAPON_LEN;
    let glow = false;

    if (m.state === 'flinch') wa = m.facing + 2.3;
    if (m.isStaggered) wa = m.facing + Math.PI * 0.8;

    if (atk) {
      const p = atk.pattern;
      const t = atk.phaseProgress;
      const e = 1 - (1 - t) * (1 - t); // 처음엔 빠르게, 끝에서 천천히 (준비 동작이 점점 무거워짐)
      glow = !atk.parryable && atk.phase === 'telegraph';
      const aim = atk.shape.kind === 'sector' || atk.shape.kind === 'rect' ? atk.shape.angle : m.facing;

      if (p.shape === 'sector') {
        const side = atk.step % 2 === 0 ? 1 : -1;
        const half = (p.arcDeg * Math.PI) / 360;
        const back = half + 0.5;
        if (atk.phase === 'telegraph') wa = aim + side * (half * 0.6 + 0.5 * e + 0.2);
        else if (atk.phase === 'active') wa = aim + side * back - side * (back + half) * t;
        else wa = aim - side * half;
      } else if (p.shape === 'rect') {
        wa = aim;
        if (atk.phase === 'telegraph') hand = r * 0.75 - 30 * e;
        else if (atk.phase === 'active') { hand = r * 0.75 + 25; len = WEAPON_LEN + 25; }
      } else if (p.anchor === 'self') {
        if (atk.phase === 'telegraph') wa = m.facing + 1.1 + 1.6 * e;
        else if (atk.phase === 'active') wa = m.facing + 2.7 + Math.PI * 2 * t;
        else wa = m.facing + 2.7;
      } else {
        // 점프 내려찍기: 공중에서는 치켜들고(화면 위쪽), 착지하면 앞으로 내려놓음
        if (atk.phase === 'telegraph') { wa = -Math.PI / 2; hand = r * 0.6; }
        else { wa = m.facing; len = WEAPON_LEN + 10; }
      }
    }

    const hx = cx + Math.cos(wa) * hand;
    const hy = cy + Math.sin(wa) * hand;
    const tx = hx + Math.cos(wa) * len;
    const ty = hy + Math.sin(wa) * len;
    const g = this.body;
    if (glow) {
      g.lineStyle(14, RED, 0.25);
      g.lineBetween(hx, hy, tx, ty);
    }
    g.lineStyle(6, glow ? RED : m.isStaggered ? REST_GREY : BLACK, 1);
    g.lineBetween(hx, hy, tx, ty);
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

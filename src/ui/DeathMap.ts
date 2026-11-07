import type { Bounds } from '../entities/player/PlayerModel';
import type { DeathRecord } from '../run/Telemetry';

/** 지도에 궤적까지 그리는 최근 사망 수 (너무 많으면 지저분해짐) */
const MAX_TRAILS = 30;

/**
 * 사망 지도를 캔버스에 그린다 (HTML 캔버스, Phaser와 무관).
 *  - 경기장 테두리
 *  - 이전 사망: 회색 X + 옅은 직전 움직임
 *  - 이번 사망: 빨간 큰 X + 진한 직전 움직임 + 끝에 화살표
 */
export function drawDeathMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  arena: Bounds,
  deaths: readonly DeathRecord[],
  latestIndex: number | null,
): void {
  const sx = width / arena.width;
  const sy = height / arena.height;
  const px = (x: number) => x * sx;
  const py = (y: number) => y * sy;
  const unit = Math.max(1, width / 300); // 크게 보기에서 선·표시를 키움

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // 3×3 구역 보조선
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo((width * i) / 3, 0);
    ctx.lineTo((width * i) / 3, height);
    ctx.moveTo(0, (height * i) / 3);
    ctx.lineTo(width, (height * i) / 3);
    ctx.stroke();
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, width - 1.5, height - 1.5);

  const trailFrom = Math.max(0, deaths.length - MAX_TRAILS);
  deaths.forEach((d, i) => {
    if (i === latestIndex) return; // 이번 사망은 마지막에 위에 그림
    if (i >= trailFrom) drawTrail(ctx, d, px, py, 'rgba(0,0,0,0.15)', unit, false);
    drawX(ctx, px(d.x), py(d.y), 3.5 * unit, 'rgba(0,0,0,0.45)', 1.5 * unit);
  });

  if (latestIndex !== null && deaths[latestIndex]) {
    const d = deaths[latestIndex];
    drawTrail(ctx, d, px, py, 'rgba(0,0,0,0.8)', unit, true);
    drawX(ctx, px(d.x), py(d.y), 6 * unit, '#d62828', 2.5 * unit);
  }
}

function drawX(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  d: DeathRecord,
  px: (x: number) => number,
  py: (y: number) => number,
  color: string,
  unit: number,
  arrow: boolean,
): void {
  const pts = [...d.trail, { x: d.x, y: d.y }];
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * unit;
  ctx.beginPath();
  ctx.moveTo(px(pts[0].x), py(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i].x), py(pts[i].y));
  ctx.stroke();
  if (!arrow) return;

  // 마지막으로 움직인 방향에 화살촉
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  const ang = Math.atan2(py(b.y) - py(a.y), px(b.x) - px(a.x));
  if (!Number.isFinite(ang) || (a.x === b.x && a.y === b.y)) return;
  const L = 6 * unit;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px(b.x), py(b.y));
  ctx.lineTo(px(b.x) - Math.cos(ang - 0.45) * L, py(b.y) - Math.sin(ang - 0.45) * L);
  ctx.lineTo(px(b.x) - Math.cos(ang + 0.45) * L, py(b.y) - Math.sin(ang + 0.45) * L);
  ctx.closePath();
  ctx.fill();
}

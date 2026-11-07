import Phaser from 'phaser';
import type { Projectile } from '../combat/Projectiles';

const BLACK = 0x000000;
const WHITE = 0xffffff;
const RED = 0xd62828;

/**
 * 날아가는 물체 그리기.
 *  - 보스의 탄: 검은 원 + 꼬리 (패링 가능)
 *  - 튕겨낸 탄: 흰 원 + 검은 테두리 (내 것)
 *  - 충격파: 진행 방향에 수직인 붉은 막대 (패링 불가 = 빨강)
 */
export class ProjectileView {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(1.5);
  }

  draw(list: readonly Projectile[]): void {
    const g = this.g;
    g.clear();
    for (const p of list) {
      const speed = Math.hypot(p.vx, p.vy) || 1;
      const ux = p.vx / speed;
      const uy = p.vy / speed;

      if (p.kind === 'wave') {
        // 진행 방향에 수직인 막대 (폭 = 지름)
        const hx = -uy * p.radius;
        const hy = ux * p.radius;
        const t = 7;
        const pts = [
          { x: p.x + hx - ux * t, y: p.y + hy - uy * t },
          { x: p.x + hx + ux * t, y: p.y + hy + uy * t },
          { x: p.x - hx + ux * t, y: p.y - hy + uy * t },
          { x: p.x - hx - ux * t, y: p.y - hy - uy * t },
        ];
        g.fillStyle(RED, 0.55);
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.lineStyle(2, RED, 1);
        g.strokePath();
        continue;
      }

      // 탄: 꼬리 + 몸
      g.lineStyle(2, BLACK, 0.35);
      g.lineBetween(p.x, p.y, p.x - ux * 22, p.y - uy * 22);
      if (p.owner === 'player') {
        g.fillStyle(WHITE, 1);
        g.fillCircle(p.x, p.y, p.radius);
        g.lineStyle(2, BLACK, 1);
        g.strokeCircle(p.x, p.y, p.radius);
      } else {
        g.fillStyle(BLACK, 1);
        g.fillCircle(p.x, p.y, p.radius);
      }
    }
  }
}

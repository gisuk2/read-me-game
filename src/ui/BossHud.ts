import Phaser from 'phaser';
import type { BossConfig } from '../config/bossBalance';
import type { BossModel } from '../entities/boss/BossModel';

const BLACK = 0x000000;
const WHITE = 0xffffff;
const POSTURE_COLOR = 0x555555;

const BAR_W = 520;
const HP_H = 10;
const POSTURE_H = 6;

/**
 * 화면 아래 중앙: 보스 이름, 체력 바, 그 위의 자세 게이지.
 * 자세 게이지는 가운데에서 양쪽으로 차오른다 (가득 차면 자세 붕괴).
 */
export class BossHud {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly x: number;
  private readonly hpY: number;
  private readonly postureY: number;

  constructor(
    scene: Phaser.Scene,
    private readonly cfg: BossConfig,
  ) {
    const { width, height } = scene.scale;
    this.x = (width - BAR_W) / 2;
    this.hpY = height - 34;
    this.postureY = this.hpY - 12;
    this.g = scene.add.graphics().setDepth(10);
    scene.add
      .text(this.x, this.postureY - 20, cfg.name, { color: '#000000', fontSize: '13px' })
      .setDepth(10);
  }

  update(boss: BossModel): void {
    const g = this.g;
    g.clear();

    // 체력
    const hpRatio = Math.max(0, boss.hp / this.cfg.maxHp);
    g.fillStyle(WHITE, 1);
    g.fillRect(this.x, this.hpY, BAR_W, HP_H);
    g.fillStyle(BLACK, 1);
    g.fillRect(this.x, this.hpY, BAR_W * hpRatio, HP_H);
    g.lineStyle(1.5, BLACK, 1);
    g.strokeRect(this.x, this.hpY, BAR_W, HP_H);

    // 자세 게이지 (가운데에서 양쪽으로)
    const postureRatio = Math.min(1, boss.posture / this.cfg.posture.max);
    if (postureRatio > 0) {
      const half = (BAR_W * postureRatio) / 2;
      const mid = this.x + BAR_W / 2;
      const nearFull = postureRatio > 0.8 && !boss.isStaggered;
      g.fillStyle(boss.isStaggered ? BLACK : POSTURE_COLOR, nearFull && Math.floor(Date.now() / 120) % 2 === 0 ? 0.5 : 1);
      g.fillRect(mid - half, this.postureY, half * 2, POSTURE_H);
    }
    g.lineStyle(1, BLACK, 0.4);
    g.strokeRect(this.x, this.postureY, BAR_W, POSTURE_H);
  }
}

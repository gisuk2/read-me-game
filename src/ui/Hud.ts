import Phaser from 'phaser';
import type { PlayerConfig } from '../config/balance';
import type { PlayerEvent, PlayerModel } from '../entities/player/PlayerModel';

const BLACK = 0x000000;
const WHITE = 0xffffff;
const STAMINA_COLOR = 0x888888;

const X = 16;
const ST_Y = 16;
const ST_W = 220;
const ST_H = 10;

/** 스태미나 부족으로 행동이 막혔을 때 스태미나 바가 깜빡이는 시간 */
const DENIED_FLASH_MS = 400;

/**
 * 화면 왼쪽 위 HUD: 스태미나 바.
 * 한 방 사망이라 체력 바는 없다 (docs/design/learning-feedback.md §5.1).
 */
export class Hud {
  private readonly g: Phaser.GameObjects.Graphics;
  private flashMs = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly cfg: PlayerConfig,
  ) {
    this.g = scene.add.graphics();
    this.g.setDepth(10); // 다른 그림보다 위에
  }

  update(p: PlayerModel, events: readonly PlayerEvent[], dtMs: number): void {
    if (events.some((e) => e.type === 'staminaDenied')) this.flashMs = DENIED_FLASH_MS;
    this.flashMs = Math.max(0, this.flashMs - dtMs);
    this.draw(p);
  }

  private draw(p: PlayerModel): void {
    const g = this.g;
    g.clear();

    // 스태미나 (부족 경고 시 테두리가 굵게 깜빡임)
    const blinkOn = this.flashMs > 0 && Math.floor(this.flashMs / 100) % 2 === 0;
    this.bar(ST_Y, ST_W, ST_H, p.stamina / this.cfg.maxStamina, STAMINA_COLOR, blinkOn ? 3 : 1);

  }

  private bar(y: number, width: number, height: number, ratio: number, color: number, outline: number): void {
    const g = this.g;
    const filled = Math.max(0, Math.min(1, ratio)) * width;
    g.fillStyle(WHITE, 1);
    g.fillRect(X, y, width, height);
    g.fillStyle(color, 1);
    g.fillRect(X, y, filled, height);
    g.lineStyle(outline, BLACK, 1);
    g.strokeRect(X, y, width, height);
  }
}

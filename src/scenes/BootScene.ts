import Phaser from 'phaser';
import { clamp } from '../utils/math';

const PLAYER_SIZE = 24;
const PLAYER_SPEED = 220; // 초당 픽셀

/**
 * M0 세팅 확인용 씬.
 * 흰 배경 위의 검은 사각형을 WASD로 움직인다. 게임 로직은 M1에서 시작한다.
 */
export class BootScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private keys!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

  constructor() {
    super('BootScene');
  }

  // 씬이 시작될 때 한 번 호출된다.
  create(): void {
    const { width, height } = this.scale;

    this.player = this.add.rectangle(width / 2, height / 2, PLAYER_SIZE, PLAYER_SIZE, 0x000000);

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error('키보드 입력을 사용할 수 없습니다.');
    }
    this.keys = keyboard.addKeys('W,A,S,D') as Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;

    this.add.text(16, 16, 'M0 세팅 확인: WASD로 이동', { color: '#000000', fontSize: '16px' });
  }

  // 매 프레임 호출된다. delta = 이전 프레임으로부터 지난 시간(ms).
  update(_time: number, delta: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.A.isDown) dx -= 1;
    if (this.keys.D.isDown) dx += 1;
    if (this.keys.W.isDown) dy -= 1;
    if (this.keys.S.isDown) dy += 1;

    // 대각선 이동이 더 빨라지지 않도록 방향 벡터를 정규화한다.
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      dx /= length;
      dy /= length;
    }

    // 프레임 속도와 무관하게 같은 속도로 움직이도록 delta(초)를 곱한다.
    const step = PLAYER_SPEED * (delta / 1000);
    const half = PLAYER_SIZE / 2;
    const { width, height } = this.scale;

    this.player.x = clamp(this.player.x + dx * step, half, width - half);
    this.player.y = clamp(this.player.y + dy * step, half, height - half);
  }
}

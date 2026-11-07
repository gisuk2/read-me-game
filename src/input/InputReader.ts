import Phaser from 'phaser';
import { ClickQueue } from './ClickQueue';
import type { PlayerInput } from './types';

type KeyName = 'W' | 'A' | 'S' | 'D' | 'SPACE' | 'Q';
const KEY_NAMES: KeyName[] = ['W', 'A', 'S', 'D', 'SPACE', 'Q'];

/**
 * 키보드·마우스 상태를 매 프레임 PlayerInput 하나로 변환한다.
 *
 * - 이동(WASD): 누르고 있는 동안 계속 반영
 * - 대시(Space)·포션(Q): JustDown → "눌린 그 프레임"에만 true
 * - 공격(좌클릭)·패링(우클릭): pointerdown 이벤트로 ClickQueue에 쌓았다가 다음 read()에서 한 번만 전달
 * - 공격 꾹 누르기: 좌클릭을 누르고 있는 동안 attackHeld = true
 */
export class InputReader {
  private readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private readonly clicks = new ClickQueue();

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');
    this.keys = keyboard.addKeys(KEY_NAMES.join(',')) as Record<KeyName, Phaser.Input.Keyboard.Key>;

    // 우클릭을 패링에 쓰므로 브라우저 우클릭 메뉴를 끈다.
    scene.input.mouse?.disableContextMenu();

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.clicks.pushParry();
      else if (pointer.leftButtonDown()) this.clicks.pushAttack();
    });
  }

  /** 플레이어 위치를 받아 마우스 방향(조준 각도)을 계산한다. */
  read(playerX: number, playerY: number): PlayerInput {
    const pointer = this.scene.input.activePointer;
    const k = this.keys;
    const clicks = this.clicks.take();
    return {
      moveX: (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0),
      moveY: (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0),
      aimAngle: Math.atan2(pointer.worldY - playerY, pointer.worldX - playerX),
      attack: clicks.attack,
      attackHeld: pointer.leftButtonDown(),
      parry: clicks.parry,
      dash: Phaser.Input.Keyboard.JustDown(k.SPACE),
      potion: Phaser.Input.Keyboard.JustDown(k.Q),
    };
  }

  /**
   * 일시정지에서 돌아올 때 호출: 멈춰 있는 동안 쌓인 클릭과 "눌린 순간" 기록을 버린다.
   * (메뉴 버튼 클릭이 공격으로, 일시정지 중 누른 Q가 포션으로 나가지 않도록)
   */
  reset(): void {
    this.clicks.clear();
    for (const name of KEY_NAMES) Phaser.Input.Keyboard.JustDown(this.keys[name]);
  }
}

import Phaser from 'phaser';
import type { PlayerInput } from './types';

type KeyName = 'W' | 'A' | 'S' | 'D' | 'SPACE' | 'Q';

/**
 * 키보드·마우스 상태를 매 프레임 PlayerInput 하나로 변환한다.
 *
 * - 이동(WASD): 누르고 있는 동안 계속 반영
 * - 대시(Space)·포션(Q): JustDown → "눌린 그 프레임"에만 true
 * - 공격(좌클릭)·패링(우클릭): pointerdown 이벤트로 받아 두었다가 다음 read()에서 한 번만 전달
 * - 공격 꾹 누르기: 좌클릭을 누르고 있는 동안 attackHeld = true
 */
export class InputReader {
  private readonly keys: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private attackQueued = false;
  private parryQueued = false;

  constructor(private readonly scene: Phaser.Scene) {
    const keyboard = scene.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');
    this.keys = keyboard.addKeys('W,A,S,D,SPACE,Q') as Record<KeyName, Phaser.Input.Keyboard.Key>;

    // 우클릭을 패링에 쓰므로 브라우저 우클릭 메뉴를 끈다.
    scene.input.mouse?.disableContextMenu();

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) this.parryQueued = true;
      else if (pointer.leftButtonDown()) this.attackQueued = true;
    });
  }

  /** 플레이어 위치를 받아 마우스 방향(조준 각도)을 계산한다. */
  read(playerX: number, playerY: number): PlayerInput {
    const pointer = this.scene.input.activePointer;
    const k = this.keys;
    const input: PlayerInput = {
      moveX: (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0),
      moveY: (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0),
      aimAngle: Math.atan2(pointer.worldY - playerY, pointer.worldX - playerX),
      attack: this.attackQueued,
      attackHeld: pointer.leftButtonDown(),
      parry: this.parryQueued,
      dash: Phaser.Input.Keyboard.JustDown(k.SPACE),
      potion: Phaser.Input.Keyboard.JustDown(k.Q),
    };
    this.attackQueued = false;
    this.parryQueued = false;
    return input;
  }
}

import Phaser from 'phaser';
import { PLAYER } from '../config/balance';
import { PlayerModel } from '../entities/player/PlayerModel';
import { PlayerView } from '../entities/player/PlayerView';
import { InputReader } from '../input/InputReader';
import { Hud } from '../ui/Hud';

/** 프레임이 크게 밀렸을 때(탭 전환 등) 한 번에 너무 많이 진행되지 않도록 제한 */
const MAX_DT_MS = 50;

/**
 * 게임 씬. 매 프레임: 입력 읽기 → 모델 갱신 → 화면 그리기
 */
export class GameScene extends Phaser.Scene {
  private player!: PlayerModel;
  private playerView!: PlayerView;
  private inputReader!: InputReader;
  private hud!: Hud;
  private debugText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width, height } = this.scale;

    this.player = new PlayerModel(width / 2, height / 2, { width, height });
    this.playerView = new PlayerView(this, PLAYER.radius);
    this.inputReader = new InputReader(this);
    this.hud = new Hud(this, PLAYER);

    this.add.text(16, height - 28, 'WASD 이동 · 마우스 조준 · 좌클릭 공격(꾹 누르면 연속) · 우클릭 패링 · Space 대시 · Q 포션', {
      color: '#000000',
      fontSize: '14px',
    });
    this.debugText = this.add.text(16, 70, '', { color: '#777777', fontSize: '12px' });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, MAX_DT_MS);
    const input = this.inputReader.read(this.player.x, this.player.y);
    const events = this.player.update(input, dt);
    this.playerView.draw(this.player);
    this.hud.update(this.player, events, dt);
    this.debugText.setText(this.describePlayer());
  }

  /** 개발용 상태 표시 */
  private describePlayer(): string {
    const p = this.player;
    const atk = p.attack;
    let state: string = p.state;
    if (atk) state = `attack ${atk.comboIndex + 1}타 (${atk.phase})${atk.canDashCancel ? ' [캔슬 가능]' : ''}`;
    return `${state}${p.isInvulnerable ? ' [무적]' : ''}${p.isParryActive ? ' [패링]' : ''}`;
  }
}

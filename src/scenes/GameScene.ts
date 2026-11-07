import Phaser from 'phaser';
import { PLAYER } from '../config/balance';
import { BOSS } from '../config/bossBalance';
import { CombatSystem, separation, type CombatEvent } from '../combat/CombatSystem';
import { BossModel } from '../entities/boss/BossModel';
import { BossView } from '../entities/boss/BossView';
import { PlayerModel, type PlayerEvent } from '../entities/player/PlayerModel';
import { PlayerView } from '../entities/player/PlayerView';
import { InputReader } from '../input/InputReader';
import { BossHud } from '../ui/BossHud';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { ResultScreen } from '../ui/ResultScreen';

/** 프레임이 크게 밀렸을 때(탭 전환 등) 한 번에 너무 많이 진행되지 않도록 제한 */
const MAX_DT_MS = 50;

/** 타격감: 이벤트별 멈춤(히트스톱) 시간과 화면 흔들림 */
const FEEDBACK = {
  playerHitBoss: { hitstopMs: 60, shakeMs: 0, shake: 0 },
  playerParried: { hitstopMs: 130, shakeMs: 120, shake: 0.006 },
  bossHitPlayer: { hitstopMs: 90, shakeMs: 220, shake: 0.012 },
  bossStaggered: { hitstopMs: 160, shakeMs: 250, shake: 0.01 },
} as const;

/** 쓰러진 뒤 결과 화면이 뜨기까지 (마지막 장면을 잠깐 보여줌) */
const RESULT_DELAY_MS = 900;

const WATCH_LABEL = { stare: '노려보기', strafeLeft: '왼쪽으로 돌기', strafeRight: '오른쪽으로 돌기' } as const;

/**
 * 게임 씬. 매 프레임:
 *   입력 읽기 → 플레이어 갱신 → 보스 갱신 → 전투 판정 → 몸 겹침 밀어내기 → 타격감 → 그리기
 */
export class GameScene extends Phaser.Scene {
  private player!: PlayerModel;
  private playerView!: PlayerView;
  private boss!: BossModel;
  private bossView!: BossView;
  private combat!: CombatSystem;
  private inputReader!: InputReader;
  private hud!: Hud;
  private bossHud!: BossHud;
  private pauseMenu!: PauseMenu;
  private resultScreen!: ResultScreen;
  private debugText!: Phaser.GameObjects.Text;
  private escKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;

  private paused = false;
  private hitstopMs = 0;
  /** 승패가 정해진 뒤 결과 화면까지 남은 시간. null이면 진행 중 */
  private resultCountdownMs: number | null = null;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width, height } = this.scale;
    const bounds = { width, height };
    this.paused = false;
    this.hitstopMs = 0;
    this.resultCountdownMs = null;

    this.player = new PlayerModel(width / 2, height - 150, bounds);
    this.boss = new BossModel(width / 2, 140, bounds);
    this.combat = new CombatSystem({ bossHittableMaxZ: BOSS.hittableMaxZ });
    this.bossView = new BossView(this, BOSS.radius);
    this.playerView = new PlayerView(this, PLAYER.radius);
    this.inputReader = new InputReader(this);
    this.hud = new Hud(this, PLAYER);
    this.bossHud = new BossHud(this, BOSS);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');
    this.escKey = keyboard.addKey('ESC');
    this.restartKey = keyboard.addKey('R');

    this.pauseMenu = new PauseMenu({
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
      onRestart: () => this.restart(),
    });
    this.resultScreen = new ResultScreen(() => this.restart());
    // 씬이 재시작·종료될 때 HTML 버튼 연결을 풀어 중복 연결을 막는다
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pauseMenu.destroy();
      this.resultScreen.destroy();
    });

    this.add.text(width - 16, 52, 'ESC 일시정지 · R 재시작', { color: '#999999', fontSize: '12px' }).setOrigin(1, 0);
    this.debugText = this.add.text(16, 70, '', { color: '#777777', fontSize: '12px' });
  }

  update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.restart();
      return;
    }
    const gameOver = this.resultCountdownMs !== null;
    if (!gameOver && Phaser.Input.Keyboard.JustDown(this.escKey)) this.setPaused(!this.paused);
    if (this.paused) return;

    const dt = Math.min(delta, MAX_DT_MS);

    // 히트스톱: 잠깐 시간을 멈춰 타격감을 준다 (그리기는 계속)
    if (this.hitstopMs > 0) {
      this.hitstopMs -= dt;
      this.draw([], dt);
      return;
    }

    const input = this.inputReader.read(this.player.x, this.player.y);
    const playerEvents = this.player.update(input, dt);
    this.boss.update({ x: this.player.x, y: this.player.y }, dt);

    const combatEvents = this.combat.resolve(this.player, this.boss);
    this.pushPlayerOutOfBoss();
    this.applyFeedback(combatEvents);
    this.checkResult(combatEvents, dt);

    this.draw(playerEvents, dt);
  }

  private draw(playerEvents: PlayerEvent[], dt: number): void {
    this.bossView.draw(this.boss);
    this.playerView.draw(this.player);
    this.hud.update(this.player, playerEvents, dt);
    this.bossHud.update(this.boss);
    this.debugText.setText(`${this.describePlayer()}\n${this.describeBoss()}`);
  }

  /** 플레이어가 보스 몸을 통과하지 못하게 (점프 중·쓰러진 보스는 제외) */
  private pushPlayerOutOfBoss(): void {
    if (this.boss.isDead || this.boss.z > BOSS.hittableMaxZ) return;
    const push = separation(this.player.x, this.player.y, PLAYER.radius, this.boss.x, this.boss.y, BOSS.radius);
    if (push.dx !== 0 || push.dy !== 0) this.player.nudge(push.dx, push.dy);
  }

  private applyFeedback(events: CombatEvent[]): void {
    for (const e of events) {
      if (e.type === 'playerHitBoss' || e.type === 'playerParried' || e.type === 'bossHitPlayer' || e.type === 'bossStaggered') {
        const f = FEEDBACK[e.type];
        this.hitstopMs = Math.max(this.hitstopMs, f.hitstopMs);
        if (f.shakeMs > 0) this.cameras.main.shake(f.shakeMs, f.shake);
      }
    }
  }

  private checkResult(events: CombatEvent[], dt: number): void {
    if (this.resultCountdownMs === null) {
      if (events.some((e) => e.type === 'playerDied' || e.type === 'bossDied')) this.resultCountdownMs = RESULT_DELAY_MS;
      return;
    }
    this.resultCountdownMs -= dt;
    if (this.resultCountdownMs <= 0) {
      if (this.player.isDead) this.resultScreen.showDefeat();
      else this.resultScreen.showVictory();
      this.paused = true; // 결과 화면에서는 진행 멈춤 (R 또는 버튼으로 재시작)
    }
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.pauseMenu.show();
    } else {
      this.pauseMenu.hide();
      this.inputReader.reset(); // 메뉴 클릭이 공격으로 새어 들어가지 않도록
    }
  }

  private restart(): void {
    this.scene.restart();
  }

  /** 개발용 상태 표시 */
  private describePlayer(): string {
    const p = this.player;
    const atk = p.attack;
    let state: string = p.state;
    if (atk) {
      const name = atk.kind === 'dash' ? '대시 찌르기' : `${atk.comboIndex + 1}타`;
      state = `attack ${name} (${atk.phase})${atk.canDashCancel ? ' [캔슬 가능]' : ''}`;
    }
    return `플레이어: ${state}${p.isInvulnerable ? ' [무적]' : ''}${p.isParryActive ? ' [패링]' : ''}`;
  }

  private describeBoss(): string {
    const b = this.boss;
    const hp = `HP ${Math.round(b.hp)} · 자세 ${Math.round(b.posture)}`;
    const atk = b.attack;
    if (atk) {
      const step = atk.stepCount > 1 ? ` ${atk.step + 1}/${atk.stepCount}타` : '';
      const lock = atk.phase === 'telegraph' ? (atk.locked ? ' 고정' : ' 추적') : '';
      return `보스: ${atk.pattern.name}${step} (${atk.phase}${lock})${atk.parryable ? '' : ' [패링 불가]'} · ${hp}`;
    }
    const watch = b.currentWatchMode;
    if (watch) return `보스: 관찰 (${WATCH_LABEL[watch]}) · ${hp}`;
    const planned = b.plannedPattern ? ` → ${b.plannedPattern.name} 준비` : '';
    return `보스: ${b.state}${planned} · ${hp}`;
  }
}

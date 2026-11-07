import Phaser from 'phaser';
import { PLAYER } from '../config/balance';
import { BOSS, WEAPON_NAME, isParryable, type BossPatternId } from '../config/bossBalance';
import { HELPER_ANSWERS, HELPER_HINTS, HELPER_INTRO, WEAPON_ORDER } from '../data/helperBriefing';
import { HintTracker } from '../run/HintTracker';
import { WEAPON_ICONS } from '../ui/WeaponIcons';
import { CombatSystem, separation, type CombatEvent } from '../combat/CombatSystem';
import { PROJECTILE_RULES as PROJECTILE_RULES_DEFAULT, ProjectileSystem } from '../combat/Projectiles';
import { ProjectileView } from '../entities/ProjectileView';
import { BossModel, type BossEvent } from '../entities/boss/BossModel';
import { BossView } from '../entities/boss/BossView';
import { PlayerModel, type PlayerEvent } from '../entities/player/PlayerModel';
import { PlayerView } from '../entities/player/PlayerView';
import { InputReader } from '../input/InputReader';
import { CheckpointTracker, type RunMode } from '../run/Checkpoint';
import { ReviveCounter } from '../run/Revive';
import { Telemetry, browserStorage, type DeathRecord } from '../run/Telemetry';
import { TrailRecorder } from '../run/TrailRecorder';
import { BossHud } from '../ui/BossHud';
import { Briefing, type WeaponCard } from '../ui/Briefing';
import { Hud } from '../ui/Hud';
import { PauseMenu } from '../ui/PauseMenu';
import { ResultScreen } from '../ui/ResultScreen';
import { restoreSnapshot, takeSnapshot, type Snapshot } from '../utils/snapshot';

/** 프레임이 크게 밀렸을 때(탭 전환 등) 한 번에 너무 많이 진행되지 않도록 제한 */
const MAX_DT_MS = 50;

/** 타격감: 이벤트별 멈춤(히트스톱) 시간과 화면 흔들림 */
const FEEDBACK = {
  playerHitBoss: { hitstopMs: 60, shakeMs: 0, shake: 0 },
  playerParried: { hitstopMs: 130, shakeMs: 120, shake: 0.006 },
  bossHitPlayer: { hitstopMs: 90, shakeMs: 220, shake: 0.012 },
  bossStaggered: { hitstopMs: 160, shakeMs: 250, shake: 0.01 },
} as const;

/** 쓰러진 뒤 되감기까지 (마지막 장면을 잠깐 멈춰 보여줌). 카타나 제로처럼 짧게 */
const REVIVE_DELAY_MS = 450;
/** 다섯 번째 사망·보스 격파 뒤 결과 화면까지 */
const RESULT_DELAY_MS = 700;
/** 처음 보는 패턴 안내: 이만큼(실제 시간) 느려지고, 그동안 게임은 이 배율로 흐른다 */
const HINT_SLOW_MS = 700;
const HINT_SLOW_SCALE = 0.3;
/** 헬퍼 말풍선이 떠 있는 시간 */
const HINT_BUBBLE_MS = 2400;
/** 같은 구간에서 이만큼 죽으면 체크포인트로 */
const MAX_DEATHS = 5;
/** 모델 스냅샷에서 복사하지 않는 필드 (바뀌지 않는 설정) */
const KEEP_REFS = ['cfg', 'bounds'] as const;
/** 화면 위쪽 알림 글자가 떠 있는 시간 */
const TOAST_MS = 1600;
const CHECKPOINT_STAGES = 5;

const WATCH_LABEL = { stare: '노려보기', strafeLeft: '왼쪽으로 돌기', strafeRight: '오른쪽으로 돌기' } as const;
const MODE_LABEL: Record<RunMode, string> = { tutorial: '튜토리얼 (처음부터)', checkpoint: '체크포인트' };

/**
 * 씬이 재시작되어도 남아야 하는 것 (한 판이 아니라 "시뮬레이션 접속" 단위).
 *  - 사망·관측 기록: 브라우저에 저장 (껐다 켜도 유지)
 *  - 체크포인트·모드: 이번 접속 동안만
 */
const telemetry = new Telemetry(browserStorage('read-me-game.telemetry.v1'));
const session: {
  mode: RunMode;
  checkpoint: CheckpointTracker;
  revive: ReviveCounter;
  briefed: boolean;
  hints: HintTracker<BossPatternId>;
} = {
  mode: 'checkpoint',
  checkpoint: new CheckpointTracker(CHECKPOINT_STAGES),
  revive: new ReviveCounter(MAX_DEATHS),
  briefed: false,
  hints: new HintTracker<BossPatternId>(),
};

/** 무기별 그림 카드 데이터 (패턴 설정에서 만든다) */
const weaponCards = (): WeaponCard[] =>
  WEAPON_ORDER.map((w) => ({
    weapon: w,
    weaponName: WEAPON_NAME[w],
    iconSvg: WEAPON_ICONS[w],
    patterns: BOSS.patterns
      .filter((p) => p.weapon === w)
      .map((p) => ({ id: p.id, name: p.name, parryable: isParryable(p), answers: HELPER_ANSWERS[p.id] })),
  })).filter((c) => c.patterns.length > 0);

/** 쓰러진 뒤 무엇을 기다리는 중인가 */
type Pending = { kind: 'revive' | 'result'; ms: number };

/**
 * 게임 씬. 매 프레임:
 *   입력 읽기 → 플레이어 갱신 → 보스 갱신 → 전투 판정 → 몸 겹침 밀어내기 → 기록(되감기 지점·체크포인트·사망) → 타격감 → 그리기
 *
 * 죽음 처리 (docs/design/learning-feedback.md §5):
 *   쓰러짐 → 잠깐 멈춤 + 사망 원인 표시 → 직전 패턴이 시작되기 전으로 되감기 (빠른 부활)
 *   같은 구간에서 5번째 → 사망 지도 → 체크포인트(보스 체력 단계)에서 다시
 */
export class GameScene extends Phaser.Scene {
  private player!: PlayerModel;
  private playerView!: PlayerView;
  private boss!: BossModel;
  private bossView!: BossView;
  private combat!: CombatSystem;
  private projectiles!: ProjectileSystem;
  private projectileView!: ProjectileView;
  private inputReader!: InputReader;
  private hud!: Hud;
  private bossHud!: BossHud;
  private pauseMenu!: PauseMenu;
  private resultScreen!: ResultScreen;
  private briefing!: Briefing;
  private bubble!: Phaser.GameObjects.Text;
  private bubbleMs = 0;
  /** 처음 보는 패턴 안내로 느려진 남은 시간 (실제 시간) */
  private slowMs = 0;
  private reviveText!: Phaser.GameObjects.Text;
  /** 되감기 지점: 보스가 패턴을 시작한 순간의 플레이어·보스 상태 */
  private rewindPoint: { player: Snapshot; boss: Snapshot; projectiles: Snapshot } | null = null;
  private pending: Pending | null = null;
  private trail!: TrailRecorder;
  private debugText!: Phaser.GameObjects.Text;
  private helpText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private escKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private modeKey!: Phaser.Input.Keyboard.Key;
  private resetKey!: Phaser.Input.Keyboard.Key;
  private mapKey!: Phaser.Input.Keyboard.Key;

  private paused = false;
  private hitstopMs = 0;
  private toastMs = 0;
  /** 이번 판의 사망 기록 위치 (사망 지도에서 강조) */
  private latestDeathIndex: number | null = null;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width, height } = this.scale;
    const bounds = { width, height };
    this.paused = false;
    this.hitstopMs = 0;
    this.toastMs = 0;
    this.pending = null;
    this.latestDeathIndex = null;

    this.player = new PlayerModel(width / 2, height - 150, bounds);
    this.boss = new BossModel(width / 2, 140, bounds);
    if (session.mode === 'checkpoint') this.boss.hp = BOSS.maxHp * session.checkpoint.restoreHpRatio();
    this.combat = new CombatSystem({ bossHittableMaxZ: BOSS.hittableMaxZ });
    this.projectiles = new ProjectileSystem(bounds, { ...PROJECTILE_RULES_DEFAULT, bossHittableMaxZ: BOSS.hittableMaxZ });
    this.projectileView = new ProjectileView(this);
    this.trail = new TrailRecorder();
    this.bossView = new BossView(this, BOSS.radius);
    this.playerView = new PlayerView(this, PLAYER.radius);
    this.inputReader = new InputReader(this);
    this.hud = new Hud(this, PLAYER);
    this.bossHud = new BossHud(this, BOSS);

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('키보드 입력을 사용할 수 없습니다.');
    this.escKey = keyboard.addKey('ESC');
    this.restartKey = keyboard.addKey('R');
    this.modeKey = keyboard.addKey('M');
    this.resetKey = keyboard.addKey('K');
    this.mapKey = keyboard.addKey('TAB'); // 브라우저 포커스 이동을 막고 게임이 받음

    this.pauseMenu = new PauseMenu({
      onPause: () => this.setPaused(true),
      onResume: () => this.setPaused(false),
      onRestart: () => this.restartFresh(),
      onBriefing: () => {
        this.pauseMenu.hide();
        this.briefing.showCards();
      },
    });
    this.resultScreen = new ResultScreen(() => this.restart());
    this.briefing = new Briefing(HELPER_INTRO, weaponCards(), (mode) => {
      if (mode === 'intro') session.briefed = true;
      this.setPaused(false);
    });
    // 씬이 재시작·종료될 때 HTML 버튼 연결을 풀어 중복 연결을 막는다
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pauseMenu.destroy();
      this.resultScreen.destroy();
      this.briefing.destroy();
    });

    this.helpText = this.add.text(width - 52, 14, '', { color: '#999999', fontSize: '12px', align: 'right' }).setOrigin(1, 0);
    this.debugText = this.add.text(16, 70, '', { color: '#777777', fontSize: '12px' });
    this.toastText = this.add
      .text(width / 2, 70, '', { color: '#000000', fontSize: '16px', fontFamily: 'ui-monospace, monospace' })
      .setOrigin(0.5, 0)
      .setDepth(20);
    this.reviveText = this.add.text(16, 32, '', { color: '#000000', fontSize: '12px' }).setDepth(10);
    this.bubble = this.add
      .text(width / 2, height - 70, '', {
        color: '#000000',
        backgroundColor: '#ffffff',
        fontSize: '15px',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(0.5, 1)
      .setDepth(20)
      .setVisible(false);
    this.bubbleMs = 0;
    this.slowMs = 0;
    this.updateHelp();
    this.saveRewindPoint();

    if (session.mode === 'checkpoint' && session.checkpoint.saved > 0) {
      this.toast(`CHECKPOINT ${session.checkpoint.saved}/${CHECKPOINT_STAGES - 1} 에서 재개`);
    }
    // 처음 접속했을 때만 헬퍼 브리핑 (일시정지 메뉴에서 다시 볼 수 있음)
    if (!session.briefed) {
      this.paused = true;
      this.briefing.showIntro();
    }
  }

  update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.restart();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.modeKey)) {
      this.toggleMode();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.resetKey)) {
      telemetry.reset();
      this.toast('텔레메트리 기록 초기화');
    }
    if (Phaser.Input.Keyboard.JustDown(this.mapKey)) this.resultScreen.toggleBigMap();

    const dt = Math.min(delta, MAX_DT_MS);
    this.updateToast(dt);
    this.updateBubble(dt);

    const busy = this.pending !== null || this.briefing.isShown || this.resultScreen.isShown;
    if (!busy && Phaser.Input.Keyboard.JustDown(this.escKey)) this.setPaused(!this.paused);
    if (this.paused) return;

    // 쓰러진 직후: 화면을 멈춘 채 기다렸다가 되감기 또는 결과 화면
    if (this.pending) {
      this.pending.ms -= dt;
      if (this.pending.ms <= 0) this.resolvePending();
      this.draw([], dt);
      return;
    }

    // 히트스톱: 잠깐 시간을 멈춰 타격감을 준다 (그리기는 계속)
    if (this.hitstopMs > 0) {
      this.hitstopMs -= dt;
      this.draw([], dt);
      return;
    }

    // 처음 보는 패턴 안내 중에는 게임이 느리게 흐른다
    const simDt = this.slowMs > 0 ? dt * HINT_SLOW_SCALE : dt;
    this.slowMs = Math.max(0, this.slowMs - dt);

    const input = this.inputReader.read(this.player.x, this.player.y);
    const playerEvents = this.player.update(input, simDt);
    if (!this.player.isDead) this.trail.push(this.player.x, this.player.y, simDt);
    const bossEvents = this.boss.update({ x: this.player.x, y: this.player.y }, simDt);
    this.hintNewPattern(bossEvents);

    for (const e of bossEvents) {
      if (e.type === 'fire') this.projectiles.spawn(e);
    }
    const combatEvents = [...this.combat.resolve(this.player, this.boss), ...this.projectiles.update(simDt, this.player, this.boss)];
    this.pushPlayerOutOfBoss();
    this.recordRun(bossEvents, combatEvents);
    this.applyFeedback(combatEvents);
    this.checkEnd(combatEvents);

    this.draw(playerEvents, dt);
  }

  private draw(playerEvents: PlayerEvent[], dt: number): void {
    this.bossView.draw(this.boss);
    this.projectileView.draw(this.projectiles.projectiles);
    this.playerView.draw(this.player);
    this.hud.update(this.player, playerEvents, dt);
    this.bossHud.update(this.boss, session.mode === 'checkpoint' ? { stages: CHECKPOINT_STAGES, saved: session.checkpoint.saved } : null);
    this.debugText.setText(`${this.describePlayer()}\n${this.describeBoss()}`);
    const left = session.revive.remaining;
    this.reviveText.setText(`재시도 ${'●'.repeat(left)}${'○'.repeat(MAX_DEATHS - left)}`);
  }

  /** 플레이어가 보스 몸을 통과하지 못하게 (점프 중·쓰러진 보스는 제외) */
  private pushPlayerOutOfBoss(): void {
    if (this.boss.isDead || this.boss.z > BOSS.hittableMaxZ) return;
    const push = separation(this.player.x, this.player.y, PLAYER.radius, this.boss.x, this.boss.y, BOSS.radius);
    if (push.dx !== 0 || push.dy !== 0) this.player.nudge(push.dx, push.dy);
  }

  // ───────────────────────── 기록: 되감기 지점·체크포인트·사망 ─────────────────────────

  private recordRun(bossEvents: BossEvent[], combatEvents: CombatEvent[]): void {
    // 되감기 지점: 보스가 새 패턴을 시작하는 순간 (연속기의 첫 타)
    if (!this.player.isDead && bossEvents.some((e) => e.type === 'telegraphStart' && e.step === 0)) this.saveRewindPoint();

    // 체크포인트 (새로 저장되면 재시도 횟수도 다시 채움)
    if (session.mode === 'checkpoint' && !this.boss.isDead && session.checkpoint.update(this.boss.hp / BOSS.maxHp)) {
      session.revive.reset();
      this.toast(`CHECKPOINT SAVED ${session.checkpoint.saved}/${CHECKPOINT_STAGES - 1}`);
    }

    // 사망 기록
    if (combatEvents.some((e) => e.type === 'playerDied')) {
      const hit = combatEvents.find((e) => e.type === 'bossHitPlayer');
      const atk = this.boss.attack;
      const record: DeathRecord = {
        x: this.player.x,
        y: this.player.y,
        patternId: hit?.type === 'bossHitPlayer' ? hit.patternId : null,
        weapon: this.boss.weapon,
        step: atk ? atk.step : null,
        bossHpRatio: this.boss.hp / BOSS.maxHp,
        trail: this.trail.snapshot(),
        at: Date.now(),
      };
      telemetry.recordDeath(record);
      this.latestDeathIndex = telemetry.deaths.length - 1;
    }
  }

  private saveRewindPoint(): void {
    this.rewindPoint = {
      player: takeSnapshot(this.player, KEEP_REFS),
      boss: takeSnapshot(this.boss, KEEP_REFS),
      projectiles: takeSnapshot(this.projectiles, ['bounds', 'rules']),
    };
  }

  // ───────────────────────── 타격감·결과 ─────────────────────────

  private applyFeedback(events: CombatEvent[]): void {
    for (const e of events) {
      if (e.type === 'playerHitBoss' || e.type === 'playerParried' || e.type === 'bossHitPlayer' || e.type === 'bossStaggered') {
        const f = FEEDBACK[e.type];
        this.hitstopMs = Math.max(this.hitstopMs, f.hitstopMs);
        if (f.shakeMs > 0) this.cameras.main.shake(f.shakeMs, f.shake);
      }
    }
  }

  /** 승패가 정해졌으면 잠깐 멈춘 뒤 처리하도록 예약 */
  private checkEnd(events: CombatEvent[]): void {
    if (this.pending) return;
    if (events.some((e) => e.type === 'bossDied')) {
      this.pending = { kind: 'result', ms: RESULT_DELAY_MS };
      return;
    }
    if (!events.some((e) => e.type === 'playerDied')) return;

    const outcome = session.revive.onDeath();
    const latest = this.latestDeathIndex !== null ? telemetry.deaths[this.latestDeathIndex] : null;
    const cause = latest?.patternId ? `${this.patternName(latest.patternId)} (${latest.weapon ? WEAPON_NAME[latest.weapon] : '?'})` : '알 수 없는 공격';
    if (outcome === 'revive') {
      this.toast(`${cause}에 맞음 · 남은 재시도 ${session.revive.remaining}`);
      this.pending = { kind: 'revive', ms: REVIVE_DELAY_MS };
    } else {
      this.pending = { kind: 'result', ms: RESULT_DELAY_MS };
    }
  }

  private resolvePending(): void {
    const kind = this.pending?.kind;
    this.pending = null;
    if (kind === 'revive') {
      this.rewind();
      return;
    }
    if (this.player.isDead) {
      this.showDefeat();
    } else {
      // 클리어: 체크포인트·재시도 초기화
      session.checkpoint = new CheckpointTracker(CHECKPOINT_STAGES);
      session.revive.reset();
      this.resultScreen.showVictory();
    }
    this.paused = true; // 결과 화면에서는 진행 멈춤 (R 또는 버튼으로 재시작)
  }

  /** 빠른 부활: 직전 패턴이 시작되기 전으로 되감는다 (보스 체력·자세도 그때로) */
  private rewind(): void {
    if (!this.rewindPoint) return;
    restoreSnapshot(this.player, this.rewindPoint.player);
    restoreSnapshot(this.boss, this.rewindPoint.boss);
    restoreSnapshot(this.projectiles, this.rewindPoint.projectiles);
    this.combat = new CombatSystem({ bossHittableMaxZ: BOSS.hittableMaxZ }); // "이미 맞았음" 기록도 비움
    this.trail = new TrailRecorder();
    this.hitstopMs = 0;
    this.slowMs = 0;
    this.inputReader.reset();
    this.cameras.main.flash(120, 255, 255, 255);
  }

  private patternName(id: BossPatternId): string {
    return BOSS.patterns.find((p) => p.id === id)?.name ?? id;
  }

  private showDefeat(): void {
    const arena = { width: this.scale.width, height: this.scale.height };
    const latest = this.latestDeathIndex !== null ? telemetry.deaths[this.latestDeathIndex] : null;
    const nameOf = (id: BossPatternId) => this.patternName(id);
    const s = telemetry.stats(arena);

    const causeLine = latest?.patternId
      ? `사망 원인: ${nameOf(latest.patternId)} (${latest.weapon ? WEAPON_NAME[latest.weapon] : '?'})`
      : '사망 원인: 알 수 없음';
    const statsLine =
      `누적 사망 ${s.total}회` +
      (s.topPattern ? ` · 최다: ${nameOf(s.topPattern.id)} ${s.topPattern.count}회` : '') +
      (s.topRegion ? ` · 주 위치: ${s.topRegion.name}` : '');
    const restartNote =
      session.mode === 'checkpoint' && session.checkpoint.saved > 0
        ? `CHECKPOINT ${session.checkpoint.saved}/${CHECKPOINT_STAGES - 1} 에서 재개`
        : '처음부터 재개';

    this.resultScreen.showDefeat({
      arena,
      deaths: telemetry.deaths,
      latestIndex: this.latestDeathIndex,
      causeLine,
      statsLine,
      restartNote,
    });
  }

  // ───────────────────────── 재시작·모드 ─────────────────────────

  private setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.pauseMenu.show();
    } else {
      this.pauseMenu.hide();
      this.inputReader.reset(); // 메뉴 클릭이 공격으로 새어 들어가지 않도록
    }
  }

  /** R·결과 화면 버튼: 체크포인트 방식이면 저장된 칸부터 (재시도 횟수는 다시 채움) */
  private restart(): void {
    session.revive.reset();
    this.scene.restart();
  }

  /** 일시정지 메뉴 "처음부터 다시": 체크포인트도 지운다 */
  private restartFresh(): void {
    session.checkpoint = new CheckpointTracker(CHECKPOINT_STAGES);
    session.revive.reset();
    this.scene.restart();
  }

  /** M: 튜토리얼 방식(죽으면 처음부터) ↔ 체크포인트 방식 (테스트용. 나중에 막에 따라 자동으로 정해짐) */
  private toggleMode(): void {
    session.mode = session.mode === 'checkpoint' ? 'tutorial' : 'checkpoint';
    this.restartFresh();
  }

  private toast(message: string): void {
    // 같은 순간에 여러 알림이 나오면 줄을 바꿔 함께 보여준다
    const fresh = this.toastMs > TOAST_MS - 200;
    this.toastText.setText(fresh ? `${this.toastText.text}\n${message}` : message);
    this.toastText.setAlpha(1);
    this.toastMs = TOAST_MS;
  }

  /** 패턴이 처음 나오면: 잠깐 느려지며 헬퍼가 한 줄로 알려준다 */
  private hintNewPattern(bossEvents: BossEvent[]): void {
    for (const e of bossEvents) {
      if (e.type !== 'telegraphStart' || e.step !== 0 || !session.hints.take(e.patternId)) continue;
      this.slowMs = HINT_SLOW_MS;
      this.bubble.setText(`HELPER ▸ ${HELPER_HINTS[e.patternId]}`);
      this.bubble.setVisible(true).setAlpha(1);
      this.bubbleMs = HINT_BUBBLE_MS;
    }
  }

  private updateBubble(dt: number): void {
    if (this.bubbleMs <= 0) return;
    this.bubbleMs -= dt;
    this.bubble.setAlpha(Math.max(0, Math.min(1, this.bubbleMs / 400)));
    if (this.bubbleMs <= 0) this.bubble.setVisible(false);
  }

  private updateToast(dt: number): void {
    if (this.toastMs <= 0) return;
    this.toastMs -= dt;
    this.toastText.setAlpha(Math.max(0, Math.min(1, this.toastMs / 400)));
  }

  private updateHelp(): void {
    this.helpText.setText(`ESC 일시정지 · R 재시작\nM 모드: ${MODE_LABEL[session.mode]} · K 기록 초기화`);
  }

  // ───────────────────────── 개발용 상태 표시 ─────────────────────────

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
    const hp = `HP ${Math.round(b.hp)} · 자세 ${Math.round(b.posture)} · ${WEAPON_NAME[b.weapon]}`;
    const swap = b.weaponSwap;
    if (swap) return `보스: 무기 교체 ${WEAPON_NAME[swap.from]} → ${WEAPON_NAME[swap.to]} · ${hp}`;
    const atk = b.attack;
    if (atk) {
      const step = atk.stepCount > 1 ? ` ${atk.step + 1}/${atk.stepCount}타` : '';
      const lock = atk.phase === 'telegraph' ? (atk.locked ? ' 고정' : ' 추적') : '';
      const name = atk.pattern.name;
      return `보스: ${name}${step} (${atk.phase}${lock})${atk.parryable ? '' : ' [패링 불가]'} · ${hp}`;
    }
    const watch = b.currentWatchMode;
    if (watch) return `보스: 관찰 (${WATCH_LABEL[watch]}) · ${hp}`;
    const planned = b.plannedPattern ? ` → ${b.plannedPattern.name} 준비` : '';
    return `보스: ${b.state}${planned} · ${hp}`;
  }
}

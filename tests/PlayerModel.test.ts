import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config/balance';
import { PlayerModel } from '../src/entities/player/PlayerModel';
import { NO_INPUT, type PlayerInput } from '../src/input/types';

const BIG_BOUNDS = { width: 10000, height: 10000 };
const STEP_MS = 10;

function newPlayer(): PlayerModel {
  return new PlayerModel(5000, 5000, BIG_BOUNDS);
}

/** 같은 입력을 ms 동안 STEP_MS 간격으로 반복해서 넣는다 */
function hold(p: PlayerModel, input: Partial<PlayerInput>, ms: number): void {
  for (let t = 0; t < ms; t += STEP_MS) p.update({ ...NO_INPUT, ...input }, STEP_MS);
}

/** 한 프레임만 입력을 넣는다 (눌린 순간) */
function press(p: PlayerModel, input: Partial<PlayerInput>): void {
  p.update({ ...NO_INPUT, ...input }, STEP_MS);
}

function wait(p: PlayerModel, ms: number): void {
  hold(p, {}, ms);
}

type Hit = (typeof PLAYER.attackHits)[number];
/** 공격 시작부터 다음 타로 이어지는 시점까지의 시간 */
const linkMs = (h: Hit) => h.startupMs + h.activeMs + h.recoveryMs * h.comboLinkFrom;
/** 공격 시작부터 끝까지의 시간 */
const totalMs = (h: Hit) => h.startupMs + h.activeMs + h.recoveryMs;

describe('이동', () => {
  it('대각선 이동 속도가 직선 이동 속도와 같다', () => {
    const straight = newPlayer();
    hold(straight, { moveX: 1 }, 1000);
    const diagonal = newPlayer();
    hold(diagonal, { moveX: 1, moveY: 1 }, 1000);

    const straightDist = Math.hypot(straight.x - 5000, straight.y - 5000);
    const diagonalDist = Math.hypot(diagonal.x - 5000, diagonal.y - 5000);
    expect(straightDist).toBeCloseTo(PLAYER.moveSpeed, 5);
    expect(diagonalDist).toBeCloseTo(PLAYER.moveSpeed, 5);
  });

  it('화면 밖으로 나가지 않는다', () => {
    const p = new PlayerModel(20, 20, { width: 100, height: 100 });
    hold(p, { moveX: -1, moveY: -1 }, 1000);
    expect(p.x).toBe(PLAYER.radius);
    expect(p.y).toBe(PLAYER.radius);
  });
});

describe('대시', () => {
  it('스태미나를 소모하고 정확히 정해진 거리만큼 이동한 뒤 idle로 돌아온다', () => {
    const p = newPlayer();
    press(p, { dash: true, moveX: 1 });
    expect(p.state).toBe('dash');
    expect(p.stamina).toBe(PLAYER.maxStamina - PLAYER.dash.staminaCost);

    wait(p, PLAYER.dash.durationMs + 20);
    expect(p.state).toBe('idle');
    expect(p.x - 5000).toBeCloseTo(PLAYER.dash.distance, 5);
  });

  it('시작 후 invulnMs 동안만 무적이다', () => {
    const p = newPlayer();
    press(p, { dash: true, moveX: 1 });
    wait(p, 50);
    expect(p.isInvulnerable).toBe(true);
    wait(p, PLAYER.dash.invulnMs);
    expect(p.isInvulnerable).toBe(false);
  });

  it('이동키가 있으면 이동키 방향, 없으면 조준 방향으로 대시한다', () => {
    const withMove = newPlayer();
    press(withMove, { dash: true, moveY: 1, aimAngle: 0 });
    wait(withMove, PLAYER.dash.durationMs + 20);
    expect(withMove.y - 5000).toBeCloseTo(PLAYER.dash.distance, 5);
    expect(withMove.x).toBeCloseTo(5000, 5);

    const withAim = newPlayer();
    press(withAim, { dash: true, aimAngle: Math.PI }); // 왼쪽 조준
    wait(withAim, PLAYER.dash.durationMs + 20);
    expect(5000 - withAim.x).toBeCloseTo(PLAYER.dash.distance, 5);
  });

  it('스태미나가 부족하면 대시하지 않는다', () => {
    const p = newPlayer();
    p.stamina = PLAYER.dash.staminaCost - 1;
    press(p, { dash: true, moveX: 1 });
    expect(p.state).not.toBe('dash');
  });
});

describe('공격', () => {
  const hit1 = PLAYER.attackHits[0];
  const hit1Total = hit1.startupMs + hit1.activeMs + hit1.recoveryMs;

  it('준비 → 판정 → 경직 순서로 진행된다', () => {
    const p = newPlayer();
    press(p, { attack: true });
    expect(p.attack?.phase).toBe('startup');
    wait(p, hit1.startupMs);
    expect(p.attack?.phase).toBe('active');
    wait(p, hit1.activeMs);
    expect(p.attack?.phase).toBe('recovery');
  });

  it('공격이 시작되면 이동·대시·패링 입력으로 취소되지 않는다 (동작 고정)', () => {
    const p = newPlayer();
    press(p, { attack: true });
    hold(p, { moveX: 1, dash: true, parry: true }, hit1.startupMs);
    expect(p.state).toBe('attack');
    expect(p.x).toBe(5000);
    expect(p.stamina).toBe(PLAYER.maxStamina - hit1.staminaCost);
  });

  it('공격 방향은 시작 순간의 조준 방향으로 고정된다', () => {
    const p = newPlayer();
    press(p, { attack: true, aimAngle: 1 });
    hold(p, { aimAngle: 2 }, 50);
    expect(p.attack?.angle).toBe(1);
  });

  it('공격 중에 다시 누르면 2타, 3타로 이어지고 3타가 최대다', () => {
    const [, hit2, hit3] = PLAYER.attackHits;
    const p = newPlayer();
    press(p, { attack: true });
    press(p, { attack: true }); // 1타 중 예약
    wait(p, linkMs(hit1));
    expect(p.attack?.comboIndex).toBe(1);

    press(p, { attack: true }); // 2타 중 예약
    wait(p, linkMs(hit2));
    expect(p.attack?.comboIndex).toBe(2);

    press(p, { attack: true }); // 3타 중 예약 → 4타는 없음
    wait(p, totalMs(hit3));
    expect(p.state).toBe('idle');
  });

  it('예약해 두어도 경직이 시작된 순간에는 아직 다음 타로 넘어가지 않는다 (경직을 건너뛰지 않음)', () => {
    const p = newPlayer();
    press(p, { attack: true });
    press(p, { attack: true }); // 예약
    wait(p, hit1.startupMs + hit1.activeMs + STEP_MS); // 경직 막 시작
    expect(p.attack?.comboIndex).toBe(0);
    expect(p.attack?.phase).toBe('recovery');
  });

  it('2타 → 3타는 1타 → 2타보다 경직에서 더 오래 멈춘다', () => {
    const [h1, h2] = PLAYER.attackHits;
    expect(h2.recoveryMs * h2.comboLinkFrom).toBeGreaterThan(h1.recoveryMs * h1.comboLinkFrom);
  });

  it('다시 누르지 않으면 1타 후 idle로 돌아오고, 다음 공격은 다시 1타부터', () => {
    const p = newPlayer();
    press(p, { attack: true });
    wait(p, hit1Total);
    expect(p.state).toBe('idle');
    press(p, { attack: true });
    expect(p.attack?.comboIndex).toBe(0);
  });
});

describe('패링', () => {
  it('판정은 activeMs 동안만 켜지고, 경직 후 idle로 돌아온다', () => {
    const p = newPlayer();
    press(p, { parry: true });
    expect(p.isParryActive).toBe(true);
    wait(p, PLAYER.parry.activeMs);
    expect(p.isParryActive).toBe(false);
    expect(p.state).toBe('parry');
    wait(p, PLAYER.parry.recoveryMs);
    expect(p.state).toBe('idle');
  });
});

describe('포션', () => {
  it('개수가 줄고, 마시는 시간이 끝나면 회복된다 (최대 체력 초과 없음)', () => {
    const p = newPlayer();
    p.hp = 30;
    press(p, { potion: true });
    expect(p.potions).toBe(PLAYER.potion.count - 1);
    expect(p.state).toBe('potion');
    hold(p, { moveX: 1 }, PLAYER.potion.drinkMs / 2);
    expect(p.x).toBe(5000); // 마시는 동안 못 움직임
    wait(p, PLAYER.potion.drinkMs);
    expect(p.hp).toBe(Math.min(PLAYER.maxHp, 30 + PLAYER.potion.heal));

    p.hp = PLAYER.maxHp - 5;
    press(p, { potion: true });
    wait(p, PLAYER.potion.drinkMs + 20);
    expect(p.hp).toBe(PLAYER.maxHp);
  });

  it('포션이 0개면 마실 수 없다', () => {
    const p = newPlayer();
    p.potions = 0;
    press(p, { potion: true });
    expect(p.state).not.toBe('potion');
  });
});

describe('스태미나', () => {
  it('소모 후 지연 시간이 지나야 회복되고, 최대치를 넘지 않는다', () => {
    const p = newPlayer();
    press(p, { dash: true, moveX: 1 });
    const afterDash = p.stamina;
    wait(p, PLAYER.dash.durationMs + 100); // 아직 지연 시간 안
    expect(p.stamina).toBe(afterDash);
    wait(p, 3000);
    expect(p.stamina).toBe(PLAYER.maxStamina);
  });

  it('스태미나가 부족해 행동이 막히면 staminaDenied 이벤트를 낸다', () => {
    const p = newPlayer();
    p.stamina = 0;
    const events = p.update({ ...NO_INPUT, dash: true }, STEP_MS);
    expect(events.some((e) => e.type === 'staminaDenied' && e.action === 'dash')).toBe(true);
  });
});

describe('꾹 누르기 콤보', () => {
  const [hit1, hit2, hit3] = PLAYER.attackHits;

  it('누르고 있으면 1타 → 2타 → 3타로 이어진다', () => {
    const p = newPlayer();
    hold(p, { attackHeld: true }, linkMs(hit1) + STEP_MS);
    expect(p.attack?.comboIndex).toBe(1);
    hold(p, { attackHeld: true }, linkMs(hit2) + STEP_MS);
    expect(p.attack?.comboIndex).toBe(2);
  });

  it('누르고 있어도 경직이 시작된 순간에는 다음 타로 넘어가지 않는다', () => {
    const p = newPlayer();
    hold(p, { attackHeld: true }, hit1.startupMs + hit1.activeMs + STEP_MS * 2);
    expect(p.attack?.comboIndex).toBe(0);
    expect(p.attack?.phase).toBe('recovery');
  });

  it('누르고 있다가 다음 타가 나가기 전에 손을 떼면 그 타에서 멈춘다', () => {
    const p = newPlayer();
    hold(p, { attackHeld: true }, 50); // 1타 시작 후 바로 손 뗌
    wait(p, totalMs(hit1));
    expect(p.state).toBe('idle');
  });

  it('3타 뒤에도 계속 누르고 있으면 경직이 끝난 뒤 1타부터 다시 시작한다', () => {
    const p = newPlayer();
    // 1타·2타는 연결 시점에 다음 타로 넘어가고, 3타는 끝까지 진행
    hold(p, { attackHeld: true }, linkMs(hit1) + linkMs(hit2) + totalMs(hit3) + STEP_MS * 5);
    expect(p.attack?.comboIndex).toBe(0);
  });
});

describe('후딜 대시 캔슬', () => {
  const hit1 = PLAYER.attackHits[0];
  const cancelFromMs = hit1.startupMs + hit1.activeMs + hit1.recoveryMs * PLAYER.attackDashCancelFrom;

  it('경직 앞부분에서는 대시로 캔슬되지 않는다', () => {
    const p = newPlayer();
    press(p, { attack: true });
    wait(p, hit1.startupMs + hit1.activeMs + STEP_MS); // 경직 막 시작
    expect(p.attack?.canDashCancel).toBe(false);
    press(p, { dash: true, moveX: 1 });
    expect(p.state).toBe('attack');
  });

  it('다음 타를 예약해 두었어도 캔슬 구간에서 대시를 누르면 대시가 우선한다', () => {
    const p = newPlayer();
    press(p, { attack: true });
    press(p, { attack: true }); // 다음 타 예약
    wait(p, cancelFromMs); // 캔슬 구간 진입, 아직 다음 타 연결 전
    expect(p.attack?.comboIndex).toBe(0);
    press(p, { dash: true, moveX: 1 });
    expect(p.state).toBe('dash');
  });

  it('경직 후반부에서는 대시로 캔슬되고 스태미나를 소모한다', () => {
    const p = newPlayer();
    press(p, { attack: true });
    wait(p, cancelFromMs + STEP_MS);
    expect(p.attack?.canDashCancel).toBe(true);
    const before = p.stamina;
    const events = p.update({ ...NO_INPUT, dash: true, moveX: 1 }, STEP_MS);
    expect(p.state).toBe('dash');
    expect(p.stamina).toBe(before - PLAYER.dash.staminaCost);
    expect(events.some((e) => e.type === 'dash' && e.cancelledAttack)).toBe(true);
  });
});

describe('모션 진행률', () => {
  it('공격 준비 단계의 절반에서 진행률이 0.5다', () => {
    const p = newPlayer();
    press(p, { attack: true }); // 이 프레임은 공격 시작만 하고 시간은 0
    wait(p, PLAYER.attackHits[0].startupMs / 2);
    expect(p.attack?.phaseProgress).toBeCloseTo(0.5, 5);
  });

  it('포션을 절반 마셨을 때 진행률이 0.5다', () => {
    const p = newPlayer();
    press(p, { potion: true });
    wait(p, PLAYER.potion.drinkMs / 2);
    expect(p.potionProgress).toBeCloseTo(0.5, 5);
  });

  it('패링 판정이 끝나면 경직 단계로 바뀐다', () => {
    const p = newPlayer();
    press(p, { parry: true });
    expect(p.parry?.phase).toBe('active');
    wait(p, PLAYER.parry.activeMs);
    expect(p.parry?.phase).toBe('recovery');
  });
});

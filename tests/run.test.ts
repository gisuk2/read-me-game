import { describe, expect, it } from 'vitest';
import { MAX_DEATHS, Telemetry, memoryStorage, regionOf, type DeathRecord } from '../src/run/Telemetry';
import { TrailRecorder } from '../src/run/TrailRecorder';
import { CheckpointTracker } from '../src/run/Checkpoint';
import { ReviveCounter } from '../src/run/Revive';
import { HintTracker } from '../src/run/HintTracker';
import { HELPER_ANSWERS, HELPER_HINTS, WEAPON_ORDER } from '../src/data/helperBriefing';
import { restoreSnapshot, takeSnapshot } from '../src/utils/snapshot';
import { BossModel } from '../src/entities/boss/BossModel';
import { PlayerModel } from '../src/entities/player/PlayerModel';
import { BOSS } from '../src/config/bossBalance';
import { NO_INPUT } from '../src/input/types';

const BOUNDS = { width: 900, height: 600 };

const death = (over: Partial<DeathRecord> = {}): DeathRecord => ({
  x: 100,
  y: 100,
  patternId: 'sweep',
  weapon: 'greatsword',
  step: 0,
  bossHpRatio: 1,
  trail: [],
  at: 0,
  ...over,
});

describe('사망 기록 (텔레메트리)', () => {
  it('기록한 사망은 같은 저장소로 새로 만들어도 남아 있다 (껐다 켜도 유지)', () => {
    const storage = memoryStorage();
    new Telemetry(storage).recordDeath(death({ x: 42 }));
    const again = new Telemetry(storage);
    expect(again.deaths.length).toBe(1);
    expect(again.deaths[0].x).toBe(42);
  });

  it('저장된 내용이 깨졌거나 형식이 다르면 빈 기록으로 시작한다', () => {
    expect(new Telemetry(memoryStorage('{ 깨진 json')).deaths.length).toBe(0);
    expect(new Telemetry(memoryStorage('{"version":99,"deaths":[1]}')).deaths.length).toBe(0);
  });

  it('최대 개수를 넘으면 오래된 것부터 버린다', () => {
    const t = new Telemetry(memoryStorage());
    for (let i = 0; i < MAX_DEATHS + 3; i++) t.recordDeath(death({ at: i }));
    expect(t.deaths.length).toBe(MAX_DEATHS);
    expect(t.deaths[0].at).toBe(3);
  });

  it('통계: 가장 많이 죽은 공격과 구역', () => {
    const t = new Telemetry(memoryStorage());
    t.recordDeath(death({ patternId: 'sweep', x: 50, y: 50 }));
    t.recordDeath(death({ patternId: 'thrust', x: 60, y: 40 }));
    t.recordDeath(death({ patternId: 'thrust', x: 850, y: 550 }));
    const s = t.stats(BOUNDS);
    expect(s.total).toBe(3);
    expect(s.topPattern).toEqual({ id: 'thrust', count: 2 });
    expect(s.topRegion).toEqual({ name: '좌상단', count: 2 });
  });

  it('기록이 없으면 통계도 비어 있다', () => {
    expect(new Telemetry(memoryStorage()).stats(BOUNDS)).toEqual({ total: 0, topPattern: null, topRegion: null });
  });

  it('구역 이름: 3×3으로 나눈다', () => {
    expect(regionOf(0, 0, BOUNDS)).toBe('좌상단');
    expect(regionOf(450, 300, BOUNDS)).toBe('중앙');
    expect(regionOf(899, 599, BOUNDS)).toBe('우하단');
    expect(regionOf(900, 600, BOUNDS)).toBe('우하단'); // 경계값도 안쪽으로
  });

  it('초기화하면 사망 기록이 모두 지워진다', () => {
    const storage = memoryStorage();
    const t = new Telemetry(storage);
    t.recordDeath(death());
    t.reset();
    expect(t.deaths.length).toBe(0);
    expect(new Telemetry(storage).deaths.length).toBe(0);
  });
});

describe('최근 움직임 기록', () => {
  it('정해진 간격으로 점을 남기고, 정해진 시간보다 오래된 점은 버린다', () => {
    const r = new TrailRecorder(50, 1000);
    for (let t = 0; t < 3000; t += 10) r.push(t, 0, 10); // x = 경과 시간
    const pts = r.snapshot();
    expect(pts.length).toBeGreaterThan(15);
    expect(pts.length).toBeLessThanOrEqual(21);
    expect(pts[pts.length - 1].x).toBeGreaterThan(2900);
    expect(pts[0].x).toBeGreaterThanOrEqual(3000 - 1000 - 50);
  });

  it('오래된 것 → 최근 순서다', () => {
    const r = new TrailRecorder(10, 1000);
    for (let i = 0; i < 5; i++) r.push(i, 0, 10);
    expect(r.snapshot().map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('체크포인트 (보스 체력 5단계)', () => {
  it('체력이 한 칸(20%)씩 줄 때마다 저장되고, 새로 저장된 순간만 true', () => {
    const c = new CheckpointTracker(5);
    expect(c.update(0.9)).toBe(false);
    expect(c.update(0.8)).toBe(true);
    expect(c.saved).toBe(1);
    expect(c.update(0.75)).toBe(false);
    expect(c.update(0.35)).toBe(true); // 한 번에 두 칸
    expect(c.saved).toBe(3);
  });

  it('다시 시작하면 저장된 칸의 맨 위 체력으로 돌아간다', () => {
    const c = new CheckpointTracker(5);
    expect(c.restoreHpRatio()).toBe(1);
    c.update(0.55);
    expect(c.restoreHpRatio()).toBeCloseTo(0.6, 10);
  });

  it('체력이 다시 올라도 저장은 되돌아가지 않는다', () => {
    const c = new CheckpointTracker(5);
    c.update(0.5);
    expect(c.update(1)).toBe(false);
    expect(c.saved).toBe(2);
  });

  it('체력 0(승리)은 저장하지 않는다 (마지막 칸까지만)', () => {
    const c = new CheckpointTracker(5);
    c.update(0);
    expect(c.saved).toBe(4);
    expect(c.restoreHpRatio()).toBeCloseTo(0.2, 10);
  });
});

describe('빠른 부활 횟수', () => {
  it('정해진 횟수 전까지는 그 자리 부활, 마지막 죽음에서 체크포인트로 (그리고 횟수가 다시 채워짐)', () => {
    const r = new ReviveCounter(5);
    expect([r.onDeath(), r.onDeath(), r.onDeath(), r.onDeath()]).toEqual(['revive', 'revive', 'revive', 'revive']);
    expect(r.remaining).toBe(1);
    expect(r.onDeath()).toBe('checkpoint');
    expect(r.remaining).toBe(5);
  });

  it('새 체크포인트가 저장되면 횟수가 다시 채워진다', () => {
    const r = new ReviveCounter(5);
    r.onDeath();
    r.onDeath();
    r.reset();
    expect(r.remaining).toBe(5);
  });
});

describe('되감기 (상태 저장·되돌리기)', () => {
  const bounds = { width: 1000, height: 1000 };

  it('안쪽 객체까지 복사한다: 저장 뒤에 안쪽 값을 직접 고쳐도 스냅샷은 그대로이고, 되돌린 뒤 고쳐도 스냅샷에 새지 않는다', () => {
    const obj = { pos: { x: 1, y: 2 }, list: [{ v: 1 }], cfg: { keep: true }, fn: () => 1 };
    const snap = takeSnapshot(obj, ['cfg']);
    obj.pos.x = 99; // 저장 뒤 안쪽 값을 직접 수정
    obj.list[0].v = 99;
    restoreSnapshot(obj, snap);
    expect(obj.pos.x).toBe(1);
    expect(obj.list[0].v).toBe(1);

    obj.pos.x = 50; // 되돌린 뒤 수정해도
    restoreSnapshot(obj, snap);
    expect(obj.pos.x).toBe(1); // 스냅샷은 그대로
    expect('cfg' in snap).toBe(false); // 지정한 필드는 저장하지 않음 (그대로 둠)
    expect(obj.fn()).toBe(1); // 함수도 그대로
  });

  it('보스: 저장한 순간으로 위치·체력·상태·공격 진행이 그대로 돌아간다', () => {
    const boss = new BossModel(500, 500, bounds, BOSS, () => 0);
    const target = { x: 560, y: 500 };
    for (let i = 0; i < 100 && !boss.attack; i++) boss.update(target, 10);
    const snap = takeSnapshot(boss, ['cfg', 'bounds']);
    const before = { x: boss.x, y: boss.y, hp: boss.hp, state: boss.state, serial: boss.attackSerial, progress: boss.attack!.phaseProgress };

    for (let i = 0; i < 150; i++) boss.update(target, 10);
    boss.applyHit(50);
    expect(boss.hp).not.toBe(before.hp);

    restoreSnapshot(boss, snap);
    expect({ x: boss.x, y: boss.y, hp: boss.hp, state: boss.state, serial: boss.attackSerial, progress: boss.attack!.phaseProgress }).toEqual(before);
  });

  it('스냅샷은 여러 번 되돌려도 바뀌지 않는다 (되돌린 뒤의 변화가 스냅샷에 새지 않음)', () => {
    const p = new PlayerModel(500, 500, bounds);
    const snap = takeSnapshot(p, ['cfg', 'bounds']);
    p.update({ ...NO_INPUT, moveX: 1 }, 100);
    restoreSnapshot(p, snap);
    p.update({ ...NO_INPUT, moveX: 1 }, 100);
    restoreSnapshot(p, snap);
    expect(p.x).toBe(500);
  });

  it('쓰러진 플레이어도 되살아난다', () => {
    const p = new PlayerModel(500, 500, bounds);
    const snap = takeSnapshot(p, ['cfg', 'bounds']);
    p.applyHit(10, 400, 500);
    expect(p.isDead).toBe(true);
    restoreSnapshot(p, snap);
    expect(p.isDead).toBe(false);
    expect(p.state).toBe('idle');
  });
});

describe('헬퍼 안내', () => {
  it('패턴마다 한 줄 안내는 처음 한 번만 나온다', () => {
    const h = new HintTracker<string>();
    expect(h.take('sweep')).toBe(true);
    expect(h.take('sweep')).toBe(false);
    expect(h.take('thrust')).toBe(true);
    expect(h.has('sweep')).toBe(true);
  });

  it('모든 패턴에 짧은 안내와 대응법 꼬리표가 있고, 모든 무기가 카드에 나온다', () => {
    for (const p of BOSS.patterns) {
      expect(HELPER_HINTS[p.id].length).toBeGreaterThan(0);
      expect(HELPER_HINTS[p.id].length).toBeLessThanOrEqual(26); // 한 줄 (말풍선이 넘치지 않게)
      expect(HELPER_ANSWERS[p.id].length).toBeGreaterThan(0);
      expect(WEAPON_ORDER.includes(p.weapon)).toBe(true);
    }
  });
});

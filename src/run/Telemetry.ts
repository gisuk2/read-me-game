import type { BossPatternId, WeaponId } from '../config/bossBalance';
import type { Vec2 } from '../utils/geometry';
import type { Bounds } from '../entities/player/PlayerModel';

/**
 * 사망 기록 (순수 로직 + 저장소 연결).
 *
 * 표면 설정: "QA 텔레메트리 — 버그 제보용 사망 데이터 수집"
 * 실제 역할: 플레이어는 사망 지도로 보스를 배우고, 이후 보스는 같은 데이터로 플레이어를 배운다.
 * (docs/design/learning-feedback.md §5)
 */

export interface DeathRecord {
  x: number;
  y: number;
  /** 죽인 공격 (알 수 없으면 null) */
  patternId: BossPatternId | null;
  weapon: WeaponId | null;
  /** 연속기의 몇 번째 타였나 (0부터) */
  step: number | null;
  /** 죽은 순간 보스 체력 비율 0~1 */
  bossHpRatio: number;
  /** 죽기 직전 움직임 (오래된 것 → 최근) */
  trail: Vec2[];
  /** 기록 시각 (ms, Date.now) */
  at: number;
}

interface TelemetryData {
  version: 1;
  deaths: DeathRecord[];
}

/** 저장소. 브라우저에서는 localStorage, 테스트에서는 메모리 */
export interface TelemetryStorage {
  load(): string | null;
  save(data: string): void;
  clear(): void;
}

export function memoryStorage(initial: string | null = null): TelemetryStorage & { data: string | null } {
  return {
    data: initial,
    load() {
      return this.data;
    },
    save(d: string) {
      this.data = d;
    },
    clear() {
      this.data = null;
    },
  };
}

/**
 * 브라우저 저장소. 사생활 보호 모드 등에서 실패해도 게임은 계속되어야 하므로 모든 접근을 try/catch.
 * (저장이 안 되면 이번 접속 동안만 기억한다)
 */
export function browserStorage(key: string): TelemetryStorage {
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(d: string) {
      try {
        globalThis.localStorage?.setItem(key, d);
      } catch {
        /* 저장 실패는 무시 */
      }
    },
    clear() {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* 무시 */
      }
    },
  };
}

/** 저장해 두는 사망 기록 최대 개수 (오래된 것부터 버림) */
export const MAX_DEATHS = 500;

export type RegionName = '좌상단' | '상단' | '우상단' | '좌측' | '중앙' | '우측' | '좌하단' | '하단' | '우하단';
const REGIONS: RegionName[][] = [
  ['좌상단', '상단', '우상단'],
  ['좌측', '중앙', '우측'],
  ['좌하단', '하단', '우하단'],
];

/** 경기장을 3×3으로 나눈 구역 이름 */
export function regionOf(x: number, y: number, bounds: Bounds): RegionName {
  const col = Math.min(2, Math.max(0, Math.floor((x / bounds.width) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((y / bounds.height) * 3)));
  return REGIONS[row][col];
}

export interface DeathStats {
  total: number;
  /** 가장 많이 죽은 공격 */
  topPattern: { id: BossPatternId; count: number } | null;
  /** 가장 많이 죽은 구역 */
  topRegion: { name: RegionName; count: number } | null;
}

function topOf<K extends string>(counts: Map<K, number>): { key: K; count: number } | null {
  let best: { key: K; count: number } | null = null;
  for (const [key, count] of counts) if (!best || count > best.count) best = { key, count };
  return best;
}

export class Telemetry {
  private data: TelemetryData;

  constructor(private readonly storage: TelemetryStorage) {
    this.data = Telemetry.parse(storage.load());
  }

  get deaths(): readonly DeathRecord[] {
    return this.data.deaths;
  }

  recordDeath(record: DeathRecord): void {
    this.data.deaths.push(record);
    if (this.data.deaths.length > MAX_DEATHS) this.data.deaths.splice(0, this.data.deaths.length - MAX_DEATHS);
    this.persist();
  }

  /** 기록 전부 지우기 (개발·테스트용) */
  reset(): void {
    this.data = Telemetry.empty();
    this.storage.clear();
  }

  stats(bounds: Bounds): DeathStats {
    const byPattern = new Map<BossPatternId, number>();
    const byRegion = new Map<RegionName, number>();
    for (const d of this.data.deaths) {
      if (d.patternId) byPattern.set(d.patternId, (byPattern.get(d.patternId) ?? 0) + 1);
      const r = regionOf(d.x, d.y, bounds);
      byRegion.set(r, (byRegion.get(r) ?? 0) + 1);
    }
    const p = topOf(byPattern);
    const r = topOf(byRegion);
    return {
      total: this.data.deaths.length,
      topPattern: p ? { id: p.key, count: p.count } : null,
      topRegion: r ? { name: r.key, count: r.count } : null,
    };
  }

  private persist(): void {
    this.storage.save(JSON.stringify(this.data));
  }

  private static empty(): TelemetryData {
    return { version: 1, deaths: [] };
  }

  /** 저장된 문자열을 읽는다. 없거나 깨졌거나 형식이 다르면 빈 기록으로 시작 */
  private static parse(raw: string | null): TelemetryData {
    if (!raw) return Telemetry.empty();
    try {
      const d = JSON.parse(raw) as Partial<TelemetryData>;
      if (d.version !== 1 || !Array.isArray(d.deaths)) return Telemetry.empty();
      return { version: 1, deaths: d.deaths };
    } catch {
      return Telemetry.empty();
    }
  }
}

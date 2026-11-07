/**
 * 모델 상태 저장·되돌리기 (빠른 부활의 "되감기"용).
 *
 * 모델 객체의 자기 필드를 깊게 복사한다. 단, 설정·경계·난수 함수처럼 바뀌지 않거나 복사할 수 없는 값은
 * keepRefs로 지정해 그대로 둔다 (함수는 복사할 수 없으므로 항상 그대로).
 */

const cloneValue = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v; // 숫자(Infinity 포함)·문자열·불리언·함수
  if (Array.isArray(v)) return v.map(cloneValue);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) out[k] = cloneValue(val);
  return out;
};

export type Snapshot = Record<string, unknown>;

export function takeSnapshot(obj: object, keepRefs: readonly string[] = []): Snapshot {
  const snap: Snapshot = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function' || keepRefs.includes(k)) continue;
    snap[k] = cloneValue(v);
  }
  return snap;
}

/** 저장한 상태로 되돌린다 (스냅샷은 다시 써도 되도록 복사해서 넣는다) */
export function restoreSnapshot(obj: object, snap: Snapshot): void {
  for (const [k, v] of Object.entries(snap)) (obj as Record<string, unknown>)[k] = cloneValue(v);
}

# ADR 0001: 기술 스택 선택

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-11-07 |
| 상태 | 채택 |

## 배경

- 브라우저에서 링크 하나로 플레이할 수 있어야 한다 (GitHub Pages).
- 개발자는 Java·Python 경험이 있고 JavaScript/TypeScript 경험은 없다.
- AI 코딩 도구가 주로 코드를 작성한다.
- 학습 AI는 서버·API 없이 브라우저 안에서 동작해야 한다.

## 결정

| 영역 | 선택 |
|---|---|
| 언어 | TypeScript |
| 게임 프레임워크 | Phaser |
| 빌드 | Vite |
| 테스트 | Vitest |
| 배포 | GitHub Pages + GitHub Actions |
| 분석·ML | Python (pandas, Jupyter, PyTorch) |

## 검토한 대안

| 대안 | 제외 이유 |
|---|---|
| Python + Pygame | 웹 배포가 번거로움 |
| Godot | 엔진 학습 부담, 코드 흐름이 에디터 설정에 분산 |
| 3D (Three.js 등) | 부담이 커서 핵심(AI)에 도달하기 어려움 |
| LLM API | 실시간 판단에 너무 느리고 비용 발생 |

## 결과

- TypeScript의 타입 문법이 Java와 비슷해 진입 장벽이 낮다.
- 처음 쓰는 언어라 AI 코드의 품질을 판단하기 어렵다 → 실행·테스트로 검증하고 이해 부채 목록으로 관리한다.
- ESLint·Prettier는 설정 형식이 버전에 따라 달라 M0에서는 제외하고, 필요해지면 설치 버전 기준으로 추가한다.

## 설치된 버전

> 버전은 기억이 아니라 실제 설치 결과로 기록한다. 최초 `npm install` 후 `package.json` 값을 옮겨 적는다.

2026-11-07 최초 설치 결과 (`package.json` 기준)

| 패키지 | 버전 |
|---|---|
| Node.js | (기록 예정) |
| phaser | ^4.2.1 |
| vite | ^8.3.6 |
| typescript | ^7.0.2 |
| vitest | ^5.1.0 |

### 주의: AI 지식보다 최신인 메이저 버전

네 패키지 모두 AI 코딩 도구가 주로 학습한 시점보다 새로운 메이저 버전이다 (Phaser 3 → 4, TypeScript 5 → 7 등). AI가 이전 버전의 API나 설정을 그대로 쓸 가능성이 높으므로, 이 프로젝트에서는 다음을 지킨다.

- 새 API를 쓸 때는 **설치된 버전의 공식 문서·타입 정의**로 확인한다.
- `npm run typecheck`와 `npm test`를 커밋 전 기본 검증으로 삼는다.
- 버전 차이로 생긴 오류는 `docs/ai-vs-manual.md`에 사례로 기록한다.

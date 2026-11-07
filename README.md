# READ ME (가칭)

> **"튜토리얼이 가르친 정석을, 보스가 학습해서 역이용한다."**
> 플레이어의 습관을 학습해 공략해 오는 보스와 싸우는 탑다운 2D 소울라이크 브라우저 게임

| 항목 | 내용 |
|---|---|
| 상태 | M0 준비 단계 |
| 플레이 | (GitHub Pages 배포 후 링크 추가) |
| 기술 | TypeScript · Phaser · Vite · Vitest · GitHub Actions / 분석: Python |

---

## 1. 개요

빈틈마다 늘 세 번째 타까지 때리던 플레이어에게, 보스가 어느 순간 그 세 번째 타를 패링하며 말한다. *"…이런 식으로 막던가?"*

보스는 플레이어의 콤보 길이, 회피 궤적, 패링 타이밍을 학습하고, 녹화된 플레이어의 실제 과거 움직임(잔상)을 보여주며 그 도착 지점을 노린다. 모든 학습은 서버나 LLM API 없이 브라우저 안에서 동작한다.

## 2. 문서

| 문서 | 내용 |
|---|---|
| [프로젝트 계획서](docs/00_project-plan.md) | 목표, 범위, AI 설계, 기술 스택, 시스템 구조, 마일스톤 |
| [전투 시스템](docs/design/combat-system.md) | 조작, 자세 게이지, 일반 패턴, 적응 3단계, 공정성 원칙 |
| [보스 패턴](docs/design/boss-patterns.md) | 잔상 시스템, 패턴 카드 |
| [내러티브](docs/design/narrative.md) | 3막 구조, 가이드 NPC, 사망 리포트 |
| [개발 일지](docs/devlog/) | 날짜별 작업 기록 |
| [기술 결정 기록](docs/adr/) | 되돌리기 어려운 결정과 그 이유 |

## 3. 실행 방법

### 3.1 요구 사항

- Node.js LTS (`node -v`로 확인)

### 3.2 최초 설치 (처음 한 번)

```bash
npm install phaser
npm install -D vite typescript vitest
```

> 버전을 미리 고정하지 않고 설치 시점의 최신 안정 버전을 받는다. 설치된 버전은 `package.json`에 기록되고, [ADR 0001](docs/adr/0001-tech-stack.md)에 옮겨 적는다.

이후에는 `npm install`만 실행하면 된다.

### 3.3 명령어

| 명령어 | 내용 |
|---|---|
| `npm run dev` | 개발 서버 실행 (브라우저에서 확인) |
| `npm test` | 테스트 실행 |
| `npm run typecheck` | 타입 검사 |
| `npm run build` | 배포용 빌드 (`dist/`) |

## 4. 폴더 구조

```
read-me-game/
├─ docs/            # 계획서, 설계 문서, 개발 일지, 기술 결정 기록
├─ src/
│  ├─ main.ts       # 진입점
│  ├─ scenes/       # Phaser 씬
│  └─ utils/        # 순수 함수
├─ tests/           # Vitest
├─ analysis/        # Python 분석 (M4~)
└─ .github/workflows/deploy.yml   # 자동 배포
```

## 5. 개발 방식

AI 코딩 도구를 활용해 개발하며, 그 과정을 [개발 일지](docs/devlog/)와 `docs/ai-vs-manual.md`에 기록한다. 이해하지 못한 채 넘어간 코드는 [이해 부채 목록](docs/understanding-debt.md)에 남긴다.

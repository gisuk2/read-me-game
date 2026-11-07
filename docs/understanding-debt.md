# 이해 부채 목록

이해하지 못한 채 넘어간 코드를 기록하고, 여유가 생기면 정리한다.

중요도 기준: **높음** = AI 모듈·핵심 전투 로직 / **보통** = 일반 게임 로직 / **낮음** = 설정·보일러플레이트

| 날짜 | 파일·위치 | 무엇을 모르는가 | 중요도 | 해결 |
|---|---|---|---|---|
| 11-07 | tsconfig.json | 각 옵션(moduleResolution: bundler 등)의 의미 | 낮음 | ☐ |
| 11-07 | .github/workflows/deploy.yml | GitHub Actions 배포 단계별 동작 | 낮음 | ☐ |
| 11-07 | src/scenes/GameScene.ts | Phaser 씬의 생명주기(create/update) 전체 흐름 | 보통 | ☐ |
| 11-07 | src/entities/player/PlayerModel.ts | 상태 머신 전체 흐름 (특히 공격 예약 → 다음 타 연결) | 높음 | ☐ |
| 11-07 | src/input/InputReader.ts | JustDown과 pointerdown 이벤트의 차이, 입력을 "한 번만 전달"하는 방식 | 보통 | ☐ |
| 11-07 | src/entities/player/PlayerView.ts | Graphics의 beginPath / slice / fillPath 동작 | 낮음 | ☐ |
| 11-07 | tests/PlayerModel.test.ts | 시간을 10ms씩 흘려보내며 테스트하는 방식 | 보통 | ☐ |

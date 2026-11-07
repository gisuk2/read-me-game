import { defineConfig } from 'vite';

// GitHub Pages는 https://<사용자>.github.io/read-me-game/ 경로에서 서비스되므로,
// GitHub Actions에서 빌드할 때만 base 경로를 저장소 이름으로 바꾼다.
// 로컬 개발(npm run dev)에서는 '/' 그대로 사용한다.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/read-me-game/' : '/',
});

import { defineConfig } from 'vite';

// GitHub Pages는 https://<사용자>.github.io/<저장소 이름>/ 경로에서 서비스된다.
// GitHub Actions는 실행 시 GITHUB_REPOSITORY 환경 변수에 "<사용자>/<저장소 이름>"을 넣어주므로,
// 거기서 저장소 이름을 읽어 base 경로로 쓴다. → 저장소 이름을 바꿔도 이 파일은 고칠 필요가 없다.
// 로컬 개발(npm run dev)에서는 이 변수가 없으므로 '/'를 그대로 쓴다.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repoName ? `/${repoName}/` : '/',
});

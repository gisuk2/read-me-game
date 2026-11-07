import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

// 게임의 진입점.
// Phaser.Game을 만들면 Phaser가 캔버스를 생성하고 게임 루프(매 프레임 update 호출)를 시작한다.
new Phaser.Game({
  type: Phaser.AUTO, // WebGL이 되면 WebGL, 안 되면 Canvas로 자동 선택
  parent: 'game', // index.html의 <div id="game"> 안에 캔버스를 넣는다
  width: 960,
  height: 540,
  backgroundColor: '#ffffff', // 미니멀 비주얼: 흰 배경
  scene: [BootScene],
});

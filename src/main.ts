import Phaser from "phaser";
import { TitleScene } from "@scenes/TitleScene";
import { BattleScene } from "@scenes/BattleScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#14121f",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  scene: [TitleScene, BattleScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

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
  // BattleScene is first, so the game boots straight into its click-to-begin
  // overlay. TitleScene stays registered for the full title→battle flow later.
  scene: [BattleScene, TitleScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

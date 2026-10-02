import Phaser from "phaser";
import { TitleScene } from "@scenes/TitleScene";
import { CreatureSelectScene } from "@scenes/CreatureSelectScene";
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
  // Flow: Title (enable mic, say START) → Select (say a creature name) →
  // Battle. The mic stays live across all three (shared VoiceModule).
  scene: [TitleScene, CreatureSelectScene, BattleScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

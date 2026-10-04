import Phaser from "phaser";
import { TitleScene } from "@scenes/TitleScene";
import { CreatureSelectScene } from "@scenes/CreatureSelectScene";
import { CalibrationScene } from "@scenes/CalibrationScene";
import { BattleScene } from "@scenes/BattleScene";
import { LineupScene } from "@scenes/LineupScene";

// ?lineup boots a debug check view of every creature at battle size.
const lineup = new URLSearchParams(window.location.search).has("lineup");

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
  scene: lineup
    ? [LineupScene]
    : [TitleScene, CreatureSelectScene, CalibrationScene, BattleScene],
};

// eslint-disable-next-line no-new
new Phaser.Game(config);

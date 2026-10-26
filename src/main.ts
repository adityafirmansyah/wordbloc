import Phaser from 'phaser';
import { createGameConfig } from './game/config';
import { assertLevelData } from './game/levels';
import { gateCurrentViewport } from './ui/viewportGate';

/**
 * Boot entry. The level MANIFEST is validated here, so a malformed manifest or a
 * row pointing at a missing file fails loudly with a readable message instead of
 * surfacing mid-game. Individual level files stay lazy — validating all of them
 * at boot would defeat the point of splitting them out.
 */
function start(): void {
  const parent = document.getElementById('game');
  if (!parent) throw new Error('WordBloc: #game container is missing from index.html.');

  // Validate the manifest contract before Phaser boots. Throws LevelContractError.
  assertLevelData();

  const game = new Phaser.Game(createGameConfig(parent));

  // Touch-target gate: below scale 0.5 no fixed design size can reach 64 CSS px, so
  // an overlay asks the player to rotate / enlarge instead of serving tiny tiles.
  // (Under Scale.RESIZE the canvas is already full-bleed; this only decides whether
  // the playable stage is presented at all.)
  const syncGate = (): void => {
    gateCurrentViewport(window);
  };
  syncGate();
  window.addEventListener('resize', syncGate);
  window.addEventListener('orientationchange', syncGate);

  // Expose for e2e/QA probing only; not used by gameplay.
  (window as Window & { __WORDblocGame?: Phaser.Game }).__WORDblocGame = game;
}

try {
  start();
} catch (error) {
  const box = document.getElementById('boot-failure');
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (box) {
    box.textContent = `WordBloc failed to start.\n\n${message}`;
    box.classList.add('visible');
  }
  // Rethrow so the failure is a real console error, not a swallowed one.
  throw error;
}

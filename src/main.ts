import Phaser from 'phaser';
import { createGameConfig } from './game/config';
import { parseLevelPack } from './game/levelLoader';
import rawLevels from './data/levels.json';

/**
 * Boot entry. Level data is validated ONCE here, so a malformed levels.json
 * fails loudly with a readable message instead of surfacing mid-game.
 */
function start(): void {
  const parent = document.getElementById('game');
  if (!parent) throw new Error('WordBloc: #game container is missing from index.html.');

  // Validate the frozen contract before Phaser boots. Throws LevelContractError.
  parseLevelPack(rawLevels);

  const game = new Phaser.Game(createGameConfig(parent));

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

import { allLevels } from './levels';
import { wordbook } from './wordbook';

/**
 * Session progress: which levels are unlocked and which one to resume.
 * Unlock rule (v1): level 1 is always open; completing a level unlocks the next.
 * Wordbook completion is the source of truth, so progress survives reloads.
 */

export function isUnlocked(levelId: string, index?: number): boolean {
  const levels = allLevels();
  const at = index ?? levels.findIndex((level) => level.id === levelId);
  if (at <= 0) return at === 0;
  const previous = levels[at - 1];
  if (!previous) return false;
  return wordbook().has(previous.id);
}

export function atLeastOneCompleted(): boolean {
  return wordbook().count() > 0;
}

/**
 * The level to open on "Play": the first uncompleted unlocked level, else the
 * last level (so a fully-complete wordbook still lets you replay).
 */
export function resumeLevelId(): string {
  const levels = allLevels();
  const book = wordbook();
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    if (!level) continue;
    if (!book.has(level.id)) {
      // Unlocked only if the previous is done (index 0 is always unlocked).
      if (i === 0 || (levels[i - 1] && book.has(levels[i - 1]!.id))) return level.id;
    }
  }
  const last = levels[levels.length - 1];
  return last ? last.id : 'lvl_0001';
}

/** Highest tier reached, used for the menu readout. */
export function highestUnlockedTier(): number {
  const levels = allLevels();
  for (let i = 0; i < levels.length; i += 1) {
    if (!isUnlocked(levels[i]!.id, i)) {
      const prev = levels[i - 1];
      return prev ? prev.tier : 1;
    }
  }
  return levels[levels.length - 1]?.tier ?? 1;
}

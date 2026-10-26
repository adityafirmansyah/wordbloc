import rawLevels from '../data/levels.json';
import { parseLevelPack } from './levelLoader';
import type { Level, LevelPack } from './levelTypes';

/**
 * Single validated level pack for the whole app.
 * Validated at module load so any contract violation fails fast (main.ts also
 * validates eagerly for a clean boot-time error).
 */
let cached: LevelPack | null = null;

export function levelPack(): LevelPack {
  cached ??= parseLevelPack(rawLevels);
  return cached;
}

export function allLevels(): Level[] {
  return levelPack().levels;
}

export function levelCount(): number {
  return levelPack().levels.length;
}

export function levelById(id: string): Level | undefined {
  return levelPack().levels.find((level) => level.id === id);
}

export function levelAt(index: number): Level | undefined {
  return levelPack().levels[index];
}

export function indexOfLevel(id: string): number {
  return levelPack().levels.findIndex((level) => level.id === id);
}

/** Next level after `id`, or null when the pack is exhausted. */
export function nextLevel(id: string): Level | null {
  const index = indexOfLevel(id);
  if (index === -1) return null;
  return levelPack().levels[index + 1] ?? null;
}

/** Level ids grouped by tier, for the menu's tier chips. */
export function levelsByTier(): Map<number, Level[]> {
  const map = new Map<number, Level[]>();
  for (const level of levelPack().levels) {
    const list = map.get(level.tier) ?? [];
    list.push(level);
    map.set(level.tier, list);
  }
  return map;
}

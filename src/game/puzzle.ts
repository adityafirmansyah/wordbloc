import type { Level } from './levelTypes';
import { hashString, shuffleSeeded } from './rng';

/**
 * Pure puzzle logic: what the word needs, what the tray offers, and whether a
 * dropped tile belongs in a given slot. No Phaser imports so it is unit-testable.
 */

/** One cell in the answer row. */
export interface TargetUnit {
  /** The exact string the player must drop here, e.g. "C" / "BUT". */
  unit: string;
  /** Audio key for the phoneme of this position. */
  phoneme: string;
}

/**
 * The ordered units that spell the word.
 * letter_drag -> one unit per character; chunk mechanics -> the `chunks` array.
 */
export function targetUnits(level: Level): TargetUnit[] {
  const units = level.chunks && level.chunks.length > 0 ? level.chunks : [...level.word];
  return units.map((unit, index) => ({
    unit,
    phoneme:
      level.audio_phonemes[index] ?? level.audio_phonemes[level.audio_phonemes.length - 1] ?? '',
  }));
}

/** A tray item: a draggable tile with a stable identity. */
export interface TrayItem {
  /** Unique per tray instance, so duplicate letters stay distinguishable. */
  uid: string;
  unit: string;
  /** True for extra tiles that do not belong in the answer. */
  isDistractor: boolean;
}

/**
 * Builds the shuffled tray: `tiles` + `distractors`, shuffled with a seed
 * derived from the level id so the layout is stable per level (reproducible
 * bug reports) while still not pre-shuffled in the JSON.
 */
export function buildTray(level: Level): TrayItem[] {
  const all = [
    ...level.tiles.map((unit) => ({ unit, isDistractor: false })),
    ...level.distractors.map((unit) => ({ unit, isDistractor: true })),
  ];
  const shuffled = shuffleSeeded(all, hashString(level.id));
  return shuffled.map((item, index) => ({
    uid: `${level.id}_t${index}`,
    unit: item.unit,
    isDistractor: item.isDistractor,
  }));
}

/** Does `unit` belong in `slotIndex`? */
export function unitFitsSlot(level: Level, slotIndex: number, unit: string): boolean {
  const target = targetUnits(level)[slotIndex];
  return target !== undefined && target.unit === unit;
}

/** First slot index that `unit` correctly fills, or -1. */
export function firstFittingSlot(
  level: Level,
  unit: string,
  filled: readonly (string | null)[],
): number {
  const units = targetUnits(level);
  for (let i = 0; i < units.length; i += 1) {
    const target = units[i];
    if (target === undefined) continue;
    if (target.unit === unit && (filled[i] ?? null) === null) return i;
  }
  return -1;
}

export function isPuzzleComplete(level: Level, filled: readonly (string | null)[]): boolean {
  const units = targetUnits(level);
  if (filled.length !== units.length) return false;
  return units.every((target, index) => filled[index] === target.unit);
}

/** Number of slots already filled correctly. */
export function progress(filled: readonly (string | null)[]): number {
  return filled.reduce<number>((acc, value) => (value !== null ? acc + 1 : acc), 0);
}

/**
 * Which tray items are still needed, given the current fill.
 * Used to grey out impossible states and to size the "ghost letter" hints.
 */
export function remainingRequirement(level: Level, filled: readonly (string | null)[]): string[] {
  const units = targetUnits(level);
  const out: string[] = [];
  for (let i = 0; i < units.length; i += 1) {
    const target = units[i];
    if (target === undefined) continue;
    if ((filled[i] ?? null) === null) out.push(target.unit);
  }
  return out;
}

/**
 * The single mechanic-agnostic rule used by the drag loop.
 * Returns the slot to snap into, or null when the tile should bounce back.
 */
export function resolveDrop(
  level: Level,
  unit: string,
  droppedSlotIndex: number,
  filled: readonly (string | null)[],
): { snapTo: number } | { snapTo: null; reason: 'wrong_slot' | 'occupied' } {
  const units = targetUnits(level);
  const target = units[droppedSlotIndex];
  if (target === undefined) return { snapTo: null, reason: 'wrong_slot' };
  if ((filled[droppedSlotIndex] ?? null) !== null) return { snapTo: null, reason: 'occupied' };
  if (target.unit !== unit) return { snapTo: null, reason: 'wrong_slot' };
  return { snapTo: droppedSlotIndex };
}

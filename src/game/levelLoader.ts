import {
  LevelContractError,
  MECHANICS,
  TIERS,
  type Level,
  type LevelPack,
  type Mechanic,
  type Tier,
} from './levelTypes';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === 'string');

const isMechanic = (v: unknown): v is Mechanic =>
  typeof v === 'string' && (MECHANICS as readonly string[]).includes(v);

const isTier = (v: unknown): v is Tier =>
  typeof v === 'number' && (TIERS as readonly number[]).includes(v);

function requireString(raw: Record<string, unknown>, field: string, id: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new LevelContractError(
      `Level "${id}" is missing required string field "${field}".`,
      id,
      field,
    );
  }
  return value;
}

/**
 * Validates one unknown object into a Level.
 * Throws LevelContractError with a readable, level-scoped message.
 */
export function parseLevel(raw: unknown, index: number): Level {
  if (!isRecord(raw)) {
    throw new LevelContractError(`Level at index ${index} is not an object.`);
  }

  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `#${index}`;

  if (!isMechanic(raw.mechanic)) {
    throw new LevelContractError(
      `Level "${id}" has unknown mechanic ${JSON.stringify(raw.mechanic)}. ` +
        `Expected one of: ${MECHANICS.join(', ')}.`,
      id,
      'mechanic',
    );
  }
  const mechanic = raw.mechanic;

  if (!isTier(raw.tier)) {
    throw new LevelContractError(
      `Level "${id}" has invalid tier ${JSON.stringify(raw.tier)}. Expected 1-5.`,
      id,
      'tier',
    );
  }
  const tier = raw.tier;

  if (!isStringArray(raw.tiles) || raw.tiles.length === 0) {
    throw new LevelContractError(
      `Level "${id}" is missing "tiles" — a non-empty array of tile strings is required.`,
      id,
      'tiles',
    );
  }
  const tiles = raw.tiles;

  // chunks: required (non-empty) for the chunk-driven mechanics, null/absent otherwise.
  const needsChunks = mechanic !== 'letter_drag';
  const rawChunks = raw.chunks ?? null;
  if (needsChunks) {
    if (!isStringArray(rawChunks) || rawChunks.length === 0) {
      throw new LevelContractError(
        `Level "${id}" uses mechanic "${mechanic}" but is missing "chunks" — ` +
          `a non-empty array of chunk strings is required.`,
        id,
        'chunks',
      );
    }
  } else if (rawChunks !== null && !isStringArray(rawChunks)) {
    throw new LevelContractError(
      `Level "${id}" has invalid "chunks": expected null or an array of strings.`,
      id,
      'chunks',
    );
  }
  const chunks = needsChunks ? rawChunks : (rawChunks as string[] | null);

  const distractors = raw.distractors ?? [];
  if (!isStringArray(distractors)) {
    throw new LevelContractError(
      `Level "${id}" has invalid "distractors": expected an array of strings.`,
      id,
      'distractors',
    );
  }

  const audioPhonemes = raw.audio_phonemes ?? [];
  if (!isStringArray(audioPhonemes)) {
    throw new LevelContractError(
      `Level "${id}" has invalid "audio_phonemes": expected an array of strings.`,
      id,
      'audio_phonemes',
    );
  }

  const word = requireString(raw, 'word', id);

  // Guard: the tray must be able to spell the word. Catches typos in seed data.
  const required = isStringArray(chunks) && chunks.length > 0 ? chunks : [...word];
  const available = [...tiles];
  for (const unit of required) {
    const at = available.indexOf(unit);
    if (at === -1) {
      throw new LevelContractError(
        `Level "${id}" cannot be completed: "${unit}" is needed for "${word}" but is not in "tiles".`,
        id,
        'tiles',
      );
    }
    available.splice(at, 1);
  }

  return {
    id,
    tier,
    word,
    display: requireString(raw, 'display', id),
    meaning_id: typeof raw.meaning_id === 'string' ? raw.meaning_id : '',
    category: typeof raw.category === 'string' ? raw.category : 'misc',
    mechanic,
    image: requireString(raw, 'image', id),
    audio_word: requireString(raw, 'audio_word', id),
    audio_phonemes: audioPhonemes,
    tiles,
    distractors,
    chunks: chunks as string[] | null,
    hint: typeof raw.hint === 'string' ? raw.hint : '',
    ghost_letters: raw.ghost_letters === true,
  };
}

/** Validates the whole pack. Throws on the first contract violation. */
export function parseLevelPack(raw: unknown): LevelPack {
  if (!isRecord(raw)) {
    throw new LevelContractError('Level pack root is not an object.');
  }
  if (typeof raw.version !== 'number') {
    throw new LevelContractError('Level pack is missing numeric "version".', null, 'version');
  }
  if (!Array.isArray(raw.levels) || raw.levels.length === 0) {
    throw new LevelContractError('Level pack is missing non-empty "levels" array.', null, 'levels');
  }

  const seen = new Set<string>();
  const levels = raw.levels.map((entry, index) => {
    const level = parseLevel(entry, index);
    if (seen.has(level.id)) {
      throw new LevelContractError(`Duplicate level id "${level.id}".`, level.id, 'id');
    }
    seen.add(level.id);
    return level;
  });

  return { version: raw.version, levels };
}

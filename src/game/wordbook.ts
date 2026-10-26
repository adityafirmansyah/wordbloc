/**
 * Wordbook persistence — completed words survive a reload via localStorage.
 * Every operation is defensive: a missing/blocked/corrupt store degrades to
 * an in-memory wordbook instead of throwing.
 */

export const WORDBOOK_STORAGE_KEY = 'wordbloc.wordbook.v1';

export interface WordbookEntry {
  /** Level id, e.g. "lvl_0001". Unique — completing twice keeps one entry. */
  levelId: string;
  word: string;
  display: string;
  tier: number;
  category: string;
  /** Audio key for replay in the Wordbook screen. */
  audioWord: string;
  meaningId: string;
  /** Epoch ms of first completion. */
  completedAt: number;
}

export interface WordbookState {
  version: 1;
  entries: WordbookEntry[];
}

const EMPTY: WordbookState = { version: 1, entries: [] };

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const probe = '__wordbloc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is WordbookEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.levelId === 'string' &&
    v.levelId.length > 0 &&
    typeof v.word === 'string' &&
    typeof v.display === 'string' &&
    typeof v.tier === 'number' &&
    typeof v.audioWord === 'string'
  );
}

function normalizeEntry(value: unknown): WordbookEntry | null {
  if (!isEntry(value)) return null;
  const v = value as WordbookEntry;
  return {
    levelId: v.levelId,
    word: v.word,
    display: v.display,
    tier: v.tier,
    category: typeof v.category === 'string' ? v.category : 'misc',
    audioWord: v.audioWord,
    meaningId: typeof v.meaningId === 'string' ? v.meaningId : '',
    completedAt: typeof v.completedAt === 'number' ? v.completedAt : 0,
  };
}

export class Wordbook {
  private readonly storage: StorageLike | null;
  private state: WordbookState;
  private memoryOnly: boolean;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.memoryOnly = storage === null;
    this.state = this.read();
  }

  /** True when the browser refused storage and we are memory-only. */
  isMemoryOnly(): boolean {
    return this.memoryOnly;
  }

  private read(): WordbookState {
    if (!this.storage) return { ...EMPTY, entries: [] };
    let raw: string | null = null;
    try {
      raw = this.storage.getItem(WORDBOOK_STORAGE_KEY);
    } catch {
      this.memoryOnly = true;
      return { ...EMPTY, entries: [] };
    }
    if (!raw) return { ...EMPTY, entries: [] };
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY, entries: [] };
      const entriesRaw = (parsed as { entries?: unknown }).entries;
      if (!Array.isArray(entriesRaw)) return { ...EMPTY, entries: [] };
      const entries = entriesRaw
        .map(normalizeEntry)
        .filter((entry): entry is WordbookEntry => entry !== null);
      return { version: 1, entries: dedupe(entries) };
    } catch {
      // corrupt payload: start clean rather than crash the game
      return { ...EMPTY, entries: [] };
    }
  }

  private write(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(WORDBOOK_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      this.memoryOnly = true;
    }
  }

  entries(): WordbookEntry[] {
    return [...this.state.entries];
  }

  count(): number {
    return this.state.entries.length;
  }

  has(levelId: string): boolean {
    return this.state.entries.some((entry) => entry.levelId === levelId);
  }

  get(levelId: string): WordbookEntry | undefined {
    return this.state.entries.find((entry) => entry.levelId === levelId);
  }

  /** Records a completion. Returns true when this was a NEW word. */
  record(entry: Omit<WordbookEntry, 'completedAt'> & { completedAt?: number }): boolean {
    if (this.has(entry.levelId)) return false;
    const full: WordbookEntry = {
      levelId: entry.levelId,
      word: entry.word,
      display: entry.display,
      tier: entry.tier,
      category: entry.category,
      audioWord: entry.audioWord,
      meaningId: entry.meaningId,
      completedAt: entry.completedAt ?? Date.now(),
    };
    this.state = { version: 1, entries: [...this.state.entries, full] };
    this.write();
    return true;
  }

  clear(): void {
    this.state = { ...EMPTY, entries: [] };
    this.write();
  }
}

function dedupe(entries: WordbookEntry[]): WordbookEntry[] {
  const seen = new Set<string>();
  const out: WordbookEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.levelId)) continue;
    seen.add(entry.levelId);
    out.push(entry);
  }
  return out;
}

/** Single shared instance for the app. */
let shared: Wordbook | null = null;

export function wordbook(): Wordbook {
  shared ??= new Wordbook();
  return shared;
}

/** Test seam: swap the shared instance. */
export function setSharedWordbook(instance: Wordbook | null): void {
  shared = instance;
}

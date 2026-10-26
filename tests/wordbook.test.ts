import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORDBOOK_STORAGE_KEY, Wordbook, setSharedWordbook, wordbook } from '../src/game/wordbook';

/** In-memory StorageLike double. */
function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => data.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      data.set(key, value);
    },
    dump: (): Record<string, string> => Object.fromEntries(data),
  };
}

const entry = {
  levelId: 'lvl_0001',
  word: 'CAT',
  display: 'cat',
  tier: 1,
  category: 'animals',
  audioWord: 'words/cat',
  meaningId: 'kucing',
};

beforeEach(() => {
  setSharedWordbook(null);
});

describe('Wordbook — persistence', () => {
  it('starts empty', () => {
    const book = new Wordbook(makeStorage());
    expect(book.count()).toBe(0);
    expect(book.entries()).toEqual([]);
  });

  it('records a completion and reports it as new', () => {
    const book = new Wordbook(makeStorage());
    expect(book.record(entry)).toBe(true);
    expect(book.count()).toBe(1);
    expect(book.has('lvl_0001')).toBe(true);
    expect(book.get('lvl_0001')?.word).toBe('CAT');
  });

  it('does not duplicate an already-collected word', () => {
    const book = new Wordbook(makeStorage());
    book.record(entry);
    expect(book.record(entry)).toBe(false);
    expect(book.count()).toBe(1);
  });

  it('writes through to storage and survives a "reload"', () => {
    const storage = makeStorage();
    new Wordbook(storage).record(entry);
    const raw = storage.dump()[WORDBOOK_STORAGE_KEY];
    expect(raw).toBeTruthy();

    const reloaded = new Wordbook(storage);
    expect(reloaded.count()).toBe(1);
    expect(reloaded.get('lvl_0001')?.audioWord).toBe('words/cat');
  });

  it('stamps completedAt', () => {
    const book = new Wordbook(makeStorage());
    book.record(entry);
    expect(book.get('lvl_0001')?.completedAt).toBeGreaterThan(0);
  });

  it('clears', () => {
    const book = new Wordbook(makeStorage());
    book.record(entry);
    book.clear();
    expect(book.count()).toBe(0);
  });
});

describe('Wordbook — graceful degradation', () => {
  it('works memory-only when storage is unavailable', () => {
    const book = new Wordbook(null);
    expect(book.isMemoryOnly()).toBe(true);
    expect(book.record(entry)).toBe(true);
    expect(book.count()).toBe(1);
  });

  it('survives a corrupt payload instead of crashing', () => {
    const book = new Wordbook(makeStorage({ [WORDBOOK_STORAGE_KEY]: '{not json' }));
    expect(book.count()).toBe(0);
  });

  it('survives a payload with the wrong shape', () => {
    const book = new Wordbook(makeStorage({ [WORDBOOK_STORAGE_KEY]: '{"entries":"nope"}' }));
    expect(book.count()).toBe(0);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const payload = JSON.stringify({
      version: 1,
      entries: [entry, { levelId: 5 }, { junk: true }, null],
    });
    const book = new Wordbook(makeStorage({ [WORDBOOK_STORAGE_KEY]: payload }));
    expect(book.count()).toBe(1);
    expect(book.get('lvl_0001')?.word).toBe('CAT');
  });

  it('dedupes a payload that was written twice', () => {
    const payload = JSON.stringify({ version: 1, entries: [entry, entry] });
    const book = new Wordbook(makeStorage({ [WORDBOOK_STORAGE_KEY]: payload }));
    expect(book.count()).toBe(1);
  });

  it('degrades to memory-only when setItem throws (quota / private mode)', () => {
    const storage = {
      getItem: (): string | null => null,
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
    };
    const book = new Wordbook(storage);
    expect(() => book.record(entry)).not.toThrow();
    expect(book.count()).toBe(1);
    expect(book.isMemoryOnly()).toBe(true);
  });

  it('degrades when getItem throws', () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => undefined,
    };
    const book = new Wordbook(storage);
    expect(book.count()).toBe(0);
    expect(book.isMemoryOnly()).toBe(true);
  });
});

describe('wordbook() singleton', () => {
  it('returns one shared instance', () => {
    expect(wordbook()).toBe(wordbook());
  });

  it('can be swapped for tests', () => {
    const fake = new Wordbook(makeStorage());
    setSharedWordbook(fake);
    expect(wordbook()).toBe(fake);
  });
});

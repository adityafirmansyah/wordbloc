import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioManager,
  MAX_CLIPS,
  MediaElementEngine,
  RESUME_TIMEOUT_MS,
  SILENT_PHONEME,
  START_TIMEOUT_MS,
  WebAudioEngine,
  audioKeysForLevel,
  phonemeToSpeakable,
  type AudioContextLike,
  type AudioEngine,
  type AudioSource,
  type AudioBufferSourceLike,
  type MediaElementLike,
  type PreparedClip,
} from '../src/game/audio';

/**
 * Audio suite for the REAL mp3 pack (public/assets/audio/).
 *
 * v1 shipped no audio and this facade was a no-op. It now plays recorded clips
 * from `assets/audio/<key>.mp3` through Web Audio (primary) or an
 * HTMLAudioElement (fallback), so these tests pin:
 *   1. routing — key -> exact file path (`phonemes/k` -> .../phonemes/k.mp3);
 *   2. the phonics contract — a tile placement requests the PHONEME clip, never a
 *      letter-name clip, and the explicit silent key requests NOTHING (there is no
 *      silent.mp3, so asking would be a guaranteed 404);
 *   3. degradation — Web Speech takes over ONLY when the file itself failed, not
 *      when autoplay was blocked or the word was muted;
 *   4. no hangs — every `play*` promise settles, including a stalled media element.
 */

/** Strip the Vite base prefix so tests assert the PACK path, not the deploy base. */
function packPath(url: string): string {
  return url.replace(/^\.?\//, '');
}

/** Engine double: records every prepare/play/stop call. */
function makeEngine(
  plan: { prepare?: (src: AudioSource) => Error | null; play?: Error | null } = {},
) {
  const prepared: AudioSource[] = [];
  const played: PreparedClip[] = [];
  const stopped: PreparedClip[] = [];

  const engine: AudioEngine = {
    prepare: (source) => {
      prepared.push(source);
      const failure = plan.prepare?.(source) ?? null;
      return failure ? Promise.reject(failure) : Promise.resolve({ url: source.url });
    },
    play: (clip) => {
      const failure = plan.play ?? null;
      if (failure) return Promise.reject(failure);
      played.push(clip);
      return Promise.resolve();
    },
    stop: (clip) => {
      stopped.push(clip);
    },
    dispose: () => undefined,
  };

  return { engine, prepared, played, stopped };
}

let speechSpeak: ReturnType<typeof vi.fn>;

beforeEach(() => {
  speechSpeak = vi.fn();
  vi.stubGlobal('speechSynthesis', { speak: speechSpeak, cancel: vi.fn() });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      lang = '';
      constructor(text: string) {
        this.text = text;
      }
    },
  );
});

describe('phonemeToSpeakable (phonics contract, unchanged)', () => {
  it('maps a phoneme key to a sound, not a letter name', () => {
    expect(phonemeToSpeakable('phonemes/k')).toBe('k');
    expect(phonemeToSpeakable('phonemes/ae')).toBe('ah');
    expect(phonemeToSpeakable('phonemes/t')).toBe('t');
  });

  it('handles keys without a namespace prefix', () => {
    expect(phonemeToSpeakable('ae')).toBe('ah');
    expect(phonemeToSpeakable('sh')).toBe('shh');
  });

  it('passes unknown phonemes through verbatim', () => {
    expect(phonemeToSpeakable('phonemes/zzz')).toBe('zzz');
  });

  it('never returns the bare letter name for the tricky vowels', () => {
    for (const vowel of ['a', 'e', 'i', 'o', 'u']) {
      const spoken = phonemeToSpeakable(`phonemes/${vowel}`);
      expect(spoken.length).toBeLessThanOrEqual(2);
      expect(spoken.toLowerCase()).not.toBe(vowel);
    }
  });

  it('is empty-safe', () => {
    expect(phonemeToSpeakable('')).toBe('');
  });

  it('treats the explicit silent marker as no sound at all', () => {
    expect(phonemeToSpeakable(SILENT_PHONEME)).toBe('');
    expect(phonemeToSpeakable('phonemes/silent')).toBe('');
  });
});

describe('AudioManager — real mp3 routing', () => {
  it('resolves a phoneme key to the real clip path', async () => {
    const { engine, prepared, played } = makeEngine();
    const audio = new AudioManager({ engine });
    const result = await audio.playPhoneme('phonemes/k');

    expect(prepared.map((s) => packPath(s.url))).toEqual(['assets/audio/phonemes/k.mp3']);
    expect(played).toHaveLength(1);
    expect(result.key).toBe('phonemes/k');
    expect(result.outcome).toBe('file');
    expect(packPath(result.url)).toBe('assets/audio/phonemes/k.mp3');
  });

  it('resolves a word key to the real clip path', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    const result = await audio.playWord('words/cat');
    expect(prepared.map((s) => packPath(s.url))).toEqual(['assets/audio/words/cat.mp3']);
    expect(result.outcome).toBe('file');
  });

  it('urlFor() builds the same URL without touching the network', () => {
    const audio = new AudioManager({ engine: null });
    expect(packPath(audio.urlFor('words/butterfly'))).toBe('assets/audio/words/butterfly.mp3');
    expect(packPath(audio.urlFor('phonemes/ae'))).toBe('assets/audio/phonemes/ae.mp3');
    expect(audio.urlFor(SILENT_PHONEME)).toBe('');
  });

  it('plays the phoneme clip then the word clip, never a letter-name key', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playPhoneme('phonemes/ae');
    await audio.playWord('words/cat');

    const urls = prepared.map((s) => packPath(s.url));
    expect(urls).toEqual(['assets/audio/phonemes/ae.mp3', 'assets/audio/words/cat.mp3']);
    for (const url of urls) expect(url).not.toMatch(/letter|name/i);
  });

  it('prepares once and replays from the pool (no second download)', async () => {
    const { engine, prepared, played } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playPhoneme('phonemes/k');
    await audio.playPhoneme('phonemes/k');
    expect(prepared).toHaveLength(1);
    expect(played).toHaveLength(2);
    expect(audio.has('phonemes/k')).toBe(true);
  });
});

describe('AudioManager — the explicit silent key', () => {
  it('plays silence without requesting a file (no silent.mp3 exists)', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    const result = await audio.playPhoneme(SILENT_PHONEME);
    expect(result).toEqual({ key: SILENT_PHONEME, outcome: 'silent', url: '' });
    expect(prepared).toEqual([]);
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('is not included in a level preload list', () => {
    const keys = audioKeysForLevel({
      audio_word: 'words/house',
      audio_phonemes: ['phonemes/h', 'phonemes/ow', SILENT_PHONEME, 'phonemes/s'],
    });
    expect(keys).toEqual(['words/house', 'phonemes/h', 'phonemes/ow', 'phonemes/s']);
  });
});

describe('AudioManager — preload', () => {
  it('prepares every distinct key a level needs, word first', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    const started = audio.preload(
      audioKeysForLevel({
        audio_word: 'words/cat',
        audio_phonemes: ['phonemes/k', 'phonemes/ae', 'phonemes/t'],
      }),
    );

    expect(started.map(packPath)).toEqual([
      'assets/audio/words/cat.mp3',
      'assets/audio/phonemes/k.mp3',
      'assets/audio/phonemes/ae.mp3',
      'assets/audio/phonemes/t.mp3',
    ]);
    // prepare() is kicked off synchronously; the awaits settle on microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(prepared).toHaveLength(4);
  });

  it('dedupes repeated keys', () => {
    const keys = audioKeysForLevel({
      audio_word: 'words/banana',
      audio_phonemes: ['phonemes/b', 'phonemes/a', 'phonemes/na', 'phonemes/na'],
    });
    expect(keys).toEqual(['words/banana', 'phonemes/b', 'phonemes/a', 'phonemes/na']);
  });

  it('is idempotent: a second preload of the same keys starts nothing new', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.preload(['phonemes/k', 'phonemes/ae']);
    await Promise.resolve();
    await Promise.resolve();
    const before = prepared.length;

    expect(audio.preload(['phonemes/k', 'phonemes/ae'])).toEqual([]);
    expect(prepared).toHaveLength(before);
  });

  it('skips the silent key and empty keys entirely', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    expect(audio.preload([SILENT_PHONEME, '', 'phonemes/k']).map(packPath)).toEqual([
      'assets/audio/phonemes/k.mp3',
    ]);
    await Promise.resolve();
    await Promise.resolve();
    expect(prepared.map((s) => packPath(s.url))).toEqual(['assets/audio/phonemes/k.mp3']);
  });

  it('starts nothing when there is no engine', () => {
    const audio = new AudioManager({ engine: null });
    expect(audio.preload(['phonemes/k'])).toEqual([]);
  });
});

describe('AudioManager — graceful degradation', () => {
  it('falls back to speech when the file cannot be prepared', async () => {
    const { engine } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    const result = await audio.playPhoneme('phonemes/k');
    expect(result.outcome).toBe('speech');
    expect(speechSpeak).toHaveBeenCalledTimes(1);
    expect(audio.hasFailed('phonemes/k')).toBe(true);
  });

  it('does not re-request a clip it already knows is broken', async () => {
    const { engine, prepared } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    await audio.playPhoneme('phonemes/k');
    const before = prepared.length;
    const second = await audio.playPhoneme('phonemes/k');
    expect(prepared).toHaveLength(before);
    expect(second.outcome).toBe('speech');
  });

  it('does NOT synthesise when autoplay was blocked (the file is fine)', async () => {
    const blocked = new Error('blocked');
    blocked.name = 'NotAllowedError';
    const { engine } = makeEngine({ play: blocked });
    const audio = new AudioManager({ engine });

    const result = await audio.playPhoneme('phonemes/k');
    expect(result.outcome).toBe('silent');
    expect(speechSpeak).not.toHaveBeenCalled();
    // Crucially not marked broken: the next tap (a real gesture) must play it.
    expect(audio.hasFailed('phonemes/k')).toBe(false);
  });

  it('does not synthesise when the clip was aborted by us', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const { engine } = makeEngine({ play: aborted });
    const audio = new AudioManager({ engine });
    expect((await audio.playWord('words/cat')).outcome).toBe('silent');
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('falls back to speech when playback fails for a non-policy reason', async () => {
    const { engine } = makeEngine({ play: new Error('decode blew up') });
    const audio = new AudioManager({ engine });
    expect((await audio.playPhoneme('phonemes/k')).outcome).toBe('speech');
  });

  it('never throws for an empty key and does not touch the network', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    expect((await audio.playPhoneme('')).outcome).toBe('silent');
    expect((await audio.playWord('')).outcome).toBe('silent');
    expect(prepared).toEqual([]);
  });

  it('survives when no engine exists at all', async () => {
    const audio = new AudioManager({ engine: null });
    const result = await audio.playPhoneme('phonemes/k');
    expect(['speech', 'silent']).toContain(result.outcome);
  });

  it('is silent when the file failed and Web Speech is absent entirely', async () => {
    vi.unstubAllGlobals();
    const { engine } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    expect((await audio.playPhoneme('phonemes/k')).outcome).toBe('silent');
  });

  it('survives a speech API that throws', async () => {
    vi.stubGlobal('speechSynthesis', {
      speak: (): void => {
        throw new Error('speech blocked');
      },
      cancel: vi.fn(),
    });
    const { engine } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    await expect(audio.playPhoneme('phonemes/k')).resolves.toMatchObject({ outcome: 'silent' });
  });

  it('survives an engine whose prepare throws synchronously', async () => {
    const engine: AudioEngine = {
      prepare: () => {
        throw new Error('sync throw');
      },
      play: () => Promise.resolve(),
      stop: () => undefined,
      dispose: () => undefined,
    };
    const audio = new AudioManager({ engine });
    await expect(audio.playPhoneme('phonemes/k')).resolves.toMatchObject({ outcome: 'speech' });
  });
});

describe('AudioManager — mute', () => {
  it('goes silent (without speech) when muted, and prepares nothing', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);
    expect(audio.isEnabled()).toBe(false);
    expect(await audio.playWord('words/cat')).toEqual({
      key: 'words/cat',
      outcome: 'silent',
      url: '',
    });
    expect(prepared).toEqual([]);
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('stops pooled clips when muted mid-word', async () => {
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playWord('words/cat');
    audio.setEnabled(false);
    expect(stopped.length).toBeGreaterThan(0);
  });

  it('plays again after being unmuted', async () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);
    audio.setEnabled(true);
    expect((await audio.playWord('words/cat')).outcome).toBe('file');
  });
});

describe('AudioManager — clip pool bounds (2GB-RAM Android target)', () => {
  it('keeps at most maxClips clips pooled', async () => {
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine, maxClips: 4 });
    for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
      await audio.playPhoneme(`phonemes/${key}`);
    }
    // Four pooled, the two oldest stopped on eviction.
    expect(stopped).toHaveLength(2);
  });

  it('the default cap covers a level and a Wordbook page', () => {
    // Longest level: 9 slots + the word. Wordbook page: 9 cards.
    expect(MAX_CLIPS).toBeGreaterThanOrEqual(10);
  });

  it('release() stops and drops everything', async () => {
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playWord('words/cat');
    await audio.playPhoneme('phonemes/k');
    audio.release();
    expect(stopped).toHaveLength(2);
    expect(audio.has('words/cat')).toBe(false);
  });

  it('release() is safe to call twice and on an empty pool', () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    expect(() => {
      audio.release();
      audio.release();
    }).not.toThrow();
  });
});

describe('AudioManager — unlock (autoplay policy)', () => {
  it('forwards unlock() to the engine', async () => {
    let unlocked = 0;
    const engine: AudioEngine = {
      prepare: (src) => Promise.resolve({ url: src.url }),
      play: () => Promise.resolve(),
      stop: () => undefined,
      unlock: () => {
        unlocked += 1;
        return Promise.resolve();
      },
      dispose: () => undefined,
    };
    const audio = new AudioManager({ engine });
    await audio.unlock();
    expect(unlocked).toBe(1);
  });

  it('does not unlock while muted', async () => {
    let unlocked = 0;
    const engine: AudioEngine = {
      prepare: (src) => Promise.resolve({ url: src.url }),
      play: () => Promise.resolve(),
      stop: () => undefined,
      unlock: () => {
        unlocked += 1;
        return Promise.resolve();
      },
      dispose: () => undefined,
    };
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);
    await audio.unlock();
    expect(unlocked).toBe(0);
  });

  it('never rejects, even when the engine throws', async () => {
    const engine: AudioEngine = {
      prepare: (src) => Promise.resolve({ url: src.url }),
      play: () => Promise.resolve(),
      stop: () => undefined,
      unlock: () => Promise.reject(new Error('blocked')),
      dispose: () => undefined,
    };
    const audio = new AudioManager({ engine });
    await expect(audio.unlock()).resolves.toBeUndefined();
  });
});

describe('AudioManager — telemetry', () => {
  it('records what it last attempted', async () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playWord('words/cat');
    const last = audio.lastPlayed();
    expect(last.key).toBe('words/cat');
    expect(last.outcome).toBe('file');
    expect(packPath(last.url)).toBe('assets/audio/words/cat.mp3');
  });
});

// ------------------------------------------------------------------- engines

/** Fake AudioContext: `plan` decides decode success and the initial state. */
function makeContext(plan: { decode?: Error | null; state?: string } = {}) {
  const started: AudioBufferSourceLike[] = [];
  const stopped: AudioBufferSourceLike[] = [];
  let resumed = 0;
  let closed = 0;

  const context: AudioContextLike & {
    started: AudioBufferSourceLike[];
    stoppedSources: AudioBufferSourceLike[];
    resumed: () => number;
    closed: () => number;
  } = {
    state: plan.state ?? 'running',
    destination: 'dest',
    currentTime: 0,
    started,
    stoppedSources: stopped,
    resumed: () => resumed,
    closed: () => closed,
    resume: () => {
      resumed += 1;
      // A real context flips to 'running' once a gesture satisfies the policy.
      context.state = 'running';
      return Promise.resolve();
    },
    decodeAudioData: () =>
      plan.decode ? Promise.reject(plan.decode) : Promise.resolve({ duration: 0.367 }),
    createBufferSource: () => {
      const source: AudioBufferSourceLike = {
        buffer: null,
        onended: null,
        connect: () => undefined,
        start: () => {
          started.push(source);
        },
        stop: () => {
          stopped.push(source);
        },
      };
      return source;
    },
    close: () => {
      closed += 1;
      return Promise.resolve();
    },
  };

  return context;
}

/** Fake fetch: `plan` decides the response per URL. */
function makeFetch(
  plan: (url: string) => { ok?: boolean; status?: number } = () => ({ ok: true }),
) {
  const requested: string[] = [];
  const fetchImpl = (url: string) => {
    requested.push(url);
    const result = plan(url);
    return Promise.resolve({
      ok: result.ok ?? true,
      status: result.status ?? 200,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  };
  return { fetchImpl, requested };
}

describe('WebAudioEngine', () => {
  it('fetches then decodes the clip', async () => {
    const context = makeContext();
    const { fetchImpl, requested } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' });

    expect(requested).toEqual(['assets/audio/words/cat.mp3']);
    expect(clip.url).toBe('assets/audio/words/cat.mp3');
  });

  it('reports a 404 as a prepare failure (so the manager can synthesise)', async () => {
    const context = makeContext();
    const { fetchImpl } = makeFetch(() => ({ ok: false, status: 404 }));
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    await expect(
      engine.prepare({ key: 'phonemes/zzz', url: 'assets/audio/phonemes/zzz.mp3' }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('reports undecodable bytes as a prepare failure', async () => {
    const context = makeContext({ decode: new Error('EncodingError') });
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    await expect(
      engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' }),
    ).rejects.toThrow(/not decodable/);
  });

  it('reports a network failure as a prepare failure', async () => {
    const context = makeContext();
    const engine = new WebAudioEngine({
      contextFactory: () => context,
      fetchImpl: () => Promise.reject(new Error('offline')),
    });
    await expect(
      engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' }),
    ).rejects.toThrow(/could not fetch/);
  });

  it('starts playback synchronously from the decoded buffer', async () => {
    const context = makeContext();
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await engine.play(clip);

    expect(context.started).toHaveLength(1);
    expect(context.resumed()).toBe(0); // context already running
  });

  it('resumes a suspended context (autoplay policy) before starting', async () => {
    const context = makeContext({ state: 'suspended' });
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await engine.play(clip);

    expect(context.resumed()).toBe(1);
    expect(context.started).toHaveLength(1);
  });

  it('reports a refused resume as NotAllowedError (policy, not a broken file)', async () => {
    const context = makeContext({ state: 'suspended' });
    context.resume = () => Promise.reject(new Error('no gesture'));
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await expect(engine.play(clip)).rejects.toMatchObject({ name: 'NotAllowedError' });
  });

  it('does not HANG when resume() never settles (measured in headless Chrome)', async () => {
    // Chrome leaves AudioContext.resume() pending forever without a user gesture.
    // An unbounded await here used to freeze every play() caller.
    vi.useFakeTimers();
    try {
      const context = makeContext({ state: 'suspended' });
      context.resume = () => new Promise<void>(() => undefined);
      const { fetchImpl } = makeFetch();
      const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

      const clip = await engine.prepare({
        key: 'phonemes/k',
        url: 'assets/audio/phonemes/k.mp3',
      });
      // Attach the rejection handler BEFORE advancing timers, or the rejection is
      // unhandled for a tick (fake timers fire it synchronously inside advance).
      const settled = expect(engine.play(clip)).rejects.toMatchObject({
        name: 'NotAllowedError',
      });
      await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 10);

      // Settles as a policy block: silent, not a broken file.
      await settled;
      expect(context.started).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unlock() resumes a suspended context', async () => {
    const context = makeContext({ state: 'suspended' });
    const engine = new WebAudioEngine({
      contextFactory: () => context,
      fetchImpl: makeFetch().fetchImpl,
    });
    await engine.unlock();
    expect(context.resumed()).toBe(1);
    expect(context.state).toBe('running');
  });

  it('unlock() is a no-op on a running context and never throws', async () => {
    const context = makeContext({ state: 'running' });
    const engine = new WebAudioEngine({
      contextFactory: () => context,
      fetchImpl: makeFetch().fetchImpl,
    });
    await expect(engine.unlock()).resolves.toBeUndefined();
    expect(context.resumed()).toBe(0);
  });

  it('unlock() does not hang on a stalled resume()', async () => {
    vi.useFakeTimers();
    try {
      const context = makeContext({ state: 'suspended' });
      context.resume = () => new Promise<void>(() => undefined);
      const engine = new WebAudioEngine({
        contextFactory: () => context,
        fetchImpl: makeFetch().fetchImpl,
      });
      const pending = engine.unlock();
      await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT_MS + 10);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() cuts the running source', async () => {
    const context = makeContext();
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await engine.play(clip);
    engine.stop(clip);
    expect(context.stoppedSources).toHaveLength(1);
  });

  it('dispose() stops everything and closes the context', async () => {
    const context = makeContext();
    const { fetchImpl } = makeFetch();
    const engine = new WebAudioEngine({ contextFactory: () => context, fetchImpl });

    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await engine.play(clip);
    engine.dispose();

    expect(context.stoppedSources).toHaveLength(1);
    expect(context.closed()).toBe(1);
  });

  it('rejects a clip it did not prepare', async () => {
    const context = makeContext();
    const engine = new WebAudioEngine({
      contextFactory: () => context,
      fetchImpl: makeFetch().fetchImpl,
    });
    await expect(engine.play({ url: 'x' })).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('reports "unavailable" when there is no AudioContext', async () => {
    const engine = new WebAudioEngine({
      contextFactory: () => null,
      fetchImpl: makeFetch().fetchImpl,
    });
    await expect(
      engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' }),
    ).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('never re-creates the context per prepare', async () => {
    let built = 0;
    const context = makeContext();
    const engine = new WebAudioEngine({
      contextFactory: () => {
        built += 1;
        return context;
      },
      fetchImpl: makeFetch().fetchImpl,
    });
    await engine.prepare({ key: 'a', url: 'assets/audio/a.mp3' });
    await engine.prepare({ key: 'b', url: 'assets/audio/b.mp3' });
    expect(built).toBe(1);
  });
});

/** Fake HTMLAudioElement. */
function makeElement(
  plan: { play?: 'resolve' | 'reject' | 'hang' | 'throw'; error?: unknown; name?: string } = {},
) {
  const element: MediaElementLike & { playCalls: number; paused: number } = {
    playCalls: 0,
    paused: 0,
    src: '',
    preload: '',
    volume: 1,
    currentTime: 0,
    error: plan.error ?? null,
    readyState: 4,
    play: () => {
      element.playCalls += 1;
      switch (plan.play ?? 'resolve') {
        case 'throw':
          throw new Error('sync failure');
        case 'reject': {
          const error = new Error(plan.name ?? 'NotSupportedError');
          error.name = plan.name ?? 'NotSupportedError';
          return Promise.reject(error);
        }
        case 'hang':
          return new Promise<void>(() => undefined);
        default:
          return Promise.resolve();
      }
    },
    pause: () => {
      element.paused += 1;
    },
  };
  return element;
}

describe('MediaElementEngine', () => {
  it('constructs the element for the clip URL', async () => {
    const urls: string[] = [];
    const engine = new MediaElementEngine({
      createElement: (url) => {
        urls.push(url);
        return makeElement();
      },
    });
    const clip = await engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' });
    expect(urls).toEqual(['assets/audio/words/cat.mp3']);
    expect(clip.url).toBe('assets/audio/words/cat.mp3');
  });

  it('rejects a source the element already refused', async () => {
    const engine = new MediaElementEngine({
      createElement: () => makeElement({ error: { code: 4 } }),
    });
    await expect(
      engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' }),
    ).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('surfaces a rejected play() so the manager can fall back', async () => {
    const engine = new MediaElementEngine({
      createElement: () => makeElement({ play: 'reject' }),
    });
    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await expect(engine.play(clip)).rejects.toMatchObject({ name: 'NotSupportedError' });
  });

  it('surfaces a synchronous play() throw', async () => {
    const engine = new MediaElementEngine({ createElement: () => makeElement({ play: 'throw' }) });
    const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });
    await expect(engine.play(clip)).rejects.toThrow(/sync failure/);
  });

  it('does not hang on a stalled play() (the regression this raced against)', async () => {
    vi.useFakeTimers();
    try {
      const engine = new MediaElementEngine({ createElement: () => makeElement({ play: 'hang' }) });
      const clip = await engine.prepare({ key: 'phonemes/k', url: 'assets/audio/phonemes/k.mp3' });

      const pending = engine.play(clip);
      await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + 10);
      // Settles as "started": a stalled pipeline is not a load failure.
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pause()es on stop', async () => {
    const element = makeElement();
    const engine = new MediaElementEngine({ createElement: () => element });
    const clip = await engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' });
    await engine.play(clip);
    engine.stop(clip);
    expect(element.paused).toBe(1);
    expect(element.currentTime).toBe(0);
  });

  it('creates a real Audio element by default (jsdom path)', async () => {
    const engine = new MediaElementEngine();
    const clip = await engine.prepare({ key: 'words/cat', url: 'assets/audio/words/cat.mp3' });
    expect(clip.url).toBe('assets/audio/words/cat.mp3');
  });
});

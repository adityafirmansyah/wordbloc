import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AudioManager,
  SFX_KEYS,
  WebAudioEngine,
  isSfxKey,
  type AudioBufferSourceLike,
  type AudioContextLike,
  type AudioEngine,
  type AudioSource,
  type PreparedClip,
  type SfxKey,
} from '../src/game/audio';

/**
 * Game-juice SFX suite (`playSfx` / `preloadSfx`).
 *
 * Five tactile clips ship in `public/assets/audio/sfx/`: a wooden snap on a locked
 * tile, a rubbery boing on a wrong drop, a chime on a solved word, a star ping on
 * the reward reveal, and a soft click on buttons.
 *
 * The properties that make SFX *juice* rather than just "more audio" — and which
 * this suite pins, because each one is a defect if it regresses:
 *
 *   1. ROUTING — `sfx/snap` -> assets/audio/sfx/snap.mp3, and only the five
 *      declared keys are accepted (no wild requests from a typo);
 *   2. NEVER SYNTHESISED — a missing/broken SFX degrades to silence. Web Speech
 *      saying the word "snap" instead of a snap is a bug, not a fallback;
 *   3. OVERLAP — an SFX starts on its own source node, so the chime plays WITH the
 *      solved word and the snap plays WITH the tile's phoneme, never replacing it;
 *   4. PRELOADED + UNEVICTABLE — the buffers are decoded up front and live outside
 *      the word/phoneme LRU, so a level's clips can never silence the next drop;
 *   5. MUTE — a muted game plays nothing and starts no download.
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

describe('SfxKey — the declared set', () => {
  it('exposes exactly the five clips that ship', () => {
    expect([...SFX_KEYS]).toEqual(['sfx/snap', 'sfx/bounce', 'sfx/chime', 'sfx/star', 'sfx/click']);
  });

  it('narrows only those keys', () => {
    for (const key of SFX_KEYS) expect(isSfxKey(key)).toBe(true);
    for (const bad of ['sfx/boom', 'phonemes/k', 'words/cat', 'sfx/snap.mp3', '']) {
      expect(isSfxKey(bad), bad).toBe(false);
    }
  });
});

describe('the SFX pack on disk (public/assets/audio/sfx/)', () => {
  const SFX_DIR = join(process.cwd(), 'public/assets/audio/sfx');

  it('ships exactly the five declared clips — no more, no fewer', () => {
    const files = readdirSync(SFX_DIR)
      .filter((f) => f.endsWith('.mp3'))
      .sort();
    expect(files).toEqual(['bounce.mp3', 'chime.mp3', 'click.mp3', 'snap.mp3', 'star.mp3']);
  });

  it('every clip is a real MP3 (ID3 tag + MPEG frame sync), not a placeholder', () => {
    for (const key of SFX_KEYS) {
      const file = join(SFX_DIR, `${key.split('/')[1]}.mp3`);
      expect(existsSync(file), file).toBe(true);
      const bytes = readFileSync(file);
      // ID3v2 header ("ID3") then an MPEG-1 Layer III frame sync (0xFF 0xFB).
      expect(bytes.toString('ascii', 0, 3), file).toBe('ID3');
      expect(bytes.includes(Buffer.from([0xff, 0xfb])), file).toBe(true);
      // A juice SFX is SHORT. Anything above ~1.5 s of audio would still play over
      // the next interaction, so the upper bound is a real design constraint.
      expect(bytes.length, file).toBeLessThan(20 * 1024);
    }
  });
});

describe('AudioManager.playSfx — routing', () => {
  it('resolves every key to its real clip path', async () => {
    for (const key of SFX_KEYS) {
      const { engine, prepared } = makeEngine();
      const audio = new AudioManager({ engine });
      const result = await audio.playSfx(key);

      expect(prepared.map((s) => packPath(s.url))).toEqual([
        `assets/audio/sfx/${key.slice(4)}.mp3`,
      ]);
      expect(result.key).toBe(key);
      expect(result.outcome).toBe('file');
      expect(packPath(result.url)).toBe(`assets/audio/sfx/${key.slice(4)}.mp3`);
    }
  });

  it('reports the clip it just played through lastPlayed()', async () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playSfx('sfx/star');
    expect(audio.lastPlayed()).toMatchObject({ key: 'sfx/star', outcome: 'file' });
  });

  it('prepares once and replays from the pool (no second download)', async () => {
    const { engine, prepared, played } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playSfx('sfx/click');
    await audio.playSfx('sfx/click');
    expect(prepared).toHaveLength(1);
    expect(played).toHaveLength(2);
    expect(audio.has('sfx/click')).toBe(true);
  });

  it('shares one in-flight prepare when a tap races the preload', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    // Kick a preload and a play for the same key in the same tick.
    audio.preloadSfx(['sfx/snap']);
    await audio.playSfx('sfx/snap');
    expect(prepared).toHaveLength(1);
  });
});

describe('AudioManager.playSfx — overlap (own source node, never cuts speech)', () => {
  it('starts a SECOND source while the word is still playing (no stop)', async () => {
    const { engine, played, stopped } = makeEngine();
    const audio = new AudioManager({ engine });

    await audio.playWord('words/cat');
    await audio.playSfx('sfx/chime');

    // Both clips were started, and nothing was cut off in between: the chime
    // colours the solved word instead of replacing it.
    expect(played).toHaveLength(2);
    expect(stopped).toEqual([]);
  });

  it('plays the snap and the phoneme of the same placement as two sources', async () => {
    const { engine, played, stopped } = makeEngine();
    const audio = new AudioManager({ engine });

    // GameScene.placeTile order: snap, then the phoneme.
    await audio.playSfx('sfx/snap');
    await audio.playPhoneme('phonemes/k');

    expect(played).toHaveLength(2);
    expect(stopped).toEqual([]);
  });

  it('queues two rapid SFX without dropping either (tap-tap-tap stays crunchy)', async () => {
    const { engine, played } = makeEngine();
    const audio = new AudioManager({ engine });
    await Promise.all([audio.playSfx('sfx/click'), audio.playSfx('sfx/click')]);
    expect(played).toHaveLength(2);
  });
});

describe('AudioManager.playSfx — mute / audio disabled', () => {
  it('plays nothing and downloads nothing while muted', async () => {
    const { engine, prepared, played } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);

    const result = await audio.playSfx('sfx/chime');
    expect(result).toEqual({ key: 'sfx/chime', outcome: 'silent', url: '' });
    expect(prepared).toEqual([]);
    expect(played).toEqual([]);
  });

  it('still WARMS the SFX buffers while muted, so unmuting is instant', async () => {
    // Matches the word/phoneme preload(): mute suppresses PLAYING, not preparing.
    // Measured in the built app: a session that starts muted and is unmuted mid-way
    // must not serve its first click from a cold cache.
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);
    expect(audio.preloadSfx()).toHaveLength(5);
    await Promise.resolve();
    await Promise.resolve();
    expect(prepared.map((s) => packPath(s.url))[0]).toBe('assets/audio/sfx/snap.mp3');

    audio.setEnabled(true);
    expect((await audio.playSfx('sfx/snap')).outcome).toBe('file');
    // Already prepared while muted: no second download on the first click.
    expect(prepared).toHaveLength(5);
  });

  it('plays again after being unmuted', async () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.setEnabled(false);
    audio.setEnabled(true);
    expect((await audio.playSfx('sfx/snap')).outcome).toBe('file');
  });

  it('stops a running SFX when muted mid-clip', async () => {
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine });
    await audio.playSfx('sfx/star');
    audio.setEnabled(false);
    expect(stopped.length).toBeGreaterThan(0);
  });
});

describe('AudioManager.playSfx — graceful degradation (silence, never speech)', () => {
  it('goes silent when the SFX file is missing, and never synthesises it', async () => {
    const { engine } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });

    const result = await audio.playSfx('sfx/snap');
    expect(result.outcome).toBe('silent');
    // The decisive assertion: a wooden snap must never become the spoken word.
    expect(speechSpeak).not.toHaveBeenCalled();
    expect(audio.hasFailed('sfx/snap')).toBe(true);
  });

  it('does not re-request a clip it knows is broken', async () => {
    const { engine, prepared } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    await audio.playSfx('sfx/bounce');
    const before = prepared.length;
    expect((await audio.playSfx('sfx/bounce')).outcome).toBe('silent');
    expect(prepared).toHaveLength(before);
  });

  it('goes silent (not speech) when playback fails for a non-policy reason', async () => {
    const { engine } = makeEngine({ play: new Error('decode blew up') });
    const audio = new AudioManager({ engine });
    expect((await audio.playSfx('sfx/chime')).outcome).toBe('silent');
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('reports a policy block as silent but keeps the buffer for the next gesture', async () => {
    const blocked = new Error('blocked');
    blocked.name = 'NotAllowedError';
    const { engine } = makeEngine({ play: blocked });
    const audio = new AudioManager({ engine });

    expect((await audio.playSfx('sfx/snap')).outcome).toBe('silent');
    expect(audio.hasFailed('sfx/snap')).toBe(false);
    expect(audio.has('sfx/snap')).toBe(true);
    expect(speechSpeak).not.toHaveBeenCalled();
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
    await expect(audio.playSfx('sfx/click')).resolves.toMatchObject({ outcome: 'silent' });
  });

  it('goes silent with no engine at all', async () => {
    const audio = new AudioManager({ engine: null });
    const result = await audio.playSfx('sfx/star');
    expect(result.outcome).toBe('silent');
    expect(packPath(result.url)).toBe('assets/audio/sfx/star.mp3');
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('rejects an undeclared key at runtime without touching the network', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    // A typo must not become a request for assets/audio/sfx/boom.mp3.
    const result = await audio.playSfx('sfx/boom' as SfxKey);
    expect(result.outcome).toBe('silent');
    expect(prepared).toEqual([]);
  });
});

describe('AudioManager.playSfx — the SFX pool is separate from the LRU', () => {
  it('keeps SFX pooled when the word/phoneme pool overflows', async () => {
    // maxClips 1 mimics a pathological cap: three phonemes evict each other, but
    // the SFX buffers must survive, or every second tile drop would go silent.
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine, maxClips: 1 });

    expect(audio.preloadSfx()).toHaveLength(5);
    await Promise.resolve();
    await Promise.resolve();

    for (const key of ['phonemes/k', 'phonemes/ae', 'phonemes/t']) {
      await audio.playPhoneme(key);
    }

    // Only phone ME clips were stopped by LRU eviction — no sfx/* clip.
    const stoppedSfx = stopped.filter((clip) => clip.url.includes('/sfx/'));
    expect(stoppedSfx).toEqual([]);
    for (const key of SFX_KEYS) expect(audio.has(key), key).toBe(true);
  });

  it('release() stops and drops the SFX pool too', async () => {
    const { engine, stopped } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.preloadSfx(['sfx/snap', 'sfx/chime']);
    await Promise.resolve();
    await Promise.resolve();
    await audio.playSfx('sfx/chime');

    audio.release();
    expect(stopped.length).toBeGreaterThanOrEqual(2);
    expect(audio.has('sfx/chime')).toBe(false);
  });

  it('release() twice is safe', async () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.preloadSfx();
    expect(() => {
      audio.release();
      audio.release();
    }).not.toThrow();
  });
});

describe('AudioManager.preloadSfx', () => {
  it('starts a decode for every declared clip, in declaration order', () => {
    const { engine } = makeEngine();
    const audio = new AudioManager({ engine });
    expect(audio.preloadSfx().map(packPath)).toEqual([
      'assets/audio/sfx/snap.mp3',
      'assets/audio/sfx/bounce.mp3',
      'assets/audio/sfx/chime.mp3',
      'assets/audio/sfx/star.mp3',
      'assets/audio/sfx/click.mp3',
    ]);
  });

  it('is idempotent: a second preload starts nothing new', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    audio.preloadSfx();
    await Promise.resolve();
    await Promise.resolve();
    const before = prepared.length;

    expect(audio.preloadSfx()).toEqual([]);
    expect(prepared).toHaveLength(before);
  });

  it('accepts a subset (the Reward screen only needs the star)', async () => {
    const { engine, prepared } = makeEngine();
    const audio = new AudioManager({ engine });
    expect(audio.preloadSfx(['sfx/star']).map(packPath)).toEqual(['assets/audio/sfx/star.mp3']);
    await Promise.resolve();
    await Promise.resolve();
    expect(prepared.map((s) => packPath(s.url))).toEqual(['assets/audio/sfx/star.mp3']);
  });

  it('starts nothing with no engine', () => {
    const audio = new AudioManager({ engine: null });
    expect(audio.preloadSfx()).toEqual([]);
  });

  it('does not re-request a key that already failed', async () => {
    const { engine, prepared } = makeEngine({ prepare: () => new Error('404') });
    const audio = new AudioManager({ engine });
    audio.preloadSfx();
    await Promise.resolve();
    await Promise.resolve();
    const before = prepared.length;
    expect(audio.preloadSfx()).toEqual([]);
    expect(prepared).toHaveLength(before);
  });
});

// The real Web Audio path, to prove two clips genuinely overlap on separate source
// nodes (the manager test above only proves the manager does not call stop()).
function makeContext() {
  const started: AudioBufferSourceLike[] = [];
  const context: AudioContextLike & { started: AudioBufferSourceLike[] } = {
    state: 'running',
    destination: 'dest',
    currentTime: 0,
    started,
    resume: () => Promise.resolve(),
    decodeAudioData: () => Promise.resolve({ duration: 0.2 }),
    createBufferSource: () => {
      const source: AudioBufferSourceLike = {
        buffer: null,
        onended: null,
        connect: () => undefined,
        start: () => {
          started.push(source);
        },
        stop: () => undefined,
      };
      return source;
    },
  };
  return context;
}

describe('WebAudioEngine — SFX overlap on real source nodes', () => {
  it('the word and the chime run as two live sources at once', async () => {
    const context = makeContext();
    const engine = new WebAudioEngine({
      contextFactory: () => context,
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
        }),
    });
    const audio = new AudioManager({ engine });

    await audio.playWord('words/cat');
    await audio.playSfx('sfx/chime');

    expect(context.started).toHaveLength(2);
    // Distinct nodes: overlap, not a re-trigger of the same node.
    expect(context.started[0]).not.toBe(context.started[1]);
  });
});

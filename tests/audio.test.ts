import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager, phonemeToSpeakable } from '../src/game/audio';

/** Fake Phaser-ish scene: controls which audio keys "exist". */
function makeHost(available: string[] = []) {
  const played: string[] = [];
  return {
    played,
    host: {
      cache: { audio: { exists: (key: string) => available.includes(key) } },
      sound: {
        play: (key: string): void => {
          played.push(key);
        },
      },
    },
  };
}

describe('phonemeToSpeakable (phonics contract)', () => {
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
});

describe('AudioManager — graceful degradation (never crash on a missing key)', () => {
  let speechSpeak: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    speechSpeak = vi.fn();
    // Provide a Web Speech API double so the fallback path is observable.
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

  it('plays a decoded buffer when the key exists', () => {
    const { host, played } = makeHost(['words/cat']);
    const audio = new AudioManager(host);
    const result = audio.playWord('words/cat');
    expect(result.outcome).toBe('buffer');
    expect(played).toEqual(['words/cat']);
  });

  it('does not throw and does not play for a missing word key', () => {
    const { host, played } = makeHost([]);
    const audio = new AudioManager(host);
    expect(() => audio.playWord('words/missing')).not.toThrow();
    expect(played).toEqual([]);
  });

  it('falls back to speech for a missing phoneme key', () => {
    const { host } = makeHost([]);
    const audio = new AudioManager(host);
    const result = audio.playPhoneme('phonemes/ae');
    expect(result.outcome).toBe('speech');
    expect(speechSpeak).toHaveBeenCalledTimes(1);
  });

  it('records what it last attempted', () => {
    const { host } = makeHost(['words/cat']);
    const audio = new AudioManager(host);
    audio.playWord('words/cat');
    expect(audio.lastPlayed()).toEqual({ key: 'words/cat', outcome: 'buffer' });
  });

  it('never throws for an empty key', () => {
    const { host } = makeHost([]);
    const audio = new AudioManager(host);
    expect(() => audio.playPhoneme('')).not.toThrow();
    expect(audio.playPhoneme('').outcome).toBe('silent');
  });

  it('reports has() false when the cache lookup itself throws', () => {
    const host = {
      cache: {
        audio: {
          exists: (): boolean => {
            throw new Error('cache exploded');
          },
        },
      },
      sound: { play: vi.fn() },
    };
    const audio = new AudioManager(host);
    expect(audio.has('anything')).toBe(false);
    expect(() => audio.playWord('anything')).not.toThrow();
  });

  it('does not throw when sound.play throws, and falls through', () => {
    const host = {
      cache: { audio: { exists: (): boolean => true } },
      sound: {
        play: (): void => {
          throw new Error('audio context suspended');
        },
      },
    };
    const audio = new AudioManager(host);
    expect(() => audio.playPhoneme('phonemes/k')).not.toThrow();
  });

  it('goes silent (without speech) when muted', () => {
    const { host, played } = makeHost(['words/cat']);
    const audio = new AudioManager(host);
    audio.setEnabled(false);
    expect(audio.isEnabled()).toBe(false);
    expect(audio.playWord('words/cat')).toEqual({ key: 'words/cat', outcome: 'silent' });
    expect(played).toEqual([]);
    expect(speechSpeak).not.toHaveBeenCalled();
  });

  it('survives when the Web Speech API is absent entirely', () => {
    vi.unstubAllGlobals();
    const { host } = makeHost([]);
    const audio = new AudioManager(host);
    expect(() => audio.playPhoneme('phonemes/k')).not.toThrow();
    expect(audio.playPhoneme('phonemes/k').outcome).toBe('silent');
  });

  it('survives a speech API that throws', () => {
    vi.stubGlobal('speechSynthesis', {
      speak: (): void => {
        throw new Error('speech blocked');
      },
      cancel: vi.fn(),
    });
    const { host } = makeHost([]);
    const audio = new AudioManager(host);
    expect(() => audio.playPhoneme('phonemes/k')).not.toThrow();
  });
});

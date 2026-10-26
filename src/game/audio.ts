/**
 * Minimal structural view of the Phaser bits we use. Keeping this local means
 * the audio facade has NO runtime import of Phaser (so it is unit-testable in
 * jsdom without a canvas) and still type-checks against a real Phaser.Scene.
 */
export interface SceneAudioHost {
  cache: { audio: { exists: (key: string) => boolean } };
  sound: { play: (key: string) => unknown };
}

/**
 * Audio facade for phonics playback.
 *
 * The phonics rule (docs/SPEC.md) is non-negotiable: placing a tile speaks the
 * PHONEME, never the letter name. v1 ships NO real audio assets, so this manager
 * is a graceful-degradation layer:
 *
 *   - every `play*` call is a no-op unless a decoded buffer for the key exists;
 *   - a missing key never throws and never rejects;
 *   - when a key is missing we fall back to the Web Speech API (if available),
 *     synthesising a phoneme-ish utterance. This keeps the pedagogical contract
 *     wired end-to-end while real audio lands in a later milestone.
 *
 * Telemetry of the last played key is exposed for tests/debugging.
 */

export type AudioOutcome = 'buffer' | 'speech' | 'silent';

export interface AudioPlayResult {
  key: string;
  outcome: AudioOutcome;
}

interface SpeechSynthesisLike {
  speak: (utterance: unknown) => void;
  cancel: () => void;
}

interface SpeechSynthesisUtteranceLike {
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

type SpeechWindow = Window & {
  speechSynthesis?: SpeechSynthesisLike;
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike;
};

/**
 * Rough phoneme -> sayable spelling, so the speech fallback reads a sound and
 * not a letter name. Keys not listed here are spoken verbatim.
 */
const PHONEME_SAYABLE: Readonly<Record<string, string>> = {
  ae: 'ah',
  aw: 'awe',
  er: 'err',
  ie: 'eye',
  ow: 'oh',
  sh: 'shh',
  u: 'uh',
  e: 'eh',
  i: 'ih',
  o: 'oh',
  a: 'ah',
};

/** Turns an audio key like "phonemes/ae" into something speakable. */
export function phonemeToSpeakable(key: string): string {
  const slug = key.includes('/') ? (key.split('/').pop() ?? key) : key;
  const mapped = PHONEME_SAYABLE[slug.toLowerCase()];
  return mapped ?? slug;
}

export class AudioManager {
  private readonly scene: SceneAudioHost;
  private enabled = true;
  private lastResult: AudioPlayResult = { key: '', outcome: 'silent' };

  constructor(scene: SceneAudioHost) {
    this.scene = scene;
  }

  /** True when a decoded buffer exists in the Phaser cache for `key`. */
  has(key: string): boolean {
    if (!key) return false;
    try {
      return this.scene.cache.audio.exists(key);
    } catch {
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelSpeech();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  lastPlayed(): AudioPlayResult {
    return this.lastResult;
  }

  /** Plays a decoded buffer if present; otherwise falls back; never throws. */
  playKey(key: string): AudioPlayResult {
    if (!this.enabled) return this.remember({ key, outcome: 'silent' });
    if (!key) return this.remember({ key, outcome: 'silent' });

    if (this.has(key)) {
      try {
        this.scene.sound.play(key);
        return this.remember({ key, outcome: 'buffer' });
      } catch {
        // fall through to the silent/speech path
      }
    }
    return this.remember({ key, outcome: 'silent' });
  }

  /** Phoneme for a single tile placement. Speaks the sound, never the letter name. */
  playPhoneme(key: string): AudioPlayResult {
    const result = this.playKey(key);
    if (result.outcome === 'silent' && this.enabled) {
      const spoke = this.speak(phonemeToSpeakable(key), 0.85);
      return this.remember({ key, outcome: spoke ? 'speech' : 'silent' });
    }
    return result;
  }

  /** Whole word on completion. */
  playWord(key: string): AudioPlayResult {
    const result = this.playKey(key);
    if (result.outcome === 'silent' && this.enabled) {
      const spoke = this.speak(phonemeToSpeakable(key), 0.8);
      return this.remember({ key, outcome: spoke ? 'speech' : 'silent' });
    }
    return result;
  }

  private remember(result: AudioPlayResult): AudioPlayResult {
    this.lastResult = result;
    return result;
  }

  private speechApi(): {
    synth: SpeechSynthesisLike;
    Utterance: new (t: string) => SpeechSynthesisUtteranceLike;
  } | null {
    if (typeof window === 'undefined') return null;
    const w = window as SpeechWindow;
    if (!w.speechSynthesis || !w.SpeechSynthesisUtterance) return null;
    return { synth: w.speechSynthesis, Utterance: w.SpeechSynthesisUtterance };
  }

  private speak(text: string, rate: number): boolean {
    const api = this.speechApi();
    if (!api || !text) return false;
    try {
      const utterance = new api.Utterance(text);
      utterance.rate = rate;
      utterance.pitch = 1.1;
      utterance.volume = 0.9;
      utterance.lang = 'en-US';
      api.synth.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  private cancelSpeech(): void {
    const api = this.speechApi();
    if (!api) return;
    try {
      api.synth.cancel();
    } catch {
      // ignore — graceful degradation
    }
  }
}

/**
 * Phonics audio over the real MP3 pack in `public/assets/audio/`.
 *
 * The phonics rule (docs/SPEC.md) is non-negotiable: placing a tile speaks the
 * PHONEME (`/k/ /æ/ /t/`), never the letter name ("cue ay tee"). Every key now
 * maps to a recorded clip:
 *
 *   playPhoneme('phonemes/k')  -> assets/audio/phonemes/k.mp3
 *   playWord('words/cat')      -> assets/audio/words/cat.mp3
 *
 * PLAYBACK: Web Audio first, `HTMLMediaElement` second, Web Speech last.
 *
 *   - **Web Audio** (`AudioContext` + `AudioBufferSourceNode`) is the primary
 *     engine. `decodeAudioData` gives a byte-exact verdict on the file (a 404, a
 *     truncated MP3 and an HTML error page all reject), and once a clip is decoded
 *     `source.start()` is SYNCHRONOUS — so a tile placement speaks with no await,
 *     no buffering gap, and no dependence on a media element's network state
 *     machine. Measured in headless Chrome while building this: `decodeAudioData`
 *     handled `words/cat.mp3` (0.367 s of audio) in one pass, while the very same
 *     bytes left an `HTMLAudioElement` at `readyState 0` indefinitely and its
 *     `play()` promise never settled.
 *   - **`HTMLMediaElement`** is the fallback where Web Audio is missing. There the
 *     `play()` promise is the failure signal, and because a stalled media pipeline
 *     can leave that promise pending forever it is raced against
 *     START_TIMEOUT_MS.
 *   - **Web Speech** covers a phoneme whose FILE failed to load (a synthesised
 *     sound beats silence in a phonics game). It is explicitly NOT used for
 *     autoplay blocks or for an explicit silent letter.
 *
 * Everything is no-throw, and every `play*` promise settles: a missing clip, a
 * suspended context or an absent Web Speech API degrades to silence, never to a
 * crash, a hang, or a NaN tween.
 */

import { audioUrl } from './assets';

/**
 * Audio key for a slot whose letter makes no sound of its own (the E of HOUSE, the
 * final E of APPLE/SNAKE). The spec requires ONE phoneme key per slot, so a silent
 * letter is expressed explicitly instead of shifting a neighbour's sound.
 *
 * There is deliberately NO `silent.mp3` in the pack: this key resolves to silence
 * without touching the network (a 404 per silent tile was the old risk).
 */
export const SILENT_PHONEME = 'phonemes/silent';

/**
 * How a play request was served:
 *   'file'   — the recorded MP3 played
 *   'speech' — the MP3 was missing/unplayable, so Web Speech said the sound
 *   'silent' — nothing played: muted, explicit silent letter, autoplay blocked,
 *              or no audio engine available at all
 */
export type AudioOutcome = 'file' | 'speech' | 'silent';

export interface AudioPlayResult {
  key: string;
  outcome: AudioOutcome;
  /** URL the request resolved to ('' when nothing was requested). */
  url: string;
}

/** A file an engine should prepare: its level-data key plus the resolved URL. */
export interface AudioSource {
  readonly key: string;
  readonly url: string;
}

/** What an engine returns once a file is ready to play. Opaque to callers. */
export interface PreparedClip {
  readonly url: string;
}

/**
 * Pluggable playback backend. Two ship in this file (Web Audio, media element) and
 * tests inject fakes; `AudioManager` owns routing, fallbacks and pooling.
 */
export interface AudioEngine {
  /** Fetches + decodes `source`. Rejects when the file is unusable. */
  prepare(source: AudioSource): Promise<PreparedClip>;
  /** Starts playback of a prepared clip. Resolves once it has started. */
  play(clip: PreparedClip): Promise<void>;
  /** Stops a clip that is still running. */
  stop(clip: PreparedClip): void;
  /**
   * Unlocks the engine from inside a user-gesture handler. Browsers start an
   * `AudioContext` suspended until a gesture; calling this on the first pointerdown
   * is what makes the very next tile placement audible. Never throws.
   */
  unlock(): Promise<void>;
  /** Releases every resource the engine holds. */
  dispose(): void;
}

/** How long a media-element start may take before it counts as started anyway. */
export const START_TIMEOUT_MS = 4000;

/**
 * How long an `AudioContext.resume()` may take before we treat the context as
 * still blocked. Chrome leaves that promise PENDING indefinitely when there is no
 * user gesture (measured: a suspended context never settled), so an unbounded
 * `await resume()` would hang every caller forever.
 */
export const RESUME_TIMEOUT_MS = 500;

/** Resolves `true` if `promise` settles first, `false` on timeout. Never rejects. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    const outcome = await Promise.race([
      promise.then(
        () => true,
        () => true, // a rejection also means it settled; the caller re-reads state
      ),
      timeout,
    ]);
    return outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Rough phoneme -> sayable spelling, so the speech fallback reads a sound and not
 * a letter name. Keys not listed here are spoken verbatim.
 */
const PHONEME_SAYABLE: Readonly<Record<string, string>> = {
  ae: 'ah',
  aw: 'awe',
  er: 'err',
  ie: 'eye',
  ow: 'oh',
  sh: 'shh',
  schwa: 'uh',
  u: 'uh',
  e: 'eh',
  i: 'ih',
  o: 'oh',
  a: 'ah',
};

/** Turns an audio key like "phonemes/ae" into something speakable. */
export function phonemeToSpeakable(key: string): string {
  const slug = key.includes('/') ? (key.split('/').pop() ?? key) : key;
  if (slug === '' || key === SILENT_PHONEME) return '';
  const mapped = PHONEME_SAYABLE[slug.toLowerCase()];
  return mapped ?? slug;
}

/** Names the two conditions that are NOT a broken file. */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name !== '') return name;
  }
  return '';
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/**
 * Autoplay blocks and deliberate stops: the FILE is fine, so the manager reports
 * silence and retries on the next gesture rather than synthesising over it.
 */
function isPolicyError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'AbortError';
}

// ---------------------------------------------------------------- Web Audio

/** Decoded audio, as far as this module cares. */
export interface DecodedAudioLike {
  duration: number;
}

export interface AudioBufferSourceLike {
  buffer: unknown;
  connect: (destination: unknown) => void;
  start: (when?: number) => void;
  stop: () => void;
  onended: (() => void) | null;
}

/** The subset of `AudioContext` used here (jsdom ships no Web Audio). */
export interface AudioContextLike {
  state: string;
  destination: unknown;
  currentTime: number;
  resume: () => Promise<void>;
  decodeAudioData: (data: ArrayBuffer) => Promise<DecodedAudioLike>;
  createBufferSource: () => AudioBufferSourceLike;
  close?: () => Promise<void>;
}

export interface AudioResponseLike {
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type FetchLike = (url: string) => Promise<AudioResponseLike>;

interface PreparedBuffer extends PreparedClip {
  readonly buffer: DecodedAudioLike;
}

/** Builds a real AudioContext, or null where the API does not exist. */
function defaultContextFactory(): AudioContextLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    AudioContext?: new () => AudioContextLike;
    webkitAudioContext?: new () => AudioContextLike;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

/**
 * Web Audio engine: decode once per clip, then start a fresh
 * `AudioBufferSourceNode` for each play.
 *
 * This is what makes a tile placement audible immediately — starting a decoded
 * buffer is synchronous, so the phoneme does not wait on a network or decode
 * round-trip in the middle of a drag.
 */
export class WebAudioEngine implements AudioEngine {
  private readonly contextFactory: () => AudioContextLike | null;
  private readonly fetchImpl: FetchLike;
  private context: AudioContextLike | null = null;
  private contextBuilt = false;
  /** Nodes still running, so `stop()` / `dispose()` can cut them off. */
  private readonly running = new Set<{ source: AudioBufferSourceLike; clip: PreparedBuffer }>();

  constructor(
    options: { contextFactory?: () => AudioContextLike | null; fetchImpl?: FetchLike } = {},
  ) {
    this.contextFactory = options.contextFactory ?? defaultContextFactory;
    this.fetchImpl =
      options.fetchImpl ??
      ((url) => {
        if (typeof fetch !== 'function') {
          return Promise.reject(namedError('NotSupportedError', 'fetch is unavailable'));
        }
        return fetch(url);
      });
  }

  /** True when this environment can build an AudioContext at all. */
  static isSupported(): boolean {
    return defaultContextFactory() !== null;
  }

  private ensureContext(): AudioContextLike | null {
    if (this.contextBuilt) return this.context;
    this.contextBuilt = true;
    try {
      this.context = this.contextFactory();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  async prepare(source: AudioSource): Promise<PreparedClip> {
    const context = this.ensureContext();
    if (!context) throw namedError('NotSupportedError', 'Web Audio is unavailable');

    let response: AudioResponseLike;
    try {
      response = await this.fetchImpl(source.url);
    } catch (error) {
      throw namedError('NetworkError', `could not fetch ${source.url}: ${String(error)}`);
    }
    if (!response.ok) {
      // 404 / 403 / 5xx: the file is not there. The speech fallback owns it now.
      throw namedError('NotSupportedError', `${source.url} returned HTTP ${response.status}`);
    }

    let bytes: ArrayBuffer;
    try {
      bytes = await response.arrayBuffer();
    } catch (error) {
      throw namedError('NetworkError', `could not read ${source.url}: ${String(error)}`);
    }

    let buffer: DecodedAudioLike;
    try {
      buffer = await context.decodeAudioData(bytes);
    } catch (error) {
      // Not decodable: a truncated/corrupt MP3, or an HTML error page.
      throw namedError(
        'NotSupportedError',
        `${source.url} is not decodable audio: ${errorName(error) || String(error)}`,
      );
    }

    const prepared: PreparedBuffer = { url: source.url, buffer };
    return prepared;
  }

  async play(clip: PreparedClip): Promise<void> {
    const context = this.ensureContext();
    const prepared = clip as PreparedBuffer;
    if (!context || !prepared.buffer) {
      throw namedError('NotSupportedError', 'clip was not prepared by this engine');
    }

    // Autoplay policy: a context created before a user gesture starts 'suspended'.
    // resume() can stay PENDING forever in that state (measured in Chrome), so it
    // is bounded: if the context is still not 'running' afterwards, this is a
    // policy block — report NotAllowedError so the manager goes silent without
    // marking the file broken or synthesising over it.
    if (context.state === 'suspended') {
      await settlesWithin(
        Promise.resolve()
          .then(() => context.resume())
          .catch(() => undefined),
        RESUME_TIMEOUT_MS,
      );
      // Re-read the state: the await above is exactly the window in which the
      // gesture may (or may not) have flipped it to 'running'.
      const state: string = context.state;
      if (state !== 'running') {
        throw namedError(
          'NotAllowedError',
          `audio context is ${state}: a user gesture is required to start it`,
        );
      }
    }

    const source = context.createBufferSource();
    source.buffer = prepared.buffer;
    source.connect(context.destination);

    const entry = { source, clip: prepared };
    source.onended = () => {
      this.running.delete(entry);
    };
    this.running.add(entry);

    try {
      // Synchronous for a decoded buffer: returns once playback is scheduled.
      source.start(0);
    } catch (error) {
      this.running.delete(entry);
      throw namedError('NotSupportedError', `could not start ${prepared.url}: ${String(error)}`);
    }
  }

  stop(clip: PreparedClip): void {
    for (const entry of [...this.running]) {
      if (entry.clip !== clip) continue;
      this.running.delete(entry);
      try {
        entry.source.stop();
      } catch {
        // already ended — nothing to stop
      }
    }
  }

  /**
   * Resumes the context from a gesture handler. Bounded, and never throws: the
   * gesture may not be enough for the browser, in which case `play()` reports
   * NotAllowedError and the manager stays silent rather than synthesising.
   */
  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (!context || context.state === 'running') return;
    await settlesWithin(
      Promise.resolve()
        .then(() => context.resume())
        .catch(() => undefined),
      RESUME_TIMEOUT_MS,
    );
  }

  dispose(): void {
    for (const entry of [...this.running]) {
      this.running.delete(entry);
      try {
        entry.source.stop();
      } catch {
        // already ended
      }
    }
    const context = this.context;
    this.context = null;
    this.contextBuilt = true;
    try {
      void context?.close?.();
    } catch {
      // ignore — a closed context is the goal either way
    }
  }
}

// ----------------------------------------------------------- media element

/** The subset of HTMLAudioElement the media fallback uses. */
export interface MediaElementLike {
  src: string;
  preload: string;
  volume: number;
  currentTime: number;
  readonly error: unknown;
  readonly readyState: number;
  play: () => unknown;
  pause: () => void;
}

export type MediaFactory = (url: string) => MediaElementLike;

interface PreparedMedia extends PreparedClip {
  readonly element: MediaElementLike;
}

/**
 * `HTMLMediaElement` engine — the fallback where Web Audio is missing.
 *
 * A media element streams, so `prepare` only has to construct it (the browser
 * starts fetching because `preload = 'auto'`). `play()` is raced against
 * START_TIMEOUT_MS: a pipeline that stalls mid-start must not leave the caller's
 * promise pending forever, and a timeout is NOT a load failure (the element has
 * reported no error), so it counts as started.
 */
export class MediaElementEngine implements AudioEngine {
  private readonly factory: MediaFactory;

  constructor(options: { createElement?: MediaFactory } = {}) {
    this.factory =
      options.createElement ??
      ((url) => {
        const element = new Audio(url);
        element.preload = 'auto';
        return element;
      });
  }

  async prepare(source: AudioSource): Promise<PreparedClip> {
    let element: MediaElementLike;
    try {
      element = this.factory(source.url);
    } catch (error) {
      throw namedError('NotSupportedError', `could not create audio: ${String(error)}`);
    }
    element.preload = 'auto';
    element.volume = 1;
    // A source the element already refused is a load failure.
    if (element.error) {
      throw namedError('NotSupportedError', `${source.url} failed to load`);
    }
    const prepared: PreparedMedia = { url: source.url, element };
    return prepared;
  }

  async play(clip: PreparedClip): Promise<void> {
    const prepared = clip as PreparedMedia;
    const element = prepared.element;
    if (!element) throw namedError('NotSupportedError', 'clip was not prepared by this engine');
    if (element.error) {
      throw namedError('NotSupportedError', `${prepared.url} failed to load`);
    }

    try {
      element.currentTime = 0;
      element.volume = 1;
    } catch {
      // not fatal — some engines refuse seeking before metadata
    }

    let pending: unknown;
    try {
      pending = element.play();
    } catch (error) {
      throw error instanceof Error ? error : namedError('NotSupportedError', String(error));
    }

    if (typeof (pending as Promise<unknown> | undefined)?.then !== 'function') {
      // Older engines return undefined; assume the element started.
      return;
    }

    const settled = await Promise.race([
      (pending as Promise<void>).then(
        () => 'played' as const,
        (error: unknown) => ({ error }),
      ),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), START_TIMEOUT_MS);
      }),
    ]);

    if (settled === 'timeout') {
      // Swallow the late settlement: the caller must not hang on a stalled pipeline.
      void (pending as Promise<unknown>).catch(() => undefined);
      return;
    }
    if (typeof settled === 'object' && settled !== null && 'error' in settled) {
      const error = settled.error;
      throw error instanceof Error ? error : namedError('NotSupportedError', String(error));
    }
  }

  stop(clip: PreparedClip): void {
    const prepared = clip as PreparedMedia;
    try {
      prepared.element?.pause();
      if (prepared.element) prepared.element.currentTime = 0;
    } catch {
      // ignore — a detached element must not break shutdown
    }
  }

  /**
   * Media elements are unlocked by the gesture itself: a `play()` called from a
   * pointer handler is allowed. There is nothing to resume, so this is a no-op.
   */
  async unlock(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    // Media elements are collected with the pool; nothing to release.
  }
}

/** Web Audio when available, media element otherwise, `null` when neither is. */
export function defaultEngine(): AudioEngine | null {
  if (WebAudioEngine.isSupported()) return new WebAudioEngine();
  if (typeof Audio !== 'undefined') return new MediaElementEngine();
  return null;
}

// ------------------------------------------------------------- speech API

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

// ------------------------------------------------------------- AudioManager

/**
 * Clips kept pooled at once. A level needs its word plus one clip per slot (at
 * most 9), and the Wordbook page shows 9 cards, so this covers a screen's worth
 * with room to spare while bounding how much decoded audio a long session holds.
 * One decoded clip is a few tens of KB of Float32 (`words/cat.mp3` is 0.37 s of
 * mono 44.1 kHz audio), so the cap is generous for the 2GB-RAM Android target.
 */
export const MAX_CLIPS = 32;

export interface AudioManagerOptions {
  /** Playback backend. `null` disables file playback (speech-only). */
  engine?: AudioEngine | null;
  /** Cap on retained clips; see MAX_CLIPS. */
  maxClips?: number;
}

/**
 * Owns the clip pool for ONE scene. Scenes create a manager in `create()` and call
 * `release()` on shutdown so a word cannot keep playing after the kid has moved on.
 */
export class AudioManager {
  private readonly engine: AudioEngine | null;
  private readonly maxClips: number;
  /** key -> ready clip (insertion order === LRU order). */
  private readonly clips = new Map<string, PreparedClip>();
  /** key -> in-flight prepare, so a repeated preload shares one fetch. */
  private readonly preparing = new Map<string, Promise<PreparedClip | null>>();
  /** Keys whose file failed; the speech fallback owns them from now on. */
  private readonly failed = new Set<string>();
  private enabled = true;
  private lastResult: AudioPlayResult = { key: '', outcome: 'silent', url: '' };

  constructor(options: AudioManagerOptions = {}) {
    this.engine = options.engine === undefined ? defaultEngine() : options.engine;
    this.maxClips = Math.max(1, options.maxClips ?? MAX_CLIPS);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancelSpeech();
      for (const clip of this.clips.values()) this.engine?.stop(clip);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  lastPlayed(): AudioPlayResult {
    return this.lastResult;
  }

  /** True when a clip is already prepared and pooled for `key`. */
  has(key: string): boolean {
    return this.clips.has(key);
  }

  /** True when the file for `key` could not be loaded (speech fallback territory). */
  hasFailed(key: string): boolean {
    return this.failed.has(key);
  }

  /**
   * Call from a user-gesture handler (the first pointerdown / tap) so the browser
   * lets the audio context run. Without this the FIRST tile placement of a session
   * is silently swallowed by the autoplay policy. Never throws.
   */
  unlock(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return Promise.resolve(this.engine?.unlock()).catch(() => undefined);
  }

  /** URL a key resolves to, or '' for the explicit silent key. */
  urlFor(key: string): string {
    if (!key || key === SILENT_PHONEME) return '';
    return audioUrl(key);
  }

  /**
   * Starts preparing the clips a scene is about to need, so the first tap speaks
   * from an already-decoded buffer instead of waiting on the network.
   *
   * Idempotent per key, never throws, and skips the explicit silent key on purpose
   * (there is no silent.mp3, so asking would be a guaranteed 404). Returns the URLs
   * it started preparing (tests / diagnostics).
   */
  preload(keys: readonly string[]): string[] {
    const started: string[] = [];
    if (!this.engine) return started;
    for (const key of keys) {
      if (!key || key === SILENT_PHONEME) continue;
      if (this.clips.has(key) || this.failed.has(key) || this.preparing.has(key)) continue;
      started.push(audioUrl(key));
      void this.prepare(key);
    }
    return started;
  }

  /**
   * Phoneme for a single tile placement. Speaks the sound, never the letter name.
   * Falls back to Web Speech only when the MP3 itself failed.
   */
  playPhoneme(key: string): Promise<AudioPlayResult> {
    return this.play(key, 0.85);
  }

  /** Whole word on completion / on a Wordbook card tap. */
  playWord(key: string): Promise<AudioPlayResult> {
    return this.play(key, 0.8);
  }

  /** Stops everything and drops the pool. Used on scene shutdown. */
  release(): void {
    this.cancelSpeech();
    for (const clip of this.clips.values()) this.engine?.stop(clip);
    this.clips.clear();
    this.preparing.clear();
  }

  // ------------------------------------------------------------------ internals

  private async play(key: string, speechRate: number): Promise<AudioPlayResult> {
    if (!this.enabled || !key) return this.remember({ key, outcome: 'silent', url: '' });

    // Explicit silent letters: no file, no request, no speech. (The pack has no
    // silent.mp3, so asking for one would be a guaranteed 404.)
    if (key === SILENT_PHONEME) return this.remember({ key, outcome: 'silent', url: '' });

    const url = audioUrl(key);

    if (this.failed.has(key)) return this.speakFallback(key, url, speechRate);

    const clip = await this.prepare(key);
    if (!clip) return this.speakFallback(key, url, speechRate);

    try {
      await this.engine?.play(clip);
    } catch (error) {
      // Policy blocks keep the file: report silence and retry on the next gesture.
      if (isPolicyError(error)) return this.remember({ key, outcome: 'silent', url });
      this.failed.add(key);
      this.clips.delete(key);
      return this.speakFallback(key, url, speechRate);
    }

    return this.remember({ key, outcome: 'file', url });
  }

  /** Pooled clip for `key`, preparing (and LRU-evicting) as needed. */
  private async prepare(key: string): Promise<PreparedClip | null> {
    const pooled = this.clips.get(key);
    if (pooled) {
      // Refresh recency: re-insert so the Map's insertion order is the LRU order.
      this.clips.delete(key);
      this.clips.set(key, pooled);
      return pooled;
    }

    const inFlight = this.preparing.get(key);
    if (inFlight) return inFlight;

    const engine = this.engine;
    if (!engine) return null;

    const task = (async (): Promise<PreparedClip | null> => {
      try {
        const clip = await engine.prepare({ key, url: audioUrl(key) });
        this.clips.set(key, clip);
        this.evictOverflow();
        return clip;
      } catch {
        // Memoise the failure: a missing file must not be re-fetched on every tap.
        this.failed.add(key);
        return null;
      }
    })();

    this.preparing.set(key, task);
    const forget = (): void => {
      this.preparing.delete(key);
    };
    void task.then(forget, forget);
    return task;
  }

  /** Drops the least-recently-used clips past the cap (never the newest one). */
  private evictOverflow(): void {
    while (this.clips.size > this.maxClips) {
      const oldest = this.clips.keys().next();
      if (oldest.done) return;
      const clip = this.clips.get(oldest.value);
      this.clips.delete(oldest.value);
      if (clip) this.engine?.stop(clip);
    }
  }

  private speakFallback(key: string, url: string, rate: number): AudioPlayResult {
    if (!this.enabled) return this.remember({ key, outcome: 'silent', url });
    const spoken = this.speak(phonemeToSpeakable(key), rate);
    return this.remember({ key, outcome: spoken ? 'speech' : 'silent', url });
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

/**
 * Every clip a level needs, in play order: the word first (it is spoken on
 * arrival), then one entry per slot. The explicit silent key is dropped because it
 * has no file — including it would request a 404 that never plays.
 */
export function audioKeysForLevel(level: {
  audio_word: string;
  audio_phonemes: readonly string[];
}): string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (!key || key === SILENT_PHONEME) return;
    if (!keys.includes(key)) keys.push(key);
  };
  push(level.audio_word);
  for (const key of level.audio_phonemes) push(key);
  return keys;
}

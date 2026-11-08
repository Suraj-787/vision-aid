/**
 * Accessibility preferences (Milestone 9). Deliberately tiny: how VisionAid should
 * talk to the person. The only thing ever written to the browser's storage is this
 * object (four fields); never photos, questions, answers, transcripts or audio.
 */
export type InteractionMode = "screen-reader" | "voice-guided";

export interface A11yPrefs {
  /** "screen-reader" (default): VisionAid never speaks by itself. "voice-guided": short spoken guidance. */
  mode: InteractionMode;
  /** Read each finished answer aloud automatically. Only has an effect in voice-guided mode. */
  autoReadAnswers: boolean;
  /** Show the one-shot "Say a command" control (English commands). */
  voiceCommands: boolean;
  /**
   * Let the spoken command "ask" SEND the photo and question to Google Gemini, instead of only moving to
   * the Ask button. Off by default; needs voice commands. Turning it on is the person's informed consent
   * to sending by voice, so it is a separate, plainly worded choice.
   */
  voiceAsk: boolean;
}

export const DEFAULT_PREFS: A11yPrefs = {
  mode: "screen-reader",
  autoReadAnswers: false,
  voiceCommands: false,
  voiceAsk: false,
};

export const PREFS_STORAGE_KEY = "visionaid.accessibility.v1";

/** Strict: anything that is not exactly an allowed value falls back to the default for that field. */
export function parsePrefs(raw: unknown): A11yPrefs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_PREFS };
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === "voice-guided" ? "voice-guided" : "screen-reader",
    autoReadAnswers: r.autoReadAnswers === true,
    voiceCommands: r.voiceCommands === true,
    voiceAsk: r.voiceAsk === true,
  };
}

/** Only the three known fields are ever serialised. */
export function serializePrefs(prefs: A11yPrefs): string {
  return JSON.stringify({
    mode: prefs.mode,
    autoReadAnswers: prefs.autoReadAnswers,
    voiceCommands: prefs.voiceCommands,
    voiceAsk: prefs.voiceAsk,
  });
}

/** Automatic reading is a voice-guided feature: it never happens in screen-reader mode. */
export function effectiveAutoRead(prefs: A11yPrefs): boolean {
  return prefs.mode === "voice-guided" && prefs.autoReadAnswers;
}

/** The spoken "ask" sends only when voice commands are on AND the person turned this on. */
export function effectiveVoiceAsk(prefs: A11yPrefs): boolean {
  return prefs.voiceCommands && prefs.voiceAsk;
}

export function isVoiceGuided(prefs: A11yPrefs): boolean {
  return prefs.mode === "voice-guided";
}

// ---- storage (injectable, never throws: storage can be blocked, full or absent)
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadPrefs(storage: StorageLike | null): A11yPrefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const text = storage.getItem(PREFS_STORAGE_KEY);
    return text ? parsePrefs(JSON.parse(text)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage: StorageLike | null, prefs: A11yPrefs): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFS_STORAGE_KEY, serializePrefs(prefs));
    return true;
  } catch {
    return false;
  }
}

/** A tiny external store so components share the preferences without a context. */
export interface PrefsStore {
  getSnapshot(): A11yPrefs;
  subscribe(listener: () => void): () => void;
  update(change: Partial<A11yPrefs>): void;
}

export function createPrefsStore(storage: StorageLike | null): PrefsStore {
  let current: A11yPrefs | null = null;
  const listeners = new Set<() => void>();
  return {
    getSnapshot() {
      current ??= loadPrefs(storage);
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(change) {
      const next = parsePrefs({ ...(current ?? loadPrefs(storage)), ...change });
      current = next;
      savePrefs(storage, next);
      listeners.forEach((l) => l());
    },
  };
}

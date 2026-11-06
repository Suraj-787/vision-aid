"use client";

import { useSyncExternalStore } from "react";
import { createPrefsStore, DEFAULT_PREFS, type A11yPrefs, type StorageLike } from "@/lib/a11y/preferences";

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // blocked (private mode, site data disabled)
  }
}

// One store for the page. It reads storage lazily (first snapshot) and writes only when
// the person changes a preference.
const store = createPrefsStore(browserStorage());
const serverSnapshot = () => DEFAULT_PREFS;

export function useA11yPrefs(): { prefs: A11yPrefs; update: (change: Partial<A11yPrefs>) => void } {
  const prefs = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  return { prefs, update: store.update };
}

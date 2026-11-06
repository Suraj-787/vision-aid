"use client";

import { useCallback, useEffect, useState } from "react";
import { Announcer } from "@/lib/a11y/announcer";

/**
 * The text for the single polite live region. See lib/a11y/announcer.ts for the rules
 * (no immediate repeats, identical text re-announced by clearing first).
 */
export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const [announcer] = useState(
    () =>
      new Announcer({
        set: setMessage,
        now: () => performance.now(),
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }),
  );
  useEffect(() => () => announcer.dispose(), [announcer]);
  const announce = useCallback((text: string) => void announcer.announce(text), [announcer]);
  return { message, announce };
}

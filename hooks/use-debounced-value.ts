"use client";

import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates after `delayMs` of stability.
 * Useful to avoid firing requests on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  // index.html already applied the class before first paint — just read it
  // back so React state matches the DOM with no extra work.
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Small, dependency-free dark/light theme controller.
 *
 * - Zero layout/network cost: it only toggles a `dark` class on <html>,
 *   which Tailwind's `dark:` variants key off of (see the `@custom-variant
 *   dark` rule in index.css). No extra CSS is shipped, no images swap.
 * - No flash on load: index.html sets the class synchronously before React
 *   even mounts, so this hook just mirrors that state.
 * - Persists the choice in localStorage so it survives reloads.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage can throw in private-browsing/sandboxed contexts — theme
      // still works for the current session, it just won't persist.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, toggleTheme, setTheme: setThemeState };
}

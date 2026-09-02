/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { motion } from 'motion/react';
import { useTheme } from '../lib/theme';

/**
 * Creative light/dark theme switch for the header.
 *
 * Built as a small pill-track toggle (not a plain icon button) so it reads
 * as its own distinct control at a glance, with a sliding knob and a
 * crossfading sun/moon glyph. Pure CSS + a couple of `motion` spring
 * transitions — no images, no extra libraries, no measurable weight added
 * to the bundle since `motion` is already used throughout the app.
 */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="relative flex items-center h-9 w-[60px] rounded-full border border-gray-150 dark:border-slate-800 bg-white dark:bg-slate-900 px-1 cursor-pointer transition-colors duration-300 shrink-0"
    >
      {/* Track glow, brighter once dark mode is active */}
      <motion.span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        animate={{
          background: isDark
            ? 'linear-gradient(90deg, rgba(37,99,235,0.35), rgba(59,130,246,0.15))'
            : 'linear-gradient(90deg, rgba(99,102,241,0.08), rgba(99,102,241,0))',
        }}
        transition={{ duration: 0.35 }}
      />

      {/* Static dimmed icons in the track so both ends are always legible */}
      <Sun size={13} className="absolute left-[7px] text-amber-400 dark:text-slate-600 z-0" />
      <Moon size={13} className="absolute right-[7px] text-gray-300 dark:text-blue-300 z-0" />

      {/* Sliding knob */}
      <motion.span
        className="relative z-10 flex items-center justify-center h-7 w-7 rounded-full bg-white dark:bg-slate-950 shadow-md ring-1 ring-black/5 dark:ring-blue-500/30"
        animate={{ x: isDark ? 26 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      >
        <motion.span
          key={isDark ? 'moon' : 'sun'}
          initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="flex items-center justify-center"
        >
          {isDark ? (
            <Moon size={14} className="text-blue-400" fill="currentColor" fillOpacity={0.15} />
          ) : (
            <Sun size={14} className="text-amber-500" />
          )}
        </motion.span>
      </motion.span>
    </button>
  );
}

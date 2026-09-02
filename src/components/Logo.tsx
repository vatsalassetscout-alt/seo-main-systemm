/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface LogoProps {
  /** Tailwind height utility for the image, e.g. "h-7 sm:h-8" */
  imgHeightClassName?: string;
  /** Extra classes for the outer wrapper */
  className?: string;
}

/**
 * Brand logo — rendered directly against the page background, no boxed
 * "chip" or card behind it. The source asset is a black logo on a
 * transparent background, so in dark mode we invert it to white via a CSS
 * filter instead of giving it a light backing plate; that way it reads as
 * part of the header rather than a separate image pasted on top.
 *
 * If the remote image ever fails to load (network hiccup, blocked host,
 * etc.) we fall back to a plain text wordmark instead of a broken-image
 * icon, so the brand mark is never invisible.
 */
export default function Logo({ imgHeightClassName = 'h-7 sm:h-8', className = '' }: LogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <span className={`font-black tracking-tight text-slate-900 dark:text-white text-sm sm:text-base whitespace-nowrap ${className}`}>
        Asset<span className="text-indigo-600 dark:text-blue-400">Scout</span>
      </span>
    );
  }

  return (
    <img
      src="https://assetscout.in/assets/images/Assetscout%20Logo%20Black.webp"
      alt="Assetscout Logo"
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setImgFailed(true)}
      className={`${imgHeightClassName} w-auto object-contain block dark:invert dark:brightness-200 ${className}`}
    />
  );
}

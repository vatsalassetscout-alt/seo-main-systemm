/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';

interface LogoProps {
  /** Tailwind height utility for the image, e.g. "h-7 sm:h-8" */
  imgHeightClassName?: string;
  /** Extra classes for the outer chip wrapper */
  className?: string;
}

/**
 * Brand logo, wrapped in a small light "chip" so it stays legible no matter
 * the active theme. The source asset is a black logo on a transparent
 * background — on its own it disappears against dark surfaces, so instead
 * of relying on a CSS filter, we give it a permanent light backing.
 *
 * If the remote image ever fails to load (network hiccup, blocked host,
 * etc.) we fall back to a styled text wordmark instead of a broken-image
 * icon, so the brand mark is never invisible.
 */
export default function Logo({ imgHeightClassName = 'h-7 sm:h-8', className = '' }: LogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <span
      className={`inline-flex items-center rounded-lg bg-white px-2 py-1 shadow-sm ring-1 ring-black/5 shrink-0 ${className}`}
    >
      {!imgFailed ? (
        <img
          src="https://assetscout.in/assets/images/Assetscout%20Logo%20Black.webp"
          alt="Assetscout Logo"
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${imgHeightClassName} w-auto object-contain block`}
        />
      ) : (
        <span className="font-black tracking-tight text-slate-900 text-sm sm:text-base px-0.5 whitespace-nowrap">
          Asset<span className="text-indigo-600">Scout</span>
        </span>
      )}
    </span>
  );
}

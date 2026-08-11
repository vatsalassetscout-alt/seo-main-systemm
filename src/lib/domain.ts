/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strips "http://", "https://" and a leading "www." from a domain/URL so it
 * is always DISPLAYED as a bare domain, e.g. "example.com" instead of
 * "https://www.example.com". Also trims any trailing slash / path so table
 * cells stay clean. Safe to call on already-clean domains.
 */
export function cleanDomain(raw: string | null | undefined): string {
  if (!raw) return '';
  let d = String(raw).trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/^www\./i, '');
  d = d.replace(/\/+$/, '');
  return d.trim();
}

/**
 * Builds a safe, clickable https:// href from any stored domain value,
 * regardless of whether it already has a protocol or "www." prefix.
 * Use this for the `href` attribute; use cleanDomain() for the visible text.
 */
export function domainHref(raw: string | null | undefined): string {
  const bare = cleanDomain(raw);
  return bare ? `https://${bare}` : '#';
}

/** Prefer graphemes; older browsers still retain every Unicode code point. */
export function splitBio(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text);
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment);
}

/**
 * A quick-action seed. `nonce` is what makes a repeat click of the same chip
 * apply again; the text alone is not enough, since clicking "Write a doc" twice
 * sends identical text.
 */
export interface ComposerPrefill {
  text: string;
  nonce: number;
}

/**
 * How a starter-chip seed folds into the composer's current value.
 *
 * A field holding only the previous seed (`seededPrefix`) is replaced, so
 * clicking a second starter swaps intent instead of stacking the literal
 * nonsense "Explain Help me think through a strategy for Help me write a doc
 * about ". Words the user typed on top of a seed always survive: the opener
 * swaps while their text (the subject of the sentence) stays. With no previous
 * seed, an empty field takes the seed alone and a field with the user's own
 * text keeps every character, seed in front.
 */
export function mergeSeed(current: string, seededPrefix: string, seedText: string): string {
  if (seededPrefix && current === seededPrefix) return seedText;
  if (seededPrefix && current.startsWith(seededPrefix)) {
    return `${seedText}${current.slice(seededPrefix.length)}`;
  }
  return current.trim() ? `${seedText}${current.trimStart()}` : seedText;
}

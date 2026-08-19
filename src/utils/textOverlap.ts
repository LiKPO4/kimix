/**
 * Longest overlap between a suffix of `left` and a prefix of `right`,
 * computed with the KMP failure function in O(|left| + |right|) time and
 * O(|right|) space with no intermediate string allocations.
 *
 * Callers pass whitespace-normalized text; the returned length is measured
 * in normalized characters. Returns 0 when the overlap is shorter than
 * `minLength`.
 */
export function longestSuffixPrefixOverlap(
  left: string,
  right: string,
  minLength: number,
): number {
  if (!left || !right) return 0;
  const fail = new Int32Array(right.length);
  let matched = 0;
  for (let i = 1; i < right.length; i += 1) {
    while (matched > 0 && right[i] !== right[matched]) matched = fail[matched - 1];
    if (right[i] === right[matched]) matched += 1;
    fail[i] = matched;
  }
  let state = 0;
  for (let i = 0; i < left.length; i += 1) {
    while (state > 0 && left[i] !== right[state]) state = fail[state - 1];
    if (left[i] === right[state]) state += 1;
    if (state === right.length) break;
  }
  return state >= minLength ? state : 0;
}

/**
 * Remove the first `overlapChars` whitespace-normalized characters from
 * `text` while keeping the original formatting of the remainder. Whitespace
 * runs count as one character, matching `text.replace(/\s+/g, " ").trim()`
 * length accounting.
 */
export function stripNormalizedPrefix(text: string, overlapChars: number): string {
  if (overlapChars <= 0) return text;
  let remaining = overlapChars;
  let index = 0;
  let inWhitespaceRun = false;
  while (index < text.length && remaining > 0) {
    const ch = text[index];
    if (/\s/.test(ch)) {
      if (!inWhitespaceRun) {
        remaining -= 1;
        inWhitespaceRun = true;
      }
      index += 1;
      continue;
    }
    inWhitespaceRun = false;
    remaining -= 1;
    index += 1;
  }
  return text.slice(index);
}

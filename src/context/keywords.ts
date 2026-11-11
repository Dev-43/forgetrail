const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was',
  'were', 'will', 'not', 'but', 'all', 'any', 'can', 'has', 'had', 'her',
  'him', 'his', 'how', 'our', 'out', 'see', 'she', 'too', 'use', 'you',
  'about', 'after', 'again', 'also', 'been', 'before', 'being', 'between',
  'both', 'come', 'could', 'does', 'down', 'each', 'even', 'first', 'give',
  'good', 'great', 'into', 'just', 'know', 'like', 'make', 'many', 'more',
  'most', 'much', 'must', 'name', 'only', 'other', 'over', 'said', 'same',
  'should', 'some', 'such', 'take', 'than', 'them', 'then', 'there', 'these',
  'they', 'time', 'very', 'what', 'when', 'which', 'who', 'will', 'with',
  'would', 'your', 'please', 'update', 'modify', 'change', 'check', 'make',
  'true', 'false', 'none', 'null',
]);

/**
 * Extracts normalized query/task keywords:
 * 1. Splits on non-alphanumerics (excluding underscores).
 * 2. Lowercases tokens.
 * 3. Filters out stopwords and tokens with length < 3.
 * 4. Returns unique keyword tokens in order of appearance.
 */
export function extractKeywords(text: string): string[] {
  if (!text) return [];

  // Match words / identifiers (alphanumeric + underscore)
  const tokens = text.match(/[A-Za-z0-9_]+/g) || [];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.length >= 3 && !STOPWORDS.has(lower) && !seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }

  return result;
}

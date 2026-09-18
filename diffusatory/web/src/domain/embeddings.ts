import { normalizedField, type NormalizedField } from "./loras";

export interface IndexedEmbedding {
  name: string;
  normalized: NormalizedField;
  tokens: string[];
}

export function indexEmbedding(name: string): IndexedEmbedding {
  const normalized = normalizedField(name);
  const tokens = name
    .toLowerCase()
    .split(/[/\\_.\s-]+/)
    .filter(Boolean);
  return { name, normalized, tokens };
}

export function indexEmbeddings(names: string[]): IndexedEmbedding[] {
  return names.map(indexEmbedding);
}

export interface EmbeddingMatch {
  name: string;
  score: number;
  indexes: number[];
}

/**
 * Match a single indexed embedding against a normalized search query.
 * Returns null if no match, or an EmbeddingMatch with ranking score and highlighted indexes.
 */
export function matchIndexedEmbedding(
  candidate: IndexedEmbedding,
  query: NormalizedField,
): EmbeddingMatch | null {
  if (!query.text || !candidate.normalized.text) return null;

  // 1. Exact match on raw name
  if (candidate.name.toLowerCase() === query.text) {
    return {
      name: candidate.name,
      score: 0,
      indexes: candidate.normalized.sourceIndexes.slice(0, candidate.name.length),
    };
  }

  // 2. Exact prefix match on normalized text
  if (candidate.normalized.text.startsWith(query.text)) {
    return {
      name: candidate.name,
      score: 0.1 + (candidate.normalized.text.length - query.text.length) * 0.001,
      indexes: candidate.normalized.sourceIndexes.slice(0, query.text.length),
    };
  }

  // 3. Token boundary prefix match (e.g., query "hand" matches "bad-hands-5")
  for (let i = 0; i < candidate.tokens.length; i++) {
    const token = candidate.tokens[i];
    if (token.startsWith(query.text)) {
      const tokenPos = candidate.normalized.text.indexOf(query.text);
      const sliceStart = tokenPos >= 0 ? tokenPos : 0;
      return {
        name: candidate.name,
        score: 1.0 + i * 0.1,
        indexes: candidate.normalized.sourceIndexes.slice(
          sliceStart,
          sliceStart + query.text.length,
        ),
      };
    }
  }

  // 4. Substring match in normalized text
  const directIndex = candidate.normalized.text.indexOf(query.text);
  if (directIndex >= 0) {
    return {
      name: candidate.name,
      score: 2.0 + directIndex * 0.01,
      indexes: candidate.normalized.sourceIndexes.slice(
        directIndex,
        directIndex + query.text.length,
      ),
    };
  }

  // 5. Fuzzy match for queries of 3+ characters
  if (query.text.length < 3) return null;

  const normalizedIndexes: number[] = [];
  let queryIndex = 0;
  for (
    let candidateIndex = 0;
    candidateIndex < candidate.normalized.text.length &&
    queryIndex < query.text.length;
    candidateIndex++
  ) {
    if (candidate.normalized.text[candidateIndex] === query.text[queryIndex]) {
      normalizedIndexes.push(candidateIndex);
      queryIndex++;
    }
  }

  if (queryIndex !== query.text.length) return null;

  const first = normalizedIndexes[0];
  const last = normalizedIndexes[normalizedIndexes.length - 1] ?? first;
  const span = last - first + 1;
  const gaps = span - query.text.length;

  if (query.text.length / span < 0.45 || gaps > Math.max(6, query.text.length)) {
    return null;
  }

  return {
    name: candidate.name,
    score: 5.0 + gaps * 0.25 + first * 0.02,
    indexes: Array.from(
      new Set(normalizedIndexes.map((idx) => candidate.normalized.sourceIndexes[idx])),
    ),
  };
}

/**
 * Searches indexed embeddings and returns all matching embedding names in ranked order.
 * If search is blank, returns all names sorted alphabetically.
 */
export function searchEmbeddings(
  indexedEmbeddings: IndexedEmbedding[],
  search: string,
): string[] {
  const query = normalizedField(search);
  if (!query.text) {
    return [...indexedEmbeddings]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => e.name);
  }

  const matches: EmbeddingMatch[] = [];
  for (const item of indexedEmbeddings) {
    const match = matchIndexedEmbedding(item, query);
    if (match) {
      matches.push(match);
    }
  }

  matches.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return matches.map((m) => m.name);
}

import type { Lora, LoraDefaults } from "../api/forge/types";

export interface ActiveLoraKeyword {
  text: string;
  weight: number;
  enabled: boolean;
}

export interface ActiveLora {
  id: string;
  name: string;
  reference: string;
  enabled: boolean;
  strength: number;
  keywords: ActiveLoraKeyword[];
}

function finiteWeight(value: number, fallback = 1): number {
  return Number.isFinite(value) ? Math.max(-10, Math.min(10, value)) : fallback;
}

export function activeLoraFromCatalog(lora: Lora): ActiveLora {
  return {
    id: lora.id,
    name: lora.name,
    reference: lora.reference || lora.name,
    enabled: true,
    strength: finiteWeight(lora.defaults.preferred_strength),
    keywords: lora.defaults.keywords.map((keyword) => ({
      text: keyword.text,
      weight: finiteWeight(keyword.weight),
      enabled: keyword.enabled,
    })),
  };
}

export function restoreLoraDefaults(active: ActiveLora, lora: Lora): ActiveLora {
  return {
    ...active,
    strength: finiteWeight(lora.defaults.preferred_strength),
    keywords: lora.defaults.keywords.map((keyword) => ({
      text: keyword.text,
      weight: finiteWeight(keyword.weight),
      enabled: keyword.enabled,
    })),
  };
}

export function defaultsFromActiveLora(
  active: ActiveLora,
  catalog: Lora,
): LoraDefaults {
  return {
    ...catalog.defaults,
    preferred_strength: finiteWeight(active.strength),
    keywords: active.keywords.map((keyword) => ({
      text: keyword.text.trim(),
      weight: finiteWeight(keyword.weight),
      enabled: keyword.enabled,
    })).filter((keyword) => keyword.text),
  };
}

export function normalizedPromptText(value: string): string {
  return value
    .replace(/<lora:[^>]+>/gi, " ")
    .replaceAll("_", " ")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function promptContainsTerm(prompt: string, term: string): boolean {
  const haystack = normalizedPromptText(prompt);
  const needle = normalizedPromptText(term);
  return Boolean(needle) && ` ${haystack} `.includes(` ${needle} `);
}

function promptContainsLora(prompt: string, reference: string): boolean {
  const references = [...prompt.matchAll(/<lora:([^:>]+):[^>]+>/gi)]
    .map((match) => match[1].trim().toLocaleLowerCase());
  return references.includes(reference.trim().toLocaleLowerCase());
}

function formattedWeight(value: number): string {
  const rounded = Math.round(finiteWeight(value) * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}.0` : `${rounded}`;
}

export function weightedPromptTerm(keyword: ActiveLoraKeyword): string {
  const text = keyword.text.trim();
  if (Math.abs(keyword.weight - 1) < 0.000001) return text;
  return `(${text}:${formattedWeight(keyword.weight)})`;
}

/**
 * Compile structured LoRA contributions without rewriting authored prompt
 * text. Duplicate detection is repeated for every realized dynamic prompt.
 */
export function compilePromptWithLoras(
  authoredPrompt: string,
  loras: ActiveLora[],
): string {
  const parts = authoredPrompt.trim() ? [authoredPrompt.trim()] : [];
  let comparisonPrompt = authoredPrompt;
  for (const lora of loras) {
    if (!lora.enabled) continue;
    for (const keyword of lora.keywords) {
      if (!keyword.enabled || !keyword.text.trim()) continue;
      if (promptContainsTerm(comparisonPrompt, keyword.text)) continue;
      parts.push(weightedPromptTerm(keyword));
      comparisonPrompt = `${comparisonPrompt}, ${keyword.text}`;
    }
    if (!promptContainsLora(comparisonPrompt, lora.reference)) {
      const directive = `<lora:${lora.reference}:${formattedWeight(lora.strength)}>`;
      parts.push(directive);
      comparisonPrompt = `${comparisonPrompt}, ${directive}`;
    }
  }
  return parts.join(", ");
}

function subsequenceScore(candidate: string, query: string): number | null {
  if (!query) return 0;
  let queryIndex = 0;
  let gap = 0;
  let first = -1;
  for (let index = 0; index < candidate.length && queryIndex < query.length; index += 1) {
    if (candidate[index] === query[queryIndex]) {
      if (first < 0) first = index;
      queryIndex += 1;
    } else if (queryIndex > 0) {
      gap += 1;
    }
  }
  return queryIndex === query.length ? first + gap * 0.2 : null;
}

export function loraSearchScore(lora: Lora, search: string): number | null {
  const query = normalizedPromptText(search);
  if (!query) return 0;
  const fields: Array<[string, number]> = [
    [lora.name, 0],
    [lora.alias, 0.25],
    [lora.relative_path, 0.5],
    [lora.defaults.keywords.map((keyword) => keyword.text).join(" "), 1],
    [lora.recommended_keywords.join(" "), 1.5],
    [lora.tags.join(" "), 2],
  ];
  let best: number | null = null;
  for (const [field, penalty] of fields) {
    const normalized = normalizedPromptText(field);
    const direct = normalized.indexOf(query);
    const score = direct >= 0 ? direct * 0.01 : subsequenceScore(normalized, query);
    if (score === null) continue;
    const weighted = score + penalty;
    best = best === null ? weighted : Math.min(best, weighted);
  }
  return best;
}

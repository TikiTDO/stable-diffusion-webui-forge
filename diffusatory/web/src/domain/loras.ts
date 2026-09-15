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

/**
 * Keep the compact LoRA card useful even when metadata supplies dozens of
 * activation suggestions. Enabled terms are authored generation state, so
 * they always remain visible. Disabled suggestions only fill the remaining
 * compact slots.
 */
export function visibleLoraKeywordIndexes(
  keywords: ActiveLoraKeyword[],
  expanded: boolean,
  limit = 10,
): number[] {
  if (expanded || keywords.length <= limit) {
    return keywords.map((_, index) => index);
  }
  const enabled = keywords.flatMap((keyword, index) =>
    keyword.enabled ? [index] : [],
  );
  if (enabled.length >= limit) return enabled;
  const visible = new Set(enabled);
  for (let index = 0; index < keywords.length && visible.size < limit; index += 1) {
    if (!keywords[index].enabled) visible.add(index);
  }
  return keywords.flatMap((_, index) => (visible.has(index) ? [index] : []));
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

export type LoraSearchGroup = "identity" | "tags" | "activation" | "details";

export interface LoraSearchMatch {
  group: LoraSearchGroup;
  field: "Title" | "Alias" | "Filename" | "Path" | "Tag" | "Activation" | "Description" | "Notes";
  value: string;
  /** Code-point indexes in value, suitable for highlighting fuzzy matches. */
  indexes: number[];
  score: number;
}

interface SearchField {
  group: LoraSearchGroup;
  field: LoraSearchMatch["field"];
  value: string;
  penalty: number;
}

interface NormalizedField {
  text: string;
  sourceIndexes: number[];
}

const SEARCH_GROUP_ORDER: LoraSearchGroup[] = [
  "identity",
  "tags",
  "activation",
  "details",
];

function normalizedField(value: string): NormalizedField {
  let text = "";
  const sourceIndexes: number[] = [];
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const normalized = /[\p{L}\p{N}]/u.test(character)
      ? character.toLocaleLowerCase()
      : " ";
    for (const output of Array.from(normalized)) {
      if (output === " " && text.endsWith(" ")) continue;
      text += output;
      sourceIndexes.push(index);
    }
  }
  if (text.startsWith(" ")) {
    text = text.slice(1);
    sourceIndexes.shift();
  }
  if (text.endsWith(" ")) {
    text = text.slice(0, -1);
    sourceIndexes.pop();
  }
  return { text, sourceIndexes };
}

function matchField(value: string, search: string): { indexes: number[]; score: number } | null {
  const candidate = normalizedField(value);
  const query = normalizedField(search).text;
  if (!query || !candidate.text) return null;

  const direct = candidate.text.indexOf(query);
  if (direct >= 0) {
    return {
      indexes: [...new Set(candidate.sourceIndexes.slice(direct, direct + query.length))],
      score: direct * 0.01,
    };
  }
  // Tiny fuzzy queries turn almost every metadata corpus into a match. Keep
  // one- and two-character searches literal; fuzzy matching starts at three.
  if (query.length < 3) return null;

  const normalizedIndexes: number[] = [];
  let queryIndex = 0;
  for (
    let candidateIndex = 0;
    candidateIndex < candidate.text.length && queryIndex < query.length;
    candidateIndex += 1
  ) {
    if (candidate.text[candidateIndex] === query[queryIndex]) {
      normalizedIndexes.push(candidateIndex);
      queryIndex += 1;
    }
  }
  if (queryIndex !== query.length) return null;

  const first = normalizedIndexes[0];
  const last = normalizedIndexes.at(-1) ?? first;
  const span = last - first + 1;
  const gaps = span - query.length;
  if (query.length / span < 0.45 || gaps > Math.max(6, query.length)) {
    return null;
  }
  return {
    indexes: [
      ...new Set(normalizedIndexes.map((index) => candidate.sourceIndexes[index])),
    ],
    score: 5 + gaps * 0.25 + first * 0.02,
  };
}

function searchFields(lora: Lora): SearchField[] {
  const pathWithoutModelExtension = lora.relative_path.replace(
    /\.(?:safetensors|ckpt|pt|bin)$/i,
    "",
  );
  const activation = [
    ...lora.defaults.keywords.map((keyword) => keyword.text),
    ...lora.recommended_keywords,
  ].filter((value, index, values) =>
    values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index,
  );
  return [
    { group: "identity", field: "Title", value: lora.name, penalty: 0 },
    ...(lora.alias && lora.alias !== lora.name
      ? [{ group: "identity" as const, field: "Alias" as const, value: lora.alias, penalty: 0.1 }]
      : []),
    {
      group: "identity",
      field: "Filename",
      value:
        pathWithoutModelExtension.split("/").at(-1) ??
        pathWithoutModelExtension,
      penalty: 0.2,
    },
    ...(lora.relative_path.includes("/")
      ? [{ group: "identity" as const, field: "Path" as const, value: pathWithoutModelExtension, penalty: 0.3 }]
      : []),
    ...lora.tags.map((value) => ({
      group: "tags" as const,
      field: "Tag" as const,
      value,
      penalty: 0,
    })),
    ...activation.map((value) => ({
      group: "activation" as const,
      field: "Activation" as const,
      value,
      penalty: 0,
    })),
    ...(lora.description
      ? [{ group: "details" as const, field: "Description" as const, value: lora.description, penalty: 0 }]
      : []),
    ...(lora.defaults.notes
      ? [{ group: "details" as const, field: "Notes" as const, value: lora.defaults.notes, penalty: 0.1 }]
      : []),
  ];
}

/** Return the best field in the first matching result group. */
export function loraSearchMatch(lora: Lora, search: string): LoraSearchMatch | null {
  if (!normalizedField(search).text) return null;
  const fields = searchFields(lora);
  for (const group of SEARCH_GROUP_ORDER) {
    let best: LoraSearchMatch | null = null;
    for (const candidate of fields) {
      if (candidate.group !== group || !candidate.value) continue;
      const match = matchField(candidate.value, search);
      if (!match) continue;
      const result: LoraSearchMatch = {
        group,
        field: candidate.field,
        value: candidate.value,
        indexes: match.indexes,
        score: match.score + candidate.penalty,
      };
      if (!best || result.score < best.score) best = result;
    }
    if (best) return best;
  }
  return null;
}

export function loraSearchScore(lora: Lora, search: string): number | null {
  if (!normalizedField(search).text) return 0;
  const match = loraSearchMatch(lora, search);
  if (!match) return null;
  return SEARCH_GROUP_ORDER.indexOf(match.group) * 100 + match.score;
}

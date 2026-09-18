export interface PromptGroup {
  id: string;
  label: string;
  text: string;
  enabled: boolean;
}

export const SIGIL_REGEX = /⟦g:([^⟧]+)⟧/g;

export function expandPromptGroups(
  prompt: string,
  groups: PromptGroup[] = [],
): string {
  if (!groups || groups.length === 0) return prompt;
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  return prompt
    .replace(SIGIL_REGEX, (_match, id) => {
      const group = groupMap.get(id);
      if (!group) return "";
      return group.enabled ? group.text.trim() : "";
    })
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "")
    .trim();
}

export function extractPromptGroup(
  prompt: string,
  start: number,
  end: number,
  groups: PromptGroup[] = [],
  customLabel?: string,
): { nextPrompt: string; nextGroups: PromptGroup[]; newGroup: PromptGroup } {
  const [min, max] = start <= end ? [start, end] : [end, start];
  if (min >= max) {
    throw new Error("Selection range is empty");
  }
  const selected = prompt.slice(min, max).trim();
  if (!selected) {
    throw new Error("Selected text is empty");
  }
  const id = `g_${Date.now()}_${groups.length + 1}`;
  const label =
    customLabel?.trim() ||
    selected.slice(0, 18).trim().replace(/[^\w\s-]/g, "") ||
    `Group ${groups.length + 1}`;

  const newGroup: PromptGroup = {
    id,
    label,
    text: selected,
    enabled: true,
  };

  const sigil = `⟦g:${id}⟧`;
  const nextPrompt = `${prompt.slice(0, min)}${sigil}${prompt.slice(max)}`;
  const nextGroups = [...groups, newGroup];

  return { nextPrompt, nextGroups, newGroup };
}

export function removePromptGroup(
  prompt: string,
  groups: PromptGroup[],
  groupId: string,
  inline = false,
): { nextPrompt: string; nextGroups: PromptGroup[] } {
  const target = groups.find((g) => g.id === groupId);
  const nextGroups = groups.filter((g) => g.id !== groupId);
  const replacement = inline && target ? target.text : "";
  const sigil = `⟦g:${groupId}⟧`;
  const nextPrompt = prompt
    .split(sigil)
    .join(replacement)
    .replace(/\s{2,}/g, " ")
    .trim();

  return { nextPrompt, nextGroups };
}

export function togglePromptGroup(
  groups: PromptGroup[],
  groupId: string,
): PromptGroup[] {
  return groups.map((g) =>
    g.id === groupId ? { ...g, enabled: !g.enabled } : g,
  );
}

export function updatePromptGroup(
  groups: PromptGroup[],
  groupId: string,
  patch: Partial<PromptGroup>,
): PromptGroup[] {
  return groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g));
}

export function findGroupSigils(text: string): string[] {
  const matches: string[] = [];
  const regex = /⟦g:([^⟧]+)⟧/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

export function moveGroupSigil(
  text: string,
  groupId: string,
  targetIndex: number,
): string {
  const sigil = `⟦g:${groupId}⟧`;
  let without = text;
  let insertAt = targetIndex;
  if (text.includes(sigil)) {
    const oldIdx = text.indexOf(sigil);
    without = text.slice(0, oldIdx) + text.slice(oldIdx + sigil.length);
    if (insertAt > oldIdx) {
      insertAt = Math.max(0, insertAt - sigil.length);
    }
  }
  insertAt = Math.max(0, Math.min(insertAt, without.length));
  return `${without.slice(0, insertAt)} ${sigil} ${without.slice(insertAt)}`
    .replace(/\s{2,}/g, " ")
    .trim();
}

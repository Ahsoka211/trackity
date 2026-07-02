export interface RiotId {
  name: string;
  tag: string;
}

export function parseRiotId(input: string): RiotId | null {
  const trimmed = input.trim();
  const hashIndex = trimmed.indexOf('#');
  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) return null;

  const name = trimmed.slice(0, hashIndex).trim();
  const tag = trimmed.slice(hashIndex + 1).trim();
  if (!name || !tag || tag.includes('#')) return null;

  return { name, tag };
}

export interface PatchFile {
  path: string;
  kind: 'add' | 'update' | 'delete';
  movedTo?: string;
  /** Lines the patch adds (without the leading `+`). */
  added: string[];
}

/**
 * Parse Codex's apply_patch format:
 *   *** Begin Patch / *** Add File: p / *** Update File: p / *** Move to: q / *** Delete File: p / @@ / +x / -y / *** End Patch
 */
export function parseApplyPatch(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(raw);
    if (header?.[1] && header[2]) {
      current = { path: header[2].trim(), kind: header[1].toLowerCase() as PatchFile['kind'], added: [] };
      files.push(current);
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(raw);
    if (move?.[1] && current) {
      current.movedTo = move[1].trim();
      continue;
    }
    if (raw.startsWith('***')) continue;
    if (current && current.kind !== 'delete' && raw.startsWith('+')) current.added.push(raw.slice(1));
  }
  return files;
}

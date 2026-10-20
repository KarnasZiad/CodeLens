export interface DiffLine {
  kind: 'added' | 'removed' | 'context';
  content: string;
  /** Line number in the base version; absent for added lines. */
  oldLine?: number;
  /** Line number in the head version; absent for removed lines. */
  newLine?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second `@@`, usually the enclosing function. */
  section: string;
  lines: DiffLine[];
}

export interface AddedLine {
  line: number;
  content: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * Parses the hunks of a unified diff, such as the `patch` field of the GitHub files API.
 * Lines are consumed according to the counts of each hunk header, so a removed line that
 * starts with `--` or an added line that starts with `@@` is never mistaken for a header.
 * File headers (`diff --git`, `---`, `+++`) before the first hunk are skipped.
 */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  const lines = patch.split('\n');
  let index = 0;

  while (index < lines.length) {
    const header = HUNK_HEADER.exec(lines[index] ?? '');
    index += 1;
    if (!header) continue;

    const hunk: Hunk = {
      oldStart: Number(header[1]),
      oldLines: header[2] === undefined ? 1 : Number(header[2]),
      newStart: Number(header[3]),
      newLines: header[4] === undefined ? 1 : Number(header[4]),
      section: (header[5] ?? '').trim(),
      lines: [],
    };
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    let oldRemaining = hunk.oldLines;
    let newRemaining = hunk.newLines;

    while (index < lines.length && (oldRemaining > 0 || newRemaining > 0)) {
      const raw = lines[index] ?? '';
      index += 1;
      // "\ No newline at end of file" annotates the previous line.
      if (raw.startsWith('\\')) continue;
      const marker = raw.charAt(0);
      const content = raw.slice(1);
      if (marker === '+') {
        hunk.lines.push({ kind: 'added', content, newLine });
        newLine += 1;
        newRemaining -= 1;
      } else if (marker === '-') {
        hunk.lines.push({ kind: 'removed', content, oldLine });
        oldLine += 1;
        oldRemaining -= 1;
      } else {
        // A context line; some tools strip the leading space of an empty context line.
        hunk.lines.push({ kind: 'context', content, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
        oldRemaining -= 1;
        newRemaining -= 1;
      }
    }
    // A trailing "\ No newline" after the last counted line.
    if ((lines[index] ?? '').startsWith('\\')) index += 1;
    hunks.push(hunk);
  }
  return hunks;
}

/** Added lines with their line number in the head version. */
export function addedLines(hunks: readonly Hunk[]): AddedLine[] {
  const added: AddedLine[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'added' && line.newLine !== undefined) {
        added.push({ line: line.newLine, content: line.content.replace(/\r$/, '') });
      }
    }
  }
  return added;
}

/** Removed lines of the base version. */
export function removedLines(hunks: readonly Hunk[]): string[] {
  return hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => line.kind === 'removed').map((line) => line.content),
  );
}

/**
 * Groups consecutive added lines, so that a construct spanning several lines (a multi-line
 * template literal, for instance) can be matched as a whole.
 */
export function addedBlocks(lines: readonly AddedLine[]): AddedLine[][] {
  const blocks: AddedLine[][] = [];
  let current: AddedLine[] = [];
  for (const line of lines) {
    const previous = current.at(-1);
    if (previous && line.line !== previous.line + 1) {
      blocks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

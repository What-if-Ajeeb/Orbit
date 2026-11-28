import { artifactTypeLabel, isArtifactType } from '../artifacts/types';

/** Human labels for artifact operations shown while a tool call is running. */
const ARTIFACT_LABELS: Record<string, string> = {
  artifact_create: 'Creating artifact',
  artifact_update: 'Replacing artifact',
  artifact_edit: 'Editing artifact',
  artifact_read: 'Reading artifact',
  artifact_append: 'Appending to artifact',
  artifact_list: 'Listing artifacts',
};

function shortText(value: unknown, max = 60): string {
  if (typeof value !== 'string') {
    return '';
  }

  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function contentLength(value: unknown): number | null {
  return typeof value === 'string' ? value.length : null;
}

/**
 * Builds the running status shown in chat. Only ids, titles, types and sizes
 * are used — artifact content, edits and replacements never enter tool events.
 */
export function describeToolProgress(
  toolName: string,
  args: Record<string, unknown>
): { summary: string; detail?: string } {
  const label = ARTIFACT_LABELS[toolName];

  if (!label) {
    return { summary: `Running ${toolName}` };
  }

  if (toolName === 'artifact_list') {
    return { summary: label };
  }

  if (toolName === 'artifact_create') {
    const title = shortText(args.title);
    const type = isArtifactType(args.type) ? artifactTypeLabel(args.type) : '';
    const length = contentLength(args.content);

    return {
      summary: title ? `Creating “${title}”` : label,
      detail: [type, length === null ? null : `${length.toLocaleString()} characters`]
        .filter(Boolean)
        .join(' · ') || undefined,
    };
  }

  const id = shortText(args.id, 48);
  const length = contentLength(args.content);
  const editCount = Array.isArray(args.edits) ? args.edits.length : null;

  return {
    summary: id ? `${label} ${id}` : label,
    detail:
      length !== null
        ? `${length.toLocaleString()} characters`
        : editCount !== null
          ? `${editCount} exact change${editCount === 1 ? '' : 's'}`
          : undefined,
  };
}

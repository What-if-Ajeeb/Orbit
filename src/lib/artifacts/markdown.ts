/**
 * A small, safe Markdown to HTML converter for artifact previews.
 *
 * The entire input is HTML-escaped before any Markdown syntax is applied, so
 * raw HTML can never pass through to the WebView. Links are restricted to
 * http, https and mailto. Everything here is pure - easy to unit test.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;

/** Returns the URL when its scheme is allowed, otherwise null. */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();

  if (!SAFE_URL.test(url)) {
    return null;
  }

  return url;
}

/** Inline Markdown on already-escaped text. */
function renderInline(text: string): string {
  const codeSpans: string[] = [];

  let out = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `%%CODE${codeSpans.length - 1}%%`;
  });

  // Links: [label](url). Unsafe schemes degrade to plain label text.
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const safe = sanitizeUrl(url);
    return safe ? `<a href="${safe}">${label}</a>` : label;
  });

  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // Bold before italic so ** never becomes nested emphasis.
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Underscore italics need word boundaries so snake_case survives.
  out = out.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?;:])/gm, '$1<em>$2</em>');

  return out.replace(/%%CODE(\d+)%%/g, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function renderTable(headerLine: string, rows: string[][]): string {
  const header = splitRow(headerLine);
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('');

  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^&gt;\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^```/.test(line)
  );
}

type ListItem = {
  ordered: boolean;
  depth: number;
  content: string;
  task: 'open' | 'done' | null;
};

/** Parses one list line; two spaces of indentation are one nesting level. */
function parseListItem(line: string): ListItem | null {
  const match = /^([ \t]*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  const indent = match[1].replace(/\t/g, '  ').length;
  let content = match[3];
  let task: ListItem['task'] = null;
  const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(content);

  if (taskMatch) {
    task = taskMatch[1].toLowerCase() === 'x' ? 'done' : 'open';
    content = taskMatch[2];
  }

  return {
    ordered: /\d/.test(match[2]),
    depth: Math.floor(indent / 2),
    content,
    task,
  };
}

function renderListItemOpening(item: ListItem): string {
  const check =
    item.task === 'done'
      ? '<span class="task-done" aria-label="done">☑</span> '
      : item.task === 'open'
        ? '<span class="task-open" aria-label="not done">☐</span> '
        : '';

  return `<li>${check}${renderInline(item.content)}`;
}

type OpenList = { depth: number; tag: 'ol' | 'ul' };

/** Renders a list group. Deeper items are nested inside the preceding <li>. */
function renderList(items: ListItem[]): string {
  let html = '';
  const open: OpenList[] = [];

  for (const item of items) {
    const parentDepth = open.length > 0 ? open[open.length - 1].depth : -1;
    const depth = Math.min(item.depth, parentDepth + 1);
    const tag: 'ol' | 'ul' = item.ordered ? 'ol' : 'ul';

    while (open.length > 0 && depth < open[open.length - 1].depth) {
      const level = open.pop();
      if (level) {
        html += `</li></${level.tag}>`;
      }
    }

    if (open.length === 0) {
      html += `<${tag}>`;
      open.push({ depth, tag });
    } else if (depth === open[open.length - 1].depth) {
      html += '</li>';
    } else {
      html += `<${tag}>`;
      open.push({ depth, tag });
    }

    html += renderListItemOpening(item);
  }

  while (open.length > 0) {
    const level = open.pop();
    if (level) {
      html += `</li></${level.tag}>`;
    }
  }

  return html;
}

/** Converts Markdown to a fragment of safe HTML. */
export function markdownToHtml(markdown: string): string {
  const escaped = escapeHtml(markdown.replace(/\r\n/g, '\n'));
  const lines = escaped.split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);

    if (fence) {
      const language = fence[1];
      const body: string[] = [];
      index += 1;

      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }

      index += 1; // Closing fence (or end of input).
      const classAttr = language ? ` class="language-${language}"` : '';
      blocks.push(`<pre><code${classAttr}>${body.join('\n')}</code></pre>`);
      continue;
    }

    // ATX headings.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);

    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    // Blockquote.
    if (/^&gt;\s?/.test(line)) {
      const body: string[] = [];

      while (index < lines.length && /^&gt;\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^&gt;\s?/, ''));
        index += 1;
      }

      blocks.push(`<blockquote>${renderInline(body.join(' '))}</blockquote>`);
      continue;
    }

    // Table: a header row followed by a |---| separator row.
    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headerLine = line;
      index += 2;
      const rows: string[][] = [];

      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }

      blocks.push(renderTable(headerLine, rows));
      continue;
    }

    // Lists, including nested items and GitHub-style task markers.
    const firstItem = parseListItem(line);

    if (firstItem) {
      const items: ListItem[] = [];

      while (index < lines.length) {
        const item = parseListItem(lines[index]);
        if (!item) {
          break;
        }
        items.push(item);
        index += 1;
      }

      blocks.push(renderList(items));
      continue;
    }

    // Paragraph: consecutive plain lines.
    const paragraph: string[] = [line.trim()];
    index += 1;

    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return blocks.join('\n');
}

/**
 * Tiny, dependency-free tokenizer for the native code tab. It is intentionally
 * approximate: enough to make common tokens readable without pulling a full
 * parser (or a native highlighting library) into the app startup path.
 */

export type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number' | 'type';

export type CodeToken = {
  text: string;
  kind: CodeTokenKind;
};

const KEYWORDS: Record<string, Set<string>> = {
  js: new Set([
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
    'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function',
    'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super',
    'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'yield',
  ]),
  python: new Set([
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
    'with', 'yield',
  ]),
  json: new Set(['false', 'null', 'true']),
  css: new Set(['!important', 'inherit', 'initial', 'none', 'unset']),
  html: new Set(['false', 'null', 'true']),
  shell: new Set([
    'case', 'do', 'done', 'elif', 'else', 'esac', 'exit', 'export', 'fi', 'for', 'function',
    'if', 'in', 'local', 'return', 'then', 'while',
  ]),
  sql: new Set([
    'and', 'as', 'asc', 'by', 'create', 'delete', 'desc', 'drop', 'from', 'group', 'having',
    'insert', 'into', 'join', 'left', 'limit', 'not', 'null', 'on', 'or', 'order', 'right',
    'select', 'set', 'table', 'update', 'values', 'where',
  ]),
  swift: new Set([
    'class', 'defer', 'else', 'enum', 'extension', 'false', 'for', 'func', 'guard', 'if',
    'import', 'in', 'let', 'nil', 'private', 'public', 'return', 'self', 'struct', 'switch',
    'true', 'var', 'while',
  ]),
};

const GENERIC_KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'else', 'export',
  'false', 'finally', 'for', 'function', 'if', 'import', 'let', 'new', 'null', 'return',
  'switch', 'true', 'try', 'while',
]);

const TYPES = new Set([
  'any', 'bool', 'boolean', 'float', 'int', 'number', 'object', 'str', 'string', 'void',
]);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'js', jsx: 'js', javascript: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', typescript: 'js',
  py: 'python', python: 'python',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', xml: 'html', svg: 'html',
  sh: 'shell', bash: 'shell', shell: 'shell', zsh: 'shell',
  sql: 'sql',
  swift: 'swift',
  kt: 'js', kotlin: 'js', java: 'js', go: 'js', golang: 'js', rs: 'js', rust: 'js', rb: 'js', ruby: 'js', php: 'js',
};

const HASH_COMMENTS = new Set(['python', 'shell', 'ruby']);

function languageKey(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? '';
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

/** Tokenizes a single line. Block comments do not carry across lines. */
export function highlightCodeLine(line: string, language?: string | null): CodeToken[] {
  const key = languageKey(language);
  const keywords = KEYWORDS[key] ?? GENERIC_KEYWORDS;
  const hashComments = HASH_COMMENTS.has(key);
  const tokens: CodeToken[] = [];
  let plain = '';

  const flushPlain = () => {
    if (plain) {
      tokens.push({ text: plain, kind: 'plain' });
      plain = '';
    }
  };

  const push = (kind: CodeTokenKind, text: string) => {
    if (!text) {
      return;
    }
    if (kind === 'plain') {
      plain += text;
      return;
    }
    flushPlain();
    tokens.push({ text, kind });
  };

  for (let index = 0; index < line.length; ) {
    const char = line[index];
    const rest = line.slice(index);

    if (char === '"' || char === "'" || char === '`') {
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === '\\') {
          end += 2;
          continue;
        }
        if (line[end] === char) {
          end += 1;
          break;
        }
        end += 1;
      }
      push('string', line.slice(index, Math.min(end, line.length)));
      index = Math.min(end, line.length);
      continue;
    }

    if (rest.startsWith('<!--') || rest.startsWith('/*')) {
      push('comment', rest);
      break;
    }

    if (rest.startsWith('//') && key !== 'json') {
      push('comment', rest);
      break;
    }

    if (hashComments && char === '#') {
      push('comment', rest);
      break;
    }

    if (/\d/.test(char)) {
      let end = index + 1;
      while (end < line.length && /[A-Za-z0-9_.]/.test(line[end])) {
        end += 1;
      }
      push('number', line.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char)) {
      let end = index + 1;
      while (end < line.length && isIdentifierPart(line[end])) {
        end += 1;
      }
      const word = line.slice(index, end);

      if (keywords.has(word)) {
        push('keyword', word);
      } else if (TYPES.has(word) || /^[A-Z]/.test(word)) {
        push('type', word);
      } else {
        push('plain', word);
      }
      index = end;
      continue;
    }

    push('plain', char);
    index += 1;
  }

  flushPlain();
  return tokens;
}

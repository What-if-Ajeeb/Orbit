import type { AppColors } from '@/theme';

import { escapeHtml, markdownToHtml } from './markdown';
import type { ArtifactType } from './types';

/**
 * Content Security Policy injected by the app as the first element of
 * <head> for every artifact document. Artifacts can never reach the
 * network, open frames, submit forms, or set a base URL.
 */
export const ARTIFACT_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none';";

/**
 * Only html artifacts may run JavaScript. Everything else (markdown, svg,
 * code) is rendered with scripts disabled, which also matters on iOS where
 * the WebView has no switch to turn JavaScript off.
 */
const ARTIFACT_CSP_NO_SCRIPT = ARTIFACT_CSP.replace(
  "script-src 'unsafe-inline'",
  "script-src 'none'"
);

/**
 * Installed with `injectedJavaScriptBeforeContentLoaded`, so it is active
 * before any artifact script runs. Only HTML artifacts receive it. Messages
 * are capped, de-duplicated and carry no artifact content.
 */
export const ARTIFACT_ERROR_BRIDGE_JS = `(function () {
  if (typeof window === 'undefined' || !window.addEventListener) return;

  var MAX_MESSAGES = 20;
  var MAX_LENGTH = 500;
  var sent = 0;
  var seen = Object.create(null);

  function post(type, value) {
    if (sent >= MAX_MESSAGES) return;

    var message = String(value == null ? '' : value).slice(0, MAX_LENGTH);
    if (!message) return;

    var key = type + ':' + message;
    if (seen[key]) return;
    seen[key] = 1;
    sent += 1;

    try {
      var bridge = window.ReactNativeWebView;
      if (bridge && typeof bridge.postMessage === 'function') {
        bridge.postMessage(JSON.stringify({
          source: 'orbit-artifact',
          type: type,
          message: message
        }));
      }
    } catch (error) {
      // The bridge must never add noise of its own.
    }
  }

  window.addEventListener('error', function (event) {
    post('error', event && event.message ? event.message : 'Unknown script error');
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    var text = reason && reason.message ? reason.message : reason;
    post('error', 'Unhandled promise rejection: ' + (text == null ? '' : text));
  }, true);

  if (typeof console === 'undefined') return;

  ['error', 'warn'].forEach(function (level) {
    var original = console[level];
    if (typeof original !== 'function') return;

    console[level] = function () {
      var parts = [];

      for (var index = 0; index < arguments.length; index += 1) {
        var value = arguments[index];
        parts.push(value && value.message ? value.message : String(value));
      }

      post(level === 'error' ? 'console_error' : 'console_warn', parts.join(' '));
      return original.apply(console, arguments);
    };
  });
})();`;

export type PreviewTheme = {
  isLight: boolean;
  colors: AppColors;
};

type PreviewInput = { type: ArtifactType; content: string };

type TagInfo = {
  name: string;
  start: number;
  end: number;
  closing: boolean;
  selfClosing: boolean;
};

/** Tags whose contents must never be scanned for fake markup. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/** Finds a tag's `>` without treating `>` inside quoted attributes as the end. */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;

  for (let index = from; index < html.length; index += 1) {
    const char = html[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') {
      return index;
    }
  }

  return html.length - 1;
}

/**
 * Minimal, allocation-light tag scan. Comments, declarations and raw-text
 * blocks are skipped, and tag names are matched exactly, so `<header>`,
 * `<head>` inside a script string, and a comment containing `<head>` cannot
 * fool the CSP injection.
 */
function scanTags(html: string): TagInfo[] {
  const tags: TagInfo[] = [];
  let index = 0;

  while (index < html.length) {
    if (html.startsWith('<!--', index)) {
      const close = html.indexOf('-->', index + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }

    if (html.startsWith('<!', index)) {
      index = findTagEnd(html, index + 2) + 1;
      continue;
    }

    if (html[index] !== '<' || !/[A-Za-z]/.test(html[index + 1] ?? '')) {
      index += 1;
      continue;
    }

    const end = findTagEnd(html, index + 1) + 1;
    const raw = html.slice(index + 1, end - 1);
    const match = /^\/?\s*([a-z][a-z0-9-]*)/i.exec(raw);

    if (match) {
      const name = match[1].toLowerCase();
      const closing = raw.startsWith('/');
      const selfClosing = /\/\s*$/.test(raw);

      tags.push({ name, start: index, end, closing, selfClosing });

      if (!closing && !selfClosing && RAW_TEXT_TAGS.has(name)) {
        const closeTag = new RegExp(`</${name}\\s*>`, 'ig');
        closeTag.lastIndex = end;
        const found = closeTag.exec(html);
        index = found ? closeTag.lastIndex : html.length;
        continue;
      }
    }

    index = end;
  }

  return tags;
}

function stripLeadingDoctype(html: string): string {
  const match = /^\s*<!doctype[^>]*>/i.exec(html);
  return match ? html.slice(match[0].length) : html;
}

function headMeta(csp: string): string {
  return (
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
  );
}

/**
 * Inserts the CSP meta tag as the first element of a usable <head>, adding
 * charset and viewport alongside it. If the document has no safe head (or a
 * script starts before one), a fresh head is created ahead of that script;
 * fragments get a complete page wrapper. The CSP itself is never weakened.
 */
export function injectCsp(html: string, csp: string): string {
  const meta = headMeta(csp);
  const tags = scanTags(html);
  const head = tags.find((tag) => tag.name === 'head' && !tag.closing && !tag.selfClosing);
  const script = tags.find((tag) => tag.name === 'script' && !tag.closing && !tag.selfClosing);
  const htmlTag = tags.find((tag) => tag.name === 'html' && !tag.closing && !tag.selfClosing);
  const bodyTag = tags.find((tag) => tag.name === 'body' && !tag.closing && !tag.selfClosing);

  if (head && (!script || head.start < script.start)) {
    return html.slice(0, head.end) + meta + html.slice(head.end);
  }

  if (htmlTag && (!script || htmlTag.end < script.start)) {
    return html.slice(0, htmlTag.end) + `<head>${meta}</head>` + html.slice(htmlTag.end);
  }

  // A script before any head or <html> tag would execute before a CSP placed
  // later, so wrap the fragment and put a head in front of it.
  if (script && (!htmlTag || script.start < htmlTag.start)) {
    return `<!DOCTYPE html><html><head>${meta}</head><body>${stripLeadingDoctype(html)}</body></html>`;
  }

  if (bodyTag && (!script || bodyTag.start < script.start)) {
    const beforeBody = stripLeadingDoctype(html.slice(0, bodyTag.start));
    return `<!DOCTYPE html><html>${beforeBody}<head>${meta}</head>${html.slice(bodyTag.start)}`;
  }

  return `<!DOCTYPE html><html><head>${meta}</head><body>${stripLeadingDoctype(html)}</body></html>`;
}

function baseCss(theme: PreviewTheme): string {
  const { colors } = theme;

  return `
:root { color-scheme: ${theme.isLight ? 'light' : 'dark'}; }
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: ${colors.background};
  color: ${colors.text};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-text-size-adjust: 100%;
}
body { padding: 20px 16px 40px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.6em; }
h1 { font-size: 1.7em; }
h2 { font-size: 1.4em; }
h3 { font-size: 1.2em; }
p { margin: 0.8em 0; }
a { color: ${colors.accent}; }
strong { font-weight: 700; }
code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: ${colors.surfaceAlt};
  border-radius: 4px;
  padding: 1px 5px;
}
pre {
  background: ${colors.surfaceAlt};
  border: 1px solid ${colors.border};
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
}
pre code { background: none; padding: 0; }
blockquote {
  margin: 1em 0;
  padding: 4px 16px;
  border-left: 3px solid ${colors.accent};
  color: ${colors.textMuted};
}
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid ${colors.border}; padding: 6px 10px; text-align: left; }
th { background: ${colors.surfaceAlt}; }
hr { border: none; border-top: 1px solid ${colors.border}; margin: 1.6em 0; }
ul, ol { padding-left: 1.4em; }
img, svg { max-width: 100%; height: auto; }
.graphic { display: flex; justify-content: center; padding: 8px 0; }
.markdown a { word-break: break-word; }
`.trim();
}

function renderBody(input: PreviewInput): string {
  if (input.type === 'markdown') {
    return `<article class="markdown">${markdownToHtml(input.content)}</article>`;
  }

  if (input.type === 'svg') {
    return `<div class="graphic">${input.content}</div>`;
  }

  return `<pre class="source"><code>${escapeHtml(input.content)}</code></pre>`;
}

/**
 * Builds the complete HTML document handed to the WebView. Markdown, SVG and
 * code are wrapped in a themed base page; html artifacts are used as written
 * with safe document-start metadata injected around their existing markup.
 */
export function buildPreviewDocument(
  input: PreviewInput,
  theme: PreviewTheme
): string {
  if (input.type === 'html') {
    return injectCsp(input.content, ARTIFACT_CSP);
  }

  const csp = ARTIFACT_CSP_NO_SCRIPT;
  const css = baseCss(theme);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Artifact preview</title>
<style>
${css}
</style>
</head>
<body>
${renderBody(input)}
</body>
</html>`;
}

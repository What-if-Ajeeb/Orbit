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

export type PreviewTheme = {
  isLight: boolean;
  colors: AppColors;
};

type PreviewInput = { type: ArtifactType; content: string };

/**
 * Inserts the CSP meta tag as the first element of <head>. If the document
 * has no usable head (or a suspicious one after a script), a fresh head is
 * created right after <html>; fragments get a complete page wrapper.
 */
export function injectCsp(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  const headMatch = /<head[^>]*>/i.exec(html);
  const scriptIndex = html.search(/<script[\s>]/i);

  if (headMatch && headMatch.index !== undefined && (scriptIndex === -1 || headMatch.index < scriptIndex)) {
    const insertAt = headMatch.index + headMatch[0].length;
    return html.slice(0, insertAt) + meta + html.slice(insertAt);
  }

  const htmlMatch = /<html[^>]*>/i.exec(html);

  if (htmlMatch && htmlMatch.index !== undefined) {
    const insertAt = htmlMatch.index + htmlMatch[0].length;
    return html.slice(0, insertAt) + `<head>${meta}</head>` + html.slice(insertAt);
  }

  return `<!DOCTYPE html><html><head>${meta}</head><body>${html}</body></html>`;
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
 * with only the CSP injected.
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

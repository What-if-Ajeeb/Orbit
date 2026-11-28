import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_CSP,
  ARTIFACT_ERROR_BRIDGE_JS,
  buildPreviewDocument,
  injectCsp,
  type PreviewTheme,
} from './preview';

const theme = {
  isLight: false,
  colors: {
    background: '#101010',
    text: '#f5f5f5',
    accent: '#ff7755',
    surfaceAlt: '#202020',
    border: '#333333',
    textMuted: '#aaaaaa',
  },
} as unknown as PreviewTheme;

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
const NO_SCRIPT_CSP = ARTIFACT_CSP.replace(
  "script-src 'unsafe-inline'",
  "script-src 'none'"
);
const NO_SCRIPT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="${NO_SCRIPT_CSP}">`;

function firstHeadContents(document: string): string {
  const match = /<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i.exec(document);
  return match ? match[1].trimStart() : '';
}

describe('artifact preview documents', () => {
  it('puts CSP, charset and viewport first in a real uppercase head', () => {
    const document = injectCsp(
      '<!DOCTYPE html><HTML><HEAD><title>x</title></HEAD><BODY>hi</BODY></HTML>',
      ARTIFACT_CSP
    );

    expect(firstHeadContents(document).startsWith(CSP_META)).toBe(true);
    expect(firstHeadContents(document)).toContain('<meta charset="utf-8">');
    expect(firstHeadContents(document)).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
    );
    expect(document).toContain('<title>x</title>');
    expect(document.match(/<!DOCTYPE html>/gi)).toHaveLength(1);
  });

  it('ignores fake heads in comments, attributes, headers and script strings', () => {
    const document = injectCsp(
      '<div title="<head>"><!-- <head> fake --><header>Hi</header>' +
        '<script>var fake = "<head>";</script></div>',
      ARTIFACT_CSP
    );

    expect(document.startsWith('<!DOCTYPE html><html><head>')).toBe(true);
    expect(firstHeadContents(document).startsWith(CSP_META)).toBe(true);
    expect(document.indexOf(CSP_META)).toBeLessThan(document.indexOf('<script>'));
  });

  it('places the CSP before a script that appears before a real head', () => {
    const document = injectCsp(
      '<html><script>boom()</script><head><title>x</title></head></html>',
      ARTIFACT_CSP
    );

    expect(document.indexOf(CSP_META)).toBeLessThan(document.indexOf('<script>'));
    expect(firstHeadContents(document).startsWith(CSP_META)).toBe(true);
  });

  it('wraps fragments once, without duplicating a doctype', () => {
    const document = injectCsp('<!DOCTYPE html><p>Hi</p>', ARTIFACT_CSP);

    expect(document.match(/<!DOCTYPE html>/gi)).toHaveLength(1);
    expect(document).toContain('<body><p>Hi</p></body>');
    expect(firstHeadContents(document)).toContain('<meta charset="utf-8">');
    expect(firstHeadContents(document)).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1">'
    );
  });

  it('keeps HTML artifacts as written but adds safe document metadata', () => {
    const document = buildPreviewDocument(
      { type: 'html', content: '<main><p>Hi</p></main>' },
      theme
    );

    expect(document).toContain('<main><p>Hi</p></main>');
    expect(firstHeadContents(document).startsWith(CSP_META)).toBe(true);
    expect(firstHeadContents(document)).toContain('<meta charset="utf-8">');
  });

  it('renders non-HTML previews with scripts disabled and escaped content', () => {
    const document = buildPreviewDocument(
      { type: 'code', content: 'const x = 1 < 2;' },
      theme
    );

    expect(document).toContain("script-src 'none'");
    expect(document).not.toContain("script-src 'unsafe-inline'");
    expect(document).toContain('const x = 1 &lt; 2;');
    expect(document).toContain('#101010');
    expect(firstHeadContents(document).startsWith(NO_SCRIPT_CSP_META)).toBe(true);
  });

  it('exposes a content-free document-start error bridge for HTML only', () => {
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain("addEventListener('error'");
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain("addEventListener('unhandledrejection'");
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain("console[level] = function ()");
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain("ReactNativeWebView");
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain("source: 'orbit-artifact'");
    expect(ARTIFACT_ERROR_BRIDGE_JS).toContain('MAX_LENGTH = 500');
  });
});

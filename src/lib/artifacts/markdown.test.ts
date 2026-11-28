import { describe, expect, it } from 'vitest';

import { escapeHtml, markdownToHtml, sanitizeUrl } from './markdown';

describe('markdown artifact rendering', () => {
  it('escapes raw HTML before applying any markdown', () => {
    const html = markdownToHtml('# Hello <script>alert("x")</script>');

    expect(html).toContain('<h1>Hello &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</h1>');
    expect(html).not.toContain('<script>');
  });

  it('allows only http, https and mailto links', () => {
    expect(sanitizeUrl(' https://example.com ')).toBe('https://example.com');
    expect(sanitizeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com');
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('data:text/html,x')).toBeNull();

    const html = markdownToHtml('[safe](https://example.com) [unsafe](javascript:alert(1))');

    expect(html).toContain('<a href="https://example.com">safe</a>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('unsafe');
  });

  it('renders inline code before emphasis so markdown inside code stays literal', () => {
    const html = markdownToHtml('Use `**not bold**` and **bold** plus *italic*.');

    expect(html).toContain('<code>**not bold**</code>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders fenced code as escaped preformatted text', () => {
    const html = markdownToHtml('```js\nconst ok = 1 < 2;\n```');

    expect(html).toBe('<pre><code class="language-js">const ok = 1 &lt; 2;</code></pre>');
  });

  it('renders headings, rules, quotes, tables and flat lists', () => {
    const html = markdownToHtml(
      [
        '## Title',
        '',
        '---',
        '',
        '> quoted text',
        '',
        '| A | B |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '- first',
        '- second',
        '',
        '1. one',
        '2. two',
      ].join('\n')
    );

    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<blockquote>quoted text</blockquote>');
    expect(html).toContain('<table><thead><tr><th>A</th><th>B</th></tr></thead>');
    expect(html).toContain('<td>1</td><td>2</td>');
    expect(html).toContain('<ul><li>first</li><li>second</li></ul>');
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
  });

  it('exposes a complete escape set for preview builders', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

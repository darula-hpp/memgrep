import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatTelegramMessage,
  markdownToTelegramHtml,
} from '../format.js';

describe('escapeHtml', () => {
  it('escapes entities', () => {
    expect(escapeHtml('a <b> & c')).toBe('a &lt;b&gt; &amp; c');
  });
});

describe('markdownToTelegramHtml', () => {
  it('converts **bold** to <b>', () => {
    expect(markdownToTelegramHtml('Hello **world**')).toBe('Hello <b>world</b>');
  });

  it('converts *italic* to <i>', () => {
    expect(markdownToTelegramHtml('Hello *world*')).toBe('Hello <i>world</i>');
  });

  it('converts inline code', () => {
    expect(markdownToTelegramHtml('Use `ph_today` now')).toBe(
      'Use <code>ph_today</code> now',
    );
  });

  it('converts fenced code blocks', () => {
    expect(markdownToTelegramHtml('```\nconst x = 1\n```')).toBe(
      '<pre>const x = 1</pre>',
    );
  });

  it('converts links', () => {
    expect(markdownToTelegramHtml('[Product Hunt](https://www.producthunt.com)')).toBe(
      '<a href="https://www.producthunt.com">Product Hunt</a>',
    );
  });

  it('escapes raw HTML in plain text', () => {
    expect(markdownToTelegramHtml('a <script> b')).toBe('a &lt;script&gt; b');
  });
});

describe('formatTelegramMessage', () => {
  it('sets HTML parse mode when markup is present', () => {
    expect(formatTelegramMessage('**hi**')).toEqual({
      text: '<b>hi</b>',
      parseMode: 'HTML',
    });
  });

  it('omits parse mode for plain text', () => {
    expect(formatTelegramMessage('plain reply')).toEqual({ text: 'plain reply' });
  });
});

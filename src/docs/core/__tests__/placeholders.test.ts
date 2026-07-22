import { describe, expect, it } from 'vitest';
import {
  extractFieldNames,
  fillPlaceholdersInText,
  nestDottedKeys,
  processParagraphsXml,
} from '../placeholders.js';
import { escapeXml } from '../xml.js';

describe('extractFieldNames', () => {
  it('finds simple and dotted placeholders', () => {
    expect(extractFieldNames('Hello {{ name }} on {{ meeting.date }}')).toEqual([
      'name',
      'meeting.date',
    ]);
  });
});

describe('fillPlaceholdersInText', () => {
  it('resolves values and XML-escapes them', () => {
    const result = fillPlaceholdersInText('Hi {{ name }}', {
      name: 'A & B <C>',
    });
    expect(result).toBe(`Hi ${escapeXml('A & B <C>')}`);
  });

  it('supports dotted paths via nunjucks', () => {
    const result = fillPlaceholdersInText('Date: {{ meeting.date }}', {
      meeting: { date: '2026-07-21' },
    });
    expect(result).toBe('Date: 2026-07-21');
  });
});

describe('nestDottedKeys', () => {
  it('nests flat dotted keys', () => {
    expect(nestDottedKeys({ 'meeting.date': 'x', title: 'y' })).toEqual({
      meeting: { date: 'x' },
      title: 'y',
    });
  });
});

describe('processParagraphsXml', () => {
  it('extracts fields split across runs', () => {
    const xml = `
      <w:p>
        <w:r><w:t>{{</w:t></w:r>
        <w:r><w:t> chairperson </w:t></w:r>
        <w:r><w:t>}}</w:t></w:r>
      </w:p>`;
    const result = processParagraphsXml(xml, 'extract');
    expect(result.fields).toEqual(['chairperson']);
  });

  it('fills split-run placeholders into the first run', () => {
    const xml = `
      <w:p>
        <w:r><w:t>{{</w:t></w:r>
        <w:r><w:t> chairperson </w:t></w:r>
        <w:r><w:t>}}</w:t></w:r>
      </w:p>`;
    const result = processParagraphsXml(xml, 'fill', { chairperson: 'Thabo' });
    expect(result.xml).toMatch(/<w:t[^>]*>Thabo<\/w:t>/);
    expect((result.xml.match(/<w:t\b/g) || []).length).toBe(3);
  });
});

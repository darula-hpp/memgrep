import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractFields, fillDocument } from '../docx.js';
import { buildMinimalDocx, paragraphWithRuns } from '../fixture.js';
import { findSoleRichPlaceholder, markdownToOoxmlParagraphs } from '../rich.js';

describe('rich markdown', () => {
  it('detects sole rich placeholders', () => {
    expect(findSoleRichPlaceholder('{{ deliberations | rich }}')).toBe('deliberations');
    expect(findSoleRichPlaceholder('  {{ meeting.notes | rich }}  ')).toBe('meeting.notes');
    expect(findSoleRichPlaceholder('Hello {{ deliberations | rich }}')).toBeNull();
  });

  it('renders bold italic headings lists and indent', () => {
    const xml = markdownToOoxmlParagraphs(`## Review

This has **bold** and *italic*.

- Item one
  - Nested indent

> Quoted indent
`);
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).toMatch(/<w:i\/>/);
    expect(xml).toMatch(/Review/);
    expect(xml).toMatch(/Item one/);
    expect(xml).toMatch(/Nested indent/);
    expect(xml).toMatch(/Quoted indent/);
    expect(xml).toMatch(/w:ind/);
    expect((xml.match(/<w:p>/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('extracts richFields from a docx', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('Title: {{ title }}'),
        paragraphWithRuns('{{ deliberations | rich }}'),
      ].join('\n'),
    );
    const schema = await extractFields(docx);
    expect(schema.fields).toEqual(['title']);
    expect(schema.richFields).toEqual(['deliberations']);
  });

  it('fills rich placeholders as multiple formatted paragraphs', async () => {
    const docx = await buildMinimalDocx(paragraphWithRuns('{{ deliberations | rich }}'));
    const filled = await fillDocument(docx, {
      deliberations: '## Closed\n\n**DSTV** followed up.\n\n- One\n- Two',
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Closed/);
    expect(xml).toMatch(/DSTV/);
    expect(xml).toMatch(/<w:b\/>/);
    expect(xml).not.toMatch(/\| rich/);
    expect(xml).not.toMatch(/\{\{/);
  });
});

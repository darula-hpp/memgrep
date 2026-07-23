import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractFields, fillDocument } from '../docx.js';
import { buildMinimalDocx, paragraphWithRuns } from '../fixture.js';
import {
  findSoleRichPlaceholder,
  markdownToOoxmlParagraphs,
  splitRichSegments,
} from '../rich.js';

describe('rich markdown', () => {
  it('detects sole rich placeholders', () => {
    expect(findSoleRichPlaceholder('{{ deliberations | rich }}')).toBe('deliberations');
    expect(findSoleRichPlaceholder('  {{ meeting.notes | rich }}  ')).toBe('meeting.notes');
    expect(findSoleRichPlaceholder('Hello {{ deliberations | rich }}')).toBeNull();
  });

  it('splits mixed paragraphs into text and rich segments', () => {
    expect(splitRichSegments('TEST INFORMATION:{{ info | rich }}')).toEqual([
      { type: 'text', text: 'TEST INFORMATION:' },
      { type: 'rich', name: 'info' },
    ]);
    expect(splitRichSegments('{{ scope | rich }}Out of Scope:')).toEqual([
      { type: 'rich', name: 'scope' },
      { type: 'text', text: 'Out of Scope:' },
    ]);
    expect(splitRichSegments('{{ a | rich }} / {{ b | rich }}')).toEqual([
      { type: 'rich', name: 'a' },
      { type: 'text', text: ' / ' },
      { type: 'rich', name: 'b' },
    ]);
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
    expect(xml).toMatch(/w:ascii="Arial"/);
    expect(xml).toMatch(/w:val="24"/); // 12pt
    expect(xml).not.toMatch(/w:val="28"/);
    expect(xml).not.toMatch(/w:val="32"/);
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

  it('extracts richFields from mixed label paragraphs (not as scalars)', async () => {
    const docx = await buildMinimalDocx(
      paragraphWithRuns('TEST INFORMATION:{{ info | rich }}'),
    );
    const schema = await extractFields(docx);
    expect(schema.richFields).toEqual(['info']);
    expect(schema.fields).not.toContain('info');
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
    expect(xml).toMatch(/w:ascii="Arial"/);
    expect(xml).toMatch(/w:val="24"/);
    expect(xml).not.toMatch(/\| rich/);
    expect(xml).not.toMatch(/\{\{/);
  });

  it('fills rich with a prefix label in the same paragraph', async () => {
    const docx = await buildMinimalDocx(
      paragraphWithRuns('TEST INFORMATION:{{ info | rich }}'),
    );
    const filled = await fillDocument(docx, {
      info: '## Details\n\n**Ready**',
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/TEST INFORMATION:/);
    expect(xml).toMatch(/Details/);
    expect(xml).toMatch(/Ready/);
    expect(xml).not.toMatch(/\| rich/);
    expect(xml).not.toMatch(/\{\{/);
  });

  it('fills rich with a suffix label in the same paragraph', async () => {
    const docx = await buildMinimalDocx(
      paragraphWithRuns('{{ scope | rich }}Out of Scope:'),
    );
    const filled = await fillDocument(docx, {
      scope: '- In scope item',
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/In scope item/);
    expect(xml).toMatch(/Out of Scope:/);
    expect(xml).not.toMatch(/\| rich/);
  });

  it('fills rich when label and placeholder are split across runs', async () => {
    const docx = await buildMinimalDocx(
      paragraphWithRuns('TEST INFORMATION:', '{{ info | rich }}'),
    );
    const filled = await fillDocument(docx, {
      info: 'Coalesced works',
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/TEST INFORMATION:/);
    expect(xml).toMatch(/Coalesced works/);
    expect(xml).not.toMatch(/\| rich/);
  });

  it('fills two rich placeholders in one paragraph', async () => {
    const docx = await buildMinimalDocx(
      paragraphWithRuns('{{ a | rich }} / {{ b | rich }}'),
    );
    const filled = await fillDocument(docx, {
      a: 'Alpha',
      b: 'Beta',
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Alpha/);
    expect(xml).toMatch(/Beta/);
    expect(xml).toMatch(/ \/ /);
    expect(xml).not.toMatch(/\| rich/);
  });
});

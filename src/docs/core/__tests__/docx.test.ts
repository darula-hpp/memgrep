import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractFields, fillDocument } from '../docx.js';
import { buildMinimalDocx, paragraphWithRuns } from '../fixture.js';

describe('extractFields / fillDocument', () => {
  it('extracts unique fields from a docx', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('Meeting: ', '{{ title }}'),
        paragraphWithRuns('Chair: {{', ' chairperson ', '}}'),
        paragraphWithRuns('Date: {{ meeting.date }}'),
      ].join('\n'),
    );

    const { fields } = await extractFields(docx);
    expect(fields).toEqual(['chairperson', 'meeting.date', 'title']);
  });

  it('fills placeholders without dropping document parts', async () => {
    const docx = await buildMinimalDocx(
      [paragraphWithRuns('Title: {{ title }}'), paragraphWithRuns('{{', ' chairperson ', '}}')].join(
        '\n',
      ),
    );

    const filled = await fillDocument(docx, {
      title: 'Sprint Retro',
      chairperson: 'Olebogeng',
    });

    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Title: Sprint Retro/);
    expect(xml).toMatch(/Olebogeng/);
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('word/_rels/document.xml.rels')).toBeTruthy();
  });
});

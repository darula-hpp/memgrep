import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractFields, fillDocument } from '../docx.js';
import { buildMinimalDocx, paragraphWithRuns, table, tableRow } from '../fixture.js';

describe('table row loops', () => {
  it('extracts iterable schema from a for/endfor row', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('Title: {{ title }}'),
        table([
          tableRow(['Name', 'Role']),
          tableRow([
            '{% for item in attendees %}{{ item.name }}',
            '{{ item.role }}{% endfor %}',
          ]),
        ]),
      ].join('\n'),
    );

    const schema = await extractFields(docx);
    expect(schema.fields).toEqual(['title']);
    expect(schema.iterables).toEqual([
      { name: 'attendees', itemVar: 'item', kind: 'rows', fields: ['name', 'role'] },
    ]);
  });

  it('expands a single template row into multiple filled rows', async () => {
    const docx = await buildMinimalDocx(
      table([
        tableRow(['Name', 'Role']),
        tableRow([
          '{% for person in people %}{{ person.name }}',
          '{{ person.role }}{% endfor %}',
        ]),
      ]),
    );

    const filled = await fillDocument(docx, {
      people: [
        { name: 'Ada', role: 'Chair' },
        { name: 'Bob', role: 'Scribe' },
        { name: 'Cy', role: 'Member' },
      ],
    });

    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    const rowCount = (xml.match(/<w:tr\b/g) || []).length;
    expect(rowCount).toBe(4); // header + 3 data
    expect(xml).toMatch(/Ada/);
    expect(xml).toMatch(/Bob/);
    expect(xml).toMatch(/Cy/);
    expect(xml).not.toMatch(/\{%/);
    expect(xml).not.toMatch(/\{\{/);
  });

  it('removes the template row when the collection is empty', async () => {
    const docx = await buildMinimalDocx(
      table([
        tableRow(['Name']),
        tableRow(['{% for item in people %}{{ item.name }}{% endfor %}']),
      ]),
    );

    const filled = await fillDocument(docx, { people: [] });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:tr\b/g) || []).length).toBe(1);
    expect(xml).not.toMatch(/\{%/);
  });

  it('supports for and endfor on consecutive rows', async () => {
    const docx = await buildMinimalDocx(
      table([
        tableRow(['{% for item in tasks %}']),
        tableRow(['{{ item.title }}', '{{ item.owner }}']),
        tableRow(['{% endfor %}']),
      ]),
    );

    const schema = await extractFields(docx);
    expect(schema.iterables[0]).toMatchObject({
      name: 'tasks',
      itemVar: 'item',
      kind: 'rows',
      fields: ['owner', 'title'],
    });

    const filled = await fillDocument(docx, {
      tasks: [
        { title: 'Ship', owner: 'A' },
        { title: 'Test', owner: 'B' },
      ],
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    // Marker rows dropped; data row cloned twice
    expect((xml.match(/<w:tr\b/g) || []).length).toBe(2);
    expect(xml).toMatch(/Ship/);
    expect(xml).toMatch(/Test/);
    expect(xml).not.toMatch(/endfor/);
  });
});

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { extractFields, fillDocument } from '../docx.js';
import { buildMinimalDocx, paragraphWithRuns, table, tableRow } from '../fixture.js';

function testCaseTable(): string {
  return table([
    tableRow(['TEST CASE #{{ case.number }}']),
    tableRow(['{{ case.title }}']),
    tableRow(['Step', 'Input', 'Expected', 'Actual', 'Pass/Fail']),
    tableRow([
      '{% for p in case.steps %}{{ p.number }}',
      '{{ p.test_step_input }}',
      '{{ p.expected_results }}',
      '{{ p.actual_results }}',
      '{{ p.pass_fail }}{% endfor %}',
    ]),
  ]);
}

describe('block / table loops', () => {
  it('extracts nested block + row schema', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('Task: {{ task_id }}'),
        paragraphWithRuns('{% for case in test_cases %}'),
        testCaseTable(),
        paragraphWithRuns('{% endfor %}'),
      ].join('\n'),
    );

    const schema = await extractFields(docx);
    expect(schema.fields).toEqual(['task_id']);
    expect(schema.iterables).toEqual([
      {
        name: 'test_cases',
        itemVar: 'case',
        kind: 'block',
        fields: ['number', 'title'],
        iterables: [
          {
            name: 'steps',
            itemVar: 'p',
            kind: 'rows',
            fields: [
              'actual_results',
              'expected_results',
              'number',
              'pass_fail',
              'test_step_input',
            ],
          },
        ],
      },
    ]);
  });

  it('clones a whole table once per block item', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('{% for case in test_cases %}'),
        table([tableRow(['{{ case.title }}'])]),
        paragraphWithRuns('{% endfor %}'),
      ].join('\n'),
    );

    const filled = await fillDocument(docx, {
      test_cases: [{ title: 'Login' }, { title: 'Logout' }],
    });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:tbl\b/g) || []).length).toBe(2);
    expect(xml).toMatch(/Login/);
    expect(xml).toMatch(/Logout/);
    expect(xml).not.toMatch(/\{%/);
    expect(xml).not.toMatch(/\{\{/);
  });

  it('expands nested row loops inside each block clone', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('{% for case in test_cases %}'),
        testCaseTable(),
        paragraphWithRuns('{% endfor %}'),
      ].join('\n'),
    );

    const filled = await fillDocument(docx, {
      test_cases: [
        {
          number: '1',
          title: 'Login happy path',
          steps: [
            {
              number: '1',
              test_step_input: 'Open login',
              expected_results: 'Form shown',
              actual_results: 'Form shown',
              pass_fail: 'PASS',
            },
            {
              number: '2',
              test_step_input: 'Submit',
              expected_results: 'Home',
              actual_results: 'Home',
              pass_fail: 'PASS',
            },
          ],
        },
        {
          number: '2',
          title: 'Invalid password',
          steps: [
            {
              number: '1',
              test_step_input: 'Bad password',
              expected_results: 'Error',
              actual_results: 'Error',
              pass_fail: 'PASS',
            },
            {
              number: '2',
              test_step_input: 'Retry',
              expected_results: 'Form',
              actual_results: 'Form',
              pass_fail: 'FAIL',
            },
          ],
        },
      ],
    });

    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:tbl\b/g) || []).length).toBe(2);
    expect(xml).toMatch(/Login happy path/);
    expect(xml).toMatch(/Invalid password/);
    expect(xml).toMatch(/Open login/);
    expect(xml).toMatch(/Bad password/);
    expect(xml).toMatch(/TEST CASE #1/);
    expect(xml).toMatch(/TEST CASE #2/);
    // header + 2 step rows per table
    expect((xml.match(/<w:tr\b/g) || []).length).toBe(10);
    expect(xml).not.toMatch(/\{%/);
  });

  it('removes the template table when the block collection is empty', async () => {
    const docx = await buildMinimalDocx(
      [
        paragraphWithRuns('Intro'),
        paragraphWithRuns('{% for case in test_cases %}'),
        table([tableRow(['{{ case.title }}'])]),
        paragraphWithRuns('{% endfor %}'),
        paragraphWithRuns('Outro'),
      ].join('\n'),
    );

    const filled = await fillDocument(docx, { test_cases: [] });
    const zip = await JSZip.loadAsync(filled);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toMatch(/Intro/);
    expect(xml).toMatch(/Outro/);
    expect(xml).not.toMatch(/<w:tbl\b/);
    expect(xml).not.toMatch(/\{%/);
    expect(xml).not.toMatch(/case\.title/);
  });
});

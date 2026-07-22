import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildMinimalDocx, paragraphWithRuns } from '../core/fixture.js';
import { DocsService } from '../service.js';

describe('DocsService', () => {
  it('fills a template into .memgrep/docs with context sidecar', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'memgrep-docs-'));
    const service = new DocsService(cwd);
    service.setup();

    const docx = await buildMinimalDocx(
      [paragraphWithRuns('Title: {{ title }}'), paragraphWithRuns('Chair: {{ chairperson }}')].join(
        '\n',
      ),
    );
    writeFileSync(path.join(service.templatesDir, 'minutes.docx'), docx);

    const filled = await service.fill({
      template: 'minutes.docx',
      context: { title: 'Retro', chairperson: 'Olebogeng' },
      name: 'sprint-retro',
    });

    expect(filled.name).toBe('sprint-retro');
    expect(filled.docxPath).toContain(path.join('.memgrep', 'docs', 'sprint-retro.docx'));
    expect(service.listDocs().map((d) => d.name)).toEqual(['sprint-retro']);

    const again = await service.saveDoc('sprint-retro', {
      title: 'Retro 2',
      chairperson: 'Thabo',
    });
    expect(again.name).toBe('sprint-retro');

    const doc = await service.getDoc('sprint-retro');
    expect(doc.meta.context).toEqual({ title: 'Retro 2', chairperson: 'Thabo' });
    expect(doc.meta.template).toBe('minutes.docx');
  });
});

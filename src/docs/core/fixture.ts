import JSZip from 'jszip';

/** Build a minimal valid .docx containing the given document body XML fragment. */
export async function buildMinimalDocx(bodyInnerXml: string): Promise<Buffer> {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
${bodyInnerXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels')!.file('.rels', rels);
  zip.folder('word')!.file('document.xml', documentXml);
  zip.folder('word')!.folder('_rels')!.file('document.xml.rels', documentRels);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(buffer);
}

export function paragraphWithRuns(...texts: string[]): string {
  const runs = texts
    .map((text) => {
      const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
      return `      <w:r><w:t${space}>${text}</w:t></w:r>`;
    })
    .join('\n');
  return `    <w:p>\n${runs}\n    </w:p>`;
}

/** Minimal table row with one cell per text run group. */
export function tableRow(cells: string[]): string {
  const cellXml = cells
    .map(
      (text) => `      <w:tc>
        <w:p>
          <w:r><w:t>${text}</w:t></w:r>
        </w:p>
      </w:tc>`,
    )
    .join('\n');
  return `    <w:tr>\n${cellXml}\n    </w:tr>`;
}

export function table(rows: string[]): string {
  return `    <w:tbl>\n${rows.join('\n')}\n    </w:tbl>`;
}

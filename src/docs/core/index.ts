export { extractFields, fillDocument } from './docx.js';
export type { ExtractResult, IterableSchema } from './docx.js';
export {
  extractFieldNames,
  fillPlaceholdersInText,
  nestDottedKeys,
  resolvePlaceholder,
} from './placeholders.js';
export { escapeXml } from './xml.js';
export { buildMinimalDocx, paragraphWithRuns, table, tableRow } from './fixture.js';
export {
  extractLoopSchema,
  processBlockLoops,
  processTableLoops,
} from './loops.js';
export {
  extractRichFieldNames,
  findSoleRichPlaceholder,
  markdownToOoxmlParagraphs,
  splitRichSegments,
} from './rich.js';
export type { RichSegment } from './rich.js';

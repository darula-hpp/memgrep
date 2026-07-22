export { extractFields, fillDocument } from './docx.js';
export type { ExtractResult } from './docx.js';
export {
  extractFieldNames,
  fillPlaceholdersInText,
  nestDottedKeys,
  resolvePlaceholder,
} from './placeholders.js';
export { escapeXml } from './xml.js';
export { buildMinimalDocx, paragraphWithRuns } from './fixture.js';

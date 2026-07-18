import fs from 'node:fs';
import { notFound } from 'next/navigation';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import rehypeStringify from 'rehype-stringify';
import { extractToc, type TocEntry } from './toc';

export type { TocEntry };

export interface ParsedPage {
  title: string;
  description?: string;
  contentHtml: string;
  headings: TocEntry[];
}

function extractFirstH1(html: string): string {
  const match = /<h1[^>]*>(.*?)<\/h1>/i.exec(html);
  if (!match) return '';
  return match[1].replace(/<[^>]+>/g, '').trim();
}

export async function parseMarkdownContent(content: string): Promise<ParsedPage> {
  try {
    const { data: frontmatter, content: markdownBody } = matter(content);
    const result = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rehypeHighlight)
      .use(rehypeStringify)
      .process(markdownBody);

    const contentHtml = String(result);
    const title =
      typeof frontmatter.title === 'string' && frontmatter.title.length > 0
        ? frontmatter.title
        : extractFirstH1(contentHtml) || '';
    const description =
      typeof frontmatter.description === 'string' ? frontmatter.description : undefined;

    return {
      title,
      description,
      contentHtml,
      headings: extractToc(contentHtml),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      title: '',
      contentHtml: `<p>Error rendering content: ${message}</p>`,
      headings: [],
    };
  }
}

export async function parseMarkdownFile(filePath: string): Promise<ParsedPage> {
  if (!fs.existsSync(filePath)) notFound();
  return parseMarkdownContent(fs.readFileSync(filePath, 'utf-8'));
}

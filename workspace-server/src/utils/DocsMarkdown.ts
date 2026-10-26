/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { docs_v1 } from 'googleapis';

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_\[\]~|#]/g, '\\$&');
}

function linkDestination(url: string | null | undefined): string | undefined {
  if (!url || !/^(https?:\/\/|mailto:|#)/i.test(url)) return undefined;
  return url.replace(
    /[\s<>()[\]\\"]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function renderRun(text: string, style: docs_v1.Schema$TextStyle): string {
  // Keep whitespace outside delimiters so Markdown emphasis is valid.
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  if (!match[2]) return text;
  let result = escapeText(match[2]);
  if (style.bold) result = `**${result}**`;
  if (style.italic) result = `*${result}*`;
  if (style.strikethrough) result = `~~${result}~~`;
  if (style.underline) result = `<u>${result}</u>`;
  const url = linkDestination(style.link?.url);
  if (url) result = `[${result}](${url})`;
  return match[1] + result + match[3];
}

function renderParagraph(paragraph: docs_v1.Schema$Paragraph): string {
  let result = '';
  let pendingText = '';
  let pendingStyle: docs_v1.Schema$TextStyle = {};
  const flush = () => {
    result += renderRun(pendingText, pendingStyle);
    pendingText = '';
  };
  for (const element of paragraph.elements || []) {
    if (element.textRun) {
      const source = element.textRun.textStyle;
      const style: docs_v1.Schema$TextStyle = {
        bold: source?.bold || false,
        italic: source?.italic || false,
        strikethrough: source?.strikethrough || false,
        underline: source?.underline || false,
        link: { url: source?.link?.url },
      };
      // Google may split equally formatted text into multiple runs.
      if (JSON.stringify(style) !== JSON.stringify(pendingStyle)) flush();
      pendingStyle = style;
      pendingText += element.textRun.content || '';
    } else {
      flush();
      if (element.person?.personProperties) {
        const { name, email } = element.person.personProperties;
        result += renderRun(name || email || '', {
          link: { url: email ? `mailto:${email}` : undefined },
        });
      } else if (element.richLink?.richLinkProperties) {
        const { title, uri } = element.richLink.richLinkProperties;
        result += renderRun(title || uri || '', { link: { url: uri } });
      } else if (element.dateElement?.dateElementProperties) {
        result += escapeText(
          element.dateElement.dateElementProperties.displayText || '',
        );
      } else if (element.inlineObjectElement) {
        const id = element.inlineObjectElement.inlineObjectId;
        result += id ? `[Image: ${escapeText(id)}]` : '[Image]';
      }
    }
  }
  flush();
  for (const id of paragraph.positionedObjectIds || []) {
    result += ` [Image: ${escapeText(id)}]`;
  }
  result = result.replace(/\n+$/, '');
  const heading =
    paragraph.paragraphStyle?.namedStyleType?.match(/^HEADING_([1-6])$/);
  if (heading) result = `${'#'.repeat(Number(heading[1]))} ${result}`;
  if (paragraph.bullet) {
    result = `${'  '.repeat(paragraph.bullet.nestingLevel || 0)}- ${result}`;
  }
  return result;
}

function renderTable(table: docs_v1.Schema$Table): string {
  const rows = (table.tableRows || []).map((row) =>
    (row.tableCells || []).map((cell) =>
      renderDocsMarkdown(cell.content || []).replace(/\n/g, '<br>'),
    ),
  );
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) return '';
  const lines = rows.map(
    (row) =>
      `| ${Array.from({ length: width }, (_, i) => row[i] || '').join(' | ')} |`,
  );
  // GFM requires a header row; the first Docs row is used as the header.
  lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
  return lines.join('\n');
}

/** Best-effort Markdown for document body content, not a visual layout export. */
export function renderDocsMarkdown(
  elements: docs_v1.Schema$StructuralElement[],
): string {
  return elements
    .map((element) => {
      if (element.paragraph) return renderParagraph(element.paragraph);
      if (element.table) return renderTable(element.table);
      if (element.tableOfContents)
        return renderDocsMarkdown(element.tableOfContents.content || []);
      return '';
    })
    .join('\n\n')
    .replace(/\n+$/, '');
}

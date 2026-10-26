/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { google } from 'googleapis';
import { AuthManager } from '../../auth/AuthManager';
import { DocsService } from '../../services/DocsService';

jest.mock('googleapis');
jest.mock('../../utils/logger');

describe('docs.getText (format: markdown)', () => {
  const get = jest.fn<(...args: any[]) => Promise<any>>();
  const batchUpdate = jest.fn();
  let service: DocsService;
  const readMarkdown = (args: Parameters<DocsService['getText']>[0]) =>
    service.getText({ ...args, format: 'markdown' });
  const paragraph = (content: string, textStyle = {}, paragraphStyle = {}) => ({
    paragraph: {
      paragraphStyle,
      elements: [{ textRun: { content, textStyle } }],
    },
  });
  const tab = (tabId: string, content: any[] = []) => ({
    tabProperties: { tabId, title: tabId },
    documentTab: { body: { content } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (google.docs as jest.Mock).mockReturnValue({
      documents: { get, batchUpdate },
    });
    service = new DocsService({
      getAuthenticatedClient: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue({}),
    } as unknown as AuthManager);
  });

  it.each([[[]], [['main']], [['main', 'second']]])(
    'keeps default and explicit text output identical for tabs %j',
    async (ids: string[]) => {
      get.mockResolvedValue({
        data: {
          title: 'Review',
          tabs: ids.map((id) =>
            tab(id, [paragraph('old\n', { strikethrough: true })]),
          ),
        },
      });
      const implicit = await service.getText({ documentId: 'test-doc-id' });
      const explicit = await service.getText({
        documentId: 'test-doc-id',
        format: 'text',
      });
      expect(explicit).toEqual(implicit);
      expect(explicit.content[0].text).not.toContain('~~');
      expect(get).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps explicit text tab selection compatible with the original reader', async () => {
    get.mockResolvedValue({
      data: {
        title: 'Review',
        tabs: [
          tab('main', [paragraph('first\n')]),
          tab('second', [paragraph('old\n', { strikethrough: true })]),
        ],
      },
    });
    const result = await service.getText({
      documentId: 'test-doc-id',
      tabId: 'second',
      format: 'text',
    });
    expect(result.content[0].text).toBe('Document Title: Review\n\nold\n');
  });

  it('preserves inline styles, headings and links using only documents.get', async () => {
    get.mockResolvedValue({
      data: {
        title: 'Review',
        tabs: [
          tab('main', [
            paragraph('Heading\n', {}, { namedStyleType: 'HEADING_2' }),
            paragraph('old\n', { strikethrough: true }),
            paragraph('strong\n', { bold: true }),
            paragraph('emphasis\n', { italic: true }),
            paragraph('underlined\n', { underline: true }),
            paragraph('reference\n', {
              link: { url: 'https://example.com/a(b)' },
            }),
          ]),
        ],
      },
    });

    const result = await readMarkdown({ documentId: 'test-doc-id' });
    const data = JSON.parse(result.content[0].text);
    expect(data.title).toBe('Review');
    expect(data.tabs[0].markdown).toBe(
      '## Heading\n\n~~old~~\n\n**strong**\n\n*emphasis*\n\n<u>underlined</u>\n\n[reference](https://example.com/a%28b%29)',
    );
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'test-doc-id',
        includeTabsContent: true,
        suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
      }),
    );
    expect(get.mock.calls[0][0].fields).toContain('childTabs');
    expect(get.mock.calls[0][0].fields).not.toContain('suggested');
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('combines adjacent runs with identical styles and escapes literal Markdown', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          tab('main', [
            {
              paragraph: {
                elements: [
                  { textRun: { content: ' bold ', textStyle: { bold: true } } },
                  { textRun: { content: 'text', textStyle: { bold: true } } },
                  { textRun: { content: ' *literal* <tag>\n' } },
                ],
              },
            },
          ]),
        ],
      },
    });
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(JSON.parse(result.content[0].text).tabs[0].markdown).toBe(
      ' **bold text** \\*literal\\* &lt;tag&gt;',
    );
  });

  it('preserves table rows and cells, escaping pipes and cell line breaks', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          tab('main', [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [paragraph('Name\n')] },
                      { content: [paragraph('State\n')] },
                    ],
                  },
                  {
                    tableCells: [
                      { content: [paragraph('A|B\n')] },
                      {
                        content: [
                          paragraph('old\n', { strikethrough: true }),
                          paragraph('new\n'),
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ]),
        ],
      },
    });
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(JSON.parse(result.content[0].text).tabs[0].markdown).toBe(
      '| Name | State |\n| --- | --- |\n| A\\|B | ~~old~~<br><br>new |',
    );
  });

  it('includes nested tabs and supports selecting a child by ID and document URL', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          {
            ...tab('parent'),
            childTabs: [tab('child', [paragraph('child text\n')])],
          },
        ],
      },
    });
    const all = await readMarkdown({ documentId: 'test-doc-id' });
    expect(
      JSON.parse(all.content[0].text).tabs.map((t: any) => t.tabId),
    ).toEqual(['parent', 'child']);
    const selected = await readMarkdown({
      documentId: 'https://docs.google.com/document/d/test-doc-id/edit',
      tabId: 'child',
    });
    expect(JSON.parse(selected.content[0].text).tabs).toEqual([
      { tabId: 'child', title: 'child', markdown: 'child text', images: [] },
    ]);
    expect(get).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentId: 'test-doc-id' }),
    );
  });

  it('returns empty content for empty tabs and documents', async () => {
    get.mockResolvedValue({ data: { tabs: [tab('empty')] } });
    expect(
      JSON.parse(
        (await readMarkdown({ documentId: 'test-doc-id' })).content[0].text,
      ).tabs[0].markdown,
    ).toBe('');
    get.mockResolvedValue({ data: {} });
    expect(
      JSON.parse(
        (await readMarkdown({ documentId: 'test-doc-id' })).content[0].text,
      ).tabs,
    ).toEqual([]);
  });

  it('preserves combined formatting and merges runs differing only in unsupported styles', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          tab('main', [
            {
              paragraph: {
                elements: [
                  {
                    textRun: {
                      content: 'old ',
                      textStyle: {
                        bold: true,
                        italic: true,
                        strikethrough: true,
                        foregroundColor: { color: { rgbColor: { red: 1 } } },
                      },
                    },
                  },
                  {
                    textRun: {
                      content: 'value\n',
                      textStyle: {
                        italic: true,
                        bold: true,
                        strikethrough: true,
                      },
                    },
                  },
                ],
              },
            },
          ]),
        ],
      },
    });
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(JSON.parse(result.content[0].text).tabs[0].markdown).toBe(
      '~~***old value***~~',
    );
  });

  it('keeps unsafe links as plain text and escapes raw HTML', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          tab('main', [
            paragraph('<script>unsafe</script>\n', {
              link: { url: 'javascript:alert(1)' },
            }),
          ]),
        ],
      },
    });
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(JSON.parse(result.content[0].text).tabs[0].markdown).toBe(
      '&lt;script&gt;unsafe&lt;/script&gt;',
    );
  });

  it('renders nested bullets, smart chips, dates, and image placeholders', async () => {
    get.mockResolvedValue({
      data: {
        tabs: [
          tab('main', [
            {
              paragraph: {
                bullet: { nestingLevel: 1 },
                elements: [
                  {
                    person: {
                      personProperties: {
                        name: 'Alice',
                        email: 'alice@example.com',
                      },
                    },
                  },
                  { textRun: { content: ' ' } },
                  {
                    richLink: {
                      richLinkProperties: {
                        title: 'Doc',
                        uri: 'https://example.com',
                      },
                    },
                  },
                  { textRun: { content: ' ' } },
                  {
                    dateElement: {
                      dateElementProperties: { displayText: 'Oct 24' },
                    },
                  },
                  { textRun: { content: ' ' } },
                  { inlineObjectElement: { inlineObjectId: 'image' } },
                ],
              },
            },
          ]),
        ],
      },
    });
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(JSON.parse(result.content[0].text).tabs[0].markdown).toBe(
      '  - [Alice](mailto:alice@example.com) [Doc](https://example.com) Oct 24 [Image: image]',
    );
  });

  it('returns an MCP error for a missing tab', async () => {
    get.mockResolvedValue({ data: { tabs: [tab('main')] } });
    const result = await readMarkdown({
      documentId: 'test-doc-id',
      tabId: 'missing',
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain('missing');
  });

  it('validates document IDs before calling Google', async () => {
    const result = await readMarkdown({ documentId: 'bad id!' });
    expect(result.isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns an MCP error on API failure', async () => {
    get.mockRejectedValue(new Error('Permission denied'));
    const result = await readMarkdown({ documentId: 'test-doc-id' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({
      error: 'Permission denied',
    });
  });
});

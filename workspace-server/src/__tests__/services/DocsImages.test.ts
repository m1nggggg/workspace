/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { google } from 'googleapis';
import { AuthManager } from '../../auth/AuthManager';
import { DocsService } from '../../services/DocsService';
import { downloadDocImage } from '../../utils/DocsImages';

jest.mock('googleapis');
jest.mock('../../utils/logger');
jest.mock('../../utils/DocsImages', () => ({
  ...jest.requireActual<typeof import('../../utils/DocsImages')>(
    '../../utils/DocsImages',
  ),
  downloadDocImage: jest.fn(),
}));

describe('docs.getImages', () => {
  const get = jest.fn<(...args: any[]) => Promise<any>>();
  const download = jest.mocked(downloadDocImage);
  let service: DocsService;
  const imageObject = (id: string) => ({
    embeddedObject: {
      title: id,
      description: 'Screenshot',
      imageProperties: {
        contentUri: `https://lh3.googleusercontent.com/${id}?secret=token`,
      },
    },
  });
  const tab = (
    id: string,
    inlineIds: string[],
    positionedIds: string[] = [],
  ): any => ({
    tabProperties: { tabId: id, title: id },
    documentTab: {
      body: { content: [] },
      inlineObjects: Object.fromEntries(
        inlineIds.map((id) => [
          id,
          { inlineObjectProperties: imageObject(id) },
        ]),
      ),
      positionedObjects: Object.fromEntries(
        positionedIds.map((id) => [
          id,
          { positionedObjectProperties: imageObject(id) },
        ]),
      ),
    },
  });
  const summary = (result: Awaited<ReturnType<DocsService['getImages']>>) =>
    JSON.parse((result.content[0] as { text: string }).text);

  beforeEach(() => {
    jest.clearAllMocks();
    (google.docs as jest.Mock).mockReturnValue({ documents: { get } });
    service = new DocsService({
      getAuthenticatedClient: jest
        .fn<() => Promise<any>>()
        .mockResolvedValue({}),
    } as unknown as AuthManager);
    download.mockResolvedValue({
      bytes: Buffer.from('image'),
      mimeType: 'image/png',
    });
    get.mockResolvedValue({
      data: { title: 'Doc', tabs: [tab('main', ['inline'], ['floating'])] },
    });
  });

  it('returns labeled MCP image content without temporary URLs', async () => {
    const result = await service.getImages({ documentId: 'test-doc-id' });
    expect(summary(result).images).toEqual([
      expect.objectContaining({
        imageId: 'inline',
        kind: 'inline',
        status: 'loaded',
        tabId: 'main',
      }),
      expect.objectContaining({
        imageId: 'floating',
        kind: 'positioned',
        status: 'loaded',
      }),
    ]);
    expect(result.content[2]).toEqual({
      type: 'image',
      mimeType: 'image/png',
      data: Buffer.from('image').toString('base64'),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret|contentUri|googleusercontent/,
    );
    expect(get).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTabsContent: true,
        suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
      }),
    );
  });

  it('selects floating images from nested tabs', async () => {
    const root = tab('main', ['inline']);
    root.childTabs = [tab('nested', [], ['floating'])];
    get.mockResolvedValue({ data: { tabs: [root] } });
    const result = await service.getImages({
      documentId: 'test-doc-id',
      tabId: 'nested',
      imageIds: ['floating'],
    });
    expect(summary(result).images).toHaveLength(1);
    expect(summary(result).images[0].tabId).toBe('nested');
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('limits default loads to five and reports remaining images', async () => {
    get.mockResolvedValue({
      data: { tabs: [tab('main', ['1', '2', '3', '4', '5', '6'])] },
    });
    const result = await service.getImages({ documentId: 'test-doc-id' });
    expect(download).toHaveBeenCalledTimes(5);
    expect(summary(result).remaining).toBe(1);
  });

  it('enforces the aggregate byte budget', async () => {
    download.mockResolvedValue({
      bytes: Buffer.alloc(5 * 1024 * 1024),
      mimeType: 'image/png',
    });
    get.mockResolvedValue({ data: { tabs: [tab('main', ['1', '2', '3'])] } });
    const result = await service.getImages({ documentId: 'test-doc-id' });
    expect(download).toHaveBeenCalledTimes(2);
    expect(summary(result).images[2].status).toBe('error');
  });

  it('reports missing IDs and partial failures without leaking network errors', async () => {
    download.mockRejectedValueOnce(
      new Error('https://secret-url?token=private'),
    );
    const result = await service.getImages({
      documentId: 'test-doc-id',
      imageIds: ['inline', 'floating', 'missing'],
    });
    expect(summary(result).images.map((image: any) => image.status)).toEqual([
      'error',
      'loaded',
      'error',
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret-url|private/);
    expect(result).not.toHaveProperty('isError');
  });

  it('returns an error if every requested image is unavailable', async () => {
    const result = await service.getImages({
      documentId: 'test-doc-id',
      imageIds: ['missing'],
    });
    expect(result.isError).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it('handles empty documents', async () => {
    get.mockResolvedValue({ data: { tabs: [] } });
    const result = await service.getImages({ documentId: 'test-doc-id' });
    expect(summary(result).images).toEqual([]);
    expect(result).not.toHaveProperty('isError');
  });

  it('rejects unknown tabs and excessive selections', async () => {
    expect(
      (await service.getImages({ documentId: 'test-doc-id', tabId: 'missing' }))
        .isError,
    ).toBe(true);
    expect(
      (
        await service.getImages({
          documentId: 'test-doc-id',
          imageIds: ['1', '2', '3', '4', '5', '6'],
        })
      ).isError,
    ).toBe(true);
    expect(download).not.toHaveBeenCalled();
  });

  it('handles Google API errors without exposing sensitive details', async () => {
    get.mockRejectedValueOnce(new Error('sensitive request details'));
    const result = await service.getImages({ documentId: 'test-doc-id' });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });

  it('exposes discoverable image metadata in Markdown without downloading', async () => {
    const result = await service.getText({
      documentId: 'test-doc-id',
      format: 'markdown',
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.tabs[0].images).toEqual([
      expect.objectContaining({ imageId: 'inline' }),
      expect.objectContaining({ imageId: 'floating' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('contentUri');
    expect(download).not.toHaveBeenCalled();
  });

  it('requests complete image maps in both readers (nested map selectors cause Google HTTP 400)', async () => {
    await service.getText({ documentId: 'test-doc-id', format: 'markdown' });
    await service.getImages({ documentId: 'test-doc-id' });
    const imageTab =
      'tabProperties,documentTab(inlineObjects,positionedObjects)';
    const markdownTab =
      'tabProperties,documentTab(body,inlineObjects,positionedObjects)';
    expect(get.mock.calls[0][0].fields).toBe(
      `title,tabs(${markdownTab},childTabs(${markdownTab},childTabs(${markdownTab})))`,
    );
    expect(get.mock.calls[1][0].fields).toBe(
      `title,tabs(${imageTab},childTabs(${imageTab},childTabs(${imageTab})))`,
    );
  });
});

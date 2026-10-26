/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { Readable } from 'node:stream';
import { request } from 'gaxios';
import { downloadDocImage } from '../../utils/DocsImages';
import { renderDocsMarkdown } from '../../utils/DocsMarkdown';

jest.mock('gaxios');

describe('Docs image downloads', () => {
  const uri = 'https://lh3.googleusercontent.com/image?secret=token';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const mockRequest = request as jest.Mock;
  let stream: Readable;
  const respond = (bytes: Buffer, mimeType = 'image/png', length?: number) => {
    stream = Readable.from([bytes]);
    mockRequest.mockResolvedValue({
      data: stream,
      headers: new Headers({
        'content-type': mimeType,
        ...(length === undefined ? {} : { 'content-length': String(length) }),
      }),
    } as never);
  };

  beforeEach(() => jest.clearAllMocks());

  it('downloads bounded image bytes and disables redirects and retry logs', async () => {
    respond(png);
    expect(await downloadDocImage(uri, 100)).toEqual({
      bytes: png,
      mimeType: 'image/png',
    });
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: 'stream',
        maxRedirects: 0,
        retry: false,
        timeout: 15000,
      }),
    );
    expect(stream.destroyed).toBe(true);
  });

  it.each([
    'http://lh3.googleusercontent.com/image',
    'https://localhost/image',
    'https://lh3.googleusercontent.com.evil.test/image',
    'https://user:pass@lh3.googleusercontent.com/image',
    'https://lh3.googleusercontent.com:8443/image',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(downloadDocImage(url, 100)).rejects.toThrow(
      'Unsupported image URL',
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects declared oversized downloads before consuming the stream', async () => {
    respond(png, 'image/png', 1000);
    await expect(downloadDocImage(uri, 100)).rejects.toThrow('size limit');
    expect(stream.destroyed).toBe(true);
  });

  it('enforces size limits when content-length is absent', async () => {
    respond(png);
    await expect(downloadDocImage(uri, 4)).rejects.toThrow('size limit');
    expect(stream.destroyed).toBe(true);
  });

  it('rejects unsupported MIME types and destroys the stream', async () => {
    respond(Buffer.from('<svg/>'), 'image/svg+xml');
    await expect(downloadDocImage(uri, 100)).rejects.toThrow('MIME');
    expect(stream.destroyed).toBe(true);
  });

  it('rejects content that does not match its MIME type', async () => {
    respond(Buffer.from('<html>not an image</html>'));
    await expect(downloadDocImage(uri, 100)).rejects.toThrow('does not match');
  });

  it('follows Docs redirects only after validating each destination', async () => {
    respond(png);
    const redirectStream = Readable.from([]);
    mockRequest.mockResolvedValueOnce({
      status: 302,
      data: redirectStream,
      headers: new Headers({ location: uri }),
    } as never);
    await expect(
      downloadDocImage('https://docs.google.com/image', 100),
    ).resolves.toEqual({ bytes: png, mimeType: 'image/png' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(redirectStream.destroyed).toBe(true);
    expect(mockRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: uri,
        redirect: 'manual',
        maxRedirects: 0,
      }),
    );
  });

  it('rejects redirect destinations outside Google without fetching them', async () => {
    const redirectStream = Readable.from([]);
    mockRequest.mockResolvedValueOnce({
      status: 302,
      data: redirectStream,
      headers: new Headers({ location: 'http://127.0.0.1/private' }),
    } as never);
    await expect(downloadDocImage(uri, 100)).rejects.toThrow(
      'Unsupported image URL',
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(redirectStream.destroyed).toBe(true);
  });

  it('bounds redirect chains and closes every response stream', async () => {
    const streams: Readable[] = [];
    mockRequest.mockImplementation(async () => {
      const data = Readable.from([]);
      streams.push(data);
      return { status: 302, data, headers: new Headers({ location: uri }) };
    });
    await expect(downloadDocImage(uri, 100)).rejects.toThrow(
      'Too many image redirects',
    );
    expect(mockRequest).toHaveBeenCalledTimes(4);
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
    mockRequest.mockReset();
  });

  it('preserves inline positions and floating image anchors in Markdown', () => {
    expect(
      renderDocsMarkdown([
        {
          paragraph: {
            positionedObjectIds: ['floating'],
            elements: [
              { textRun: { content: 'See ' } },
              { inlineObjectElement: { inlineObjectId: 'inline' } },
            ],
          },
        },
      ]),
    ).toBe('See [Image: inline] [Image: floating]');
  });
});

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { docs_v1 } from 'googleapis';
import { request } from 'gaxios';

export const MAX_DOC_IMAGES = 5;
export const MAX_DOC_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOC_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;

export interface DocImage {
  imageId: string;
  tabId?: string | null;
  kind: 'inline' | 'positioned';
  title?: string | null;
  description?: string | null;
  contentUri?: string | null;
}

/** Keep signed image URLs internal; callers must not serialize this directly. */
export function collectDocImages(tab: docs_v1.Schema$Tab): DocImage[] {
  const images: DocImage[] = [];
  const add = (
    imageId: string,
    kind: DocImage['kind'],
    object: docs_v1.Schema$EmbeddedObject | null | undefined,
  ) => {
    if (!object?.imageProperties) return;
    images.push({
      imageId,
      tabId: tab.tabProperties?.tabId,
      kind,
      title: object.title,
      description: object.description,
      contentUri: object.imageProperties.contentUri,
    });
  };
  for (const [id, object] of Object.entries(
    tab.documentTab?.inlineObjects || {},
  )) {
    add(id, 'inline', object.inlineObjectProperties?.embeddedObject);
  }
  for (const [id, object] of Object.entries(
    tab.documentTab?.positionedObjects || {},
  )) {
    add(id, 'positioned', object.positionedObjectProperties?.embeddedObject);
  }
  return images;
}

export function docImageMetadata({ contentUri: _uri, ...metadata }: DocImage) {
  return metadata;
}

/** Download only Google-hosted image content, without logging bearer URLs. */
function validateImageUrl(url: URL) {
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !(
      url.hostname.endsWith('.googleusercontent.com') ||
      url.hostname === 'docs.google.com'
    )
  ) {
    throw new Error('Unsupported image URL.');
  }
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

async function requestImage(uri: string) {
  let url = new URL(uri);
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    validateImageUrl(url);
    // Docs URLs redirect to Google image hosts. Follow manually so every hop
    // is checked, without forwarding credentials or logging signed URLs.
    const response = await request<NodeJS.ReadableStream>({
      url: url.href,
      responseType: 'stream',
      timeout: 15000,
      signal,
      retry: false,
      redirect: 'manual',
      maxRedirects: 0,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || REDIRECT_STATUSES.includes(status),
    });
    if (!REDIRECT_STATUSES.includes(response.status)) return response;
    (response.data as import('node:stream').Readable).destroy();
    const location = response.headers.get('location');
    if (!location) throw new Error('Image redirect has no location.');
    url = new URL(location, url);
  }
  throw new Error('Too many image redirects.');
}

export async function downloadDocImage(uri: string, maxBytes: number) {
  const response = await requestImage(uri);
  const stream = response.data as import('node:stream').Readable;
  try {
    const mimeType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mimeType)
    ) {
      throw new Error('Unsupported image MIME type.');
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new Error('Image exceeds the download size limit.');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes)
        throw new Error('Image exceeds the download size limit.');
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    const valid =
      (mimeType === 'image/png' &&
        bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
      (mimeType === 'image/jpeg' &&
        bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
      (mimeType === 'image/gif' &&
        /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) ||
      (mimeType === 'image/webp' &&
        bytes.subarray(0, 4).toString() === 'RIFF' &&
        bytes.subarray(8, 12).toString() === 'WEBP');
    if (!valid) throw new Error('Image content does not match its MIME type.');
    return { bytes, mimeType };
  } finally {
    stream.destroy();
  }
}

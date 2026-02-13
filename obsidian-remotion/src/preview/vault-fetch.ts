import { TFile, MarkdownView, normalizePath } from "obsidian";
import path from "path";

export type FileResolver = (
  filePath: string,
) =>
  | { kind: "vault"; file: TFile; size: number; mimeType?: string }
  | { kind: "url"; url: string };

interface FetchConstructors {
  Response: typeof Response;
  Headers: typeof Headers;
  Request: typeof Request;
  URL: typeof URL;
}

export function shimWindow(
  iframeWindow: Window,
  resolver: FileResolver,
  readPath: (file: TFile) => Promise<ArrayBuffer>,
): void {
  const originalFetch = iframeWindow.fetch.bind(iframeWindow);
  const fetchShim = createFetchShim({
    originalFetch,
    resolver,
    readPath,
    constructors: iframeWindow as any,
  });
  if (fetchShim) {
    iframeWindow.fetch = fetchShim;
  }
}

function createFetchShim({
  originalFetch,
  resolver,
  readPath,
  constructors,
}: {
  originalFetch: typeof fetch;
  resolver: FileResolver;
  readPath: (file: TFile) => Promise<ArrayBuffer>;
  constructors: FetchConstructors;
}): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      constructors.Request && input instanceof constructors.Request
        ? input
        : null;
    const urlString =
      typeof input === "string"
        ? input
        : constructors.URL && input instanceof constructors.URL
          ? input.toString()
          : (request?.url ?? "");

    const resolved = resolver(urlString);
    if (resolved.kind !== "vault") {
      return originalFetch(input as RequestInfo, init);
    }

    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return originalFetch(input as RequestInfo, init);
    }

    const headers = new constructors.Headers(init?.headers ?? request?.headers);
    const rangeHeader = headers.get("range") ?? headers.get("Range");
    const totalSize = resolved.size;

    if (method === "HEAD") {
      return new constructors.Response(null, {
        status: 200,
        headers: buildVaultHeaders(
          constructors.Headers,
          totalSize,
          resolved.mimeType,
        ),
      });
    }

    const data = await readPath(resolved.file);
    const range = rangeHeader ? parseRangeHeader(rangeHeader, totalSize) : null;

    if (range) {
      const sliced = data.slice(range.start, range.end + 1);
      const headersOut = buildVaultHeaders(
        constructors.Headers,
        sliced.byteLength,
        resolved.mimeType,
      );
      headersOut.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${totalSize}`,
      );
      return new constructors.Response(sliced, {
        status: 206,
        headers: headersOut,
      });
    }

    return new constructors.Response(data, {
      status: 200,
      headers: buildVaultHeaders(
        constructors.Headers,
        totalSize,
        resolved.mimeType,
      ),
    });
  };
}

function buildVaultHeaders(
  HeadersCtor: typeof Headers,
  length: number,
  mimeType?: string,
): Headers {
  const headers = new HeadersCtor();
  headers.set("Content-Length", String(length));
  headers.set("Accept-Ranges", "bytes");
  if (mimeType) {
    headers.set("Content-Type", mimeType);
  }
  return headers;
}

function parseRangeHeader(
  rangeHeader: string,
  totalSize: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];
  let start = startRaw ? Number.parseInt(startRaw, 10) : NaN;
  let end = endRaw ? Number.parseInt(endRaw, 10) : NaN;

  if (Number.isNaN(start) && Number.isNaN(end)) return null;

  if (Number.isNaN(start)) {
    const suffixLength = end;
    if (Number.isNaN(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(totalSize - suffixLength, 0);
    end = totalSize - 1;
  } else if (Number.isNaN(end)) {
    end = totalSize - 1;
  }

  if (start < 0 || end < start || end >= totalSize) return null;
  return { start, end };
}

export function getMimeType(extension: string): string | undefined {
  const normalized = extension.toLowerCase();
  const mimeTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return mimeTypes[normalized];
}

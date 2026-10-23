import fs from 'node:fs';
import path from 'node:path';
import type { Application } from 'express';

/** Precompressed variants written next to each asset by the client build (client/vite.config.ts), best first. */
const ENCODINGS = [
  { name: 'br', suffix: '.br' },
  { name: 'gzip', suffix: '.gz' },
] as const;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** The best precompressed variant the browser accepts (`Accept-Encoding`), among the ones on disk. */
export function pickEncoding(acceptEncoding: string, available: (suffix: string) => boolean) {
  const accepted = new Set(
    acceptEncoding
      .split(',')
      .map((part) => part.trim().split(';'))
      .filter(([, quality]) => !quality || !/^\s*q=0(\.0*)?\s*$/.test(quality))
      .map(([name]) => name.trim().toLowerCase())
  );
  return ENCODINGS.find((encoding) => accepted.has(encoding.name) && available(encoding.suffix));
}

/**
 * Serves the hashed build assets (/assets/*) before AppKit's static server, which sends them uncompressed and
 * revalidated on every load: the Apps proxy does not compress either, so the first visit downloaded every byte.
 * A file name changes with its content, so the browser may keep it for a year.
 */
export function setupStaticAssets(app: Application, root = path.resolve(process.cwd(), 'client/dist')) {
  if (process.env.NODE_ENV === 'development') return;
  const assets = path.join(root, 'assets');
  app.get('/assets/:file', (req, res, next) => {
    const name = req.params.file;
    // a plain file name (no path, no leading dot) of a file in assets/
    if (typeof name !== 'string' || !/^[\w-][\w.-]*$/.test(name)) return next();
    const file = path.join(assets, name);
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
    const type = CONTENT_TYPES[path.extname(name)];
    const encoding = type
      ? pickEncoding(req.get('accept-encoding') ?? '', (suffix) => fs.existsSync(file + suffix))
      : undefined;
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Vary', 'Accept-Encoding');
    if (type) res.setHeader('Content-Type', type);
    if (encoding) res.setHeader('Content-Encoding', encoding.name);
    res.sendFile(encoding ? file + encoding.suffix : file, { cacheControl: false }, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
}

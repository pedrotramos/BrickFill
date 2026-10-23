import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pickEncoding, setupStaticAssets } from './static-assets';

describe('pickEncoding', () => {
  const all = () => true;

  it('prefers brotli, then gzip, among the variants on disk', () => {
    expect(pickEncoding('gzip, deflate, br, zstd', all)?.name).toBe('br');
    expect(pickEncoding('gzip, deflate', all)?.name).toBe('gzip');
    expect(pickEncoding('gzip, br', (suffix) => suffix === '.gz')?.name).toBe('gzip');
  });

  it('sends the plain file when the browser refuses both', () => {
    expect(pickEncoding('', all)).toBeUndefined();
    expect(pickEncoding('identity', all)).toBeUndefined();
    expect(pickEncoding('br;q=0, gzip;q=0.0', all)).toBeUndefined();
  });
});

describe('setupStaticAssets', () => {
  let root: string;
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'brickfill-assets-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'assets', 'index-abc.js'), 'console.log(1)');
    fs.writeFileSync(path.join(root, 'assets', 'index-abc.js.br'), 'brotli bytes');
    fs.writeFileSync(path.join(root, 'assets', 'logo.svg'), '<svg/>');
    const app = express();
    setupStaticAssets(app, root);
    app.use((_req, res) => res.status(404).send('next handler'));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const started = app.listen(0, () => resolve(started));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });

  afterAll(() => {
    close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sends the precompressed script, cached for a year', async () => {
    const response = await fetch(`${base}/assets/index-abc.js`, { headers: { 'Accept-Encoding': 'br' } });
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('vary')).toBe('Accept-Encoding');
  });

  it('sends the plain file when there is no accepted variant', async () => {
    const response = await fetch(`${base}/assets/logo.svg`, { headers: { 'Accept-Encoding': 'br, gzip' } });
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(await response.text()).toBe('<svg/>');
    expect(response.headers.get('cache-control')).toContain('immutable');
  });

  it('leaves unknown files and odd names to the next handler', async () => {
    expect(await (await fetch(`${base}/assets/missing.js`)).text()).toBe('next handler');
    expect((await fetch(`${base}/assets/..%2Fsecret.js`)).status).toBe(404);
    expect(await (await fetch(`${base}/assets/.hidden`)).text()).toBe('next handler');
  });
});

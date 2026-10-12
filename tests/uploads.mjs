import test from 'node:test';
import assert from 'node:assert/strict';
import { copyPhoto, photoForm, previewSize } from '../wwwroot/uploads.js';

test('camera bytes survive clearing the original file reference and draft storage', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const camera = { size: 4, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer };
  const photo = await copyPhoto(camera);
  bytes.fill(0);
  const saved = structuredClone(photo);
  const form = await photoForm(saved, '', '');
  assert.deepEqual([...new Uint8Array(await form.get('photo').arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(form.get('photo').type, 'image/jpeg');
  assert.equal(form.get('description'), '');
  assert.equal(form.get('barcode'), '');
});

test('unreadable and partial photos fail clearly before uploading', async () => {
  await assert.rejects(copyPhoto(new Blob()), /empty/);
  await assert.rejects(copyPhoto({ size: 4, arrayBuffer: async () => new ArrayBuffer(0) }), /complete photo/);
  await assert.rejects(copyPhoto({ size: 4, arrayBuffer: async () => { throw new Error('unavailable'); } }), /could not read/);
});

test('phone photos fit within 2MP without upscaling and preserve orientation', () => {
  for (const [width, height] of [[4032, 3024], [3024, 4032], [8000, 6000], [1200, 900], [100, 100]]) {
    const size = previewSize(width, height);
    assert.ok(size.width * size.height <= 2_000_000);
    assert.ok(size.width <= width && size.height <= height);
    assert.ok(Math.abs(size.width / size.height - width / height) < .002);
  }
  assert.deepEqual(previewSize(100, 80), { width: 100, height: 80 });
  assert.throws(() => previewSize(0, 100));
});

test('bundled WebP encoder produces real WebP at the target dimensions', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: encode, init } = await import('@jsquash/webp/encode.js');
  const { simd } = await import('wasm-feature-detect');
  const name = await simd() ? 'webp_enc_simd.wasm' : 'webp_enc.wasm';
  const module = await WebAssembly.compile(await readFile(new URL(`../wwwroot/${name}`, import.meta.url)));
  await init(module);
  const data = new Uint8ClampedArray(100 * 80 * 4).fill(255);
  const encoded = await encode({ data, width: 100, height: 80 }, { quality: 80 });
  const bytes = Buffer.from(encoded);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.ok(bytes.length < data.length);
});

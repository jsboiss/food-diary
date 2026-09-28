import test from 'node:test';
import assert from 'node:assert/strict';
import { copyPhoto, photoForm } from '../wwwroot/uploads.js';

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

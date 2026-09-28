import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../wwwroot/app.js', import.meta.url), 'utf8');
const start = source.indexOf('deleteButton.onclick = async () => {');
const end = source.indexOf('\n    };\n    content.append(deleteButton);', start);
assert.ok(start >= 0 && end > start);
const handler = source.slice(start, end + '\n    };'.length);
function setup({ online = true, failed = false, uploading = false, confirm = true, apiFails = false } = {}) {
  const calls = [];
  let saved = [{ id: 'photo', ...(failed ? { uploadError: 'Request failed (400)' } : {}) }];
  const context = {
    entry: { id: 'photo' }, deleteButton: {}, feedback: {},
    window: { confirm: () => confirm }, navigator: { onLine: online },
    deletingEntries: new Set(), uploadingEntries: new Set(uploading ? ['photo'] : []), serverEntries: [],
    drafts: async () => saved,
    api: async () => { calls.push('server'); if (apiFails) { throw new Error('Wait for analysis'); } },
    remove: async () => { calls.push('local'); saved = []; },
    closeDetail: () => calls.push('close'), render: async () => calls.push('render')
  };
  vm.runInNewContext(handler, context);
  return { context, calls, run: () => context.deleteButton.onclick(), saved: () => saved };
}
test('unsent offline photo deletes locally without a network request', async () => {
  const state = setup({ online: false }); await state.run();
  assert.deepEqual(state.calls, ['local', 'close', 'render']);
  assert.equal(state.saved().length, 0);
});
test('failed uploads reconcile server state before deleting the draft', async () => {
  const state = setup({ failed: true }); await state.run();
  assert.deepEqual(state.calls, ['server', 'local', 'close', 'render']);
});
test('in-flight uploads, offline uncertain uploads, and server refusal retain the photo', async () => {
  for (const options of [{ uploading: true }, { failed: true, online: false }, { failed: true, apiFails: true }]) {
    const state = setup(options); await state.run();
    assert.equal(state.saved().length, 1);
    assert.match(state.context.feedback.textContent, /Could not delete/);
    assert.equal(state.context.deletingEntries.size, 0);
  }
});
test('canceling confirmation keeps the entry', async () => {
  const state = setup({ confirm: false }); await state.run();
  assert.deepEqual(state.calls, []);
  assert.equal(state.saved().length, 1);
});

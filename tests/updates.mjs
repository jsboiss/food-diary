import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../wwwroot/updates.js', import.meta.url), 'utf8').replace('export function', 'function');
const current = 'a'.repeat(64), next = 'b'.repeat(64);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function app({busy = false, online = true, version = next, attempt = null, fail = false} = {}) {
  const elements = Object.fromEntries(['#update-banner', '#update-message', '#apply-update', '#check-updates', '#update-status'].map((name) => [name, {hidden: true}]));
  const events = {}, timers = [], storage = new Map(attempt ? [['diary-update-attempt', attempt]] : []);
  const state = {busy, reloads: 0, requests: 0};
  const context = {
    document: {hidden: false, querySelector: (selector) => selector.startsWith('meta') ? {content: current} : elements[selector], addEventListener: (name, fn) => {events[name] = fn;}},
    navigator: {onLine: online}, window: {addEventListener: (name, fn) => {events[name] = fn;}},
    sessionStorage: {getItem: (key) => storage.get(key), setItem: (key,value) => storage.set(key,value)},
    location: {reload: () => state.reloads++}, setInterval: (fn, ms) => timers.push({fn, ms}),
    AbortSignal, fetch: async (url, options) => {
      state.requests++; assert.equal(url, '/api/version'); assert.equal(options.cache, 'no-store');
      if (fail) { throw Error('Offline'); }
      return {ok: true, json: async () => ({version})};
    }
  };
  vm.createContext(context); vm.runInContext(source, context); context.watchUpdates(() => state.busy);
  return {state, elements, events, timers};
}
test('new release refreshes once when idle', async () => {
  const x = app(); await flush(); assert.equal(x.state.reloads, 1);
  x.timers.find((item) => item.ms === 5000).fn(); assert.equal(x.state.reloads, 1);
});
test('unsaved work blocks both automatic and manual refresh until safe', async () => {
  const x = app({busy: true}); await flush();
  assert.equal(x.state.reloads, 0); assert.equal(x.elements['#update-banner'].hidden, false);
  assert.equal(x.elements['#apply-update'].disabled, true); x.elements['#apply-update'].onclick(); assert.equal(x.state.reloads, 0);
  x.state.busy = false; x.timers.find((item) => item.ms === 5000).fn(); assert.equal(x.state.reloads, 1);
});
test('unchanged version does not reload and manual check confirms it', async () => {
  const x = app({version: current}); await flush(); await x.elements['#check-updates'].onclick();
  assert.equal(x.state.reloads, 0); assert.match(x.elements['#update-status'].textContent, /latest/);
});
test('offline and failed checks keep the app usable', async () => {
  for (const options of [{online: false}, {fail: true}]) {
    const x = app(options); await flush(); await x.elements['#check-updates'].onclick();
    assert.equal(x.state.reloads, 0); assert.match(x.elements['#update-status'].textContent, /Could not check/);
  }
});
test('a stale reload cannot create an automatic refresh loop', async () => {
  const x = app({attempt: next}); await flush(); assert.equal(x.state.reloads, 0);
  assert.equal(x.elements['#update-banner'].hidden, false);
});
test('returning from suspension checks again', async () => {
  const x = app({version: current}); await flush(); x.events.pageshow(); await flush();
  x.events.visibilitychange(); await flush(); assert.equal(x.state.requests, 3);
});

const $ = (selector) => document.querySelector(selector);
let selected = null;
let selectedUrl = null;
let feeling = '';
let syncing = false;
let active = false;
let serverEntries = [];
let analysisMode = 'simulation';
function setMode(mode) {
  analysisMode = mode;
  $('#analysis-notice').textContent = mode === 'openai'
    ? 'AI recognition is on. Saved photos are sent to OpenAI. Suggestions may be wrong; hidden ingredients stay unknown.'
    : 'Recognition is simulated. No photos are sent to AI.';
  $('#simulation-controls').hidden = mode !== 'simulation';
}
let renderedUrls = [];
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('food-diary-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(new Error('Local storage is unavailable. Try regular Safari browsing.'));
});
async function transaction(mode, operation) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = operation(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const drafts = () => transaction('readonly', (store) => store.getAll());
const put = (draft) => transaction('readwrite', (store) => store.put(draft));
const remove = (id) => transaction('readwrite', (store) => store.delete(id));
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Diary-Request': '1', ...options.headers } });
  if (response.status === 401) {
    active = false;
    $('#login-panel').hidden = false;
    $('#app').hidden = true;
    throw new Error('Sign in to resume uploads.');
  }
  if (!response.ok) {
    throw new Error(response.status === 413 ? 'Photo exceeds the 20 MB upload limit.' : `Request failed (${response.status}). Try again.`);
  }
  return response;
}
function setTime() {
  const now = new Date();
  $('#occurred-at').value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function updateSave() { $('#save').disabled = !selected && !feeling; }
function clearPhoto() {
  selected = null;
  if (selectedUrl) { URL.revokeObjectURL(selectedUrl); }
  selectedUrl = null;
  $('#selected-photo').removeAttribute('src');
  $('#selection').hidden = true;
  $('#camera').value = '';
  $('#library').value = '';
  updateSave();
}
for (const input of [$('#camera'), $('#library')]) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) { return; }
    if (file.size > 20 * 1024 * 1024) { $('#message').textContent = 'Please choose a photo smaller than 20 MB.'; return; }
    clearPhoto();
    selected = file;
    selectedUrl = URL.createObjectURL(file);
    $('#selected-photo').src = selectedUrl;
    $('#selection').hidden = false;
    $('#file-info').textContent = `${file.type || 'Unknown format'} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    $('#message').textContent = '';
    updateSave();
  });
}
$('#clear-photo').onclick = clearPhoto;
for (const button of document.querySelectorAll('[data-feeling]')) {
  button.onclick = () => {
    feeling = feeling === button.dataset.feeling ? '' : button.dataset.feeling;
    for (const option of document.querySelectorAll('[data-feeling]')) { option.setAttribute('aria-pressed', String(option.dataset.feeling === feeling)); }
    updateSave();
  };
}
$('#save').onclick = async () => {
  $('#save').disabled = true;
  try {
    const occurredAt = new Date($('#occurred-at').value);
    if (Number.isNaN(occurredAt.valueOf())) { throw new Error('Choose a valid time.'); }
    await put({ id: crypto.randomUUID(), kind: selected ? 'food' : 'symptom', blob: selected,
      occurredAt: occurredAt.toISOString(), zone, feeling, photoKind: $('#photo-kind').value,
      simulateFailure: analysisMode === 'simulation' && $('#simulate-failure').checked,
      uploaded: false, uploadError: null });
    clearPhoto();
    feeling = '';
    for (const button of document.querySelectorAll('[data-feeling]')) { button.setAttribute('aria-pressed', 'false'); }
    $('#simulate-failure').checked = false;
    $('#photo-kind').value = 'meal';
    setTime();
    $('#message').textContent = 'Saved on this phone. You can carry on.';
    await render();
    void sync();
  } catch (error) { $('#message').textContent = `Not saved: ${error.message}`; }
  updateSave();
};
function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text) { result.textContent = text; }
  if (className) { result.className = className; }
  return result;
}
async function render() {
  const pending = await drafts();
  const entries = new Map(serverEntries.map((entry) => [entry.id, entry]));
  for (const draft of pending) {
    entries.set(draft.id, { ...draft, ...entries.get(draft.id), localBlob: draft.blob,
      status: entries.get(draft.id)?.status || (draft.uploaded ? 'Queued' : 'Waiting to upload'), uploadError: draft.uploadError });
  }
  for (const url of renderedUrls) { URL.revokeObjectURL(url); }
  renderedUrls = [];
  const fragment = document.createDocumentFragment();
  for (const entry of [...entries.values()].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))) {
    const article = node('article', '', 'entry');
    if (entry.hasPreview || entry.localBlob) {
      const link = node('a');
      const img = node('img');
      let url = `/api/entries/${entry.id}/preview`;
      if (!entry.hasPreview) { url = URL.createObjectURL(entry.localBlob); renderedUrls.push(url); }
      img.src = url;
      img.alt = 'Food photo';
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.append(img);
      article.append(link);
    } else { article.append(node('div', entry.kind === 'symptom' ? '☺' : '◌', 'placeholder')); }
    const content = node('div');
    content.append(node('span', entry.status, 'badge'));
    content.append(node('h3', entry.title || (entry.kind === 'food' ? 'Food photo' : 'Stomach check-in')));
    content.append(node('p', `${new Date(entry.occurredAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · Stomach: ${entry.feeling || 'not recorded'}`));
    if (entry.hasPreview) { content.append(node('p', `WebP · ${entry.width} × ${entry.height} · ${(entry.previewBytes / 1024).toFixed(0)} KB · 80% quality`)); }
    if (entry.originalDeletedAt) { content.append(node('p', 'Server original deleted.')); }
    if (entry.recognition) {
      content.append(node('p', 'AI suggestion · not confirmed', 'badge'));
      if (entry.recognition.visibleFoods.length) { content.append(node('p', `Visible foods: ${entry.recognition.visibleFoods.join(', ')}`)); }
      if (entry.recognition.labelIngredients.length) { content.append(node('p', `Label transcription: ${entry.recognition.labelIngredients.join(', ')}`)); }
      for (const uncertainty of entry.recognition.uncertainties) { content.append(node('p', uncertainty)); }
      const details = node('details');
      details.append(node('summary', 'Analysis details'));
      details.append(node('p', `${entry.recognition.model} · ${entry.recognition.imageSource} · ${entry.recognition.width} × ${entry.recognition.height}`));
      details.append(node('p', `Tokens: ${entry.recognition.inputTokens ?? 'unknown'} input / ${entry.recognition.outputTokens ?? 'unknown'} output. Retries may add cost.`));
      content.append(details);
    }
    if (entry.error || entry.uploadError) { content.append(node('p', entry.error || entry.uploadError, 'error')); }
    if (entry.status === 'Failed' && entry.hasPreview) {
      const retry = node('button', 'Retry analysis', 'text-button');
      retry.onclick = async () => {
        retry.disabled = true;
        try { await api(`/api/entries/${entry.id}/retry`, { method: 'POST' }); await sync(); }
        catch (error) { $('#message').textContent = error.message; }
        finally { retry.disabled = false; }
      };
      content.append(retry);
    }
    if (entry.uploadError) {
      const retry = node('button', 'Retry upload', 'text-button');
      retry.onclick = async () => { const draft = pending.find((item) => item.id === entry.id); await put({ ...draft, uploadError: null }); void sync(); };
      content.append(retry);
    }
    article.append(content);
    fragment.append(article);
  }
  if (!entries.size) { fragment.append(node('div', 'Your first photo or check-in will appear here.', 'empty')); }
  $('#entries').replaceChildren(fragment);
}
async function sync() {
  if (syncing || !active) { return; }
  if (!navigator.onLine) { $('#connection').textContent = 'Offline · entries stay on this phone'; await render(); return; }
  syncing = true;
  try {
    const response = await api('/api/entries');
    const state = await response.json();
    serverEntries = state.entries;
    setMode(state.mode);
    for (const draft of await drafts()) {
      const server = serverEntries.find((entry) => entry.id === draft.id);
      if (server?.hasPreview || server?.kind === 'symptom') { await remove(draft.id); continue; }
      if (server || draft.uploaded || draft.uploadError) { continue; }
      $('#connection').textContent = 'Uploading · you can keep logging';
      try {
        if (draft.kind === 'food') {
          const query = new URLSearchParams({ occurredAt: draft.occurredAt, zone: draft.zone, feeling: draft.feeling,
            photoKind: draft.photoKind || 'meal', simulateFailure: draft.simulateFailure });
          await api(`/api/entries/${draft.id}/photo?${query}`, { method: 'PUT', body: draft.blob, headers: { 'Content-Type': 'application/octet-stream' } });
          await put({ ...draft, uploaded: true });
        } else {
          await api(`/api/symptoms/${draft.id}`, { method: 'PUT', body: JSON.stringify(draft), headers: { 'Content-Type': 'application/json' } });
          await remove(draft.id);
        }
      } catch (error) {
        if (active) { await put({ ...draft, uploadError: error.message }); }
        throw error;
      }
    }
    serverEntries = (await (await api('/api/entries')).json()).entries;
    $('#connection').textContent = analysisMode === 'openai' ? 'Connected · AI recognition on' : 'Connected · simulation mode';
  } catch (error) { $('#connection').textContent = error.message; }
  finally { syncing = false; await render(); }
}
async function openDiary() {
  active = true;
  $('#login-panel').hidden = true;
  $('#app').hidden = false;
  localStorage.setItem('diary-opened', 'true');
  await sync();
}
$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  try {
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    $('#login-error').textContent = '';
    await openDiary();
  } catch { $('#login-error').textContent = 'Could not sign in. Check the password and connection.'; }
};
$('#logout').onclick = async () => {
  try { await api('/api/logout', { method: 'POST' }); }
  catch (error) { $('#message').textContent = error.message; return; }
  active = false;
  localStorage.removeItem('diary-opened');
  serverEntries = [];
  $('#entries').replaceChildren();
  $('#app').hidden = true;
  $('#login-panel').hidden = false;
};
$('#barcode').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) { return; }
  const url = URL.createObjectURL(file);
  $('#barcode-result').textContent = 'Reading barcode…';
  try {
    const { decodeBarcode } = await import('/barcode.js');
    const code = await decodeBarcode(url);
    $('#barcode-result').textContent = `Barcode ${code}. Looking up product…`;
    const response = await api(`/api/products/${encodeURIComponent(code)}`);
    const product = await response.json();
    $('#barcode-result').textContent = product.name ? `${code} · ${product.name}${product.brand ? ' · ' + product.brand : ''}. ${product.ingredients || 'No ingredient list available.'}` : `${code} decoded, but no product found. Manual/label-photo fallback is planned.`;
  } catch (error) { $('#barcode-result').textContent = `Could not complete barcode test. ${error.message}`; }
  finally { URL.revokeObjectURL(url); event.target.value = ''; }
};
window.addEventListener('online', async () => {
  for (const draft of await drafts()) { if (draft.uploadError) { await put({ ...draft, uploadError: null }); } }
  void sync();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void sync(); } });
setInterval(() => { if (!document.hidden) { void sync(); } }, 3000);
setTime();
if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
if (localStorage.getItem('diary-opened')) { void openDiary(); }

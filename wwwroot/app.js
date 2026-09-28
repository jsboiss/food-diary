import { icon } from '/icons.js';
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
      occurredAt: occurredAt.toISOString(), zone, feeling, photoKind: 'auto', description: $('#description').value.trim(),
      simulateFailure: analysisMode === 'simulation' && $('#simulate-failure').checked,
      uploaded: false, uploadError: null });
    clearPhoto();
    feeling = '';
    for (const button of document.querySelectorAll('[data-feeling]')) { button.setAttribute('aria-pressed', 'false'); }
    $('#simulate-failure').checked = false;
    $('#description').value = '';
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
let displayedEntries = new Map();
function showView() {
  const view = ['add', 'timeline', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'add';
  for (const section of document.querySelectorAll('.view')) { section.hidden = section.id !== `view-${view}`; }
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === view) { link.setAttribute('aria-current', 'page'); } else { link.removeAttribute('aria-current'); }
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', showView);
showView();
for (const slot of document.querySelectorAll('[data-icon]')) { slot.replaceChildren(icon(slot.dataset.icon)); }
const timeLabel = (value) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const entryTitle = (entry) => entry.title || (entry.kind === 'food' ? 'Food photo' : 'Stomach check-in');
const ingredientItems = (entry) => entry.editedIngredients ?? entry.product?.ingredients ?? [...(entry.recognition?.visibleFoods || []), ...(entry.recognition?.labelIngredients || [])];
async function render() {
  const pending = await drafts();
  const entries = new Map(serverEntries.map((entry) => [entry.id, entry]));
  for (const draft of pending) {
    entries.set(draft.id, { ...draft, ...entries.get(draft.id), localBlob: draft.blob,
      status: entries.get(draft.id)?.status || (draft.uploaded ? 'Queued' : 'Waiting to upload'), uploadError: draft.uploadError });
  }
  displayedEntries = entries;
  // Avoid replacing focused rows and images on every poll when nothing has changed.
  const signature = JSON.stringify([...entries.values()].map(({localBlob, blob, ...entry}) => entry));
  if ($('#entries').dataset.signature === signature) { return; }
  $('#entries').dataset.signature = signature;
  for (const url of renderedUrls) { URL.revokeObjectURL(url); }
  renderedUrls = [];
  const fragment = document.createDocumentFragment();
  let day = '';
  for (const entry of [...entries.values()].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))) {
    const date = new Date(entry.occurredAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (date !== day) { fragment.append(node('h2', date, 'day-heading')); day = date; }
    const row = node('button', '', 'entry-row');
    if (entry.hasPreview || entry.localBlob) {
      const img = node('img');
      let url = `/api/entries/${entry.id}/preview`;
      if (!entry.hasPreview) { url = URL.createObjectURL(entry.localBlob); renderedUrls.push(url); }
      img.src = url; img.alt = ''; img.loading = 'lazy'; row.append(img);
    } else { const placeholder = node('span', '', 'placeholder'); placeholder.append(icon(entry.feeling || 'food')); row.append(placeholder); }
    const copy = node('span', '', 'entry-copy');
    copy.append(node('strong', entryTitle(entry)));
    copy.append(node('small', `${timeLabel(entry.occurredAt)} · Stomach: ${entry.feeling || 'not recorded'}`));
    if (!['Identified', 'Saved'].includes(entry.status)) { copy.append(node('small', entry.uploadError ? 'Upload needs attention' : entry.status)); }
    row.append(copy, icon('next')); row.onclick = () => openEntry(entries.get(entry.id)); fragment.append(row);
  }
  if (!entries.size) { fragment.append(node('div', 'A photo. A check-in.\nYour entries will appear here.', 'empty')); }
  $('#entries').replaceChildren(fragment);
}
let detailUrl = null;
function closeDetail() { $('#entry-dialog').close(); }
$('#close-detail').onclick = closeDetail;
$('#entry-dialog').addEventListener('close', () => { if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; } });
function openEntry(entry) {
  if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }
  const content = $('#detail-content'); content.replaceChildren();
  if (entry.hasPreview || entry.localBlob) {
    const img = node('img', '', 'detail-photo');
    img.src = entry.hasPreview ? `/api/entries/${entry.id}/preview` : (detailUrl = URL.createObjectURL(entry.localBlob));
    img.alt = entryTitle(entry); content.append(img);
  }
  content.append(node('p', `${new Date(entry.occurredAt).toLocaleString()} · Stomach: ${entry.feeling || 'not recorded'}`, 'detail-meta'));
  content.append(node('span', entry.status, 'badge'));
  if (entry.description) { content.append(node('p', entry.description)); }
  if (entry.error || entry.uploadError) { content.append(node('p', entry.error || entry.uploadError, 'error')); }
  if (['Queued', 'Processing', 'RetryScheduled', 'Waiting to upload'].includes(entry.status)) {
    content.append(node('p', 'Processing in the background. Reopen this entry shortly to see the result.', 'hint'));
  }
  const form = node('form', '', 'detail-form');
  const titleLabel = node('label', 'Meal name'); titleLabel.htmlFor = 'edit-title';
  const titleInput = node('input'); titleInput.id = 'edit-title'; titleInput.maxLength = 160; titleInput.required = true; titleInput.value = entryTitle(entry);
  form.append(titleLabel, titleInput);
  const details = node('details', '', 'ingredient-editor');
  const summary = node('summary', `See ingredients (${ingredientItems(entry).length})`); details.append(summary);
  details.append(node('p', entry.editedAt ? 'Edited by you. Original suggestions are kept below.' : entry.product ? 'From Open Food Facts. Check against your package.' : 'AI suggestions. Add anything missed or remove anything incorrect.', 'hint'));
  let ingredients = [...ingredientItems(entry)];
  const list = node('ul', '', 'ingredient-list');
  const drawIngredients = () => {
    list.replaceChildren(); summary.textContent = `See ingredients (${ingredients.length})`;
    ingredients.forEach((item, index) => {
      const row = node('li'); const removeButton = node('button', '', 'icon-button'); removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `Remove ${item}`); removeButton.append(icon('close'));
      removeButton.onclick = () => { ingredients.splice(index, 1); drawIngredients(); };
      row.append(node('span', item), removeButton); list.append(row);
    });
    if (!ingredients.length) { list.append(node('li', 'No ingredients yet.')); }
  };
  drawIngredients(); details.append(list);
  const addRow = node('div', '', 'ingredient-add');
  const ingredientInput = node('input'); ingredientInput.placeholder = 'Add an ingredient'; ingredientInput.maxLength = 300; ingredientInput.setAttribute('aria-label', 'Add an ingredient');
  const addButton = node('button', 'Add', 'secondary'); addButton.type = 'button';
  const addIngredient = () => { const value = ingredientInput.value.trim(); if (value && ingredients.length < 80 && !ingredients.some((item) => item.toLowerCase() === value.toLowerCase())) { ingredients.push(value); ingredientInput.value = ''; drawIngredients(); } };
  addButton.onclick = addIngredient; ingredientInput.onkeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); addIngredient(); } };
  addRow.append(ingredientInput, addButton); details.append(addRow); form.append(details);
  if (entry.recognition || entry.product) {
    const original = node('details'); original.append(node('summary', 'Original suggestions'));
    if (entry.recognition) {
      original.append(node('p', `Visible foods: ${entry.recognition.visibleFoods.join(', ') || 'None identified'}`));
      if (entry.recognition.labelIngredients.length) { original.append(node('p', `Label: ${entry.recognition.labelIngredients.join(', ')}`)); }
      for (const uncertainty of entry.recognition.uncertainties) { original.append(node('p', uncertainty)); }
    }
    if (entry.product) { original.append(node('p', `${entry.product.source}: ${entry.product.name}. ${entry.product.ingredientsText || entry.product.ingredients.join('; ')}`)); }
    form.append(original);
  }
  const save = node('button', 'Save changes', 'primary'); save.type = 'submit';
  const feedback = node('p', '', 'hint'); feedback.setAttribute('role', 'status');
  save.disabled = !serverEntries.some((item) => item.id === entry.id);
  if (save.disabled) { feedback.textContent = 'Ingredient edits are available after upload.'; }
  form.append(save, feedback);
  form.onsubmit = async (event) => {
    event.preventDefault(); save.disabled = true; addIngredient();
    try {
      await api(`/api/entries/${entry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: titleInput.value.trim(), ingredients }) });
      feedback.textContent = 'Changes saved.'; await sync();
    } catch (error) { feedback.textContent = `Not saved: ${error.message}`; }
    finally { save.disabled = false; }
  };
  if (entry.kind === 'food') { content.append(form); }
  if (entry.status === 'Failed' && entry.hasPreview) {
    const retry = node('button', 'Retry analysis', 'secondary'); retry.onclick = async () => { retry.disabled = true; try { await api(`/api/entries/${entry.id}/retry`, { method: 'POST' }); closeDetail(); await sync(); } catch (error) { feedback.textContent = error.message; retry.disabled = false; } }; content.append(retry);
  }
  if (entry.uploadError) {
    const retry = node('button', 'Retry upload', 'secondary'); retry.onclick = async () => { const draft = (await drafts()).find((item) => item.id === entry.id); if (draft) { await put({ ...draft, uploadError: null }); } closeDetail(); void sync(); }; content.append(retry);
  }
  if (!$('#entry-dialog').open) { $('#entry-dialog').showModal(); }
}
async function findBarcode(blob) {
  // Decode on a bounded, downscaled canvas, after the entry is already saved locally.
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const { decodeBarcode } = await import('/barcode.js');
    const code = await decodeBarcode(canvas.toDataURL('image/jpeg', .9));
    return /^(?:[0-9]{8}|[0-9]{12,14})$/.test(code) ? code : '';
  } catch { return ''; }
  finally { URL.revokeObjectURL(url); }
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
            photoKind: draft.photoKind || 'auto', simulateFailure: draft.simulateFailure });
          const body = new FormData(); body.append('photo', draft.blob, 'photo'); body.append('description', draft.description || '');
          body.append('barcode', await findBarcode(draft.blob));
          await api(`/api/entries/${draft.id}/photo?${query}`, { method: 'PUT', body });
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
  delete $('#entries').dataset.signature;
  closeDetail();
  $('#app').hidden = true;
  $('#login-panel').hidden = false;
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

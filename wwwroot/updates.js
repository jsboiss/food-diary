// Compare the version embedded in this document, not a freshly fetched baseline.
export function watchUpdates(isBusy) {
  const current = document.querySelector('meta[name="app-version"]')?.content;
  const banner = document.querySelector('#update-banner');
  const message = document.querySelector('#update-message');
  const button = document.querySelector('#apply-update');
  let available = null;
  let checking = false;
  let lastCheckSucceeded = false;
  let reloading = false;
  let registration = null;
  const reload = () => {
    if (isBusy() || reloading || !navigator.onLine) { return; }
    reloading = true;
    try { sessionStorage.setItem('diary-update-attempt', available || current); } catch { /* Storage may be disabled. */ }
    location.reload();
  };
  const present = () => {
    if (!available || document.hidden) { return; }
    const busy = isBusy();
    banner.hidden = false;
    button.disabled = busy || !navigator.onLine;
    message.textContent = busy ? 'Update ready. Save your entry and close its details to refresh.' : 'A new version is ready.';
    let attempted = true;
    try { attempted = sessionStorage.getItem('diary-update-attempt') === available; } catch { /* Prefer a manual refresh to a loop. */ }
    if (!busy && !attempted) { reload(); }
  };
  async function check() {
    if (!current || checking || document.hidden || !navigator.onLine) { return; }
    checking = true;
    lastCheckSucceeded = false;
    try {
      void registration?.update().catch(() => {});
      const response = await fetch('/api/version', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) { return; }
      const { version } = await response.json();
      if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) { return; }
      lastCheckSucceeded = true;
      available = version === current ? null : version;
      if (!available) { banner.hidden = true; } else { present(); }
    } catch { /* Offline or an interrupted deployment must not interfere with entries. */ }
    finally { checking = false; }
  }
  button.onclick = reload;
  document.querySelector('#check-updates').onclick = async () => {
    lastCheckSucceeded = false;
    document.querySelector('#update-status').textContent = 'Checking for updates…';
    await check();
    document.querySelector('#update-status').textContent = available ? 'Update ready.' : lastCheckSucceeded ? 'You’re on the latest version.' : 'Could not check right now. Try again when online.';
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((value) => { registration = value; }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { void check(); });
  }
  window.addEventListener('pageshow', () => { void check(); });
  window.addEventListener('online', () => { void check(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { void check(); } });
  setInterval(() => { void check(); }, 60000);
  setInterval(present, 5000);
  void check();
}

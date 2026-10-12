// Detach camera/library files from their input before clearing it or persisting a draft.
export async function copyPhoto(photo) {
  if (!photo || !photo.size) { throw new Error('The photo is empty. Please take or choose it again.'); }
  let bytes;
  try { bytes = await photo.arrayBuffer(); }
  catch { throw new Error('The phone could not read this photo. Please choose it again from your library.'); }
  if (!bytes.byteLength || bytes.byteLength !== photo.size) {
    throw new Error('The phone could not read the complete photo. Please choose it again from your library.');
  }
  return new Blob([bytes], { type: photo.type || 'application/octet-stream' });
}

export async function photoForm(photo, description, barcode) {
  const body = new FormData();
  body.append('photo', await copyPhoto(photo), 'photo');
  body.append('description', description || '');
  body.append('barcode', barcode || '');
  return body;
}

export function previewSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('This photo could not be read. Please choose another photo.');
  }
  const scale = Math.min(1, Math.sqrt(2_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export async function compressPhoto(photo) {
  const url = URL.createObjectURL(photo);
  const canvas = document.createElement('canvas');
  let worker;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const size = previewSize(image.naturalWidth, image.naturalHeight);
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, size.width, size.height);
    const pixels = context.getImageData(0, 0, size.width, size.height);
    // Use a bundled WebP encoder: iPhone browsers can silently encode PNG when asked for WebP.
    worker = new Worker('/compress-worker.js', { type: 'module' });
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Photo compression timed out. Please retry.')), 90000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        if (data.error || !data.bytes?.byteLength) { reject(new Error(data.error || 'Photo compression failed.')); return; }
        resolve(new Blob([data.bytes], { type: 'image/webp' }));
      };
      worker.onerror = () => { clearTimeout(timeout); reject(new Error('Photo compression failed. Please reconnect and retry.')); };
      worker.postMessage({ data: pixels.data, width: size.width, height: size.height }, [pixels.data.buffer]);
    });
  } finally {
    worker?.terminate();
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

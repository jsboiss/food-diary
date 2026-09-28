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

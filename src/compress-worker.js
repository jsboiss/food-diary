import encode, { init } from '@jsquash/webp/encode.js';

self.onmessage = async ({ data }) => {
  try {
    await init({ locateFile: (name) => new URL(name, self.location.href).href });
    const bytes = await encode(data, { quality: 80 });
    self.postMessage({ bytes }, [bytes]);
  } catch {
    self.postMessage({ error: 'Could not compress this photo. Please try again.' });
  }
};

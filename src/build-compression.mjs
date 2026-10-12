import { copyFile } from 'node:fs/promises';
for (const name of ['webp_enc.wasm', 'webp_enc_simd.wasm']) {
  await copyFile(`node_modules/@jsquash/webp/codec/enc/${name}`, `wwwroot/${name}`);
}

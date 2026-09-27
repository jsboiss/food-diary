import { BrowserMultiFormatReader } from '@zxing/browser';
export async function decodeBarcode(url) {
  const reader = new BrowserMultiFormatReader();
  return (await reader.decodeFromImageUrl(url)).getText();
}

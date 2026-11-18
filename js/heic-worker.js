'use strict';
/* PDF Studio · HEIC/HEIF decoder
   Runs libheif (WebAssembly) off the main thread so the page stays responsive
   while large iPhone photos decode. Loaded only when a HEIC file is chosen.
   Request:  { id, buffer }   (ArrayBuffer, transferred)
   Response: { id, width, height, pixels } (RGBA ArrayBuffer, transferred)
         or  { id, error } */

importScripts('../vendor/libheif/libheif.js');

const ready = libheif({ locateFile: f => '../vendor/libheif/' + f });

self.onmessage = async ({ data: { id, buffer } }) => {
  let images = [];
  try {
    const lib = await ready;
    const decoder = new lib.HeifDecoder();
    images = decoder.decode(new Uint8Array(buffer));
    if (!images.length) throw new Error('This file has no readable image');

    // Burst and Live Photo files can hold several images; use the main one.
    const img = images.find(i => i.is_primary()) || images[0];
    const width = img.get_width(), height = img.get_height();
    const pixels = new Uint8ClampedArray(width * height * 4);
    const out = await new Promise(res => img.display({ data: pixels, width, height }, res));
    if (!out) throw new Error('This HEIC image could not be decoded');

    self.postMessage({ id, width, height, pixels: pixels.buffer }, [pixels.buffer]);
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) });
  } finally {
    images.forEach(i => { try { i.free(); } catch (_) {} });
  }
};

/**
 * Raw base64 (no data-URL prefix) of a Blob's bytes, encoded in chunks so a large
 * image never overflows the argument limit of String.fromCharCode. Uses only
 * Blob.arrayBuffer() and btoa(), so it works in browsers and in Node (tests).
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x4000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

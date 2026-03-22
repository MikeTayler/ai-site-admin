/**
 * Parse a browser FileReader data URL into a buffer and file extension for GitHub upload.
 */
export function parseDataUrl(dataUrl: string): { buffer: Buffer; ext: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    throw new Error("Invalid image data — expected a base64 data URL.");
  }
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  let ext = "bin";
  if (mime.includes("svg")) ext = "svg";
  else if (mime.includes("png")) ext = "png";
  else if (mime.includes("jpeg") || mime.includes("jpg")) ext = "jpg";
  else if (mime.includes("webp")) ext = "webp";
  else if (mime.includes("gif")) ext = "gif";
  return { buffer: buf, ext };
}

export const MAX_LOGO_BYTES = 1_500_000;

// Upload content verification: never trust the declared MIME type — check the
// file's magic bytes so a script/executable renamed to .jpg is rejected.

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

export function sniffImage(buffer: Buffer): SniffedImageType | null {
  if (buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return "image/png";
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  // HEIC/HEIF: ISO-BMFF "ftyp" box with a heic/heif/mif1 brand
  if (buffer.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "heif", "mif1", "msf1", "hevc"].includes(brand)) return "image/heic";
  }
  return null;
}

/** XLSX files are ZIP containers: must start with the PK local-file signature. */
export function isXlsxBytes(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 && // P
    buffer[1] === 0x4b && // K
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

/**
 * Returns the REAL content type of an uploaded "image", or null when the
 * bytes are not a supported image (whatever the client claimed).
 */
export function verifiedImageType(buffer: Buffer): SniffedImageType | null {
  return sniffImage(buffer);
}

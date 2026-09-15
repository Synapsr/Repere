/**
 * Original synthetic scan: 32×32 white pixels with a black square at (8,8)–(23,23).
 * The Group 4 strip was generated once with ImageMagick, without external artwork:
 * magick -size 32x32 xc:white -fill black -draw 'rectangle 8,8 23,23' \
 *   -monochrome -compress Group4 scan.tiff
 * Only the TIFF's 20 compressed image bytes are embedded; tests need no image tool.
 */
export function ccittPdfFixture(): Buffer {
  const pixels = Buffer.from("JqDV//yLV//////////j//wAQAQ=", "base64");
  const drawing = "q 320 0 0 320 0 0 cm /Scan Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 320] /Resources << /XObject << /Scan 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K -1 /Columns 32 /Rows 32 /BlackIs1 true >> /Length ${pixels.length} >>\nstream\n`,
      ),
      pixels,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from(`<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}\nendstream`),
  ];
  const parts = [Buffer.from("%PDF-1.7\n")];
  const offsets = [0];
  let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    parts.push(part);
    length += part.length;
  }
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
        .join(
          "",
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}

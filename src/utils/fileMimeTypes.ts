/**
 * MIME inference for common upload types — mirrors the image extension
 * fallback in `imageFileTypes.ts` so PDFs, Office docs, etc. are not rejected
 * when the browser leaves `file.type` blank.
 */

const EXT_TO_MIME: readonly [ext: string, mime: string][] = [
  ['.pdf', 'application/pdf'],
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.zip', 'application/zip'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.dwg', 'application/acad'],
  ['.dxf', 'application/dxf'],
];

export function inferFileMimeType(file: File): string | null {
  const raw = (file.type || '').trim();
  if (raw && raw !== 'application/octet-stream') return raw;

  const name = file.name.toLowerCase();
  for (const [ext, mime] of EXT_TO_MIME) {
    if (name.endsWith(ext)) return mime;
  }
  return raw || null;
}

/** Clone `File` with an inferred MIME when the browser left it blank or generic. */
export function withInferredFileMime(file: File): File {
  const inferred = inferFileMimeType(file);
  if (!inferred) return file;
  const cur = (file.type || '').trim();
  if (cur === inferred) return file;
  return new File([file], file.name, {
    type: inferred,
    lastModified: file.lastModified,
  });
}

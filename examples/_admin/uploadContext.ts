/** Upload context for public fill / preview file paths (ADR-028). */

let formId: string | null = null;

export function setUploadContext(id: string): void {
  formId = id;
}

export function clearUploadContext(): void {
  formId = null;
}

export function getUploadFormId(): string | null {
  return formId;
}

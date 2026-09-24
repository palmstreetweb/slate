/** Upload context for public fill / preview file paths (ADR-029, ADR-050). */

export type UploadScope = 'public' | 'draft';

let formId: string | null = null;
let scope: UploadScope | null = null;

/**
 * `scope` pins where uploads go. PublicFill passes 'public': a respondent who
 * happens to be signed into their own Slate studio is still a respondent on
 * someone else's form, and a draft/ path would fail the owner check.
 * Studio previews leave it unset and upload as draft/ when signed in.
 */
export function setUploadContext(id: string, opts?: { scope?: UploadScope }): void {
  formId = id;
  scope = opts?.scope ?? null;
}

export function clearUploadContext(): void {
  formId = null;
  scope = null;
}

export function getUploadFormId(): string | null {
  return formId;
}

export function getUploadScope(): UploadScope | null {
  return scope;
}

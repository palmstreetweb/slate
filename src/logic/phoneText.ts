/**
 * Phone numbers, for the phone question and the contact block (F13, F22):
 * one country for local numbers and one way to say a number needs fixing.
 * Pure, no React. On demand only: nothing the engine's core imports may
 * import this (a core module's exports all ship up front, AGENTS.md).
 */

/** The country local numbers are read in: the owner's, when it is a real one; else the US. */
export function phoneCountry(code: unknown, isSupported: (c: string) => boolean): string {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(c) && isSupported(c) ? c : 'US';
}

/** "the United States", "Canada", "the United Kingdom": a country's name, as it reads mid-sentence. */
export function countryName(code: string): string {
  let name = code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    // An old browser: the two-letter code still says it.
  }
  return /^(United |Dominican |Central African )|Islands$|^(Netherlands|Philippines|Bahamas|Maldives|Seychelles|Gambia|Comoros)$/.test(
    name,
  )
    ? `the ${name}`
    : name;
}

/** What to do about a number that doesn't check out, in plain words. */
export function phoneProblem(country: string): string {
  return `Please check the number, including the area code. For a number outside ${countryName(country)}, start with + and the country code.`;
}

/** Enough digits to be a phone number at all (the core's contact check uses the same 7). */
export function looksLikePhone(text: string): boolean {
  return text.replace(/\D/g, '').length >= 7;
}

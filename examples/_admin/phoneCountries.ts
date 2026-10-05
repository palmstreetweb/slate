/**
 * Countries for "Country for local numbers" on phone and contact questions.
 * Only countries libphonenumber-js can read local numbers for are offered (a
 * test keeps this list in step with the library), so a phone number typed
 * without +1 / +44 is always understood. Names come from the browser, in
 * English; the most likely ones for Palm Street's clients come first.
 */

export const PHONE_COUNTRIES: ReadonlyArray<string> = (
  'AC AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ ' +
  'BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO ' +
  'DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU ' +
  'GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW ' +
  'KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT ' +
  'PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TA ' +
  'TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS XK ' +
  'YE YT ZA ZM ZW'
).split(' ');

const KNOWN = new Set(PHONE_COUNTRIES);

/** Listed first, in this order. */
const FIRST = ['US', 'CA', 'MX', 'GB', 'IE', 'AU', 'NZ'];

/** A country the phone check can use for local numbers. */
export function isPhoneCountry(code: unknown): code is string {
  return typeof code === 'string' && KNOWN.has(code);
}

let names: Intl.DisplayNames | null | undefined;

/** "United States" for "US" (the code itself when the browser has no name for it). */
export function countryName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

let options: Array<{ value: string; label: string }> | null = null;

/** Every country for the picker: the usual ones first, then A to Z by name. */
export function phoneCountryOptions(): ReadonlyArray<{ value: string; label: string }> {
  if (!options) {
    const rest = PHONE_COUNTRIES.filter((c) => !FIRST.includes(c))
      .map((c) => ({ value: c, label: countryName(c) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en'));
    options = [...FIRST.map((c) => ({ value: c, label: countryName(c) })), ...rest];
  }
  return options;
}

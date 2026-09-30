/**
 * Inspector sections for Wave B (ADR-064): prices on options and number
 * answers, package-card details, the contact block, the address (with its
 * service area and a one-click "out of area" ending), the signature, and the
 * instant estimate on an ending.
 */

import { useEffect, useState } from 'react';
import type {
  AddressQuestion,
  ContactField,
  ContactFieldMode,
  ContactInfoQuestion,
  EstimateSettings,
  NumberQuestion,
  Option,
  Question,
  SignatureQuestion,
} from '@/index.js';
import { contactMode } from '@/logic/contact.js';
import { parseServiceAreaText, serviceAreaPrefixes, SERVICE_AREA_MAX } from '@/logic/address.js';
import { PRICE_MAX, estimateCurrency, hasPricing } from '@/logic/estimate.js';
import { SlateNumberInput } from './SlateNumberInput.js';
import { SlateSelect } from './SlateSelect.js';
import { Checkbox, CollapsibleSection, Field, Row } from './inspectorParts.js';

type Patch = (patch: Partial<Question>) => void;

/** Currencies offered in the estimate settings; the stored value is the code. */
export const CURRENCIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'USD', label: 'US dollar (USD)' },
  { value: 'CAD', label: 'Canadian dollar (CAD)' },
  { value: 'MXN', label: 'Mexican peso (MXN)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: 'British pound (GBP)' },
  { value: 'AUD', label: 'Australian dollar (AUD)' },
  { value: 'NZD', label: 'New Zealand dollar (NZD)' },
];

/** A symbol for the price inputs' prefix ("$", "€"). */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat(undefined, { style: 'currency', currency })
      .formatToParts(0)
      .find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}

function priceOrUndefined(n: number | undefined): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  return Math.max(-PRICE_MAX, Math.min(PRICE_MAX, n));
}

/**
 * Low / high price inputs ("$ 450 to 600"). Blank high = one price. Used for
 * option prices, a price per unit, and the base price.
 */
export function PriceInputs({
  low,
  high,
  onChange,
  currency,
  label = 'Price',
}: {
  low: number | undefined;
  high: number | undefined;
  onChange: (low: number | undefined, high: number | undefined) => void;
  currency: string;
  label?: string;
}) {
  const symbol = currencySymbol(currency);
  return (
    <span className="slate-price-inputs">
      <span className="slate-price-symbol" aria-hidden="true">
        {symbol}
      </span>
      <SlateNumberInput
        compact
        value={low}
        step={10}
        placeholder="0"
        aria-label={`${label}, ${currency}`}
        onChange={(n) => {
          const lo = priceOrUndefined(n);
          onChange(lo, lo === undefined ? undefined : high);
        }}
      />
      <span className="slate-price-to">to</span>
      <SlateNumberInput
        compact
        value={high}
        step={10}
        placeholder="max"
        aria-label={`${label}, high end (optional)`}
        onChange={(n) => onChange(low, priceOrUndefined(n))}
      />
    </span>
  );
}

/** True when some option carries a price. */
export function optionsPriced(options: ReadonlyArray<Option>): boolean {
  return options.some((o) => typeof o.price === 'number');
}

/**
 * Show / hide the price inputs on an options list. Prices show once any option
 * has one; "Add prices" shows empty inputs without writing $0 anywhere. The
 * editor is keyed by question, so this starts fresh for each question.
 */
export function usePricing(options: ReadonlyArray<Option>) {
  const priced = optionsPriced(options);
  const [open, setOpen] = useState(priced);
  return { show: open || priced, open: () => setOpen(true), close: () => setOpen(false) };
}

/** Strip prices from every option. */
export function withoutPrices<T extends Option>(options: ReadonlyArray<T>): T[] {
  return options.map((o) => {
    const next = { ...o };
    delete next.price;
    delete next.priceMax;
    return next;
  });
}

/** Package-card details for one option: badge, short description, features. */
export function CardDetails({
  option,
  onChange,
}: {
  option: Option;
  onChange: (patch: Partial<Option>) => void;
}) {
  const [features, setFeatures] = useState((option.features ?? []).join('\n'));
  return (
    <span className="slate-card-details">
      <input
        className="slate-input slate-option-sub"
        value={option.badge ?? ''}
        placeholder="Badge, e.g. Most popular (optional)"
        maxLength={24}
        aria-label={`Badge for ${option.label}`}
        onChange={(e) => onChange({ badge: e.target.value || undefined })}
      />
      <input
        className="slate-input slate-option-sub"
        value={option.description ?? ''}
        placeholder="One-line description (optional)"
        maxLength={140}
        aria-label={`Description for ${option.label}`}
        onChange={(e) => onChange({ description: e.target.value || undefined })}
      />
      <textarea
        className="slate-textarea slate-option-sub"
        value={features}
        rows={3}
        placeholder={'Features, one per line\nFull tear-off\n10-year warranty'}
        aria-label={`Features for ${option.label}`}
        onChange={(e) => {
          setFeatures(e.target.value);
          const list = e.target.value
            .split('\n')
            .map((l) => l.trim().slice(0, 80))
            .filter(Boolean)
            .slice(0, 6);
          onChange({ features: list.length ? list : undefined });
        }}
      />
    </span>
  );
}

/** Number answers: a price per unit feeds the estimate (answer × unit price). */
export function UnitPriceSetting({
  question,
  onChange,
  currency,
}: {
  question: NumberQuestion;
  onChange: Patch;
  currency: string;
}) {
  const on = typeof question.unitPrice === 'number';
  return (
    <CollapsibleSection
      label="Price per unit"
      hint="Adds the answer × this price to the instant estimate, e.g. 3 windows × $450."
      summary={on ? 'On' : 'Off'}
      defaultOpen={on}
      questionId={question.id}
    >
      <Field
        label="Each one costs"
        hint={
          question.unit
            ? undefined
            : 'Tip: set “After” (e.g. windows) so the breakdown reads “Windows × 3”.'
        }
      >
        <PriceInputs
          low={question.unitPrice}
          high={question.unitPriceMax}
          currency={currency}
          label="Price per unit"
          onChange={(unitPrice, unitPriceMax) =>
            onChange({ unitPrice, unitPriceMax } as Partial<Question>)
          }
        />
      </Field>
    </CollapsibleSection>
  );
}

const MODE_OPTIONS: ReadonlyArray<{ value: ContactFieldMode; label: string }> = [
  { value: 'required', label: 'Required' },
  { value: 'optional', label: 'Optional' },
  { value: 'off', label: 'Off' },
];

const CONTACT_ROWS: ReadonlyArray<{ field: ContactField; label: string }> = [
  { field: 'name', label: 'Name' },
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Phone' },
];

/** Contact block: which parts show and which must be filled. */
export function ContactSettings({
  question,
  onChange,
}: {
  question: ContactInfoQuestion;
  onChange: Patch;
}) {
  const allOff = CONTACT_ROWS.every((r) => contactMode(question, r.field) === 'off');
  return (
    <>
      <div className="slate-contact-modes" role="group" aria-label="Contact fields">
        {CONTACT_ROWS.map((row) => (
          <label key={row.field} className="slate-contact-mode">
            <span className="slate-label">{row.label}</span>
            <SlateSelect
              value={contactMode(question, row.field)}
              options={MODE_OPTIONS}
              aria-label={`${row.label} field`}
              onChange={(mode) =>
                onChange({
                  fields: { ...question.fields, [row.field]: mode },
                } as Partial<Question>)
              }
            />
          </label>
        ))}
      </div>
      {allOff ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          Turn on at least one field.
        </p>
      ) : (
        <p className="slate-help">
          Phones fill all three in one tap from the respondent’s own contact card.
        </p>
      )}
      {contactMode(question, 'phone') !== 'off' ? (
        <Field label="Default Country (ISO 3166-1 Alpha-2)">
          <input
            className="slate-input"
            value={question.defaultCountry ?? 'US'}
            maxLength={2}
            onChange={(e) =>
              onChange({ defaultCountry: e.target.value.toUpperCase() } as Partial<Question>)
            }
          />
        </Field>
      ) : null}
    </>
  );
}

/** Address: parts, format, and the service-area check. */
export function AddressSettings({
  question,
  onChange,
  onAddOutOfAreaEnding,
  hasOutOfAreaRoute,
}: {
  question: AddressQuestion;
  onChange: Patch;
  /** Adds an "out of area" ending and a jump to it (ADR-064). */
  onAddOutOfAreaEnding?: () => void;
  /** Some ending or jump already tests this question's area. */
  hasOutOfAreaRoute: boolean;
}) {
  const [areaText, setAreaText] = useState((question.serviceArea ?? []).join(', '));
  useEffect(() => setAreaText((question.serviceArea ?? []).join(', ')), [question.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const entries = parseServiceAreaText(areaText);
  const kept = serviceAreaPrefixes(entries);
  const bad = entries.length - kept.length;
  const us = (question.format ?? 'us') === 'us';
  return (
    <>
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required"
      />
      <Checkbox
        checked={question.line2 !== false}
        onChange={(v) => onChange({ line2: v ? undefined : false } as Partial<Question>)}
        label="Apt / Unit Line"
      />
      <Checkbox
        checked={question.country === true}
        onChange={(v) => onChange({ country: v || undefined } as Partial<Question>)}
        label="Ask for the Country"
      />
      <Field label="Format">
        <SlateSelect
          value={us ? 'us' : 'international'}
          options={[
            { value: 'us', label: 'US (State, ZIP code)' },
            { value: 'international', label: 'International (region, postal code)' },
          ]}
          aria-label="Address format"
          onChange={(format) =>
            onChange({ format: format === 'us' ? undefined : format } as Partial<Question>)
          }
        />
      </Field>
      <CollapsibleSection
        label="Service area"
        hint={`List the ${us ? 'ZIP codes' : 'postal codes'} you serve. A prefix covers a range: 931 means 93101–93199. Responses show who's outside; an ending can catch them.`}
        summary={
          kept.length ? `${kept.length} ${kept.length === 1 ? 'code' : 'codes'}` : 'Anywhere'
        }
        defaultOpen={kept.length > 0}
        questionId={question.id}
      >
        <Field
          label={us ? 'ZIP codes or prefixes' : 'Postal codes or prefixes'}
          hint={
            bad > 0
              ? `${bad} ${bad === 1 ? 'entry isn’t' : 'entries aren’t'} a code — letters and numbers only.`
              : `Separate with commas or new lines. Up to ${SERVICE_AREA_MAX}.`
          }
        >
          <textarea
            className="slate-textarea"
            rows={3}
            value={areaText}
            spellCheck={false}
            placeholder={us ? '93101, 93103, 931*' : 'V6B, V5K'}
            aria-invalid={bad > 0 ? true : undefined}
            onChange={(e) => {
              setAreaText(e.target.value);
              const list = parseServiceAreaText(e.target.value);
              onChange({ serviceArea: list.length ? list : undefined } as Partial<Question>);
            }}
          />
        </Field>
        {kept.length > 0 && onAddOutOfAreaEnding ? (
          hasOutOfAreaRoute ? (
            <p className="slate-help">An ending already catches addresses outside the area.</p>
          ) : (
            <button
              type="button"
              className="slate-btn slate-btn--ghost slate-btn--compact"
              onClick={onAddOutOfAreaEnding}
            >
              <span className="slate-btn-plus">+</span> Add an “out of area” ending
            </button>
          )
        ) : null}
      </CollapsibleSection>
    </>
  );
}

/** Signature: required, the typed-name option, consent copy. */
export function SignatureSettings({
  question,
  onChange,
}: {
  question: SignatureQuestion;
  onChange: Patch;
}) {
  return (
    <>
      <Field
        label="Agreement Copy (Optional)"
        hint="Shown above the pad, e.g. what they're agreeing to."
      >
        <textarea
          className="slate-textarea"
          rows={3}
          value={question.body ?? ''}
          onChange={(e) => onChange({ body: e.target.value || undefined } as Partial<Question>)}
        />
      </Field>
      <Checkbox
        checked={Boolean(question.required)}
        onChange={(v) => onChange({ required: v } as Partial<Question>)}
        label="Required"
      />
      <Checkbox
        checked={question.allowTyped !== false}
        onChange={(v) => onChange({ allowTyped: v ? undefined : false } as Partial<Question>)}
        label="Let Them Type Their Name Instead"
      />
      {question.allowTyped === false ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          Keyboard and screen-reader users can’t draw. Leave typing on unless you need ink.
        </p>
      ) : (
        <p className="slate-help">For people who can’t draw with a finger or mouse.</p>
      )}
    </>
  );
}

/** The instant estimate on an ending, plus the form-wide estimate settings. */
export function EstimateSection({
  question,
  onChange,
  allQuestions,
  settings,
  onSettingsChange,
}: {
  question: Extract<Question, { type: 'thanks' }>;
  onChange: Patch;
  allQuestions: ReadonlyArray<Question>;
  settings: EstimateSettings | undefined;
  onSettingsChange: (next: EstimateSettings | undefined) => void;
}) {
  const on = Boolean(question.showEstimate);
  const priced = hasPricing({ questions: allQuestions, estimate: settings });
  const currency = estimateCurrency(settings);
  const set = (patch: Partial<EstimateSettings>) => {
    const next: EstimateSettings = { ...settings, ...patch };
    for (const k of Object.keys(next) as Array<keyof EstimateSettings>) {
      if (next[k] === undefined || next[k] === '') delete next[k];
    }
    onSettingsChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <CollapsibleSection
      label="Instant estimate"
      hint="Show a price range from the prices on their answers. You always see it in Responses."
      summary={on ? 'Shown' : 'Hidden'}
      defaultOpen={on}
      questionId={question.id}
    >
      <Checkbox
        checked={on}
        onChange={(v) => onChange({ showEstimate: v || undefined } as Partial<Question>)}
        label="Show the Estimate on This Ending"
      />
      {!priced ? (
        <p className="slate-help" style={{ color: 'var(--slate-warn)' }}>
          Nothing has a price yet. Add prices to choice options, a price per unit on a number, or a
          base price below.
        </p>
      ) : null}
      <Field label="Currency">
        <SlateSelect
          value={currency}
          options={
            CURRENCIES.some((c) => c.value === currency)
              ? CURRENCIES
              : [...CURRENCIES, { value: currency, label: currency }]
          }
          aria-label="Currency"
          onChange={(c) => set({ currency: c === 'USD' ? undefined : c })}
        />
      </Field>
      <Field
        label="Base price (optional)"
        hint="Added to every estimate — a service call, a minimum."
      >
        <PriceInputs
          low={settings?.base}
          high={settings?.baseMax}
          currency={currency}
          label="Base price"
          onChange={(base, baseMax) => set({ base, baseMax })}
        />
      </Field>
      {typeof settings?.base === 'number' ? (
        <Field label="Base line label">
          <input
            className="slate-input"
            value={settings?.baseLabel ?? ''}
            placeholder="Base price"
            maxLength={60}
            onChange={(e) => set({ baseLabel: e.target.value || undefined })}
          />
        </Field>
      ) : null}
      <Row>
        <Field label="Heading">
          <input
            className="slate-input"
            value={settings?.label ?? ''}
            placeholder="Your estimate"
            maxLength={60}
            onChange={(e) => set({ label: e.target.value || undefined })}
          />
        </Field>
        <Field label="Small print">
          <input
            className="slate-input"
            value={settings?.disclaimer ?? ''}
            placeholder="Final price after inspection"
            maxLength={200}
            onChange={(e) => set({ disclaimer: e.target.value || undefined })}
          />
        </Field>
      </Row>
      <Checkbox
        checked={Boolean(settings?.breakdown)}
        onChange={(v) => set({ breakdown: v || undefined })}
        label="Show a Line per Priced Answer"
      />
      <p className="slate-help">
        Settings apply to every ending that shows the estimate. Put {'{{estimate}}'} in any title to
        say it in words.
      </p>
    </CollapsibleSection>
  );
}

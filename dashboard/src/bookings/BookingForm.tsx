import { useMemo, useState, type FormEvent } from "react";

import type { Booking, BookingInput, Target } from "../../../src/bookings/types";
import { BOOKING_STATUSES } from "../../../src/bookings/types";
import { createBooking } from "./api";
import { currentIsoMonth, STATUS_LABELS } from "./format";

/**
 * Deal entry form — replaces the sheet's country scouting tabs. New entries
 * default to `pipeline`; move them along the status pipeline from the table.
 */

interface BookingFormProps {
  targets: Target[];
  onCreated: (booking: Booking) => void;
}

interface FormState {
  channelName: string;
  channelUrl: string;
  platform: string;
  country: string;
  cm: string;
  vertical: string;
  category: string;
  month: string;
  status: (typeof BOOKING_STATUSES)[number];
  activation: string;
  numActivations: string;
  intBudget: string;
  extBudget: string;
  currency: "EUR" | "USD" | "GBP";
  contractSigned: boolean;
  publishedAt: string;
  note: string;
}

const PLATFORMS = ["youtube", "instagram", "tiktok", "twitch", "other"];
const VERTICALS = [
  "gaming",
  "entertainment",
  "lifestyle",
  "finance",
  "tech",
  "asmr",
  "education",
  "sports",
];
const CATEGORIES = ["integration", "dedicated", "shorts", "stream", "post"];

/** Client-facing price convention: EXT = INT / 0.8. */
function extFromInt(intBudget: string): string {
  const value = Number(intBudget);
  return intBudget !== "" && Number.isFinite(value) ? String(Math.round(value / 0.8)) : "";
}

function emptyForm(): FormState {
  return {
    channelName: "",
    channelUrl: "",
    platform: "youtube",
    country: "",
    cm: "",
    vertical: "",
    category: "",
    month: currentIsoMonth(),
    status: "pipeline",
    activation: "",
    numActivations: "",
    intBudget: "",
    extBudget: "",
    currency: "EUR",
    contractSigned: false,
    publishedAt: "",
    note: "",
  };
}

function toInput(form: FormState): BookingInput {
  const numberOrNull = (value: string) => (value === "" ? null : Number(value));
  return {
    channelName: form.channelName.trim(),
    channelUrl: form.channelUrl.trim() || null,
    platform: form.platform || null,
    country: form.country.trim().toUpperCase() || null,
    cm: form.cm.trim() || null,
    vertical: form.vertical.trim().toLowerCase() || null,
    category: form.category.trim().toLowerCase() || null,
    month: form.month || null,
    status: form.status,
    activation: form.activation.trim() || null,
    numActivations: numberOrNull(form.numActivations),
    intBudget: numberOrNull(form.intBudget),
    extBudget: numberOrNull(form.extBudget),
    currency: form.currency,
    contractSigned: form.contractSigned,
    publishedAt: form.publishedAt || null,
    note: form.note.trim() || null,
  };
}

export function BookingForm({ targets, onCreated }: BookingFormProps) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [extTouched, setExtTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cms = useMemo(() => [...new Set(targets.map((t) => t.cm))].sort(), [targets]);
  const markets = useMemo(() => [...new Set(targets.map((t) => t.market))].sort(), [targets]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setIntBudget = (value: string) =>
    setForm((current) => ({
      ...current,
      intBudget: value,
      extBudget: extTouched ? current.extBudget : extFromInt(value),
    }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const booking = await createBooking(toInput(form));
      setForm(emptyForm());
      setExtTouched(false);
      onCreated(booking);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the booking");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="panel booking-form" onSubmit={(event) => void submit(event)}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">New entry</p>
          <h2>Add a creator deal</h2>
        </div>
        <p className="tier-note">Scouted creators start in Pipeline; EXT price auto-fills at INT ÷ 0.8</p>
      </div>

      {error && <div className="inline-error" role="alert">{error}</div>}

      <div className="form-grid">
        <label className="span-2">
          <span>Channel name *</span>
          <input
            required
            value={form.channelName}
            placeholder="ASMR Fixy"
            onChange={(event) => set("channelName", event.target.value)}
          />
        </label>
        <label className="span-2">
          <span>Channel URL</span>
          <input
            type="url"
            value={form.channelUrl}
            placeholder="https://youtube.com/@channel"
            onChange={(event) => set("channelUrl", event.target.value)}
          />
        </label>
        <label>
          <span>Platform</span>
          <select value={form.platform} onChange={(event) => set("platform", event.target.value)}>
            {PLATFORMS.map((platform) => (
              <option key={platform} value={platform}>
                {platform.charAt(0).toUpperCase() + platform.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Market</span>
          <input
            list="booking-markets"
            value={form.country}
            placeholder="PL"
            onChange={(event) => set("country", event.target.value)}
          />
          <datalist id="booking-markets">
            {markets.map((market) => <option key={market} value={market} />)}
          </datalist>
        </label>
        <label>
          <span>CM</span>
          <input
            list="booking-cms"
            value={form.cm}
            placeholder="Lucija P"
            onChange={(event) => set("cm", event.target.value)}
          />
          <datalist id="booking-cms">
            {cms.map((cm) => <option key={cm} value={cm} />)}
          </datalist>
        </label>
        <label>
          <span>Vertical</span>
          <input
            list="booking-verticals"
            value={form.vertical}
            placeholder="gaming"
            onChange={(event) => set("vertical", event.target.value)}
          />
          <datalist id="booking-verticals">
            {VERTICALS.map((vertical) => <option key={vertical} value={vertical} />)}
          </datalist>
        </label>
        <label>
          <span>Category</span>
          <input
            list="booking-categories"
            value={form.category}
            placeholder="integration"
            onChange={(event) => set("category", event.target.value)}
          />
          <datalist id="booking-categories">
            {CATEGORIES.map((category) => <option key={category} value={category} />)}
          </datalist>
        </label>
        <label>
          <span>Target month</span>
          <input type="month" value={form.month} onChange={(event) => set("month", event.target.value)} />
        </label>
        <label>
          <span>Status</span>
          <select
            value={form.status}
            onChange={(event) => set("status", event.target.value as FormState["status"])}
          >
            {BOOKING_STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Activation</span>
          <input
            value={form.activation}
            placeholder="1x YTI"
            onChange={(event) => set("activation", event.target.value)}
          />
        </label>
        <label>
          <span># Activations</span>
          <input
            type="number"
            min="0"
            step="1"
            value={form.numActivations}
            onChange={(event) => set("numActivations", event.target.value)}
          />
        </label>
        <label>
          <span>Currency</span>
          <select
            value={form.currency}
            onChange={(event) => set("currency", event.target.value as FormState["currency"])}
          >
            <option value="EUR">EUR €</option>
            <option value="USD">USD $</option>
            <option value="GBP">GBP £</option>
          </select>
        </label>
        <label>
          <span>INT budget</span>
          <input
            type="number"
            min="0"
            step="any"
            value={form.intBudget}
            placeholder="2500"
            onChange={(event) => setIntBudget(event.target.value)}
          />
        </label>
        <label>
          <span>EXT price</span>
          <input
            type="number"
            min="0"
            step="any"
            value={form.extBudget}
            placeholder="3125"
            onChange={(event) => {
              setExtTouched(true);
              set("extBudget", event.target.value);
            }}
          />
        </label>
        <label>
          <span>Publication date</span>
          <input
            type="date"
            value={form.publishedAt}
            onChange={(event) => set("publishedAt", event.target.value)}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={form.contractSigned}
            onChange={(event) => set("contractSigned", event.target.checked)}
          />
          <span>Contract signed</span>
        </label>
        <label className="span-2">
          <span>Note</span>
          <input
            value={form.note}
            placeholder="Deal context, counteroffers, timing…"
            onChange={(event) => set("note", event.target.value)}
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="button primary" disabled={saving || !form.channelName.trim()}>
          {saving ? "Saving…" : "Add deal"}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  submitProposalAction,
  updateProposalAction,
  updateWheelAction,
  type ActionResult,
  type ProposalFormInput,
} from "@/lib/actions";
import { OTHER_LABEL, isOtherLabel } from "@/lib/format";
import { safely } from "@/lib/safely";
import { Notice } from "./ActionButton";
import {
  BASE_ICONS,
  BASE_ICON_NAMES,
  CalendarIcon,
  CheeseIcon,
  ImageIcon,
  ListPlusIcon,
  PlusIcon,
  UploadIcon,
  XIcon,
  type BaseIconName,
} from "./Icons";
import { WheelIcon, categoryLook } from "./Logo";

const CATEGORIES = ["Hack Club", "Events", "YSWS", "Hackatime", "Slack", "Tech", "Fun"];
const MAX_OUTCOMES = 30;
const ICON_PX = 128;
const MAX_ICON_CHARS = 200_000;

/** Crop an image to a centred square and shrink it to ICON_PX, as WebP (PNG where WebP can't be encoded). */
async function imageToIcon(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_PX;
  canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, ICON_PX, ICON_PX);
  bmp.close();
  const webp = canvas.toDataURL("image/webp", 0.86);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}

/** What the form edits: a new proposal, a pending one (Cheesemongers), or a live wheel (Cheesemongers). */
export type ProposeMode =
  | { kind: "propose" }
  | { kind: "proposal"; id: string }
  | { kind: "wheel"; id: string; slug: string; wedges: { id: string; label: string }[] };

export interface ProposeInitial {
  title: string;
  description: string;
  category: string | null;
  resolutionCriteria: string;
  /** Labels; one label (or none) means Yes / No. Ignored in wheel mode (it uses mode.wedges). */
  outcomes: string[];
  icon: string | null;
  /** ISO string. */
  closesAt: string | null;
  allowAdditions: boolean;
}

const PRESETS = [
  ["1d", "1 day", 1],
  ["3d", "3 days", 3],
  ["1w", "1 week", 7],
  ["2w", "2 weeks", 14],
  ["1m", "1 month", 30],
] as const;
type Preset = (typeof PRESETS)[number][0] | "custom";

/** A Date as the value a datetime-local input wants (local time, to the minute). */
function toLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ProposeForm({
  children,
  mode = { kind: "propose" },
  initial,
}: {
  children?: React.ReactNode;
  mode?: ProposeMode;
  initial?: ProposeInitial;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isWheel = mode.kind === "wheel";
  const existing = isWheel ? mode.wedges : [];
  const startMulti = isWheel ? existing.length > 1 : (initial?.outcomes.length ?? 0) > 1;

  const [kind, setKind] = useState<"binary" | "multi">(startMulti ? "multi" : "binary");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "Hack Club");
  const [criteria, setCriteria] = useState(initial?.resolutionCriteria ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Wheel mode: renames for the live outcomes. `outcomes` holds the new ones.
  const [labels, setLabels] = useState<Record<string, string>>(() => Object.fromEntries(existing.map((w) => [w.id, w.label])));
  const [outcomes, setOutcomes] = useState<string[]>(isWheel ? [] : startMulti ? initial!.outcomes : ["", ""]);
  const [icon, setIcon] = useState<string>(initial?.icon ?? ""); // "", "svg:<name>" or a data URL
  const [iconError, setIconError] = useState<string | null>(null);
  const [closes, setCloses] = useState<"request" | "date">(initial?.closesAt ? "date" : "request");
  const [preset, setPreset] = useState<Preset>(initial?.closesAt ? "custom" : "1w");
  const [custom, setCustom] = useState(initial?.closesAt ? toLocalInput(new Date(initial.closesAt)) : "");
  const [allowAdditions, setAllowAdditions] = useState(initial?.allowAdditions ?? false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const multi = kind === "multi";
  const liveLabels = existing.map((w) => (labels[w.id] ?? "").trim());
  // A wheel open to new outcomes always carries an "Other" (last), which wins if none of the listed
  // outcomes, including ones added later, do. It's added for them, so they can't forget it.
  const autoOther = multi && allowAdditions && !liveLabels.some(isOtherLabel);
  const typedOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
  const newOutcomes = autoOther ? [...typedOutcomes.filter((o) => !isOtherLabel(o)), OTHER_LABEL] : typedOutcomes;
  const allLabels = [...liveLabels, ...newOutcomes];
  const shown = allLabels.filter(Boolean);
  const dupes = new Set(shown.map((o) => o.toLowerCase())).size !== shown.length;
  const outcomeProblem = !multi
    ? null
    : liveLabels.some((l) => !l)
      ? "Outcomes can't be blank."
      : allLabels.length < 2
        ? "Add at least two outcomes."
        : dupes
          ? "Each outcome must be different."
          : null;

  const presetDays = PRESETS.find((x) => x[0] === preset)?.[2];
  const closeDate: Date | null =
    closes === "request"
      ? null
      : preset === "custom"
        ? custom
          ? new Date(custom)
          : null
        : new Date(Date.now() + (presetDays ?? 7) * 86_400_000);
  // An unchanged close time on a live wheel may already have passed; that's fine to keep.
  const closeUnchanged =
    !!initial?.closesAt && closes === "date" && preset === "custom" && custom === toLocalInput(new Date(initial.closesAt));
  const closeProblem =
    closes !== "date" || closeUnchanged
      ? null
      : !closeDate || Number.isNaN(closeDate.getTime())
        ? "Pick when it closes."
        : closeDate <= new Date()
          ? "The close time has to be in the future."
          : null;

  const canSubmit = title.trim().length > 0 && criteria.trim().length > 0 && !outcomeProblem && !closeProblem && !pending;
  const tint = categoryLook(category).tint;
  const categories = !category || CATEGORIES.includes(category) ? CATEGORIES : [...CATEGORIES, category];

  const reset = () => {
    setTitle("");
    setCriteria("");
    setDescription("");
    setOutcomes(["", ""]);
    setIcon("");
    setKind("binary");
    setCloses("request");
    setPreset("1w");
    setCustom("");
    setAllowAdditions(false);
  };

  const onFile = async (file: File | undefined) => {
    setIconError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return setIconError("Use a PNG, JPEG, WebP or GIF image.");
    if (file.size > 8 * 1024 * 1024) return setIconError("That image is over 8 MB.");
    try {
      const url = await imageToIcon(file);
      if (url.length > MAX_ICON_CHARS) return setIconError("That image is still too big after shrinking. Try a simpler one.");
      setIcon(url);
    } catch {
      setIconError("Couldn't read that image.");
    }
  };

  const setOutcome = (i: number, v: string) => setOutcomes((xs) => xs.map((x, j) => (j === i ? v : x)));
  const field =
    "w-full rounded-[10px] border border-line bg-surface-2 px-3 text-sm outline-none transition placeholder:text-faint focus:border-primary focus:bg-bg";

  const submit = () => {
    const input: ProposalFormInput = {
      title,
      description,
      category,
      resolutionCriteria: criteria,
      outcomes: multi ? (isWheel ? allLabels : newOutcomes) : [],
      icon,
      closesAt: closeDate && !Number.isNaN(closeDate.getTime()) ? closeDate.toISOString() : null,
      allowAdditions: multi && allowAdditions,
    };
    start(async () => {
      const r =
        mode.kind === "propose"
          ? await safely(submitProposalAction(input))
          : mode.kind === "proposal"
            ? await safely(updateProposalAction(mode.id, input))
            : await safely(updateWheelAction(mode.id, { ...input, labels, newOutcomes: multi ? newOutcomes : [] }));
      setResult(r);
      if (!r.ok) return;
      if (mode.kind === "propose") {
        reset();
        router.refresh();
      } else if (mode.kind === "proposal") {
        router.push("/cheesemongers?tab=proposals");
      } else {
        router.push(`/wheel/${mode.slug}`);
      }
    });
  };

  const focusOutcome = (i: number) =>
    requestAnimationFrame(() => formRef.current?.querySelectorAll<HTMLInputElement>("[data-outcome]")?.[i]?.focus());

  const outcomeRow = (opts: { key: string; value: string; index: number; onChange: (v: string) => void; onRemove?: () => void; live?: boolean }) => (
    <li key={opts.key} className="flex items-center gap-2">
      <span className="tabular w-5 text-right text-xs font-semibold text-faint">{opts.index + 1}</span>
      <input
        value={opts.value}
        onChange={(e) => opts.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (existing.length + outcomes.length < MAX_OUTCOMES) {
            const at = Math.max(0, opts.index - existing.length + 1);
            setOutcomes((xs) => [...xs.slice(0, at), "", ...xs.slice(at)]);
          }
          focusOutcome(opts.index + 1);
        }}
        data-outcome
        maxLength={80}
        placeholder={opts.index === 0 ? "Orpheus" : opts.index === 1 ? "Heidi" : "Another outcome"}
        className={`${field} h-10`}
      />
      {opts.live ? (
        <span
          className="grid h-10 w-10 shrink-0 place-items-center text-[10px] font-semibold uppercase tracking-wide text-faint"
          title="Live outcomes can be renamed, not removed"
        >
          Live
        </span>
      ) : (
        <button
          type="button"
          onClick={opts.onRemove}
          disabled={!opts.onRemove}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
          aria-label={`Remove outcome ${opts.index + 1}`}
        >
          <XIcon size={16} />
        </button>
      )}
    </li>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        ref={formRef}
        className="space-y-6 rounded-2xl bg-surface p-5 shadow-mid sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <Field label="Question" required hint="Ask about one thing, with an answer people can check." count={`${title.length}/200`}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
            placeholder="Will Hack Club ship X before Y?"
            className={`${field} h-11 text-base`}
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["binary", "Yes / No", "One question, two answers."],
                ["multi", "Multiple choice", "Several outcomes, exactly one wins."],
              ] as const
            ).map(([k, label, sub]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                disabled={isWheel && kind !== k}
                aria-pressed={kind === k}
                className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  kind === k ? "border-primary bg-primary-soft" : "border-line hover:bg-hover"
                }`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
          {isWheel && <p className="mt-1.5 text-xs text-muted">A live wheel&apos;s type can&apos;t change: people already hold its shares.</p>}
        </fieldset>

        {multi && (
          <fieldset>
            <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-semibold">
              Outcomes
              <span className="text-xs font-normal text-muted">
                {shown.length}/{MAX_OUTCOMES}
              </span>
            </legend>
            <ol className="space-y-2">
              {existing.map((w, i) =>
                outcomeRow({
                  key: w.id,
                  value: labels[w.id] ?? "",
                  index: i,
                  onChange: (v) => setLabels((m) => ({ ...m, [w.id]: v })),
                  live: true,
                }),
              )}
              {outcomes.map((o, i) =>
                outcomeRow({
                  key: `new-${i}`,
                  value: o,
                  index: existing.length + i,
                  onChange: (v) => setOutcome(i, v),
                  onRemove: isWheel || outcomes.length > 2 ? () => setOutcomes((xs) => xs.filter((_, j) => j !== i)) : undefined,
                }),
              )}
              {autoOther && (
                <li className="flex items-center gap-2">
                  <span className="tabular w-5 text-right text-xs font-semibold text-faint">{existing.length + outcomes.length + 1}</span>
                  <input value={OTHER_LABEL} readOnly aria-label="Other (added automatically)" className={`${field} h-10 text-muted`} />
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center text-[10px] font-semibold uppercase tracking-wide text-faint"
                    title="Added automatically while new outcomes are allowed"
                  >
                    Auto
                  </span>
                </li>
              )}
            </ol>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
              <button
                type="button"
                onClick={() => {
                  setOutcomes((xs) => [...xs, ""]);
                  focusOutcome(existing.length + outcomes.length);
                }}
                disabled={existing.length + outcomes.length + (autoOther ? 1 : 0) >= MAX_OUTCOMES}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-line px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <PlusIcon size={15} /> Add outcome
              </button>
              <span className={`text-xs ${outcomeProblem && shown.length ? "text-no" : "text-muted"}`}>
                {outcomeProblem && shown.length
                  ? outcomeProblem
                  : isWheel
                    ? "New outcomes go live when you save."
                    : allowAdditions
                      ? "“Other” is added for you. It wins if nothing listed (or added later) does."
                      : "Not sure the list covers everything? Turn on suggestions below and “Other” is added for you."}
              </span>
            </div>

            <Toggle
              checked={allowAdditions}
              onChange={setAllowAdditions}
              icon={<ListPlusIcon size={18} />}
              title="Let people suggest new outcomes"
              sub={
                allowAdditions
                  ? "Anyone can suggest one on the wheel's page, and a Cheesemonger approves it before it's added. An “Other” outcome is added automatically and covers anything not listed, including outcomes added later. Whole-wheel conversions stay off while this is on, since the list isn't final."
                  : "The list above is final. (Cheesemongers can still add an outcome.)"
              }
            />
          </fieldset>
        )}

        <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field label="Category" required>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} h-10 cursor-pointer`}>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Icon</legend>
            <div className="flex flex-wrap gap-1.5">
              <IconChoice selected={icon === ""} onClick={() => setIcon("")} label="Category icon">
                <WheelIcon category={category} size={34} />
              </IconChoice>
              {BASE_ICON_NAMES.map((name) => {
                const Glyph = BASE_ICONS[name as BaseIconName];
                return (
                  <IconChoice key={name} selected={icon === `svg:${name}`} onClick={() => setIcon(`svg:${name}`)} label={name}>
                    <span className="grid h-[34px] w-[34px] place-items-center rounded-lg" style={{ color: tint }}>
                      <Glyph size={20} strokeWidth={1.9} />
                    </span>
                  </IconChoice>
                );
              })}
              <IconChoice selected={icon.startsWith("data:")} onClick={() => fileRef.current?.click()} label="Upload an image">
                {icon.startsWith("data:") ? (
                  <WheelIcon icon={icon} category={category} size={34} />
                ) : (
                  <span className="grid h-[34px] w-[34px] place-items-center rounded-lg text-muted">
                    <UploadIcon size={18} />
                  </span>
                )}
              </IconChoice>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${iconError ? "text-no" : "text-muted"}`}>
              <ImageIcon size={13} />
              {iconError ?? "Pick an icon or upload a square-ish image. It's cropped and shrunk to 128px."}
            </p>
          </fieldset>
        </div>

        <Field
          label="How will it be decided?"
          required
          hint="Say exactly what makes it resolve, and where the answer will come from."
          count={`${criteria.length}/5000`}
        >
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            required
            maxLength={5000}
            rows={4}
            placeholder="Resolves Yes if … according to … Otherwise No."
            className={`${field} py-2.5 leading-6`}
          />
        </Field>

        <Field label="Context" hint="Optional background, links, or anything traders should know.">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={`${field} py-2.5 leading-6`}
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Closing</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["request", "When someone asks", "Stays open until a close request (or a Cheesemonger) settles it."],
                ["date", "On a date", "Trading stops at a set time, then it's settled."],
              ] as const
            ).map(([k, label, sub]) => (
              <button
                key={k}
                type="button"
                onClick={() => setCloses(k)}
                aria-pressed={closes === k}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  closes === k ? "border-primary bg-primary-soft" : "border-line hover:bg-hover"
                }`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
          {closes === "date" ? (
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Close after">
                {PRESETS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={preset === k}
                    onClick={() => setPreset(k)}
                    className={`h-8 rounded-lg px-3 text-xs font-semibold ${preset === k ? "bg-ink text-bg" : "bg-surface text-muted hover:text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={preset === "custom"}
                  onClick={() => {
                    if (!custom) setCustom(toLocalInput(closeDate ?? new Date(Date.now() + 7 * 86_400_000)));
                    setPreset("custom");
                  }}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ${
                    preset === "custom" ? "bg-ink text-bg" : "bg-surface text-muted hover:text-ink"
                  }`}
                >
                  <CalendarIcon size={13} /> Custom
                </button>
              </div>
              {preset === "custom" && (
                <input
                  type="datetime-local"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  className={`${field} mt-2 h-10 max-w-xs`}
                  aria-label="Close date and time"
                />
              )}
              <p className={`mt-2 text-xs ${closeProblem ? "text-no" : "text-muted"}`}>
                {closeProblem ??
                  (closeDate ? `Trading stops ${closeDate.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : "")}
              </p>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-3 rounded-xl bg-surface-2 p-3.5 text-sm">
              <CheeseIcon size={18} className="mt-0.5 shrink-0 text-accent" />
              <p className="text-muted">
                <strong className="text-ink">No close date.</strong> The wheel stays open until someone asks to close it with the
                result. A Cheesemonger then checks it and settles it.
              </p>
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            disabled={!canSubmit}
            className="btn-3d h-11 bg-primary px-6 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Saving…" : mode.kind === "propose" ? "Send to Cheesemongers" : "Save changes"}
          </button>
          {mode.kind !== "propose" && (
            <button type="button" onClick={() => router.back()} className="h-11 px-3 text-sm font-semibold text-muted hover:text-ink">
              Cancel
            </button>
          )}
          {result ? (
            <Notice result={result} />
          ) : (
            <span className="text-xs text-muted">
              {mode.kind === "propose"
                ? "A Cheesemonger checks it's clear and fair first."
                : mode.kind === "proposal"
                  ? "You're editing someone's proposal. Approve it from the queue afterwards."
                  : "Changes show on the wheel straight away."}
            </span>
          )}
        </div>
      </form>

      <aside className="space-y-6 lg:sticky lg:top-[129px] lg:self-start">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">Preview</h2>
          <Preview title={title} category={category} icon={icon} multi={multi} outcomes={shown} />
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted">
            <span className="rounded-full bg-surface-2 px-2 py-0.5">
              {closes === "request"
                ? "Closes on request"
                : closeDate && !closeProblem
                  ? `Closes ${closeDate.toLocaleDateString("en-US", { dateStyle: "medium" })}`
                  : "Close date needed"}
            </span>
            {multi && allowAdditions && <span className="rounded-full bg-surface-2 px-2 py-0.5">Open to new outcomes</span>}
          </div>
        </div>
        {children}
      </aside>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  icon,
  title,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`mt-4 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        checked ? "border-primary bg-primary-soft" : "border-line hover:bg-hover"
      }`}
    >
      <span className={`mt-0.5 ${checked ? "text-primary" : "text-muted"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
      <span aria-hidden="true" className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Field({
  label,
  required,
  hint,
  count,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3 text-sm font-semibold">
        <span>
          {label}
          {required && <span className="text-no"> *</span>}
        </span>
        {count && <span className="tabular text-xs font-normal text-faint">{count}</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function IconChoice({
  selected,
  onClick,
  label,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={label}
      title={label}
      className={`rounded-[10px] p-1 transition ${selected ? "bg-primary-soft ring-2 ring-primary" : "hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

/** What the wheel's card will roughly look like on the home page. */
function Preview({
  title,
  category,
  icon,
  multi,
  outcomes,
}: {
  title: string;
  category: string;
  icon: string;
  multi: boolean;
  outcomes: string[];
}) {
  return (
    <div className="flex min-h-[180px] flex-col justify-between rounded-xl bg-surface pt-3 shadow-soft">
      <div className="flex min-h-[42px] items-start gap-2.5 px-3">
        <WheelIcon icon={icon || null} category={category} size={38} />
        <span className={`line-clamp-2 flex-1 text-sm font-[590] leading-[18px] ${title ? "" : "text-faint"}`}>
          {title || "Your question appears here"}
        </span>
      </div>
      {!multi ? (
        <div className="flex h-[62px] items-end gap-2 px-3">
          <span className="grid h-10 flex-1 place-items-center rounded-[7px] bg-yes-soft text-sm font-semibold text-yes">Yes</span>
          <span className="grid h-10 flex-1 place-items-center rounded-[7px] bg-no-soft text-sm font-semibold text-no">No</span>
        </div>
      ) : (
        <ul className="mt-1 px-3">
          {outcomes.slice(0, 2).map((o) => (
            <li key={o} className="flex min-h-10 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-[440]">{o}</span>
              <span className="text-[15px] font-semibold text-faint">—</span>
              <span className="grid h-[27px] w-11 place-items-center rounded-[5px] bg-yes-soft text-[13px] font-semibold text-yes">Yes</span>
              <span className="grid h-[27px] w-11 place-items-center rounded-[5px] bg-no-soft text-[13px] font-semibold text-no">No</span>
            </li>
          ))}
          {outcomes.length > 2 && <li className="text-xs text-faint">+{outcomes.length - 2} more</li>}
          {outcomes.length === 0 && <li className="py-3 text-xs text-faint">Outcomes appear here</li>}
        </ul>
      )}
      <div className="flex justify-between px-3 pb-2.5 pt-2 text-[13px] text-muted">
        <span>0 Lc Vol.</span>
        <span>{category}</span>
      </div>
    </div>
  );
}

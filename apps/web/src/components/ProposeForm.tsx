"use client";

import { safely } from "@/lib/safely";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { submitProposalAction, type ActionResult } from "@/lib/actions";
import { Notice } from "./ActionButton";
import { BASE_ICONS, BASE_ICON_NAMES, CheeseIcon, ImageIcon, PlusIcon, UploadIcon, XIcon, type BaseIconName } from "./Icons";
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

export function ProposeForm({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"binary" | "multi">("binary");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Hack Club");
  const [criteria, setCriteria] = useState("");
  const [description, setDescription] = useState("");
  const [outcomes, setOutcomes] = useState<string[]>(["", ""]);
  const [icon, setIcon] = useState<string>(""); // "", "svg:<name>" or a data URL
  const [iconError, setIconError] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const cleanOutcomes = outcomes.map((o) => o.trim()).filter(Boolean);
  const dupes = new Set(cleanOutcomes.map((o) => o.toLowerCase())).size !== cleanOutcomes.length;
  const outcomeProblem =
    kind === "multi" ? (cleanOutcomes.length < 2 ? "Add at least two outcomes." : dupes ? "Each outcome must be different." : null) : null;
  const canSubmit = title.trim().length > 0 && criteria.trim().length > 0 && !outcomeProblem && !pending;
  const tint = categoryLook(category).tint;

  const reset = () => {
    setTitle("");
    setCriteria("");
    setDescription("");
    setOutcomes(["", ""]);
    setIcon("");
    setKind("binary");
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

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        ref={formRef}
        className="space-y-6 rounded-2xl bg-surface p-5 shadow-mid sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          start(async () => {
            const r = await safely(submitProposalAction({
              title,
              description,
              category,
              resolutionCriteria: criteria,
              outcomes: kind === "multi" ? cleanOutcomes : [],
              icon,
            }));
            setResult(r);
            if (r.ok) {
              reset();
              router.refresh();
            }
          });
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
                aria-pressed={kind === k}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  kind === k ? "border-primary bg-primary-soft" : "border-line hover:bg-hover"
                }`}
              >
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted">{sub}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {kind === "multi" && (
          <fieldset>
            <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-semibold">
              Outcomes
              <span className="text-xs font-normal text-muted">
                {cleanOutcomes.length}/{MAX_OUTCOMES}
              </span>
            </legend>
            <ol className="space-y-2">
              {outcomes.map((o, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="tabular w-5 text-right text-xs font-semibold text-faint">{i + 1}</span>
                  <input
                    value={o}
                    onChange={(e) => setOutcome(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (outcomes.length < MAX_OUTCOMES) setOutcomes((xs) => [...xs.slice(0, i + 1), "", ...xs.slice(i + 1)]);
                        requestAnimationFrame(() => {
                          const inputs = formRef.current?.querySelectorAll<HTMLInputElement>("[data-outcome]");
                          inputs?.[i + 1]?.focus();
                        });
                      }
                    }}
                    data-outcome
                    maxLength={80}
                    placeholder={i === 0 ? "Orpheus" : i === 1 ? "Heidi" : "Another outcome"}
                    className={`${field} h-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setOutcomes((xs) => xs.filter((_, j) => j !== i))}
                    disabled={outcomes.length <= 2}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-muted hover:bg-hover hover:text-ink disabled:opacity-30"
                    aria-label={`Remove outcome ${i + 1}`}
                  >
                    <XIcon size={16} />
                  </button>
                </li>
              ))}
            </ol>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
              <button
                type="button"
                onClick={() => setOutcomes((xs) => [...xs, ""])}
                disabled={outcomes.length >= MAX_OUTCOMES}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-line px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-ink disabled:opacity-40"
              >
                <PlusIcon size={15} /> Add outcome
              </button>
              <span className={`text-xs ${outcomeProblem && cleanOutcomes.length ? "text-no" : "text-muted"}`}>
                {outcomeProblem && cleanOutcomes.length ? outcomeProblem : "Add an “Other” if the list might not cover it."}
              </span>
            </div>
          </fieldset>
        )}

        <div className="grid gap-6 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field label="Category" required>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${field} h-10 cursor-pointer`}>
              {CATEGORIES.map((c) => (
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

        <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3.5 text-sm">
          <CheeseIcon size={18} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-muted">
            <strong className="text-ink">No close date needed.</strong> Your wheel stays open until you (or a Cheesemonger) ask
            to close it with the result. A Cheesemonger then checks it and settles it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
          <button
            disabled={!canSubmit}
            className="btn-3d h-11 bg-primary px-6 text-sm font-bold text-white hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Sending…" : "Send to Cheesemongers"}
          </button>
          {result ? <Notice result={result} /> : <span className="text-xs text-muted">A Cheesemonger checks it&apos;s clear and fair first.</span>}
        </div>
      </form>

      <aside className="space-y-6 lg:sticky lg:top-[129px] lg:self-start">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-muted">Preview</h2>
          <Preview title={title} category={category} icon={icon} multi={kind === "multi"} outcomes={cleanOutcomes} />
        </div>
        {children}
      </aside>
    </div>
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
  const binary = !multi;
  return (
    <div className="flex min-h-[180px] flex-col justify-between rounded-xl bg-surface pt-3 shadow-soft">
      <div className="flex min-h-[42px] items-start gap-2.5 px-3">
        <WheelIcon icon={icon || null} category={category} size={38} />
        <span className={`line-clamp-2 flex-1 text-sm font-[590] leading-[18px] ${title ? "" : "text-faint"}`}>
          {title || "Your question appears here"}
        </span>
      </div>
      {binary ? (
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
        <span>ʟ0 Vol.</span>
        <span>{category}</span>
      </div>
    </div>
  );
}

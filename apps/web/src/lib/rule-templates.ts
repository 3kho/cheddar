/**
 * Resolution-rule outlines in the shape Polymarket uses: how it resolves,
 * when that is read, which source counts, and the edge cases.
 * The maker edits every line. Dates from the form are filled in when we have them.
 */

export const RULE_TEMPLATES = [
  { id: "yes-no", label: "Yes / No", blurb: "Yes if it happens. Otherwise No." },
  { id: "by-date", label: "By a deadline", blurb: "Yes only if it has happened by 11:59 PM ET." },
  { id: "date-ladder", label: "Date ladder", blurb: "Each date resolves on its own. Later dates can be Yes while earlier ones are No." },
  { id: "one-winner", label: "One winner", blurb: "Several outcomes. Exactly one resolves Yes." },
  { id: "announcement", label: "Announcement", blurb: "Yes only when the organizer posts it." },
] as const;

export type RuleTemplateId = (typeof RULE_TEMPLATES)[number]["id"];

export interface RuleContext {
  title: string;
  dates: { label: string; when: string }[];
  /** Display line for the close time, or null when the wheel stays open until someone asks. */
  closes: string | null;
}

function subject(title: string): string {
  const t = title.trim().replace(/\?+$/, "");
  return t ? `“${t}”` : "……";
}

function deadline(ctx: RuleContext): string {
  return ctx.closes ? ` The end date is ${ctx.closes}.` : "";
}

function dateLines(ctx: RuleContext): string {
  if (ctx.dates.length === 0) return "- By ……\n- By ……";
  return ctx.dates.map((d) => `- ${d.label} (${d.when})`).join("\n");
}

export function fillRuleTemplate(id: RuleTemplateId, ctx: RuleContext): string {
  const what = subject(ctx.title);
  if (id === "yes-no") {
    return `Resolution
This market will resolve to "Yes" if this happens: ${what}. Otherwise, this market will resolve to "No".

Timeframe
The outcome is read at 11:59 PM ET.${deadline(ctx)} If the source has not published by then, the market still resolves on what that source says about the end date, once a Cheesemonger can read it.

Source
The resolution source for this market is ……. Anything that source does not report does not count. Unofficial posts, rumors, and replies do not count.

Edge cases
If the event is canceled and not rescheduled before the end date, this market resolves to "No". If the source is ambiguous, the Cheesemongers follow the plain reading of these rules and say so in the proof.`;
  }
  if (id === "by-date") {
    return `Resolution
This market will resolve to "Yes" if this has happened by 11:59 PM ET: ${what}. Otherwise, this market will resolve to "No".

Timeframe
Only what has happened by 11:59 PM ET counts. Anything later does not.${deadline(ctx)}

Source
The resolution source for this market is ……. Anything that source does not report does not count.

Edge cases
If it happens exactly at 11:59 PM ET, this market resolves to "Yes". If the event is canceled and not rescheduled by the deadline, this market resolves to "No".`;
  }
  if (id === "date-ladder") {
    return `Resolution
This market is a ladder of dates. Each date resolves on its own.

An outcome resolves to "Yes" if the event has happened by 11:59 PM ET on that date. It resolves to "No" if the event has not happened by then. A later date can resolve to "Yes" while an earlier date resolves to "No".

The event is: ${what}.

Dates, earliest first:
${dateLines(ctx)}

If the event falls exactly on a listed date, that date resolves to "Yes".

Timeframe
A date stops trading once 11:59 PM ET on that date has passed. Dates that are still ahead stay open. Each date is settled from the source after it passes, not before.

Source
The resolution source for this market is …….

Edge cases
The clock is Eastern Time. If the source gives a date and no time, it counts for that whole calendar day. If the event is canceled, dates that have not been reached resolve to "No".`;
  }
  if (id === "one-winner") {
    return `Resolution
This market will resolve to the one outcome that matches ${what}. Exactly one outcome resolves to "Yes". Every other outcome resolves to "No".

Timeframe
The outcome is read at 11:59 PM ET.${deadline(ctx)} If the result is not known by then, the market waits for the source and still uses that end date.

Source
The resolution source for this market is …….

Edge cases
If the source names none of these outcomes, the Cheesemongers void the wheel and every share pays half. If the source names more than one, they follow the source's primary result. If the event is canceled, the wheel is voided the same way.`;
  }
  return `Resolution
This market will resolve to "Yes" if an official post announces ${what}. Otherwise, this market will resolve to "No".

Timeframe
A post counts when it is public by 11:59 PM ET.${deadline(ctx)} A draft, a scheduled post that has not gone out, or a private message does not count.

Source
The resolution source is the organizer's official post. Name it here: …….

Edge cases
Rumors, replies, screenshots, and unofficial reposts do not count. An edit after the deadline does not change a post that was already public, and it does not make a late post count.`;
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  dateLadder,
  dateProblems,
  datesForSubmit,
  draftFromStored,
  easternTime,
  matchDate,
  outcomeMatchesEvent,
  phraseFor,
} from "../src/lib/market-dates.ts";
import { fillRuleTemplate } from "../src/lib/rule-templates.ts";

/** Wednesday, Nov 25, 2026, 15:00 ET (EST, UTC-5). */
const NOW = easternTime(2026, 11, 25, 15, 0);

function at(input: string, now = NOW) {
  const m = matchDate(input, now);
  assert.ok(m, input);
  return m;
}

test("matches a named day at 11:59 PM ET, rolling the year forward", () => {
  const m = at("March 31");
  assert.equal(m.date.toISOString(), easternTime(2027, 3, 31, 23, 59).toISOString());
  assert.equal(m.label, "By Mar 31, 2027");
  assert.equal(m.when, "Mar 31, 2027 · 11:59 PM ET");
  assert.equal(at("Mar 31, 2027").date.toISOString(), m.date.toISOString());
  assert.equal(at("31 March 2027").date.toISOString(), m.date.toISOString());
  assert.equal(at("3/31/2027").date.toISOString(), m.date.toISOString());
  assert.equal(at("2027-03-31").date.toISOString(), m.date.toISOString());
  assert.equal(at("by March 31st").date.toISOString(), m.date.toISOString());
});

test("end of a month and a quarter land on the last day", () => {
  assert.equal(at("end of June").date.toISOString(), easternTime(2027, 6, 30, 23, 59).toISOString());
  assert.equal(at("June 2027").date.toISOString(), easternTime(2027, 6, 30, 23, 59).toISOString());
  assert.equal(at("Q2 2027").date.toISOString(), easternTime(2027, 6, 30, 23, 59).toISOString());
  assert.equal(at("Q4").date.toISOString(), easternTime(2026, 12, 31, 23, 59).toISOString());
  assert.equal(at("end of this month").date.toISOString(), easternTime(2026, 11, 30, 23, 59).toISOString());
});

test("keeps a clock the maker typed, in Eastern Time", () => {
  const m = at("June 30, 2027 3:00 PM");
  assert.equal(m.date.toISOString(), easternTime(2027, 6, 30, 15, 0).toISOString());
  assert.equal(m.when, "Jun 30, 2027 · 3:00 PM ET");
  assert.equal(phraseFor(m.date), "Jun 30, 2027 3:00 PM");
  assert.equal(matchDate(phraseFor(m.date), NOW)?.date.toISOString(), m.date.toISOString());
});

test("relative dates count from today in Eastern Time", () => {
  assert.equal(at("tomorrow").date.toISOString(), easternTime(2026, 11, 26, 23, 59).toISOString());
  assert.equal(at("in 2 weeks").date.toISOString(), easternTime(2026, 12, 9, 23, 59).toISOString());
  assert.equal(at("next Friday").date.toISOString(), easternTime(2026, 11, 27, 23, 59).toISOString());
  assert.equal(at("Friday").date.toISOString(), easternTime(2026, 11, 27, 23, 59).toISOString());
});

test("11:59 PM respects daylight saving", () => {
  assert.equal(easternTime(2027, 3, 31, 23, 59).toISOString(), "2027-04-01T03:59:00.000Z");
  assert.equal(easternTime(2027, 1, 31, 23, 59).toISOString(), "2027-02-01T04:59:00.000Z");
});

test("rejects text that is not a date", () => {
  assert.equal(matchDate(""), null);
  assert.equal(matchDate("Orpheus"), null);
  assert.equal(matchDate("February 31, 2027"), null);
});

test("ladders skip dates that have already passed", () => {
  assert.deepEqual(
    dateLadder("months", NOW).map((d) => d.label),
    ["By Nov 30, 2026", "By Dec 31, 2026", "By Jan 31, 2027", "By Feb 28, 2027"],
  );
  assert.deepEqual(
    dateLadder("quarters", NOW).map((d) => d.label),
    ["By Dec 31, 2026", "By Mar 31, 2027", "By Jun 30, 2027", "By Sep 30, 2027"],
  );
  assert.equal(dateLadder("year", NOW)[0]?.label, "By Dec 31, 2026");
});

test("a stored date round-trips until the maker retypes it", () => {
  const iso = easternTime(2027, 3, 31, 23, 59).toISOString();
  const row = draftFromStored("a", "By Mar 31, 2027", iso);
  const [saved] = datesForSubmit([row], NOW);
  assert.equal(saved?.iso, iso);
  assert.equal(saved?.label, "By Mar 31, 2027");
});

test("two dates are required, and the same day cannot be listed twice", () => {
  const one = [{ id: "a", text: "March 31", label: "", pinned: false, lockedIso: null }];
  assert.match(dateProblems(one, NOW) ?? "", /at least two/);
  const same = [
    { id: "a", text: "March 31, 2027", label: "", pinned: false, lockedIso: null },
    { id: "b", text: "2027-03-31", label: "", pinned: false, lockedIso: null },
  ];
  assert.match(dateProblems(same, NOW) ?? "", /same date/);
  const ok = [
    ...same.slice(0, 1),
    { id: "b", text: "end of June 2027", label: "", pinned: false, lockedIso: null },
  ];
  assert.equal(dateProblems(ok, NOW), null);
  assert.deepEqual(
    datesForSubmit(ok, NOW).map((d) => d.label),
    ["By Mar 31, 2027", "By Jun 30, 2027"],
  );
});

test("an event date matches every outcome on or after it", () => {
  const march = easternTime(2027, 3, 31, 23, 59);
  const june = easternTime(2027, 6, 30, 23, 59);
  const event = easternTime(2027, 4, 2, 23, 59);
  assert.equal(outcomeMatchesEvent(march.toISOString(), event), false);
  assert.equal(outcomeMatchesEvent(june.toISOString(), event), true);
  assert.equal(outcomeMatchesEvent(null, event), null);
});

test("the date-ladder rules list the matched dates", () => {
  const text = fillRuleTemplate("date-ladder", {
    title: "Will a new YSWS ship?",
    dates: [
      { label: "By Mar 31, 2027", when: "Mar 31, 2027 · 11:59 PM ET" },
      { label: "By Jun 30, 2027", when: "Jun 30, 2027 · 11:59 PM ET" },
    ],
    closes: null,
  });
  assert.match(text, /Resolution/);
  assert.match(text, /Source/);
  assert.match(text, /Edge cases/);
  assert.match(text, /11:59 PM ET/);
  assert.match(text, /By Mar 31, 2027 \(Mar 31, 2027 · 11:59 PM ET\)/);
  assert.match(text, /later date can resolve to "Yes"/);
  assert.match(text, /“Will a new YSWS ship”/);
});

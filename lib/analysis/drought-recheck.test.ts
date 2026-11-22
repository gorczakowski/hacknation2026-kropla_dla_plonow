import assert from "node:assert/strict";
import { it } from "node:test";
import { planDroughtRecheck } from "./drought-recheck";
import type { MeteoMonthlyHistory } from "./values";

const history: MeteoMonthlyHistory = {
  fromYear: 2016,
  toYear: 2025,
  months: [
    { month: 6, yearsWithData: 8, deficitYears: 5, medianBalance: -25 },
    { month: 2, yearsWithData: 10, deficitYears: 8, medianBalance: -15 },
    { month: 4, yearsWithData: 10, deficitYears: 7, medianBalance: -50 }
  ]
};

it("plans two weeks before the earliest upcoming recurring deficit month", () => {
  const spring = planDroughtRecheck("2026-02-20", history);
  assert.equal(spring.date, "2026-03-18");
  assert.equal(spring.risk?.month, 4);
  assert.equal(spring.risk?.withLeadTime, true);

  const summer = planDroughtRecheck("2026-05-01", history);
  assert.equal(summer.date, "2026-05-18");
  assert.equal(summer.risk?.month, 6);
  assert.equal(summer.risk?.yearsWithData, 8);
});

it("uses the following year's season once the remaining risk months have passed", () => {
  const plan = planDroughtRecheck("2026-11-22", history);
  assert.equal(plan.date, "2027-03-18");
  assert.equal(plan.risk?.year, 2027);
});

it("recommends the following day when the preparation date has arrived or the month has started", () => {
  assert.deepEqual(
    ["2026-03-18", "2026-03-20", "2026-04-15"].map(generatedOn => {
      const plan = planDroughtRecheck(generatedOn, history);
      return [plan.date, plan.risk?.month, plan.risk?.withLeadTime];
    }),
    [["2026-03-19", 4, false], ["2026-03-21", 4, false], ["2026-04-16", 4, false]]
  );
});

it("falls back to one week when there is insufficient history or no majority", () => {
  assert.deepEqual(planDroughtRecheck("2026-12-28"), { date: "2027-01-04", risk: null });
  assert.deepEqual(planDroughtRecheck("2026-03-01", {
    ...history,
    months: [
      { month: 4, yearsWithData: 5, deficitYears: 5, medianBalance: -35 },
      { month: 5, yearsWithData: 10, deficitYears: 5, medianBalance: -15 }
    ]
  }), { date: "2026-03-08", risk: null });
});

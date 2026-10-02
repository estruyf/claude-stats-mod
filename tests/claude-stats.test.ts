import { describe, expect, mock, test } from "claude-code/testing";

// 2 Oct 2026, 12:00 local time: ccusage's "today" is a local date.
const NOON = new Date(2026, 9, 2, 12, 0).getTime();
const MIN = 60_000;

const CCUSAGE = {
  daily: [
    { period: "2026-10-01", totalCost: 41.25 },
    { period: "2026-10-02", totalCost: 1.25 },
  ],
  totals: { totalCost: 42.5 },
};

function stubWorld(on: any, { cost = 0.1 } = {}) {
  const clock = mock.clock(on, { now: NOON });
  const runs: string[][] = [];
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("session.usage", () => ({
    value: {
      context: { tokens: 1_000, window: 200_000, percent: 1 },
      rateLimits: [
        { kind: "five_hour", percentUsed: 14, resetsAt: new Date(NOON + 67 * MIN).toISOString() },
        { kind: "seven_day", percentUsed: 83, resetsAt: new Date(NOON + 227 * MIN).toISOString() },
      ],
      cost: { usd: cost },
    },
  }));
  on("process.run", ($: any, e: any) => {
    runs.push([...e.argv]);
    return { value: { exitCode: 0, stdout: JSON.stringify(CCUSAGE), stderr: "" } };
  });
  on("turn.complete", () => ({ text: "" }));
  return { clock, runs };
}

async function mountBand($: any, surface: "desktop" | "terminal", bodyColumns = 120) {
  return $.ui.mount({
    plugin: "claude-stats",
    surface,
    component: "AbovePrompt",
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns },
  } as any);
}

describe("claude-stats", () => {
  test("desktop draws a ring per limit and the ccusage spend", async ($, on) => {
    const { clock, runs } = stubWorld(on);
    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    await clock.settle();

    expect(runs[0]).toEqual(["npx", "-y", "ccusage@latest", "daily", "--json", "--offline", "--since", "20261001"]);

    const ui = await mountBand($, "desktop");
    expect(await ui.findAll({ type: "Svg" })).toHaveLength(3);
    expect(await ui.find({ type: "Text", text: "14%" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "5h · resets 1h7m" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "83%" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "7d · resets 3h47m" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "$0.10" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: "$1.25 today · $42.50 mo" })).toBeDefined();
    await ui.unmount();
  });

  test("the reset countdown ticks down without a turn", async ($, on) => {
    const { clock } = stubWorld(on);
    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    await clock.settle();
    const ui = await mountBand($, "desktop");

    await clock.advance(7 * MIN);
    expect(await ui.find({ type: "Text", text: "5h · resets 1h0m" })).toBeDefined();
    await ui.unmount();
  });

  test("terminal drops the reset times and ledger when narrow", async ($, on) => {
    const { clock } = stubWorld(on);
    await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
    await clock.settle();

    const ui = await mountBand($, "terminal", 60);
    expect(await ui.find({ type: "Text", text: "14%" })).toBeDefined();
    expect(await ui.find({ type: "Text", text: / 5h$/ })).toBeDefined();
    expect(await ui.find({ type: "Text", text: /resets/ })).toBeUndefined();
    expect(await ui.find({ type: "Text", text: /today/ })).toBeUndefined();
    await ui.unmount();
  });

  test("ccusage reruns after a turn only once the refresh interval passed", async ($, on) => {
    const { clock, runs } = stubWorld(on);
    await $.session.start({ surface: "desktop", isInteractive: true, cwd: "/work" } as any);
    await clock.settle();

    await $.turn.complete({ reason: "answer", answer: "ok", durationMs: 1 } as any);
    await clock.settle();
    expect(runs).toHaveLength(1);

    await clock.set(NOON + 61_000);
    await $.turn.complete({ reason: "answer", answer: "ok", durationMs: 1 } as any);
    await clock.settle();
    expect(runs).toHaveLength(2);
  });
});

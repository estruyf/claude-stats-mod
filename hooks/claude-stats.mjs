// Claude Stats: usage limits and ccusage spend, drawn in the band above the prompt.
//
//   ◔ 14% 5h · resets 1h7m   ◕ 83% 7d · resets 3h47m   $ $0.10 · $0.10 today · $0.10 mo

// Held by the host, so the readings survive a hot reload of this file.
const USAGE = { plugin: "claude-stats", key: "usage" };
const COSTS = { plugin: "claude-stats", key: "costs" };
const TICK = { plugin: "claude-stats", key: "tick" };

const MINUTE = 60_000;
const IDLE_REFRESH_MS = 10 * MINUTE; // pick up spend from other sessions while this one is idle

const LIMIT_LABELS = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };

const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";

let refreshing = false;
let ticker;

export function register(on, options = {}) {
  const refreshMs = Math.max(10, Number(options.refreshSeconds) || 60) * 1000;

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await takeUsage($);
    refreshCosts($, options, 0).catch(() => {});

    // Redraw the countdowns every minute, and catch spend from other sessions.
    ticker?.cancel();
    ticker = $.clock.every(MINUTE, () => {
      takeUsage($)
        .then(() => $.clock.now())
        .then((now) => $.state.set(TICK, now))
        .catch(() => {});
      refreshCosts($, options, IDLE_REFRESH_MS).catch(() => {});
    });
    return result;
  });

  // Pushed by the engine whenever a rate-limit window or the session cost moves.
  on("session.measure", async ($, e, next) => {
    await saveUsage($, e);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!e.agentId) {
      await takeUsage($); // main-loop turns only, not subagents
      refreshCosts($, options, refreshMs).catch(() => {});
    }
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (e.props?.hasSurvey) return next(e);

    const { value: usage } = await $.state.get(USAGE);
    const { value: costs } = await $.state.get(COSTS);
    await $.state.get(TICK); // subscribe, so the reset countdowns redraw each minute

    const limits = usage?.rateLimits ?? [];
    const hasCost = usage?.sessionUsd !== undefined || costs?.today !== undefined;
    if (limits.length === 0 && !hasCost) return next(e);

    const now = await $.clock.now();
    const els = $.ui.resolve(e);
    return e.surface === "terminal"
      ? terminalBand(els, limits, usage, costs, now, e.props?.bodyColumns ?? 120)
      : desktopBand(els, limits, usage, costs, now);
  });
}

// ── Readings ────────────────────────────────────────────────────────────────

async function takeUsage($) {
  await saveUsage($, await $.session.usage());
}

async function saveUsage($, { rateLimits = [], cost } = {}) {
  await $.state.set(USAGE, {
    rateLimits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    sessionUsd: cost?.usd,
  });
}

// Runs ccusage once for the month so far: today's row plus the month's total.
async function refreshCosts($, options, maxAgeMs) {
  if (refreshing) return;
  const now = await $.clock.now();
  const { value: prev } = await $.state.get(COSTS);
  if (prev?.at && now - prev.at < maxAgeMs) return;

  refreshing = true;
  try {
    const d = new Date(now);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const stdout = await runCcusage($, options, ["daily", "--json", "--offline", "--since", `${y}${m}01`]);
    const data = JSON.parse(stdout.slice(stdout.indexOf("{")));
    const todayRow = (data.daily ?? []).find((r) => (r.period ?? r.date) === `${y}-${m}-${day}`);
    await $.state.set(COSTS, {
      today: todayRow?.totalCost ?? 0,
      month: data.totals?.totalCost ?? 0,
      at: now,
    });
  } catch (err) {
    const error = String(err?.message ?? err);
    $.ui.log(`claude-stats: ccusage failed: ${error}`, { to: "debug" });
    await $.state.set(COSTS, { ...prev, at: now, error });
  } finally {
    refreshing = false;
  }
}

// Tries the command as-is, then through a login shell: the desktop app starts
// without the PATH that nvm, volta or fnm set up in your shell profile.
async function runCcusage($, options, args) {
  const command = String(options.ccusageCommand || "npx -y ccusage@latest").trim();
  const argv = [...command.split(/\s+/), ...args];
  const init = { timeoutMs: 90_000 };

  try {
    const r = await $.process.run(argv, init);
    if (r.exitCode === 0) return r.stdout;
    if (r.exitCode !== 127) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`);
  } catch (err) {
    if (!/ENOENT|not found|cannot start|spawn/i.test(String(err?.message ?? err))) throw err;
  }

  const shell = (await $.env.get("SHELL")) || "/bin/zsh";
  const r = await $.process.run([shell, "-lic", argv.map(quote).join(" ")], init);
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`);
  return r.stdout;
}

function quote(arg) {
  return /^[\w@./:=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

// ── Drawing: desktop ────────────────────────────────────────────────────────

function desktopBand({ Box, Text, Svg }, limits, usage, costs, now) {
  const pills = limits.map((l) => {
    const pct = Math.round(l.percentUsed);
    const reset = resetIn(l.resetsAt, now);
    return pill(Box, [
      Svg({ source: ring(l.percentUsed, colorFor(l.percentUsed)), alt: `${pct}% used`, width: 16, height: 16 }),
      Text({ bold: true, children: `${pct}%` }),
      Text({ dimColor: true, children: `${labelFor(l.kind)}${reset ? ` · resets ${reset}` : ""}` }),
    ]);
  });

  const money = costParts(usage, costs);
  if (money) {
    pills.push(
      pill(Box, [
        Svg({ source: dollarBadge(), alt: "cost", width: 16, height: 16 }),
        Text({ bold: true, color: GREEN, children: money.session }),
        Text({ dimColor: true, children: money.rest }),
      ]),
    );
  }

  return Box({ flexDirection: "row", flexWrap: "wrap", gap: 1, paddingX: 1, children: pills });
}

function pill(Box, children) {
  return Box({
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    paddingX: 1,
    borderStyle: "round",
    borderDimColor: true,
    children,
  });
}

function ring(percent, color) {
  const r = 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(Math.max(percent, 0), 100) / 100);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="2.5"/>` +
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" ` +
    `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 8 8)"/>` +
    `</svg>`
  );
}

function dollarBadge() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">` +
    `<circle cx="8" cy="8" r="7" fill="none" stroke="${GREEN}" stroke-width="1.5"/>` +
    `<text x="8" y="11.5" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="${GREEN}">$</text>` +
    `</svg>`
  );
}

// ── Drawing: terminal ───────────────────────────────────────────────────────

function terminalBand({ Box, Text }, limits, usage, costs, now, columns) {
  const wide = columns >= 80;
  const parts = [];
  const gap = () => parts.length && parts.push(Text({ children: "   " }));

  for (const l of limits) {
    gap();
    const reset = wide ? resetIn(l.resetsAt, now) : "";
    parts.push(Text({ color: colorFor(l.percentUsed), children: `${pie(l.percentUsed)} ` }));
    parts.push(Text({ bold: true, children: `${Math.round(l.percentUsed)}%` }));
    parts.push(Text({ dimColor: true, children: ` ${labelFor(l.kind)}${reset ? ` · resets ${reset}` : ""}` }));
  }

  const money = costParts(usage, costs);
  if (money) {
    gap();
    parts.push(Text({ color: GREEN, bold: true, children: money.session }));
    if (wide) parts.push(Text({ dimColor: true, children: ` ${money.rest}` }));
  }

  return Box({ flexDirection: "row", paddingX: 1, children: parts });
}

// Single-width glyphs, so the line stays aligned in every terminal font.
function pie(percent) {
  return "○◔◑◕●"[Math.min(4, Math.round(Math.max(percent, 0) / 25))];
}

// ── Formatting ──────────────────────────────────────────────────────────────

function costParts(usage, costs) {
  const hasSession = usage?.sessionUsd !== undefined;
  const hasLedger = costs?.today !== undefined;
  if (!hasSession && !hasLedger) return null;

  const session = usd(usage?.sessionUsd ?? 0);
  const rest = hasLedger
    ? `${usd(costs.today)} today · ${usd(costs.month)} mo`
    : costs?.error
      ? "ccusage unavailable"
      : "loading ccusage…";
  return { session, rest };
}

function usd(n) {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function colorFor(percent) {
  if (percent >= 85) return RED;
  if (percent >= 60) return AMBER;
  return GREEN;
}

function labelFor(kind) {
  return LIMIT_LABELS[kind] ?? kind.replace(/_/g, " ");
}

function resetIn(resetsAt, now) {
  if (!resetsAt) return "";
  const ms = Date.parse(resetsAt) - now;
  if (!(ms > 0)) return "now";
  const mins = Math.ceil(ms / MINUTE);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

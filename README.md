# claude-stats

A Claude Code mod that draws your usage limits and spend in the band above the prompt.

```
◔ 14% 5h · resets 1h7m   ◕ 83% 7d · resets 3h47m   $0.10 $1.25 today · $42.50 mo
```

- **5h / 7d**: the subscription rate-limit windows from `$.session.usage()`, with a ring (desktop) or pie glyph (terminal) coloured green → amber (60%) → red (85%), and a countdown to the reset.
- **Spend**: this session's cost, plus today and this month from [ccusage](https://github.com/ryoppippi/ccusage) (`ccusage daily --json --offline --since <first of month>`).

Rate limits only show on a Claude subscription (they're absent for API-key, Bedrock and Vertex sessions).

## Install

In Claude Code:

```
/plugin marketplace add estruyf/claude-stats-mod
/plugin install claude-stats@claude-stats-mod
/reload-plugins
```

Or from your shell:

```sh
claude plugin marketplace add estruyf/claude-stats-mod
claude plugin install claude-stats@claude-stats-mod --scope user
```

## Update

Refresh the marketplace, then update the plugin:

```sh
claude plugin marketplace update claude-stats-mod
claude plugin update claude-stats@claude-stats-mod
```

Run `/reload-plugins` in an open session (or restart the desktop app) to load the new version. Inside Claude Code you can also do this from `/plugin`, under the `claude-stats-mod` marketplace.

## Try it from a clone

```sh
git clone https://github.com/estruyf/claude-stats-mod.git
claude --plugin-dir ./claude-stats-mod
```

Requires Claude Code 2.1.287+ (mods on by default). On 2.1.286, set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in the `env` block of `~/.claude/settings.json`.

## Options

Set them with `/config` or under `pluginConfigs["claude-stats"].options` in settings:

| Option | Default | |
| --- | --- | --- |
| `showSpend` | `true` | Show the spend pill. Turn it off to see only the usage limits; ccusage then never runs. |
| `ccusageCommand` | `npx -y ccusage@latest` | Tried directly, then through your login shell so nvm/volta PATHs resolve in the desktop app. |
| `refreshSeconds` | `60` | Minimum time between ccusage runs after a turn. While idle it refreshes every 10 minutes. |

## Develop

```sh
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

Running with `--plugin-dir` hot-reloads the mod on every save, so there's no update step while developing.

To release, bump `version` in `.claude-plugin/plugin.json` and push to `main`. `claude plugin update` compares that version, so a push without a bump isn't picked up as an update.

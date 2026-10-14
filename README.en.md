<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier: automatic model routing plugin for Claude Code" width="420">
</p>

[中文](README.md)

# sommelier: automatic model routing for Claude Code (a Claude Code mod)

A **Claude Code plugin**, built on **Claude Code mods** (the mods API's `turn.step`), that picks the model and effort for each task automatically. Quick lookups go to **Claude Haiku**, well-specified changes to **Claude Sonnet**, and investigation or design to **Claude Opus**, with **TypeSafe Jev** classifying each request — saving Claude Code usage without giving up quality.

The way a sommelier picks a wine for each dish, sommelier asks [TypeSafe Jev](https://docs.typesafe.ai) (a classification API that returns probabilities) three questions about each new request — **how much reasoning it needs**, **whether it starts a new task**, and **whether it is a high-risk operation** — and maps the answer onto a configurable ladder:

| Reasoning depth | Default rung | Example |
|---|---|---|
| L0 lookup or mechanical edit | haiku · medium | "Check the version in package.json" |
| L1 clear goal and approach | sonnet · medium | "Add a timezone parameter to parseDate" |
| L2 needs investigation or trade-offs | `base` (opus · medium) | "Login sometimes returns 401, find out why" |
| L3 unbounded, needs long deliberation | opus · high | "Design a multi-tenant permission architecture" |

**Why not switch models every turn?** Each model keeps its own prompt cache, so switching models means writing the whole conversation into the cache again, which costs usage too. sommelier's rule is: **upgrade any time; downgrade only when it pays off** — on a new task, and only when the switching cost is lower than what it saves.

## Quick start

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
# After running the next line, paste your TypeSafe API key and press Enter (the key is not shown)
read -rs TYPESAFE_API_KEY
# Store the key in the macOS Keychain
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

Create the API key in the [TypeSafe console](https://console.typesafe.ai/keys). If `TYPESAFE_API_KEY` is already set in `~/.zshrc`, skip the `read` line.

Restart Claude Code and sommelier is on, with nothing else to set up:

1. Send a request, for example "Add a timezone parameter to parseDate"
2. The spinner shows the chosen rung, for example `sonnet·medium L1 · 新話題，降級` (new topic, downgrade)

Run `/somm off` to stop. See [Install](#install) and [Usage](#usage) for details.

## Install with an AI agent

Get a TypeSafe API key ready first. Don't hand the key to the agent; set it as an environment variable yourself:

1. Create an API key in the [TypeSafe console](https://console.typesafe.ai/keys)
2. Run this in a terminal, replacing `your-api-key` with your key, to add it to `~/.zshrc`:

   ```bash
   echo 'export TYPESAFE_API_KEY="your-api-key"' >> ~/.zshrc
   ```

3. Restart your terminal and Claude Code so they pick up the new variable

Then paste this to Claude Code or any other coding agent:

> Install sommelier by following https://github.com/wide3751/sommelier/blob/main/INSTALL-AGENT.md

## Requirements

- Claude Code **v2.1.287 or later** (terminal), or **v2.1.286 or later** bundled in the Desktop app (type `/status` in the Code tab to check)
- A TypeSafe API key (create one in the [TypeSafe console](https://console.typesafe.ai/keys))

## Install

1. Add the marketplace and install. There are two ways; **GitHub is recommended**:

   **Option A: from GitHub (recommended)** — no need to download the project:

```bash
claude plugin marketplace add wide3751/sommelier
claude plugin install sommelier@sommelier
```

   To update to a new version later, run `claude plugin marketplace update sommelier` and reinstall.

   **Option B: from a local folder** — for when you have cloned the project and want to install your own changes:

```bash
git clone https://github.com/wide3751/sommelier.git ~/Projects/sommelier
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

2. Set your TypeSafe API key (stored in the macOS Keychain). In the terminal you can run `/plugin configure sommelier@sommelier` inside a session. The Desktop app's Code tab does not show an input box, so run this in a terminal instead:

```bash
# After running the next line, paste your TypeSafe API key and press Enter (the key is not shown)
read -rs TYPESAFE_API_KEY
# Store the key in the macOS Keychain
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   You don't type the key into the command: `read` waits for you to paste it into this terminal's `TYPESAFE_API_KEY` variable, and the next line stores it in the Keychain, so the key never lands in your shell history. If `TYPESAFE_API_KEY` is already set in `~/.zshrc`, skip the `read` line, but make sure the current shell can see it (for example, open a new terminal window). You can also rely on the `TYPESAFE_API_KEY` environment variable alone as a fallback, but a Desktop app launched from the Dock does not read `~/.zshrc`.

3. Restart Claude Code, run `/somm status`, and check that it says the API key is set (「API key 已設定」).

## Usage

On by default after install; there is no need to run `/somm on`. Before a request is first sent to TypeSafe, sommelier asks for your consent: agree and it never asks again; decline and that turn keeps the session's model and sommelier turns off.

| Command | Description |
|---|---|
| `/somm on` | Turn back on. Every prompt you send from then on is judged by Jev (short replies excepted) |
| `/somm off` | Turn off and keep the session's own model and effort |
| `/somm off --project` | Turn off for the current project only, so nothing from it is sent; `/somm on --project` undoes it |
| `/somm status` | Show on/off, whether this project is turned off, whether the API key is set, and this session's rung |
| `/somm log [n]` | The last n routing records: chosen rung, Jev's probabilities, cache reads and writes |
| `/somm events` | The last 20 state events (model switches, cleared or resumed conversations, prompt origins, each turn's routing), for finding out why sommelier did not switch |

When on, the status line under the prompt shows the model, its version and the effort that actually answered, for example `🍷 haiku 5.5·medium`. The model Claude Code shows next to it is the session's own.

If another plugin already uses `/somm`, the command falls back to `/sommelier`.

**How each request is decided:**
- **Upgrade**: whenever a request needs a stronger model or higher effort, it moves up
- **Downgrade**: only on a new topic, and only when the expected saving beats the cost of rewriting the cache; otherwise that request keeps the current model
- **Keep**: on the same topic when the judgment is lower, on short replies ("ok", "continue"; not sent to Jev), and when Jev times out or errors, the current model stays
- **No haiku for long conversations**: a conversation over 30k tokens is not moved down to haiku, and one already on haiku moves to sonnet once it grows past that

**sommelier leaves the model unchanged when:**
- it is off, or turned off for the current project
- you did not agree to the consent question before the first send
- Jev fails on the session's first request, or no API key is set (a later failure keeps the current model)
- the request comes from a subagent

### Examples

The plugin's messages are currently in Chinese; translations are in the comments.

Turn it on and send "Add a timezone parameter to parseDate". Jev judges it L1, the session's opus moves down to sonnet, and the spinner shows:

```
sonnet·medium L1 · 新話題，降級   # new topic, downgrade
```

Reply "ok": short replies are not sent to Jev and keep the same rung:

```
sonnet·medium · 沿用             # kept
```

Then ask "Design a multi-tenant permission architecture". Jev judges it L3 and it moves up:

```
opus·high L3 · 升級              # upgrade
```

`/somm status`:

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
# sommelier on | API key set | this session's rung sonnet·medium
```

`/somm log 3` — P is Jev's probability for L0/L1/L2/L3; a turn where judging failed shows `session` and keeps the original model; "回答" is the model that actually answered, and the brackets hold the first six characters of the session id:

```
sonnet·medium · 回答 sonnet · downgrade P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342 [a1b2c3]
sonnet·medium · 回答 sonnet · continuation cache read 18342 write 1204 [a1b2c3]
opus·high · 回答 opus · upgrade P=0.02/0.08/0.20/0.70 jev 410ms cache read 0 write 21530 [a1b2c3]
```

## Limitations

- **Manual `/model`**: once you switch models with `/model`, sommelier stops changing the model, across `/clear` and resume too, until you pick Default in `/model`. After Claude Code falls back to another model on its own, sommelier also stands back until you run `/model` yourself.
- **Turns that are not judged**: messages from notifications, schedules, other sessions or other plugins, and slash commands, keep the current model and are not sent to Jev. When the session model is not Opus, Sonnet or Haiku 5.5 (a `[1m]` variant or an older version, say), sommelier changes nothing.
- **No downgrade that doesn't pay**: each model has its own cache, so a switch writes the conversation into the new model's cache. sommelier keeps track of how far each model's cache reaches: a model never used, or idle past the cache TTL, needs the whole conversation rewritten; going back to a model used moments ago only adds what is new; after `/clear`, compact or resume only the system prompt is still cached. Before a downgrade it weighs that rewrite against what about 3 turns on the cheaper model would save. If it doesn't pay, that request keeps the current model and the next new topic is weighed again. Upgrades are unaffected. Prices are the list prices in `hooks/decide.ts`.
- **The model picker shows the session model**: sommelier changes each request it sends, not the session's own model, so `/model` and the Desktop model picker keep showing the original. The model after 🍷 in the status line is the one that actually answered.
- **Judging takes time**: each request's judgment waits up to 1.5 s (offline eval p95 about 0.4 s); short replies are not sent and do not wait.
- **Desktop app**: the Code tab cannot take the API key through `/plugin configure`; set it from a terminal instead (see Install).

## Troubleshooting

| Symptom | What to do |
|---|---|
| `/somm status` says the API key is not set (「API key 未設定」) | Redo step 2 of Install. If you rely on the environment variable only, make sure the shell that starts Claude Code can see `TYPESAFE_API_KEY`; a Desktop app launched from the Dock does not read `~/.zshrc` |
| The spinner shows `Jev 失敗` (Jev failed) | Check `/somm log` for the reason: `no_key` means no key, `timeout` means it took over 1.5 s, `http_401` and similar are API errors, `fetch_failed` means TypeSafe could not be reached. That turn keeps the current model; if the session's first request fails, it uses the session's own model |
| `/somm` is missing | Another plugin took it; use `/sommelier` |
| Code changes have no effect | Installed copies are cached by the `version` in `plugin.json`. Bump the version and reinstall, or use `--plugin-dir` while developing |

## Privacy and data

sommelier is on by default after install, and while on it sends data to TypeSafe for judging. It asks for your consent before the first send; once you run `/somm off`, nothing is sent.

- **When**: every new request; short replies (8 characters or fewer once spaces and punctuation are stripped, such as "ok" or "continue") are not sent
- **What is sent**: the current request (up to 2,000 characters) and the text of the last 3 turns (up to 500 characters each, keeping the end)
- **Masked before sending**: common secret formats become `[REDACTED]`: `sk-`, `AKIA`, `ghp_`, `xoxb-`/`xoxp-`, `AIza`, `Bearer`, `password=`, JWTs, private key blocks, and hex strings of 32 or more characters
- **What is not sent**: file contents, tool calls and tool output, subagent requests, and projects turned off with `/somm off --project`
- **Local records**: `/somm log` records store the rung, Jev's probabilities, latency, cache reads and writes, and the first 40 characters of the prompt (masked); turned-off projects store no prompt
- **API key**: stored in the macOS Keychain (`/plugin configure`), or read from the `TYPESAFE_API_KEY` environment variable

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) (in Chinese) for the development setup, offline evaluation, and project layout.

## Docs

- [GLOSSARY.md](GLOSSARY.md): terminology (rung, new task, cache ledger…)

## License

[MIT](LICENSE)

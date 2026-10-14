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
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

Restart Claude Code and sommelier is on, with nothing else to set up:

1. Send a request, for example "Add a timezone parameter to parseDate"
2. The spinner shows the chosen rung, for example `sonnet·medium L1 · 新話題` (new task)

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
printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
```

   Make sure the current shell can see `TYPESAFE_API_KEY` first (for example, open a new terminal window). You can also rely on the `TYPESAFE_API_KEY` environment variable alone as a fallback, but a Desktop app launched from the Dock does not read `~/.zshrc`.

3. Restart Claude Code, run `/somm status`, and check that it says the API key is set (「API key 已設定」).

## Usage

On by default after install; there is no need to run `/somm on`. Before a request is first sent to TypeSafe, sommelier asks for your consent: agree and it never asks again; decline and that turn keeps the session's model and sommelier turns off.

| Command | Description |
|---|---|
| `/somm on` | Turn back on. The next prompt you send is judged by Jev |
| `/somm off` | Turn off and keep the session's own model and effort |
| `/somm off --project` | Turn off for the current project only, so nothing from it is sent; `/somm on --project` undoes it |
| `/somm status` | Show on/off, whether this project is turned off, whether the API key is set, and this session's rung |
| `/somm log [n]` | The last n routing records: chosen rung, Jev's probabilities, cache reads and writes |

When on, the status line under the prompt shows the model that actually answered, for example `🍷 實際模型 haiku·medium（預設 opus）` ("actual model … (default opus)"). The part in parentheses is the session's own model and appears only when sommelier replaced it.

If another plugin already uses `/somm`, the command falls back to `/sommelier`.

**sommelier leaves the model unchanged when:**
- it is off, or turned off for the current project
- you did not agree to the consent question before the first send
- Jev times out (1.5 s), returns an error, or no API key is set
- the request comes from a subagent

### Examples

The plugin's messages are currently in Chinese; translations are in the comments.

Turn it on and send "Add a timezone parameter to parseDate". Jev judges it L1 and the spinner shows:

```
sonnet·medium L1 · 新話題        # new task
```

Every later turn keeps the same rung:

```
sonnet·medium · 沿用             # continued
```

`/somm status`:

```
sommelier 開啟｜API key 已設定｜本 session 檔位 sonnet·medium
# sommelier on | API key set | this session's rung sonnet·medium
```

`/somm log 3` — P is Jev's probability for L0/L1/L2/L3; a turn where judging failed shows `session` and keeps the original model:

```
sonnet·medium · first_turn P=0.05/0.90/0.05/0.00 jev 820ms cache read 0 write 18342
sonnet·medium · continuation cache read 18342 write 1204
session · jev_failed:timeout cache read 0 write 15873
```

## Limitations

- **Only the first prompt is judged**: once on, only the session's first request goes to Jev; every later turn keeps the same rung. Changing topics does not trigger a new judgment.
- **Manual `/model` and `/clear`**: how sommelier behaves after you switch models by hand, or clear or resume a conversation, is still being verified and may not be what you expect. If you need a fixed model, run `/somm off` first.
- **No downgrade that doesn't pay**: switching models rewrites the whole conversation into the new model's cache. Before a downgrade, sommelier weighs that rewrite — sized from Claude Code's own context figure (`$.session.usage().context.tokens`) and the cache TTL in the response usage — against what about 5 turns on the cheaper model would save. If it doesn't pay, it keeps the session model and stops judging for that session. Upgrades are unaffected. Prices are the list prices in `hooks/decide.ts`.
- **Judging takes time**: each judgment waits up to 1.5 s, so the first request responds a little more slowly.
- **Desktop app**: the Code tab cannot take the API key through `/plugin configure`; set it from a terminal instead (see Install).

## Troubleshooting

| Symptom | What to do |
|---|---|
| `/somm status` says the API key is not set (「API key 未設定」) | Redo step 2 of Install. If you rely on the environment variable only, make sure the shell that starts Claude Code can see `TYPESAFE_API_KEY`; a Desktop app launched from the Dock does not read `~/.zshrc` |
| The spinner shows `session · Jev 失敗` (Jev failed) | Check `/somm log` for the reason: `no_key` means no key, `timeout` means it took over 1.5 s, `http_401` and similar are API errors, `fetch_failed` means TypeSafe could not be reached. That turn keeps the session's own model |
| `/somm` is missing | Another plugin took it; use `/sommelier` |
| Code changes have no effect | Installed copies are cached by the `version` in `plugin.json`. Bump the version and reinstall, or use `--plugin-dir` while developing |

## Privacy and data

sommelier is on by default after install, and while on it sends data to TypeSafe for judging. It asks for your consent before the first send; once you run `/somm off`, nothing is sent.

- **When**: currently only the session's first request (once per-prompt routing lands, every new request)
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

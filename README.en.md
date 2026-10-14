<p align="center">
  <img src="assets/logo/logo.png" alt="sommelier" width="420">
</p>

[中文](README.md)

A Claude Code plugin (mod) that picks the model and effort for each task, the way a sommelier picks a wine for each dish. It asks [TypeSafe Jev](https://docs.typesafe.ai) three questions per new request — reasoning depth, whether it starts a new task, whether it is high risk — and maps the answer onto a configurable ladder:

| Depth | Default rung |
|---|---|
| L0 lookup / mechanical edit | haiku · medium |
| L1 clear, well-specified task | sonnet · medium |
| L2 needs investigation or trade-offs | `base` (opus · medium) |
| L3 unbounded / deep, or "ultrathink" | opus · high |

Upgrades happen any time and stick until the task ends. Downgrades happen only when the prompt cache would be rebuilt anyway (session start, after `/clear` or `/compact`, after resume, after idling past the cache TTL) or while the conversation is still short.

## Requirements

- Claude Code v2.1.287 or later (mods support)
- A TypeSafe API key

## Install (local marketplace)

```bash
claude plugin marketplace add ~/Projects/sommelier
claude plugin install sommelier@sommelier
```

Off by default. Turn it on in a session with `/somm on`.

## Usage

- Available now: `/somm on | off | status | log [n]`
- Planned: `/somm export | config`, `/somm off --project`, the pane, and `somm:opus` / `somm:auto` prompt prefixes

## Development

```bash
claude --plugin-dir ~/Projects/sommelier   # load for one session, hot-reloads on save
claude plugin validate ~/Projects/sommelier
cd ~/Projects/sommelier && claude plugin test
```

Glossary: [GLOSSARY.md](GLOSSARY.md)

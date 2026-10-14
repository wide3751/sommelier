# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

Layout: **single-context**.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root — the domain glossary (this repo's equivalent of `CONTEXT.md`). Terms are defined in Traditional Chinese, each with an _避免_ line listing synonyms not to use.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/spec.md`** — the implementation spec; the glossary deliberately leaves implementation detail to it.

`docs/adr/` and `docs/spec.md` are kept local only (gitignored), so they may be missing in a fresh clone. If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-route-via-mod-turn-step.md
│   │   └── 0002-per-sentence-routing-with-cache-ledger.md
│   └── spec.md
└── hooks/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids (the _避免_ lines).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (per-sentence routing with cache ledger) — but worth reopening because…_

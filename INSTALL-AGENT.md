# Installing sommelier (for AI agents)

You are installing [sommelier](README.en.md), a Claude Code plugin that picks the model and effort for each request. The user should already have set the `TYPESAFE_API_KEY` environment variable themselves; you never need to see the key.

Run these in order. If any step fails, stop and report the error to the user:

1. Run `claude --version` and check the version is ≥ 2.1.287. If it is older, stop and ask the user to update Claude Code first.
2. Install the plugin:

   ```bash
   claude plugin marketplace add wide3751/sommelier
   claude plugin install sommelier@sommelier
   ```

3. Check that the API key exists, **without printing its value**:

   ```bash
   [ -n "$TYPESAFE_API_KEY" ] && echo set || echo missing
   ```

   If it prints `missing`, stop and ask the user to set `TYPESAFE_API_KEY` themselves, or to run `/plugin configure sommelier@sommelier` in a terminal session. Do not ask the user for the key, and do not write it to any file.
4. Save the key to the plugin config (stored in the macOS Keychain):

   ```bash
   printf '{"typesafe_api_key":"%s"}' "$TYPESAFE_API_KEY" | claude plugin configure sommelier@sommelier --values-stdin
   ```

5. Run `claude plugin list` and check that `sommelier@sommelier` shows Status `enabled`.
6. The user has to do the rest inside Claude Code; the agent can't do it from a shell. Tell the user to:
   1. Restart Claude Code; sommelier turns on by itself
   2. Run `/somm status` and check it says it is on and the API key is set

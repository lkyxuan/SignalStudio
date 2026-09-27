# Hermes profile for SignalStudio

Hermes loads two instruction layers for this project:

- `AGENTS.md` at the repository root is the project development instruction. Hermes loads it automatically when a session starts in this Git repository, including a Kanban worktree.
- `ops/hermes/SOUL.md` is the versioned source for the dedicated profile's identity. Copy it to that profile's `SOUL.md`; Hermes loads the copy from its profile home.

Keep the board and dispatcher on one machine. The Mac mini can host the authoritative board, while the laptop uses Hermes Desktop or the dashboard to view it remotely. Do not create a second active board on the laptop.

## Set up on the worker Mac

Clone this repository and run the following commands from its root. Replace `codex` with the installed executable path if it is not on `PATH`.

```bash
hermes profile create signalstudio --no-alias --description "Develops SignalStudio cards in isolated Git worktrees and hands changes to human review."
cp ops/hermes/SOUL.md ~/.hermes/profiles/signalstudio/SOUL.md
hermes -p signalstudio config set terminal.cwd "$PWD"
hermes -p signalstudio config set model.provider openai-codex
hermes -p signalstudio config set model.default gpt-5.4
hermes -p signalstudio config set model.openai_runtime codex_app_server
hermes -p signalstudio config set model.codex_bin "$(command -v codex)"
hermes kanban boards create signalstudio --name "SignalStudio" --default-workdir "$PWD"
```

Sign in to both Codex and Hermes on that Mac. Their OAuth sessions are separate:

```bash
codex login
hermes -p signalstudio auth add openai-codex --type oauth
hermes -p signalstudio codex-runtime migrate
```

For human review, set `kanban.review_dispatch` to `false` on the profile that runs the gateway. Start one Hermes gateway on the board host so its dispatcher can claim `ready` cards. If this Mac has no existing gateway, the default profile can host it:

```bash
hermes config set kanban.review_dispatch false
hermes gateway install --start-now --start-on-login
hermes gateway status
hermes kanban --board signalstudio stats
```

Open `hermes dashboard` on the worker Mac to inspect the Kanban tab. For remote access, keep the dashboard bound to localhost and use an SSH tunnel, or configure Hermes Desktop's remote gateway with authentication. The board database stays on the worker Mac; GitHub carries reviewed code, not queue state.

When `ops/hermes/SOUL.md` changes, copy it into the profile again and start a new Hermes session so the updated identity is loaded. Never commit the profile's `.env`, `auth.json`, sessions, or board database.

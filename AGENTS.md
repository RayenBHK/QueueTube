# QueueTube agent instructions

## Start here after a model switch or interruption

Read `docs/HANDOFF.md` before project work. It is the current checkpoint, not an instruction to execute the entire roadmap. Follow the user's latest request, verify live state, and preserve unrelated changes.

## Keep the checkpoint current

- Update `docs/HANDOFF.md` after meaningful milestones and before handing work back, switching models, or approaching a usage limit. Do not rely on a final chat recap being available.
- Record completed work, active work, exact next steps, blockers, decisions, verification evidence, and Git status. Label proposals and unverified claims explicitly.
- Record any active agent's assignment and uncommitted files before a handoff. Do not assume agents, terminals, or browser sessions survive a switch.
- Keep one current checkpoint, not a growing transcript. Link existing feature, architecture, testing, and roadmap documents instead of duplicating them.
- Never store credentials, tokens, private queue contents, or full account/configuration dumps in documentation.

## Working preferences

- Use Caveman full for concise conversation and Ponytail full for coding. Write documentation, code comments, and Git text in normal prose. Read applicable skills before using them.
- Use RTK for supported shell commands; use native commands with focused output when RTK is unavailable or incompatible.
- For setup, integration, and investigation with independent checks, use bounded `gpt-5.6-luna` subagents with `high` reasoning. Avoid delegation for trivial or strictly sequential work; the main agent owns integration and verification.
- Use UI UX Pro Max for interface work and the Chrome extensions skill for extension work when available.
- Prefer the user's installed OpenDesign, through its connected MCP when available, for requested product visuals, photographs, videos, animation, presentations, UI designs, and interactive 3D landing pages. Verify supported capabilities; do not silently substitute a service or claim a connection that does not exist.
- The creative preference does not authorize generation now, paid services, account changes, uploads, or publishing. The next-release roadmap is a proposal until the user chooses work.

## Project safeguards

Preserve local-first storage, separate Shorts/video lanes, manual playback defaults, and existing user data. Do not add analytics, remote executable code, or permissions without justification and appropriate authorization. Keep tests and documentation aligned with changes. Never reset a dirty worktree or assume a local commit is pushed or released.

# RetroNoodle

A real-time retrospective app for software teams that turns every retro into tracked commitments.
Live at retronoodle.com (v0.1 ships Oct 4, 2026).

- Backlog: [`docs/stories.md`](docs/stories.md) (build in ID order)
- Conventions for contributors and Claude: [`CLAUDE.md`](CLAUDE.md)

## Local setup

```sh
pnpm install
cp .env.example .env   # fill in Supabase and Anthropic values
pnpm dev               # web on http://localhost:5173, API on http://localhost:3000
```

`pnpm lint`, `pnpm typecheck` and `pnpm test` run in CI on every pull request.

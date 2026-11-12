# Contributing to DPI-H Lab

Thank you for helping improve DPI-H Lab. Ideas, bug reports, wording fixes and code are all welcome.

## Ways to contribute

- **Report a bug or suggest an improvement:** open an [issue](https://github.com/sscproject/dpi-h-lab/issues/new/choose) and pick the matching form.
- **Improve a definition or other wording:** open a "Content or wording" issue, or change the content workbook in a pull request (see [Changing the wording](#changing-the-wording)).
- **Send code:** fork the repository, make your change on a branch, and open a pull request against `main`.
- **Report a security problem:** please **don't** open a public issue. Follow [SECURITY.md](SECURITY.md).

For anything larger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Setting up your computer

You need **Node.js 22 or later** (24 LTS recommended) and Git.

```bash
git clone https://github.com/<your-account>/dpi-h-lab.git
cd dpi-h-lab
npm install
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:3000

No database install is needed: without `DATABASE_URL` the server uses PGlite (PostgreSQL compiled to WebAssembly) and keeps its data in `.data/pglite`, which git ignores.

**First sign-in:** the server prints a one-time **setup code** in its log. Open http://localhost:5173/staff, enter the code and create the first **Super Admin** account. Then create a session and add teams to try things out.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Server and client with live reload |
| `npm test` | Unit and API tests (against an in-memory database) |
| `npm run typecheck` | TypeScript checks for client and server |
| `npm run content:build` | Validates the content workbook and writes `content/content.json` |
| `npm run build` then `npm start` | Production build, then run the server (it serves the built client) |
| `npm run migrate` | Applies database migrations (they also run when the server starts) |

Settings are environment variables; see [.env.example](.env.example). To try it in Docker instead, see the comments at the top of [docker-compose.yml](docker-compose.yml).

### Project layout

```
client/    React web client: home page, worksheet, staff screens (sign-in, admin, sessions)
server/    Fastify API: routes/ (public, staff), sessions and teams, staff accounts,
           live updates (SSE), exports, database layer, migrations/
shared/    Rules used by both sides: worksheet schema and validation, codes, countries,
           content IDs, summary
content/   Content workbook (Excel) and the generated content.json
scripts/   content-build.ts
tests/     Vitest tests
docs/      Architecture and deployment notes
```

How the parts fit together: [docs/architecture.md](docs/architecture.md).

## Making a change

1. Fork the repository and create a branch from `main` (for example `fix/summary-copy` or `feature/print-layout`).
2. Make your change, and add or update tests in `tests/` where it makes sense.
3. Before you push, check everything passes:
   ```bash
   npm run typecheck
   npm test
   npm run content:build
   ```
4. Open a pull request. Fill in the template: what changed, why, and how you tested it. Link the issue it closes.

Every pull request runs the same checks automatically. A maintainer reviews it, may ask for changes, and merges it into `main` once it is approved and the checks pass. `main` is protected: nobody pushes to it directly.

## Changing the wording

Every label, definition, prompt, glossary term and piece of interface text comes from `content/DPI-H_Pathway_Lab_Content_v1.xlsx` (sheets `Items`, `Steps`, `Glossary`, `UI_Text`).

1. Edit the workbook in Excel. Keep IDs unchanged.
2. Raise the version on its `README` sheet (e.g. 1.61 → 1.62). Published versions never change.
3. Run `npm run content:build` and fix anything the validator reports.
4. Commit both the workbook and the regenerated `content/content.json`.

When the server restarts, new teams use the new version; existing teams keep theirs (the footer always uses the newest wording). `shared/ui-keys.ts` lists every `UI_Text` key the app reads, and the build fails if one is missing: add new keys there too.

## Guidelines

- **Keep it small and focused.** One pull request per change is easier to review.
- **Follow the existing style:** TypeScript, plain names, comments that explain *why*. Keep domain rules in `shared/` and the server's domain files, not in routes or components.
- **Interface text belongs in the content workbook**, not in code.
- **Never commit secrets or personal data:** no passwords, tokens, `.env` files, real participant names or workshop data.
- **Accessibility matters:** keep keyboard use, labels, focus and colour contrast working in both light and dark themes (the theme contrast tests check the colours).
- **Security-sensitive changes** (sign-in, access checks, codes, exports) need a test that shows the protection works.

## Licence and attribution of contributions

By contributing, you agree that your contribution is licensed under the same terms as the project: **Apache-2.0** for code and **CC BY 4.0** for content in `content/` (see [LICENSE](LICENSE), [LICENSE-CONTENT.md](LICENSE-CONTENT.md) and [NOTICE](NOTICE)). You keep the copyright in your contribution; it becomes part of "the DPI-H Lab authors" through the git history.

## Code of Conduct

Everyone taking part in this project follows our [Code of Conduct](CODE_OF_CONDUCT.md).

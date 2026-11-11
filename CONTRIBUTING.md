# Contributing to DPI-H Lab

Thank you for helping improve DPI-H Lab. Ideas, bug reports, wording fixes and code are all welcome.

## Ways to contribute

- **Report a bug or suggest an improvement:** open an [issue](https://github.com/sscproject/dpi-h-lab/issues/new/choose) and pick the matching form.
- **Improve a definition or other wording:** open a "Content or wording" issue, or change the content workbook in a pull request (see below).
- **Send code:** fork the repository, make your change on a branch, and open a pull request against `main`.
- **Report a security problem:** please **don't** open a public issue. Follow [SECURITY.md](SECURITY.md).

For anything larger than a small fix, open an issue first so we can agree on the approach before you spend time on it.

## Making a change

1. Fork the repository and create a branch from `main` (for example `fix/summary-copy` or `feature/print-layout`).
2. Install and run it locally (Node.js 22 or later):
   ```bash
   npm install
   npm run dev
   ```
3. Make your change, and add or update tests in `tests/` where it makes sense.
4. Before you push, check everything passes:
   ```bash
   npm run typecheck
   npm test
   npm run content:build
   ```
5. Open a pull request. Fill in the template: what changed, why, and how you tested it. Link the issue it closes.

Every pull request runs the same checks automatically. A maintainer reviews it, may ask for changes, and merges it into `main` once it is approved and the checks pass. `main` is protected: nobody pushes to it directly.

## Guidelines

- **Keep it small and focused.** One pull request per change is easier to review.
- **Follow the existing style:** TypeScript, plain names, comments that explain *why*. Keep domain rules in `shared/` and the server's domain files, not in routes or components.
- **Interface text belongs in the content workbook**, not in code. Add new keys to `content/DPI-H_Pathway_Lab_Content_v1.xlsx` (sheet `UI_Text`) and to `shared/ui-keys.ts`, raise the workbook version on its `README` sheet, and run `npm run content:build`.
- **Never commit secrets or personal data:** no passwords, tokens, `.env` files, real participant names or workshop data.
- **Accessibility matters:** keep keyboard use, labels, focus and colour contrast working in both light and dark themes (the theme contrast tests check the colours).
- **Security-sensitive changes** (sign-in, access checks, codes, exports) need a test that shows the protection works.

## Licence and attribution of contributions

By contributing, you agree that your contribution is licensed under the same terms as the project: **Apache-2.0** for code and **CC BY 4.0** for content in `content/` (see [LICENSE](LICENSE), [LICENSE-CONTENT.md](LICENSE-CONTENT.md) and [NOTICE](NOTICE)). You keep the copyright in your contribution; it becomes part of "the DPI-H Lab authors" through the git history.

## Code of Conduct

Everyone taking part in this project follows our [Code of Conduct](CODE_OF_CONDUCT.md).

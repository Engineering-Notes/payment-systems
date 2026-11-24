# Contributing to Engineering Notes

This repository holds the code behind the Engineering Notes article series. Every number quoted in an article comes from running this code, so the bar for changes is simple: results must stay reproducible, and any change to a result must be explained.

## Ways to contribute

| You want to | Do this |
|---|---|
| Report code that fails or gives different results | Open a [bug report](https://github.com/Engineering-Notes/payment-systems/issues/new?template=bug_report.yml) |
| Point out an error in an article | Open an [article correction](https://github.com/Engineering-Notes/payment-systems/issues/new?template=article_correction.yml) with a source |
| Propose a new scenario, improvement or article topic | Open an [improvement issue](https://github.com/Engineering-Notes/payment-systems/issues/new?template=improvement.yml) |
| Report a security problem | Follow [SECURITY.md](SECURITY.md). Do not open a public issue |

Open an issue before starting any change larger than a small fix, so the approach can be agreed before you spend time on it.

## Development setup

Requirements: Node.js 22 (see `.nvmrc`), Docker for PostgreSQL 16.

```bash
git clone https://github.com/Engineering-Notes/payment-systems.git
cd payment-systems
docker compose up -d          # PostgreSQL for articles 01 to 03
cd 02-idempotency-keys
npm ci
npm test
```

Each article folder is an independent Node.js project with its own `package.json` and `package-lock.json`. Use `npm ci`, not `npm install`, so you run the exact dependency versions the results were produced with.

## Workflow

1. Fork the repository and create a branch from `main`.
2. Name the branch by type and topic: `fix/outbox-lock-release`, `feat/ledger-multi-currency-holds`, `docs/agents-readme`, `test/idempotency-concurrency`, `chore/update-pg`.
3. Make focused commits (see below).
4. Run `npm ci && npm test` in every folder you touched.
5. Open a pull request using the template, and paste your test output.

## Commit messages

This repository follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```text
<type>(<scope>): <summary>
```

| Type | Use for |
|---|---|
| `feat` | New scenario, pattern or capability |
| `fix` | Bug fix or corrected result |
| `test` | Tests only |
| `docs` | Documentation, READMEs, article corrections |
| `refactor` | Code change with no change in behaviour or results |
| `perf` | Performance improvement |
| `ci` | GitHub Actions workflows |
| `chore` | Tooling, dependencies, repository maintenance |

Scopes match the article folders: `ledger`, `idempotency`, `outbox`, `agents`, `stablecoin`. Use `docker`, `ci` or no scope for repository-wide changes.

Rules: imperative mood ("add", not "added"), lowercase after the colon, no full stop, 72 characters or fewer. Explain the reason for the change in the commit body when it is not obvious from the summary.

## Code standards

- **Reproducibility first.** Experiments that use randomness must use a fixed seed. If a result can vary between runs (for example, concurrent relays in article 03), the folder README must say so and give the observed range.
- **Results stay in sync.** If your change alters any output, update the expected results in the folder README and explain the change in the pull request.
- **Money is integers.** Amounts are stored and computed in minor units (`bigint` in SQL, integers in JavaScript). No floating point for money.
- **Correctness lives close to the data.** Invariants such as balanced entries or unique idempotency keys are enforced by the database or the contract, with application code as a second line.
- **Readable over clever.** Code in this repository is read by people learning the pattern. Prefer clear names and short functions, and comment on the reason for a decision, not on what a line does.
- **Style.** Follow `.editorconfig`: two-space indentation for JavaScript and SQL, four for Solidity, LF line endings. Use ES modules and `async`/`await`.
- **No secrets.** Never commit credentials, API keys or `.env` files. Use environment variables, as the existing scripts do.

## Pull request review

Every pull request needs a green CI run and a review from the maintainer (see `.github/CODEOWNERS`). Expect review comments on correctness, reproducibility and clarity. Pull requests are squash-merged, so the pull request title should itself be a valid Conventional Commit message.

## Labels

| Label | Meaning |
|---|---|
| `needs-triage` | New, not yet reviewed |
| `bug` | Code fails or results differ from the README |
| `article-correction` | Error in a published article |
| `enhancement` | Improvement or new scenario |
| `good first issue` | Small, well-scoped, suitable for a first contribution |
| `help wanted` | The maintainer would welcome a pull request |
| `dependencies` | Dependency updates |
| `ci` | Workflow changes |
| `ledger`, `idempotency`, `outbox`, `agents`, `stablecoin` | Article scope |

## Code of conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

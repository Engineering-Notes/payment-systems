## Summary

<!-- What does this change and why? One or two sentences. -->

Closes #

## Article folder

<!-- Which folder does this change, for example `08-mpesa-stk-push`? Write "repository-wide" for CI, Docker or docs. -->

Folder:

## Type of change

- [ ] `fix`: corrects a bug or a wrong result
- [ ] `feat`: adds a scenario, pattern or capability
- [ ] `test`: adds or changes tests only
- [ ] `docs`: documentation or article correction
- [ ] `chore` / `ci`: tooling, dependencies or workflows

## Results

<!-- Paste the output of `npm test` for every folder you changed. If a number quoted in an article changes, say which one and why. -->

```text

```

## Checklist

- [ ] `npm ci && npm test` passes in every folder I changed, on Node.js 22.
- [ ] Results quoted in the folder README still match the output, or I updated the README.
- [ ] Commits follow Conventional Commits, for example `fix(outbox): release row locks before commit`.
- [ ] No secrets, API keys or personal data are included.
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md).

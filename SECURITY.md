# Security Policy

## Scope

The code in this repository is educational. It demonstrates patterns such as ledgers, idempotency keys, outboxes and burn-and-mint transfers, and it is not production software. Even so, a flaw in a pattern can mislead people who copy it, so security reports are welcome.

Examples of reports in scope:

- A race condition, injection or validation gap in any of the demonstrated patterns.
- A way to replay, forge or tamper with a message that the article claims is rejected.
- A dependency with a known vulnerability that affects how the code runs.

## Reporting a vulnerability

Do not open a public issue. Use one of these private channels:

1. GitHub private vulnerability reporting: [open a draft security advisory](https://github.com/JosephNjorog/engineering-notes/security/advisories/new).
2. Email: mwangijoenjoroge@gmail.com, with the subject line `Security: engineering-notes`.

Please include the affected folder and file, a description of the issue, steps to reproduce, and its impact.

## What to expect

| Stage | Target |
|---|---|
| Acknowledgement | Within 3 working days |
| Initial assessment | Within 10 working days |
| Fix or mitigation | Depends on severity; you will be kept informed |

Confirmed issues are fixed in this repository, and where an article is affected, a correction is published. Reporters are credited unless they prefer to remain anonymous.

## Supported versions

Only the latest commit on `main` is supported.

# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting: open the repository's Security tab, choose "Report a vulnerability", and describe the problem, the version or commit you tested, and the steps to reproduce it.

You will get an acknowledgement in the report thread. Fixes are released as a normal version and credited in the release notes unless you ask to stay anonymous.

## Scope

In scope: the application code in this repository, the Dockerfile and compose quick start, and the sidecars under `scripts/`.

Out of scope: findings that depend on running the quick start (`auth.mode: none`) on an exposed network. That mode disables authentication by design and is for local evaluation only.

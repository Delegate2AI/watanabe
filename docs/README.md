# Watanabe documentation

These guides cover installing, configuring, operating, and extending Watanabe. Start with Getting started for a first run, then read Configuration and Authentication before exposing an instance to other people.

## Run it

- [Getting started](./getting-started.md): a first run with Docker Compose or a local development server.
- [Deployment](./deployment.md): the container image, persistent storage, probes, sidecars, backups, and upgrades.

## Configure it

- [Configuration](./configuration.md): every `portal.yaml` key, its default, and how values are resolved.
- [Environment variables](./environment.md): every environment variable the application reads.
- [Feature flags](./feature-flags.md): how flags work and what each one switches.
- [Authentication](./authentication.md): the `proxy-header`, `jwt`, `oidc`, and `none` modes.
- [OIDC sign-in](./oidc-auth-mode.md): the full OIDC guide.
- [Access control](./access-control.md): admins, groups, clearance, approvers, and sharing.

## Understand it

- [Architecture](./architecture.md): components, the chat request flow, on-disk state, and background jobs.
- [Knowledge base](./knowledge-base.md): connecting a GitLab or GitHub repository, the write path, the review queue, and search.
- [Integrations](./integrations.md): the MCP server, connectors, skills, meetings, rendering, dictation, personal LLM keys, and analytics.

## Contribute

- [Contributing](../CONTRIBUTING.md)
- [Security policy](../SECURITY.md)

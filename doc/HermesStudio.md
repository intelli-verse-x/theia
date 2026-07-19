# Hermes Studio downstream product

Hermes Studio is the Intelliverse X downstream product composed from this Eclipse Theia fork. It is launched only as an optional sibling of Hermes Desktop and connects to one exact Hermes workspace/session through an authenticated Unix-domain socket or Windows named pipe.

## Provenance and upstream synchronization

- Downstream repository: <https://github.com/intelli-verse-x/theia>
- Upstream repository: <https://github.com/eclipse-theia/theia>
- Product path: `examples/hermes-studio`
- First-party integration: `packages/hermes-bridge`
- Initial upstream base: `3595b053a48a1a4c7171aea0361a25f782140af9`
- Platform licenses: `LICENSE-EPL`, `LICENSE-GPL-2.0-ONLY-CLASSPATH-EXCEPTION`, `NOTICE.md`
- Extension registry: Open VSX through `examples/ovsx-router-config.json`

The fork's `upstream` remote is fetched and downstream changes are rebased or merged on a reviewed branch. Each Hermes Studio release records both the downstream product commit and upstream base in its signed manifest. Never push product changes directly to `master`.

## Security boundary

The `@theia/hermes-bridge` backend reads a per-launch endpoint and 256-bit token from its process environment, authenticates protocol v1 with request ID and expiry, and exposes only typed frontend RPC. Hermes Desktop creates an unpredictable endpoint, sets Unix sockets to mode `0600`, and verifies the token with a constant-time comparison before accepting any capability; Windows uses a per-launch named pipe. The bridge validates bounded response schemas and exposes only the fixed capabilities declared in `hermes-protocol.ts`. The extension can submit selected context and observe route/approval state. It cannot read provider keys, change routing/local-only policy, approve actions, or execute model shell/file/computer-use operations.

Voice requests use the same Hermes session and are rejected as approval input. Restricted workspaces cannot submit WorkspaceEdit reviews. Actual edits, terminal commands, computer use, git mutations, and worktree operations stay behind Hermes Desktop's structured approval broker.

## Build and local run

Use Node.js 22 or 24:

```sh
npm ci
npm run compile --workspace @theia/hermes-bridge
npm run test --workspace @theia/hermes-bridge
npm run build --workspace @theia/hermes-studio
HERMES_STUDIO_ENDPOINT=/private/path/to/studio.sock \
HERMES_STUDIO_TOKEN=one-time-token \
HERMES_STUDIO_SESSION_ID=session-id \
HERMES_STUDIO_WINDOW_ID=window-id \
HERMES_STUDIO_WORKSPACE=/absolute/workspace \
npm run start --workspace @theia/hermes-studio
```

Without the authenticated launch environment, the product still edits files but Hermes commands remain offline and fail closed.

## Release contract

CI builds non-publishing macOS, Windows, and Linux product candidates. A release workflow must produce platform/architecture archives, SHA-256 hashes, expanded size, minimum Desktop/protocol version, upstream base, product commit, and Ed25519 signature. Hermes Desktop downloads only after explicit consent, extracts into a staging directory, health-checks the candidate, and atomically activates an A/B slot. Failure rolls back to the previous slot.

No application binary belongs in Git. GitHub Releases (not the upstream npm publishing process) are the intended product artifact origin. No Hermes Studio release exists at the time of this foundation change.

## Documentation publishing

This repository's established documentation publication is the `publish-api-doc-gh-pages.yml` GitHub Pages workflow described in `doc/Publishing.md`. There is no repository-defined S3 bucket, prefix, AWS identity, sync command, or CloudFront invalidation for these docs. Do not guess or publish to S3 from this repository. Product documentation remains source-reviewed here until an authorized destination is explicitly established.

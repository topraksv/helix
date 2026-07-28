# Threat-modeling workflow

Use this when a feature adds or changes a trust boundary. It is adapted from
Anthropic's `defending-code-reference-harness` threat-modeling workflow and
constrained to Helix's canonical documents.

## Model

1. Inventory the changed entry points, data stores, external services,
   privileged operations, and cleanup/revocation paths.
2. Draw the data flow in prose: source → validation → authorization → mutation
   or disclosure → persistence → later consumers.
3. Mark trust transitions and attacker-controlled fields.
4. For each protected asset, state:
   - attacker capability and required preconditions;
   - broken invariant or control;
   - user impact;
   - existing prevention and detection;
   - concrete verification.
5. Prioritize reachable loss of confidentiality, integrity, authorization,
   availability, or recoverability. Do not rank by vulnerability label alone.
6. Update `docs/SECURITY.md` only if the durable boundary, control, or
   verification matrix changed.

## Helix-specific attacker perspectives

- unauthenticated remote caller;
- authenticated caller presenting another owner's identifier or row;
- stale authenticated task after account switch;
- malformed or oversized import/backup/provider payload;
- crafted deep link or route param;
- compromised or malicious package, Action, skill, or generated instruction;
- person with a locked or backgrounded device;
- accidental owner action that must remain recoverable.

Do not invent multi-tenant infrastructure for hypothetical scale. Owner scope,
UUID identities, integer money, recoverable backups, and fail-closed session
boundaries already preserve the next stage without expanding today's product.

# Pro embed integration contract

Purpose: define the boundary this Labs repo owns for JWT/token, Pro entitlement, lab resolution, completion handoff, and parent-window messaging. This is contract documentation only. The repo does not implement server-side auth today.

## Owned here

- Maintain the private 60-lab catalog in `src/labs/catalog.ts`.
- Keep `getLabById(labId)` as the catalog lookup used by the future embed route.
- Preserve the public free route as ten free CCNA starter labs.
- Preserve the Pro split: 60 catalog labs require Pro.
- Keep `/try` independent from the full catalog so public users cannot load Pro labs through the free route.
- Provide UI and simulator state that can report a completion message when every lab objective is met.

## Owned by the main CertHead app or API

- Mint and validate JWTs or equivalent signed tokens.
- Verify token signature, issuer, audience, expiration, replay controls, and user identity.
- Verify Pro entitlement against the account subscription.
- Decide the allowed parent origin for iframe embedding.
- Persist completion, progress, attempts, scores, and analytics that require user identity.

## Token claim contract

The future embed surface should treat the token payload as an input contract from the main CertHead app or API:

- claim: labId
  - Required.
  - Value must match a registered catalog id.
  - The Labs repo resolves it with `getLabById(labId)`.
- claim: entitlement
  - Required.
  - value: pro
  - Required for every non-free lab.

Safe failure behavior: unknown, missing, expired, or non-Pro tokens fail closed. They must not fall back to `/try`, query-string lab loading, the first catalog lab, or any random Pro lab.

## Free and Pro split

- Public `/try`: ten free CCNA starter labs.
- Pro embed: JWT-gated access to the 60 catalog labs.
- The private catalog remains part of the $9.99 CertHead Pro bundle.
- The question and exam tier must not expose private labs.

## Parent-window messaging and completion handoff

The future embed route should send a completion message only after `session.allMet` is true for the current lab. The message should be sent with `window.parent.postMessage` to the configured CertHead parent origin.

Contract shape:

```ts
type LabCompletionMessage = {
  type: 'certhead.lab.completed';
  labId: string;
  commandCount: number;
};
```

Safety guardrails:

- The targetOrigin must not be `*`.
- Ignore inbound parent messages unless the origin is explicitly allowed.
- Do not include secrets, JWTs, email addresses, or billing data in completion messages.
- If completion handoff fails, the learner can still complete the lab locally. Persistence belongs to the main CertHead app or API.

## Current implementation status

- `/embed` is not implemented in this repo.
- JWT parsing and entitlement checks are not implemented in this repo.
- Completion persistence is not implemented in this repo.
- This file is the integration-readiness boundary for the next repo or API integration batch.

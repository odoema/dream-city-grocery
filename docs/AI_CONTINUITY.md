# AI Continuity Procedure

## Objective

A temporary loss of ChatGPT, Claude, Gemini, Copilot, or another AI must not stop Dream City Grocery development or erase project knowledge.

## Golden rule

**Chat is not the source of truth.** Durable project knowledge belongs in GitHub, the dedicated Supabase project, and the project's documented Google automation/storage.

## What must always be committed

- architecture decisions
- database schema/migrations
- API/RPC contracts
- deployment configuration that is safe to publish
- test procedures and results
- known bugs and blockers
- production verification status
- important user/business requirements
- AI handoff updates

Never commit passwords, private tokens, service-role keys, or other secrets.

## Handoff protocol

When a work session ends, update `AI_START_HERE.md` if the project state or next task changed materially. Commit the update with a clear message.

Recommended final-session note:

```text
STATE: <verified / development / blocked>
LAST COMMIT: <sha>
WHAT CHANGED: <short summary>
WHAT WAS TESTED: <short summary>
WHAT FAILED: <short summary>
NEXT SAFE STEP: <one concrete step>
DATABASE STATE: <verified / unverified>
DEPLOYMENT STATE: <verified / unverified>
```

## If ChatGPT is unavailable

1. Open this repository.
2. Read `AI_START_HERE.md`.
3. Read `README.md`.
4. Read `SUPABASE_SETUP.md` before database work.
5. Inspect the current GitHub branch and recent commits.
6. If another AI is available, provide it `AI_START_HERE.md` first.
7. Continue only from verified repository state.
8. Mark database/live state as unverified when Supabase access is unavailable.

## If GitHub is unavailable

Do not make risky production changes based only on memory. Work from the latest local clone if available, preserve local commits, and reconcile with GitHub when access returns.

## If Supabase is unavailable

Continue documentation/UI/code work only where safe. Do not invent database results. Do not run changes against SmartAttend as a substitute.

## Recovery test

At least periodically, start a clean AI session and provide only `AI_START_HERE.md`. The AI should be able to explain the project identity, safety boundaries, architecture, current baseline and next task without relying on previous conversation history.

## Success criterion

A four-day AI outage should cause inconvenience, not project loss.

# PLEC Concierge (Plecathon agent)

## What this is
A chat agent for PLEC's customers. It browses venues and event services, answers questions about them, and books them through PLEC's sandbox API. It speaks the HTTP contract in `docs/contract.md`, and it's judged on interaction quality by public and hidden scripted scenarios (`docs/checks.md`). This is a hackathon build with a 3:30pm deadline.

## Stack
- Backend: Node 20.19+, ES modules, zero dependencies (except the optional `@anthropic-ai/sdk`). `backend/agent/server.js` is the HTTP API and `backend/agent/agent.js` is the brain.
- Frontend: React + Vite in `frontend/`. `frontend/src/Concierge.jsx` is the chat UI, and it proxies `/agent` and `/api` to the backend.
- Main model: Kimi via PLEC's OpenAI-compatible proxy (`backend/agent/llm.js`). The per-team quota is tight, so keep model rounds few.
- Sandbox client and tool definitions are in `backend/agent/plec.js`.

## Commands
- `npm install` installs the frontend (via postinstall) and any backend dependency.
- `npm start` starts the backend on `AGENT_PORT` (8787) and the frontend on `FRONTEND_PORT` (3000).
- `npm run backend` starts only the agent.
- `npm test` runs the public scenarios (the server scores them).
- `npm run test:unit` runs the unit tests (`node --test "backend/tests/unit/**/*.test.js"`).
- `node backend/tests/local/run.js [id]` runs the local copies of the hidden-theme scenarios, once A7 exists.

## Spec: two PRDs, two parallel sessions
- `docs/prd/PRD-A-core.md` belongs to Person A, on branch `feat/core`. It covers the turn loop, prompt, memory, the confirmation gate and the booking flows.
- `docs/prd/PRD-B-experience.md` belongs to Person B, on branch `feat/experience`. It covers rich parts, vibe and photo, location, recommendations, email, market insights and the UI.
- `PRD.md` and `plan.md` at the root are an earlier plan. **Don't build from them.** Where they disagree with `docs/prd/`, `docs/prd/` wins.
- If it's unclear which PRD you're on, ask your human.
- Only edit files that your PRD's ownership table (section 3.2) gives you. Frozen files and the other person's files need your human's go-ahead.
- The PRD is the source of truth. Flag gaps or ambiguities instead of filling them in yourself. After a behaviour change, say which PRD section needs updating. Don't edit a PRD without a go-ahead.

## Conventions
- Match the existing code style: small modules, JSDoc on exports, and no build step on the backend.
- Ask before adding dependencies. `@anthropic-ai/sdk` is the only approved one.
- Every fact the agent states comes from a tool result. State-changing tools go through the confirmation gate.
- A turn never throws, and it always returns at least one text part.

## Secrets
- Never read `.env` or any `.env.*` file with real values. `.env.example` lists the variables.
- If you need a value, ask your human.

## Definition of done
- `npm run test:unit` and `npm test` pass, and the relevant local scenarios pass.
- Commit once per task, then stop and report.

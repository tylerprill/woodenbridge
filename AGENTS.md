<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Required pre-push UI verification

Before every Git push that includes code changes, run a browser-based UI smoke
test against the running application. This is a required pre-push gate, not an
optional follow-up.

- Exercise the user-facing flow affected by the change with realistic test
  data. For non-visual changes, smoke-test the closest affected UI route.
- Check both a normal desktop viewport and a mobile viewport. For responsive or
  mobile changes, also verify the smallest supported portrait size and a mobile
  landscape size.
- Confirm that the page renders, the primary interaction completes, layout does
  not overlap or clip, and the browser console has no new warnings or errors.
- Capture screenshots for visual changes and include the tested viewports in the
  handoff.
- Do not push until the UI smoke test passes, unless the user explicitly accepts
  a documented blocker.

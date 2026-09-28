# Road-trip field-test backlog

Captured on September 28, 2026 after the first real road-trip use of Field
Atlas. This is the working product backlog for the resulting improvements. The
item numbers preserve the order in which the feedback was recorded; they do
not assign implementation priority.

This direction supersedes conflicting parts of
[`atlas.md`](./atlas.md) and [`photo-import.md`](./photo-import.md), especially
where those documents make bulk photo import or Journey creation a primary
Atlas action.

## Agreed product model

- **Memory** — one moment, place, or experience. A Memory can contain multiple
  photographs.
- **Journey** — the complete trip: an ordered collection of Memories that can
  span one day or many days.
- **Segment** — an optional named section inside a Journey, such as **Day 2**,
  **Morning**, or **Pacific Coast**. Short Journeys do not need a Segment.
- **Atlas** — the authenticated map and home experience for exploring Memories
  and Journeys and quickly creating a Memory.

Keep the name **Journey**. Do not rename it to **Day Trip**, which would imply
that the traveler returns home on the same day. Use Segments when a Journey
needs distinct days or stages.

The primary product navigation should contain only:

1. Atlas
2. Memories
3. Journeys

Account and administrative actions can remain in a separate account menu; they
are not part of this product-navigation constraint.

## Backlog

### 1. Create a multi-photo Memory from Memories

**Status:** Implemented and browser-verified; deployment remains. The
Memories-page entry point opens Atlas directly in new-Memory placement mode,
and the Memory drawer accepts multiple photographs in one or more selections.

The current code supports adding multiple photographs to one Memory. The
Memory drawer accepts multiple files in one selection, supports repeated
selections, and currently limits each Memory to six photographs. Today, the
flow is only exposed through Atlas:

1. Open **Atlas**.
2. Select **Add memory** and place the pin.
3. In the new Memory drawer, select **Upload photos**.
4. Select multiple photographs together, or add them in later selections,
   before reaching the six-photo limit.

The flow is now exposed from **Memories**:

- [x] Present the collection page as **Memories** everywhere in the UI.
- [x] Add a clear **New memory** CTA to the Memories list page, including its
      empty state.
- [x] Let that flow select or capture multiple photographs for one new Memory.
- [x] Let the user enter the title, description, date, and location once for
      the entire Memory.
- [x] Preserve clear per-photo progress, failure, retry, and removal behavior.
- [x] Keep the existing six-photo limit for now so the first version preserves
      the established upload, retry, and card-display constraints.

**Acceptance criteria:** A user can begin on Memories, create one Memory, add
multiple photographs to it in one or more selections, save it, and see exactly
one new Memory in the list containing every successful photograph.

### 2. Resolve the deployed multi-image upload failure

**Status:** Fixed, merged, and deployed. Post-deployment authenticated browser
verification remains.

On the deployed Atlas, the multi-image upload currently fails with a Vercel
client-ID or token error. The original failing network response was not
captured, so this is not a forensic confirmation of that exact error.

Both the Memory drawer and bulk importer use the same media-upload client and
server route. The repaired path no longer derives browser upload credentials
from the long-lived `ATLAS_BLOB_READ_WRITE_TOKEN`. It now uses the deployment's
short-lived Vercel OIDC identity to issue a pathname-, operation-, type-, size-,
and expiry-scoped presigned URL. Completion callbacks are verified with the
store's public webhook key before an upload is marked complete. A legacy
read-write token remains available only as an explicit local or non-Vercel
fallback.

The production-equivalent authorization path was validated against the
configured private Blob store with a disposable object: OIDC token issuance,
presigned upload, metadata read, and exact-object deletion all completed
successfully. Unit coverage also exercises the installed Blob SDK's presigning
contract and verifies valid, missing, and tampered completion signatures.

- [ ] Reproduce the failure in the deployed application with realistic files.
- [ ] Record the exact browser-console and network response without exposing
      credentials.
- [x] Remove the legacy client-token authorization path shared by Atlas bulk
      import and the Memory drawer.
- [x] Prefer the connected store's OIDC identity even when a stale legacy Blob
      token is also present.
- [x] Preserve upload-intent ownership, pathname, type, size, expiry, and
      no-overwrite constraints in the presigned flow.
- [x] Verify callback signatures before changing upload state.
- [x] Add regression coverage for authorization, presigning, callback
      verification, credential selection, and the shared browser upload client.
- [x] Run a disposable OIDC + presigned-upload canary against the configured
      private Blob store and delete the exact test object.
- [x] Deploy the repaired upload path.
- [ ] Confirm whether the deployed error affected both the Atlas importer and
      the existing Memory drawer's multi-photo control.
- [ ] Verify successful upload and recovery on desktop and mobile browsers.

**Scope decision:** The current Atlas bulk importer can create multiple
Memories and optionally a Journey. Item 6 removes Journey creation and separate
bulk-import actions from Atlas. Before repairing that particular UI, decide
whether it will be removed. Fix any shared upload defect needed by the new
multi-photo Memory flow even if the old Atlas importer is retired.

**Acceptance criteria:** The retained multi-photo Memory flow completes in the
deployed application without a client-ID/token error, and a failed upload can
be retried without creating duplicate Memories or photographs.

### 3. Add optional Segments inside Journeys

**Status:** Implemented and browser-verified; deployment remains.

Treat a Journey as the complete trip and let travelers divide a longer Journey
into optional named Segments. A one-day trip should remain simple and never
require Segment setup.

- [x] Add owner-scoped Segment storage, ordering, and Memory membership.
- [x] Keep all existing Journeys valid without requiring a Segment migration.
- [x] Show Segment boundaries and a compact, horizontally scrollable Segment
      index in the Journey reader.
- [x] Make **Continue journey** default to the latest Segment while allowing
      the traveler to choose any existing Segment from a native, scalable
      selector.
- [x] Let the traveler create a new Segment as part of saving the next Memory,
      so cancelling does not leave an empty Segment behind.
- [x] Suggest a new day Segment when the Memory date differs from the selected
      Segment's latest date, while keeping the choice editable.
- [x] Let each Segment's heading continue directly into that Segment.
- [x] Preserve Segment membership when a Journey is edited and limit Memory
      reordering to within a Segment.
- [x] Remove the Adventures page and primary-navigation destination now that
      Journey Segments cover multi-day and multi-stage trips.

**Acceptance criteria:** A short Journey still works with no Segment. A
multi-day Journey can add and revisit many named Segments, continue the latest
one in one action, target an older Segment without scrolling through buttons,
and start a new Segment without leaving empty records after cancellation.

### 4. Continue an existing Journey

**Status:** Implemented and browser-verified; deployment remains.

Add a **Continue journey** action to a Journey. It should open the Memory
creation experience with the Journey association already selected, supporting
the common pattern of adding a lunch Memory and then another Memory later in
the afternoon.

- [x] Add **Continue journey** to the Journey detail experience.
- [x] Route **Continue journey** into a dedicated **Add a memory** step in the
      Journey workshop instead of returning to Atlas.
- [x] Start the placement map near the Journey's latest stop and retain the
      requested Segment as the default target.
- [x] Open a new-Memory flow that accepts photographs, title, description,
      date, and location.
- [x] Associate the saved Memory with the source Journey automatically.
- [x] Append the Memory in a predictable position and allow the user to reorder
      it using the existing Journey tools.
- [x] Return the user to a clear Journey context after saving or cancelling.
- [x] Avoid leaving an orphaned Journey item when creation is cancelled or an
      upload fails.

The new Memory is appended as the final Journey stop with an empty transition
note; the existing Journey editor remains the place to reorder it or add that
transition. Saving the Memory and adding its Journey membership happen in one
transaction. Cancelling after placing a pin archives the unkept draft and its
uploaded media before returning to the Journey.

**Acceptance criteria:** Starting from a Journey, a user can create a Memory
and see it added to that Journey without reopening the Journey editor or
manually selecting the Journey.

### 5. Simplify navigation and align the language

**Status:** Implemented for the three agreed destinations.

Use the agreed product navigation: **Atlas**, **Memories**, and **Journeys**.

- [x] Make Atlas the authenticated home page.
- [x] Make Memories a list page with a **New memory** CTA.
- [x] Replace user-facing **My places**, **collection**, **saved places**, and
      similar object names with **Memories** where they refer to Memories.
- [x] Make Journeys a list page with a **New journey** CTA.
- [x] Keep Segments inside Journeys instead of adding another primary
      destination.
- [x] Remove **Upload photos** and **On this day** as primary navigation items.
- [x] Preserve useful rediscovery behavior such as On this day within Atlas or
      Memories rather than treating it as another top-level destination.
- [x] Preserve compatible redirects or internal route names where changing
      them would add risk without improving the user experience.
- [x] Keep internal `chapter` naming private to compatibility code; all
      user-facing language should say **Journey**.

**Acceptance criteria:** The primary navigation contains only the three agreed
destinations, each term has one consistent meaning, and each list page exposes
the expected creation CTA on desktop and mobile.

### 6. Reduce Atlas to Memory capture and exploration

**Status:** Implemented in code; browser verification remains.

Remove every way to create a Journey from the Atlas map. Atlas should expose
one primary creation action, **Add memory**, plus a **Memories / Journeys**
view filter.

- [x] Remove the Atlas Journey builder and every Atlas **Create journey** entry
      point.
- [x] Remove Journey suggestions that start a Journey-creation flow on Atlas.
- [x] Remove the separate Atlas **Upload photos** action; multi-photo capture
      should be part of **Add memory**.
- [x] Keep Journey viewing and playback available through the Journeys side of
      the **Memories / Journeys** filter.
- [x] Keep Journey creation exclusively on the Journeys list page.
- [x] Keep ordinary map necessities, such as navigation and accessibility
      controls, unless a separate decision removes them.

**Acceptance criteria:** Atlas has no path that creates a Journey. A user can
switch between Memory and Journey map content, create a Memory containing
multiple photographs, and inspect an existing Journey.

### 7. Start Atlas near the user's current location

**Status:** Not started.

When possible, initialize the Atlas map near the user's current approximate
coordinates. Exact or continuous tracking is not required.

Geolocation is not currently implemented and the application's
`Permissions-Policy` explicitly disables it. Atlas currently starts from the
user's saved map view when one exists, otherwise from a world-level fallback.
Implementation therefore needs both a narrowly scoped policy change and a
decision about whether a fresh location or the saved view takes precedence.

- [ ] Allow same-origin geolocation in the `Permissions-Policy` while keeping
      it unavailable to other origins.
- [ ] Use browser geolocation only with the user's browser-managed permission.
- [ ] Request a one-shot, low-accuracy location rather than continuous or
      high-accuracy tracking.
- [ ] Use the result to set the initial map camera without creating or storing
      a Memory or silently persisting the user's live location.
- [ ] Avoid repeatedly recentering after the user begins moving the map.
- [ ] Fall back to the existing default camera when permission is denied, the
      request times out, geolocation is unavailable, or the result is invalid.
- [ ] Keep the rest of Atlas usable while location is pending or unavailable.
- [ ] Verify the permission, success, denial, timeout, and unsupported cases.

**Acceptance criteria:** With permission, Atlas begins near the user's current
location. Without it, Atlas opens normally at its safe default with no blocked
controls, broken layout, or repeated permission loop.

### 8. Display Memory times for quick chronological sorting

**Status:** Implemented and browser-verified; deployment remains.

Add an optional time-of-day to each Memory so travelers can quickly understand
and sort the order of several Memories from the same date. This should represent
when the Memory happened, not merely when its database record was created.

- [x] Add an optional occurrence time to the Memory data model and creation and
      editing flows.
- [x] Prefill the time from reliable photograph capture metadata when available,
      while keeping it editable.
- [x] Display the occurrence time alongside the date on the Memories list and
      other compact Memory cards where chronology matters.
- [x] Let the Memories list sort chronologically using the occurrence date and
      time, in both newest-first and oldest-first order.
- [x] Keep Memories without a known time usable and place them predictably among
      timed Memories from the same date.
- [x] Preserve a stable order when two Memories have the same timestamp.
- [x] Handle the trip's local time and timezone offset without silently shifting
      a Memory to another calendar date.
- [x] Keep record-created and record-updated timestamps available for internal
      auditing, but do not present them as the Memory's occurrence time.

**Scope decisions:** Use the earliest reliable capture time among the
successfully uploaded photographs as the editable default. If no reliable
capture time exists, keep the occurrence time unknown rather than substituting
the record-creation time. Store and display the local wall-clock time, with the
capture timezone offset when available, so travel across timezones does not
silently change the Memory's calendar date.

**Acceptance criteria:** If a traveler records several Memories on one day, the
Memories page displays each known time and can sort them into the order they
happened. Memories with no known time remain visible in a consistent position.

## Open product decisions

- Retire the existing Atlas bulk importer completely, or reuse parts of it
  behind the Memories **New memory** flow?
- Should On this day live within Memories or on Atlas?
- Should Atlas request location on first load, or wait for an explicit
  location action before triggering the browser permission prompt?
- When both exist, should the user's current approximate location or their
  previously saved Atlas view determine the initial camera?

## Prioritized delivery sequence

This sequence puts reliability and the core capture experience ahead of larger
model changes:

1. **P0 — Deploy and verify item 2.** Confirm the repaired upload path on
   desktop and mobile before building more capture flows on top of it.
2. **P1 — Items 5 and 6: simplify navigation and Atlas.** Establish the three
   agreed destinations, align the language, and remove Journey creation and the
   separate bulk-import action from Atlas.
3. **P1 — Items 1 and 8: complete the Memories experience.** Add the Memories
   **New memory** flow with multiple photographs, then display and sort by the
   time each Memory happened.
4. **P2 — Item 4: continue a Journey.** Reuse the completed Memory-creation flow
   to append a Memory directly to an existing Journey.
5. **P2 — Item 7: location-aware Atlas start.** Add approximate one-shot
   geolocation with a safe fallback after the core Atlas controls are settled.
6. **P2 — Item 3: Journey Segments.** Add optional, scalable days or stages to
   the shipped continuation flow without adding another primary object.

## Verification required for each UI change

- Exercise the affected end-to-end flow with realistic photographs and data.
- Verify a normal desktop viewport and mobile portrait viewport.
- For responsive changes, also verify the smallest supported portrait size and
  a mobile landscape size.
- Confirm no overlap or clipping and no new browser-console warnings or errors.
- Capture screenshots for visual changes before pushing code.

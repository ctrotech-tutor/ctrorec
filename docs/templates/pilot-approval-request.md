# Approval request — scripted ctrorec capture pilot

- **To:** [Pilot owner], [Privacy owner], [Academic owner], [Technical owner]
- **Institution / faculty:** [Name]
- **Proposed hall and date:** [Hall], [Date and time]
- **Requested decision:** Approval for four scripted, consented test recordings and their listening/evidence review

## Purpose

We request permission to test whether ctrorec can capture understandable scripted teaching in a real hall using the intended phones and networks, and whether an enrolled test listener can understand the original and data-saver copies.

This approval is for **four approximately five-minute recordings using `pilot-script-v1.txt` only**. It is not approval to record a real lecture, capture student speech, use production storage, or deploy the service.

## Scope

| Item             | Proposed scope                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Captures         | A: stationary baseline; B: walking/turning; C: back of hall; D: baseline repeated over a mobile carrier       |
| Script           | `docs/templates/pilot-script-v1.txt`; no student names or private teaching content                            |
| Lecturer device  | [Actual phone model, OS, browser, microphone]                                                                 |
| Listening device | [Actual phone model and speaker/earpiece]                                                                     |
| Networks         | A–C: [campus/institutional Wi-Fi]; D: [mobile carrier]                                                        |
| Environment      | [Approved ctrorec environment and disposable course offering]                                                 |
| Test accounts    | [Lecturer, enrolled test student, institution administrator]; no real student roster is required              |
| Listeners        | [Number and non-identifying labels]; listeners did not write the script and consent to the listening exercise |
| Coordinator      | [Name/role]                                                                                                   |
| Deletion owner   | [Name/role authorized to approve and perform deletion]                                                        |

Any unavailable device, network, or hall condition will be marked blocked or uncovered. The team will not silently substitute a different condition or add interruption scenarios to this first session.

## Information handled

- Scripted original audio and its data-saver derivative.
- Lecture/course metadata and the visible capture UUID.
- Capture timeline, declared recorder MIME type, consent-attestation timestamp, saved chunk count, local persistence result, stop reason, and browser-reported hashing/upload timing and chunk retry count.
- Server original/derivative size, checksum, processing outcome, and deletion timestamps.
- Non-identifying device, hall, network, listening, and coordinator observations in the field sheet.
- Session/authentication data required by the existing application.

The team will not place student names, private lecture content, passwords, cookies, invitation/recovery links, storage keys, or signed media URLs in the script, field sheet, listening sheet, or evidence filenames. No external-model training, unrelated analysis, student uploads, or public sharing is authorized.

The current local filesystem adapter and preview are development/test infrastructure, not durable production storage. This pilot does not approve a storage provider or production rollout.

## Recording and listening procedure

1. Display the approved notice and obtain the lecturer's and listeners' agreement before starting.
2. Inspect device battery, free storage, browser permission, and the disposable course offering. Keep the capture tab foregrounded.
3. Create a separate draft lecture for each of A–D. Record the visible capture UUID before upload.
4. Use the same script, ordinary teaching volume, and specified position/action/network. Preserve failed and incomplete samples in the evidence sheet.
5. Stop and review locally, then upload the original. Verify original playback independently before comparing the data-saver copy.
6. Present original and derivative samples in randomized order without identifying codec or bit rate during scoring. Record word/term accuracy, listening effort from 1 (effortless) to 5 (could not follow), dropouts, and listener count.
7. Export server evidence before any media deletion. Complete cleanup only after listening and evidence review, unless an incident requires earlier action by the deletion owner.

Screen locking, calls, low storage, disconnection, background recording, and full-length lectures are outside this first four-capture approval. They require a separate reviewed interruption/full-session matrix.

## Retention, exports, and deletion

- **Evidence custodian:** [Name/role]
- **Field-sheet/export retention period and location:** [Approved period and access-controlled location]
- **Local-draft/download rules:** [Shared-device, browser-profile, and deletion rules]

For each capture approved for deletion:

1. Register the pre-deletion capture CSV as an evidence item.
2. Place a retention hold instead of deleting if further review is needed.
3. After approval, use **Administration → Course offerings → Media retention**, enter the reason, and confirm `DELETE MEDIA`.
4. Wait for **Media deleted** and record request/completion timestamps. A request or revoked player alone is not proof of object completion.
5. Register the post-deletion capture CSV and verify preserved capture/deletion evidence with blank removed-media fields.
6. Remove remaining local drafts and handle downloaded audio, exports, listening sheets, and field notes according to the approved retention procedure.

Historical backups, external exports, provider backups, and CDN caches are not guaranteed to be erased by this workflow. Their use requires separate approval and procedures.

## Acceptance thresholds to ratify before reviewing outcomes

| Measure                                        | Agreed threshold                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Original word/term accuracy                    | [Value or decision rule]                                             |
| Data-saver word/term accuracy                  | [Value or decision rule]                                             |
| Median listening effort, original / data-saver | [Values from 1–5]                                                    |
| Original decode/playback failures              | [Maximum tolerated and required action]                              |
| Capture-reference/evidence correlation         | [Value or decision rule]                                             |
| Data-saver size/listening trade-off            | [Value or decision rule]                                             |
| Privacy, retention, and deletion review        | [Required sign-off]                                                  |
| Decision after A–D                             | [Proceed to interruption tests / repeat short matrix / stop and fix] |

Thresholds must not be backfilled after seeing preferred results. Failed, blocked, and inconclusive captures remain in the report.

## Stop and escalation conditions

Stop the affected capture or review and notify [incident owner/contact] if there is accidental personal content, unexpected access, cross-tenant exposure, a lost/shared-device concern, an unapproved recording condition, or another privacy/security incident. Do not conceal the event by simply deleting evidence; follow the institution's incident procedure.

Record technical failures—permission denial, incomplete drafts, upload failure, decode failure, derivative failure, or deletion remaining incomplete—without converting them into claims of success.

## Approval

| Role            | Name | Decision and conditions | Signature / date |
| --------------- | ---- | ----------------------- | ---------------- |
| Pilot owner     |      |                         |                  |
| Privacy owner   |      |                         |                  |
| Academic owner  |      |                         |                  |
| Technical owner |      |                         |                  |
| Deletion owner  |      |                         |                  |

Approval applies only to the scope and conditions recorded above. A real lecture, additional participants, interruption/full-length scenarios, production storage, or deployment requires separate review.

## Execution references

- `docs/field-pilot.md` — first-session and evidence procedure
- `docs/templates/pilot-script-v1.txt` — approved spoken script and coordinator scoring list
- `docs/templates/field-session-sheet.csv` — non-identifying session record
- `docs/media-evidence.md` — technical, listening, network, and cost measurement boundaries
- `docs/media-retention.md` — hold, deletion, completion, and evidence semantics

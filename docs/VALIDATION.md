# Validation record

Date: 2026-09-27. Local Windows development environment, .NET 10.0.401, Node 24.14.1, ImageSharp 3.1.12. All iPhone-specific checks remain pending until tested on a real device. Simulated analysis cannot establish food-recognition quality, cost or actual API latency.

## Passed

- `dotnet build`: zero errors and zero warnings with the pinned library.
- `npm run build`: ZXing module bundled successfully. `npm run check`: application and service-worker JavaScript syntax passed. Dependency install reported zero npm vulnerabilities.
- `python tests/smoke.py`: real HTTP integration tests passed against isolated temporary data and synthetic images.
- Authentication and private preview authorization, bad-password rejection and logout.
- Upload returns before the eight-second simulated analysis; a second symptom entry can be saved while it runs.
- Large PNG -> lossy WebP, <=2MP; small image never upscaled. Parsed resulting WebP frame dimensions match server metadata. EXIF orientation is applied and EXIF/XMP/ICC chunks are absent.
- Repeated upload ID does not create a duplicate.
- Worker and session keys recover after process restart. Results and previews remain available; originals are removed after completion.
- Simulated failure retains its original; advancing its recorded age beyond 24 hours removes it; retry still completes using retained preview state.
- Invalid image produces a visible failure without losing the diary entry.
- CSV parses, includes simulation provenance, leaves skipped ratings empty, and neutralizes a spreadsheet-formula test value.
- Browser UI: signed in, saved an independent symptom, selected/uploaded synthetic PNG, saw immediate queued entry, then WebP preview, then simulation completion and original-deleted indicator. No browser warning/error logs observed.
- Layout visually inspected at 390 × 844 CSS pixels. This is desktop responsive inspection, not an iPhone emulator or actual device pass.
- Browser barcode test decoded synthetic EAN-13 `3017620422003`; live Open Food Facts lookup returned a matching Nutella product and ingredient text. Packaging data may be localized or incomplete; no inference about personal consumption was made.

## Still pending

- Actual iPhone camera/library, HEIC behavior, Home Screen install, denied camera permissions, offline/suspension recovery and native CSV sharing.
- Docker image build and deployment on Railway/Linux, persistent-volume setup and hosted HTTPS.
- GitHub Actions execution after source publication. Workflow is present but has not run remotely.
- Real model integration, image handling by the API, provider retention settings, evaluation quality, latency and cost.
- All full-product work outside this initial validation milestone (see PROJECT-PLAN.md).

Only synthetic images and test ratings were used. Real images, health information, runtime data and credentials are excluded from Git. Initial source publication was explicitly authorized by the owner after local validation. No runtime data or credentials are included.

## 2026-09-28: compressed-image recognition integration

Implemented opt-in OpenAI Responses integration, exact preview payloads for meals, bounded higher-resolution label input, strict output schema, provenance/usage persistence, safe billing/access/refusal/incomplete-result errors, scheduled bounded retries, UI mode disclosure and CSV data. Added local `-WithAI` launcher and Railway variables.

The automated recognition suite uses a loopback fake provider and synthetic images. It does not demonstrate real model accuracy, live API availability or measured costs. No real OpenAI requests were made while the owner was arranging credits. Real-device testing and original-versus-preview quality evaluation remain pending.
`dotnet build` completed with zero warnings/errors. `npm run check`, `python tests/smoke.py` and `python tests/recognition.py` all passed for this integration.


## Diary usability update — 2026-09-28

Implemented compact Add / Timeline / More navigation, locally bundled Lucide SVG icons, optional pre-analysis descriptions, automatic photo interpretation, integrated barcode lookup with AI fallback, and per-entry ingredient/title corrections. Original suggestions and manual ingredients remain separate in storage and CSV. No production deployment is included in this update.

Validation: .NET build, JavaScript syntax, HTTP smoke and fake-provider tests cover multipart descriptions, automatic label handling, ingredient removal/addition, preservation of edits during analysis, saved JSON/CSV, product lookup and missing-product AI fallback. Mobile browser review uses a 390 × 844 viewport. Real iPhone barcode and automatic small-print label accuracy still need device testing.

Browser verification: saved a photo with optional description, corrected the title, added two ingredients, removed one, and reopened to verify persistence. A barcode fixture (3017620422003) used the same picker and saved Nutella plus Open Food Facts ingredients. Verified Add, Timeline and More at 390 × 844; fixed a stale photo-info element reference found during testing. No live OpenAI call was used for this update.


Update/deletion checks: build and JS checks pass; six update-lifecycle tests cover safe automatic reload, blocked unsaved work, foreground checks, offline failure and loop prevention. HTTP recognition regression verifies deleted entries disappear from persisted JSON/CSV and both image paths, with idempotent repeated deletion. Existing smoke suite passes. Local HTTP checks confirm version metadata matches the endpoint, HTML/version are not cached, and the service worker script revalidates. Device suspension behavior still requires an iPhone after deployment.


## Camera upload 400 investigation

Railway recorded iPhone photo PUT requests returning 400 before analysis. The existing release returned empty responses for several validation failures, so the exact rejected field could not be identified from logs. Camera files are now copied into independent byte-backed Blobs before clearing the file input or storing the draft, and copied again when building multipart uploads (including existing drafts). Empty, unreadable, or incomplete files receive an actionable error. Upload validation errors are now shown in the app.

Node tests cover byte independence after camera reference changes, draft cloning, multipart contents, and unreadable photos. The loopback recognition suite covers extensionless camera uploads with empty optional fields and a useful missing-photo response. A physical iPhone retry after deployment is still needed to confirm the reported incident is resolved.

Local draft deletion: Timeline details now offer Delete entry for food photos that have not uploaded, including failed uploads. Unsent drafts can be removed offline. Ambiguous/failed uploads are reconciled with the server before removing the phone copy; active uploads are protected. Retry updates only modify drafts that still exist. Four deletion tests cover offline removal, failed uploads, blocked deletion and canceling confirmation.


Automatic package ingredients: mock integration tests cover named Ben & Jerry's Chocolate Fudge Brownie lookup, rejecting a non-dairy variant, conflicting recipes, missing matches, nested ingredients, comma-separated label fallback, barcode OCR and readable-label priority. CSV includes product source URL and match method. Open Food Facts staging search returned HTTP 200 with product-name results; its sample results lacked ingredient records. No real AI calls were made for this change, and the exact user photo has not been reanalysed.

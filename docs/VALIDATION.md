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

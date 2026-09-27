# Food diary — iPhone validation prototype

A private, installable food-and-symptom diary. The source repository is public; diary data and images must remain private.

**This build simulates recognition. It does not identify food and never calls OpenAI.** Real recognition and credentials are deferred by design. No meal description is required.

## What works in this slice

- Camera/photo-library capture, one-tap stomach ratings, independent symptom entries and editable event time.
- Immediate local save in IndexedDB; upload begins separately. Reopen the app to resume pending uploads.
- Server background worker: auto-orient, cap at 2,000,000 pixels without upscaling, strip metadata, and encode a lossy **WebP preview at quality 80**.
- Private previews attached to diary entries. The original stays private during a simulated eight-second analysis, then is deleted after the result is persisted.
- Durable jobs survive server restarts; retry test failures; a cleanup sweep removes originals older than 24 hours. A remaining preview can be used after original expiry.
- Password-protected app/API, basic login throttling, CSV export, offline app shell, and a barcode photo/lookup compatibility test.

The barcode test decodes locally with ZXing and sends only the barcode to Open Food Facts. It does not yet create a food entry. Product availability/ingredients are not guaranteed.

## Run locally

Install .NET 10 and Node 24, then:

```powershell
npm ci
npm run build
$env:ASPNETCORE_ENVIRONMENT = 'Development'
dotnet run --no-launch-profile --urls http://localhost:5080
```

Open `http://localhost:5080`. Development-only password: `local-test-only`. Never deploy with development mode enabled. Alternatively set your own `APP_PASSWORD` environment variable. Production refuses to start without a password of at least 16 characters.

The `.env.example` is documentation, not an automatically loaded configuration file. No API key is needed. The default local data directory is `data/`, ignored by Git.

## Host on Railway for iPhone testing

1. Publish the reviewed source to the GitHub repository, then create a Railway service from it. The Dockerfile builds both frontend barcode code and the .NET app.
2. Attach a persistent volume at `/data`. Set `DATA_PATH=/data`, `APP_PASSWORD` to a unique long password, and `ASPNETCORE_URLS=http://0.0.0.0:8080`. Keep `ASPNETCORE_ENVIRONMENT` unset (Production).
3. Use exactly **one replica** for this prototype: its JSON index and worker are not a multi-instance queue.
4. Configure Railway's public HTTPS domain with target port 8080. `/health` is the health check. Secure session cookies require HTTPS in production.
5. Open that HTTPS URL on the iPhone in Safari, sign in, then Share → Add to Home Screen. Follow [the device test checklist](docs/IPHONE-TEST-PLAN.md).

An ordinary LAN HTTP URL is not equivalent: service workers and related capabilities need a secure context. This repo includes deployment configuration but deployment/volume provisioning is a separate step. Protect/backup the volume, which includes cookie encryption keys. Do not commit its contents or include it in a Docker build.

## Checks

```powershell
dotnet build
npm run check
python tests/smoke.py
```

The smoke script starts an isolated local server against a temporary directory, tests synthetic images only, and cleans up the process. It requires a built Debug .NET binary and Python 3. It does not need credentials or network services.

## Limits to validate before real use

- JPEG, PNG and WebP are supported. Native HEIC is not supported by the current image library. Safari may provide a converted file; test camera and library separately. Unsupported photos remain visible as failed entries; do not claim HEIC support until device tests pass.
- iOS can suspend an upload when the app closes. Local drafts retry on reopening; background upload while closed is not guaranteed. Browser storage may be evicted, so it is not a backup.
- Pending originals remain locally until the server preview is available. A failed, undecodable photo can retain its local draft. Draft-management/deletion UX is still required before handing this to another user.
- Upload limit: 20 MB; decoded image limit: 60 MP; only the first frame is processed. Encoding quality 80 is not an 80% file-size reduction.
- Eight-second simulated recognition proves queue/lifecycle behavior, not model accuracy or real AI latency. No nutrition estimates or diagnoses are generated.
- The prototype uses one shared account and a private local volume. Production plans include user accounts, PostgreSQL, object storage, deletion and backup/restore.
- ImageSharp is pinned to 3.1.12. The 4.x release introduces a separate build-time license setup; upgrades should include license review. Review the Six Labors Split License against the intended use before commercial distribution. Third-party package notices must remain with bundled dependencies.

See [the full project plan](docs/PROJECT-PLAN.md) for agreed scope and [validation results](docs/VALIDATION.md) for what has actually been tested.

# Food diary — iPhone validation app

A private photo-and-symptom diary with non-blocking background food recognition. Public source, private photos. No meal description or AI confirmation is required to save.

## Recognition modes

- `ANALYSIS_MODE=simulation` (default): no API calls, eight-second simulated jobs for camera/queue testing.
- `ANALYSIS_MODE=openai`: real Responses API calls using `OPENAI_API_KEY` and `OPENAI_MODEL` (default `gpt-5.6-terra`). Billing/model access must be available. The app shows its active mode before capture. Old queued simulation entries stay simulated when the server switches modes.

Meal recognition sends the **exact <=2MP WebP preview, quality 80**, with explicit `detail: high`. Compression bytes are not the basis of image-token pricing; dimensions and detail settings matter.

Choose **Ingredients label** for small print. While the original exists, the worker creates an in-memory, oriented, metadata-free **<=4MP WebP at quality 95**, with `detail: original`. It still stores only the smaller 2MP preview for viewing. This is bounded higher-resolution processing, not an unlimited full-resolution original upload. If the original has expired, retry uses the preview and records that fallback.

Visible foods, AI label transcriptions and uncertainties are stored separately. Descriptions remain labelled **AI suggestion / not confirmed**. Meal photos cannot populate the label-ingredients field. The prompt prohibits hidden-ingredient guesses, exact quantities, medical advice or diagnosis; model accuracy still needs evaluation.

Results are saved before original deletion. Original cleanup runs after successful analysis and for files over 24 hours old. Worker restarts recover queued jobs. Temporary failures get at most two scheduled retries (15s and 30s); billing/authentication failures, refusals and invalid/incomplete results require manual retry. Timeout/crash retries can incur additional charges: exactly-once provider billing is not guaranteed. No indefinite retry loop.

## Local setup

Install .NET 10 and Node 24:

```powershell
npm ci
npm run build
pwsh -File scripts/start-local.ps1
```

Open `http://localhost:5080`. Development-only password: `local-test-only`, or set `APP_PASSWORD`. To explicitly run real AI using the ignored local key:

```powershell
pwsh -File scripts/start-local.ps1 -WithAI
```

The `-WithAI` launcher reads only `OPENAI_API_KEY` from `.env.local` without displaying it. ASP.NET does not automatically read env files. The ordinary launcher uses simulation. Production never loads `.env.local`; use service environment variables.

## Railway setup

Deploy this repository with its Dockerfile, attach a persistent volume at `/data`, and configure:

| Variable | Value |
| --- | --- |
| `APP_PASSWORD` | A unique password of at least 16 characters |
| `DATA_PATH` | `/data` |
| `ASPNETCORE_URLS` | `http://0.0.0.0:8080` |
| `ANALYSIS_MODE` | `openai` when ready, otherwise `simulation` |
| `OPENAI_API_KEY` | Your private API key, in Railway Variables only |
| `OPENAI_MODEL` | `gpt-5.6-terra` |

Keep `ASPNETCORE_ENVIRONMENT` unset (Production). Use **one replica**, since the JSON index is single-process persistence. Set the HTTPS domain target port to 8080. Health check: `/health`. Restart/redeploy after changing variables. Open Safari, sign in, then Share → Add to Home Screen.

The key is not included in Git or Docker. Creating it does not add credits. Missing keys fail startup in OpenAI mode; insufficient credits produce a saved failed entry with a useful billing message. Use a private volume, and protect its cookie encryption keys and backups. The current preview/original expiry covers application-controlled copies; OpenAI retention follows the provider's policies. `store: false` is set, but this is not a guarantee of zero provider retention.

## Cost and quality evaluation

Each successful result records model/prompt version, image source/dimensions/detail, input tokens, cached input tokens and output tokens. These are available under Analysis details and in CSV. Failed calls and earlier paid retries may not be included in those successful-response counts; use the provider usage dashboard for billing totals.

For a deliberate comparison, re-upload the same consented evaluation photos in two runs: default preview mode, then `ANALYSIS_COMPARE_SOURCE=true`. The latter uses the original to derive the bounded 4MP/quality-95 image with original detail, and increases likely cost. It performs one call per entry, not two automatic calls. Turn it off afterward. Capture accuracy, hidden-ingredient errors, readable label text, correction burden and usage. This comparison measures both resolution and detail-policy differences; do not attribute all cost differences to WebP compression.

## Tests

```powershell
dotnet build
npm run check
python tests/smoke.py
python tests/recognition.py
```

Tests use synthetic images, isolated temporary data and a loopback fake Responses endpoint. No real key, credits or OpenAI connection are needed. They verify actual request image bytes, format, orientation, metadata stripping, label detail, schemas, token persistence, error handling, queue recovery, retention and CSV. A custom `OPENAI_RESPONSES_URL` is accepted only for loopback HTTP in Development; it cannot redirect production keys elsewhere.

Real recognition accuracy, live API compatibility/account access, latency/cost and iPhone behavior require additional testing. See [validation](docs/VALIDATION.md) and [the iPhone checklist](docs/IPHONE-TEST-PLAN.md).

## Current limitations

- JPEG, PNG and WebP supported; native HEIC is not. Test Safari's camera/library conversion separately. Upload limit 20MB, decoded limit 60MP, first frame only.
- Local IndexedDB drafts resume when the app reopens. iOS background upload and storage persistence are not guaranteed. Invalid photos can retain local drafts; draft discard UI remains planned.
- Separate symptom check-ins work. Backdating a meal currently also backdates an attached stomach rating; separate rating timestamps are required before real daily use.
- Barcode compatibility test decodes with ZXing and looks up Open Food Facts; it does not yet save barcode entries.
- Shared login, single-process disk persistence, no editing/deletion or user confirmation UI yet. Full production data, privacy and backup work is in [the full plan](docs/PROJECT-PLAN.md).
- ImageSharp 3.1.12 uses the Six Labors Split License; review for your use before commercial distribution. 4.x upgrades require separate build-time license setup.

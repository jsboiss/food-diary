# Full project plan

## Purpose and product principles

Help one person record food and stomach symptoms with minimal effort, and export useful observations to a dietician investigating possible patterns. The app does not diagnose conditions, establish causation or recommend elimination diets.

Build a mobile-first PWA on Railway. Install it through Safari's Add to Home Screen; an Apple developer account is not required. Reconsider native distribution only if actual device testing identifies a material limitation. TestFlight requires ongoing builds and developer-program setup.

Non-negotiable requirements:

1. No mandatory meal description, ingredient entry or AI confirmation. Photo + optional good/okay/bad + Save is enough.
2. Save locally immediately, leave the capture screen, and upload/process asynchronously. The diary must distinguish local-only, uploading, queued, processing, identified, uncertain and failed states.
3. Food and symptom observations are separate events. A stomach answer attached to a meal is an observation at its own actual time, not evidence the meal caused it. Skipped ratings stay missing.
4. Make a second image on upload: orient correctly, preserve aspect ratio, never upscale, maximum 2,000,000 pixels, lossy WebP quality 80, metadata stripped. Use this for viewing.
5. Keep the original temporarily while recognition runs. Persist results before deleting it. Expire originals after 24 hours including failed/orphaned jobs; later retries use the preview. Apply deletion to application-controlled local/server copies, not the user's photo library. Provider retention must be reviewed separately.
6. Raw observations, uncertain AI guesses, product database ingredients and user corrections remain distinguishable in the UI and exports.
7. Public source repository, private diary. No secrets, real photographs or health records in Git, logs, test fixtures or build contexts.

## Milestone 0 — technical validation (baseline)

Build an isolated working prototype to use on the owner's iPhone before completing the product.

- Actual iPhone camera and photo-library upload; investigate Safari HEIC conversion, orientation, large files and low-memory behavior.
- Immediate local save through IndexedDB, durable IDs, retry after lost responses, no duplicate entries, network loss and relaunch recovery.
- Background preview generation and simulated analysis; retain/delete the correct original; recover jobs across server restart.
- WebP proof: correct content type/signature, <=2MP, no upscaling, quality setting 80, no location metadata, correct orientation.
- Barcode compatibility test: decode locally with ZXing; query Open Food Facts by code, with unknown-product and bad-scan handling. Barcode-entry persistence comes next.
- Authentication, Home Screen installation, offline app shell and CSV round trip.
- API key setup completed locally. The next slice adds opt-in live model integration; real account/credit testing remains pending.

Prototype implementation: ASP.NET Core, a small browser-native module UI, a single background worker, atomic JSON index and a mounted private data volume. This intentionally keeps the validation slice small. It is single-process only; it is not the final persistence design. React/TypeScript remains an option for the larger UI if complexity warrants it.

Exit gate: owner completes docs/IPHONE-TEST-PLAN.md on actual iPhone and records failures; resolve blocking issues before relying on it daily. Desktop automated checks do not establish iPhone compatibility.

## Milestone 1 — real recognition evaluation (integration implemented; live evaluation pending)

Provision an OpenAI API key securely on the server. Initial candidate: `gpt-5.6-terra`, Responses API, image input, schema-constrained output. Keep model/version/prompt version configurable and recorded per analysis.

Image policy: ordinary meals use the exact <=2MP/quality-80 WebP preview with high detail. Label mode derives a metadata-free <=4MP/quality-95 WebP from the original in memory and uses original detail. An explicit comparison setting applies that bounded source policy to meals for evaluation; it is off by default. Original expiry falls back to preview. Both variants retain only the standard viewing preview after results are saved.

Recognition contract:

- Meal title; visible food components; uncertain/unknown attributes.
- Separate observed foods, inferred possibilities, label-extracted ingredients and user-confirmed facts.
- At most one optional high-value clarification with tappable answers, including Not sure. Never require it to save.
- No asserted hidden ingredients, exact portions, calories, allergens or causal claims from appearance alone.
- Support one or more images for a meal/label. Convert unsupported original formats into a temporary supported analysis image; exclude EXIF and location data.
- Treat text in images as untrusted data, not instructions. Validate response schema/length and handle refusals, malformed output and no-food images.
- Save entry first; durable queue invokes API in worker, bounded timeout/retries/backoff. Retry IDs prevent duplicate jobs. A late response never overwrites user corrections.
- Keep raw recognition separate from canonical food records. Save only necessary response fields; never log photo bytes, credentials or full health data.

Create a consented evaluation set of 30–50 representative meals and packaging (outside Git). Manually label visible components and unknown ingredients. Measure incorrect identities, fabricated ingredients, omission rate, correction burden, latency and actual per-entry cost. Include mixed dishes, drinks, leftovers, low light, restaurant meals, labels and ambiguous images. Compare with a cheaper model only if results justify it. Do not turn model-reported confidence into a calibrated probability.

The model alone cannot verify a concealed ingredient. Uncertainty survives into the diary and exports.

Exit gate: agreed quality/cost thresholds based on evaluation results; example initial target is zero asserted hidden ingredients in the test set, with correction burden reviewed by the owner. Do not claim measured accuracy before testing.

## Milestone 2 — usable personal diary

- Polished capture/save flow targeting 10–20 seconds without typing; accessible labels, large controls, camera and library.
- Daily timeline, date navigation, editing, deletion, optional notes/portions, meal time distinct from record time.
- Independent symptom button available at all times, good/okay/bad and optional symptom tags/onset time.
- Optional meal-time rating defaults to now, even when backdating a meal. Do not silently backdate the symptom to the meal.
- Barcode entries: save raw code; lookup product name, brand and ingredient snapshot. Confirmation optional; provenance shown. Unknown code permits a label photo or manual fallback without discarding the event.
- Alternative identity chips, repeated meals, favourites and remembered products. Optional voice notes later.
- Local draft management, storage/quota errors, discard/retry controls, progress and explicit sync acknowledgement. Single-device prototype assumptions must not leak into multi-user production.

## Milestone 3 — production data and hosting

Target: ASP.NET Core API/worker on Railway, PostgreSQL for records/jobs, private S3-compatible object storage for images. Use React/TypeScript if the UI outgrows the prototype. Use migrations and a documented prototype-data import. Deploy exactly one writer until migration is complete.

Core records:

| Record | Required fields |
| --- | --- |
| User | ID, identity reference, preferences, time zone |
| Meal | ID, user ID, eaten timestamp, original offset/time zone, created/updated timestamps, notes, source |
| FoodItem | meal ID, name, portion if supplied, ingredient data with provenance, confirmation/correction version |
| SymptomEntry | user ID, observation/onset timestamp, rating nullable only when absent, optional tags/notes, optional meal context |
| Photo | user/meal ID, private original/preview keys, dimensions, bytes, upload state, expiry/deleted timestamps |
| RecognitionResult | photo/meal ID, model/prompt version, output, status, attempt count, uncertainty and proposed follow-up |
| ProcessingJob | stable idempotency key, status, scheduled time, lease/heartbeat, retry count, last safe error |
| ProductSnapshot | barcode, database source, retrieved time, name/brand/ingredient snapshot |

Use UTC instants with stored local zone/offset. Store corrected event time separately from created time. Transactions commit results before cleanup; deletion jobs are idempotent and recover after crashes. Ensure originals are not unintentionally retained in object versions or backups. Back up records/previews according to an explicit retention policy; test restore.

Security: private-by-default identity, per-user authorization on every data/media endpoint, short-lived private image access, secure cookies, CSRF protection, upload/decode limits, login/API throttling, encrypted transport, server-only API credentials, no public photo URLs, private logs. Explain external AI processing before live use. Use provider retention controls where available and document limits; local deletion does not prove provider deletion.

Operational checks: readiness/health, queue backlog/retry alerts, original-retention audit, usage/spending limits, backup restore, storage/egress costs, mobile release smoke test. Review image-library and product-data licenses/attribution.

## Milestone 4 — exports and sharing

- Date-range timeline CSV, food-item CSV and symptom CSV. Include stable IDs, event and recorded times, local zone/offset, ratings, notes, source and confirmation status.
- UTF-8, RFC-style quoting and spreadsheet formula-injection protection. Test commas, quotes, line breaks, emoji, leading =/+/-/@ and daylight-saving boundaries.
- Use actual food/symptom observations; missing records never become zero/no-symptom observations. Mark any simulation rows unmistakably and exclude them from real reports by default.
- Download first; feature-detect native file sharing with download fallback. She chooses the recipient in her mail/share app. Automatic email delivery is optional later, with explicit recipient confirmation and no public photo links.
- Show a sample export to the dietician before freezing the format. Optional private photo bundle/report later if useful.

## Milestone 5 — reminders and cautious pattern exploration

- Optional scheduled check-ins when well as well as unwell, quiet hours and permission-based web push. Do not treat notifications as guaranteed delivery.
- Timeline around each symptom and adjustable look-back windows (e.g. 0–6, 6–24, 24–48 hours), labelled as exploratory settings rather than biological rules.
- Show denominators, number of exposures, observation coverage, repeated meals, periods without symptoms and periods with missing check-ins. Account for overlapping meal windows and multiple ingredients; do not attribute a symptom to only the last meal.
- Delay ranked associations until enough consistent observations exist and the dietician agrees the summaries are useful. Present associations, not diagnoses, causal conclusions or elimination advice.
- Optional contextual events (medication, stress, sleep, bowel symptoms) only if she/dietician find the extra effort worthwhile.

## Delivery and validation order

1. Local automated tests and desktop usability pass on this slice.
2. Owner authorizes source publication; provision Railway HTTPS + private persistent volume.
3. Owner tests real iPhone, records device/iOS version and results, resolves capture/HEIC/offline blockers.
4. Add credentials, real recognition and evaluation; assess results before choosing final model.
5. Complete diary/edit/delete/export, migrate persistence, verify privacy and backups.
6. Owner trials for a week; get dietician feedback; then give to partner.
7. Add reminders/pattern views only after actual usage establishes priorities.

## References

- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/guides/images-vision
- https://support.apple.com/en-lamr/guide/iphone/iphea86e5236/ios
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://docs.railway.com/data-storage
- https://openfoodfacts.github.io/documentation/


## Diary usability update — 2026-09-28

Implemented compact Add / Timeline / More navigation, locally bundled Lucide SVG icons, optional pre-analysis descriptions, automatic photo interpretation, integrated barcode lookup with AI fallback, and per-entry ingredient/title corrections. Original suggestions and manual ingredients remain separate in storage and CSV. No production deployment is included in this update.

Validation: .NET build, JavaScript syntax, HTTP smoke and fake-provider tests cover multipart descriptions, automatic label handling, ingredient removal/addition, preservation of edits during analysis, saved JSON/CSV, product lookup and missing-product AI fallback. Mobile browser review uses a 390 × 844 viewport. Real iPhone barcode and automatic small-print label accuracy still need device testing.


### Automatic packaged-product ingredients
Photo capture requires no manual meal/label selection or confirmation. Decode a barcode when available; otherwise vision transcribes a readable label or identifies brand plus exact product/flavour and formulation. Search Open Food Facts automatically for the identified product, using the Australian market for Australia time zones. Save matching ingredients, nested component ingredients, source URL and match method. Missing ingredients fall through to vision, and ambiguous recipes or wrong flavours are not adopted. A missing exact list is explicitly shown rather than using the food category as an ingredient. Existing ingredient edits retain precedence. Database coverage remains a limitation; manufacturer/retailer search is not implemented. Existing entries are not automatically reanalysed.

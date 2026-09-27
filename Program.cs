using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.RateLimiting;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

var builder = WebApplication.CreateBuilder(args);
var dataPath = Path.GetFullPath(builder.Configuration["DATA_PATH"] ?? "data");
Directory.CreateDirectory(dataPath);
var password = builder.Configuration["APP_PASSWORD"];
if (string.IsNullOrWhiteSpace(password))
{
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException("Set APP_PASSWORD (at least 16 characters) before hosting.");
    }
    password = "local-test-only";
}
if (!builder.Environment.IsDevelopment() && password.Length < 16)
{
    throw new InvalidOperationException("APP_PASSWORD must contain at least 16 characters.");
}
builder.WebHost.ConfigureKestrel(x => x.Limits.MaxRequestBodySize = 20 * 1024 * 1024);
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataPath, "keys")));
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(x =>
{
    x.Cookie.Name = "food-diary-session";
    x.Cookie.HttpOnly = true;
    x.Cookie.SameSite = SameSiteMode.Strict;
    x.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
    x.ExpireTimeSpan = TimeSpan.FromDays(14);
    x.Events.OnRedirectToLogin = y => { y.Response.StatusCode = 401; return Task.CompletedTask; };
    x.Events.OnRedirectToAccessDenied = y => { y.Response.StatusCode = 403; return Task.CompletedTask; };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(x => x.AddPolicy("login", y => RateLimitPartition.GetFixedWindowLimiter(
    y.Connection.RemoteIpAddress?.ToString() ?? "unknown", z => new FixedWindowRateLimiterOptions
    { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
builder.Services.AddSingleton(new DiaryStore(dataPath));
builder.Services.AddHttpClient("products", x =>
{
    x.BaseAddress = new Uri("https://world.openfoodfacts.org/");
    x.Timeout = TimeSpan.FromSeconds(12);
    x.DefaultRequestHeaders.UserAgent.ParseAdd("FoodDiaryPrototype/0.1 (https://github.com/jsboiss/food-diary)");
});
builder.Services.AddHostedService<AnalysisWorker>();
var app = builder.Build();
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' blob: data:; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
    if (context.Request.Path.StartsWithSegments("/api"))
    {
        context.Response.Headers.CacheControl = "no-store";
        if (context.Request.Method != "GET" && context.Request.Headers["X-Diary-Request"] != "1")
        {
            context.Response.StatusCode = 403;
            return;
        }
    }
    await next();
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapPost("/api/login", async (LoginRequest request, HttpContext context) =>
{
    var actual = SHA256.HashData(Encoding.UTF8.GetBytes(request.Password ?? ""));
    var expected = SHA256.HashData(Encoding.UTF8.GetBytes(password));
    if (!CryptographicOperations.FixedTimeEquals(actual, expected))
    {
        return Results.Unauthorized();
    }
    await context.SignInAsync(new ClaimsPrincipal(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, "owner")], CookieAuthenticationDefaults.AuthenticationScheme)),
        new AuthenticationProperties { IsPersistent = true });
    return Results.Ok();
}).RequireRateLimiting("login");
app.MapPost("/api/logout", async (HttpContext context) =>
{
    await context.SignOutAsync();
    return Results.Ok();
}).RequireAuthorization();
app.MapGet("/api/entries", async (DiaryStore store) => Results.Ok(new
{
    mode = "simulation", entries = (await store.List()).OrderByDescending(x => x.OccurredAt)
})).RequireAuthorization();
app.MapGet("/api/products/{code}", async (string code, IHttpClientFactory clients) =>
{
    if (code.Length is not (8 or 12 or 13 or 14) || !code.All(x => x is >= '0' and <= '9'))
    {
        return Results.BadRequest(new { error = "Expected a retail product barcode." });
    }
    try
    {
        using var response = await clients.CreateClient("products").GetAsync($"api/v2/product/{code}.json?fields=product_name,brands,ingredients_text");
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) { return Results.Ok(new { name = (string?)null }); }
        if (!response.IsSuccessStatusCode) { return Results.StatusCode(502); }
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        if (!json.RootElement.TryGetProperty("product", out var product)) { return Results.Ok(new { name = (string?)null }); }
        return Results.Ok(new
        {
            name = product.TryGetProperty("product_name", out var name) ? name.GetString() : null,
            brand = product.TryGetProperty("brands", out var brand) ? brand.GetString() : null,
            ingredients = product.TryGetProperty("ingredients_text", out var ingredients) ? ingredients.GetString() : null
        });
    }
    catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or JsonException)
    {
        return Results.StatusCode(502);
    }
}).RequireAuthorization();
app.MapPut("/api/entries/{id:guid}/photo", async (Guid id, HttpRequest request, DiaryStore store) =>
{
    var existing = await store.Get(id);
    if (existing is not null)
    {
        return Results.Ok(existing);
    }
    if (!DateTimeOffset.TryParse(request.Query["occurredAt"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var occurredAt)
        || !DiaryStore.ValidFeeling(request.Query["feeling"]) || request.Query["zone"].ToString().Length > 100)
    {
        return Results.BadRequest(new { error = "Invalid time or stomach rating." });
    }
    var temporary = Path.Combine(store.DataPath, $"{Guid.NewGuid()}.upload");
    try
    {
        await using (var output = File.Create(temporary))
        {
            await request.Body.CopyToAsync(output, request.HttpContext.RequestAborted);
        }
        if (new FileInfo(temporary).Length == 0)
        {
            return Results.BadRequest(new { error = "The photo is empty." });
        }
        var entry = new DiaryEntry(id, "food", occurredAt, DateTimeOffset.UtcNow,
            request.Query["zone"].ToString(), request.Query["feeling"].ToString(), "Queued",
            "Food photo", null, false, 0, 0, 0, request.Query["simulateFailure"] == "true", 0, null);
        return Results.Accepted($"/api/entries/{id}", await store.Create(entry, temporary));
    }
    finally
    {
        File.Delete(temporary);
    }
}).RequireAuthorization();
app.MapPut("/api/symptoms/{id:guid}", async (Guid id, SymptomRequest request, DiaryStore store) =>
{
    if (!DiaryStore.ValidFeeling(request.Feeling) || string.IsNullOrEmpty(request.Feeling) || request.Zone.Length > 100)
    {
        return Results.BadRequest();
    }
    return Results.Ok(await store.Create(new DiaryEntry(id, "symptom", request.OccurredAt, DateTimeOffset.UtcNow,
        request.Zone, request.Feeling, "Saved", "Stomach check-in", null, false, 0, 0, 0, false, 0, null), null));
}).RequireAuthorization();
app.MapGet("/api/entries/{id:guid}/preview", async (Guid id, DiaryStore store) =>
{
    var entry = await store.Get(id);
    return entry?.HasPreview == true && File.Exists(store.Preview(id))
        ? Results.File(store.Preview(id), "image/webp") : Results.NotFound();
}).RequireAuthorization();
app.MapPost("/api/entries/{id:guid}/retry", async (Guid id, DiaryStore store) =>
{
    var entry = await store.Get(id);
    if (entry?.Status != "Failed" || (!File.Exists(store.Original(id)) && !entry.HasPreview))
    {
        return Results.BadRequest(new { error = "This entry cannot be retried. Take or choose another photo." });
    }
    await store.Update(id, x => x with { Status = "Queued", Error = null, SimulateFailure = false });
    return Results.Accepted();
}).RequireAuthorization();
app.MapGet("/api/export", async (DiaryStore store) =>
{
    var rows = new List<string> { "id,event_type,occurred_at,recorded_at,time_zone,stomach,title,status,identification_source,preview_width,preview_height,original_deleted_at" };
    foreach (var entry in (await store.List()).OrderBy(x => x.OccurredAt))
    {
        rows.Add(string.Join(",", new[] { entry.Id.ToString(), entry.Kind, entry.OccurredAt.ToString("O"), entry.CreatedAt.ToString("O"),
            entry.Zone, entry.Feeling, entry.Title, entry.Status, entry.Kind == "food" ? "simulation-not-food-recognition" : "user",
            entry.Width.ToString(), entry.Height.ToString(), entry.OriginalDeletedAt?.ToString("O") ?? "" }.Select(x => DiaryStore.Csv(x))));
    }
    return Results.File(Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(string.Join("\r\n", rows))).ToArray(), "text/csv; charset=utf-8", "food-diary.csv");
}).RequireAuthorization();
app.Run();

record LoginRequest(string? Password);
record SymptomRequest(DateTimeOffset OccurredAt, string Zone, string Feeling);
record DiaryEntry(Guid Id, string Kind, DateTimeOffset OccurredAt, DateTimeOffset CreatedAt, string Zone,
    string Feeling, string Status, string Title, string? Error, bool HasPreview, int Width, int Height,
    long PreviewBytes, bool SimulateFailure, int Attempts, DateTimeOffset? OriginalDeletedAt);

sealed class DiaryStore
{
    public string DataPath { get; }
    private SemaphoreSlim Gate { get; } = new(1, 1);
    private Dictionary<Guid, DiaryEntry> Entries { get; }
    private string IndexPath => Path.Combine(DataPath, "entries.json");
    public DiaryStore(string dataPath)
    {
        DataPath = dataPath;
        Entries = File.Exists(IndexPath)
            ? JsonSerializer.Deserialize<Dictionary<Guid, DiaryEntry>>(File.ReadAllText(IndexPath)) ?? [] : [];
    }
    public string Original(Guid id) => Path.Combine(DataPath, $"{id}.original");
    public string Preview(Guid id) => Path.Combine(DataPath, $"{id}.webp");
    public static bool ValidFeeling(string? feeling) => feeling is "" or "good" or "okay" or "bad";
    public static string Csv(string value)
    {
        if (value.Length > 0 && "=+-@\t\r\n".Contains(value[0]))
        {
            value = "'" + value;
        }
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }
    public async Task<DiaryEntry[]> List()
    {
        await Gate.WaitAsync();
        try { return Entries.Values.ToArray(); }
        finally { Gate.Release(); }
    }
    public async Task<DiaryEntry?> Get(Guid id)
    {
        await Gate.WaitAsync();
        try { return Entries.GetValueOrDefault(id); }
        finally { Gate.Release(); }
    }
    public async Task<DiaryEntry> Create(DiaryEntry entry, string? temporary)
    {
        await Gate.WaitAsync();
        try
        {
            if (Entries.TryGetValue(entry.Id, out var existing)) { return existing; }
            if (temporary is not null) { File.Move(temporary, Original(entry.Id), true); }
            var next = new Dictionary<Guid, DiaryEntry>(Entries) { [entry.Id] = entry };
            await Persist(next);
            Entries[entry.Id] = entry;
            return entry;
        }
        finally { Gate.Release(); }
    }
    public async Task Update(Guid id, Func<DiaryEntry, DiaryEntry> update)
    {
        await Gate.WaitAsync();
        try
        {
            var entry = update(Entries[id]);
            var next = new Dictionary<Guid, DiaryEntry>(Entries) { [id] = entry };
            await Persist(next);
            Entries[id] = entry;
        }
        finally { Gate.Release(); }
    }
    private async Task Persist(Dictionary<Guid, DiaryEntry> entries)
    {
        await File.WriteAllTextAsync(IndexPath + ".tmp", JsonSerializer.Serialize(entries));
        File.Move(IndexPath + ".tmp", IndexPath, true);
    }
}

sealed class AnalysisWorker(DiaryStore store, ILogger<AnalysisWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                foreach (var entry in await store.List())
                {
                    if (entry.Kind != "food") { continue; }
                    // Also recover a crash between saving results and deleting the original.
                    if (entry.Status == "Simulated" || DateTimeOffset.UtcNow - entry.CreatedAt > TimeSpan.FromHours(24))
                    {
                        File.Delete(store.Original(entry.Id));
                        if (entry.OriginalDeletedAt is null)
                        {
                            await store.Update(entry.Id, x => x with { OriginalDeletedAt = DateTimeOffset.UtcNow });
                        }
                    }
                    if (entry.Status is "Queued" or "Processing")
                    {
                        await Process(entry, stoppingToken);
                    }
                }
                foreach (var upload in Directory.EnumerateFiles(store.DataPath, "*.upload"))
                {
                    if (DateTime.UtcNow - File.GetLastWriteTimeUtc(upload) > TimeSpan.FromHours(24)) { File.Delete(upload); }
                }
                // Clean originals orphaned by a crash before the entry index was committed.
                foreach (var original in Directory.EnumerateFiles(store.DataPath, "*.original"))
                {
                    if (DateTime.UtcNow - File.GetLastWriteTimeUtc(original) > TimeSpan.FromHours(24)) { File.Delete(original); }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception) { logger.LogError(exception, "Background queue iteration failed"); }
            await Task.Delay(1000, stoppingToken);
        }
    }
    private async Task Process(DiaryEntry entry, CancellationToken cancellationToken)
    {
        try
        {
            await store.Update(entry.Id, x => x with { Status = "Processing", Attempts = x.Attempts + 1 });
            if (!entry.HasPreview)
            {
                var info = await Image.IdentifyAsync(store.Original(entry.Id), cancellationToken);
                if ((long)info.Width * info.Height > 60_000_000) { throw new InvalidDataException("Image too large."); }
                if (info.Metadata.DecodedImageFormat?.Name is not ("JPEG" or "PNG" or "Webp" or "WEBP"))
                {
                    throw new InvalidDataException("Unsupported image format.");
                }
                using var image = await Image.LoadAsync(new SixLabors.ImageSharp.Formats.DecoderOptions { MaxFrames = 1 }, store.Original(entry.Id), cancellationToken);
                image.Mutate(x => x.AutoOrient());
                var scale = Math.Min(1, Math.Sqrt(2_000_000d / ((long)image.Width * image.Height)));
                var width = Math.Max(1, (int)Math.Floor(image.Width * scale));
                var height = Math.Max(1, (int)Math.Floor(image.Height * scale));
                image.Mutate(x => x.Resize(width, height));
                image.Metadata.ExifProfile = null;
                image.Metadata.XmpProfile = null;
                image.Metadata.IptcProfile = null;
                image.Metadata.IccProfile = null;
                var temporary = store.Preview(entry.Id) + ".tmp";
                await image.SaveAsWebpAsync(temporary, new WebpEncoder { Quality = 80, FileFormat = WebpFileFormatType.Lossy, SkipMetadata = true }, cancellationToken);
                File.Move(temporary, store.Preview(entry.Id), true);
                await store.Update(entry.Id, x => x with { HasPreview = true, Width = width, Height = height, PreviewBytes = new FileInfo(store.Preview(entry.Id)).Length });
            }
            // Deliberate stand-in. No food identity is fabricated, and no API is called.
            await Task.Delay(TimeSpan.FromSeconds(8), cancellationToken);
            if (entry.SimulateFailure) { throw new InvalidOperationException("Requested test failure."); }
            await store.Update(entry.Id, x => x with { Status = "Simulated", Title = "Food photo · analysis simulation complete", Error = null });
            File.Delete(store.Original(entry.Id));
            await store.Update(entry.Id, x => x with { OriginalDeletedAt = DateTimeOffset.UtcNow });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
        catch (Exception exception)
        {
            logger.LogWarning("Image job {EntryId} failed ({ExceptionType})", entry.Id, exception.GetType().Name);
            var current = await store.Get(entry.Id);
            await store.Update(entry.Id, x => x with
            {
                Status = "Failed", Error = current?.HasPreview == true
                    ? "Analysis simulation failed. Retry is available."
                    : "Could not process this photo. Try JPEG, PNG or WebP; HEIC support still needs validation."
            });
        }
    }
}

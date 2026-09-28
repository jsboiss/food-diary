using System.Text.Json;
using System.Text.RegularExpressions;

sealed record ProductInfo(string Code, string Name, string Brand, string[] Ingredients, string Source, string IngredientsText,
    string MatchMethod = "barcode", string SourceUrl = "");
static class ProductLookup
{
    public static bool ValidCode(string code) => code.Length is 8 or 12 or 13 or 14 && code.All(x => x is >= '0' and <= '9');
    public static async Task<ProductInfo?> Find(string code, IHttpClientFactory clients, CancellationToken cancellationToken)
    {
        if (!ValidCode(code)) { return null; }
        try
        {
            using var response = await clients.CreateClient("products").GetAsync($"api/v2/product/{code}.json?fields=product_name,brands,ingredients,ingredients_text", cancellationToken);
            if (!response.IsSuccessStatusCode) { return null; }
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return document.RootElement.TryGetProperty("product", out var product) ? Read(product, code, "barcode") : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException) { return null; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }

    public static async Task<ProductInfo?> Search(string brand, string name, string zone, IHttpClientFactory clients, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(brand) || string.IsNullOrWhiteSpace(name)) { return null; }
        try
        {
            var query = Uri.EscapeDataString($"{brand} {name}");
            // Search only the relevant market when the diary supplies an Australian time zone.
            var country = zone.StartsWith("Australia/", StringComparison.Ordinal) ? "&tagtype_0=countries&tag_contains_0=contains&tag_0=australia" : "";
            using var response = await clients.CreateClient("products").GetAsync(
                $"cgi/search.pl?search_terms={query}&search_simple=1&action=process&json=1&page_size=20{country}&fields=code,product_name,brands,ingredients,ingredients_text", cancellationToken);
            if (!response.IsSuccessStatusCode) { return null; }
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            if (!document.RootElement.TryGetProperty("products", out var products) || products.ValueKind != JsonValueKind.Array) { return null; }
            var matches = new List<ProductInfo>();
            foreach (var product in products.EnumerateArray())
            {
                var result = Read(product, Text(product, "code"), "package-name");
                if (result is not null && Matches(brand, name, result)) { matches.Add(result); }
            }
            // Different recipes for the same apparent variant are ambiguous; never select the first hit.
            var recipes = matches.GroupBy(x => string.Join("|", x.Ingredients.Select(y => Normalize(y)))).ToArray();
            return recipes.Length == 1 ? recipes[0].First() : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException) { return null; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }

    private static string Text(JsonElement value, string key) => value.TryGetProperty(key, out var text) && text.ValueKind == JsonValueKind.String ? text.GetString() ?? "" : "";
    private static string Normalize(string value) => Regex.Replace(value.ToLowerInvariant().Replace("&", " and ").Replace("'", "").Replace("’", ""), "[^a-z0-9]+", " ").Trim();
    private static bool Matches(string brand, string name, ProductInfo product)
    {
        var brandTokens = Normalize(brand).Split(' ', StringSplitOptions.RemoveEmptyEntries).Where(x => x != "and").ToArray();
        var actualBrand = Normalize(product.Brand).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (brandTokens.Length == 0 || !brandTokens.All(x => actualBrand.Contains(x))) { return false; }
        var expected = Normalize(name).Split(' ', StringSplitOptions.RemoveEmptyEntries).Except(brandTokens).Where(x => x != "and").ToArray();
        var actual = Normalize(product.Name).Split(' ', StringSplitOptions.RemoveEmptyEntries).Except(brandTokens).Where(x => x != "and").ToArray();
        // Ignore generic packaging wording, but require the complete flavour/formulation on both sides.
        var generic = new[] { "ice", "cream", "icecream", "frozen", "dessert", "tub" };
        var expectedVariant = expected.Except(generic).ToHashSet();
        var actualVariant = actual.Except(generic).ToHashSet();
        return expectedVariant.Count > 0 && expectedVariant.SetEquals(actualVariant);
    }

    private static ProductInfo? Read(JsonElement product, string code, string method)
    {
        var name = Text(product, "product_name");
        if (string.IsNullOrWhiteSpace(name)) { return null; }
        var ingredients = new List<string>();
        if (product.TryGetProperty("ingredients", out var items)) { ReadIngredients(items, ingredients, 0); }
        var labelText = Text(product, "ingredients_text");
        if (ingredients.Count == 0 && !string.IsNullOrWhiteSpace(labelText))
        {
            // Split top-level ingredients only; retain nested components in their parent wording.
            var depth = 0;
            var start = 0;
            for (var index = 0; index < labelText.Length; index++)
            {
                if (labelText[index] is '(' or '[') { depth++; }
                if (labelText[index] is ')' or ']') { depth = Math.Max(0, depth - 1); }
                if (depth == 0 && labelText[index] is ',' or ';')
                {
                    ingredients.Add(labelText[start..index].Trim());
                    start = index + 1;
                }
            }
            ingredients.Add(labelText[start..].Trim());
        }
        var clean = ingredients.Where(x => !string.IsNullOrWhiteSpace(x) && x.Length <= 300).Distinct(StringComparer.OrdinalIgnoreCase).Take(80).ToArray();
        if (clean.Length == 0) { return null; }
        return new(code, name, Text(product, "brands"), clean, "Open Food Facts", labelText, method,
            ValidCode(code) ? $"https://world.openfoodfacts.org/product/{code}" : "");
    }

    private static void ReadIngredients(JsonElement items, List<string> ingredients, int depth)
    {
        if (items.ValueKind != JsonValueKind.Array || depth > 8) { return; }
        foreach (var item in items.EnumerateArray())
        {
            var text = Text(item, "text");
            if (!string.IsNullOrWhiteSpace(text)) { ingredients.Add(text); }
            if (item.TryGetProperty("ingredients", out var children)) { ReadIngredients(children, ingredients, depth + 1); }
        }
    }
}

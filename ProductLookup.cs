using System.Text.Json;

sealed record ProductInfo(string Code, string Name, string Brand, string[] Ingredients, string Source, string IngredientsText);
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
            if (!document.RootElement.TryGetProperty("product", out var product) ||
                !product.TryGetProperty("product_name", out var name) || string.IsNullOrWhiteSpace(name.GetString())) { return null; }
            var ingredients = new List<string>();
            if (product.TryGetProperty("ingredients", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in items.EnumerateArray())
                {
                    if (item.TryGetProperty("text", out var text) && !string.IsNullOrWhiteSpace(text.GetString())) { ingredients.Add(text.GetString()!); }
                }
            }
            // Keep an unstructured label intact rather than splitting nested ingredient groups incorrectly.
            var labelText = product.TryGetProperty("ingredients_text", out var label) ? label.GetString() ?? "" : "";
            if (ingredients.Count == 0 && !string.IsNullOrWhiteSpace(labelText) && labelText.Length <= 300)
            {
                ingredients.Add(labelText);
            }
            return new(code, name.GetString()!, product.TryGetProperty("brands", out var brand) ? brand.GetString() ?? "" : "",
                ingredients.Where(x => x.Length <= 300).Take(80).ToArray(), "Open Food Facts", labelText);
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException) { return null; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }
}

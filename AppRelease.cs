using System.Security.Cryptography;
using System.Text;

sealed record AppRelease(string Version, string Html)
{
    public static AppRelease Load(string webRoot)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var file in Directory.GetFiles(webRoot, "*", SearchOption.AllDirectories).OrderBy(x => x, StringComparer.Ordinal))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(Path.GetRelativePath(webRoot, file).Replace('\\', '/')));
            hash.AppendData(File.ReadAllBytes(file));
        }
        hash.AppendData(File.ReadAllBytes(typeof(AppRelease).Assembly.Location));
        var version = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        return new(version, File.ReadAllText(Path.Combine(webRoot, "index.html")).Replace("<!--app-version-->",
            $"<meta name=\"app-version\" content=\"{version}\">"));
    }
}

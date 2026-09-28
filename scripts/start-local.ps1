param([switch]$WithAI)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ANALYSIS_MODE = 'simulation'
if ($WithAI) {
    $keyPath = Join-Path (Get-Location) '.env.local'
    if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Missing .env.local.' }
    $keyText = [System.IO.File]::ReadAllText($keyPath)
    $keyMatch = [regex]::Match($keyText, '(?m)^OPENAI_API_KEY=(.+)$')
    if (-not $keyMatch.Success) { throw 'OPENAI_API_KEY is missing.' }
    $env:OPENAI_API_KEY = $keyMatch.Groups[1].Value.Trim().Trim('"').Trim("'")
    $env:ANALYSIS_MODE = 'openai'
}
try {
    dotnet run --no-launch-profile --urls http://localhost:5080
} finally {
    if ($WithAI) { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
}

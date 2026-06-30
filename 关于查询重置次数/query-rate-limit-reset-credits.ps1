param(
    [switch]$AsJson
)

$ErrorActionPreference = 'Stop'

$authPath = Join-Path $HOME '.codex\auth.json'
$endpoint = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'

function Convert-ToShanghaiTimeString {
    param(
        [Parameter(ValueFromPipeline = $true)]
        $Value
    )

    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
        return $null
    }

    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById('China Standard Time')

    try {
        $dto = [DateTimeOffset]::Parse(
            [string]$Value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal
        )

        return [System.TimeZoneInfo]::ConvertTime($dto, $tz).ToString('yyyy-MM-dd HH:mm:ss zzz')
    }
    catch {
        return [string]$Value
    }
}

function Get-CreditsFromResponse {
    param($Response)

    if ($Response.credits) {
        return @($Response.credits)
    }

    if ($Response.data -and $Response.data.credits) {
        return @($Response.data.credits)
    }

    if ($Response.items) {
        return @($Response.items)
    }

    return @()
}

if (-not (Test-Path -LiteralPath $authPath)) {
    throw "Codex auth file not found: $authPath"
}

$auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
$accessToken = $auth.tokens.access_token

if ([string]::IsNullOrWhiteSpace($accessToken)) {
    throw 'tokens.access_token not found in Codex auth file.'
}

$headers = @{
    Authorization = "Bearer $accessToken"
}

$response = Invoke-RestMethod -Uri $endpoint -Headers $headers -Method Get
$credits = Get-CreditsFromResponse -Response $response

$summary = [ordered]@{
    available_count = $response.available_count
    credits = @(
        $credits | ForEach-Object {
            [ordered]@{
                status = $_.status
                title = $_.title
                granted_at_shanghai = Convert-ToShanghaiTimeString $_.granted_at
                expires_at_shanghai = Convert-ToShanghaiTimeString $_.expires_at
            }
        }
    )
}

if ($AsJson) {
    $summary | ConvertTo-Json -Depth 6
}
else {
    "available_count: $($summary.available_count)"
    ''
    $summary.credits | Format-Table -AutoSize
}

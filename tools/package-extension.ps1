param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\dist")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$allowedPrefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutput.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Package output must stay inside the QueueTube project."
}

$manifest = Get-Content -LiteralPath (Join-Path $projectRoot "manifest.json") -Raw | ConvertFrom-Json
$archiveName = "queuetube-v$($manifest.version).zip"
$archivePath = Join-Path $resolvedOutput $archiveName
$stagePath = Join-Path $resolvedOutput ".package-$($manifest.version)"

New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
if (Test-Path -LiteralPath $stagePath) {
  $resolvedStage = [System.IO.Path]::GetFullPath($stagePath)
  if (-not $resolvedStage.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear an unexpected staging path."
  }
  Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
New-Item -ItemType Directory -Path $stagePath | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "manifest.json") -Destination $stagePath
Copy-Item -LiteralPath (Join-Path $projectRoot "assets") -Destination $stagePath -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot "src") -Destination $stagePath -Recurse

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
$archive = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $stagePath -File -Recurse | ForEach-Object {
    $relativePath = $_.FullName.Substring($stagePath.Length).TrimStart("\", "/").Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $_.FullName,
      $relativePath,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}
Remove-Item -LiteralPath $stagePath -Recurse -Force

$archive = Get-Item -LiteralPath $archivePath
Write-Output "Packaged $($archive.Name) ($([Math]::Round($archive.Length / 1KB, 1)) KB)"

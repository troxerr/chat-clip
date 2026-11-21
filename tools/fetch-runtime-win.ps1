<#
.SYNOPSIS
  Downloads the LGPL FFmpeg and portable Streamlink that ship with the Windows app.

.DESCRIPTION
  Pins live in tools/runtime-win.json (release tag, asset name, SHA-256).
    -Discover   find the newest matching release, download it, and print the
                values to pin. Needs the GitHub CLI (gh) and GH_TOKEN. Uses what
                it found for this run, so a first CI run can still be tested.
    (default)   require pins, verify the SHA-256 of each download, and fail on
                any mismatch.
  RUNTIME_MIRROR_URL (optional env) is a base URL hosting copies of the pinned
  assets by file name, used only if the upstream download fails.
  Output goes to <repo>\runtime\ (bin\ for FFmpeg, streamlink\ for Streamlink),
  where background.cjs already looks for bundled binaries.
#>
param(
  [switch]$Discover,
  [string]$Dest = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $Dest) { $Dest = Join-Path $root "runtime" }
$pinsPath = Join-Path $PSScriptRoot "runtime-win.json"
$pins = Get-Content -Raw $pinsPath | ConvertFrom-Json
$tempBase = $env:RUNNER_TEMP
if (-not $tempBase) { $tempBase = [System.IO.Path]::GetTempPath() }
$work = Join-Path $tempBase "hd-runtime"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$summary = @()

function Find-Latest($component) {
  # Newest release (gh returns newest first) with an asset that matches.
  $releases = gh api "repos/$($component.repo)/releases?per_page=60" | ConvertFrom-Json
  foreach ($release in $releases) {
    if ($component.excludeTags -contains $release.tag_name) { continue }
    foreach ($asset in $release.assets) {
      if ($asset.name -match $component.assetPattern -and $asset.name -notmatch "shared|installer|\.exe$") {
        return @{ tag = $release.tag_name; asset = $asset.name }
      }
    }
  }
  throw "No release of $($component.repo) has an asset matching $($component.assetPattern)."
}

function Get-Verified($name, $component) {
  $tag = $component.tag; $asset = $component.asset; $expected = $component.sha256
  if ($Discover -and (-not $tag -or -not $asset)) {
    $found = Find-Latest $component
    $tag = $found.tag; $asset = $found.asset
  }
  if (-not $tag -or -not $asset) { throw "$name is not pinned. Run with -Discover in CI and copy the values into tools/runtime-win.json." }
  $url = "https://github.com/$($component.repo)/releases/download/$tag/$asset"
  $file = Join-Path $work $asset
  Write-Host "Downloading $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
  } catch {
    # Upstream tags (BtbN autobuilds especially) can be deleted. If a mirror of the
    # pinned assets is configured, use it; the SHA-256 check below still applies.
    if (-not $env:RUNTIME_MIRROR_URL) { throw }
    $mirror = "$($env:RUNTIME_MIRROR_URL.TrimEnd('/'))/$asset"
    Write-Host "::warning::Upstream download failed ($($_.Exception.Message)); trying mirror $mirror"
    Invoke-WebRequest -Uri $mirror -OutFile $file -UseBasicParsing
  }
  $actual = (Get-FileHash -Algorithm SHA256 -Path $file).Hash.ToLower()
  Write-Host "$name SHA-256: $actual"
  $script:summary += "$name tag=$tag asset=$asset sha256=$actual"
  if ($Discover -and -not $expected) {
    Write-Host "::warning::$name is NOT pinned. Pin tag=$tag asset=$asset sha256=$actual in tools/runtime-win.json."
  } elseif (-not $expected) {
    throw "$name has no sha256 pin. Run with -Discover and pin it."
  } elseif ($actual -ne $expected.ToLower()) {
    throw "$name SHA-256 mismatch: expected $expected but downloaded $actual. Refusing to use it."
  }
  return $file
}

# FFmpeg: copy the bin folder (ffmpeg.exe, ffprobe.exe and any DLLs it needs).
$ffZip = Get-Verified "ffmpeg" $pins.ffmpeg
$ffOut = Join-Path $work "ffmpeg"
if (Test-Path $ffOut) { Remove-Item -Recurse -Force $ffOut }
Expand-Archive -Path $ffZip -DestinationPath $ffOut -Force
$ffExe = Get-ChildItem -Path $ffOut -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $ffExe) { throw "ffmpeg.exe not found in the FFmpeg archive." }
$binDest = Join-Path $Dest "bin"
New-Item -ItemType Directory -Force -Path $binDest | Out-Null
Copy-Item -Path (Join-Path $ffExe.Directory.FullName "*") -Destination $binDest -Recurse -Force
$licDest = Join-Path $Dest "licenses"
New-Item -ItemType Directory -Force -Path $licDest | Out-Null
Get-ChildItem -Path $ffExe.Directory.Parent.FullName -File | Where-Object { $_.Name -match "LICENSE|COPYING|README" } | Copy-Item -Destination $licDest -Force

# Streamlink: a portable folder that must stay together (its Python is inside).
$slZip = Get-Verified "streamlink" $pins.streamlink
$slOut = Join-Path $work "streamlink"
if (Test-Path $slOut) { Remove-Item -Recurse -Force $slOut }
Expand-Archive -Path $slZip -DestinationPath $slOut -Force
$slExe = Get-ChildItem -Path $slOut -Recurse -Filter "streamlink.exe" | Select-Object -First 1
if (-not $slExe) { throw "streamlink.exe not found in the Streamlink archive." }
$slTop = $slExe.Directory.Parent.FullName
$slDest = Join-Path $Dest "streamlink"
if (Test-Path $slDest) { Remove-Item -Recurse -Force $slDest }
Copy-Item -Path $slTop -Destination $slDest -Recurse -Force
if (-not (Test-Path (Join-Path $slDest "bin\streamlink.exe"))) { throw "Expected runtime\streamlink\bin\streamlink.exe." }

Write-Host "Runtime ready in $Dest"
if ($env:GITHUB_STEP_SUMMARY) {
  Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "### Windows runtime pins"
  foreach ($line in $summary) { Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value "- $line" }
}

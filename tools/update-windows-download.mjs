import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Use stable releases with both Windows downloads uploaded. GitHub can include
// draft releases in responses authenticated with a repository token.
export function windowsReleaseVersion(releases) {
  const candidates = []
  for (const release of releases) {
    if (release.draft || release.prerelease) continue
    const version = /^win-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1]
    if (!version) continue

    const names = new Set(release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => asset.name))
    if (names.has(`ClipSpike-${version}-x64.exe`) && names.has(`ClipSpike-${version}-x64-portable.exe`)) {
      candidates.push(version)
    }
  }
  return candidates.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , releasesPath, pagePath] = process.argv
  const version = windowsReleaseVersion(JSON.parse(readFileSync(releasesPath, 'utf8')).flat())
  if (version) {
    const page = readFileSync(pagePath, 'utf8')
    const fallbackVersion = /The Windows trial is version (\d+\.\d+\.\d+)\./.exec(page)?.[1]
    if (!fallbackVersion) throw new Error('Windows download page is missing its fallback version')
    writeFileSync(pagePath, page.replaceAll(fallbackVersion, version))
  }
}

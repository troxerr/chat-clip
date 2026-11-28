# ClipSpike website

Static marketing site for the ClipSpike apps (macOS and Windows). There is no build step for the site itself.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page. Leads with the Windows trial, $39 Polar license and interactive chat demo. Also links the Mac waitlist and live clip browser. |
| `windows.html` | Windows download page. The 7-day trial and $39 Polar checkout are available here. The published `win-v0.1.7` setup and portable assets follow, with publisher verification and SmartScreen information. |
| `privacy.html`, `terms.html`, `eula.html` | Privacy policy, terms, and EULA for the Windows license. |

## Deploy with GitHub Pages

`.github/workflows/pages.yml` publishes to GitHub Pages on a push to `main` that changes `site/`, `web/`, `config/` or the workflow itself. It also runs on a 5-minute schedule to refresh Twitch data. The deployed site is `site/` plus the web dashboard (`web/`, built into `/app`). Enable Pages in the repository settings (Source: GitHub Actions) and set the custom domain there.

## Preview

```sh
python3 -m http.server 8080 --directory site
# http://localhost:8080
```

## Download status

The clip browser is live at `/app/` and `/app/clips/`. Windows `win-v0.1.7` is a published (not draft) release. There is no public Mac release, so the site does not link a Mac download.

| Platform | On the site now | To go live |
|---|---|---|
| Windows | The homepage links the Polar checkout and `windows.html`. That page links `ClipSpike-0.1.7-x64.exe` and `ClipSpike-0.1.7-x64-portable.exe` on the published `win-v0.1.7` GitHub release. Both installers are signed through Azure Artifact Signing. | Pages selects the newest stable release with both installers. Keep the bundled links, homepage metadata, and guard test in sync with the published release. Do not host binaries in this repo. Do not link a draft. The release workflow verifies both signatures before publishing assets. |
| Mac | Waitlist on `/app/pro/?platform=mac`, with a support email fallback. | Link a Mac build only after a public release exists. Do not call a build notarized unless it is. |

Never link GitHub's `/releases/latest` or a draft release. Release versions are immutable: the workflow refuses to overwrite an installer that is already on the feed, and a `win-v*` tag must match the version in `win/package.json`. See `docs/WINDOWS_RELEASE.md`.

## Payments and licensing

- **Windows uses [Polar](https://polar.sh)** as merchant of record and license-key provider. The settings are in `win/build-config.json`: `provider`, `apiBase`, `productId` (`<organization-id>:<benefit-id>`), `checkoutUrl` and `trialDays`.
- The committed values point at **Polar production** (`https://api.polar.sh`). Sandbox keys do not work in production, and production keys do not work in the sandbox. To test against the sandbox, point `apiBase`, `productId` and `checkoutUrl` at sandbox values in a scratch build. The release workflow runs `node win/tools/check-release-config.js` and fails if licensing is not configured.
- **Mac** has no public download. A release build must use the same Polar checkout, product id, and `https://api.polar.sh` API as `win/build-config.json`. `./mac/release.sh --check` fails otherwise. Do not ship a Lemon Squeezy Mac build.
- Details: `docs/WINDOWS_RELEASE.md` (licensing provider) and `docs/LAUNCH_CHECKLIST.md` (the Polar sandbox pass and production inputs).

## Before publishing

- Windows: finish the release steps in `docs/WINDOWS_RELEASE.md` (update feed host, signing decision, production Polar values, tag build), run the smoke test, then link the installer.
- Mac: link the notarized DMG.
- The pricing card and `/pro` use the Polar checkout and the $39 price in `web/src/monetization/offer.ts`. Set the Pages repository variable `VITE_WAITLIST_ENDPOINT` to accept email submissions with source `clipspike-macos`. Set `VITE_WAITLIST_EMAIL` to override the default Mac fallback (`support@clipspike.com`). Point the Mac app's `HDCheckoutURL` at that same checkout when a Mac release exists.
- Have the privacy policy, terms, EULA, refund policy and third-party notices read by a lawyer when the business details change.
- Add real screenshots and a demo video. The current hero is a CSS mockup so no personal desktop content is exposed.
- Add analytics only if the privacy policy and consent flow cover it.

The legal pages are the published policy, terms, and EULA. They are not a lawyer's opinion.

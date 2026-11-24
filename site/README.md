# ClipSpike website

Static marketing site for the ClipSpike apps (macOS and Windows). There is no build step for the site itself.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page. Mac-focused copy, pricing card, and the download section (which links to the Windows page). |
| `windows.html` | Windows download status and notes (Setup vs Portable, SmartScreen). |
| `privacy.html`, `terms.html`, `eula.html` | Legal pages. Starting templates, not legal advice. |

## Deploy with GitHub Pages

`.github/workflows/pages.yml` publishes to GitHub Pages on a push to `main` that changes `site/`, `web/`, `config/` or the workflow itself. It also runs on a 5-minute schedule to refresh Twitch data. The deployed site is `site/` plus the web dashboard (`web/`, built into `/app`). Enable Pages in the repository settings (Source: GitHub Actions) and set the custom domain there.

## Preview

```sh
python3 -m http.server 8080 --directory site
# http://localhost:8080
```

## Download status

Neither app has a public release yet, so the site shows "coming soon" instead of a download link.

| Platform | On the site now | To go live |
|---|---|---|
| Windows | `windows.html` shows a "Windows release coming soon" status. | After the Windows 11 smoke test (`docs/WINDOWS_TEST_CHECKLIST.md`), link the versioned installer on the download host, `https://downloads.astlabs.dev/win/ClipSpike-<version>-x64.exe`, which the `windows-release.yml` workflow uploads to Cloudflare R2. Check that it downloads without a GitHub login, and update the copy and the guard test `web/src/monetization/siteWindows.test.ts` to match. |
| Mac | `index.html` shows "Mac release coming soon" in the nav, hero, pricing card and download section. | Link the notarized DMG once it exists and restore the trial and download wording. |

Never link GitHub's `/releases/latest`, a draft release, or an unsigned test build. Release versions are immutable: the workflow refuses to overwrite an installer that is already on the feed, and a `win-v*` tag must match the version in `win/package.json`. See `docs/WINDOWS_RELEASE.md`.

## Payments and licensing

- **Windows uses [Polar](https://polar.sh)** as merchant of record and license-key provider. The settings are in `win/build-config.json`: `provider`, `apiBase`, `productId` (`<organization-id>:<benefit-id>`), `checkoutUrl` and `trialDays`.
- The committed values point at the **Polar sandbox** (`https://sandbox-api.polar.sh`). Sandbox keys do not work in production. Before a public release, create the production organization, product, a License Keys benefit with an activation limit of 2, and a checkout link, then set `apiBase` to `https://api.polar.sh` and replace `productId` and `checkoutUrl`. The release workflow runs `node win/tools/check-release-config.js` and fails if licensing is not configured.
- **Mac** still defaults to Lemon Squeezy, and Polar can be selected instead (see the root `README.md`, "Using Polar instead of Lemon Squeezy"). Pick one provider per platform on purpose.
- Details: `docs/WINDOWS_RELEASE.md` (licensing provider) and `docs/LAUNCH_CHECKLIST.md` (the Polar sandbox pass and production inputs).

## Before publishing

- Windows: finish the release steps in `docs/WINDOWS_RELEASE.md` (update feed host, signing decision, production Polar values, tag build), run the smoke test, then link the installer.
- Mac: link the notarized DMG.
- Put the production checkout link in the pricing card and download CTAs once the apps are live, and point the Mac app's `HDCheckoutURL` at the same checkout.
- Replace `support@clipspike.example` and the `[LEGAL ENTITY]`, `[ADDRESS]` and `[DATE]` placeholders in `privacy.html`, `terms.html` and `eula.html`.
- Update the legal pages for Windows and Polar. They currently describe a macOS app sold through Lemon Squeezy, with licenses counted in Macs.
- Have the privacy policy, terms, EULA, refund policy and third-party notices reviewed by a lawyer.
- Add real screenshots and a demo video. The current hero is a CSS mockup so no personal desktop content is exposed.
- Add analytics only if the privacy policy and consent flow cover it.

The legal pages are starting templates, not legal advice. Do not sell without review.

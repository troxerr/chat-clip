# ClipSpike website

Static marketing site for the ClipSpike apps (macOS and Windows). There is no build step for the site itself.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page. Leads with the live clip browser (`/app/` and `/app/clips/`), then the Windows download. Mac is described as unpublished. |
| `windows.html` | Windows download page. Links the published `win-v0.1.3` setup and portable assets, with the unsigned/SmartScreen warning. |
| `privacy.html`, `terms.html`, `eula.html` | Legal pages. Starting templates, not legal advice. |

## Deploy with GitHub Pages

`.github/workflows/pages.yml` publishes to GitHub Pages on a push to `main` that changes `site/`, `web/`, `config/` or the workflow itself. It also runs on a 5-minute schedule to refresh Twitch data. The deployed site is `site/` plus the web dashboard (`web/`, built into `/app`). Enable Pages in the repository settings (Source: GitHub Actions) and set the custom domain there.

## Preview

```sh
python3 -m http.server 8080 --directory site
# http://localhost:8080
```

## Download status

The clip browser is live at `/app/` and `/app/clips/`. Windows `win-v0.1.3` is a published (not draft) release. There is no public Mac release, so the site does not link a Mac download.

| Platform | On the site now | To go live |
|---|---|---|
| Windows | `windows.html` and the homepage download section link `ClipSpike-0.1.3-x64.exe` and `ClipSpike-0.1.3-x64-portable.exe` on the `win-v0.1.3` GitHub release. The release is unsigned; the pages say SmartScreen will warn. | When a newer non-draft Windows release exists, replace those exact asset URLs and the guard test `web/src/monetization/siteWindows.test.ts`. Do not host binaries in this repo. |
| Mac | Honest “no public Mac release” copy. No download link. | Link a Mac build only after a public release exists. Do not call a build notarized unless it is. |

Never link GitHub's `/releases/latest` or a draft release. Release versions are immutable: the workflow refuses to overwrite an installer that is already on the feed, and a `win-v*` tag must match the version in `win/package.json`. See `docs/WINDOWS_RELEASE.md`.

## Payments and licensing

- **Windows uses [Polar](https://polar.sh)** as merchant of record and license-key provider. The settings are in `win/build-config.json`: `provider`, `apiBase`, `productId` (`<organization-id>:<benefit-id>`), `checkoutUrl` and `trialDays`.
- The committed values point at **Polar production** (`https://api.polar.sh`). Sandbox keys do not work in production, and production keys do not work in the sandbox. To test against the sandbox, point `apiBase`, `productId` and `checkoutUrl` at sandbox values in a scratch build. The release workflow runs `node win/tools/check-release-config.js` and fails if licensing is not configured.
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

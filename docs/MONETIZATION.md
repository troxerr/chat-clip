# Monetization

Everything is **off by default**. With no env vars set the web app has no ads, no affiliate cards, no tip links, no analytics, no consent banner and loads no third-party scripts. Configure at build time with `VITE_*` variables (see `web/.env.example`; set them as repository/CI variables for the Pages build). These are public values: never put secrets in them, and never commit real IDs.

Config lives in `web/src/monetization/config.ts` (`buildConfig` validates every value; invalid URLs/IDs are dropped). The app is served at `https://clipspike.com/app/`.

## Setting config from GitHub repository variables
`.github/workflows/pages.yml` passes every variable below to the web build as `${{ vars.NAME }}`. They are public build-time values, so use repository **Variables**, never Secrets. Variables you don't define become empty strings, which behave exactly like unset (feature off).

1. In the repo go to **Settings > Secrets and variables > Actions > Variables > New repository variable**.
2. Enter the name and value from the table and click **Add variable**; repeat for each.
3. Redeploy, because values are baked in at build time: **Actions > pages > Run workflow** on `main` (`workflow_dispatch`), or `gh workflow run pages.yml --ref main`.

| Variable | Value |
|---|---|
| `VITE_ADS_ENABLED` | `true` to enable ad/sponsor slots. Anything else (or unset) = off. |
| `VITE_AD_PROVIDER` | `sponsor` (default) or `adsense`. |
| `VITE_ADSENSE_CLIENT` | AdSense publisher id, `ca-pub-` plus digits. |
| `VITE_ADSENSE_SLOT_GRID` | Ad unit id (digits) for the in-grid slot. |
| `VITE_ADSENSE_SLOT_SIDEBAR` | Ad unit id (digits) for the sidebar slot. |
| `VITE_SPONSOR_NAME` | Sponsor name (sponsor provider). |
| `VITE_SPONSOR_URL` | Sponsor `http(s)://` link. |
| `VITE_SPONSOR_TEXT` | Optional short tagline. |
| `VITE_AFFILIATES_ENABLED` | `true` to show affiliate cards from `affiliates.json`. |
| `VITE_SUPPORT_URL` | Ko-fi / Buy Me a Coffee / GitHub Sponsors `http(s)://` URL. |
| `VITE_WAITLIST_ENDPOINT` | Formspree-style JSON POST URL for `/pro`. |
| `VITE_WAITLIST_EMAIL` | Fallback mailto address for `/pro`. |
| `VITE_CHECKOUT_URL` | https checkout URL for the desktop license. Invalid values are dropped. Unset uses the Polar checkout in `web/src/monetization/offer.ts` ($39, one-time). |
| `VITE_ANALYTICS_PROVIDER` | `plausible` to enable analytics (needs the domain too); else off. |
| `VITE_PLAUSIBLE_DOMAIN` | Site domain, e.g. `clipspike.com`. |
| `VITE_PLAUSIBLE_SRC` | Optional self-hosted Plausible script URL. |

When you add a new `VITE_*` variable to `web/.env.example`, also add it to the build step's `env` in `pages.yml`.

## Pieces and setup

### 1. Consent and legal
- `ConsentBanner` appears only when ads (AdSense) or analytics are configured. Choices (Accept all / Reject all / Customize) are stored in localStorage `clipspike:consent`; "Cookie settings" in the footer reopens it. Ads and analytics scripts load **only after** the matching consent.
- `/privacy` and `/terms` are routed in the app and linked in the footer. They are the published pages (operator: AST Labs). Update the date when you change them. They cover Twitch embeds, ads/analytics and affiliate disclosure.
- For EU/UK traffic Google requires a certified CMP for AdSense; the built-in banner is a basic consent gate, not a certified CMP. Use one before serving ads there.

### 2. Display ads (Google AdSense)
1. Get the site approved in AdSense, create two ad units.
2. Set `VITE_ADS_ENABLED=true`, `VITE_AD_PROVIDER=adsense`, `VITE_ADSENSE_CLIENT=ca-pub-…`, `VITE_ADSENSE_SLOT_GRID`, `VITE_ADSENSE_SLOT_SIDEBAR`.
3. Replace the placeholder in `site/ads.txt` (deployed at `https://clipspike.com/ads.txt`) with the line AdSense gives you.
- Placement: one full-row unit after every 8 clips on `/clips`, and one in the sidebar (desktop only). Slots reserve their height so nothing shifts. No ads on the clip player page or over embeds.
- Alternative: `VITE_AD_PROVIDER=sponsor` with `VITE_ADS_ENABLED=true`, `VITE_SPONSOR_NAME/URL/TEXT` shows a first-party labelled link, no scripts.

### 3. Affiliate / sponsor cards
- Edit `web/src/monetization/affiliates.json` (shipped with placeholder `example.com` links) and set `VITE_AFFILIATES_ENABLED=true`. Cards show on the clip page with a "Sponsored" tag, `rel="sponsored noopener noreferrer"` and an FTC-style disclosure. Check each program's terms (Amazon Associates needs its exact statement).

### 4. Support / tip jar
- Set `VITE_SUPPORT_URL` to your Ko-fi, Buy Me a Coffee or GitHub Sponsors page. Shown in the sidebar, footer and on the clip page.

### 5. Pro (`/pro`)
- What is sold is the Windows app: a 7-day trial, then a $39 one-time Polar license to keep capturing. Web clip browsing stays free. The page lists that price and does not promise web-only features that are not enforced.
- `/pro` shows **Get ClipSpike Pro** using the checkout in `web/src/monetization/offer.ts`, which is the same URL as `win/build-config.json`. Set `VITE_CHECKOUT_URL` to a different https checkout to override it. Anything that is not https is ignored and the committed checkout stays. Do not put a secret in this variable.
- Set `VITE_WAITLIST_ENDPOINT` (e.g. `https://formspree.io/f/<your-form-id>`; JSON POST) and/or `VITE_WAITLIST_EMAIL` (mailto fallback) to show the waitlist under the checkout button. With neither, `/pro` does not render a waitlist.

### 6. Analytics hooks
- `track()` in `web/src/monetization/analytics.ts` is a no-op unless `VITE_ANALYTICS_PROVIDER=plausible`, `VITE_PLAUSIBLE_DOMAIN` is set and the user accepted analytics. Events: `support_click`, `affiliate_click`, `sponsor_click`, `pro_waitlist_view`, `pro_waitlist_submit`, `pro_cta_click`, `pro_checkout_click`. No personal data is sent. Self-host via `VITE_PLAUSIBLE_SRC`.
- **Setup**: in Plausible add the site `clipspike.com`, then set the repository Variables `VITE_ANALYTICS_PROVIDER=plausible` and `VITE_PLAUSIBLE_DOMAIN=clipspike.com` (optionally `VITE_PLAUSIBLE_SRC`); `pages.yml` passes them to the build. Nothing loads until the visitor accepts analytics in the consent banner.
- **Pageviews with path routing**: `initAnalytics()` injects Plausible's `script.js`, which records the initial pageview and every `history.pushState` navigation, so `/app/clips`, `/app/streamer/<login>` etc. each show up as their own page. 404-fallback deep links are restored with `replaceState` before the script loads, so they count under their real path. Accepting consent mid-session loads the script and records the current page.

## Other options
| Option | Notes |
|---|---|
| Pro for the desktop app | Sold now: a 7-day Windows trial, then the $39 one-time Polar license in `win/build-config.json`. An ended trial blocks a new capture. `lib/freetier.js` is not the plan either app selects. |
| Direct sponsorships | Best first step: one labelled `sponsor` slot, no third-party code. |

## Compliance checklist (before enabling anything)
- **Twitch Developer Services Agreement**: don't imply affiliation, don't monetize Twitch data/API access itself, keep embeds unobstructed (no ads over/inside the player), confirm ads next to a clip browser are permitted.
- **Clip content**: clips belong to their streamers. Link/embed, never rehost; honor takedowns; get legal review.
- **Privacy/consent**: finalize `/privacy` and `/terms`; `site/privacy.html` (desktop app) is separate and says no analytics.
- **Disclosures**: label sponsored/affiliate content (FTC and similar).
- **Children**: not directed at children; no personalized ads for under-13s.
- The desktop license is sold through Polar, the merchant of record. Terms and the refund policy are the published pages.

This document is not legal advice.

## Mature-content filter

Twitch's clips API has no mature flag, so `web/src/lib/matureFilter.ts` flags clips from their title (sexual and explicit terms, slurs, gore, star-masked profanity, plus elongated, leetspeak and dotted spellings) and from a manual `BLOCKED_CLIP_IDS` list.

- Flagged clips are **blurred** with a "Mature" tag by default.
- Once ads, a sponsor or affiliate links are configured (the same condition that shows the sponsored-links footer notice), flagged clips are **hidden entirely**, so no ad sits next to them.
- The Twitch fetch also records each channel's content-classification labels as `matureLabels`; channels labelled `SexualThemes` or `ViolentGraphic` have all their clips flagged (`MATURE_LABELS` in `matureFilter.ts`). Labels are channel-level and current, not per-clip. `MatureGame` and `ProfanityVulgarity` are recorded but not used.
- Beyond that it is a title heuristic: it cannot see the video. Review the top clips before applying to an ad network, and add reviewed ids to `BLOCKED_CLIP_IDS`.

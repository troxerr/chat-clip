# Monetization

Everything is **off by default**. With no env vars set the web app has no ads, no affiliate cards, no tip links, no analytics, no consent banner and loads no third-party scripts. Configure at build time with `VITE_*` variables (see `web/.env.example`; set them as repository/CI variables for the Pages build). These are public values: never put secrets in them, and never commit real IDs.

Config lives in `web/src/monetization/config.ts` (`buildConfig` validates every value; invalid URLs/IDs are dropped). The app is served at `https://clipspike.com/app/`.

## Pieces and setup

### 1. Consent and legal
- `ConsentBanner` appears only when ads (AdSense) or analytics are configured. Choices (Accept all / Reject all / Customize) are stored in localStorage `clipspike:consent`; "Cookie settings" in the footer reopens it. Ads and analytics scripts load **only after** the matching consent.
- `/privacy` and `/terms` are routed in the app and linked in the footer. They are templates with `[DATE]` / `[LEGAL ENTITY]` placeholders: fill them in and get legal review. They cover Twitch embeds, ads/analytics and affiliate disclosure.
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

### 5. Pro tier teaser (`/pro`)
- Set `VITE_WAITLIST_ENDPOINT` (e.g. `https://formspree.io/f/<your-form-id>`; JSON POST) and/or `VITE_WAITLIST_EMAIL` (mailto fallback). With neither, the page says the waitlist is not open. No payments are processed.

### 6. Analytics hooks
- `track()` in `web/src/monetization/analytics.ts` is a no-op unless `VITE_ANALYTICS_PROVIDER=plausible`, `VITE_PLAUSIBLE_DOMAIN` is set and the user accepted analytics. Events: `support_click`, `affiliate_click`, `sponsor_click`, `pro_waitlist_view`, `pro_waitlist_submit`, `pro_cta_click`. No personal data is sent. Self-host via `VITE_PLAUSIBLE_SRC`.

## Other options
| Option | Notes |
|---|---|
| Pro for the desktop app | Mac has a Lemon Squeezy license flow and `lib/freetier.js`; extend to Windows. Strongest long-term revenue. |
| Direct sponsorships | Best first step: one labelled `sponsor` slot, no third-party code. |

## Compliance checklist (before enabling anything)
- **Twitch Developer Services Agreement**: don't imply affiliation, don't monetize Twitch data/API access itself, keep embeds unobstructed (no ads over/inside the player), confirm ads next to a clip browser are permitted.
- **Clip content**: clips belong to their streamers. Link/embed, never rehost; honor takedowns; get legal review.
- **Privacy/consent**: finalize `/privacy` and `/terms`; `site/privacy.html` (desktop app) is separate and says no analytics.
- **Disclosures**: label sponsored/affiliate content (FTC and similar).
- **Children**: not directed at children; no personalized ads for under-13s.
- Paid tiers later: Terms/refund policy and tax (Lemon Squeezy is merchant of record).

This document is not legal advice.

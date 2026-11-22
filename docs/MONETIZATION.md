# Monetization options

Groundwork only. Nothing here is enabled; ClipSpike ships with no ads, no affiliate links, and no tracking.

## What exists in the code
- `web/src/monetization/config.ts` is the single config. `adsEnabled` is `false` by default, and the sponsor slot (`SponsorSlot`) renders nothing and loads no third-party script until it is flipped. `supportUrl` is empty, which hides `SupportLink`.
- Providers: `sponsor` (a first-party, static, labelled link; no scripts) and `adsense` (loads Google's script only if ids are set **and** the user has consented: localStorage `clipspike:ad-consent` = `granted`). A real consent banner must set that key before AdSense is used.
- `site/windows.html` links to GitHub Releases `latest`; no binaries are committed.

## Options
| Option | Fit | Notes |
|---|---|---|
| Direct sponsorships | Best first step | One labelled `sponsor` slot, no third-party code, flat monthly fee. Use `rel="sponsored"` (already set). |
| Display ads (Google AdSense) | Later, needs traffic | Needs site approval, consent banner, privacy policy updates, `ads.txt`. Only on the web app/site, never in the desktop app. |
| Affiliate links (Twitch/Amazon Associates, gaming gear/software programs) | Low effort | Disclose clearly (e.g. "affiliate link"); each program has its own terms (Amazon requires a specific disclosure statement). Do not place inside clip embeds. |
| Support/donation link | Simplest | Set `supportUrl` (Ko-fi, GitHub Sponsors, etc.). |
| Pro tier for the desktop app | Strongest | Mac already has a Lemon Squeezy license flow and a free-tier module (`lib/freetier.js`). Extend to Windows via the same licensing; keep a useful free tier. |

## Compliance checklist (before enabling anything)
- **Twitch Developer Services Agreement**: review it and the Developer Guidelines. Do not imply Twitch affiliation or endorsement; do not sell or monetize Twitch data/API access itself; follow rules on use of Twitch content, branding, and embeds (embeds must stay unobstructed; don't put ads over or inside the player). Confirm that showing ads next to a clip browser is permitted for your API usage.
- **Clip content and copyright**: clips belong to their streamers and may contain third-party music or game content. ClipSpike links/embeds clips rather than rehosting them; keep it that way, honor takedown requests, and get legal review before monetizing a site that surfaces other people's content.
- **Privacy policy**: `site/privacy.html` is a template and says no analytics. Update it to name every ad/affiliate provider, the data they collect, and retention, before launch.
- **Cookie consent**: ad networks set cookies and process personal data. For EU/UK/etc. visitors, obtain prior opt-in consent (and use a Google-certified CMP for AdSense in those regions). The default must be "no third-party scripts".
- **Disclosures**: label sponsored and affiliate content (FTC and similar rules). Keep ads clearly separate from content.
- **Children**: the service is not directed at children; do not enable personalized ads for under-13 users.
- Other: update Terms/EULA for paid tiers, refund policy, tax setup (Lemon Squeezy handles VAT as merchant of record).

This document is not legal advice.

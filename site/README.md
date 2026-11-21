# ClipSpike website

Static site for the macOS app. No build step.

## Deploy with GitHub Pages

`.github/workflows/pages.yml` publishes `site/` to GitHub Pages on a push to `main` that changes `site/`. Enable Pages in the repository settings (Source: GitHub Actions) and set the custom domain there.

The download and checkout links remain placeholders until the notarized DMG and Lemon Squeezy product exist.

## Preview

```sh
python3 -m http.server 8080 --directory site
# http://localhost:8080
```

## Before publishing

- Replace the placeholder download links (`#` and the final CTA) with the notarized DMG URL.
- Replace the Lemon Squeezy checkout link in the pricing card and download CTA.
- Replace `support@clipspike.example` and the legal entity/address placeholders.
- Point the app’s `HDCheckoutURL` at the same checkout.
- Have the privacy policy, terms, EULA, refund policy, and third-party notices reviewed by a lawyer.
- Add real screenshots and a demo video. The current hero is a CSS mockup so no personal desktop content is exposed.
- Add analytics only if the privacy policy and consent flow cover it.

The legal pages are starting templates, not legal advice. Do not sell without review.

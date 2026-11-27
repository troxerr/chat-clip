import { Link } from 'react-router-dom'
import { monetization } from '../monetization'
import { hasSponsoredContent } from '../monetization/config'

export default function Privacy() {
  return (
    <article className="legal">
      <h1>Privacy Policy</h1>
      <p className="meta">Last updated: 2026-11-25 · Operator: AST Labs (ast.labs@outlook.com).</p>
      <h2>What this web app does</h2>
      <p>
        ClipSpike shows Twitch highlights. Your favorites, followed streamers and settings are stored in your
        browser&apos;s local storage and never sent to us, as is your cookie-banner choice. We do not run user accounts.
      </p>
      <h2>Hosting and fonts</h2>
      <p>
        The site is hosted on GitHub Pages, which receives your IP address and request details in its normal server logs under
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer"> GitHub&apos;s privacy statement</a>.
        Fonts are served from this site, not from a third-party font service.
      </p>
      <h2>Twitch embeds and content</h2>
      <p>
        Clip thumbnails are loaded from Twitch&apos;s image servers as soon as a page is shown, so Twitch receives your IP address and
        browser details at that point. Pressing play loads an embedded Twitch player. On a small set of featured watch pages, the player loads when the page opens, with autoplay off. Twitch receives your IP address and
        device information and may set cookies under its own <a href="https://www.twitch.tv/p/legal/privacy-notice/" target="_blank" rel="noopener noreferrer">Privacy Notice</a>.
        ClipSpike is not affiliated with or endorsed by Twitch. Clips belong to their creators.
      </p>
      <h2>Optional cookies: advertising and analytics</h2>
      <p>
        Only if enabled on this deployment, and only after you accept in the consent banner, we may load:
      </p>
      <ul>
        <li><strong>Google AdSense</strong> for display ads. Google and its partners may use cookies and similar technologies to serve and measure ads. See <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">how Google uses data</a>.</li>
        <li><strong>Plausible Analytics</strong> (or a similar privacy-friendly tool) for aggregated, cookieless usage counts, including play and share clicks, download clicks, and clicks on support, sponsor, affiliate and Pro links.</li>
      </ul>
      <p>
        If you reject or don&apos;t choose, none of these load. You can change your choice any time with &quot;Cookie settings&quot; in the
        footer. California residents: we do not sell personal information; rejecting disables ad personalization on our side.
      </p>
      <h2>Affiliate and sponsored links</h2>
      {hasSponsoredContent(monetization) ? (
        <p>
          Some links are sponsored or affiliate links. If you buy through them we may earn a commission at no extra cost to you. They are
          labeled &quot;Sponsored&quot; and use <code>rel=&quot;sponsored&quot;</code>. The destination sites have their own privacy practices.
        </p>
      ) : (
        <p>
          ClipSpike does not currently show sponsored or affiliate links. If that changes, they will be labeled &quot;Sponsored&quot; and this
          section will say so.
        </p>
      )}
      <h2>Support link</h2>
      <p>
        If a support link is shown, it leads to a third-party site (such as Ko-fi) that has its own privacy practices. Nothing is sent to it
        unless you click.
      </p>
      <h2>Pro waitlist</h2>
      <p>
        If you join the waitlist, your email address is sent to our form provider (Formspree) or, if that fails, to our inbox by your own email app and used only to
        notify you about ClipSpike Pro. Ask us to delete it at any time.
      </p>
      <h2>Your rights</h2>
      <p>Depending on where you live (GDPR, UK GDPR, CCPA/CPRA) you may request access, correction, deletion, or object to processing. Contact the operator above.</p>
      <h2>Children</h2>
      <p>ClipSpike is not directed to children under 13 (or 16 where applicable).</p>
      <p><Link to="/terms">Terms of Service</Link></p>
    </article>
  )
}

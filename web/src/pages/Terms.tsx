import { Link } from 'react-router-dom'

export default function Terms() {
  return (
    <article className="legal">
      <h1>Terms of Service</h1>
      <p className="meta">Last updated: 2026-11-22 · Operator: AST Labs (ast.labs@outlook.com). Template: have it reviewed before relying on it.</p>
      <h2>Use of the service</h2>
      <p>ClipSpike is provided &quot;as is&quot; for personal, non-commercial browsing of Twitch highlights. Don&apos;t abuse, scrape or overload it.</p>
      <h2>Third-party content</h2>
      <p>
        Clips and channel data come from Twitch and belong to their creators. ClipSpike links to and embeds them and does not host them.
        ClipSpike is not affiliated with or endorsed by Twitch Interactive, Inc. Takedown requests: contact the operator.
      </p>
      <h2>Advertising, sponsorship and affiliate disclosure</h2>
      <p>
        The app may show ads, sponsored placements and affiliate links, always labeled. We may earn revenue from them; this does not influence which
        highlights are ranked. We are not responsible for third-party products or sites.
      </p>
      <h2>ClipSpike Pro</h2>
      <p>Pro is not yet for sale; joining the waitlist is not a purchase or a commitment. Paid terms will be published before any payment is taken.</p>
      <h2>Liability</h2>
      <p>To the extent permitted by law, we are not liable for indirect or consequential damages arising from use of the service.</p>
      <p><Link to="/privacy">Privacy Policy</Link></p>
    </article>
  )
}

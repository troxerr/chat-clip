import SupportLink from './SupportLink'
import { isHttpUrl } from './config'
import { monetization } from './index'

export default function SupportCard({ url = monetization.supportUrl }: { url?: string }) {
  if (!isHttpUrl(url)) return null
  return (
    <aside className="support-card" aria-label="Support ClipSpike">
      <p>Enjoying the clips? ClipSpike is free and independent. A tip keeps it running.</p>
      <SupportLink url={url} placement="clip" className="btn" />
    </aside>
  )
}

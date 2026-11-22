import { isHttpUrl, monetization } from './config'

export default function SupportLink({ url = monetization.supportUrl }: { url?: string }) {
  if (!isHttpUrl(url)) return null
  return (
    <a className="support-link" href={url} target="_blank" rel="noopener noreferrer">
      Support ClipSpike
    </a>
  )
}

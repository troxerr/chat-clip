import { isHttpUrl } from './config'
import { monetization } from './index'
import { track } from './analytics'

export default function SupportLink({
  url = monetization.supportUrl,
  placement = 'footer',
  className = 'support-link',
}: {
  url?: string
  placement?: string
  className?: string
}) {
  if (!isHttpUrl(url)) return null
  return (
    <a className={className} href={url} target="_blank" rel="noopener noreferrer" onClick={() => track('support_click', { placement })}>
      ♥ Support ClipSpike
    </a>
  )
}

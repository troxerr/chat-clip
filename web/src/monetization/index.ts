import { buildConfig, type AffiliateItem, type MonetizationConfig } from './config'
import affiliates from './affiliates.json'

export const monetization: MonetizationConfig = buildConfig(
  import.meta.env as Record<string, string | undefined>,
  affiliates as AffiliateItem[],
)

// Public price for ClipSpike for Windows. Polar is the merchant of record.
// The checkout URL matches win/build-config.json. A valid https VITE_CHECKOUT_URL overrides it.
export const publicOffer = {
  priceLabel: '$39',
  billing: 'one-time',
  trialDays: 7,
  computers: 2,
  checkoutUrl: 'https://buy.polar.sh/polar_cl_per43WQXkviGSWYLBkNSb86XNDIVkW3ZcDc7z0WOJ7G',
} as const

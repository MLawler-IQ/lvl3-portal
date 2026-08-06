// The success/error banner shared by the Google and GBP connection panels.
//
// It was byte-identical in both (GoogleConnectionPanel and GBPConnectionPanel), and
// tokenised on extraction: the raw error reds became the error token, and the accent
// alias became brand-400 directly.
//
// The old markup mixed shades — error text on a tint derived from a different rung of
// the same ramp. A single token pair removes the question.

export interface ConnectionBannerProps {
  banner: { type: 'success' | 'error'; message: string } | null
}

export default function ConnectionBanner({ banner }: ConnectionBannerProps) {
  if (!banner) return null
  return (
    <div
      role={banner.type === 'error' ? 'alert' : 'status'}
      className={`rounded-sm px-4 py-2.5 text-sm border ${
        banner.type === 'success'
          ? 'bg-brand-400/10 border-brand-400/20 text-brand-400'
          : 'bg-error/10 border-error/20 text-error'
      }`}
    >
      {banner.message}
    </div>
  )
}

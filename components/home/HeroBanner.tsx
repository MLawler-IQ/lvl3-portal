interface HeroBannerProps {
  clientName: string | null
  heroImageUrl: string | null
  clientLogoUrl: string | null
}

export default function HeroBanner({ clientName, heroImageUrl, clientLogoUrl }: HeroBannerProps) {
  return (
    <div className="rounded-xl overflow-hidden relative">
      {heroImageUrl ? (
        /* With hero image */
        <div className="relative h-[200px] w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroImageUrl}
            alt={clientName ?? 'Hero'}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-surface-950/70" />
          {/* Content */}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-5 flex items-end justify-between">
            <div className="flex items-center gap-3">
              {clientLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clientLogoUrl}
                  alt={clientName ? `${clientName} logo` : ''}
                  className="w-8 h-8 rounded-sm object-contain bg-surface-100/10 p-0.5 shrink-0"
                />
              )}
              <div>
                {clientName && (
                  <p className="text-sm font-medium text-surface-300">{clientName}</p>
                )}
                <h1 className="text-2xl font-medium text-surface-100 leading-tight">
                  This week at a glance
                </h1>
              </div>
            </div>
            <p className="text-[10px] text-surface-400 uppercase tracking-wider shrink-0">LVL3 Portal</p>
          </div>
        </div>
      ) : (
        /* Flat panel fallback — the editorial system has no gradients */
        <div className="relative h-[140px] w-full bg-surface-900 border border-surface-800 rounded-sm">
          <div className="absolute inset-0 px-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {clientLogoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={clientLogoUrl}
                  alt={clientName ? `${clientName} logo` : ''}
                  className="w-8 h-8 rounded-sm object-contain bg-surface-100/10 p-0.5 shrink-0"
                />
              )}
              <div>
                {clientName && (
                  <p className="text-sm font-medium text-surface-300">{clientName}</p>
                )}
                <h1 className="text-2xl font-medium text-surface-100 leading-tight">
                  This week at a glance
                </h1>
              </div>
            </div>
            <p className="text-[10px] text-surface-400 uppercase tracking-wider shrink-0">LVL3 Portal</p>
          </div>
        </div>
      )}
    </div>
  )
}

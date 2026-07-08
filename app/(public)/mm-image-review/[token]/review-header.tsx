'use client'

type Props = {
  approved: number
  denied: number
  pending: number
}

export function ReviewHeader({ approved, denied, pending }: Props) {
  return (
    <header>
      <div className="bar">
        <div className="mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-black.png" alt="IgniteIQ" width={26} height={26} />
          <span className="wm">IgniteIQ</span>
        </div>
        <div className="progress">
          <span className="chip">
            <span className="dot g" />
            {approved} approved
          </span>
          <span className="chip">
            <span className="dot r" />
            {denied} denied
          </span>
          <span className="chip">
            <span className="dot p" />
            {pending} pending
          </span>
        </div>
      </div>
    </header>
  )
}

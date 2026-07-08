export function InvalidLink() {
  return (
    <>
      <header>
        <div className="bar">
          <div className="mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-black.png" alt="IgniteIQ" width={26} height={26} />
            <span className="wm">IgniteIQ</span>
          </div>
        </div>
      </header>
      <main className="invalid">
        <div className="eyebrow">IgniteIQ · Content Review</div>
        <h1>
          This link isn&apos;t active.{' '}
          <span className="soft">Ask your IgniteIQ contact for a fresh one.</span>
        </h1>
      </main>
      <div className="foot">© 2026 IgniteIQ Inc. · Own Your Intelligence. · Framework V4.2</div>
    </>
  )
}

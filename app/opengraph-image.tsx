import { ImageResponse } from 'next/og'

// OG image. None existed before this, so a shared portal link previewed as a bare URL.
//
// Generated rather than checked in as a PNG: ImageResponse ships with Next 14, so this
// adds no dependency, and the values below stay in step with the token block instead of
// being baked into a binary nobody will re-export.
//
// System fonts only. Loading Archivo here would mean fetching and embedding the woff2
// at request time, and the mark is a wordmark in a heavy weight — the difference is not
// worth the failure mode of an OG image that 500s when the font fetch is slow.

export const runtime = 'edge'
export const alt = 'LVL3 Portal'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const INK = '#171410'
const PAPER = '#F5F2EA'
const SIENNA = '#E0703F'
const RULE = '#3A3428'
const MUTED = '#A79E8C'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: INK,
          padding: '72px 80px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: 84,
              fontWeight: 800,
              letterSpacing: '-0.03em',
              color: PAPER,
            }}
          >
            LVL3
          </span>
          <span style={{ fontSize: 84, fontWeight: 800, color: SIENNA }}>.</span>
          <span
            style={{
              fontSize: 30,
              color: MUTED,
              marginLeft: 24,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Portal
          </span>
        </div>

        {/* Hairline, because rules separate content and cards do not exist. */}
        <div style={{ display: 'flex', height: 1, background: RULE, width: '100%' }} />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 44, color: PAPER, lineHeight: 1.25 }}>
            Search, analytics and delivery
          </span>
          <span style={{ fontSize: 44, color: MUTED, lineHeight: 1.25 }}>
            for the work we do together.
          </span>
        </div>
      </div>
    ),
    size,
  )
}

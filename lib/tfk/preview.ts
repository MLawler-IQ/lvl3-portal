// lib/tfk/preview.ts — build TFK brand HTML preview string for iframe
import { TFK_CSS } from './tfk-page-css'
import type { TfkLocation } from './types'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildPreviewHtml(row: TfkLocation): string {
  const city  = row.city  ?? ''
  const state = row.state ?? ''

  // Neighborhood tags
  let tagsHtml = ''
  if (row.neighborhood_tags) {
    for (const tag of row.neighborhood_tags.split('|')) {
      tagsHtml += `<span class="hood-tag">${esc(tag.trim())}</span>`
    }
  }

  // Trust badges
  const pdrBadge   = row.has_pdr === 1 ? `<span class="trust-badge"><span class="dot"></span>Private Dining</span>` : ''
  const patioBadge = (row.exterior_seats ?? 0) > 0 ? `<span class="trust-badge"><span class="dot"></span>Patio Seating</span>` : ''

  // Hours
  let hoursRows = ''
  const hourFields: Array<[keyof TfkLocation, string]> = [
    ['hours_mon_thu', 'Mon–Thu'], ['hours_fri', 'Friday'],
    ['hours_sat', 'Saturday'],   ['hours_sun', 'Sunday'],
  ]
  for (const [field, label] of hourFields) {
    const val = row[field] as string | null
    if (val) hoursRows += `<strong>${label}:</strong> ${esc(val)}<br>`
  }

  // Hours match badge
  let matchBadge = ''
  if (row.hours_match === '✓ Match') {
    matchBadge = ` &nbsp;<span style="color:#059669;font-size:11px;font-weight:600;">● Google Verified</span>`
  } else if (row.hours_match === '⚠ Mismatch') {
    matchBadge = ` &nbsp;<span style="color:#D97706;font-size:11px;font-weight:600;">⚠ Check hours vs Google</span>`
  }

  // FAQ items
  const faqItems: Array<[string, string]> = [
    [`Does True Food Kitchen ${city} take reservations?`, row.faq_reservations ?? ''],
    [`What time does True Food Kitchen ${city} close today?`, row.faq_hours ?? ''],
    ['Does this location offer vegan options?', 'Yes. We offer multiple fully vegan entrées, bowls, starters, and desserts.'],
    ['Does this location have gluten-friendly options?', 'Yes. Many dishes can be prepared gluten-friendly. Cross-contact is possible — please inform your server.'],
    ['Is catering available from this location?', 'Yes. We offer full-service catering for offices, events, and celebrations.'],
    ['Where should I park?', row.faq_parking ?? ''],
    ['How do I order pickup or delivery?', row.faq_order_url_note ?? ''],
  ]
  let faqHtml = ''
  faqItems.forEach(([q, a], i) => {
    const cls = i === 0 ? 'faq-item open' : 'faq-item'
    faqHtml += `<div class="${cls}"><div class="faq-q" onclick="this.parentElement.classList.toggle('open')">${esc(q)}<span class="chevron">▾</span></div><div class="faq-a">${esc(a)}</div></div>\n`
  })

  // Links
  const reserveHref = row.url_reserve || '#'
  const orderHref   = row.url_order   || '#'
  const dirsHref    = row.url_directions || '#'
  const pdrNavLink  = row.has_pdr === 1
    ? `<a href="#"><svg viewBox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>Group Dining</a>` : ''
  const pdrCta = row.has_pdr === 1
    ? `<a href="#" class="cta-btn cta-tertiary">Private Dining Inquiry</a>` : ''

  // Google rating
  let ratingHtml = ''
  if (row.google_rating) {
    const stars = '★'.repeat(Math.min(5, Math.floor(row.google_rating)))
    const cnt   = row.google_review_count
    ratingHtml = cnt
      ? `<div class="google-rating"><span class="stars">${stars}</span> <strong>${row.google_rating}</strong> · ${Number(cnt).toLocaleString()} Google reviews</div>`
      : ''
  }

  const titleLen = (row.page_title ?? '').length
  const metaLen  = (row.meta_description ?? '').length

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(row.page_title ?? `True Food Kitchen ${city}`)}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
  <style>${TFK_CSS}</style>
  <style>
    body { margin: 0; }
    .preview-banner { position: sticky; top: 0; z-index: 999; background: #171410; color: #E0703F; font-family: 'Courier New', monospace; font-size: 11px; padding: 6px 16px; letter-spacing: .05em; display: flex; justify-content: space-between; align-items: center; }
    .preview-banner .meta { color: #71717a; }
  </style>
</head>
<body>

<div class="preview-banner">▶ LVL3 PREVIEW — ${esc(row.store_name ?? '')} (${esc(city)}, ${esc(state)})<span class="meta">page_title: ${titleLen} chars · meta: ${metaLen} chars</span></div>

<nav class="sticky-bar">
  <a href="${esc(reserveHref)}" class="primary-action">
    <svg viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"></path></svg>
    Reserve
  </a>
  <a href="${esc(orderHref)}">
    <svg viewBox="0 0 24 24"><path d="M18.06 22.99h1.66c.84 0 1.53-.65 1.63-1.48L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-4.5-6-5-6-5s-6 .5-6 5v5h12v-5z"></path></svg>
    Order
  </a>
  <a href="#">
    <svg viewBox="0 0 24 24"><path d="M8.1 13.34l2.83-2.83L3.91 3.5c-1.56 1.56-1.56 4.09 0 5.66l4.19 4.18zm6.78-1.81c1.53.71 3.68.21 5.27-1.38 1.91-1.91 2.28-4.65.81-6.12-1.46-1.46-4.2-1.1-6.12.81-1.59 1.59-2.09 3.74-1.38 5.27L3.7 19.87l1.41 1.41L12 14.41l6.88 6.88 1.41-1.41L13.41 13l1.47-1.47z"></path></svg>
    Catering
  </a>
  <a href="tel:${esc(row.phone_e164)}">
    <svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"></path></svg>
    Call
  </a>
  ${pdrNavLink}
  <a href="${esc(dirsHref)}">
    <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path></svg>
    Directions
  </a>
</nav>

<section class="hero" style="background: linear-gradient(135deg, #093621 0%, #12603c 60%, #0d4a2e 100%); display:flex; align-items:flex-end;">
  <div class="hero-overlay" style="width:100%; padding:70px 0 30px;">
    <div class="hero-content">
      <h1>True Food Kitchen ${esc(city)}</h1>
      <p class="subhead">${esc(row.hero_subhead ?? '')}</p>
      <div class="trust-strip">
        <span class="trust-badge"><span class="dot"></span>Vegan-Friendly</span>
        <span class="trust-badge"><span class="dot"></span>Gluten-Friendly</span>
        <span class="trust-badge"><span class="dot"></span>Brunch</span>
        <span class="trust-badge"><span class="dot"></span>Catering</span>
        ${patioBadge}
        ${pdrBadge}
      </div>
      ${ratingHtml}
    </div>
  </div>
</section>

<section class="facts-section">
  <div class="container">
    <div class="facts-grid">
      <div class="fact-item">
        <div class="fact-icon"><svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"></path></svg></div>
        <div>
          <div class="fact-label">Address</div>
          <div class="fact-value"><a href="${esc(dirsHref)}">${esc(row.address ?? '')}, ${esc(city)}, ${esc(state)} ${esc(row.zip ?? '')}</a></div>
        </div>
      </div>
      <div class="fact-item">
        <div class="fact-icon"><svg viewBox="0 0 24 24"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"></path></svg></div>
        <div>
          <div class="fact-label">Phone</div>
          <div class="fact-value"><a href="tel:${esc(row.phone_e164)}">${esc(row.phone_display ?? '')}</a></div>
        </div>
      </div>
      <div class="fact-item">
        <div class="fact-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"></path></svg></div>
        <div>
          <div class="fact-label">Hours${matchBadge}</div>
          <div class="fact-value">${esc(row.hours_mon_thu ?? '')} (Mon–Thu)</div>
          <button class="hours-toggle" onclick="this.nextElementSibling.classList.toggle('show')">See full week ↓</button>
          <div class="hours-full">${hoursRows}</div>
        </div>
      </div>
      <div class="fact-item">
        <div class="fact-icon"><svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99z"></path></svg></div>
        <div>
          <div class="fact-label">Parking</div>
          <div class="fact-value">${esc(row.parking ?? '')}</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="conversion-section">
  <div class="container">
    <div class="cta-grid">
      <a href="${esc(reserveHref)}" class="cta-btn cta-primary">Reserve a Table</a>
      <a href="${esc(orderHref)}" class="cta-btn cta-secondary">Order Pickup / Delivery</a>
      <a href="#" class="cta-btn cta-secondary">Catering Order</a>
      ${pdrCta}
      <a href="#" class="cta-btn cta-tertiary">Gift Cards</a>
    </div>
  </div>
</section>

<section class="section" style="background:var(--white);">
  <div class="container">
    <div class="section-label">About This Location</div>
    <h2>${esc(row.overview_h2 ?? '')}</h2>
    <p>${esc(row.overview_p1 ?? '')}</p>
    <p style="margin-top:1em;">${esc(row.overview_p2 ?? '')}</p>
  </div>
</section>

<section class="section" style="background:var(--bg-cream);">
  <div class="container">
    <div class="section-label">Neighborhood &amp; Getting Here</div>
    <h2>${esc(row.neighborhood_h2 ?? '')}</h2>
    <p>${esc(row.neighborhood_p ?? '')}</p>
    <div class="section-label" style="margin-top:20px;">Areas We Serve</div>
    <div class="neighborhood-tags">${tagsHtml}</div>
  </div>
</section>

<section class="section" style="background:var(--white);">
  <div class="container">
    <div class="section-label">Frequently Asked Questions</div>
    <h2>True Food Kitchen ${esc(city)} FAQ</h2>
    <div class="faq-list">
${faqHtml}    </div>
  </div>
</section>

<footer class="section-footer">
  <div class="container">
    <div class="footer-links">
      <a href="/locations/">All Locations</a>
      <a href="/menu/">Menu</a>
      <a href="/catering/">Catering</a>
      <a href="/group-dining/">Private Dining</a>
      <a href="/nutritionalguide/">Nutrition &amp; Allergens</a>
      <a href="/careers/">Careers</a>
      <a href="/truestory/">Our Story</a>
    </div>
    <p class="footer-copy">&copy; 2026 True Food Kitchen. All rights reserved.</p>
  </div>
</footer>

</body>
</html>`
}

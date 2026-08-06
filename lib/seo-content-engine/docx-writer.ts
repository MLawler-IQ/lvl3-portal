/**
 * SEO Content Engine — DOCX Writer
 * Generates professionally formatted Word documents.
 * Ported from Python docx_writer.py using the `docx` npm package.
 */
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  Packer,
  ShadingType,
  convertInchesToTwip,
} from 'docx'
import type { KeywordPlan, ContentBrief, DraftReview, TopicInput } from './types'

// ── Apex Proposal Style Constants ─────────────────────────────
const COLOR_EYEBROW = '64748B'
const COLOR_HEADING = '1E293B'
const COLOR_BODY = '334055'
const COLOR_MUTED = '94A3B8'
const COLOR_ACCENT = 'C55427' // sienna (brand-500); replaced the retired violet accent
const COLOR_TABLE_HEADER_BG = '18181B'
const COLOR_TABLE_BORDER = '3F3F46'

const FONT_BODY = 'Archivo'      // was Inter, retired by the rebrand
const FONT_HEADING = 'Newsreader' // was JetBrains Mono; serif headings per stage 2

// ── Helpers ────────────────────────────────────────────────────

function eyebrow(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 40 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: FONT_BODY,
        size: 16, // 8pt * 2
        bold: true,
        color: COLOR_EYEBROW,
        allCaps: true,
      }),
    ],
  })
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 100, after: 100 },
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: 36, // 18pt
        bold: true,
        color: COLOR_HEADING,
      }),
    ],
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({
        text,
        font: FONT_HEADING,
        size: 26, // 13pt
        bold: true,
        color: COLOR_HEADING,
      }),
    ],
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 60 },
    children: [
      new TextRun({
        text,
        font: FONT_BODY,
        size: 22, // 11pt
        bold: true,
        color: COLOR_HEADING,
      }),
    ],
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 40, after: 80 },
    children: [
      new TextRun({
        text,
        font: FONT_BODY,
        size: 22, // 11pt
        color: COLOR_BODY,
      }),
    ],
  })
}

function labelValue(label: string, value: string): Paragraph {
  return new Paragraph({
    spacing: { before: 20, after: 40 },
    children: [
      new TextRun({
        text: `${label}: `,
        font: FONT_BODY,
        size: 22,
        bold: true,
        color: COLOR_HEADING,
      }),
      new TextRun({
        text: value,
        font: FONT_BODY,
        size: 22,
        color: COLOR_BODY,
      }),
    ],
  })
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 20, after: 20 },
    indent: { left: convertInchesToTwip(0.25) },
    children: [
      new TextRun({
        text: '\u2022  ',
        font: FONT_BODY,
        size: 22,
        color: COLOR_ACCENT,
      }),
      new TextRun({
        text,
        font: FONT_BODY,
        size: 22,
        color: COLOR_BODY,
      }),
    ],
  })
}

const tableBorder = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: COLOR_TABLE_BORDER,
}

function styledTable(headers: string[], rows: string[][]): Table {
  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { fill: COLOR_TABLE_HEADER_BG, type: ShadingType.CLEAR },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: h,
                  font: FONT_BODY,
                  size: 18,
                  bold: true,
                  color: 'FAFAFA',
                }),
              ],
            }),
          ],
        }),
    ),
  })

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (val) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: val ?? '',
                      font: FONT_BODY,
                      size: 18,
                      color: COLOR_BODY,
                    }),
                  ],
                }),
              ],
            }),
        ),
      }),
  )

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: tableBorder,
      bottom: tableBorder,
      left: tableBorder,
      right: tableBorder,
      insideHorizontal: tableBorder,
      insideVertical: tableBorder,
    },
    rows: [headerRow, ...dataRows],
  })
}

// ── Markdown → Paragraphs ─────────────────────────────────────

function markdownToParagraphs(mdText: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = []
  const lines = mdText.split('\n')
  let tableRows: string[] = []

  const flushTable = () => {
    if (!tableRows.length) return
    const parsed: string[][] = []
    for (const tr of tableRows) {
      const cells = tr
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim())
      // Skip separator rows
      if (cells.every((c) => /^[-:]+$/.test(c))) continue
      parsed.push(cells)
    }
    if (parsed.length >= 2) {
      elements.push(styledTable(parsed[0], parsed.slice(1)))
    }
    tableRows = []
  }

  for (const line of lines) {
    const stripped = line.trim()

    if (stripped.startsWith('|') && stripped.includes('|')) {
      tableRows.push(stripped)
      continue
    } else {
      flushTable()
    }

    if (!stripped) continue

    if (stripped.startsWith('#### ')) {
      elements.push(h3(stripped.slice(5)))
    } else if (stripped.startsWith('### ')) {
      elements.push(h3(stripped.slice(4)))
    } else if (stripped.startsWith('## ')) {
      elements.push(h2(stripped.slice(3)))
    } else if (stripped.startsWith('# ')) {
      elements.push(h2(stripped.slice(2)))
    } else if (stripped.startsWith('- ') || stripped.startsWith('* ')) {
      elements.push(bullet(stripped.slice(2)))
    } else if (/^\d+\.\s/.test(stripped)) {
      const text = stripped.replace(/^\d+\.\s/, '')
      elements.push(bullet(text))
    } else if (stripped.startsWith('**') && stripped.endsWith('**')) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: stripped.replace(/\*\*/g, ''),
              font: FONT_BODY,
              size: 22,
              bold: true,
              color: COLOR_HEADING,
            }),
          ],
        }),
      )
    } else {
      elements.push(body(stripped))
    }
  }

  flushTable()
  return elements
}

// ── Coerce Helper ─────────────────────────────────────────────
// DB JSON may store keyword entries as objects {keyword, cpc, msv, ...}
function toStr(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (typeof entry === 'number') return String(entry)
  if (entry && typeof entry === 'object') return String((entry as Record<string, unknown>).keyword ?? entry)
  return String(entry ?? '')
}

function toStrArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return []
  return arr.map(toStr)
}

// ── Category Helper ────────────────────────────────────────────

function keywordCategory(kw: string, plan: KeywordPlan): string {
  const lower = kw.toLowerCase()
  if (toStrArray(plan.primary).some((k) => k.toLowerCase() === lower)) return 'Primary'
  if (toStrArray(plan.secondary).some((k) => k.toLowerCase() === lower)) return 'Secondary'
  if (toStrArray(plan.supporting).some((k) => k.toLowerCase() === lower)) return 'Supporting'
  if (toStrArray(plan.questions).some((k) => k.toLowerCase() === lower)) return 'Questions'
  return 'Other'
}

// ── Main Export ────────────────────────────────────────────────

export async function generateDocx(opts: {
  topic: TopicInput
  keywordPlan: KeywordPlan | null
  brief: ContentBrief | Record<string, unknown> | null
  draft: string | null
  draftReview: DraftReview | null
  wordCount: number
  mode: string
}): Promise<Buffer> {
  const sections: (Paragraph | Table)[] = []

  // ── 1. Title ─────────────────────────────────────────────────
  sections.push(eyebrow('SEO Content Deliverable'))
  sections.push(h1(opts.topic.title))
  sections.push(
    new Paragraph({
      spacing: { before: 40, after: 160 },
      children: [
        new TextRun({
          text: `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}  |  Mode: ${opts.mode}  |  ${opts.wordCount} words`,
          font: FONT_BODY,
          size: 18,
          color: COLOR_MUTED,
        }),
      ],
    }),
  )

  // ── 2. Keyword Strategy ──────────────────────────────────────
  if (opts.keywordPlan) {
    const plan = opts.keywordPlan
    sections.push(eyebrow('Keyword Intelligence'))
    sections.push(h2('Keyword Strategy'))

    const metrics = plan.metrics ?? {}
    const allKws = [
      ...toStrArray(plan.primary),
      ...toStrArray(plan.secondary),
      ...toStrArray(plan.supporting),
      ...toStrArray(plan.questions),
    ]
    const kwRows = allKws.map((kw) => {
      const cat = keywordCategory(kw, plan)
      const m = metrics[kw]
      return [
        kw,
        cat,
        m?.msv?.toString() ?? '',
        m?.cpc?.toFixed(2) ?? '',
        m?.competition?.toFixed(2) ?? '',
      ]
    })
    sections.push(styledTable(['Keyword', 'Category', 'MSV', 'CPC', 'Competition'], kwRows))

    if (plan.rationale) {
      sections.push(h3('Prioritization Rationale'))
      sections.push(body(plan.rationale))
    }

    if (plan.clusters?.length) {
      sections.push(h3('Semantic Clusters'))
      for (const cluster of plan.clusters) {
        const name = cluster.cluster_name ?? 'Cluster'
        const target = cluster.target_section ? ` → ${cluster.target_section}` : ''
        const kws = toStrArray(cluster.keywords).join(', ')
        sections.push(bullet(`${name}${target}: ${kws}`))
      }
    }
  }

  // ── 3. Content Brief ─────────────────────────────────────────
  if (opts.brief) {
    const brief = opts.brief as Record<string, unknown>
    sections.push(eyebrow('Content Brief'))
    sections.push(h2(`Brief: ${brief.title ?? opts.topic.title}`))

    if (brief.intent) {
      sections.push(h3('Search Intent'))
      sections.push(labelValue('Dominant Intent', String(brief.intent)))
    }

    const gaps = toStrArray(brief.competitive_gaps)
    if (gaps.length) {
      sections.push(h3('Competitive Gaps'))
      for (const g of gaps) sections.push(bullet(g))
    }

    const outline = brief.outline as Array<Record<string, unknown>> | undefined
    if (outline?.length) {
      sections.push(h3('Content Outline'))
      for (let i = 0; i < outline.length; i++) {
        const s = outline[i]
        const heading = String(s.heading ?? s.section ?? `Section ${i + 1}`)
        const wc = s.estimated_word_count ? ` (~${s.estimated_word_count} words)` : ''
        sections.push(bullet(`${i + 1}. ${heading}${wc}`))
      }
    }

    const geoTargets = toStrArray(brief.geo_targets)
    if (geoTargets.length) {
      sections.push(h3('GEO Targets'))
      for (const gt of geoTargets) sections.push(bullet(gt))
    }

    const hooks = toStrArray(brief.citation_hooks)
    if (hooks.length) {
      sections.push(h3('Citation Hooks'))
      for (const hook of hooks) sections.push(bullet(hook))
    }
  }

  // ── 4. Full Draft ────────────────────────────────────────────
  const finalDraft = opts.draft
  if (finalDraft) {
    sections.push(eyebrow('Full Draft'))
    sections.push(h2('Article Draft'))
    sections.push(...markdownToParagraphs(finalDraft))
  }

  // ── 5. Schema & Metadata ─────────────────────────────────────
  if (opts.brief) {
    const brief = opts.brief as Record<string, unknown>
    if (brief.meta_title || brief.meta_description) {
      sections.push(eyebrow('Technical SEO'))
      sections.push(h2('Schema & Metadata'))
      if (brief.meta_title) sections.push(labelValue('Meta Title', String(brief.meta_title)))
      if (brief.meta_description)
        sections.push(labelValue('Meta Description', String(brief.meta_description)))
    }
  }

  // ── 6. Quality Control ───────────────────────────────────────
  if (opts.draftReview) {
    const review = opts.draftReview
    sections.push(eyebrow('Quality Assurance'))
    sections.push(h2('Quality Control Summary'))
    sections.push(
      labelValue('Status', review.passed ? 'PASS' : 'FAIL'),
    )
    sections.push(labelValue('Word Count', String(review.word_count ?? 0)))
    sections.push(labelValue('GEO Score', review.geo_score ?? 'N/A'))
    sections.push(
      labelValue('Recommendation', (review.recommendation ?? 'N/A').toUpperCase()),
    )

    if ((review.issues ?? []).length) {
      sections.push(h3('Issues'))
      const issueRows = (review.issues ?? []).map((i) => [i.type ?? '', i.detail ?? '', i.severity ?? ''])
      sections.push(styledTable(['Type', 'Detail', 'Severity'], issueRows))
    }
  }

  // ── Build Document ───────────────────────────────────────────
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },
        children: sections,
      },
    ],
  })

  return Buffer.from(await Packer.toBuffer(doc))
}

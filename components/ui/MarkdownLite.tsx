import React from 'react'

// Minimal deterministic markdown renderer for assistant chat text. Supports the
// common subset Claude emits — headings, **bold**, *italic*, `inline code`,
// fenced code blocks, bullet/numbered lists, paragraphs — as React elements
// (no dangerouslySetInnerHTML). Streaming-safe: it re-parses the full text on
// every chunk, and an unclosed marker at the tail (`**…`, `` `…``, open fence)
// renders as plain text / open code until its closer arrives.

type Block =
  | { type: 'p'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; content: string }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const BULLET_RE = /^\s*[-*]\s+(.*)$/
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/
const FENCE_OPEN_RE = /^```[\w-]*\s*$/
const FENCE_CLOSE_RE = /^```\s*$/

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (FENCE_OPEN_RE.test(line)) {
      const content: string[] = []
      i++
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        content.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // skip the closing fence (absent mid-stream)
      blocks.push({ type: 'code', content: content.join('\n') })
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    if (BULLET_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(BULLET_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push({ type: 'ul', items })
      continue
    }

    if (ORDERED_RE.test(line)) {
      const items: string[] = []
      while (i < lines.length) {
        const m = lines[i].match(ORDERED_RE)
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push({ type: 'ol', items })
      continue
    }

    if (!line.trim()) {
      i++
      continue
    }

    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (
        !l.trim() ||
        FENCE_OPEN_RE.test(l) ||
        HEADING_RE.test(l) ||
        BULLET_RE.test(l) ||
        ORDERED_RE.test(l)
      )
        break
      para.push(l)
      i++
    }
    blocks.push({ type: 'p', text: para.join('\n') })
  }

  return blocks
}

/**
 * Inline pass: `code`, **bold** (may contain italic/code), *italic*.
 * Markers without a matching closer (e.g. the streaming tail) are emitted as
 * literal text, so a partial chunk never crashes or reflows oddly.
 */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let plain = ''
  let i = 0
  let k = 0
  const flush = () => {
    if (plain) {
      out.push(plain)
      plain = ''
    }
  }

  while (i < text.length) {
    const ch = text[i]

    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close > i + 1) {
        flush()
        out.push(
          <code
            key={`${keyBase}-c${k++}`}
            className="bg-surface-800 border border-surface-700 rounded px-1 py-0.5 text-[0.85em] font-mono"
          >
            {text.slice(i + 1, close)}
          </code>,
        )
        i = close + 1
        continue
      }
    } else if (ch === '*') {
      if (text.startsWith('**', i)) {
        const close = text.indexOf('**', i + 2)
        if (close > i + 2 && !/\s/.test(text[i + 2]) && !/\s/.test(text[close - 1])) {
          flush()
          out.push(
            <strong key={`${keyBase}-b${k++}`} className="font-semibold text-surface-100">
              {renderInline(text.slice(i + 2, close), `${keyBase}-b${k}`)}
            </strong>,
          )
          i = close + 2
          continue
        }
      } else {
        const close = text.indexOf('*', i + 1)
        if (close > i + 1 && !/\s/.test(text[i + 1]) && !/\s/.test(text[close - 1])) {
          flush()
          out.push(
            <em key={`${keyBase}-i${k++}`}>
              {renderInline(text.slice(i + 1, close), `${keyBase}-i${k}`)}
            </em>,
          )
          i = close + 1
          continue
        }
      }
    }

    plain += ch
    i++
  }

  flush()
  return out
}

function blockNode(block: Block, idx: number): React.ReactNode {
  const key = `blk-${idx}`
  switch (block.type) {
    case 'heading': {
      const cls =
        block.level <= 2
          ? 'text-base font-semibold text-surface-100 mt-3 first:mt-0'
          : 'text-sm font-semibold text-surface-100 mt-3 first:mt-0'
      return block.level <= 2 ? (
        <h3 key={key} className={cls}>
          {renderInline(block.text, key)}
        </h3>
      ) : (
        <h4 key={key} className={cls}>
          {renderInline(block.text, key)}
        </h4>
      )
    }
    case 'ul':
      return (
        <ul key={key} className="list-disc pl-5 space-y-1">
          {block.items.map((item, j) => (
            <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 space-y-1">
          {block.items.map((item, j) => (
            <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
          ))}
        </ol>
      )
    case 'code':
      return (
        <pre
          key={key}
          className="bg-surface-950 border border-surface-700 rounded-lg p-3 overflow-x-auto"
        >
          <code className="text-xs font-mono text-surface-300">{block.content}</code>
        </pre>
      )
    case 'p':
    default:
      return (
        <p key={key} className="whitespace-pre-wrap">
          {renderInline(block.text, key)}
        </p>
      )
  }
}

export default function MarkdownLite({ text }: { text: string }) {
  return <div className="space-y-2">{parseBlocks(text).map(blockNode)}</div>
}

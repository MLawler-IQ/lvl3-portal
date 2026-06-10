'use server'

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { getSheetData } from '@/app/actions/projects'

function isCurrentMonth(monthStr: string): boolean {
  const d = new Date(monthStr)
  if (isNaN(d.getTime())) return false
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export async function generateClientSummary(clientId: string): Promise<void> {
  // Admin-only: triggers a paid Anthropic call and writes ai_summary.
  await requireAdmin()
  const service = await createServiceClient()

  const { data: client } = await service
    .from('clients')
    .select('name, google_sheet_id, sheet_header_row, sheet_column_map')
    .eq('id', clientId)
    .single()

  if (!client?.google_sheet_id) return

  const headerRow = (client.sheet_header_row as number | null) ?? 1
  const columnMap = (client.sheet_column_map as import('@/lib/google-sheets').ColumnMap | null) ?? null

  const sheetData = await getSheetData(client.google_sheet_id, headerRow, columnMap)
  const currentMonthRows = sheetData.rows.filter((row) => isCurrentMonth(row.month))

  if (currentMonthRows.length === 0) return

  const now = new Date()
  const monthLabel = now.toLocaleString('en-US', { month: 'long', year: 'numeric' })

  const taskLines = currentMonthRows
    .map((r) => `- [${r.category}] ${r.task} — ${r.status}`)
    .join('\n')

  const prompt = `You are writing a brief monthly update for ${client.name}, an SEO client. Below are their active tasks for ${monthLabel}:

${taskLines}

Write a 2–3 paragraph summary in plain, client-facing language explaining what is being done this month and how it will positively impact their SEO and online visibility. Be specific about the work, encouraging, and avoid jargon. Do not use bullet points or headers — write in flowing paragraphs.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const summary =
    message.content[0].type === 'text' ? message.content[0].text.trim() : null

  if (!summary) return

  await service
    .from('clients')
    .update({ ai_summary: summary, ai_summary_updated_at: new Date().toISOString() })
    .eq('id', clientId)
}

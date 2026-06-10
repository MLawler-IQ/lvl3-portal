import * as XLSX from 'xlsx'
import type { AskTool } from './types'

export const spreadsheetTools: AskTool[] = [
  {
    status: 'Generating spreadsheet…',
    definition: {
      name: 'create_spreadsheet',
      description: `Generate a downloadable .xlsx spreadsheet file for the user.
Use this when the user asks to export data, create a spreadsheet, download results, or says "give me a spreadsheet/CSV/Excel file".
You MUST have already fetched the data using other tools before calling this.
Pass the data as structured sheets with headers and rows.
Each sheet has a name (tab label), headers (column names), and rows (2D array of cell values).`,
      input_schema: {
        type: 'object' as const,
        properties: {
          filename: {
            type: 'string',
            description: 'File name without extension (e.g., "top-keywords-march")',
          },
          sheets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Sheet tab name' },
                headers: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
                rows: {
                  type: 'array',
                  items: { type: 'array', items: {} },
                  description: 'Row data — each row is an array of cell values',
                },
              },
              required: ['name', 'headers', 'rows'],
            },
            description: 'One or more sheets to include in the workbook',
          },
        },
        required: ['filename', 'sheets'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.storage) return 'Error: Missing storage context for spreadsheet generation.'
      const filename = (input.filename as string) || 'export'
      const sheets = input.sheets as Array<{ name: string; headers: string[]; rows: unknown[][] }>
      if (!sheets?.length) return 'Error: No sheets provided.'

      const wb = XLSX.utils.book_new()
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows])
        // Auto-size columns based on header lengths
        ws['!cols'] = sheet.headers.map((h) => ({ wch: Math.max(h.length + 2, 12) }))
        XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31))
      }
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

      const storagePath = `${ctx.storage.clientId}/${ctx.storage.conversationId}/${filename}-${Date.now()}.xlsx`
      const { error: uploadErr } = await ctx.storage.service.storage
        .from('chat-artifacts')
        .upload(storagePath, buffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        })
      if (uploadErr) return `Error uploading spreadsheet: ${uploadErr.message}`

      const { data: signed } = await ctx.storage.service.storage
        .from('chat-artifacts')
        .createSignedUrl(storagePath, 86400) // 24h
      const url = signed?.signedUrl ?? ''

      const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0)
      return JSON.stringify({
        artifact: true,
        path: storagePath,
        filename: `${filename}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        url,
        sheetCount: sheets.length,
        totalRows,
      })
    },
  },
]

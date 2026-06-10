import type { LucideIcon } from 'lucide-react'

export type ToolCategory =
  | 'analyze'    // client-scoped analysis
  | 'create'     // content/asset generators
  | 'audit'      // URL/page/site audits
  | 'research'   // keyword/market research (no client needed)
  | 'monitor'    // ongoing tracking, scheduled runs
  | 'operate'    // admin utilities

export type ToolInputType = 'client' | 'url' | 'keyword' | 'file' | 'none' | 'mixed'

export type ToolDataSource =
  | 'gsc' | 'ga4' | 'semrush' | 'claude' | 'gbp'
  | 'psi' | 'keywords-everywhere' | 'google-places' | 'openai'

export type ToolAccess = 'admin' | 'member' | 'client'

export type ToolStatus = 'stable' | 'beta' | 'new' | 'deprecated' | 'coming-soon'

export type ToolRuntime = 'fast' | 'medium' | 'slow' | 'background'

export interface ToolManifest {
  slug: string
  name: string
  description: string
  longDescription?: string
  icon: LucideIcon
  category: ToolCategory
  tags: string[]
  inputType: ToolInputType
  dataSources: ToolDataSource[]
  access: ToolAccess
  status: ToolStatus
  persistsRuns: boolean
  estimatedRuntime: ToolRuntime
  route: string
}

'use client'

import { Package } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import type { GA4TopProduct } from '@/app/actions/dashboard-ga4'

export interface TopProductsProps {
  products: GA4TopProduct[]
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export default function TopProducts({ products }: TopProductsProps) {
  const rows = products.slice(0, 10)

  return (
    <div className="bg-surface-900 border border-surface-700 rounded-xl p-5">
      <div className="mb-4">
        <p className="text-sm font-semibold text-surface-100">Top Products</p>
        <p className="text-xs text-surface-400 mt-0.5">By item revenue</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No product data"
          description="Top-selling products appear once GA4 ecommerce purchases are tracked for this client."
          compact
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700">
                <th className="pb-2 w-8 text-left text-xs font-medium uppercase tracking-wider text-surface-500">#</th>
                <th className="pb-2 text-left text-xs font-medium uppercase tracking-wider text-surface-500">Product</th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">Revenue</th>
                <th className="pb-2 text-right text-xs font-medium uppercase tracking-wider text-surface-500">Units</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product, i) => (
                <tr
                  key={`${product.itemName}-${i}`}
                  className="border-b border-surface-700/50 hover:bg-surface-800/30 transition-colors"
                >
                  <td className="py-2 text-surface-500 tabular-nums">{i + 1}</td>
                  <td className="py-2 text-surface-300 max-w-[14rem] truncate" title={product.itemName}>
                    {product.itemName}
                  </td>
                  <td
                    className="py-2 text-right font-medium tabular-nums"
                    style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                  >
                    {fmtCurrency(product.itemRevenue)}
                  </td>
                  <td className="py-2 text-right text-surface-400 tabular-nums">
                    {product.itemsPurchased.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * One-off local seeder for the MantelMount blog-image review batch.
 *
 * Usage (from repo root):
 *   PATH=/opt/homebrew/bin:/usr/local/bin:$PATH node --env-file=.env.local scripts/seed-mantelmount-review.ts [--force]
 *
 * Reads docs/review-handoff/review-seed.json + docs/review-handoff/images/,
 * uploads each image to the public `review-images` bucket (recompressing
 * anything over 1MB to 1600px-wide webp), and inserts the batch + items.
 *
 * Idempotent: if the batch already exists it prints the share URL and exits.
 * Pass --force to delete and re-create it (items/responses cascade).
 */

import { readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
// @ts-expect-error -- the .ts extension is required for Node's type
// stripping to resolve this import at runtime; the repo tsconfig does not
// enable allowImportingTsExtensions, so suppress TS5097 here.
import { reviewUrl } from '../lib/review/helpers.ts'

const CLIENT = 'MantelMount'
const TITLE = 'Blog Hero Image Review — July 2026'
const BUCKET = 'review-images'
const RESIZE_THRESHOLD_BYTES = 1024 * 1024 // 1MB

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = join(scriptDir, '..')
const seedPath = join(repoRoot, 'docs', 'review-handoff', 'review-seed.json')
const imagesDir = join(repoRoot, 'docs', 'review-handoff', 'images')

type SeedItem = {
  order: number
  handle: string
  title: string
  copy: string
  image: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://portal.igniteiq.com').replace(/\/+$/, '')
}

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1024)}KB`
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Run with: node --env-file=.env.local scripts/seed-mantelmount-review.ts'
    )
    process.exit(1)
  }

  const service = createClient(url, serviceKey, { auth: { persistSession: false } })

  const seedItems: SeedItem[] = JSON.parse(readFileSync(seedPath, 'utf-8'))
  console.log(`Loaded ${seedItems.length} seed items from ${seedPath}`)

  // Idempotency: bail (or delete with --force) if the batch already exists.
  const { data: existing, error: existingError } = await service
    .from('review_batches')
    .select('id, token')
    .eq('client', CLIENT)
    .eq('title', TITLE)
    .limit(1)
    .maybeSingle()
  if (existingError) throw new Error(`Lookup failed: ${existingError.message}`)

  if (existing) {
    if (!force) {
      console.log('Batch already exists — nothing to do. Pass --force to re-create.')
      console.log(`Share URL: ${reviewUrl(existing.token as string)}`)
      console.log(`Admin URL: ${siteBase()}/reviews/${existing.id}`)
      process.exit(0)
    }
    console.log(`--force: deleting existing batch ${existing.id} (items/responses cascade)…`)
    const { error: deleteError } = await service
      .from('review_batches')
      .delete()
      .eq('id', existing.id)
    if (deleteError) throw new Error(`Delete failed: ${deleteError.message}`)
  }

  const { data: batch, error: batchError } = await service
    .from('review_batches')
    .insert({ client: CLIENT, title: TITLE, status: 'open' })
    .select('id, token')
    .single()
  if (batchError) throw new Error(`Batch insert failed: ${batchError.message}`)

  const batchId = batch.id as string
  const token = batch.token as string
  console.log(`Created batch ${batchId}`)

  const itemRows: Array<{
    batch_id: string
    sort_order: number
    title: string
    copy: string
    image_url: string
    shopify_handle: string
  }> = []
  const sizeSummary: string[] = []

  const ordered = [...seedItems].sort((a, b) => a.order - b.order)
  for (let i = 0; i < ordered.length; i++) {
    const item = ordered[i]
    const imagePath = join(imagesDir, item.image)
    const originalBytes = statSync(imagePath).size
    console.log(`${i + 1}/${ordered.length} uploading ${item.image} (${formatKb(originalBytes)})…`)

    const originalBuf = readFileSync(imagePath)
    let uploadBuf: Buffer = originalBuf
    let uploadPath: string
    let contentType: string

    if (originalBytes > RESIZE_THRESHOLD_BYTES) {
      uploadBuf = await sharp(originalBuf)
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer()
      uploadPath = `${batchId}/${item.handle}.webp`
      contentType = 'image/webp'
    } else {
      const ext = extname(item.image).toLowerCase()
      uploadPath = `${batchId}/${item.handle}${ext}`
      contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    }

    const { error: uploadError } = await service.storage
      .from(BUCKET)
      .upload(uploadPath, uploadBuf, { contentType, upsert: true })
    if (uploadError) throw new Error(`Upload failed for ${item.image}: ${uploadError.message}`)

    const { data: publicUrlData } = service.storage.from(BUCKET).getPublicUrl(uploadPath)

    itemRows.push({
      batch_id: batchId,
      sort_order: item.order,
      title: item.title,
      copy: item.copy,
      image_url: publicUrlData.publicUrl,
      shopify_handle: item.handle,
    })
    sizeSummary.push(
      `  ${item.handle}: ${formatKb(originalBytes)} → ${formatKb(uploadBuf.length)}${
        uploadBuf === originalBuf ? ' (original)' : ' (resized webp)'
      }`
    )
  }

  const { error: itemsError } = await service.from('review_items').insert(itemRows)
  if (itemsError) throw new Error(`Items insert failed: ${itemsError.message}`)
  console.log(`Inserted ${itemRows.length} review items.`)

  console.log('\nDone.')
  console.log(`Share URL: ${reviewUrl(token)}`)
  console.log(`Admin URL: ${siteBase()}/reviews/${batchId}`)
  console.log(`Token:     ${token}`)
  console.log('\nImage sizes:')
  console.log(sizeSummary.join('\n'))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

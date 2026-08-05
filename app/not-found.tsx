import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="eyebrow mb-3">404</p>
      <h1 className="text-2xl font-medium text-surface-100 mb-2">Page not found</h1>
      <p className="text-sm text-surface-400 max-w-md mb-6">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/"
        className="rounded-lg bg-brand-400 px-4 py-2 text-sm font-medium text-surface-950 hover:bg-brand-300"
      >
        Go home
      </Link>
    </div>
  )
}

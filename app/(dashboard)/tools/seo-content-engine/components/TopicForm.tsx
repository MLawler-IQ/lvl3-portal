'use client'

import { useState } from 'react'
import type { TopicInput } from '@/lib/seo-content-engine/types'

interface TopicFormProps {
  topics: TopicInput[]
  onTopicsChange: (topics: TopicInput[]) => void
  disabled?: boolean
}

export default function TopicForm({ topics, onTopicsChange, disabled }: TopicFormProps) {
  const [title, setTitle] = useState('')
  const [targetAudience, setTargetAudience] = useState('')
  const [angle, setAngle] = useState('')
  const [existingUrl, setExistingUrl] = useState('')

  function handleAdd() {
    if (!title.trim()) return

    const newTopic: TopicInput = {
      title: title.trim(),
      target_audience: targetAudience.trim() || undefined,
      angle: angle.trim() || undefined,
      existing_url: existingUrl.trim() || undefined,
      seed_keywords: [],
    }

    onTopicsChange([...topics, newTopic])
    setTitle('')
    setTargetAudience('')
    setAngle('')
    setExistingUrl('')
  }

  function handleRemove(index: number) {
    onTopicsChange(topics.filter((_, i) => i !== index))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  const inputClass =
    'w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-100 placeholder:text-surface-400 focus:outline-none focus:border-brand-500'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-surface-400 mb-1">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. How to Unclog a Drain Without Chemicals"
            className={inputClass}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1">
            Target Audience
          </label>
          <input
            type="text"
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Homeowners in Phoenix"
            className={inputClass}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-surface-400 mb-1">
            Angle
          </label>
          <input
            type="text"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. DIY guide with cost comparison"
            className={inputClass}
            disabled={disabled}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-surface-400 mb-1">
            Existing URL
          </label>
          <input
            type="text"
            value={existingUrl}
            onChange={(e) => setExistingUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. https://example.com/blog/drain-tips"
            className={inputClass}
            disabled={disabled}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={disabled || !title.trim()}
        className="bg-brand-400 hover:bg-brand-300 text-surface-950 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Add Topic
      </button>

      {topics.length > 0 && (
        <div className="space-y-2 pt-2">
          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider">
            {topics.length} topic{topics.length !== 1 ? 's' : ''} added
          </p>
          {topics.map((topic, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 bg-surface-900 border border-surface-700 rounded-xl px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-surface-100 truncate">
                  {topic.title}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {topic.target_audience && (
                    <span className="text-xs text-surface-400">
                      {topic.target_audience}
                    </span>
                  )}
                  {topic.angle && (
                    <span className="text-xs text-surface-400 italic">
                      {topic.angle}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                disabled={disabled}
                className="shrink-0 text-surface-400 hover:text-red-400 transition-colors disabled:opacity-50"
                aria-label={`Remove ${topic.title}`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

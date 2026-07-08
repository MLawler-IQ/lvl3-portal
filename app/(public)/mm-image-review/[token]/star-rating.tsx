'use client'

import { useState } from 'react'

type Props = {
  value: number
  disabled: boolean
  onChange: (value: number) => void
}

export function StarRating({ value, disabled, onChange }: Props) {
  const [hoverValue, setHoverValue] = useState(0)
  const displayed = hoverValue || value

  return (
    <div className="stars" onMouseLeave={() => setHoverValue(0)}>
      {Array.from({ length: 10 }, (_, idx) => {
        const star = idx + 1
        return (
          <button
            key={star}
            type="button"
            className={`star${star <= displayed ? ' on' : ''}`}
            aria-label={`Rate ${star} of 10`}
            disabled={disabled}
            onClick={() => onChange(star === value ? 0 : star)}
            onMouseEnter={() => setHoverValue(star)}
          >
            ★
          </button>
        )
      })}
      <span className="rateval">{`${value || '–'} / 10`}</span>
    </div>
  )
}

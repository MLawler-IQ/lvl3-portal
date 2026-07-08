'use client'

import { DECISION_LABEL } from '@/lib/review/summary'
import type { ItemState, ReviewDecision, ReviewItem } from '@/lib/review/types'
import { StarRating } from './star-rating'

type Props = {
  item: ReviewItem
  index: number
  total: number
  state: ItemState
  locked: boolean
  flagged: boolean
  saveError: boolean
  onChange: (next: ItemState) => void
  cardRef: (el: HTMLDivElement | null) => void
  noteRef: (el: HTMLTextAreaElement | null) => void
}

export function ReviewCard({
  item,
  index,
  total,
  state,
  locked,
  flagged,
  saveError,
  onChange,
  cardRef,
  noteRef,
}: Props) {
  const reqMiss = flagged || (state.decision === 'deny' && state.note.trim() === '')
  const pillText = state.decision ? DECISION_LABEL[state.decision] : 'Pending'

  function toggleDecision(decision: ReviewDecision) {
    onChange({ ...state, decision: state.decision === decision ? null : decision })
  }

  return (
    <div className="card" data-status={state.decision ?? ''} ref={cardRef}>
      <div className="top">
        <div className="imgwrap">
          <span className="pill">{pillText}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.image_url} alt={item.title} loading="lazy" />
        </div>
        <div className="body">
          <div className="idx">
            <span>
              Post {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
            </span>
            {saveError && <span className="saveerr">Save failed — retrying</span>}
          </div>
          <h2>{item.title}</h2>
          {item.copy && <p className="copy">{item.copy}</p>}
          {item.copy_url && (
            <a className="copylink" href={item.copy_url} target="_blank" rel="noopener noreferrer">
              View full copy →
            </a>
          )}
          <div className="ratelabel">Rating</div>
          <StarRating
            value={state.rating}
            disabled={locked}
            onChange={(rating) => onChange({ ...state, rating })}
          />
        </div>
      </div>
      <div className="controls">
        <div className="btns">
          <button
            type="button"
            className={`btn approve${state.decision === 'approve' ? ' sel' : ''}`}
            onClick={() => toggleDecision('approve')}
            disabled={locked}
          >
            Approve
          </button>
          <button
            type="button"
            className={`btn deny${state.decision === 'deny' ? ' sel' : ''}`}
            onClick={() => toggleDecision('deny')}
            disabled={locked}
          >
            Deny
          </button>
        </div>
        <div className={`notewrap${reqMiss ? ' reqmiss' : ''}`}>
          <label className="notelabel" htmlFor={`note-${item.id}`}>
            Notes / feedback
            {state.decision === 'deny' && (
              <>
                {' '}
                <span className="req">(required)</span>
              </>
            )}
          </label>
          <textarea
            id={`note-${item.id}`}
            ref={noteRef}
            placeholder="What works, what doesn't, what to change…"
            value={state.note}
            onChange={(e) => onChange({ ...state, note: e.target.value })}
            disabled={locked}
          />
        </div>
      </div>
    </div>
  )
}

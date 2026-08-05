'use client'

// Holds the completeness state shared between the two panes: the interview emits
// it, the review pane renders it. Server-side it starts from the persisted
// answers, so a reload shows the real coverage rather than zero.

import { useState } from 'react'
import type { Completeness } from '@/lib/onboarding/completeness'
import type { Answers } from '@/lib/onboarding/schema'
import OnboardingChat, { type ChatTurn } from './OnboardingChat'
import OnboardingReview, { type SlotMeta } from './OnboardingReview'

interface Props {
  sessionId: string
  clientId: string
  clientName: string
  slots: SlotMeta[]
  answers: Answers
  completeness: Completeness
  messages: ChatTurn[]
}

export default function OnboardingWorkspace({
  sessionId,
  clientId,
  clientName,
  slots,
  answers: initialAnswers,
  completeness: initialCompleteness,
  messages,
}: Props) {
  const [completeness, setCompleteness] = useState<Completeness>(initialCompleteness)
  const [answers, setAnswers] = useState<Answers>(initialAnswers)
  // Remounting the review pane is how its inputs pick up newly recorded answers.
  // Cheaper and less error-prone than reconciling controlled-input state against
  // an incoming patch.
  const [answersVersion, setAnswersVersion] = useState(0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-[calc(100vh-13rem)]">
      <div className="rounded-sm border border-surface-800 bg-surface-900 overflow-hidden flex flex-col min-h-0">
        <OnboardingChat
          sessionId={sessionId}
          clientName={clientName}
          initialMessages={messages}
          onRecorded={(c, a) => {
            setCompleteness(c)
            if (a) setAnswers(a)
            setAnswersVersion((v) => v + 1)
          }}
        />
      </div>

      <div className="rounded-sm border border-surface-800 bg-surface-900 overflow-hidden flex flex-col min-h-0">
        <OnboardingReview
          key={answersVersion}
          sessionId={sessionId}
          clientId={clientId}
          slots={slots}
          answers={answers}
          completeness={completeness}
        />
      </div>
    </div>
  )
}

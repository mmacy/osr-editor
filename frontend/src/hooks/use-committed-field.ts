import { useState, type ChangeEvent, type KeyboardEvent } from 'react'

// The commit gesture: controlled inputs commit on blur or Enter, one batch per
// committed field, change-detected so a focus-and-leave never posts a no-op
// batch. Textareas spread everything but onKeyDown — Enter types newlines
// there, and blur alone commits. An optional normalizer vets the draft on
// blur: returning null reverts the field to the committed value instead of
// leaving an uncommittable draft on screen.
export function useCommittedField(
  committed: string,
  onCommit: (value: string) => void,
  normalize?: (draft: string) => string | null,
) {
  const [draft, setDraft] = useState(committed)
  // Resync the draft when the committed value changes underneath (a delta from
  // another tab, an undo) — the render-time adjustment pattern, not an effect.
  const [lastCommitted, setLastCommitted] = useState(committed)
  if (committed !== lastCommitted) {
    setLastCommitted(committed)
    setDraft(committed)
  }
  return {
    value: draft,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(event.target.value),
    onBlur: () => {
      const value = normalize ? normalize(draft) : draft
      if (value === null || value === committed) {
        setDraft(committed)
        return
      }
      onCommit(value)
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter') event.currentTarget.blur()
    },
  }
}

export function integerInRange(min: number, max?: number): (draft: string) => string | null {
  return (draft) => {
    const parsed = Number(draft)
    if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
      return null
    }
    return String(parsed)
  }
}

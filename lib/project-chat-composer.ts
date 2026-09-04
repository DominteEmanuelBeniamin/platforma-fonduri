export type ProjectChatComposerSuccessInput = {
  attemptId: string
  activeAttemptId: string | null
  sentText: string
  currentText: string
  sentAttachmentIds: readonly string[]
  currentAttachmentIds: readonly string[]
}

export type ProjectChatComposerSuccess = {
  text: string
  attachmentIds: string[]
}

/**
 * Reconciles the composer with a successful request without overwriting edits
 * made while that request was in flight.
 *
 * An exact match means the submitted draft can be cleared. If the user only
 * appended text after the POST started, that suffix becomes the next draft.
 * Any other edit is ambiguous, so preserving the complete current value is the
 * only lossless choice. A stale attempt is never allowed to change the UI.
 */
export function reconcileProjectChatComposerSuccess({
  attemptId,
  activeAttemptId,
  sentText,
  currentText,
  sentAttachmentIds,
  currentAttachmentIds,
}: ProjectChatComposerSuccessInput): ProjectChatComposerSuccess | null {
  if (attemptId !== activeAttemptId) return null

  const sentIds = new Set(sentAttachmentIds)
  const text = currentText === sentText
    ? ''
    : currentText.startsWith(sentText)
      ? currentText.slice(sentText.length)
      : currentText

  return {
    text,
    attachmentIds: currentAttachmentIds.filter(id => !sentIds.has(id)),
  }
}

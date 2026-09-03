export type ProjectChatInsertResult<Row> = {
  data: Row | null | undefined
  error: unknown
}

export type ProjectChatInsertOutcome<Row> =
  | { ok: true; data: Row }
  | { ok: false; kind: 'result'; error: unknown }
  | { ok: false; kind: 'transport'; error: unknown }

/**
 * Runs the database part of message creation and guarantees one cleanup attempt
 * whenever the insert cannot be confirmed. The cleanup callback is deliberately
 * injected: the route supplies its reference-aware, best-effort implementation.
 */
export async function insertProjectChatMessageWithCleanup<Row>(
  insert: () => PromiseLike<ProjectChatInsertResult<Row>>,
  cleanup: () => Promise<void>,
): Promise<ProjectChatInsertOutcome<Row>> {
  let result: ProjectChatInsertResult<Row>
  try {
    result = await insert()
  } catch (error) {
    await cleanup()
    return { ok: false, kind: 'transport', error }
  }

  if (result.error || !result.data) {
    await cleanup()
    return { ok: false, kind: 'result', error: result.error }
  }

  return { ok: true, data: result.data }
}

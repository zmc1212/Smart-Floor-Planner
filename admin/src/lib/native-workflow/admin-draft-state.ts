/**
 * Pure editor state for the B3 draft page. It binds the editor text to the
 * revision the text was based on, so a 409 never silently rebases old text onto
 * the remote latest revision.
 */
export interface DraftEditorState {
  readonly text: string;
  /** Revision the current text is based on; changes only on load, save success or explicit rebase. */
  readonly baseRevision: number;
  /** Last known server draft revision, for display and conflict messaging. */
  readonly serverRevision: number;
  /** Set when a save conflicts; non-null blocks normal saves until resolved. */
  readonly conflictRevision: number | null;
}

export function createDraftEditorState(text: string, serverRevision: number): DraftEditorState {
  return { text, baseRevision: serverRevision, serverRevision, conflictRevision: null };
}

export function updateDraftText(state: DraftEditorState, text: string): DraftEditorState {
  return { ...state, text };
}

export function applySaveSuccess(
  state: DraftEditorState,
  submittedText: string,
  savedText: string,
  savedRevision: number,
): DraftEditorState {
  return {
    text: state.text === submittedText ? savedText : state.text,
    baseRevision: savedRevision,
    serverRevision: savedRevision,
    conflictRevision: null,
  };
}

export function applySaveConflict(state: DraftEditorState, remoteRevision: number): DraftEditorState {
  return {
    ...state,
    serverRevision: remoteRevision,
    conflictRevision: remoteRevision,
  };
}

/** Explicit user action: discard local text and continue from the remote draft. */
export function acceptRemoteDraft(state: DraftEditorState, remoteText: string, remoteRevision: number): DraftEditorState {
  return createDraftEditorState(remoteText, remoteRevision);
}

/**
 * Explicit user action: keep local text but declare it based on the remote
 * revision. The user is choosing to overwrite the remote draft on next save.
 */
export function keepLocalAndRebase(state: DraftEditorState, remoteRevision: number): DraftEditorState {
  return {
    ...state,
    baseRevision: remoteRevision,
    serverRevision: remoteRevision,
    conflictRevision: null,
  };
}

export function isDraftDirty(state: DraftEditorState, serverText: string): boolean {
  return state.text !== serverText;
}

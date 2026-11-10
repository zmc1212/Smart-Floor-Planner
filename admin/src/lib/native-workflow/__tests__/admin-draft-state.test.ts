import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptRemoteDraft,
  applySaveConflict,
  applySaveSuccess,
  createDraftEditorState,
  isDraftDirty,
  keepLocalAndRebase,
  updateDraftText,
} from '../admin-draft-state';

test('a 409 keeps local text and the original editing base', () => {
  let editor = createDraftEditorState('server-r1', 1);
  editor = updateDraftText(editor, 'page-b-edit');
  editor = applySaveConflict(editor, 2);

  assert.equal(editor.text, 'page-b-edit');
  assert.equal(editor.baseRevision, 1);
  assert.equal(editor.serverRevision, 2);
  assert.equal(editor.conflictRevision, 2);
  assert.equal(isDraftDirty(editor, 'server-r2'), true);
});

test('a save response does not overwrite text typed while the request was running', () => {
  let editor = createDraftEditorState('server-r1', 1);
  const submittedText = 'submitted-text';
  editor = updateDraftText(editor, submittedText);
  editor = updateDraftText(editor, 'submitted-text plus typing during request');
  editor = applySaveSuccess(editor, submittedText, 'submitted-text normalized', 2);

  assert.equal(editor.text, 'submitted-text plus typing during request');
  assert.equal(editor.baseRevision, 2);
  assert.equal(editor.serverRevision, 2);
  assert.equal(editor.conflictRevision, null);
});

test('an unchanged editor adopts the saved text and revision', () => {
  let editor = createDraftEditorState('server-r1', 1);
  const submittedText = 'submitted-text';
  editor = updateDraftText(editor, submittedText);
  editor = applySaveSuccess(editor, submittedText, 'submitted-text normalized', 2);

  assert.equal(editor.text, 'submitted-text normalized');
  assert.equal(editor.baseRevision, 2);
});

test('conflict resolution only rebases on an explicit user action', () => {
  const conflicted = applySaveConflict(updateDraftText(createDraftEditorState('r1', 1), 'local'), 3);

  const accepted = acceptRemoteDraft(conflicted, 'remote-r3', 3);
  assert.equal(accepted.text, 'remote-r3');
  assert.equal(accepted.baseRevision, 3);
  assert.equal(accepted.conflictRevision, null);

  const kept = keepLocalAndRebase(conflicted, 3);
  assert.equal(kept.text, 'local');
  assert.equal(kept.baseRevision, 3);
  assert.equal(kept.serverRevision, 3);
  assert.equal(kept.conflictRevision, null);
});

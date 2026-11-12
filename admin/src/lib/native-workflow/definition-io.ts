import { canonicalJson } from './canonical';
import { WorkflowDefinitionError, workflowIssue } from './errors';
import { WORKFLOW_BOUNDS, type WorkflowDefinition } from './types';
import { validateDefinition } from './validate';

/**
 * Import/export boundary for workflow JSON. Imported definitions are scanned
 * for transport, SQL, code, secret and file-path content before validation.
 */
export function parseDefinitionJson(text: string): WorkflowDefinition {
  if (typeof text !== 'string') {
    throw new WorkflowDefinitionError([workflowIssue('invalid_json', '$', 'definition JSON must be a string')]);
  }
  if (new TextEncoder().encode(text).length > WORKFLOW_BOUNDS.maxImportTextBytes) {
    throw new WorkflowDefinitionError([workflowIssue('definition_too_large', '$', 'import text exceeds the size bound')]);
  }
  if (text.trim() === '') {
    throw new WorkflowDefinitionError([workflowIssue('invalid_json', '$', 'definition JSON must be a non-empty string')]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WorkflowDefinitionError([workflowIssue('invalid_json', '$', 'definition is not valid JSON')]);
  }
  const result = validateDefinition(parsed);
  if (!result.ok) throw new WorkflowDefinitionError([...result.issues]);
  return result.definition;
}

/**
 * Canonical (minified) export. `validateDefinition` enforces the same canonical
 * byte bound on import, so a successful export always re-imports.
 */
export function exportDefinitionJson(definition: WorkflowDefinition): string {
  const result = validateDefinition(definition);
  if (!result.ok) throw new WorkflowDefinitionError([...result.issues]);
  return `${canonicalJson(result.definition)}\n`;
}

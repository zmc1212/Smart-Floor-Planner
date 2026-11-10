import { canonicalJson } from './canonical';
import { WorkflowDefinitionError, workflowIssue } from './errors';
import { WORKFLOW_BOUNDS, type WorkflowDefinition } from './types';
import { validateDefinition } from './validate';

/**
 * Import/export boundary for workflow JSON. Imported definitions are scanned
 * for transport, SQL, code, secret and file-path content before validation.
 */
export function parseDefinitionJson(text: string): WorkflowDefinition {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new WorkflowDefinitionError([workflowIssue('invalid_json', '$', 'definition JSON must be a non-empty string')]);
  }
  if (Buffer.byteLength(text, 'utf8') > WORKFLOW_BOUNDS.maxDefinitionBytes) {
    throw new WorkflowDefinitionError([workflowIssue('definition_too_large', '$', 'definition exceeds the size bound')]);
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

export function exportDefinitionJson(definition: WorkflowDefinition): string {
  const result = validateDefinition(definition);
  if (!result.ok) throw new WorkflowDefinitionError([...result.issues]);
  return `${JSON.stringify(JSON.parse(canonicalJson(result.definition)), null, 2)}\n`;
}

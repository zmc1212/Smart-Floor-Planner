import type { CompiledNode } from './compile';
import { workflowIssue, type WorkflowIssue } from './errors';
import { isPlainObject, ownValue } from './guards';
import type { RunMode, WorkflowValue } from './types';

/**
 * Unified save/delivery result semantics for both simulation and live runs.
 * A false confirmation or an invalid receipt can never complete a run.
 */
export function validateEffectReceipt(
  node: CompiledNode,
  outputs: Readonly<Record<string, WorkflowValue>>,
  mode: RunMode,
): WorkflowIssue | null {
  if (node.effect !== 'save' && node.effect !== 'deliver') return null;
  const isSave = node.effect === 'save';
  const confirmedPort = isSave ? 'saved' : 'delivered';
  const receiptPort = isSave ? 'saveReceipt' : 'deliveryReceipt';
  const path = `nodes.${node.nodeId}`;
  if (ownValue(outputs, confirmedPort) !== true) {
    return workflowIssue(
      isSave ? 'save_not_confirmed' : 'delivery_not_confirmed',
      `${path}.${confirmedPort}`,
      'effect result was not confirmed',
    );
  }
  const receipt = ownValue(outputs, receiptPort);
  if (!isPlainObject(receipt)) {
    return workflowIssue('invalid_receipt', `${path}.${receiptPort}`, 'receipt must be an object');
  }
  const receiptId = ownValue(receipt, 'receiptId');
  if (typeof receiptId !== 'string' || receiptId === '') {
    return workflowIssue('invalid_receipt', `${path}.${receiptPort}.receiptId`, 'receipt needs a non-empty id');
  }
  if (mode === 'simulation' && ownValue(receipt, 'simulated') !== true) {
    return workflowIssue(
      'receipt_not_simulated',
      `${path}.${receiptPort}.simulated`,
      'simulation receipts must be marked simulated',
    );
  }
  return null;
}

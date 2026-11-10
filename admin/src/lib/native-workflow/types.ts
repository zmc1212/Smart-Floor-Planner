/**
 * Native workflow core types (B0-B2).
 *
 * This module is a pure definition/state contract. It must not import models,
 * repositories, workers, business services or any runtime adapter. Real
 * capabilities are connected later through thin adapters (B4).
 */
import type { WorkflowIssue } from './errors';

export const WORKFLOW_SCHEMA_VERSION = 1;

export const WORKFLOW_BOUNDS = {
  maxNodes: 32,
  maxEdges: 64,
  maxInputsPerNode: 16,
  /** Canonical JSON size of a validated definition, shared by import/export. */
  maxDefinitionBytes: 64 * 1024,
  /** Raw import text cap; leaves room for whitespace around valid canonical JSON. */
  maxImportTextBytes: 512 * 1024,
  /** Import safety scan limits: prevent stack overflow and traversal abuse. */
  maxScanDepth: 32,
  maxScanNodes: 10_000,
  maxExecutionSteps: 64,
  maxConfigStringLength: 500,
} as const;

export type NodeType =
  | 'trigger'
  | 'read_materials'
  | 'condition'
  | 'compose_content'
  | 'save_result'
  | 'deliver_inapp';

export type ValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string_list'
  | 'object_list'
  | 'object';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | Readonly<{ [key: string]: JsonValue }>;

export interface WorkflowInputRef {
  readonly nodeId: string;
  readonly outputPath: string;
}

export interface WorkflowNode {
  readonly nodeId: string;
  readonly type: NodeType;
  readonly typeVersion: number;
  readonly capabilityRef: string;
  readonly config?: Readonly<Record<string, JsonValue>>;
  readonly inputs?: Readonly<Record<string, WorkflowInputRef>>;
}

export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
  readonly when?: 'true' | 'false';
}

export interface WorkflowInputSchema {
  readonly eventType: 'stage_changed' | 'period_report';
  readonly periodKind?: 'daily' | 'weekly';
}

export interface WorkflowDefinition {
  readonly schemaVersion: number;
  readonly definitionId: string;
  readonly revision: number;
  readonly entryNodeId: string;
  readonly inputSchema: WorkflowInputSchema;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
}

/** Values that can be stored per node output port. */
export type WorkflowValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly Readonly<Record<string, unknown>>[]
  | Readonly<Record<string, unknown>>;

/**
 * The only event shapes the simulator accepts. Time, event IDs and results are
 * supplied by the caller; the core never reads a clock or generates IDs.
 */
export interface TriggerEvent {
  readonly eventId: string;
  readonly eventType: 'stage_changed' | 'period_report';
  readonly occurredAt: string;
  readonly stageKey?: string;
  readonly stageLabel?: string;
  readonly periodKind?: 'daily' | 'weekly';
  readonly periodStart?: string;
  readonly periodEnd?: string;
}

export type RunMode = 'simulation' | 'live';
export type RunStatus = 'running' | 'waiting' | 'completed' | 'halted' | 'failed';

export interface WorkflowRunState {
  runId: string;
  definitionId: string;
  revision: number;
  digest: string;
  mode: RunMode;
  status: RunStatus;
  currentNodeId: string | null;
  pendingNodeId: string | null;
  visitedNodeIds: string[];
  outputs: Record<string, Record<string, WorkflowValue>>;
  processedEventIds: string[];
  error: WorkflowIssue | null;
  outcome: string | null;
  stepCount: number;
  traceSeq: number;
}

export type TraceKind =
  | 'run_started'
  | 'event_duplicate_ignored'
  | 'node_started'
  | 'node_pending'
  | 'node_succeeded'
  | 'node_failed'
  | 'branch_selected'
  | 'run_completed'
  | 'run_halted';

export interface WorkflowTraceEntry {
  readonly seq: number;
  readonly at: string;
  readonly kind: TraceKind;
  readonly nodeId: string | null;
  readonly nodeType: NodeType | null;
  readonly mode: RunMode;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * A description of work the host still has to perform. `advance` only returns
 * these descriptions; it never performs reads, model calls, saves or delivery.
 */
export interface PendingOperation {
  readonly nodeId: string;
  readonly nodeType: NodeType;
  readonly capabilityRef: string;
  readonly nodeVersion: string;
  readonly effect: 'read' | 'compose' | 'save' | 'deliver';
  readonly input: Readonly<Record<string, WorkflowValue>>;
  readonly mode: RunMode;
  readonly simulation: boolean;
  readonly idempotencyKey: string;
}

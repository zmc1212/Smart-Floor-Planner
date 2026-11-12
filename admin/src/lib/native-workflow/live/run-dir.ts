import path from 'node:path';

/** The B-owned live run store root. Server reads and the CLI share it. */
export function resolveNativeWorkflowRunDir(): string {
  return process.env.NATIVE_WORKFLOW_RUN_DIR?.trim()
    || path.resolve(process.cwd(), 'tmp/native-workflow-runs');
}

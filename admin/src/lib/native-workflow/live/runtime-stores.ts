import { WorkflowOperationError } from '../errors';
import { createFilePeriodReportBatchStore, resolveNativeWorkflowBatchDir } from './period-report-batch-store';
import { createFilePeriodReportScheduleStore, resolveNativeWorkflowScheduleDir } from './period-report-schedule-store';
import { createFileWorkflowRunStore } from './run-store';
import { resolveNativeWorkflowRunDir } from './run-dir';
import {
  createPostgresPeriodReportBatchStore, createPostgresPeriodReportScheduleStore, createPostgresWorkflowRunStore,
} from './runtime-postgres-stores';

export function nativeStoreBackend(value: string | undefined): 'file' | 'postgres' {
  const configured = value?.trim();
  if (!configured || configured === 'file') return 'file';
  if (configured === 'postgres') return 'postgres';
  throw new WorkflowOperationError('runtime_store_configuration_invalid', 503, 'unsupported Native Workflow store backend');
}

export function createNativeRuntimeStores(enterpriseId: string, env = process.env) {
  if (nativeStoreBackend(env.NATIVE_WORKFLOW_RUNTIME_STORE) === 'postgres') {
    return {
      runStore: createPostgresWorkflowRunStore(enterpriseId),
      batchStore: createPostgresPeriodReportBatchStore(enterpriseId),
      store: createPostgresPeriodReportScheduleStore(enterpriseId),
    };
  }
  return {
    runStore: createFileWorkflowRunStore({ rootDir: resolveNativeWorkflowRunDir() }),
    batchStore: createFilePeriodReportBatchStore({ rootDir: resolveNativeWorkflowBatchDir() }),
    store: createFilePeriodReportScheduleStore({ rootDir: resolveNativeWorkflowScheduleDir() }),
  };
}

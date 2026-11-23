import { createWorkflowService, type WorkflowService } from './service';
import { createFileWorkflowStore, resolveNativeWorkflowStoreDir } from './store/file-store';

let cached: { rootDir: string; service: WorkflowService } | undefined;

export function getNativeWorkflowService(): WorkflowService {
  const rootDir = resolveNativeWorkflowStoreDir();
  if (!cached || cached.rootDir !== rootDir) {
    cached = { rootDir, service: createWorkflowService({ store: createFileWorkflowStore({ rootDir }) }) };
  }
  return cached.service;
}

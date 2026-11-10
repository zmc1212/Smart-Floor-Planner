export interface WorkflowIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export function workflowIssue(code: string, path: string, message: string): WorkflowIssue {
  return { code, path, message };
}

/** Raised when a definition fails structural, reference or safety checks. */
export class WorkflowDefinitionError extends Error {
  readonly issues: WorkflowIssue[];

  constructor(issues: WorkflowIssue[]) {
    const first = issues[0];
    super(first ? `workflow definition invalid: ${first.path} ${first.code}` : 'workflow definition invalid');
    this.name = 'WorkflowDefinitionError';
    this.issues = issues;
  }
}

/** Raised for misuse of the pure runtime (terminal run, bad observation...). */
export class WorkflowRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = 'WorkflowRuntimeError';
    this.code = code;
  }
}

/** Raised by the B3 store/service layer; status maps to HTTP for the API. */
export class WorkflowOperationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'WorkflowOperationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

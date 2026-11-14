import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorized } from '@/lib/assistant/infrastructure/worker-auth';
import { runAssistantJobsTick, type AssistantJobsTickDependencies } from '@/lib/assistant/infrastructure/jobs-tick';

/** Only the clock, environment and non-pilot Assistant jobs may be injected.
 * The four reminder/report workers always keep their production
 * implementations, and none of these values can be supplied by an HTTP
 * request. */
export type AssistantJobsPostDependencies = {
  now?: Date;
  env?: Record<string, string | undefined>;
  advanceKnowledgeBatches?: AssistantJobsTickDependencies['advanceKnowledgeBatches'];
  processAssistantJob?: AssistantJobsTickDependencies['processAssistantJob'];
  processAssistantRun?: AssistantJobsTickDependencies['processAssistantRun'];
  deliverSiteNotifications?: AssistantJobsTickDependencies['deliverSiteNotifications'];
  deliverPublicConsents?: AssistantJobsTickDependencies['deliverPublicConsents'];
  processPortfolioCopy?: AssistantJobsTickDependencies['processPortfolioCopy'];
  runNativeWorkflowScheduleTick?: AssistantJobsTickDependencies['runNativeWorkflowScheduleTick'];
  runNativeDelegationTick?: AssistantJobsTickDependencies['runNativeDelegationTick'];
  runNativeDurableToolTick?: AssistantJobsTickDependencies['runNativeDurableToolTick'];
};

/** A complete Worker POST handler with authentication and response semantics.
 * Production uses `assistantJobsPost` unchanged; tests create a handler with a
 * fixed clock and deterministic non-pilot jobs. */
export function createAssistantJobsPost(dependencies: AssistantJobsPostDependencies = {}) {
  return async function post(request: Request) {
    const requestId = randomUUID();
    if (!authorized(request)) return NextResponse.json({ success: false, code: 'unauthorized', requestId }, { status: 401 });
    try {
      if ((await request.text()).trim() && (request.headers.get('content-length') !== '0')) {
        return NextResponse.json({ success: false, code: 'invalid_message', requestId }, { status: 422 });
      }
      const data = await runAssistantJobsTick({
        now: dependencies.now,
        env: dependencies.env,
        advanceKnowledgeBatches: dependencies.advanceKnowledgeBatches,
        processAssistantJob: dependencies.processAssistantJob,
        processAssistantRun: dependencies.processAssistantRun,
        deliverSiteNotifications: dependencies.deliverSiteNotifications,
        deliverPublicConsents: dependencies.deliverPublicConsents,
        processPortfolioCopy: dependencies.processPortfolioCopy,
        runNativeWorkflowScheduleTick: dependencies.runNativeWorkflowScheduleTick,
        runNativeDelegationTick: dependencies.runNativeDelegationTick,
        runNativeDurableToolTick: dependencies.runNativeDurableToolTick,
      });
      return NextResponse.json({ success: true, data, requestId });
    } catch {
      return NextResponse.json({ success: false, code: 'assistant_unavailable', requestId }, { status: 503 });
    }
  };
}

export const assistantJobsPost = createAssistantJobsPost();

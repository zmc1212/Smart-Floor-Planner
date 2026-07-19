import { loadEnvConfig } from '@next/env';
import dbConnect from '../src/lib/mongodb';
import { FloorPlan } from '../src/models/FloorPlan';
import Lead from '../src/models/Lead';
import { Measurement } from '../src/models/Measurement';
import { isFormalSurveyLayout } from '../src/lib/survey-graph';

const execute = process.argv.includes('--execute');

loadEnvConfig(process.cwd());

function promotePrototype(layoutData: unknown) {
  if (!layoutData || typeof layoutData !== 'object' || Array.isArray(layoutData)) return null;
  const parsed = layoutData as { measurementMode?: unknown; surveyDraft?: { kind?: unknown }; surveyGraph?: unknown };
  const graph = parsed.surveyDraft || parsed.surveyGraph;
  if (graph && typeof graph === 'object' && (graph as { kind?: unknown }).kind === 'survey-wall-graph') {
    const formalGraph = JSON.parse(JSON.stringify(graph));
    formalGraph.status = 'draft';
    formalGraph.updatedAt = new Date().toISOString();
    return {
      version: 4,
      measurementMode: 'surveying',
      surveyGraph: formalGraph,
      draftState: { activeFloorId: formalGraph.activeFloorId || '', savedAt: formalGraph.updatedAt }
    };
  }
  return null;
}

async function main() {
  await dbConnect();
  const plans = await FloorPlan.find({}).select('_id layoutData status').lean();
  const promote = plans.filter((plan) => !isFormalSurveyLayout(plan.layoutData) && promotePrototype(plan.layoutData));
  const remove = plans.filter((plan) => !isFormalSurveyLayout(plan.layoutData) && !promotePrototype(plan.layoutData));

  console.info(`[cleanup] formal=${plans.length - promote.length - remove.length} promote=${promote.length} delete=${remove.length}`);
  if (!execute) {
    console.info('[cleanup] Dry run only. Re-run with --execute to change data.');
    return;
  }

  for (const plan of promote) {
    await FloorPlan.updateOne({ _id: plan._id }, { $set: { layoutData: promotePrototype(plan.layoutData), status: 'draft' } });
  }

  const removeIds = remove.map((plan) => plan._id);
  if (removeIds.length) {
    await Promise.all([
      Lead.updateMany({ floorPlanIds: { $in: removeIds } }, { $pull: { floorPlanIds: { $in: removeIds } } }),
      Lead.updateMany({ primaryFloorPlanId: { $in: removeIds } }, { $unset: { primaryFloorPlanId: 1 } }),
      Measurement.deleteMany({ floorPlanId: { $in: removeIds } }),
      FloorPlan.deleteMany({ _id: { $in: removeIds } })
    ]);
  }

  console.info(`[cleanup] Promoted ${promote.length} graph drafts and deleted ${removeIds.length} legacy plans.`);
}

main().catch((error) => {
  console.error('[cleanup] failed', error);
  process.exitCode = 1;
});

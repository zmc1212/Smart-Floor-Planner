import { loadEnvConfig } from '@next/env';

const execute = process.argv.includes('--execute');

loadEnvConfig(process.cwd());

async function main() {
  const [
    { default: dbConnect },
    { FloorPlan },
    { isFormalSurveyLayout },
  ] = await Promise.all([
    import('../src/lib/mongodb'),
    import('../src/models/FloorPlan'),
    import('../src/lib/survey-graph'),
  ]);
  await dbConnect();

  const candidates = await FloorPlan.find({
    status: 'completed',
    completedAt: { $exists: false },
  }).select('_id layoutData createdAt updatedAt').lean();

  const plans = candidates.filter((plan) => isFormalSurveyLayout(plan.layoutData));
  console.info(`[backfill-completed-at] candidates=${plans.length}`);

  if (!execute) {
    console.info('[backfill-completed-at] Dry run only. Re-run with --execute to write completedAt.');
    return;
  }

  if (!plans.length) return;

  const result = await FloorPlan.bulkWrite(
    plans.map((plan) => ({
      updateOne: {
        filter: { _id: plan._id, completedAt: { $exists: false } },
        update: { $set: { completedAt: plan.updatedAt || plan.createdAt } },
      },
    }))
  );

  console.info(`[backfill-completed-at] updated=${result.modifiedCount}`);
}

main().catch((error) => {
  console.error('[backfill-completed-at] failed', error);
  process.exitCode = 1;
});

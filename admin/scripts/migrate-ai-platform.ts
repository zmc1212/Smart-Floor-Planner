import mongoose from 'mongoose';
import { loadEnvConfig } from '@next/env';
import { Enterprise } from '../src/models/Enterprise';
import { AiCreditAccount } from '../src/models/AiCreditAccount';
import { AiCreditPrice } from '../src/models/AiCreditPrice';
import { AiGeneration } from '../src/models/AiGeneration';
import { AiStylePreset } from '../src/models/AiStylePreset';
import { ensureDefaultAiCreditPrices } from '../src/lib/ai/credits';
import { ensureEnvironmentAiProviders } from '../src/lib/ai/provider-registry';
import { AI_ACTION_KEYS, actionKeyForGenerationType } from '../src/lib/ai/provider-types';

loadEnvConfig(process.cwd());

async function main() {
  const { default: dbConnect } = await import('../src/lib/mongodb');
  await dbConnect();
  const priceIndexes = await AiCreditPrice.collection.indexes().catch(() => []);
  const legacyModeIndex = priceIndexes.find((index) => index.key?.mode === 1);
  if (legacyModeIndex?.name) await AiCreditPrice.collection.dropIndex(legacyModeIndex.name);
  await Promise.all([ensureDefaultAiCreditPrices(), ensureEnvironmentAiProviders()]);

  const enterprises = await Enterprise.find().select('_id').lean();
  await Enterprise.updateMany(
    { 'aiPolicy.enabledActionKeys': { $exists: false } },
    { $set: { 'aiPolicy.enabledActionKeys': [...AI_ACTION_KEYS], 'aiPolicy.logicalModelTier': 'standard' } }
  );
  for (const enterprise of enterprises) {
    await AiCreditAccount.updateOne(
      { enterpriseId: enterprise._id },
      { $setOnInsert: { balance: 0, frozenBalance: 0, version: 0, appliedOperationIds: [] } },
      { upsert: true }
    );
  }

  const generations = await AiGeneration.find({ $or: [{ actionKey: { $exists: false } }, { logicalModelKey: { $exists: false } }] });
  for (const generation of generations) {
    const actionKey = actionKeyForGenerationType(generation.type);
    const isText = generation.type === 'advice';
    generation.actionKey = actionKey;
    generation.capability = isText ? 'chat' : generation.input?.sourceImage ? 'image.edit' : 'image.generate';
    generation.logicalModelKey = isText ? 'chat.general' : generation.input?.sourceImage ? 'image.edit.standard' : 'image.generate.standard';
    generation.billing = { ...generation.billing, actionKey, cycle: generation.billing?.cycle ?? generation.retryCount ?? 0 };
    await generation.save();
  }

  const presets = await AiStylePreset.find({ 'image.logicalModelKey': { $exists: false } });
  for (const preset of presets) {
    preset.image.logicalModelKey = preset.image.mode === 'generation' ? 'image.generate.standard' : 'image.edit.standard';
    await preset.save();
  }

  console.log(JSON.stringify({ enterprises: enterprises.length, generations: generations.length, presets: presets.length }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exitCode = 1;
});

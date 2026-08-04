import { AiCreationRepository } from '@/db/repositories';
import { parsePostgresId } from '@/db/postgres-dto';
import { withTenantTransaction } from '@/db/transaction';
import { getAiCreditPrice } from '@/lib/ai/credits';
import { assertEnterpriseAiActionAllowed } from '@/lib/ai/enterprise-policy';
import { parseImageDataUri } from '@/lib/ai/media-assets';
import { getPostgresMediaAssetImageUrl, storePostgresMediaBuffer } from '@/lib/ai/postgres-media-assets';
import { submitPostgresCreationGeneration } from '@/lib/ai/postgres-creation-runtime';
import type { FurnitureSelection } from '@/lib/ai/soft-furnishing';

export async function createPostgresSoftFurnishingRender(input: {
  enterpriseId: string;
  operatorId: string;
  image: string;
  furnitureItems: FurnitureSelection[];
  prompt: string;
  negativePrompt: string;
  roomType: 'bedroom' | 'living_room';
  resolution: '1k' | '2k';
}) {
  const enterpriseId = parsePostgresId(input.enterpriseId, 'enterpriseId');
  const operatorId = parsePostgresId(input.operatorId, 'operatorId');
  await assertEnterpriseAiActionAllowed(enterpriseId.toString(), 'image.soft_furnishing_render');
  const price = await getAiCreditPrice('image.soft_furnishing_render');
  const parsedImage = parseImageDataUri(input.image);
  const sourceAsset = await storePostgresMediaBuffer({
    enterpriseId,
    ownerType: 'ai_generation_input',
    mimeType: parsedImage.mimeType,
    buffer: parsedImage.buffer,
    storageProviderKey: 'local',
  });
  const generation = await withTenantTransaction(enterpriseId, async (transaction) => {
    const repository = new AiCreationRepository(transaction);
    const created = await repository.createGeneration({
      enterpriseId,
      operatorId,
      type: 'soft_furnishing_render',
      channel: 'admin',
      actionKey: 'image.soft_furnishing_render',
      capability: 'image.edit',
      logicalModelKey: 'image.edit.standard',
      status: 'pending',
      input: {
        style: 'soft_furnishing',
        roomType: input.roomType,
        roomName: input.roomType === 'bedroom' ? '卧室软装' : '客厅软装',
        mode: 'photo_furniture_staging_v2',
        sourceImage: getPostgresMediaAssetImageUrl(sourceAsset.asset.id),
        furnitureItems: input.furnitureItems,
        customPrompt: input.prompt,
        negativePrompt: input.negativePrompt,
        outputAspectRatio: '3:2',
        outputSize: input.resolution === '2k' ? '1536x1024' : '1024x1024',
        outputQuality: input.resolution === '2k' ? 'high' : 'medium',
      },
      output: { promptUsed: input.prompt },
      billing: {
        cycle: 0,
        actionKey: 'image.soft_furnishing_render',
        price: price.credits,
        priceSnapshot: {
          actionKey: 'image.soft_furnishing_render',
          label: price.label,
          credits: price.credits,
          capturedAt: new Date().toISOString(),
        },
        status: 'unbilled',
      },
    });
    await repository.updateMediaAsset(sourceAsset.asset.id, { ownerId: created.id });
    return created;
  });

  await submitPostgresCreationGeneration({
    enterpriseId: enterpriseId.toString(),
    generationId: generation.id.toString(),
  });
  return withTenantTransaction(enterpriseId, (transaction) =>
    new AiCreationRepository(transaction).findGeneration(generation.id)
  );
}

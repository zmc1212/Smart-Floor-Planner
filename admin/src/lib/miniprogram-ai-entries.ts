import { PlatformConfigRepository } from '@/db/repositories';
import { withPlatformTransaction } from '@/db/transaction';

const platformKey = 'default';

export async function readMiniProgramAiEntries() {
  return withPlatformTransaction(async (transaction) => {
    const row = await new PlatformConfigRepository(transaction).findByKey(platformKey);
    return { enabled: row?.aiPromptConfig?.miniProgramAiEntriesEnabled === true };
  });
}

export async function saveMiniProgramAiEntries(enabled: boolean) {
  return withPlatformTransaction(async (transaction) => {
    const repository = new PlatformConfigRepository(transaction);
    const row = await repository.ensureForUpdate(platformKey);
    await repository.update(platformKey, {
      aiPromptConfig: { ...row.aiPromptConfig, miniProgramAiEntriesEnabled: enabled },
    });
    return { enabled };
  });
}

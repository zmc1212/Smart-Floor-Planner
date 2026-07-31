import ProviderEditor from '@/components/ai-providers/provider-editor';

export default async function AiProviderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProviderEditor providerId={id} />;
}

import PresetEditor from '@/components/ai-presets/preset-editor';

export default async function AiPresetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PresetEditor presetId={id} />;
}

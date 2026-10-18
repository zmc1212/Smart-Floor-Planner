import { WorkEditor } from '@/components/portfolio/work-editor';
export default async function CaseEditorPage({ params }: { params: Promise<{ id: string }> }) { return <WorkEditor workId={(await params).id} />; }

import { loadEnvConfig } from '@next/env';
import { finalTool } from '@/lib/assistant/agent/worker';
import { explicitNativeObjectRoot, nativeFinalDefinition } from '@/lib/assistant/agent/native-final';
import { reportAnswerFinalTool } from '@/lib/assistant/agent/report-final';
loadEnvConfig(process.cwd(), true);
const tool = explicitNativeObjectRoot(nativeFinalDefinition(reportAnswerFinalTool(finalTool, '问', ['C1', 'C2'])));
console.log(JSON.stringify(tool.parameters, null, 1).slice(0, 1800));

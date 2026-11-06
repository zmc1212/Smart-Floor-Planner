import type { ModelMessage, ModelTool, ModelTurnInput } from '../contracts/model';
import { currentMessageOnlyRequested, currentMessageView } from './current-message-scope';
import { independentAdviceRequested, originalAnswerOnly } from './read-tool-input';
import { sourceExcerptModelView } from './source-excerpts';
import { sourceQuestionCoverageInstructions, type SourceQuestionCoverage } from './source-question-coverage';
import { independentAdviceView } from './independent-advice-context';
import { focusedSynthesisMessages, synthesisInstructions } from './synthesis';
import { projectSynthesisPolicy, publicSourceModelInstructions, synthesisModelInstructions, synthesisQuestionPrefix } from './model-policy';
import { fitAgentContext, type RequestBudgetOptions } from './context-budget';
import { consultationModelViewVersion, hasSourceRead, hasSynthesisContract, projectConsultationModelView } from './consultation-model-view';
import { consultationLongProfile } from '../contracts/consultation';
import { constrainSynthesisRepairTool } from './synthesis-repair';
import { knowledgeExplanationInstructions, naturalKnowledgeInstructions } from './knowledge-explanation';
import { reportCoverageInstructions } from './report-final';
import { homeSourceViewProtocol, projectHomeSourceView, type HomeSourceView } from './home-source-view';
import { nativeFinalDefinition } from './native-final';
import { minimalNeedTools, minimalSourceInstructions } from './minimal-dialogue';

export type ModelRequestPurpose = 'answer' | 'vision' | 'summary' | 'grounding';

/** One pure compilation boundary. Authorization, durable dispatch, usage and
 * commit stay in the worker; this projection never edits the checkpoint. */
export function compileModelRequest(input: {
  question: string; triggerId: string; turn: number; purpose: ModelRequestPurpose;
  messages: ModelMessage[]; tools: ModelTool[];
  profile?: ModelTurnInput['profile'];
  imageContextBudget?: RequestBudgetOptions['imageContextBudget'];
  reportFinalOutputTokens?: RequestBudgetOptions['reportFinalOutputTokens'];
  sourceExcerpts?:boolean;
  sourceQuestionCoverage?:boolean;
  knowledgeExplanation?:boolean;
  naturalKnowledge?:boolean;
  minimalDialogue?:boolean;
  requiredKnowledge?:boolean;
  reportPlan?: SourceQuestionCoverage | null;
  homeSourceView?: HomeSourceView;
  wireProjection?(messages:ModelMessage[]):ModelMessage[];
  toolsForTurn(question: string, messages: ModelMessage[], tools: ModelTool[], triggerId: string): ModelTool[];
}) {
  const { question, triggerId, turn, purpose, messages, tools } = input;
  const minimalDialogue = input.minimalDialogue && !input.profile && !input.naturalKnowledge && !input.knowledgeExplanation
    && input.reportPlan === undefined && purpose === 'answer';
  const messageScoped = purpose === 'answer' && input.reportPlan === undefined && currentMessageOnlyRequested(question);
  const adviceScoped = purpose === 'answer' && input.reportPlan === undefined && !messageScoped && independentAdviceRequested(question);
  const homeView = input.homeSourceView && purpose === 'answer' && !messageScoped && !adviceScoped
    ? projectHomeSourceView(messages, triggerId, input.homeSourceView) : messages;
  const focused = messageScoped ? currentMessageView(messages, triggerId, question)
    : adviceScoped ? independentAdviceView(messages, triggerId, question)
    : (turn > 0 || input.profile) && purpose === 'answer' ? focusedSynthesisMessages(homeView, triggerId, input.reportPlan, minimalDialogue) : homeView;
  let dispatchTools = purpose === 'vision' ? [] : purpose === 'summary' || purpose === 'grounding' ? tools
    : input.toolsForTurn(question, focused, tools, triggerId);
  // Final-only providers use this tool as a JSON schema even on the ordinary
  // path. Reuse the existing kind-specific contract so synthesis requires its
  // segments before generation, just as the application parser requires them.
  const publicSources = focused.some(message => {
    if (message.role !== 'tool') return false;
    try { return JSON.parse(message.content)?.synthesisSources?.some((source: { kind?: string }) => source?.kind === 'web') === true; }
    catch { return false; }
  });
  if (minimalDialogue) dispatchTools = minimalNeedTools(dispatchTools.map(tool => tool.name === 'final_response'
    ? nativeFinalDefinition(tool, { quantityValidation: 'application', taggedFields: true }) : tool));
  else if (purpose === 'answer' && publicSources && !input.profile && !input.naturalKnowledge
    && dispatchTools.length === 1 && dispatchTools[0].name === 'final_response'
    && ((dispatchTools[0].parameters.properties as Record<string, { enum?: string[] }> | undefined)?.kind?.enum || []).includes('synthesis'))
    dispatchTools = [nativeFinalDefinition(dispatchTools[0], { quantityValidation: 'application' })];
  if (input.profile === consultationLongProfile.id && purpose === 'answer' && dispatchTools.length === 1)
    dispatchTools = [constrainSynthesisRepairTool(dispatchTools[0], focused)];
  const excerptMode=purpose==='answer'&&input.sourceExcerpts&&(input.requiredKnowledge||originalAnswerOnly(question));
  const explanationMode = purpose === 'answer' && input.knowledgeExplanation && (input.naturalKnowledge || input.requiredKnowledge || originalAnswerOnly(question)
    || dispatchTools.some(tool => tool.name === 'final_response' && ((tool.parameters.properties as Record<string, { enum?: string[] }>)?.kind?.enum || []).includes('knowledge_explanation')));
  const reportMode = purpose === 'answer' && dispatchTools.some(tool => tool.name === 'final_response'
    && ((tool.parameters.properties as Record<string, { enum?: string[] }>)?.kind?.enum || []).includes('report_answer'));
  // Source encoding is independent of the enterprise-knowledge switch. Only
  // an actual public read uses these existing shared clauses, including any
  // independently authorized business/history sources in the same answer;
  // the worker's complete security, memory and action policy stays untouched.
  const publicSourceProtocol = purpose === 'answer' && (publicSources || minimalDialogue && hasSourceRead(focused)) && !input.profile && !input.naturalKnowledge && input.reportPlan === undefined
    && !hasSynthesisContract(focused, synthesisInstructions) && !hasSynthesisContract(focused, synthesisModelInstructions);
  const publicContract = minimalDialogue ? minimalSourceInstructions : publicSourceModelInstructions;
  const policyInput = publicSourceProtocol && !hasSynthesisContract(focused, publicContract)
    ? [...focused, { role: 'system' as const, content: [{ type: 'text' as const,
      text: publicContract + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] }]
    : focused;
  const policyView = purpose === 'answer' ? projectSynthesisPolicy(policyInput,Boolean(excerptMode),explanationMode
    ? input.naturalKnowledge ? naturalKnowledgeInstructions : knowledgeExplanationInstructions : reportMode?reportCoverageInstructions:undefined) : focused;
  const contentView = publicSourceProtocol ? projectConsultationModelView(policyView, dispatchTools, publicContract,
    { preservePolicy: true, budget: { profile: input.profile, purpose, imageContextBudget: input.imageContextBudget,
      reportFinalOutputTokens: input.reportFinalOutputTokens } }) : input.profile && purpose === 'answer' ? projectConsultationModelView(policyView, dispatchTools) : policyView;
  const excerptView=excerptMode?sourceExcerptModelView(contentView):contentView;
  if (excerptMode && input.sourceQuestionCoverage) excerptView.push({ role: 'system', content: [{ type: 'text', text: sourceQuestionCoverageInstructions }] });
  const wireView=input.wireProjection?input.wireProjection(excerptView):excerptView;
  const bounded = fitAgentContext(wireView, dispatchTools, { profile: input.profile, purpose, imageContextBudget: input.imageContextBudget,
    reportFinalOutputTokens: input.reportFinalOutputTokens });
  return { messageScoped, adviceScoped, focused, dispatchTools, policyView, bounded, modelMessages: bounded.messages,
    homeSourceProjection: homeView === messages ? null : homeSourceViewProtocol,
    contentProjection: contentView === policyView ? null : consultationModelViewVersion };
}

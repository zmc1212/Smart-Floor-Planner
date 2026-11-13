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
import { difyDialogueMessages, minimalNeedTools, minimalSourceInstructions } from './minimal-dialogue';
import { hasReviewedStandardRead } from './web-tool-runtime';

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
  difyDialogue?:boolean;
  requiredKnowledge?:boolean;
  reportPlan?: SourceQuestionCoverage | null;
  homeSourceView?: HomeSourceView;
  wireProjection?(messages:ModelMessage[]):ModelMessage[];
  toolsForTurn(question: string, messages: ModelMessage[], tools: ModelTool[], triggerId: string): ModelTool[];
}) {
  const { question, triggerId, turn, purpose, messages, tools } = input;
  const minimalDialogue = input.minimalDialogue && !input.profile && !input.naturalKnowledge && !input.knowledgeExplanation
    && input.reportPlan === undefined && purpose === 'answer';
  const difyDialogue = minimalDialogue && input.difyDialogue;
  const messageScoped = purpose === 'answer' && input.reportPlan === undefined && currentMessageOnlyRequested(question);
  const adviceScoped = purpose === 'answer' && input.reportPlan === undefined && !messageScoped && independentAdviceRequested(question);
  const homeView = input.homeSourceView && purpose === 'answer' && !messageScoped && !adviceScoped
    ? projectHomeSourceView(messages, triggerId, input.homeSourceView) : messages;
  const reviewedStandard = purpose === 'answer' && hasReviewedStandardRead(homeView);
  let focused = messageScoped ? currentMessageView(messages, triggerId, question)
    : adviceScoped ? independentAdviceView(messages, triggerId, question)
    : (turn > 0 || input.profile || difyDialogue || reviewedStandard) && purpose === 'answer'
      ? focusedSynthesisMessages(homeView, triggerId, input.reportPlan, minimalDialogue) : homeView;
  let dispatchTools = purpose === 'vision' ? [] : purpose === 'summary' || purpose === 'grounding' ? tools
    : input.toolsForTurn(question, focused, tools, triggerId);
  // Keep natural history, but use the existing current-question tail for a
  // final-only source answer. Old restored pages cannot become the last task.
  // Planning/action turns stay in order; a bound repair retains its own task.
  if (minimalDialogue && dispatchTools.length === 1 && dispatchTools[0].name === 'final_response')
    focused = focusedSynthesisMessages(focused, triggerId, input.reportPlan, true, true);
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
  let policyInput = focused;
  if (publicSourceProtocol && !hasSynthesisContract(focused, publicContract)) {
    const policy: ModelMessage = { role: 'system', content: [{ type: 'text', text: difyDialogue
      ? publicContract : publicContract + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] };
    const firstTurn = focused.findIndex(message => message.role !== 'system');
    const position = difyDialogue ? firstTurn < 0 ? focused.length : firstTurn : focused.length;
    policyInput = [...focused.slice(0, position), policy, ...focused.slice(position)];
  }
  const policyView = purpose === 'answer' ? projectSynthesisPolicy(policyInput,Boolean(excerptMode),explanationMode
    ? input.naturalKnowledge ? naturalKnowledgeInstructions : knowledgeExplanationInstructions : reportMode?reportCoverageInstructions:undefined) : focused;
  const contentView = publicSourceProtocol || minimalDialogue || reviewedStandard ? projectConsultationModelView(policyView, dispatchTools, publicContract,
    { preservePolicy: true, compactReadPolicy: reviewedStandard, navigationOnly: !publicSourceProtocol, budget: { profile: input.profile, purpose, imageContextBudget: input.imageContextBudget,
      reportFinalOutputTokens: input.reportFinalOutputTokens } }) : purpose === 'answer' && (input.profile || input.naturalKnowledge)
    ? projectConsultationModelView(policyView, dispatchTools, input.naturalKnowledge ? naturalKnowledgeInstructions : undefined) : policyView;
  const excerptView=excerptMode?sourceExcerptModelView(contentView):contentView;
  if (excerptMode && input.sourceQuestionCoverage) excerptView.push({ role: 'system', content: [{ type: 'text', text: sourceQuestionCoverageInstructions }] });
  const wireView=input.wireProjection?input.wireProjection(excerptView):excerptView;
  const bounded = fitAgentContext(wireView, dispatchTools, { profile: input.profile, purpose, imageContextBudget: input.imageContextBudget,
    reportFinalOutputTokens: input.reportFinalOutputTokens,
    ...(input.reportFinalOutputTokens ? { recentTurns: 1 } : {}) });
  return { messageScoped, adviceScoped, focused, dispatchTools, policyView, bounded,
    modelMessages: difyDialogue ? difyDialogueMessages(bounded.messages) : bounded.messages,
    homeSourceProjection: homeView === messages ? null : homeSourceViewProtocol,
    contentProjection: contentView === policyView ? null : consultationModelViewVersion };
}

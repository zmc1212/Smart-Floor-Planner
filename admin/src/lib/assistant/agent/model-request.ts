import type { ModelMessage, ModelTool, ModelTurnInput } from '../contracts/model';
import { currentMessageOnlyRequested, currentMessageView } from './current-message-scope';
import { independentAdviceRequested, originalAnswerOnly } from './read-tool-input';
import { sourceExcerptModelView } from './source-excerpts';
import { sourceQuestionCoverageInstructions, type SourceQuestionCoverage } from './source-question-coverage';
import { independentAdviceView } from './independent-advice-context';
import { focusedSynthesisMessages } from './synthesis';
import { projectSynthesisPolicy } from './model-policy';
import { fitAgentContext, type RequestBudgetOptions } from './context-budget';
import { consultationModelViewVersion, projectConsultationModelView } from './consultation-model-view';
import { consultationLongProfile } from '../contracts/consultation';
import { constrainSynthesisRepairTool } from './synthesis-repair';
import { knowledgeExplanationInstructions } from './knowledge-explanation';
import { reportCoverageInstructions } from './report-final';
import { homeSourceViewProtocol, projectHomeSourceView, type HomeSourceView } from './home-source-view';

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
  requiredKnowledge?:boolean;
  reportPlan?: SourceQuestionCoverage | null;
  homeSourceView?: HomeSourceView;
  wireProjection?(messages:ModelMessage[]):ModelMessage[];
  toolsForTurn(question: string, messages: ModelMessage[], tools: ModelTool[], triggerId: string): ModelTool[];
}) {
  const { question, triggerId, turn, purpose, messages, tools } = input;
  const messageScoped = purpose === 'answer' && input.reportPlan === undefined && currentMessageOnlyRequested(question);
  const adviceScoped = purpose === 'answer' && input.reportPlan === undefined && !messageScoped && independentAdviceRequested(question);
  const homeView = input.homeSourceView && purpose === 'answer' && !messageScoped && !adviceScoped
    ? projectHomeSourceView(messages, triggerId, input.homeSourceView) : messages;
  const focused = messageScoped ? currentMessageView(messages, triggerId, question)
    : adviceScoped ? independentAdviceView(messages, triggerId, question)
    : (turn > 0 || input.profile) && purpose === 'answer' ? focusedSynthesisMessages(homeView, triggerId, input.reportPlan) : homeView;
  let dispatchTools = purpose === 'vision' ? [] : purpose === 'summary' || purpose === 'grounding' ? tools
    : input.toolsForTurn(question, focused, tools, triggerId);
  if (input.profile === consultationLongProfile.id && purpose === 'answer' && dispatchTools.length === 1)
    dispatchTools = [constrainSynthesisRepairTool(dispatchTools[0], focused)];
  const excerptMode=purpose==='answer'&&input.sourceExcerpts&&(input.requiredKnowledge||originalAnswerOnly(question));
  const explanationMode = purpose === 'answer' && input.knowledgeExplanation && (input.requiredKnowledge || originalAnswerOnly(question)
    || dispatchTools.some(tool => tool.name === 'final_response' && ((tool.parameters.properties as Record<string, { enum?: string[] }>)?.kind?.enum || []).includes('knowledge_explanation')));
  const reportMode = purpose === 'answer' && dispatchTools.some(tool => tool.name === 'final_response'
    && ((tool.parameters.properties as Record<string, { enum?: string[] }>)?.kind?.enum || []).includes('report_answer'));
  const policyView = purpose === 'answer' ? projectSynthesisPolicy(focused,Boolean(excerptMode),explanationMode?knowledgeExplanationInstructions:reportMode?reportCoverageInstructions:undefined) : focused;
  const contentView = input.profile && purpose === 'answer' ? projectConsultationModelView(policyView, dispatchTools) : policyView;
  const excerptView=excerptMode?sourceExcerptModelView(contentView):contentView;
  if (excerptMode && input.sourceQuestionCoverage) excerptView.push({ role: 'system', content: [{ type: 'text', text: sourceQuestionCoverageInstructions }] });
  const wireView=input.wireProjection?input.wireProjection(excerptView):excerptView;
  const bounded = fitAgentContext(wireView, dispatchTools, { profile: input.profile, purpose, imageContextBudget: input.imageContextBudget,
    reportFinalOutputTokens: input.reportFinalOutputTokens });
  return { messageScoped, adviceScoped, focused, dispatchTools, policyView, bounded, modelMessages: bounded.messages,
    homeSourceProjection: homeView === messages ? null : homeSourceViewProtocol,
    contentProjection: contentView === policyView ? null : consultationModelViewVersion };
}

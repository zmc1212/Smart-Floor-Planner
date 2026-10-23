import type { ModelMessage, ModelTool, ModelTurnInput } from '../contracts/model';
import { currentMessageOnlyRequested, currentMessageView } from './current-message-scope';
import { independentAdviceRequested } from './read-tool-input';
import { independentAdviceView } from './independent-advice-context';
import { focusedSynthesisMessages } from './synthesis';
import { projectSynthesisPolicy } from './model-policy';
import { fitAgentContext } from './context-budget';
import { consultationModelViewVersion, projectConsultationModelView } from './consultation-model-view';

export type ModelRequestPurpose = 'answer' | 'vision' | 'summary';

/** One pure compilation boundary. Authorization, durable dispatch, usage and
 * commit stay in the worker; this projection never edits the checkpoint. */
export function compileModelRequest(input: {
  question: string; triggerId: string; turn: number; purpose: ModelRequestPurpose;
  messages: ModelMessage[]; tools: ModelTool[];
  profile?: ModelTurnInput['profile'];
  toolsForTurn(question: string, messages: ModelMessage[], tools: ModelTool[], triggerId: string): ModelTool[];
}) {
  const { question, triggerId, turn, purpose, messages, tools } = input;
  const messageScoped = purpose === 'answer' && currentMessageOnlyRequested(question);
  const adviceScoped = purpose === 'answer' && !messageScoped && independentAdviceRequested(question);
  const focused = messageScoped ? currentMessageView(messages, triggerId, question)
    : adviceScoped ? independentAdviceView(messages, triggerId, question)
    : (turn > 0 || input.profile) && purpose === 'answer' ? focusedSynthesisMessages(messages, triggerId) : messages;
  const dispatchTools = purpose === 'vision' ? [] : purpose === 'summary' ? tools
    : input.toolsForTurn(question, focused, tools, triggerId);
  const policyView = purpose === 'answer' ? projectSynthesisPolicy(focused) : focused;
  const contentView = input.profile && purpose === 'answer' ? projectConsultationModelView(policyView, dispatchTools) : policyView;
  const bounded = fitAgentContext(contentView, dispatchTools, { profile: input.profile, purpose });
  return { messageScoped, adviceScoped, focused, dispatchTools, policyView, bounded, modelMessages: bounded.messages,
    contentProjection: contentView === policyView ? null : consultationModelViewVersion };
}

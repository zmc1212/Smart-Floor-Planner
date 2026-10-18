import type { EmbeddingGateway, KnowledgeRetriever } from '../contracts';
import { retrieveKnowledge } from './retrieval';

/** Bound to a server-authorized conversation; shared with Agent retrieval diagnostics. */
export function conversationKnowledgeRetriever(conversationId:string,gateway?:EmbeddingGateway):KnowledgeRetriever {
  return {async retrieve(actor,query,epoch){return (await retrieveKnowledge(conversationId,actor,query,epoch,gateway)).evidence.filter(e=>e.professional?.applicability.status!=='not_applicable');}};
}

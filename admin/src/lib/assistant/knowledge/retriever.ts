import type { EmbeddingGateway, KnowledgeRetriever } from '../contracts';
import { retrieveKnowledge, type KnowledgeRetrievalScope } from './retrieval';

/** Bound to a server-authorized conversation; shared with Agent retrieval diagnostics. */
export function conversationKnowledgeRetriever(conversationId:string,gateway?:EmbeddingGateway,scope?:KnowledgeRetrievalScope):KnowledgeRetriever {
  return {async retrieve(actor,query,epoch){return (await retrieveKnowledge(conversationId,actor,query,epoch,gateway,scope)).evidence.filter(e=>e.professional?.applicability.status!=='not_applicable');}};
}

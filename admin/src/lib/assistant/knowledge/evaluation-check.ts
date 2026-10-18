export type KnowledgeExpectation = { kind:'grounded'|'missing'; requiredDocumentIds:string[]; forbiddenDocumentIds:string[] };
export type ExpectedSource = {documentId:string;versionId:string;hash:string};
/** Structural evidence only. A citation or recall score cannot certify semantic correctness. */
export function checkKnowledgeEvaluation(input:{expectation:KnowledgeExpectation;required:ExpectedSource[];
  selected:string[];recalled:string[];cited:string[];status:string;answerKind:string|null;diagnosticAvailable:boolean}) {
  const missingRecall=input.required.filter(s=>!input.recalled.includes(s.versionId)).map(s=>s.documentId);
  const missingSelected=input.required.filter(s=>!input.selected.includes(s.versionId)).map(s=>s.documentId);
  const missingCitations=input.required.filter(s=>!input.cited.includes(s.versionId)).map(s=>s.documentId);
  const expectedKind=input.expectation.kind==='grounded'?'grounded':'insufficient_evidence';
  const passed=input.status==='succeeded' && input.answerKind===expectedKind && input.diagnosticAvailable
    && !missingRecall.length && !missingSelected.length && !missingCitations.length;
  return {passed,missingRecall,missingSelected,missingCitations,expectedKind,
    semanticCorrectness:'requires_review' as const,forbiddenDocumentIds:input.expectation.forbiddenDocumentIds};
}

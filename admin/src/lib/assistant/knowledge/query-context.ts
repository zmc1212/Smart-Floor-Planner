/** A model's search terms cannot erase the current customer's explicit object.
 * Text only affects ranking; original tenant, source and applicability guards remain. */
export function anchorKnowledgeQuery(terms:string,currentQuestion:string):string {
  const take=(value:string,limit:number)=>{
    let result='';for(const character of value){if(result.length+character.length>limit)break;result+=character;}return result;
  };
  const question=take(currentQuestion.trim(),600);
  if(!question)return terms;
  const label='\n检索词：';
  return question+label+take(terms,1000-question.length-label.length);
}

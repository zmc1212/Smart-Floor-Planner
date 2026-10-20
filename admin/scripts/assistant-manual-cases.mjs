const sets = Object.freeze({
  all: ['waterproof-heights', 'water-test-followup', 'kitchen-electrical'],
  repair: ['water-test-followup', 'kitchen-electrical'],
});

/** One scenario registry for selection and completion; callers get a copy.
 * @param {string} caseSet */
export function manualScenarioNames(caseSet = 'all') {
  if (!Object.hasOwn(sets, caseSet)) throw new Error('Unknown manual-synthesis case set');
  return [...sets[/** @type {keyof typeof sets} */ (caseSet)]];
}

/** @param {string} caseSet */
export function expectedManualRunCount(caseSet = 'all') { return manualScenarioNames(caseSet).length * 2; }

/** Completion requires every distinct registered scenario/round, not just a
 * matching count; a failed provider or duplicate cannot fill a missing case.
 * @param {Array<{name:string,round:number,fixedChecksPassed?:boolean,firstDraftPassed?:boolean}>} runs
 * @param {string} caseSet
 * @param {boolean} requireFirstDraft */
export function manualBatchComplete(runs, caseSet = 'all', requireFirstDraft = false) {
  const expected = new Set(manualScenarioNames(caseSet).flatMap(name => [1, 2].map(round => name + ':' + round)));
  const actual = runs.map(run => run.name + ':' + run.round);
  return runs.length === expected.size && new Set(actual).size === expected.size && actual.every(key => expected.has(key))
    && runs.every(run => run.fixedChecksPassed && (!requireFirstDraft || run.firstDraftPassed));
}

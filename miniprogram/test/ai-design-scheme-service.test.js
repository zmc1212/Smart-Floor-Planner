const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiService = require('../utils/aiDesignService.js');

const serviceSource = fs.readFileSync(
  path.join(__dirname, '..', 'utils', 'aiDesignService.js'),
  'utf8',
);

test('aiDesignService exports scheme publication CRUD helpers', () => {
  assert.equal(typeof aiService.listSchemePublications, 'function');
  assert.equal(typeof aiService.publishScheme, 'function');
  assert.equal(typeof aiService.withdrawScheme, 'function');
  assert.equal(typeof aiService.withdrawSchemeGeneration, 'function');
  assert.match(serviceSource, /\/leads\/\$\{encodeURIComponent\(leadId\)\}\/ai-scheme-publications/);
  assert.match(serviceSource, /ai-scheme-publications\/\$\{encodeURIComponent\(workflowId\)\}\/generations/);
});

test('aiDesignService exports Mini Studio API wrappers', () => {
  const studioMethods = [
    'loadStudioBootstrap',
    'loadStudioLeads',
    'listStudioWorkflows',
    'getStudioWorkflow',
    'createStudioWorkflow',
    'renameStudioWorkflow',
    'deleteStudioWorkflow',
    'deleteStudioGeneration',
    'getStudioTask',
    'createStudioTask',
    'submitStudioBatch',
    'retryStudioBatch',
    'uploadStudioAsset',
    'loadStudioPromptCategories',
    'loadStudioPromptTemplates',
    'assistStudioPrompt',
  ];
  studioMethods.forEach((name) => {
    assert.equal(typeof aiService[name], 'function', `${name} should be exported`);
  });
  assert.match(serviceSource, /\/miniprogram\/ai\/studio\/bootstrap/);
  assert.match(serviceSource, /\/miniprogram\/ai\/studio\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/batches/);
  assert.match(serviceSource, /\/miniprogram\/ai\/studio\/assets/);
});

test('legacy single-image publication helpers remain for standalone result tasks', () => {
  assert.equal(typeof aiService.getPublication, 'function');
  assert.equal(typeof aiService.publishGeneration, 'function');
  assert.equal(typeof aiService.withdrawGeneration, 'function');
  assert.match(serviceSource, /Legacy single-image publication API/);
  assert.match(serviceSource, /Prefer scheme merge publish inside scheme-studio/);
});

test('scheme publication helpers call the expected lead endpoints', async () => {
  const originals = {
    request: require('../utils/api.js').request,
  };
  const calls = [];
  require('../utils/api.js').request = (url, method, data) => {
    calls.push({ url, method, data });
    return Promise.resolve({ success: true, data: { ok: true } });
  };

  try {
    await aiService.listSchemePublications('lead-1');
    await aiService.publishScheme('lead-1', { workflowId: 'wf-1', title: '客厅方案', generationIds: ['g-1'] });
    await aiService.withdrawScheme('lead-1', 'wf-1');
    await aiService.withdrawSchemeGeneration('lead-1', 'wf-1', 'g-1');

    assert.deepEqual(calls[0], {
      url: '/leads/lead-1/ai-scheme-publications',
      method: 'GET',
      data: undefined,
    });
    assert.deepEqual(calls[1], {
      url: '/leads/lead-1/ai-scheme-publications',
      method: 'POST',
      data: { workflowId: 'wf-1', title: '客厅方案', generationIds: ['g-1'] },
    });
    assert.deepEqual(calls[2], {
      url: '/leads/lead-1/ai-scheme-publications/wf-1',
      method: 'DELETE',
      data: undefined,
    });
    assert.deepEqual(calls[3], {
      url: '/leads/lead-1/ai-scheme-publications/wf-1/generations/g-1',
      method: 'DELETE',
      data: undefined,
    });
  } finally {
    require('../utils/api.js').request = originals.request;
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupModels } from './models.js';

const models = [
  { id: 'copilot/haiku', name: 'Claude Haiku', provider: 'copilot' },
  { id: 'openai/gpt-5', name: 'GPT-5', provider: 'openai' },
  { id: 'copilot/sonnet', name: 'Claude Sonnet', provider: 'copilot' },
];
const shape = (groups) => groups.map((g) => [g.provider, g.models.map((m) => m.id)]);

test('models are grouped by provider, in the order providers first appear', () => {
  assert.deepEqual(shape(groupModels(models, '', '')), [
    ['copilot', ['copilot/haiku', 'copilot/sonnet']],
    ['openai', ['openai/gpt-5']],
  ]);
});

test('a query keeps the models whose name, id or provider matches', () => {
  assert.deepEqual(shape(groupModels(models, 'sonnet', '')), [['copilot', ['copilot/sonnet']]]);
  assert.deepEqual(shape(groupModels(models, 'openai', '')), [['openai', ['openai/gpt-5']]]);
  assert.deepEqual(shape(groupModels(models, 'gemini', '')), []);
});

test('a chat on a model no longer listed keeps it, so it never changes model unseen', () => {
  assert.deepEqual(shape(groupModels(models, '', 'old/model'))[0], ['Current', ['old/model']]);
  assert.deepEqual(shape(groupModels(models, '', 'copilot/haiku')).length, 2);
});

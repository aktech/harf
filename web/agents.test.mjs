import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentTags, agentActivity, editedLabel } from './agents.js';

test('tags are the tools then the MCP servers an agent may use', () => {
  assert.deepEqual(agentTags({ tools: ['bash', 'read'], mcp: ['permits'] }, ['permits', 'github']), ['bash', 'read', 'permits']);
});

test('an agent with default tools and every server lists them', () => {
  assert.deepEqual(agentTags({ tools: null, mcp: null }, ['github']), ['read', 'bash', 'edit', 'write', 'github']);
  assert.deepEqual(agentTags({}, []), ['read', 'bash', 'edit', 'write']);
});

test('an agent with no tools and no servers has no tags', () => {
  assert.deepEqual(agentTags({ tools: [], mcp: [] }, ['github']), []);
});

test('activity counts the agent\'s chats and whether one is replying', () => {
  const chats = [{ agentId: 'a1' }, { agentId: 'a1', replying: true }, { agentId: 'a2' }, {}];
  assert.deepEqual(agentActivity('a1', chats), { chats: 2, running: true });
  assert.deepEqual(agentActivity('a2', chats), { chats: 1, running: false });
  assert.deepEqual(agentActivity('a3', chats), { chats: 0, running: false });
});

test('edited reads as a day', () => {
  const now = new Date(2026, 10, 12, 15, 0);
  assert.equal(editedLabel(new Date(2026, 10, 12, 1, 0).toISOString(), now), 'Edited today');
  assert.equal(editedLabel(new Date(2026, 10, 11, 23, 0).toISOString(), now), 'Edited yesterday');
  assert.equal(editedLabel(new Date(2026, 10, 8, 9, 0).toISOString(), now), 'Edited 4 days ago');
  assert.equal(editedLabel(new Date(2026, 8, 3, 9, 0).toISOString(), now), 'Edited Sep 3');
  assert.equal(editedLabel(new Date(2025, 8, 3, 9, 0).toISOString(), now), 'Edited Sep 3, 2025');
  assert.equal(editedLabel('', now), '');
});

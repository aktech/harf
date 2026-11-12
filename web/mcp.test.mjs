import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePairs, formatPairs, mcpTool, savedAgent } from './mcp.js';

test('env lines are KEY=value, and values may hold =', () => {
  assert.deepEqual(parsePairs('API_KEY=a=b\n\n  MODE = fast \n', '='), { API_KEY: 'a=b', MODE: 'fast' });
  assert.deepEqual(parsePairs('', '='), {});
});

test('header lines are Name: value', () => {
  assert.deepEqual(parsePairs('Authorization: Bearer t-1', ':'), { Authorization: 'Bearer t-1' });
});

test('a line without the separator or a name is an error that names it', () => {
  assert.throws(() => parsePairs('MODE=fast\nnope', '='), /line 2/);
  assert.throws(() => parsePairs('=x', '='), /line 1/);
});

test('pairs go back to the same lines', () => {
  const env = { A: '1', B: 'x=y' };
  assert.equal(formatPairs(env, '='), 'A=1\nB=x=y');
  assert.deepEqual(parsePairs(formatPairs(env, '='), '='), env);
  assert.equal(formatPairs({ Authorization: 'Bearer t' }, ':'), 'Authorization: Bearer t');
  assert.equal(formatPairs(undefined, '='), '');
});

test('MCP tool names give their server and tool', () => {
  assert.deepEqual(mcpTool('mcp__dice_box__roll_dice'), { server: 'dice_box', tool: 'roll_dice' });
  assert.deepEqual(mcpTool('mcp__docs__get__page'), { server: 'docs', tool: 'get__page' });
  assert.equal(mcpTool('bash'), null);
  assert.equal(mcpTool('mcp__docs'), null);
});

test('a finished create_agent or update_agent step holds the saved agent', () => {
  const agent = { id: 'a-1', name: 'Go reviewer' };
  const output = JSON.stringify({ agent, note: 'Saved.' });
  assert.deepEqual(savedAgent({ name: 'create_agent', status: 'done', output }), agent);
  assert.deepEqual(savedAgent({ name: 'update_agent', status: 'done', output }), agent);
  assert.equal(savedAgent({ name: 'create_agent', status: 'running', output }), null);
  assert.equal(savedAgent({ name: 'create_agent', status: 'error', output: 'Pi has no model x' }), null);
  assert.equal(savedAgent({ name: 'bash', status: 'done', output }), null);
  assert.equal(savedAgent({ name: 'create_agent', status: 'done', output: '{"agent":{"name":"no id"}}' }), null);
});

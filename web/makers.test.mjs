import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makerOf, providerName, providerLogo } from './makers.js';

const maker = (id, name) => (makerOf(id, name) || {}).id || null;

test('the maker comes from the model, not from the provider serving it', () => {
  assert.equal(maker('github-copilot/claude-haiku-4.5'), 'anthropic');
  assert.equal(maker('anthropic/claude-sonnet-5-5'), 'anthropic');
  assert.equal(maker('github-copilot/gpt-5.3-codex'), 'openai');
  assert.equal(maker('github-copilot/gemini-3.8-flash'), 'gemini');
  assert.equal(maker('openai-codex/o4-mini'), 'openai');
});

test('an OpenRouter id names its maker in the middle', () => {
  assert.equal(maker('openrouter/google/gemini-3-pro-image'), 'gemini');
  assert.equal(maker('openrouter/google/imagen-4'), 'google');
  assert.equal(maker('openrouter/z-ai/glm-4.6'), 'zai');
  assert.equal(maker('openrouter/meta-llama/llama-4-maverick'), 'meta');
  assert.equal(maker('openrouter/x-ai/grok-5'), 'xai');
  assert.equal(maker('openrouter/moonshotai/kimi-k3'), 'kimi');
  assert.equal(maker('openrouter/black-forest-labs/flux-pro'), 'bfl');
  // A distilled model is its publisher's, not its base model's.
  assert.equal(maker('openrouter/deepseek/deepseek-r1-distill-qwen-32b'), 'deepseek');
});

test('model names alone find their maker', () => {
  assert.equal(maker('custom/x', 'Mistral Large'), 'mistral');
  assert.equal(maker('local/qwen3-coder'), 'qwen');
  assert.equal(maker('github-copilot/kimi-k3', 'Kimi K3'), 'kimi');
  assert.equal(maker('opencode-go/glm-5.3'), 'zai');
  assert.equal(maker('openrouter/google/gemma-3-27b-it'), 'gemma');
  assert.equal(maker('minimax/minimax-m2'), 'minimax');
});

test('an unknown maker is null, and no word inside another word counts', () => {
  assert.equal(maker('acme/widget-7'), null);
  assert.equal(maker('acme/metaphor-1'), null);
  assert.equal(maker('acme/novel-2'), null);
});

test('providers have readable names', () => {
  assert.equal(providerName('github-copilot'), 'GitHub Copilot');
  assert.equal(providerName('openrouter'), 'OpenRouter');
  assert.equal(providerName('openrouter images'), 'OpenRouter images');
  assert.equal(providerName('some-new-host'), 'some-new-host');
});

test('models carry the logo of their own brand', () => {
  const logo = (id) => makerOf(id).logo;
  assert.equal(logo('github-copilot/claude-haiku-4.5'), 'claude-color');
  assert.equal(logo('opencode-go/glm-5.3'), 'zai');
  assert.equal(logo('openrouter/moonshotai/kimi-k3'), 'kimi-color');
  assert.equal(logo('openrouter/google/gemma-3-27b-it'), 'gemma-color');
  assert.equal(logo('openrouter/google/imagen-4'), 'google-color');
});

test('known providers have their own logo, unknown ones none', () => {
  assert.equal(providerLogo('github-copilot').logo, 'githubcopilot');
  assert.equal(providerLogo('openrouter images').logo, 'openrouter');
  assert.equal(providerLogo('opencode-go').logo, 'opencode');
  assert.equal(providerLogo('some-new-host'), null);
});

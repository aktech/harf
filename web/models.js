import { match } from './match.js';

// groupModels lists models by provider, in the order providers first
// appear, keeping those whose name, id or provider matches query. A current
// model that is not listed comes first on its own, so a chat never changes
// model without the reader seeing it.
export function groupModels(models, query, current) {
  const q = String(query || '').trim();
  const hit = (m) => !q || [m.name || m.id, m.id, m.provider].some((t) => match(t, q));
  const groups = [];
  if (current && !models.some((m) => m.id === current) && hit({ id: current, name: current, provider: '' })) {
    groups.push({ provider: 'Current', models: [{ id: current, name: current, provider: '' }] });
  }
  const byProvider = new Map();
  for (const m of models) {
    if (!hit(m)) continue;
    if (!byProvider.has(m.provider)) {
      byProvider.set(m.provider, { provider: m.provider, models: [] });
      groups.push(byProvider.get(m.provider));
    }
    byProvider.get(m.provider).models.push(m);
  }
  return groups;
}

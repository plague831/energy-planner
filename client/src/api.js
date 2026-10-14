async function request(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Помилка сервера (${res.status})`);
  return body;
}

export const getDefaults = () => request('/api/defaults');
export const getAlgorithms = () => request('/api/algorithms');

export const buildPlan = (household, algorithm) =>
  request('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ household, algorithm }),
  });

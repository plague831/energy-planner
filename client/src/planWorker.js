import { plan } from '@energy-planner/core';

// План рахується у фоновому потоці браузера: генетичний алгоритм займає до секунди процесора,
// а безкоштовний сервер рахує те саме в десятки разів довше. Сторінка при цьому не «зависає».
self.onmessage = ({ data: { id, household, algorithm, replan, dropFailing = true } }) => {
  try {
    // dropFailing: прилад, що за графіком не відпрацює через відключення, не радимо вмикати.
    const result = plan(household, { algorithm, replan, dropFailing });
    // Як і відповідь сервера: лише те, що переживає JSON (Infinity → null тощо).
    self.postMessage({ id, result: JSON.parse(JSON.stringify(result)) });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};

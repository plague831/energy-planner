import { withGeneratorGenes } from '../model.js';

// Базовий підхід «як без сервісу»: кожен прилад вмикається в бажаний час (або якомога раніше).
// Генератор (якщо є) вмикається за типовим правилом: коли заряд станції впав до 30%.
export function naivePlan(model) {
  return withGeneratorGenes(
    model,
    model.appliances.map((a) => (a.preferred !== null ? a.preferred : a.earliest)),
  );
}

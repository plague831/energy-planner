// Базовий підхід «як без сервісу»: кожен прилад вмикається в бажаний час (або якомога раніше).
export function naivePlan(model) {
  return model.appliances.map((a) => (a.preferred !== null ? a.preferred : a.earliest));
}

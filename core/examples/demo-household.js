// Типова квартира з зарядною станцією ~1 кВт·год і двома відключеннями за графіком.
export const demoHousehold = {
  grid: { maxPowerW: 5000 },
  battery: {
    capacityWh: 1024,
    initialSocPct: 70,
    minSocPct: 10,
    targetEndSocPct: 60,
    maxChargeW: 600,
    inverterMaxW: 1800,
  },
  outages: [
    { from: '08:00', to: '12:00' },
    { from: '18:00', to: '22:00' },
  ],
  baseLoads: [
    { id: 'fridge', name: 'Холодильник', powerW: 60, priority: 5 },
    { id: 'router', name: 'Роутер і ONT', powerW: 20, priority: 4 },
    { id: 'lights', name: 'Освітлення', powerW: 40, priority: 3, from: '17:00', to: '23:30' },
    { id: 'laptop', name: 'Ноутбук (робота)', powerW: 60, priority: 4, from: '09:00', to: '18:00' },
  ],
  appliances: [
    { id: 'washer', name: 'Пральна машина', powerW: 500, durationMin: 90, earliest: '07:00', latest: '23:00', priority: 3, preferredStart: '19:00', allowOnBattery: true },
    { id: 'boiler', name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '05:00', latest: '22:00', priority: 4, preferredStart: '06:30', allowOnBattery: false },
    { id: 'dishwasher', name: 'Посудомийка', powerW: 1200, durationMin: 120, earliest: '12:00', latest: '24:00', priority: 2, preferredStart: '20:00', allowOnBattery: false },
    { id: 'oven', name: 'Духовка (вечеря)', powerW: 2200, durationMin: 45, earliest: '16:00', latest: '20:30', priority: 4, preferredStart: '18:30', allowOnBattery: false },
    { id: 'kettle', name: 'Чайник (сніданок)', powerW: 1800, durationMin: 15, earliest: '07:00', latest: '09:30', priority: 3, preferredStart: '08:15', allowOnBattery: true },
  ],
};

export default demoHousehold;

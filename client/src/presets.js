// Довідники типових значень, щоб користувачеві не доводилося шукати потужність і тривалість самому.
// Значення орієнтовні: для приладів це типові побутові моделі, для станцій це паспортні дані виробника.

// Прилади, час роботи яких можна зсунути.
export const appliancePresets = [
  { name: 'Пральна машина', powerW: 500, durationMin: 90, earliest: '07:00', latest: '23:00', priority: 3, allowOnBattery: true },
  { name: 'Сушильна машина', powerW: 2000, durationMin: 90, earliest: '07:00', latest: '23:00', priority: 2, allowOnBattery: false },
  { name: 'Посудомийна машина', powerW: 1200, durationMin: 120, earliest: '07:00', latest: '24:00', priority: 2, allowOnBattery: false },
  { name: 'Бойлер', powerW: 2000, durationMin: 60, earliest: '05:00', latest: '22:00', priority: 4, allowOnBattery: false },
  { name: 'Електрочайник', powerW: 1800, durationMin: 15, earliest: '07:00', latest: '09:30', priority: 3, allowOnBattery: true },
  { name: 'Духовка', powerW: 2200, durationMin: 45, earliest: '16:00', latest: '20:30', priority: 4, allowOnBattery: false },
  { name: 'Мультиварка', powerW: 700, durationMin: 60, earliest: '16:00', latest: '20:00', priority: 3, allowOnBattery: true },
  { name: 'Мікрохвильова піч', powerW: 1000, durationMin: 15, earliest: '12:00', latest: '14:00', priority: 3, allowOnBattery: true },
  { name: 'Хлібопічка', powerW: 600, durationMin: 180, earliest: '00:00', latest: '08:00', priority: 2, allowOnBattery: true },
  { name: 'Праска', powerW: 2000, durationMin: 30, earliest: '08:00', latest: '22:00', priority: 2, allowOnBattery: false },
  { name: 'Пилосос', powerW: 1400, durationMin: 30, earliest: '09:00', latest: '21:00', priority: 2, allowOnBattery: true },
  { name: 'Обігрівач', powerW: 1500, durationMin: 120, earliest: '18:00', latest: '24:00', priority: 3, allowOnBattery: false },
  { name: 'Кондиціонер', powerW: 1000, durationMin: 120, earliest: '12:00', latest: '18:00', priority: 2, allowOnBattery: false },
  { name: 'Заряджання електросамоката', powerW: 300, durationMin: 240, earliest: '00:00', latest: '24:00', priority: 2, allowOnBattery: false },
  { name: 'Заряджання павербанків і телефонів', powerW: 60, durationMin: 120, earliest: '00:00', latest: '24:00', priority: 4, allowOnBattery: false },
];

// Постійні навантаження; без from/to означає «працює цілодобово».
export const baseLoadPresets = [
  { name: 'Холодильник', powerW: 60, priority: 5 },
  { name: 'Морозильна камера', powerW: 80, priority: 5 },
  { name: 'Роутер і ONT', powerW: 20, priority: 4 },
  { name: 'Насос газового котла', powerW: 100, priority: 5 },
  { name: 'Сигналізація і камери', powerW: 15, priority: 4 },
  { name: 'Освітлення (LED)', powerW: 40, priority: 3, from: '17:00', to: '23:30' },
  { name: 'Ноутбук', powerW: 60, priority: 4, from: '09:00', to: '18:00' },
  { name: 'Стаціонарний комп’ютер', powerW: 250, priority: 3, from: '09:00', to: '18:00' },
  { name: 'Телевізор', powerW: 100, priority: 2, from: '19:00', to: '23:00' },
];

// Зарядні станції: ємність, номінальна потужність інвертора і потужність заряджання від мережі.
export const stationPresets = [
  { name: 'EcoFlow RIVER 2', capacityWh: 256, inverterMaxW: 300, maxChargeW: 360 },
  { name: 'EcoFlow RIVER 2 Max', capacityWh: 512, inverterMaxW: 500, maxChargeW: 660 },
  { name: 'EcoFlow RIVER 2 Pro', capacityWh: 768, inverterMaxW: 800, maxChargeW: 940 },
  { name: 'EcoFlow DELTA 2', capacityWh: 1024, inverterMaxW: 1800, maxChargeW: 1200 },
  { name: 'EcoFlow DELTA 2 Max', capacityWh: 2048, inverterMaxW: 2400, maxChargeW: 1800 },
  { name: 'Bluetti EB3A', capacityWh: 268, inverterMaxW: 600, maxChargeW: 350 },
  { name: 'Bluetti AC180', capacityWh: 1152, inverterMaxW: 1800, maxChargeW: 1440 },
  { name: 'Bluetti AC200MAX', capacityWh: 2048, inverterMaxW: 2200, maxChargeW: 500 },
  { name: 'Jackery Explorer 1000 Plus', capacityWh: 1264, inverterMaxW: 2000, maxChargeW: 1800 },
  { name: 'Anker SOLIX C1000', capacityWh: 1056, inverterMaxW: 1800, maxChargeW: 1300 },
];

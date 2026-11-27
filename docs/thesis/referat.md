# РЕФЕРАТ

==Прізвище Ім'я По батькові==. Метод і веб-сервіс планування енергоспоживання домогосподарства в умовах невизначеності графіків відключень електроенергії: кваліфікаційна робота магістра: спец. F3 «Комп'ютерні науки» / наук. керівник ==науковий ступінь, Прізвище І. Б.== Національний транспортний університет, кафедра інформаційних систем і технологій. Київ, 2026. {сторінок} с.

Робота присвячена плануванню роботи побутових приладів і резервних джерел живлення домогосподарства, коли графік відключень електроенергії відомий неточно і змінюється протягом доби. Проаналізовано відключення в Україні, методи планування енергоспоживання і програмні засоби-аналоги. Побудовано модель доби домогосподарства із зарядною станцією, генератором і сонячними панелями, у якій якість плану обчислюється імітацією. Запропоновано метод стійкого планування: план оцінюється на множині ймовірнісних сценаріїв графіка за сумою середнього штрафу і умовної вартості під ризиком, шукається генетичним алгоритмом і перебудовується з поточного стану після зміни графіка. Розроблено веб-сервіс (React, Node.js, PostgreSQL), який завантажує графік з «YASNO», рахує план у браузері і показує для кожного приладу, чи можна вмикати його зараз. Експерименти показали, що стійкий план зменшує середній штраф порівняно з жадібним і звичайним генетичним алгоритмами в усіх 12 конфігураціях, а для демонстраційної квартири ймовірність того, що прилад не відпрацює, зменшується з 76,2 до 7,0 %. За зібраними даними «YASNO», у Києві після публікації змінюється 44 % графіків.

Кваліфікаційна робота включає розрахунково-пояснювальну записку, яка виконана на {сторінок} аркушах. Розрахунково-пояснювальна записка складається з трьох основних розділів та містить {таблиць}, {рисунків} і {формул}, кількість посилань у переліку джерел посилання – {джерел}.

Ключові слова: планування енергоспоживання, домогосподарство, графік відключень електроенергії, невизначеність, стійке планування, CVaR, генетичний алгоритм, резервне живлення, веб-сервіс.

# ABSTRACT

==Surname Name Patronymic==. Method and web service for household energy consumption planning under uncertain power outage schedules: master's qualification work: specialty F3 "Computer Science" / supervisor ==degree, Surname I. B.== National Transport University, Department of Information Systems and Technologies. Kyiv, 2026. {pages} p.

The work deals with planning the operation of household appliances and backup power sources when the power outage schedule is known inaccurately and changes during the day. Power outages in Ukraine, energy consumption planning methods and similar software are analysed. A model of a household day with a power station, a generator and solar panels is built, in which the quality of a plan is computed by simulation. A robust planning method is proposed: a plan is evaluated on a set of probabilistic schedule scenarios by the sum of the mean penalty and the conditional value at risk, searched for by a genetic algorithm and rebuilt from the current state after the schedule changes. A web service (React, Node.js, PostgreSQL) is developed. It loads the schedule from YASNO, computes the plan in the browser and shows for each appliance whether it can be switched on now. Experiments showed that the robust plan reduces the mean penalty compared with the greedy and the plain genetic algorithms in all 12 configurations, and for the demo flat the probability that an appliance does not finish its cycle drops from 76.2 to 7.0 %. According to the collected YASNO data, 44 % of Kyiv schedules change after publication.

The qualification work includes an explanatory note of {pages} pages. The explanatory note consists of three main chapters and contains {tables_en}, {figures_en} and {formulas_en}; the list of references includes {sources} sources.

Keywords: energy consumption planning, household, power outage schedule, uncertainty, robust planning, CVaR, genetic algorithm, backup power, web service.

# СПИСОК УМОВНИХ СКОРОЧЕНЬ

CVaR – Conditional Value at Risk, умовна вартість під ризиком

JSON – JavaScript Object Notation, текстовий формат обміну даними

MILP – Mixed-Integer Linear Programming, змішане цілочисельне лінійне програмування

ГА – генетичний алгоритм

ККД – коефіцієнт корисної дії

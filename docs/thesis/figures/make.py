"""Будує рисунки розділу 2 у docs/thesis/figures/*.png.

Запуск з кореня репозиторію:
    python3 docs/thesis/figures/make.py

Дані для графіків (сценарії, робота генератора) рахує ядро: node docs/thesis/figures/data.mjs.
"""
import json
import subprocess
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
plt.rcParams.update({'font.family': 'Liberation Serif', 'font.size': 12})
DPI = 200


def save(fig, name):
    fig.savefig(HERE / name, dpi=DPI, bbox_inches='tight', facecolor='white')
    plt.close(fig)


# ---------- схеми з блоків ----------

def box(ax, x, y, w, h, text, fill='white', size=11, bold=False):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle='round,pad=0.02,rounding_size=0.08',
                                fc=fill, ec='black', lw=1))
    ax.text(x, y, text, ha='center', va='center', fontsize=size, fontweight='bold' if bold else 'normal', wrap=True)


def diamond(ax, x, y, w, h, text, size=11):
    ax.add_patch(Polygon([(x, y + h / 2), (x + w / 2, y), (x, y - h / 2), (x - w / 2, y)], closed=True, fc='white', ec='black', lw=1))
    ax.text(x, y, text, ha='center', va='center', fontsize=size)


def oval(ax, x, y, w, h, text):
    ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle=f'round,pad=0,rounding_size={h / 2}', fc='white', ec='black', lw=1))
    ax.text(x, y, text, ha='center', va='center', fontsize=12)


def arrow(ax, points, label=None, label_at=None):
    xs, ys = zip(*points)
    ax.plot(xs[:-1] + (xs[-1],), ys[:-1] + (ys[-1],), color='black', lw=1)
    ax.annotate('', xy=points[-1], xytext=points[-2], arrowprops=dict(arrowstyle='-|>', color='black', lw=1, mutation_scale=12))
    if label:
        ax.text(*label_at, label, fontsize=12, ha='center', va='center', bbox=dict(fc='white', ec='none', pad=1))


def canvas(w, h):
    fig, ax = plt.subplots(figsize=(w, h))
    ax.set_xlim(0, w)
    ax.set_ylim(0, h)
    ax.axis('off')
    return fig, ax


def method_scheme():
    fig, ax = canvas(7.2, 9.6)
    x, w = 3.2, 5.0
    steps = [
        (9.0, 'Вхідні дані: прилади, постійні навантаження,\nджерела живлення, опублікований графік\nвідключень, прогноз сонячної генерації'),
        (7.85, 'Побудова моделі доби з моменту τ\n(слоти, домени генів, початковий стан джерел)'),
        (6.7, 'Генерація N навчальних сценаріїв\nфактичного графіка відключень'),
        (5.45, 'Генетичний алгоритм: пошук плану s* за критерієм\nF(s); кожен план оцінюється імітацією доби\nна N сценаріях'),
        (4.2, 'План: час запуску приладів і поріг увімкнення\nгенератора; перевірка на тестових сценаріях'),
        (3.05, 'Відстеження графіка (кожні 10 хв)\nі повідомлень про фактичний стан мережі'),
    ]
    for k, (y, t) in enumerate(steps):
        box(ax, x, y, w, 1.0 if t.count('\n') == 2 else 0.8, t, size=12)
    half = lambda t: 0.5 if t.count('\n') == 2 else 0.4
    for (y1, t1), (y2, t2) in zip(steps, steps[1:]):
        arrow(ax, [(x, y1 - half(t1)), (x, y2 + half(t2))])
    diamond(ax, x, 1.7, 3.0, 1.0, 'Графік або стан\nзмінився?', size=12)
    arrow(ax, [(x, 2.65), (x, 2.2)])
    box(ax, x, 0.45, w, 0.7, 'Фіксація стану на момент τ: увімкнені прилади,\nзаряд станції, рівень пального', size=12)
    arrow(ax, [(x, 1.2), (x, 0.8)], 'так', (x + 0.25, 1.0))
    # «так»: повернення до побудови моделі
    arrow(ax, [(x + w / 2, 0.45), (6.95, 0.45), (6.95, 7.85), (x + w / 2, 7.85)])
    # «ні»: продовжувати відстеження
    arrow(ax, [(x - 1.5, 1.7), (0.35, 1.7), (0.35, 3.05), (x - w / 2, 3.05)], 'ні', (0.6, 1.95))
    save(fig, 'ris-2-1.png')


def ga_scheme():
    fig, ax = canvas(7.0, 10.2)
    x, w = 3.1, 4.2
    oval(ax, x, 9.85, 1.6, 0.5, 'Початок')
    box(ax, x, 8.9, w, 0.8, 'Початкова популяція (40 хромосом):\nплан без планування, жадібний\nплан, випадкові плани', size=12)
    box(ax, x, 7.65, w, 0.8, 'Обчислення F(s) для кожної\nхромосоми (з кешем оцінених планів)', size=12)
    diamond(ax, x, 6.35, 3.6, 1.2, '120 поколінь або 30\nбез покращення?', size=12)
    box(ax, x, 5.0, w, 0.7, 'Елітизм: 2 найкращі\nпереходять без змін', size=12)
    box(ax, x, 3.95, w, 0.7, 'Турнірний відбір батьків (k = 3)', size=12)
    box(ax, x, 2.9, w, 0.7, 'Рівномірне схрещування\n(ймовірність 0,9)', size=12)
    box(ax, x, 1.85, w, 0.7, 'Мутація генів (ймовірність 1/n)', size=12)
    diamond(ax, x, 0.75, 3.0, 1.0, 'Популяцію\nзаповнено?', size=12)
    arrow(ax, [(x, 9.6), (x, 9.3)])
    arrow(ax, [(x, 8.5), (x, 8.05)])
    arrow(ax, [(x, 7.25), (x, 6.95)])
    arrow(ax, [(x, 5.75), (x, 5.35)], 'ні', (x + 0.25, 5.55))
    for y1, y2 in [(4.65, 4.3), (3.6, 3.25), (2.55, 2.2), (1.5, 1.25)]:
        arrow(ax, [(x, y1), (x, y2)])
    # ні: наступна дитина
    arrow(ax, [(x - 1.5, 0.75), (0.6, 0.75), (0.6, 3.95), (x - w / 2, 3.95)], 'ні', (0.85, 1.0))
    # так: нове покоління оцінюється
    arrow(ax, [(x, 0.25), (x, 0.08), (0.2, 0.08), (0.2, 7.65), (x - w / 2, 7.65)], 'так', (x + 0.3, 0.17))
    # вихід
    box(ax, 6.1, 5.0, 1.5, 0.7, 'Найкращий\nплан s*', size=12)
    oval(ax, 6.1, 3.95, 1.2, 0.45, 'Кінець')
    arrow(ax, [(x + 1.8, 6.35), (6.1, 6.35), (6.1, 5.35)], 'так', (5.4, 6.6))
    arrow(ax, [(6.1, 4.65), (6.1, 4.18)])
    save(fig, 'ris-2-4.png')


def service_scheme():
    fig, ax = canvas(9.6, 6.4)
    ax.set_ylim(-0.45, 6.4)
    grey = '#ececec'
    for cx, title in [(1.75, 'Браузер користувача'), (5.15, 'Сервер'), (8.45, 'Зовнішні сервіси')]:
        ax.text(cx, 6.15, title, ha='center', va='center', fontsize=15, fontweight='bold')
    ax.add_patch(FancyBboxPatch((0.1, 0.15), 3.3, 5.7, boxstyle='round,pad=0,rounding_size=0.1', fc=grey, ec='black', lw=0.8, ls='--'))
    ax.add_patch(FancyBboxPatch((3.7, 0.15), 2.9, 5.7, boxstyle='round,pad=0,rounding_size=0.1', fc=grey, ec='black', lw=0.8, ls='--'))
    box(ax, 1.75, 4.95, 3.0, 1.3, 'Інтерфейс (React):\n«Сьогодні», «Мій дім»,\n«Резервне живлення»,\n«Детально» та ін.', size=13.5)
    box(ax, 1.75, 3.45, 3.0, 1.0, 'Модуль перепланування:\nстан на момент τ,\nопитування графіка', size=13.5)
    box(ax, 1.75, 2.1, 3.0, 0.9, 'Калькулятор\nавтономності (ядро)', size=13.5)
    box(ax, 1.75, 0.8, 3.0, 1.0, 'Сховище браузера:\nдані дому, план,\nспостереження', size=13.5)
    box(ax, 5.15, 4.95, 2.6, 1.3, 'REST API (Express):\nплан, графіки,\nкалендар, облікові\nзаписи, кабінет', size=13.5)
    box(ax, 5.15, 3.0, 2.6, 1.6, 'Ядро планування:\nмодель доби,\nімітація, сценарії,\nкритерій стійкості,\nгенетичний алгоритм', size=13.5)
    box(ax, 5.15, 1.0, 2.6, 1.0, 'База даних\nPostgreSQL', size=13.5)
    box(ax, 8.45, 5.35, 2.1, 0.8, 'API графіків\n«YASNO»', size=13.5)
    box(ax, 8.45, 4.3, 2.1, 0.8, 'Календарні\nзастосунки', size=13.5)
    box(ax, 8.45, 1.0, 2.1, 0.9, 'Прогноз погоди\n«Open-Meteo»', size=13.5)

    def both(p1, p2):
        ax.annotate('', xy=p2, xytext=p1, arrowprops=dict(arrowstyle='<|-|>', color='black', lw=1, mutation_scale=11))

    both((3.25, 4.95), (3.85, 4.95))
    ax.text(3.55, 5.12, 'JSON', ha='center', fontsize=11)
    both((1.75, 4.3), (1.75, 3.95))
    both((1.75, 2.95), (1.75, 2.55))
    both((1.75, 1.65), (1.75, 1.3))
    both((5.15, 4.3), (5.15, 3.8))
    both((5.15, 2.2), (5.15, 1.5))
    both((6.45, 5.35), (7.4, 5.35))
    arrow(ax, [(7.4, 4.45), (6.45, 4.45)])
    ax.text(6.92, 4.6, '.ics', ha='center', fontsize=12)
    # браузер сам запитує прогноз сонячної радіації
    arrow(ax, [(1.75, 0.15), (1.75, -0.25), (8.45, -0.25), (8.45, 0.55)])
    ax.text(5.15, -0.1, 'прогноз сонячної радіації', ha='center', fontsize=12)
    save(fig, 'ris-2-5.png')


# ---------- графіки з даних ядра ----------

def hours_axis(ax):
    ax.set_xlim(0, 24)
    ax.set_xticks(range(0, 25, 2))
    ax.set_xlabel('Час доби, год')


def scenarios_figure(data):
    rows = [('Опублікований\nграфік', data['planned'])] + [(f'Сценарій {k + 1}', s) for k, s in enumerate(data['scenarios'])]
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    for r, (_, grid) in enumerate(rows):
        y = len(rows) - 1 - r
        for t, g in enumerate(grid):
            if g == 0:
                ax.add_patch(plt.Rectangle((t / 4, y + 0.15), 0.25, 0.7, fc='#333333' if r == 0 else '#888888', ec='none'))
        ax.add_patch(plt.Rectangle((0, y + 0.15), 24, 0.7, fc='none', ec='black', lw=0.6))
    for h in range(0, 25, 2):
        ax.axvline(h, color='#bbbbbb', lw=0.4, zorder=0)
    ax.set_ylim(0, len(rows))
    ax.set_yticks([len(rows) - 1 - r + 0.5 for r in range(len(rows))])
    ax.set_yticklabels([name for name, _ in rows], fontsize=11)
    ax.tick_params(axis='y', length=0)
    hours_axis(ax)
    for side in ('top', 'right', 'left'):
        ax.spines[side].set_visible(False)
    save(fig, 'ris-2-3.png')


def generator_figure(data):
    g = data['generator']
    soc = [t['socPct'] for t in g['trace']]
    x = [(t + 1) / 4 for t in range(len(soc))]   # заряд наприкінці слоту
    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    first = True
    for t, on in enumerate(g['grid']):
        if on == 0:
            ax.axvspan(t / 4, (t + 1) / 4, color='#e3e3e3', lw=0, label='Відключення за графіком' if first else None)
            first = False
    first = True
    for t, tr in enumerate(g['trace']):
        if tr['generatorW'] > 0:
            ax.axvspan(t / 4, (t + 1) / 4, color='#9a9a9a', lw=0, label='Генератор працює' if first else None)
            first = False
    ax.plot([0] + x, [g['initialSocPct']] + soc, color='black', lw=1.6, label='Заряд станції')
    th = g['threshold']
    ax.axhline(th, color='black', ls='--', lw=0.9)
    ax.axhline(th + 30, color='black', ls=':', lw=0.9)
    ax.text(0.3, th + 1.5, f'поріг θ = {th} %', fontsize=10)
    ax.text(0.3, th + 31.5, f'θ + 30 % = {th + 30} %', fontsize=10)
    ax.set_ylim(0, 105)
    ax.set_ylabel('Заряд станції, %')
    hours_axis(ax)
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.2), ncol=3, fontsize=10, frameon=False)
    save(fig, 'ris-2-2.png')


def main():
    data = json.loads(subprocess.run(['node', str(HERE / 'data.mjs')], cwd=ROOT, check=True, capture_output=True, text=True).stdout)
    method_scheme()
    scenarios_figure(data)
    generator_figure(data)
    ga_scheme()
    service_scheme()
    print('Рисунки збережено в', HERE)


if __name__ == '__main__':
    main()

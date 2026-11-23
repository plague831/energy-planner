"""Збирає повну пояснювальну записку на шаблоні кафедри КРМ 2026.

Використання (з каталогу docs/thesis):
    python3 zapyska.py <шаблон.dotx> <вихід.docx>

Титульний аркуш, завдання і календарний план беруться з шаблону. У них заповнюються тема,
мета, завдання і перелік слайдів, а реферат, ABSTRACT і список скорочень – з referat.md.
Далі йдуть вступ, розділи 1–3, висновки, перелік джерел і додатки (dodatky.md).
Те, що автор має вписати сам (ПІБ, керівник, апробація), виділено жовтим.

Якщо встановлено LibreOffice, скрипт збирає записку двічі: після першого разу рахує сторінки
і знаходить сторінки заголовків, щоб заповнити реферат і зміст, і поруч зберігає PDF.
Word після відкриття запропонує оновити поля – зміст тоді перебудується за його розміткою.
"""
import copy
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from docx.oxml import OxmlElement
from docx.oxml.ns import qn

import build as B

HERE = Path(__file__).resolve().parent
THEME = ('Метод і веб-сервіс планування енергоспоживання домогосподарства '
         'в умовах невизначеності графіків відключень електроенергії')
BODY = ['vstup.md', 'rozdil-1.md', 'rozdil-2.md', 'rozdil-3.md', 'vysnovky.md']
APPENDICES = 'dodatky.md'

# Пункт 5 завдання: перелік слайдів презентації.
SLIDES = [
    'Тема, виконавець і керівник роботи',
    'Актуальність: відключення і зміни графіків «YASNO»',
    "Мета, об'єкт, предмет і завдання дослідження",
    'Аналіз програмних засобів-аналогів',
    'Математична модель доби домогосподарства (основні формули)',
    'Модель невизначеності графіка відключень',
    'Критерій стійкості плану і генетичний алгоритм',
    'Перебудова плану протягом доби',
    'Архітектура веб-сервісу',
    'Інтерфейс веб-сервісу',
    'Порівняння методів планування',
    "Перевірка точним розв'язком і аналіз чутливості",
    'Наукова новизна і практичне значення',
    'Висновки',
]

XML_SPACE = '{http://www.w3.org/XML/1998/namespace}space'


def uk(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return f'{n} {one}'
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return f'{n} {few}'
    return f'{n} {many}'


def en(n, word):
    return f'{n} {word}' + ('' if n == 1 else 's')


def values_for(stats, pages):
    words = {1: 'одного додатка', 2: 'двох додатків', 3: 'трьох додатків', 4: 'чотирьох додатків'}
    return {
        'сторінок': str(pages), 'pages': str(pages),
        'таблиць': uk(stats['tables'], 'таблицю', 'таблиці', 'таблиць'),
        'рисунків': uk(stats['figures'], 'рисунок', 'рисунки', 'рисунків'),
        'формул': uk(stats['formulas'], 'формулу', 'формули', 'формул'),
        'джерел': str(stats['sources']), 'sources': str(stats['sources']),
        'додатків_слово': words.get(stats['appendices'], f'{stats["appendices"]} додатків'),
        'tables_en': en(stats['tables'], 'table'),
        'figures_en': en(stats['figures'], 'figure'),
        'formulas_en': en(stats['formulas'], 'formula'),
    }


# ---------- робота з абзацами шаблону ----------

def find(doc, start, after=None):
    """Перший абзац, текст якого починається з start (після абзацу after, якщо задано)."""
    seen = after is None
    for p in doc.paragraphs:
        if not seen:
            seen = p._p is after._p
            continue
        if p.text.strip().startswith(start):
            return p
    sys.exit(f'У шаблоні не знайдено абзац «{start}»')


def page_break_runs(p):
    return [r for r in p._p.findall(qn('w:r')) if r.find(qn('w:br')) is not None
            and r.find(qn('w:br')).get(qn('w:type')) == 'page']


def set_text(p, text):
    """Замінює текст абзацу, зберігаючи його оформлення і розрив сторінки в кінці."""
    breaks = page_break_runs(p)
    for child in list(p._p):
        if child.tag in (qn('w:r'), qn('w:hyperlink'), qn('w:proofErr'), qn('w:bookmarkStart'),
                         qn('w:bookmarkEnd')):
            p._p.remove(child)
    B.add_runs(p, text)
    for r in breaks:
        p._p.append(r)
    # знак абзацу в шаблоні буває виділений жовтим, тоді жовтим стає й номер пункту списку
    ppr = p._p.pPr
    if ppr is not None and ppr.find(qn('w:rPr')) is not None:
        for h in ppr.find(qn('w:rPr')).findall(qn('w:highlight')):
            h.getparent().remove(h)


def clone_before(p, text):
    """Новий абзац з тим самим оформленням (і нумерацією списку) перед p."""
    q = copy.deepcopy(p._p)
    for r in page_break_runs_el(q):
        q.remove(r)
    p._p.addprevious(q)
    from docx.text.paragraph import Paragraph
    para = Paragraph(q, p._parent)
    set_text(para, text)
    return para


def page_break_runs_el(el):
    return [r for r in el.findall(qn('w:r')) if r.find(qn('w:br')) is not None
            and r.find(qn('w:br')).get(qn('w:type')) == 'page']


def fill_list(first, rest, items):
    """Список у завданні: перший абзац-зразок отримує останній пункт, решта вставляються перед ним."""
    for item in items[:-1]:
        clone_before(first, item)
    set_text(first, items[-1])
    for p in rest:
        p._p.getparent().remove(p._p)


def sections(path):
    """Розділи файлу за заголовками «# НАЗВА»: {назва: [абзаци]}."""
    out, cur = {}, None
    for line in Path(path).read_text(encoding='utf8').splitlines():
        if line.startswith('# '):
            cur = out.setdefault(line[2:].strip(), [])
        elif line.strip() and cur is not None:
            cur.append(line.strip())
    return out


def intro_facts():
    text = (HERE / 'vstup.md').read_text(encoding='utf8')
    aim = re.search(r'^\*\*Мета роботи\*\* – (.+)$', text, re.M).group(1)
    tasks = [m.group(1) for m in re.finditer(r'^\d\) (.+)$', text, re.M)]
    tasks = [t[0].upper() + t[1:] for t in tasks]
    return aim[0].upper() + aim[1:], tasks


def substitute(text, values):
    for key, value in values.items():
        text = text.replace('{' + key + '}', value)
    return text


def fill_front(doc, values):
    aim, tasks = intro_facts()
    title = find(doc, '«……')
    title.runs[0].text = f'«{THEME}»'
    for r in title.runs[1:]:
        r._r.getparent().remove(r._r)
    # тема займає два рядки замість одного, тому прибирається один порожній рядок під нею,
    # інакше «Київ 2026» переходить на другу сторінку
    blank = title._p.getnext()
    if blank is not None and not ''.join(t.text or '' for t in blank.iter(qn('w:t'))).strip():
        blank.getparent().remove(blank)

    p = find(doc, '«%тут пишемо вашу тему')
    run = p.runs[0]
    run.text = f'«{THEME}»,'
    run.font.highlight_color = None
    for r in p.runs:
        if '???' in r.text:
            r.font.highlight_color = B.WD_COLOR_INDEX.YELLOW
    for r in find(doc, 'студента').runs:
        if '?' in r.text:
            r.font.highlight_color = B.WD_COLOR_INDEX.YELLOW

    set_text(find(doc, 'Тут пишемо мету роботи'), f'Мета роботи – {aim}')
    first = find(doc, 'Тут перелічуємо завдання')
    fill_list(first, [find(doc, '…', after=first)], tasks)
    first = find(doc, 'Тут перелічуємо назви слайдів')
    fill_list(first, [find(doc, '…', after=first)], SLIDES)

    parts = sections(HERE / 'referat.md')
    ref = [substitute(t, values) for t in parts['РЕФЕРАТ']]
    head = find(doc, 'РЕФЕРАТ')
    targets = [find(doc, 'Гоцуляк', head), find(doc, 'У роботі проаналізовано', head),
               find(doc, 'Кваліфікаційна робота включає', head), find(doc, 'Ключові слова', head)]
    for p, text in zip(targets, ref):
        set_text(p, text)

    abstract = [substitute(t, values) for t in parts['ABSTRACT']]
    last = find(doc, 'Переклад РЕФЕРАТА')
    # ABSTRACT оформлюється так само, як реферат (відступ, інтервал, вирівнювання)
    sample = targets[1]._p.pPr
    if sample is not None:
        if last._p.pPr is not None:
            last._p.remove(last._p.pPr)
        last._p.insert(0, copy.deepcopy(sample))
    for text in abstract[:-1]:
        clone_before(last, text)
    set_text(last, abstract[-1])

    head = find(doc, 'СПИСОК УМОВНИХ СКОРОЧЕНЬ')
    old = []
    for p in doc.paragraphs[[q._p for q in doc.paragraphs].index(head._p) + 1:]:
        if p.text.strip() == 'ЗМІСТ':
            break
        if ' – ' in p.text:
            old.append(p)
    fill_list(old[0], old[1:], parts['СПИСОК УМОВНИХ СКОРОЧЕНЬ'])


def cut_template_body(doc):
    """Прибирає зразковий текст шаблону, починаючи із заголовка «ВСТУП»."""
    body = doc.element.body
    start = next(p._p for p in doc.paragraphs if p.style.name == 'Heading 1' and p.text.strip() == 'ВСТУП')
    remove = False
    for child in list(body):
        if child is start:
            remove = True
        if remove and child.tag != qn('w:sectPr'):
            body.remove(child)


# ---------- зміст ----------

def el(tag, **attrs):
    e = OxmlElement(tag)
    for k, v in attrs.items():
        e.set(qn(k), v)
    return e


def run_with(*children):
    r = el('w:r')
    rpr = el('w:rPr')
    rpr.append(el('w:noProof'))
    r.append(rpr)
    for c in children:
        r.append(c)
    return r


def text_el(text):
    t = el('w:t')
    t.text = text
    t.set(XML_SPACE, 'preserve')
    return t


def fill_toc(doc, headings, pages):
    sdt = doc.element.body.find(qn('w:sdt'))
    content = sdt.find(qn('w:sdtContent'))
    keep = content.find(qn('w:p'))           # порожній абзац «Заголовок змісту» на початку
    for child in list(content):
        if child is not keep:
            content.remove(child)
    for k, (level, text) in enumerate(headings):
        p = el('w:p')
        ppr = el('w:pPr')
        ppr.append(el('w:pStyle', **{'w:val': '12' if level == 1 else '21'}))
        tabs = el('w:tabs')
        tabs.append(el('w:tab', **{'w:val': 'right', 'w:leader': 'dot', 'w:pos': '9629'}))
        ppr.append(tabs)
        p.append(ppr)
        if k == 0:
            p.append(run_with(el('w:fldChar', **{'w:fldCharType': 'begin'})))
            instr = el('w:instrText')
            instr.text = ' TOC \\o "1-3" \\h \\z \\u '
            instr.set(XML_SPACE, 'preserve')
            p.append(run_with(instr))
            p.append(run_with(el('w:fldChar', **{'w:fldCharType': 'separate'})))
        p.append(run_with(text_el(text)))
        p.append(run_with(el('w:tab')))
        p.append(run_with(text_el(str(pages.get(k, '')))))
        content.append(p)
    end = el('w:p')
    end.append(run_with(el('w:fldChar', **{'w:fldCharType': 'end'})))
    content.append(end)


def update_fields_on_open(doc):
    settings = doc.settings.element
    if settings.find(qn('w:updateFields')) is None:
        settings.append(el('w:updateFields', **{'w:val': 'true'}))


# ---------- збирання ----------

EMPTY = {'tables': 0, 'figures': 0, 'formulas': 0, 'sources': 0, 'appendices': 0}


def assemble(template, pages='000', toc_pages=None, known=EMPTY):
    """Одне збирання. known – кількості з попереднього проходу для вступу, який іде раніше за розділи."""
    doc = B.open_template(template, keep=True)
    cut_template_body(doc)
    w = B.Writer(doc, B.load_sources(HERE / 'dzherela.md'))
    w.first = False
    w.values = values_for(known, pages)
    for name in BODY:
        w.render(HERE / name)
    listed = w.source_list()
    w.render(HERE / APPENDICES)
    stats = {
        'tables': sum(c.startswith('Таблиця') for c in w.captions),
        'figures': sum(c.startswith('Рисунок') for c in w.captions),
        'formulas': w.formulas,
        'sources': len(listed),
        'appendices': sum(t.startswith('Додаток') for _, t in w.headings),
    }
    fill_front(doc, values_for(stats, pages))
    fill_toc(doc, w.headings, toc_pages or {})
    update_fields_on_open(doc)
    return doc, w, stats


def to_pdf(docx, outdir):
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', str(outdir), str(docx)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Path(outdir) / (Path(docx).stem + '.pdf')


def norm(s):
    return re.sub(r'\s+', ' ', s.replace('­', '')).strip()


def heading_pages(pdf, headings):
    """Номери сторінок заголовків за текстом PDF (номер сторінки = її порядковий номер)."""
    text = subprocess.run(['pdftotext', str(pdf), '-'], check=True, capture_output=True,
                          text=True).stdout
    pages = [[norm(line) for line in page.splitlines() if norm(line)] for page in text.split('\f')]
    zmist = next(i for i, pg in enumerate(pages) if 'ЗМІСТ' in pg)
    start = next(i for i in range(zmist + 1, len(pages))
                 if [l for l in pages[i] if not l.isdigit()][:1] == ['ВСТУП'])
    found, i = {}, start
    for k, (_, title) in enumerate(headings):
        t = norm(title)
        while i < len(pages):
            if t in ' '.join(pages[i]):
                found[k] = i + 1
                break
            i += 1
        else:
            sys.exit(f'Не знайдено сторінку заголовка «{title}»')
    info = subprocess.run(['pdfinfo', str(pdf)], check=True, capture_output=True, text=True).stdout
    return found, int(re.search(r'^Pages:\s+(\d+)', info, re.M).group(1))


def main(template, out):
    out = Path(out)
    doc, w, stats = assemble(template)
    if not shutil.which('soffice') or not shutil.which('pdftotext'):
        doc.save(out)
        print(f'{out}: LibreOffice не знайдено, кількість сторінок і зміст оновить Word')
        w.check()
        return
    tmp = Path(tempfile.mkdtemp())
    doc.save(tmp / out.name)
    toc, pages = heading_pages(to_pdf(tmp / out.name, tmp), w.headings)
    for _ in range(2):   # другий прохід уточнює сторінки, якщо реферат або зміст змінили розкладку
        doc, w, stats = assemble(template, pages, toc, stats)
        doc.save(tmp / out.name)
        new_toc, new_pages = heading_pages(to_pdf(tmp / out.name, tmp), w.headings)
        if (new_toc, new_pages) == (toc, pages):
            break
        toc, pages = new_toc, new_pages
    shutil.copy(tmp / out.name, out)
    shutil.copy(tmp / (out.stem + '.pdf'), out.with_suffix('.pdf'))
    print(f'{out}: {pages} с., таблиць {stats["tables"]}, рисунків {stats["figures"]}, '
          f'формул {stats["formulas"]}, джерел {stats["sources"]}, додатків {stats["appendices"]}')
    w.check()


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])

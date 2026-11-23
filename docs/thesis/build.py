"""Збирає розділи пояснювальної записки в один .docx на стилях шаблону кафедри.

Використання:
    python3 build.py <шаблон.dotx> <джерела.md> <вихід.docx> <розділ-1.md> [<розділ-2.md> ...]

Посилання в тексті пишуться як [@ключ] або [@ключ1; @ключ2] і нумеруються
в порядку першої появи через усі розділи. Перелік джерел (лише ті, на які є
посилання) додається в кінець файлу.

Щоб зібрати один розділ з тією самою нумерацією джерел, що й у всій записці,
попередні розділи передаються з «+» на початку: вони лише нумерують джерела,
а у файл не потрапляють. Наприклад, тільки розділ 2:
    python3 build.py <шаблон.dotx> <джерела.md> <вихід.docx> +rozdil-1.md rozdil-2.md
Тоді в переліку лише джерела розділу 2, зі своїми номерами з усієї записки. Скрипт також перевіряє, що кожен рисунок
і кожна таблиця мають посилання в тексті, і показує джерела, на які посилань немає.

Рисунок: рядок ![Рисунок 2.1 – Назва](figures/ris-2-1.png), шлях відносно файлу розділу.
Ширину в міліметрах можна задати після шляху: ![Рисунок 3.6 – Назва](figures/ris-3-6.png){105}.
"""
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt
from PIL import Image, ImageFont

try:
    FONT = ImageFont.truetype('LiberationSerif-Regular.ttf', 100)
except OSError:
    FONT = None
try:
    import pyphen
    HYPHEN = pyphen.Pyphen(lang='uk_UA')
except ImportError:
    HYPHEN = None
SHY = '\u00ad'   # м'який перенос: Word показує дефіс, лише коли справді переносить слово
ZWSP = '\u200b'  # невидиме місце розриву рядка без дефіса

BODY = '0'          # «0» у шаблоні: основний текст з відступом 1,25 см
H1, H2 = 'Heading 1', 'Heading 2'
CAPTION_TABLE = 'Табл'  # стиль підпису таблиці в шаблоні КРМ 2026 (без відступу)
CAPTION_FIGURE = 'Рис'  # стиль рисунка і його підпису (по центру, без відступу)
CODE = 'Код'           # стиль лістингу в додатках (Courier New)
CODE_PT = 10
TABLE_PT = 12       # один розмір шрифту в усіх таблицях роботи, 12 пт (вимога керівника, 23.11.2026)
FIGURE_MM = 165
CELL_MARGIN_MM = 1.0
FIGURE_MAX_H_MM = 200


def open_template(path, keep=False):
    """python-docx не відкриває .dotx, тому міняємо тип головної частини.
    Без keep вміст шаблону прибирається і залишаються лише стилі та параметри сторінки."""
    tmp = Path(tempfile.mkdtemp()) / 'template.docx'
    with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as dst:
        for item in src.infolist():
            data = src.read(item.filename)
            if item.filename == '[Content_Types].xml':
                data = data.replace(
                    b'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
                    b'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
            dst.writestr(item, data)
    doc = Document(str(tmp))
    if keep:
        return doc
    body = doc.element.body
    for child in list(body):
        if child.tag != qn('w:sectPr'):
            body.remove(child)
    return doc


def load_sources(path):
    sources = {}
    for line in Path(path).read_text(encoding='utf8').splitlines():
        m = re.match(r'- (\w+): (.+)', line)
        if m:
            sources[m.group(1)] = m.group(2)
    return sources


def number_citations(text, order):
    def repl(m):
        nums = []
        for key in re.findall(r'@(\w+)', m.group(1)):
            if key not in order:
                order.append(key)
            nums.append(order.index(key) + 1)
        return '[' + compress(sorted(set(nums))) + ']'
    return re.sub(r'\[(@[^\]]+)\]', repl, text)


def compress(nums):
    """[3, 4, 5, 8] -> «3–5, 8»: три і більше номерів поспіль подаються діапазоном."""
    parts, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        if j - i >= 2:
            parts.append(f'{nums[i]}–{nums[j]}')
        else:
            parts.extend(str(n) for n in nums[i:j + 1])
        i = j + 1
    return ', '.join(parts)


INDEX = re.compile(r'([_^])(\{[^}]+\}|[A-Za-zα0-9]+)')


def add_runs(par, text, size=None, subscripts=True):
    """Підтримує **жирний**, *курсив*, нижні індекси CVaR_α, P_{ch}, верхні 10^{7}, `буквальний текст`
    (назви полів бази) і ==виділене жовтим== (місця, які автор має заповнити сам)."""
    for h, marked in enumerate(text.split('==')):
        for b, part in enumerate(re.split(r'\*\*(.+?)\*\*', marked)):
            start = len(par.runs)
            for k, chunk in enumerate(part.split('`')):
                if k % 2:
                    run = par.add_run(chunk)
                    if size:
                        run.font.size = Pt(size)
                else:
                    add_formatted(par, chunk, size, subscripts)
            for run in par.runs[start:]:
                if b % 2:
                    run.bold = True
                if h % 2:
                    run.font.highlight_color = WD_COLOR_INDEX.YELLOW


def add_formatted(par, text, size, subscripts):
    for i, part in enumerate(re.split(r'\*([^*]+)\*', text)):
        if not part:
            continue
        pieces, pos = [], 0
        for m in (INDEX.finditer(part) if subscripts else []):
            if m.group(1) == '^' and not m.group(2).startswith('{'):
                continue                      # верхній індекс лише у фігурних дужках
            pieces.append((part[pos:m.start()], None))
            pieces.append((m.group(2).strip('{}'), m.group(1)))
            pos = m.end()
        pieces.append((part[pos:], None))
        for piece, kind in pieces:
            if not piece:
                continue
            run = par.add_run(piece)
            run.italic = bool(i % 2) or None
            if kind == '_':
                run.font.subscript = True
            elif kind == '^':
                run.font.superscript = True
            if size:
                run.font.size = Pt(size)


def heading(doc, text, style, page_break=False):
    p = doc.add_paragraph(style=style)
    if page_break:
        p.paragraph_format.page_break_before = True
    p.paragraph_format.space_before = Pt(0 if page_break or style == H1 else 21)
    p.paragraph_format.space_after = Pt(21)
    p.paragraph_format.keep_with_next = True
    p.add_run(text)
    return p


def style_or_body(doc, name):
    """Стиль шаблону, якщо він є (у шаблоні 2026 року є «Табл» і «Рис»), інакше основний текст."""
    try:
        return doc.styles[name]
    except KeyError:
        return BODY


def caption_above(doc, text):
    # підпис таблиці над нею, по лівому краю без абзацного відступу (вимога керівника)
    p = doc.add_paragraph(style=style_or_body(doc, CAPTION_TABLE))
    p.paragraph_format.first_line_indent = 0
    p.paragraph_format.keep_with_next = True
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_runs(p, text)


def table(doc, rows):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = doc.styles['Table Grid']
    t.autofit = False
    # дуже довгу назву з бази (`calendar_subscriptions`) дозволяємо розривати після «_»
    rows = [[re.sub(r'`([^`]{17,})`', lambda m: '`' + m.group(1).replace('_', '_' + ZWSP) + '`', cell) for cell in row] for row in rows]
    # Ширина колонки пропорційна середній довжині тексту в ній, але не менша за найдовше слово,
    # щоб слова не розривалися; разом 170 мм (ширина тексту на сторінці).
    minimum = min_widths(rows)
    if sum(minimum) > 170:
        # широка таблиця не вміщається цілими словами: довгі слова дозволяємо переносити
        rows = [[' '.join(soft_hyphens(w) for w in cell.split(' ')) for cell in row] for row in rows]
        minimum = min_widths(rows)
    if sum(minimum) > 170:
        minimum = [m * 170 / sum(minimum) for m in minimum]
    weights = [max(sum(len(re.sub(f'[{SHY}{ZWSP}]', '', row[c])) for row in rows) / len(rows), 4) for c in range(len(rows[0]))]
    widths = [170 * w / sum(weights) for w in weights]
    for _ in range(len(widths)):
        narrow = [c for c, w in enumerate(widths) if w < minimum[c] - 1e-6]
        if not narrow:
            break
        fixed = set(c for c, w in enumerate(widths) if w <= minimum[c] + 1e-6) | set(narrow)
        rest = [c for c in range(len(widths)) if c not in fixed]
        for c in fixed:
            widths[c] = minimum[c]
        free = 170 - sum(widths[c] for c in fixed)
        for c in rest:
            widths[c] = free * weights[c] / sum(weights[k] for k in rest)
    margins(t)
    for c, col in enumerate(t.columns):
        col.width = Mm(widths[c])
        for cell in col.cells:
            cell.width = col.width
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            p = t.cell(r, c).paragraphs[0]
            p.style = doc.styles['Normal']
            p.paragraph_format.line_spacing = 1.0
            if r == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            # невелика таблиця не розривається між сторінками: рядки «тримаються» за наступні
            p.paragraph_format.keep_with_next = r < len(rows) - 1
            add_runs(p, cell, size=TABLE_PT)
            if r == 0:
                for run in p.runs:
                    run.bold = False
        cant_split = OxmlElement('w:cantSplit')
        t.rows[r]._tr.get_or_add_trPr().append(cant_split)
    # повторювати шапку на кожній сторінці
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    hdr = OxmlElement('w:tblHeader')
    hdr.set(qn('w:val'), 'true')
    tr_pr.append(hdr)
    doc.add_paragraph(style=BODY)


def min_widths(rows):
    """Найменша ширина кожної колонки, мм: найширший фрагмент слова між місцями переносу плюс поля."""
    out = []
    for c in range(len(rows[0])):
        pieces = []
        for row in rows:
            for word in re.split(f'[\\s{ZWSP}]+', re.sub(r'[`*{}^]', '', row[c])):
                parts = word.split(SHY)
                pieces += [p + '-' for p in parts[:-1]] + parts[-1:]
        out.append(word_mm(max(pieces, key=word_mm, default='')) + 2 * CELL_MARGIN_MM + 0.6)
    return out


def soft_hyphens(word):
    """Ставить м'які переноси в довге слово за правилами української мови (бібліотека pyphen)."""
    if HYPHEN is None or len(word) < 7 or re.search(r'[`*{}^_]', word):
        return word
    letters = [i for i, ch in enumerate(word) if ch.isalpha()]
    allowed = []
    for pos in HYPHEN.positions(word):
        left = sum(1 for i in letters if i < pos)
        if left < 2 or len(letters) - left < 3:
            continue
        if pos + 1 < len(word) and word[pos] == word[pos + 1]:
            continue    # подвоєні приголосні розділяються між собою: «ван-ня», а не «ва-ння»
        if allowed and pos - allowed[-1] == 1:
            continue    # не лишати одну приголосну між переносами: «від-клю», а не «відк-лю»
        allowed.append(pos)
    for pos in reversed(allowed):
        word = word[:pos] + SHY + word[pos:]
    return word


def word_mm(word):
    """Ширина слова шрифтом таблиці в мм (Liberation Serif метрично збігається з Times New Roman)."""
    if FONT is None:
        return len(word) * 2.1
    return FONT.getlength(word) / 100 * TABLE_PT * 25.4 / 72


def margins(t):
    """Поля комірок ліворуч і праворуч по CELL_MARGIN_MM замість стандартних 1,9 мм."""
    mar = OxmlElement('w:tblCellMar')
    for side in ('left', 'right'):
        el = OxmlElement(f'w:{side}')
        el.set(qn('w:w'), str(int(CELL_MARGIN_MM / 25.4 * 1440)))
        el.set(qn('w:type'), 'dxa')
        mar.append(el)
    t._tbl.tblPr.append(mar)


def formula(doc, text, number):
    p = doc.add_paragraph(style=BODY)
    p.paragraph_format.first_line_indent = 0
    pf = p.paragraph_format
    pf.tab_stops.add_tab_stop(Pt(240), alignment=1)   # центр
    pf.tab_stops.add_tab_stop(Pt(482), alignment=2)   # праворуч
    p.add_run('\t')
    add_runs(p, text)
    p.add_run('\t' + number)


def figure(doc, image, caption, width_mm=None):
    p = doc.add_paragraph(style=style_or_body(doc, CAPTION_FIGURE))
    p.paragraph_format.first_line_indent = 0
    p.paragraph_format.keep_with_next = True
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    # широкий рисунок займає 165 мм, високий обмежено 200 мм заввишки, щоб він уміщався з підписом
    with Image.open(image) as im:
        w, h = im.size
    p.add_run().add_picture(str(image), width=Mm(min(width_mm or FIGURE_MM, FIGURE_MAX_H_MM * w / h)))
    c = doc.add_paragraph(style=style_or_body(doc, CAPTION_FIGURE))
    c.paragraph_format.first_line_indent = 0
    c.paragraph_format.space_after = Pt(14)
    c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_runs(c, caption)


class Writer:
    """Додає розділи в документ і пам'ятає нумерацію джерел, підписи і заголовки (для змісту)."""

    def __init__(self, doc, sources):
        self.doc, self.sources = doc, sources
        self.order, self.cited = [], set()
        self.captions, self.text, self.headings = [], [], []
        self.formulas = 0
        self.first = True
        self.values = {}   # {сторінок}, {таблиць} ... у вступі й рефераті, заповнює zapyska.py

    def number_only(self, path):
        """Розділ, який лише нумерує джерела, а у файл не потрапляє (аргумент з «+»)."""
        for line in Path(path).read_text(encoding='utf8').splitlines():
            number_citations(line, self.order)

    def heading(self, text, level):
        # у шаблоні заголовки вирівняні за шириною, і довга назва розтягується по рядку,
        # тому розділи (і ВСТУП, ВИСНОВКИ, ДОДАТКИ) ставляться по центру, а підрозділи – ліворуч
        if level == 1:
            p = heading(self.doc, text, H1, page_break=not self.first)
            self.first = False
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            # кожен додаток з нової сторінки, крім першого, що йде одразу після «ДОДАТКИ»
            new_page = text.startswith('Додаток') and self.headings[-1][0] != 1
            p = heading(self.doc, text, H2, page_break=new_page)
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        self.headings.append((level, text))
        return p

    def render(self, path):
        path = Path(path)
        source = path.read_text(encoding='utf8')
        self.cited |= set(re.findall(r'@(\w+)', ' '.join(re.findall(r'\[(@[^\]]+)\]', source))))
        base = path.parent
        doc, order = self.doc, self.order
        lines = source.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].rstrip()
            if not line:
                i += 1
                continue
            # ![підпис](файл) або ![підпис](файл){110} – ширина рисунка в міліметрах
            m = re.fullmatch(r'!\[(.+)\]\(([^)]+)\)(?:\{(\d+)\})?', line)
            code = re.fullmatch(r'\{\{код: (.+)\}\}', line)
            if line.startswith('# '):
                self.heading(line[2:], 1)
            elif line.startswith('## '):
                self.heading(line[3:], 2)
            elif m:
                figure(doc, base / m.group(2), m.group(1), int(m.group(3)) if m.group(3) else None)
                self.captions.append(m.group(1))
            elif code:
                listing(doc, base / code.group(1))
            elif line.startswith('Таблиця '):
                caption_above(doc, line)
                self.captions.append(line)
            elif line.startswith('|'):
                rows = []
                while i < len(lines) and lines[i].startswith('|'):
                    cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                    if not all(re.fullmatch(r'-+', c) for c in cells):
                        rows.append([number_citations(c, order) for c in cells])
                    i += 1
                table(doc, rows)
                continue
            elif re.search(r'[,.] \((\d+\.\d+)\)$', line):
                m = re.search(r'^(.*[,.]) \((\d+\.\d+)\)$', line)
                formula(doc, m.group(1), f'({m.group(2)})')
                self.formulas += 1
            else:
                for key, value in self.values.items():
                    line = line.replace('{' + key + '}', value)
                p = doc.add_paragraph(style=BODY)
                add_runs(p, number_citations(line, order))
                self.text.append(line)
            i += 1

    def source_list(self):
        """Перелік джерел: лише ті, на які є посилання, з номерами з усієї записки."""
        self.heading('ПЕРЕЛІК ДЖЕРЕЛ ПОСИЛАННЯ', 1)
        listed = [(n, key) for n, key in enumerate(self.order, 1) if key in self.cited]
        for n, key in listed:
            if key not in self.sources:
                sys.exit(f'Немає опису джерела для ключа {key}')
            p = self.doc.add_paragraph(style=BODY)
            add_runs(p, f'{n}. {self.sources[key]}', subscripts=False)
        return listed

    def check(self):
        check(self.captions, '\n'.join(self.text), self.sources, self.order)


def listing(doc, path):
    """Лістинг файлу в додатку: назва файлу, далі кожен рядок коду окремим абзацом стилю «Код»."""
    rel = Path(path).resolve().relative_to(Path(__file__).resolve().parents[2])
    p = doc.add_paragraph(style=BODY)
    p.paragraph_format.first_line_indent = 0
    p.paragraph_format.keep_with_next = True
    p.paragraph_format.space_before = Pt(12)
    p.add_run(f'Файл {rel.as_posix()}').bold = True
    style = style_or_body(doc, CODE)
    for line in Path(path).read_text(encoding='utf8').rstrip('\n').split('\n'):
        c = doc.add_paragraph(style=style)
        pf = c.paragraph_format
        pf.first_line_indent = 0
        pf.left_indent = 0
        pf.line_spacing = 1.0
        pf.space_before = pf.space_after = Pt(0)
        c.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = c.add_run(line.replace('\t', '  ') or ' ')
        run.font.size = Pt(CODE_PT)
        run.font.name = 'Courier New'


def build(template, sources_path, out, chapters):
    w = Writer(open_template(template), load_sources(sources_path))
    for chapter in chapters:
        if chapter.startswith('+'):
            w.number_only(chapter[1:])
        else:
            w.render(chapter)
    listed = w.source_list()
    w.doc.save(out)
    print(f'{out}: джерел {len(listed)}' + (f' (номери з {listed[0][0]} до {listed[-1][0]})' if len(listed) < len(w.order) else ''))
    w.check()


def check(captions, text, sources, order):
    """Попередження про рисунки й таблиці без посилань у тексті і про невикористані джерела."""
    for cap in captions:
        kind, num = re.match(r'(Рисунок|Таблиця) (\d+\.\d+)', cap).groups()
        ref = r'рис\. ' if kind == 'Рисунок' else r'табл(\.|иц\w+) '
        if not re.search(ref + r'(\d+\.\d+, )*' + re.escape(num) + r'\b', text):
            print(f'Попередження: {kind.lower()} {num} не згадується в тексті')
    unused = [k for k in sources if k not in order]
    if unused:
        print('Джерела без посилань (у перелік не потрапили):', ', '.join(unused))


if __name__ == '__main__':
    if len(sys.argv) < 5:
        sys.exit(__doc__)
    build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])

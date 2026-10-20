"""Збирає розділ пояснювальної записки у .docx на стилях шаблону кафедри.

Використання:
    python3 build.py <шаблон.dotx> <розділ.md> <джерела.md> <вихід.docx>

Посилання в тексті пишуться як [@ключ] або [@ключ1; @ключ2] і нумеруються
в порядку першої появи. Перелік джерел додається в кінець файлу.
"""
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt

BODY = '0'          # «0» у шаблоні: основний текст з відступом 1,25 см
H1, H2 = '1', '2'
TABLE = 'a3'        # Table Grid


def open_template(path):
    """python-docx не відкриває .dotx, тому міняємо тип головної частини."""
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
        nums.sort()
        return '[' + ', '.join(map(str, nums)) + ']'
    return re.sub(r'\[(@[^\]]+)\]', repl, text)


def add_runs(par, text, size=None, subscripts=True):
    """Підтримує *курсив* і нижні індекси виду CVaR_α."""
    for i, part in enumerate(re.split(r'\*([^*]+)\*', text)):
        if not part:
            continue
        for j, piece in enumerate((re.split(r'_(\{[^}]+\}|[A-Za-zα0-9]+)', part) if subscripts else [part])):
            if not piece:
                continue
            run = par.add_run(piece.strip('{}') if j % 2 else piece)
            run.italic = bool(i % 2) or None
            if j % 2:
                run.font.subscript = True
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


def caption_above(doc, text):
    p = doc.add_paragraph(style=BODY)
    p.paragraph_format.first_line_indent = 0
    p.paragraph_format.keep_with_next = True
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_runs(p, text)


def table(doc, rows):
    t = doc.add_table(rows=len(rows), cols=len(rows[0]))
    t.style = doc.styles['Table Grid']
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            p = t.cell(r, c).paragraphs[0]
            p.style = doc.styles['Normal']
            p.paragraph_format.line_spacing = 1.0
            if r == 0:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_runs(p, cell, size=12, subscripts=False)
            if r == 0:
                for run in p.runs:
                    run.bold = False
    # повторювати шапку на кожній сторінці
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    hdr = OxmlElement('w:tblHeader')
    hdr.set(qn('w:val'), 'true')
    tr_pr.append(hdr)
    doc.add_paragraph(style=BODY)


def formula(doc, text, number):
    p = doc.add_paragraph(style=BODY)
    p.paragraph_format.first_line_indent = 0
    pf = p.paragraph_format
    pf.tab_stops.add_tab_stop(Pt(240), alignment=1)   # центр
    pf.tab_stops.add_tab_stop(Pt(482), alignment=2)   # праворуч
    p.add_run('\t')
    add_runs(p, text)
    p.add_run('\t' + number)


def build(template, chapter, sources_path, out):
    doc = open_template(template)
    sources = load_sources(sources_path)
    order = []
    lines = Path(chapter).read_text(encoding='utf8').splitlines()
    i = 0
    first = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue
        if line.startswith('# '):
            heading(doc, line[2:], H1, page_break=not first)
            first = False
        elif line.startswith('## '):
            heading(doc, line[3:], H2)
        elif line.startswith('Таблиця '):
            caption_above(doc, line)
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [c.strip() for c in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'-+', c) for c in cells):
                    rows.append([number_citations(c, order) for c in cells])
                i += 1
            table(doc, rows)
            continue
        elif re.search(r', \((\d+\.\d+)\)$', line):
            m = re.search(r'^(.*), \((\d+\.\d+)\)$', line)
            formula(doc, m.group(1) + ',', f'({m.group(2)})')
        else:
            p = doc.add_paragraph(style=BODY)
            add_runs(p, number_citations(line, order))
        i += 1

    heading(doc, 'ПЕРЕЛІК ДЖЕРЕЛ ПОСИЛАННЯ', H1, page_break=True).alignment = WD_ALIGN_PARAGRAPH.CENTER
    for n, key in enumerate(order, 1):
        if key not in sources:
            sys.exit(f'Немає опису джерела для ключа {key}')
        p = doc.add_paragraph(style=BODY)
        add_runs(p, f'{n}. {sources[key]}', subscripts=False)
    doc.save(out)
    print(f'{out}: джерел {len(order)}')


if __name__ == '__main__':
    build(*sys.argv[1:5])

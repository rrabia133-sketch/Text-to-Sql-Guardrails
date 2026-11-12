from pathlib import Path
import re
from html import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf' / 'PROJECT-REVIEW-QA.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, filename in [('Body', 'calibri.ttf'), ('Body-Bold', 'calibrib.ttf'), ('Body-Italic', 'calibrii.ttf'), ('Body-BoldItalic', 'calibriz.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(Path('C:/Windows/Fonts') / filename)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic', boldItalic='Body-BoldItalic')

NAVY = colors.HexColor('#172b46')
TEAL = colors.HexColor('#176b79')
GRAY = colors.HexColor('#556273')
styles = {
    'title': ParagraphStyle('title', fontName='Body-Bold', fontSize=24, leading=28, textColor=NAVY, spaceAfter=18),
    'section': ParagraphStyle('section', fontName='Body-Bold', fontSize=16, leading=20, textColor=TEAL, spaceBefore=17, spaceAfter=10, keepWithNext=True),
    'question': ParagraphStyle('question', fontName='Body-Bold', fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=10, spaceAfter=5, keepWithNext=True),
    'body': ParagraphStyle('body', fontName='Body', fontSize=10.5, leading=14.6, spaceAfter=7, textColor=colors.HexColor('#243246')),
    'bullet': ParagraphStyle('bullet', fontName='Body', fontSize=10.5, leading=14.6, leftIndent=13, firstLineIndent=-11, spaceAfter=5, textColor=colors.HexColor('#243246')),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=10, leading=13, spaceAfter=0),
    'quote': ParagraphStyle('quote', fontName='Body-Italic', fontSize=12, leading=17, textColor=NAVY, leftIndent=14, borderColor=TEAL, borderWidth=2, borderPadding=10, spaceBefore=8, spaceAfter=10),
}

def inline(text):
    text = text.replace('\u2013', '-').replace('\u2014', '-')
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: f'{m[1]} ({m[2]})', text)
    text = escape(text)
    text = re.sub(r'`([^`]+)`', r'<font color="#176b79">\1</font>', text)
    return re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)

source = (ROOT / 'PROJECT-REVIEW-QA.md').read_text(encoding='utf-8')
lines = source.splitlines()
story = []
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line.startswith('|'):
        rows = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            cells = [s.strip() for s in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r':?-+:?', c) for c in cells):
                rows.append(cells)
            i += 1
        widths = [155, A4[0] - 104 - 155] if len(rows[0]) == 2 else None
        data = [[Paragraph(('<b>' + inline(c) + '</b>') if n == 0 else inline(c), styles['cell']) for c in row] for n, row in enumerate(rows)]
        table = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e1ebf1')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f8fa')]),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 9),
            ('RIGHTPADDING', (0, 0), (-1, -1), 9),
            ('LINEBELOW', (0, 0), (-1, 0), .7, colors.HexColor('#b9ceda')),
        ]))
        story += [table, Spacer(1, 9)]
        continue
    if line.startswith('### '):
        story.append(Paragraph(inline(line[4:]), styles['question']))
    elif line.startswith('## '):
        story.append(Paragraph(inline(line[3:]), styles['section']))
    elif line.startswith('# '):
        story.append(Paragraph(inline(line[2:]), styles['title']))
    elif line.startswith('> '):
        story.append(Paragraph(inline(line[2:]), styles['quote']))
    elif line.startswith('- '):
        story.append(Paragraph('&#8226; ' + inline(line[2:]), styles['bullet']))
    elif re.match(r'^\d+\. ', line):
        story.append(Paragraph(inline(line), styles['bullet']))
    else:
        para = [line]
        while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r'^(#|\||>|- |\d+\. )', lines[i + 1].strip()):
            i += 1
            para.append(lines[i].strip())
        story.append(Paragraph(inline(' '.join(para)), styles['body']))
    i += 1

def decorate(c, doc):
    c.setStrokeColor(colors.HexColor('#d5dfe7'))
    c.setLineWidth(.5)
    c.line(52, 43, A4[0]-52, 43)
    c.setFont('Body', 8)
    c.setFillColor(GRAY)
    c.drawString(52, 29, 'TEXT-TO-SQL | Project review and viva questions')
    c.drawRightString(A4[0]-52, 29, str(doc.page))
    if doc.page > 1:
        c.setFont('Body', 8)
        c.drawString(52, A4[1]-32, 'PROJECT REVIEW / SIMPLE QUESTIONS AND ANSWERS')

doc = SimpleDocTemplate(str(OUT), pagesize=A4, rightMargin=52, leftMargin=52, topMargin=52, bottomMargin=58, title='Text-to-SQL Project Review: Simple Questions and Answers', author='Rehan Akbar')
doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
reader = PdfReader(str(OUT))
text = '\n'.join(p.extract_text() for p in reader.pages)
questions = re.findall(r'^### (.+)', source, flags=re.M)
for q in questions:
    normalized = lambda s: re.sub(r'\s+', '', s).replace('\u2013', '-').replace('\u2014', '-')
    assert normalized(q) in normalized(text), f'Missing question: {q}'
assert 'Short project introduction for a presentation' in text
print(f'Created {OUT}\nPages: {len(reader.pages)}\nVerified all {len(questions)} questions.')

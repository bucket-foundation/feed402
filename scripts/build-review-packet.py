#!/usr/bin/env python3
"""Build PDF artifacts for Lanzafame review — tight version."""
from pathlib import Path
import markdown
import weasyprint

SRC = Path("/home/gian/freelance/viatika-x402-data-standard")
OUT = Path("/tmp/feed402-review-" + __import__("datetime").date.today().isoformat())
OUT.mkdir(parents=True, exist_ok=True)

DOCS = [
    ("BRIEF.md",    "01-BRIEF"),
    ("SPEC.md",     "02-SPEC"),
    ("CONTRACT.md", "03-CONTRACT"),
]

CSS = """
@page {
  size: Letter;
  margin: 0.85in 0.85in 0.95in 0.85in;
  @bottom-right {
    content: "page " counter(page) " / " counter(pages);
    font-size: 9pt; color: #888;
    font-family: -apple-system, "Segoe UI", sans-serif;
  }
  @bottom-left {
    content: "feed402 · viatika review · 2026-04-15";
    font-size: 9pt; color: #888;
    font-family: -apple-system, "Segoe UI", sans-serif;
  }
}
html, body {
  font-family: -apple-system, "Segoe UI", "Helvetica Neue", sans-serif;
  font-size: 10.5pt; line-height: 1.5; color: #1a1a1a;
}
h1 {
  font-size: 20pt; color: #000; border-bottom: 2px solid #000;
  padding-bottom: 0.2em; margin-top: 0.3em; page-break-after: avoid;
}
h2 {
  font-size: 14pt; color: #000; margin-top: 1.4em;
  border-bottom: 1px solid #bbb; padding-bottom: 0.1em; page-break-after: avoid;
}
h3 { font-size: 12pt; color: #222; margin-top: 1em; page-break-after: avoid; }
p { margin: 0.45em 0; }
ul, ol { margin: 0.4em 0 0.4em 1.2em; padding-left: 1em; }
li { margin: 0.1em 0; }
code {
  font-family: "SF Mono", "Consolas", "Menlo", monospace;
  background: #f2f2f2; padding: 1px 4px; border-radius: 3px;
  font-size: 9pt; color: #c7254e;
}
pre {
  background: #f7f7f7; border: 1px solid #e0e0e0; border-left: 3px solid #666;
  padding: 0.6em 0.8em; border-radius: 3px; overflow-x: auto;
  font-size: 8.5pt; line-height: 1.4; page-break-inside: avoid;
}
pre code { background: transparent; padding: 0; color: #1a1a1a; font-size: 8.5pt; }
table {
  border-collapse: collapse; margin: 0.7em 0; font-size: 9.5pt;
  width: 100%; page-break-inside: avoid;
}
th {
  background: #f0f0f0; border: 1px solid #999; padding: 4px 7px;
  text-align: left; font-weight: 600;
}
td { border: 1px solid #ccc; padding: 4px 7px; vertical-align: top; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
strong { color: #000; }
a { color: #0066cc; text-decoration: none; }
blockquote {
  border-left: 3px solid #888; padding: 0.2em 0 0.2em 0.8em;
  margin: 0.6em 0; color: #555; font-style: italic;
}
.section-break { page-break-before: always; }
"""

MD_EXTS = ['tables', 'fenced_code', 'nl2br', 'sane_lists', 'attr_list']


def md_to_html(md_text: str) -> str:
    return markdown.markdown(md_text, extensions=MD_EXTS)


def wrap(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>{CSS}</style></head><body>{body}</body></html>"""


def build_one(src_name: str, stem: str):
    md_path = SRC / src_name
    if not md_path.exists():
        print(f"SKIP {src_name}")
        return
    html = wrap(stem, md_to_html(md_path.read_text()))
    pdf = OUT / f"{stem}.pdf"
    weasyprint.HTML(string=html, base_url=str(OUT)).write_pdf(str(pdf))
    print(f"  pdf → {pdf.name}  ({pdf.stat().st_size:,} bytes)")
    # also copy source MD
    (OUT / f"{stem}.md").write_text(md_path.read_text())


def build_packet():
    parts = []
    for i, (src, stem) in enumerate(DOCS):
        md_path = SRC / src
        if not md_path.exists():
            continue
        body = md_to_html(md_path.read_text())
        prefix = '<div class="section-break"></div>' if i > 0 else ''
        parts.append(f'{prefix}{body}')
    html = wrap("feed402 review packet", "\n".join(parts))
    pdf = OUT / "00-REVIEW-PACKET.pdf"
    weasyprint.HTML(string=html, base_url=str(OUT)).write_pdf(str(pdf))
    print(f"  packet → {pdf.name}  ({pdf.stat().st_size:,} bytes)")


def main():
    print(f"→ out: {OUT}")
    for src, stem in DOCS:
        print(f"[{src}]")
        build_one(src, stem)
    print("[packet]")
    build_packet()
    print("\n→ inventory:")
    for f in sorted(OUT.iterdir()):
        print(f"  {f.name:30s}  {f.stat().st_size:>8,} bytes")


if __name__ == "__main__":
    main()

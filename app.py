from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import List

import fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="ScanSprint", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

KNOWN_HEADINGS = {
    "abstract": "Abstract",
    "introduction": "Introduction",
    "background": "Background",
    "methods": "Methods",
    "materials and methods": "Materials and Methods",
    "methodology": "Methodology",
    "results": "Results",
    "discussion": "Discussion",
    "conclusion": "Conclusion",
    "conclusions": "Conclusions",
    "summary": "Summary",
    "references": "References",
    "appendix": "Appendix",
    "preface": "Preface",
    "acknowledgements": "Acknowledgements",
    "acknowledgments": "Acknowledgments",
}

CAPTION_RE = re.compile(r"^(figure|fig\.?|table|scheme|chart|image|plate)\s*\d+", re.IGNORECASE)
REFERENCE_RE = re.compile(r"^(\[?\d+\]?\s+.+|doi\s*:.*)$", re.IGNORECASE)
PAGE_RE = re.compile(r"^page\s+\d+", re.IGNORECASE)


class ParagraphOut(BaseModel):
    id: str
    label: str
    text: str
    word_count: int


class SectionOut(BaseModel):
    title: str
    paragraphs: List[ParagraphOut]


class DocumentOut(BaseModel):
    title: str
    source_type: str
    stats: dict
    sections: List[SectionOut]


class TextRequest(BaseModel):
    text: str = Field(min_length=1)
    title: str = "Pasted text"


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/parse-text", response_model=DocumentOut)
def parse_text(payload: TextRequest) -> DocumentOut:
    cleaned_text = payload.text.strip()
    if not cleaned_text:
        raise HTTPException(status_code=400, detail="No text supplied.")
    return build_document(cleaned_text, payload.title, "Pasted text")


@app.post("/api/parse-file", response_model=DocumentOut)
async def parse_file(file: UploadFile = File(...)) -> DocumentOut:
    filename = file.filename or "uploaded-file"
    suffix = Path(filename).suffix.lower()
    raw = await file.read()
    if suffix not in {".pdf", ".txt"}:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported in this starter app.")
    if suffix == ".pdf":
        text = extract_pdf_text(raw)
        source_type = "PDF document"
    else:
        text = raw.decode("utf-8", errors="ignore")
        source_type = "Text file"
    return build_document(text, filename, source_type)


def build_document(text: str, title: str, source_type: str) -> DocumentOut:
    sections = normalize_sections(build_sections(text))
    paragraph_count = sum(len(section.paragraphs) for section in sections)
    return DocumentOut(
        title=title,
        source_type=source_type,
        stats={"sections": len(sections), "paragraphs": paragraph_count},
        sections=sections,
    )


def extract_pdf_text(raw: bytes) -> str:
    doc = fitz.open(stream=raw, filetype="pdf")
    page_texts = []
    for page in doc:
        blocks = page.get_text("blocks")
        ordered_blocks = sorted(blocks, key=lambda b: (round(b[1], 1), round(b[0], 1)))
        lines = []
        for block in ordered_blocks:
            text = clean_line(block[4] if len(block) > 4 else "")
            if not text:
                continue
            if looks_like_caption(text):
                continue
            lines.append(text)
        page_texts.append("\n\n".join(lines))
    return "\n\n".join(page_texts)


def clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def looks_like_caption(line: str) -> bool:
    return bool(CAPTION_RE.match(clean_line(line)))


def looks_like_reference(line: str) -> bool:
    stripped = clean_line(line)
    return bool(REFERENCE_RE.match(stripped)) or stripped.lower() == "references"


def is_likely_heading(line: str) -> bool:
    stripped = clean_line(line)
    if not stripped:
        return False
    if stripped.lower() in KNOWN_HEADINGS:
        return True
    if len(stripped) > 85:
        return False
    if stripped.endswith((".", "!", "?", ":", ";")):
        return False
    words = stripped.split()
    if len(words) > 10:
        return False
    letters = re.sub(r"[^A-Za-z]", "", stripped)
    if not letters:
        return False
    upper_ratio = sum(1 for c in letters if c.isupper()) / len(letters)
    titlecase_ratio = sum(1 for w in words if re.match(r"^[A-Z][A-Za-z\-]+$", w)) / max(len(words), 1)
    return upper_ratio > 0.72 or titlecase_ratio > 0.6


def build_sections(text: str) -> list[dict]:
    raw_lines = [clean_line(line) for line in text.splitlines()]
    filtered = []
    for line in raw_lines:
        if not line:
            filtered.append("")
            continue
        if PAGE_RE.match(line):
            continue
        if looks_like_caption(line) or looks_like_reference(line):
            continue
        filtered.append(line)

    sections = []
    current = {"title": "Content", "paragraphs": []}
    buffer: list[str] = []

    def flush_buffer() -> None:
        nonlocal buffer
        if not buffer:
            return
        paragraph = clean_line(" ".join(buffer))
        buffer = []
        if len(paragraph.split()) >= 12:
            current["paragraphs"].append(paragraph)

    for line in filtered:
        if not line:
            flush_buffer()
            continue
        lower = line.lower()
        if lower in {"references", "bibliography"}:
            flush_buffer()
            break
        if is_likely_heading(line):
            flush_buffer()
            if current["paragraphs"]:
                sections.append(current)
            current = {"title": KNOWN_HEADINGS.get(lower, line.title()), "paragraphs": []}
            continue
        buffer.append(line)
        if re.search(r"[.!?]$", line):
            flush_buffer()

    flush_buffer()
    if current["paragraphs"]:
        sections.append(current)

    if not sections:
        fallback = [p for p in re.split(r"\n\s*\n", text) if len(clean_line(p).split()) >= 12]
        sections = [{"title": "Content", "paragraphs": [clean_line(p) for p in fallback]}]
    return sections


def normalize_sections(raw_sections: list[dict]) -> list[SectionOut]:
    sections: list[SectionOut] = []
    for section in raw_sections:
        paragraphs = []
        for index, paragraph in enumerate(section.get("paragraphs", []), start=1):
            cleaned = clean_line(paragraph)
            if len(cleaned.split()) < 12:
                continue
            paragraphs.append(
                ParagraphOut(
                    id=str(uuid.uuid4()),
                    label=f"Paragraph {index}",
                    text=cleaned,
                    word_count=len(cleaned.split()),
                )
            )
        if paragraphs:
            sections.append(SectionOut(title=section.get("title", "Content"), paragraphs=paragraphs))
    if not sections:
        sections.append(
            SectionOut(
                title="Content",
                paragraphs=[
                    ParagraphOut(
                        id=str(uuid.uuid4()),
                        label="Paragraph 1",
                        text="No sufficiently long paragraph could be extracted from this document.",
                        word_count=10,
                    )
                ],
            )
        )
    return sections


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)

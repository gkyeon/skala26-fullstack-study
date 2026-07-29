#!/usr/bin/env python3
"""Run the local, dependency-free SKALA lecture studio."""

from __future__ import annotations

import argparse
import errno
import hashlib
import html
import html.parser
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


TOOL_DIR = Path(__file__).resolve().parent
SITE_DIR = TOOL_DIR.parent.parent
STATIC_DIR = TOOL_DIR / "static"


def user_state_dir() -> Path:
    """Return a per-repository state folder outside the shared repository."""
    override = os.environ.get("SKALA_LECTURE_STUDIO_STATE_DIR")
    if override:
        root = Path(override).expanduser()
    elif os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        root = Path(os.environ["LOCALAPPDATA"])
    elif os.environ.get("XDG_STATE_HOME"):
        root = Path(os.environ["XDG_STATE_HOME"])
    else:
        root = Path.home() / ".local" / "state"
    repository_id = hashlib.sha256(str(SITE_DIR).encode("utf-8")).hexdigest()[:12]
    return root / "skala-lecture-studio" / repository_id


DATA_DIR = user_state_dir()
MANIFEST_PATH = DATA_DIR / "last-generation.json"
CUSTOM_TEMPLATES_PATH = TOOL_DIR / "data" / "custom-templates.json"
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
FOLDER_RE = re.compile(r"^(\d{2})-(.+)$")


def run_git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(SITE_DIR),
        text=True,
        capture_output=True,
        check=check,
    )


def git_status() -> list[dict[str, str]]:
    result = run_git("status", "--porcelain=v1", "--untracked-files=all", check=False)
    items = []
    for line in result.stdout.splitlines():
        if len(line) >= 4:
            items.append({"code": line[:2], "path": line[3:]})
    return items


def list_lectures() -> list[dict[str, object]]:
    lectures_dir = SITE_DIR / "lectures"
    result = []
    if not lectures_dir.exists():
        return result
    for folder in sorted(p for p in lectures_dir.iterdir() if p.is_dir()):
        match = FOLDER_RE.match(folder.name)
        if not match:
            continue
        index_path = folder / "index.html"
        title = folder.name
        template_state = False
        if index_path.exists():
            text = index_path.read_text(encoding="utf-8")
            title_match = re.search(r"<title>SKALA \| (.*?) - 복습노트</title>", text)
            if title_match:
                title = html.unescape(title_match.group(1))
            template_state = "[강의 제목]" in text
        result.append(
            {
                "number": match.group(1),
                "folder": folder.name,
                "title": title,
                "hasIndex": index_path.exists(),
                "isTemplate": template_state,
            }
        )
    return result


def next_number(lectures: list[dict[str, object]]) -> str:
    values = [int(str(item["number"])) for item in lectures]
    return f"{(max(values) + 1) if values else 0:02d}"


def site_url() -> str:
    try:
        remote = run_git("remote", "get-url", "origin").stdout.strip()
        match = re.search(r"github\.com[/:]([^/]+)/([^/.]+)(?:\.git)?$", remote)
        if match:
            return f"https://{match.group(1)}.github.io/{match.group(2)}/"
    except subprocess.CalledProcessError:
        pass
    return ""


def context_payload() -> dict[str, object]:
    lectures = list_lectures()
    branch = run_git("branch", "--show-current", check=False).stdout.strip()
    remote = run_git("remote", "get-url", "origin", check=False).stdout.strip()
    return {
        "lectures": lectures,
        "nextNumber": next_number(lectures),
        "git": {
            "branch": branch,
            "remoteConfigured": bool(remote),
            "changes": git_status(),
        },
        "siteUrl": site_url(),
    }


def clean_text(value: object, limit: int = 5000) -> str:
    return str(value or "").strip()[:limit]


def normalize_payload(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        raise ValueError("입력 형식이 올바르지 않습니다.")
    number = clean_text(raw.get("number"), 2)
    slug = clean_text(raw.get("slug"), 80).lower()
    title = clean_text(raw.get("title"), 140)
    subtitle = clean_text(raw.get("subtitle"), 180)
    description = clean_text(raw.get("description"), 500)
    keywords = [clean_text(v, 40) for v in raw.get("keywords", []) if clean_text(v, 40)][:8]
    sharing_raw = raw.get("sharing", {}) if isinstance(raw.get("sharing"), dict) else {}
    title_sharing = sharing_raw.get("title", {}) if isinstance(sharing_raw.get("title"), dict) else {}
    keyword_sharing = sharing_raw.get("keywords", {}) if isinstance(sharing_raw.get("keywords"), dict) else {}

    def shared_text(target: str, fallback: str) -> str:
        item = title_sharing.get(target, {})
        if not isinstance(item, dict) or item.get("linked", True):
            return fallback
        return clean_text(item.get("value"), 180) or fallback

    def shared_keywords(target: str) -> list[str]:
        item = keyword_sharing.get(target, {})
        if not isinstance(item, dict) or item.get("linked", True):
            return keywords
        value = item.get("value", "")
        values = value if isinstance(value, list) else str(value).split(",")
        result = [clean_text(v, 40) for v in values if clean_text(v, 40)][:8]
        return result or keywords
    parts_raw = raw.get("parts", [])
    parts = []
    if isinstance(parts_raw, list):
        for part_raw in parts_raw[:4]:
            if not isinstance(part_raw, dict):
                continue
            sections = []
            for section_raw in part_raw.get("sections", [])[:20]:
                if not isinstance(section_raw, dict):
                    continue
                blocks = []
                for block_raw in section_raw.get("blocks", [])[:30]:
                    if not isinstance(block_raw, dict):
                        continue
                    block_type = clean_text(block_raw.get("type"), 20)
                    if block_type not in {"text", "list", "code", "note"}:
                        continue
                    blocks.append(
                        {
                            "id": clean_text(block_raw.get("id"), 80),
                            "type": block_type,
                            "heading": clean_text(block_raw.get("heading"), 120),
                            "content": clean_text(block_raw.get("content"), 12000),
                        }
                    )
                sections.append(
                    {
                        "id": clean_text(section_raw.get("id"), 80),
                        "title": clean_text(section_raw.get("title"), 160),
                        "navTitle": clean_text(section_raw.get("navTitle"), 160)
                        or clean_text(section_raw.get("title"), 160),
                        "keywords": clean_text(section_raw.get("keywords"), 240),
                        "summary": clean_text(section_raw.get("summary"), 1200),
                        "blocks": blocks,
                    }
                )
            quizzes = []
            for quiz_raw in part_raw.get("quizzes", [])[:20]:
                if not isinstance(quiz_raw, dict):
                    continue
                quiz_type = clean_text(quiz_raw.get("type"), 20)
                if quiz_type not in {"mc", "ox", "short"}:
                    continue
                quizzes.append(
                    {
                        "type": quiz_type,
                        "prompt": clean_text(quiz_raw.get("prompt"), 500),
                        "options": [
                            clean_text(v, 300)
                            for v in quiz_raw.get("options", [])
                            if clean_text(v, 300)
                        ][:5],
                        "answer": clean_text(quiz_raw.get("answer"), 300),
                    }
                )
            parts.append(
                {
                    "title": clean_text(part_raw.get("title"), 140),
                    "sections": sections,
                    "quizzes": quizzes,
                }
            )
    return {
        "number": number,
        "slug": slug,
        "title": title,
        "subtitle": subtitle,
        "description": description,
        "keywords": keywords,
        "display": {
            "title": {
                "document": shared_text("document", title),
                "breadcrumb": shared_text("breadcrumb", title),
                "sidebar": shared_text("sidebar", title),
                "page": shared_text("page", title),
                "home": shared_text("home", title),
            },
            "keywords": {
                "page": shared_keywords("page"),
                "home": shared_keywords("home"),
            },
        },
        "parts": parts,
    }


def validate_payload(data: dict[str, object]) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    number = str(data["number"])
    if not re.fullmatch(r"\d{2}", number):
        errors.append("강의 번호는 00~99의 두 자리 숫자로 입력해주세요.")
    if not SLUG_RE.fullmatch(str(data["slug"])):
        errors.append("영문 주소는 소문자 영문·숫자·하이픈만 사용할 수 있어요.")
    if not data["title"]:
        errors.append("강의 제목을 입력해주세요.")
    if not data["description"]:
        errors.append("홈 카드에 표시할 한 줄 소개를 입력해주세요.")
    if not data["keywords"]:
        errors.append("키워드를 한 개 이상 입력해주세요.")
    parts = data["parts"]
    if not parts:
        errors.append("파트를 한 개 이상 추가해주세요.")
    section_count = 0
    quiz_count = 0
    for p_index, part in enumerate(parts, 1):
        if not part["title"]:
            errors.append(f"파트 {p_index}의 제목을 입력해주세요.")
        if not part["sections"]:
            errors.append(f"파트 {p_index}에 섹션을 한 개 이상 추가해주세요.")
        for s_index, section in enumerate(part["sections"], 1):
            section_count += 1
            if not section["title"]:
                errors.append(f"파트 {p_index} · 섹션 {s_index}의 제목을 입력해주세요.")
            if not section["summary"]:
                warnings.append(f"파트 {p_index} · 섹션 {s_index}에 쉬운 요약을 넣으면 이해하기 좋아요.")
            if not any(block["content"] for block in section["blocks"]):
                errors.append(f"파트 {p_index} · 섹션 {s_index}의 본문 내용을 입력해주세요.")
        for q_index, quiz in enumerate(part["quizzes"], 1):
            quiz_count += 1
            if not quiz["prompt"]:
                errors.append(f"파트 {p_index} · 퀴즈 {q_index}의 문제를 입력해주세요.")
            if quiz["type"] == "mc":
                if len(quiz["options"]) < 2:
                    errors.append(f"파트 {p_index} · 퀴즈 {q_index}의 보기를 두 개 이상 입력해주세요.")
                if quiz["answer"] not in [str(i) for i in range(len(quiz["options"]))]:
                    errors.append(f"파트 {p_index} · 퀴즈 {q_index}의 정답 보기를 선택해주세요.")
            elif quiz["type"] == "ox" and quiz["answer"] not in {"o", "x"}:
                errors.append(f"파트 {p_index} · 퀴즈 {q_index}의 O/X 정답을 선택해주세요.")
            elif quiz["type"] == "short" and not quiz["answer"]:
                errors.append(f"파트 {p_index} · 퀴즈 {q_index}의 정답을 입력해주세요.")
    if quiz_count == 0:
        warnings.append("퀴즈가 아직 없어요. 없어도 페이지는 만들 수 있습니다.")
    if section_count > 12:
        warnings.append("섹션이 많아 페이지가 길어질 수 있어요. 파트를 나누었는지 확인해보세요.")
    return errors, warnings


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def paragraphs(value: str) -> str:
    chunks = [chunk.strip() for chunk in re.split(r"\n\s*\n", value) if chunk.strip()]
    return "\n".join(f"      <p>{esc(chunk).replace(chr(10), '<br>')}</p>" for chunk in chunks)


def render_block(block: dict[str, str], block_index: int) -> str:
    heading = f"      <h4>{esc(block['heading'])}</h4>\n" if block["heading"] else ""
    content = block["content"]
    if block["type"] == "text":
        rendered = heading + paragraphs(content)
    elif block["type"] == "list":
        items = [line.strip().lstrip("-• ").strip() for line in content.splitlines() if line.strip()]
        rendered = heading + "      <ul class=\"b\">\n" + "\n".join(
            f"        <li>{esc(item)}</li>" for item in items
        ) + "\n      </ul>"
    elif block["type"] == "code":
        label = block["heading"] or "코드 예시"
        rendered = (
            '      <div class="codebox">\n'
            f'        <div class="codehead">{esc(label)}</div>\n'
            f"        <pre><code>{esc(content)}</code></pre>\n"
            "      </div>"
        )
    else:
        rendered = f'      <div class="note">{esc(content).replace(chr(10), "<br>")}</div>'
    return f'      <div class="studio-block" data-block-index="{block_index}">\n{rendered}\n      </div>'


def render_quiz(quiz: dict[str, object]) -> str:
    prompt = esc(quiz["prompt"])
    if quiz["type"] == "mc":
        options = quiz["options"] or ["보기 1", "보기 2", "보기 3"]
        raw_answer = str(quiz["answer"])
        answer_index = int(raw_answer) if raw_answer.isdigit() and int(raw_answer) < len(options) else 0
        values = [chr(97 + i) for i in range(len(options))]
        options = "\n".join(
            f'          <button class="quiz-opt" data-val="{values[i]}">{esc(option)}</button>'
            for i, option in enumerate(options)
        )
        return f"""      <div class="quiz-q" data-type="mc" data-answer="{values[answer_index]}">
        <p class="quiz-qtext"><span class="qtype">객관식</span>{prompt}</p>
        <div class="quiz-opts">
{options}
        </div>
        <div class="quiz-feedback"></div>
      </div>"""
    if quiz["type"] == "ox":
        return f"""      <div class="quiz-q" data-type="ox" data-answer="{esc(quiz['answer'])}">
        <p class="quiz-qtext"><span class="qtype">OX</span>{prompt}</p>
        <div class="quiz-opts">
          <button class="quiz-opt" data-val="o">O</button>
          <button class="quiz-opt" data-val="x">X</button>
        </div>
        <div class="quiz-feedback"></div>
      </div>"""
    answers = [v.strip() for v in str(quiz["answer"]).split(",") if v.strip()]
    accept = html.escape(json.dumps(answers, ensure_ascii=False), quote=True)
    return f"""      <div class="quiz-q" data-type="short" data-accept="{accept}">
        <p class="quiz-qtext"><span class="qtype">주관식</span>{prompt}</p>
        <div class="quiz-short">
          <input type="text" placeholder="정답 입력..." aria-label="주관식 정답">
          <button class="quiz-check">확인</button>
        </div>
        <div class="quiz-feedback"></div>
      </div>"""


def build_page(data: dict[str, object]) -> str:
    template_path = SITE_DIR / "template" / "lecture-template.html"
    page = template_path.read_text(encoding="utf-8")
    title = str(data["title"])
    subtitle = str(data["subtitle"] or data["description"])
    page = page.replace("[강의 제목]", esc(title))
    page = page.replace("[한 줄 부제]", esc(subtitle))
    display_titles = data["display"]["title"]
    page = re.sub(
        r"<title>SKALA \| .*? - 복습노트</title>",
        f"<title>SKALA | {esc(display_titles['document'])} - 복습노트</title>",
        page,
        count=1,
    )
    page = re.sub(
        r'<span class="crumb-cur">.*?</span>',
        f'<span class="crumb-cur">{esc(display_titles["breadcrumb"])}</span>',
        page,
        count=1,
    )
    page = re.sub(
        r"(<nav class=\"sidebar\" id=\"sidebar\">\s*<h1>).*?(</h1>)",
        rf"\1SKALA {esc(display_titles['sidebar'])}\2",
        page,
        count=1,
        flags=re.DOTALL,
    )
    page = re.sub(
        r'(<div class="page-head">\s*<h1>).*?(</h1>)',
        rf"\1{esc(display_titles['page'])} — 복습노트\2",
        page,
        count=1,
        flags=re.DOTALL,
    )
    page = re.sub(
        r'<p>\[강의 설명 한두 줄.*?</p>',
        f"<p>{esc(data['description'])}</p>",
        page,
        count=1,
    )
    badge_html = "".join(f"<span>{esc(keyword)}</span>" for keyword in data["display"]["keywords"]["page"])
    page = re.sub(r'<div class="badges">.*?</div>', f'<div class="badges">{badge_html}</div>', page, count=1)

    nav_parts = []
    body_parts = []
    global_section = 0
    for p_index, part in enumerate(data["parts"], 1):
        color = f"p{min(p_index, 4)}"
        nav_links = []
        for section in part["sections"]:
            global_section += 1
            nav_links.append(
                f'      <a class="navlink" href="#s{global_section}" data-sec="{global_section}">'
                f"{global_section}. {esc(section['navTitle'])}</a>"
            )
            blocks = "\n\n".join(
                render_block(block, block_index)
                for block_index, block in enumerate(section["blocks"])
                if block["content"]
            )
            summary = (
                f'      <div class="tldr"><span class="icon">💡</span>'
                f'<div class="txt"><b>쉽게 말하면:</b> {esc(section["summary"])}</div></div>'
                if section["summary"]
                else ""
            )
            body_parts.append(
                f"""    <section class="sec" id="s{global_section}" data-part="{p_index}">
      <div class="sec-head">
        <span class="part-badge {color}">파트 {p_index}</span>
        <h2><span class="num">{global_section}.</span> {esc(section['title'])}</h2>
      </div>
      <p class="subtitle">{esc(section['keywords'])}</p>

{summary}
{blocks}
    </section>"""
            )
        if part["quizzes"]:
            nav_links.append(
                f'      <a class="navlink" href="#quiz-p{p_index}" '
                f'style="color:var(--accent2);">✅ 파트 {p_index} 퀴즈</a>'
            )
            quizzes = "\n\n".join(render_quiz(quiz) for quiz in part["quizzes"])
            body_parts.append(
                f"""    <div class="quiz-wrap" id="quiz-p{p_index}">
      <h2>✅ 파트 {p_index} 퀴즈</h2>
      <p>배운 내용을 바로 확인해보세요.</p>
      <div class="quiz-score">0 / {len(part['quizzes'])} 정답</div>

{quizzes}
    </div>"""
            )
        nav_parts.append(
            f"""    <div class="part-group">
      <div class="part-title {color}">파트 {p_index} — {esc(part['title'])}</div>
{chr(10).join(nav_links)}
    </div>"""
        )

    page = re.sub(
        r'    <!-- ③ 파트/섹션 목록:.*?</div>\s*</nav>',
        "    <!-- 강의 제작 스튜디오에서 자동 생성한 목차 -->\n"
        + "\n".join(nav_parts)
        + "\n  </nav>",
        page,
        count=1,
        flags=re.DOTALL,
    )
    page = re.sub(
        r'    <!-- ④ 섹션 템플릿:.*?\n\s*</main>',
        "    <!-- 강의 제작 스튜디오에서 자동 생성한 본문 -->\n"
        + "\n\n".join(body_parts)
        + "\n\n  </main>",
        page,
        count=1,
        flags=re.DOTALL,
    )
    return page


def render_home_card(data: dict[str, object], folder: str) -> str:
    tags = "".join(f"<span>{esc(keyword)}</span>" for keyword in data["display"]["keywords"]["home"][:5])
    return f"""    <a class="card" href="lectures/{esc(folder)}/index.html" data-lecture="{esc(folder)}">
      <span class="status done">완료</span>
      <h3>{esc(data['display']['title']['home'])}</h3>
      <p>{esc(data['description'])}</p>
      <div class="tags">{tags}</div>
    </a>"""


def update_home(data: dict[str, object], folder: str) -> str:
    index_path = SITE_DIR / "index.html"
    text = index_path.read_text(encoding="utf-8")
    card = render_home_card(data, folder)
    existing_pattern = re.compile(
        rf'\s*<a class="card"[^>]*data-lecture="{re.escape(folder)}".*?</a>',
        re.DOTALL,
    )
    if existing_pattern.search(text):
        return existing_pattern.sub("\n" + card, text, count=1)
    todo_marker = '    <div class="card todo">'
    if todo_marker not in text:
        raise ValueError("홈에서 '준비 중' 카드를 찾지 못해 자동 등록할 수 없습니다.")
    return text.replace(todo_marker, card + "\n" + todo_marker, 1)


def validate_generated_html(page: str, data: dict[str, object]) -> list[str]:
    errors = []
    if "[강의 제목]" in page or "[섹션 제목]" in page or "[문제 내용]" in page:
        errors.append("템플릿 자리표시자가 남아 있습니다.")
    ids = re.findall(r'\bid="([^"]+)"', page)
    duplicates = sorted({value for value in ids if ids.count(value) > 1})
    if duplicates:
        errors.append("중복된 화면 ID가 있습니다: " + ", ".join(duplicates))
    hrefs = re.findall(r'href="#([^"]+)"', page)
    missing = sorted({value for value in hrefs if value not in ids})
    if missing:
        errors.append("목차가 찾지 못하는 섹션이 있습니다: " + ", ".join(missing))
    if page.count('class="sec"') != sum(len(part["sections"]) for part in data["parts"]):
        errors.append("입력한 섹션 수와 생성된 섹션 수가 다릅니다.")
    return errors


def create_page(raw: object, overwrite: bool = False) -> dict[str, object]:
    data = normalize_payload(raw)
    errors, warnings = validate_payload(data)
    if errors:
        return {"ok": False, "errors": errors, "warnings": warnings}
    folder = f"{data['number']}-{data['slug']}"
    lecture_dir = SITE_DIR / "lectures" / folder
    index_path = lecture_dir / "index.html"
    if index_path.exists() and not overwrite:
        return {
            "ok": False,
            "needsOverwrite": True,
            "errors": [f"{folder}에 이미 페이지가 있어요. 기존 파일 보호를 위해 멈췄습니다."],
            "warnings": warnings,
        }
    page = build_page(data)
    generated_errors = validate_generated_html(page, data)
    if generated_errors:
        return {"ok": False, "errors": generated_errors, "warnings": warnings}
    home_text = update_home(data, folder)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = DATA_DIR / "backups" / stamp / "lectures" / folder / "index.html"
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(index_path, backup)
    lecture_dir.mkdir(parents=True, exist_ok=True)
    index_path.write_text(page, encoding="utf-8")
    (SITE_DIR / "index.html").write_text(home_text, encoding="utf-8")
    manifest = {
        "folder": folder,
        "title": data["title"],
        "files": [f"lectures/{folder}/index.html", "index.html"],
        "createdAt": datetime.now().isoformat(timespec="seconds"),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "folder": folder,
        "previewUrl": f"/preview/lectures/{folder}/index.html",
        "warnings": warnings,
        "checks": [
            "필수 입력 확인",
            "템플릿 자리표시자 제거",
            "목차와 섹션 연결 확인",
            "중복 화면 ID 확인",
            "홈 강의 카드 등록",
        ],
    }


def resolve_lecture(folder: str) -> Path:
    if not FOLDER_RE.fullmatch(folder):
        raise ValueError("강의 폴더 이름이 올바르지 않습니다.")
    target = (SITE_DIR / "lectures" / folder / "index.html").resolve()
    lectures_root = (SITE_DIR / "lectures").resolve()
    if lectures_root not in target.parents or not target.is_file():
        raise ValueError("선택한 강의 페이지를 찾을 수 없습니다.")
    return target


class StructureParser(html.parser.HTMLParser):
    """Capture markup and protected attributes while ignoring authored text."""

    PROTECTED_ATTRS = {
        "class", "id", "href", "src", "style", "data-part", "data-sec",
        "data-type", "data-answer", "data-accept", "data-val",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.events: list[tuple[object, ...]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        protected = tuple(sorted((key, value or "") for key, value in attrs if key in self.PROTECTED_ATTRS))
        self.events.append(("start", tag, protected))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        protected = tuple(sorted((key, value or "") for key, value in attrs if key in self.PROTECTED_ATTRS))
        self.events.append(("empty", tag, protected))

    def handle_endtag(self, tag: str) -> None:
        self.events.append(("end", tag))

    def handle_comment(self, data: str) -> None:
        self.events.append(("comment", data.strip()))


def structure_signature(source: str) -> list[tuple[object, ...]]:
    parser = StructureParser()
    parser.feed(source)
    return parser.events


def protected_blocks(source: str, tag: str) -> list[str]:
    return re.findall(rf"<{tag}\b[^>]*>.*?</{tag}>", source, flags=re.IGNORECASE | re.DOTALL)


def save_existing(folder: str, edited_html: str) -> dict[str, object]:
    path = resolve_lecture(folder)
    if len(edited_html.encode("utf-8")) > 2_000_000:
        return {"ok": False, "message": "페이지가 예상보다 커서 저장을 중단했습니다."}
    original = path.read_text(encoding="utf-8")
    if protected_blocks(original, "style") != protected_blocks(edited_html, "style"):
        return {"ok": False, "message": "디자인 규칙(CSS)이 달라져 저장을 막았습니다."}
    if protected_blocks(original, "script") != protected_blocks(edited_html, "script"):
        return {"ok": False, "message": "페이지 기능(JavaScript)이 달라져 저장을 막았습니다."}
    if structure_signature(original) != structure_signature(edited_html):
        return {"ok": False, "message": "페이지 구조나 링크가 달라져 저장을 막았습니다."}
    if original == edited_html:
        return {"ok": False, "message": "바뀐 내용이 없습니다."}

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = DATA_DIR / "backups" / stamp / "lectures" / folder / "index.html"
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup)
    path.write_text(edited_html, encoding="utf-8")
    title_match = re.search(r'<span class="crumb-cur">(.*?)</span>', edited_html, flags=re.DOTALL)
    title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else folder
    manifest = {
        "folder": folder,
        "title": html.unescape(title),
        "files": [f"lectures/{folder}/index.html"],
        "createdAt": datetime.now().isoformat(timespec="seconds"),
        "mode": "edit",
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        "ok": True,
        "folder": folder,
        "previewUrl": f"/preview/lectures/{folder}/index.html",
        "checks": ["CSS 원본 유지", "JavaScript 원본 유지", "HTML 구조 유지", "링크와 화면 ID 유지", "기존 파일 백업"],
    }


def deployment_readiness() -> dict[str, object]:
    if not MANIFEST_PATH.exists():
        return {"ok": False, "message": "먼저 페이지를 만들어주세요."}
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    files = manifest.get("files", [])
    if not files or not all((SITE_DIR / value).exists() for value in files):
        return {"ok": False, "message": "마지막 생성 파일을 찾을 수 없습니다."}
    status = git_status()
    unrelated = [item for item in status if item["path"] not in files]
    diff = run_git("diff", "--", *files, check=False).stdout
    untracked = [item["path"] for item in status if item["code"] == "??" and item["path"] in files]
    return {
        "ok": True,
        "manifest": manifest,
        "files": files,
        "unrelatedChanges": unrelated,
        "diffSummary": diff[:20000],
        "untracked": untracked,
        "siteUrl": site_url(),
        "branch": run_git("branch", "--show-current", check=False).stdout.strip(),
    }


def open_vscode() -> dict[str, object]:
    readiness = deployment_readiness()
    if not readiness.get("ok"):
        return readiness
    manifest = readiness["manifest"]
    try:
        subprocess.Popen(
            ["code", "--reuse-window", str(SITE_DIR)],
            cwd=str(SITE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        is_edit = manifest.get("mode") == "edit"
        return {
            "ok": True,
            "message": "VS Code를 열었습니다. 왼쪽 소스 제어에서 변경사항을 확인해주세요.",
            "commitMessage": f"{'docs' if is_edit else 'add'}: {manifest['title']} 강의 {'수정' if is_edit else '추가'}",
        }
    except (OSError, FileNotFoundError) as exc:
        return {"ok": False, "message": "VS Code를 열지 못했습니다.", "detail": str(exc)}


def load_custom_templates() -> list[dict[str, object]]:
    if not CUSTOM_TEMPLATES_PATH.exists():
        return []
    try:
        value = json.loads(CUSTOM_TEMPLATES_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_custom_template(raw: object) -> dict[str, object]:
    if not isinstance(raw, dict):
        return {"ok": False, "message": "템플릿 입력 형식이 올바르지 않습니다."}
    name = clean_text(raw.get("name"), 60)
    template_data = raw.get("data")
    if len(name) < 2:
        return {"ok": False, "message": "템플릿 이름을 두 글자 이상 입력해주세요."}
    if not isinstance(template_data, dict):
        return {"ok": False, "message": "저장할 템플릿 구조가 없습니다."}
    encoded = json.dumps(template_data, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 500_000:
        return {"ok": False, "message": "템플릿 구조가 너무 큽니다."}
    templates = load_custom_templates()
    template_id = clean_text(raw.get("id"), 100) or f"custom-{int(time.time() * 1000)}"
    entry = {
        "id": template_id,
        "name": name,
        "description": clean_text(raw.get("description"), 160) or "사용자가 저장한 강의 구조",
        "data": template_data,
        "updatedAt": datetime.now().isoformat(timespec="seconds"),
    }
    templates = [item for item in templates if item.get("id") != template_id and item.get("name") != name]
    templates.append(entry)
    templates = templates[-20:]
    CUSTOM_TEMPLATES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_TEMPLATES_PATH.write_text(
        json.dumps(templates, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"ok": True, "template": entry, "message": f"'{name}' 템플릿을 저장했습니다."}


def delete_custom_template(template_id: str) -> dict[str, object]:
    templates = load_custom_templates()
    remaining = [item for item in templates if item.get("id") != template_id]
    if len(remaining) == len(templates):
        return {"ok": False, "message": "삭제할 사용자 템플릿을 찾지 못했습니다."}
    CUSTOM_TEMPLATES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_TEMPLATES_PATH.write_text(
        json.dumps(remaining, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"ok": True}


class StudioHandler(SimpleHTTPRequestHandler):
    server_version = "LectureStudio/1.0"

    def log_message(self, format_string: str, *args: object) -> None:
        sys.stdout.write(f"[{self.log_date_time_string()}] {format_string % args}\n")

    def send_json(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> object:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("입력 내용이 너무 큽니다.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path == "/api/context":
            self.send_json(context_payload())
            return
        if path == "/api/templates":
            self.send_json({"ok": True, "templates": load_custom_templates()})
            return
        if path == "/api/existing":
            try:
                folder = clean_text(parse_qs(parsed.query).get("folder", [""])[0], 100)
                lecture_path = resolve_lecture(folder)
                self.send_json(
                    {
                        "ok": True,
                        "folder": folder,
                        "previewUrl": f"/preview/lectures/{folder}/index.html",
                        "html": lecture_path.read_text(encoding="utf-8"),
                    }
                )
            except ValueError as exc:
                self.send_json({"ok": False, "message": str(exc)}, status=400)
            return
        if path == "/api/deploy/readiness":
            self.send_json(deployment_readiness())
            return
        if path == "/api/git-guide":
            guide_path = SITE_DIR / "template" / "git-command-examples.md"
            self.send_json({"ok": True, "content": guide_path.read_text(encoding="utf-8")})
            return
        if path.startswith("/preview/"):
            relative = path.removeprefix("/preview/").lstrip("/")
            target = (SITE_DIR / relative).resolve()
            if SITE_DIR not in target.parents or not target.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self.serve_file(target)
            return
        if path == "/" or path == "/index.html":
            self.serve_file(STATIC_DIR / "index.html")
            return
        target = (STATIC_DIR / path.lstrip("/")).resolve()
        if STATIC_DIR in target.parents and target.is_file():
            self.serve_file(target)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_file(self, target: Path) -> None:
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_types.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            payload = self.read_json()
            if self.path == "/api/validate":
                data = normalize_payload(payload)
                errors, warnings = validate_payload(data)
                self.send_json({"ok": not errors, "errors": errors, "warnings": warnings})
                return
            if self.path == "/api/preview-draft":
                data = normalize_payload(payload)
                self.send_json({"ok": True, "html": build_page(data)})
                return
            if self.path == "/api/templates/save":
                self.send_json(save_custom_template(payload))
                return
            if self.path == "/api/templates/delete":
                template_id = clean_text(payload.get("id"), 100) if isinstance(payload, dict) else ""
                self.send_json(delete_custom_template(template_id))
                return
            if self.path == "/api/create":
                overwrite = bool(payload.pop("_overwrite", False)) if isinstance(payload, dict) else False
                self.send_json(create_page(payload, overwrite=overwrite))
                return
            if self.path == "/api/save-existing":
                folder = clean_text(payload.get("folder"), 100) if isinstance(payload, dict) else ""
                edited_html = str(payload.get("html") or "") if isinstance(payload, dict) else ""
                self.send_json(save_existing(folder, edited_html))
                return
            if self.path == "/api/open-vscode":
                self.send_json(open_vscode())
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "message": str(exc)}, status=400)
        except Exception as exc:  # keep UI useful while reporting unexpected local errors
            self.send_json({"ok": False, "message": "처리 중 오류가 발생했습니다.", "detail": str(exc)}, status=500)


def main() -> None:
    parser = argparse.ArgumentParser(description="SKALA 강의 제작 스튜디오")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer((args.host, args.port), StudioHandler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        print(f"{args.port}번 주소를 다른 앱이 사용 중이라 빈 주소를 자동 선택합니다.", flush=True)
        server = ThreadingHTTPServer((args.host, 0), StudioHandler)
    actual_port = server.server_address[1]
    url = f"http://{args.host}:{actual_port}/"
    print(f"강의 제작 스튜디오: {url}", flush=True)
    print("종료하려면 이 창에서 Ctrl+C를 누르세요.", flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n강의 제작 스튜디오를 종료합니다.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

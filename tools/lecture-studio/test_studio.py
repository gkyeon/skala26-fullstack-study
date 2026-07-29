import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("main.py")
SPEC = importlib.util.spec_from_file_location("lecture_studio_server", MODULE_PATH)
studio = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(studio)


def complete_payload():
    return {
        "number": "04",
        "slug": "spring-basics",
        "title": "Spring Boot 기초",
        "subtitle": "웹 애플리케이션의 시작",
        "description": "Spring Boot의 구조와 실행 흐름을 익힙니다.",
        "keywords": ["Spring", "MVC"],
        "parts": [
            {
                "title": "핵심 개념",
                "sections": [
                    {
                        "title": "MVC 이해",
                        "keywords": "Model, View, Controller",
                        "summary": "역할을 셋으로 나누어 관리하는 방식입니다.",
                        "blocks": [
                            {"type": "text", "heading": "개념", "content": "각 역할을 분리합니다."},
                            {"type": "list", "heading": "핵심", "content": "Model\nView\nController"},
                            {"type": "code", "heading": "예시", "content": 'println("<safe>")'},
                            {"type": "note", "heading": "", "content": "역할을 섞지 마세요."},
                        ],
                    }
                ],
                "quizzes": [
                    {
                        "type": "mc",
                        "prompt": "요청을 받는 역할은?",
                        "options": ["Model", "Controller", "View"],
                        "answer": "1",
                    },
                    {"type": "ox", "prompt": "MVC는 역할을 나눈다.", "options": [], "answer": "o"},
                    {"type": "short", "prompt": "C의 의미는?", "options": [], "answer": "Controller,컨트롤러"},
                ],
            }
        ],
    }


class StudioTests(unittest.TestCase):
    def test_complete_payload_validates(self):
        data = studio.normalize_payload(complete_payload())
        errors, warnings = studio.validate_payload(data)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_missing_content_is_rejected(self):
        payload = complete_payload()
        payload["parts"][0]["sections"][0]["blocks"][0]["content"] = ""
        payload["parts"][0]["sections"][0]["blocks"] = payload["parts"][0]["sections"][0]["blocks"][:1]
        data = studio.normalize_payload(payload)
        errors, _ = studio.validate_payload(data)
        self.assertTrue(any("본문 내용" in error for error in errors))

    def test_page_matches_template_contract(self):
        data = studio.normalize_payload(complete_payload())
        page = studio.build_page(data)
        self.assertEqual(studio.validate_generated_html(page, data), [])
        self.assertIn("Spring Boot 기초", page)
        self.assertIn('href="#s1"', page)
        self.assertIn('id="quiz-p1"', page)
        self.assertIn("&lt;safe&gt;", page)
        self.assertNotIn("[강의 제목]", page)
        self.assertNotIn("[섹션 제목]", page)

    def test_blank_quiz_can_render_for_live_preview(self):
        payload = complete_payload()
        payload["parts"][0]["quizzes"][0]["options"] = ["", "", ""]
        payload["parts"][0]["quizzes"][0]["answer"] = ""
        data = studio.normalize_payload(payload)
        page = studio.build_page(data)
        self.assertIn("보기 1", page)
        self.assertIn('data-answer="a"', page)

    def test_home_card_escapes_authored_text(self):
        data = studio.normalize_payload(complete_payload())
        data["title"] = "<script>alert(1)</script>"
        data["display"]["title"]["home"] = data["title"]
        card = studio.render_home_card(data, "04-spring-basics")
        self.assertNotIn("<script>", card)
        self.assertIn("&lt;script&gt;", card)

    def test_slug_rules(self):
        payload = complete_payload()
        payload["slug"] = "../bad folder"
        data = studio.normalize_payload(payload)
        errors, _ = studio.validate_payload(data)
        self.assertTrue(any("영문 주소" in error for error in errors))

    def test_unlinked_title_and_keywords_have_separate_outputs(self):
        payload = complete_payload()
        payload["sharing"] = {
            "title": {
                "breadcrumb": {"linked": False, "value": "짧은 경로 제목"},
                "home": {"linked": False, "value": "홈 전용 제목"},
            },
            "keywords": {
                "home": {"linked": False, "value": "홈태그,별도태그"},
            },
        }
        data = studio.normalize_payload(payload)
        page = studio.build_page(data)
        card = studio.render_home_card(data, "04-spring-basics")
        self.assertIn('<span class="crumb-cur">짧은 경로 제목</span>', page)
        self.assertIn("<h3>홈 전용 제목</h3>", card)
        self.assertIn("<span>홈태그</span>", card)
        self.assertNotIn("<span>Spring</span>", card)

    def test_structure_signature_ignores_text_only(self):
        before = '<div class="sec" id="s1"><a href="#x">기존 글자</a></div>'
        after = '<div class="sec" id="s1"><a href="#x">바꾼 글자</a></div>'
        self.assertEqual(studio.structure_signature(before), studio.structure_signature(after))

    def test_structure_signature_detects_design_or_link_change(self):
        before = '<div class="sec"><a href="#x">글자</a></div>'
        changed_class = '<div class="other"><a href="#x">글자</a></div>'
        changed_link = '<div class="sec"><a href="#y">글자</a></div>'
        self.assertNotEqual(studio.structure_signature(before), studio.structure_signature(changed_class))
        self.assertNotEqual(studio.structure_signature(before), studio.structure_signature(changed_link))

    def test_existing_edit_backs_up_text_change_and_rejects_css_change(self):
        original_site = studio.SITE_DIR
        original_data = studio.DATA_DIR
        original_manifest = studio.MANIFEST_PATH
        try:
            with tempfile.TemporaryDirectory() as temp:
                site = Path(temp)
                page_path = site / "lectures" / "03-test" / "index.html"
                page_path.parent.mkdir(parents=True)
                source = (
                    '<!doctype html><html><head><style>.x{color:red}</style></head>'
                    '<body><a class="x" href="#s1">기존 제목</a><section id="s1">본문</section>'
                    '<script>const x=1;</script></body></html>'
                )
                page_path.write_text(source, encoding="utf-8")
                studio.SITE_DIR = site
                studio.DATA_DIR = site / ".lecture-studio-data"
                studio.MANIFEST_PATH = studio.DATA_DIR / "last-generation.json"

                changed_text = source.replace("기존 제목", "새 제목")
                result = studio.save_existing("03-test", changed_text)
                self.assertTrue(result["ok"])
                self.assertIn("새 제목", page_path.read_text(encoding="utf-8"))
                self.assertEqual(len(list((studio.DATA_DIR / "backups").rglob("index.html"))), 1)

                changed_css = changed_text.replace("color:red", "color:blue")
                rejected = studio.save_existing("03-test", changed_css)
                self.assertFalse(rejected["ok"])
                self.assertIn("CSS", rejected["message"])
        finally:
            studio.SITE_DIR = original_site
            studio.DATA_DIR = original_data
            studio.MANIFEST_PATH = original_manifest

    def test_custom_template_save_and_delete(self):
        original_data = studio.DATA_DIR
        original_custom = studio.CUSTOM_TEMPLATES_PATH
        try:
            with tempfile.TemporaryDirectory() as temp:
                studio.DATA_DIR = Path(temp)
                studio.CUSTOM_TEMPLATES_PATH = studio.DATA_DIR / "custom-templates.json"
                saved = studio.save_custom_template(
                    {
                        "name": "김상훈 템플릿",
                        "description": "학습 목표부터 실습까지",
                        "data": {"mode": "guided", "parts": [{"title": "핵심"}]},
                    }
                )
                self.assertTrue(saved["ok"])
                self.assertEqual(studio.load_custom_templates()[0]["name"], "김상훈 템플릿")
                deleted = studio.delete_custom_template(saved["template"]["id"])
                self.assertTrue(deleted["ok"])
                self.assertEqual(studio.load_custom_templates(), [])
        finally:
            studio.DATA_DIR = original_data
            studio.CUSTOM_TEMPLATES_PATH = original_custom


if __name__ == "__main__":
    unittest.main()

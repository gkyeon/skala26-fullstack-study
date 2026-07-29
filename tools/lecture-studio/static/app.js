const DRAFT_KEY = "skala-lecture-studio-draft-v2";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const newBlock = (type = "text") => ({ id: uid(), type, heading: "", content: "" });
const newSection = () => ({
  id: uid(), title: "", navTitle: "", linkTitle: true, keywords: "", summary: "", blocks: [newBlock("text")],
});
const newPart = () => ({ id: uid(), title: "", sections: [newSection()], quizzes: [] });
const newQuiz = (type) => ({
  id: uid(), type, prompt: "", options: type === "mc" ? ["", "", ""] : [], answer: type === "ox" ? "o" : "",
});
const emptyState = () => ({
  number: "", slug: "", title: "", subtitle: "", description: "", keywords: "",
  mode: "guided", templateId: "official", freeContent: "",
  sharing: {
    title: {
      document: { linked: true, value: "" },
      breadcrumb: { linked: true, value: "" },
      sidebar: { linked: true, value: "" },
      page: { linked: true, value: "" },
      home: { linked: true, value: "" },
    },
    keywords: {
      page: { linked: true, value: "" },
      home: { linked: true, value: "" },
    },
  },
  parts: [newPart()], created: null,
});

let state = emptyState();
let context = null;
let customTemplates = [];
let currentStep = 1;
let saveTimer = null;
let previewTimer = null;
let activePreviewTarget = ".page-head";

function officialStructure() {
  const part = newPart();
  part.title = "학습 목표와 핵심 개념";
  const section = part.sections[0];
  section.title = "핵심 개념";
  section.blocks = [
    { ...newBlock("text"), heading: "개념 설명" },
    { ...newBlock("list"), heading: "핵심 포인트" },
    { ...newBlock("code"), heading: "예제·실습" },
    { ...newBlock("note"), heading: "체크포인트" },
  ];
  part.quizzes = [newQuiz("mc"), newQuiz("ox"), newQuiz("short")];
  return [part];
}

function sanghunStructure() {
  const concept = newSection();
  concept.title = "왜 배우는가";
  concept.blocks = [
    { ...newBlock("text"), heading: "학습 목표" },
    { ...newBlock("text"), heading: "쉽게 이해하기" },
    { ...newBlock("list"), heading: "핵심 개념" },
  ];
  const practice = newSection();
  practice.title = "예제와 실습";
  practice.blocks = [
    { ...newBlock("code"), heading: "따라 해보기" },
    { ...newBlock("text"), heading: "실행 결과와 해석" },
    { ...newBlock("note"), heading: "헷갈리기 쉬운 점" },
  ];
  const part = { id: uid(), title: "이해 → 적용 → 확인", sections: [concept, practice], quizzes: [newQuiz("mc"), newQuiz("short")] };
  return [part];
}

const BUILTIN_FORMATS = [
  { id: "official", icon: "▦", name: "공식 템플릿", description: "기존 사이트 형식 · 핵심 개념, 예제, 팁, 퀴즈", badge: "기본" },
  { id: "sanghun", icon: "✦", name: "김상훈 템플릿", description: "학습 목표부터 실습·해석까지 순서대로", badge: "추천" },
  { id: "free", icon: "≡", name: "자유 작성", description: "정해진 섹션 없이 하나의 본문으로 작성", badge: "" },
];

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

function payload() {
  const freeParts = [{
    id: "free-part",
    title: "자유 작성",
    sections: [{
      id: "free-section",
      title: state.title || "자유 노트",
      navTitle: state.title || "자유 노트",
      keywords: state.keywords,
      summary: "",
      blocks: [{ id: "free-block", type: "text", heading: "", content: state.freeContent }],
    }],
    quizzes: [],
  }];
  return {
    number: state.number,
    slug: state.slug,
    title: state.title,
    subtitle: state.subtitle,
    description: state.description,
    keywords: state.keywords.split(",").map((v) => v.trim()).filter(Boolean),
    sharing: state.sharing,
    parts: (state.mode === "free" ? freeParts : state.parts).map((part) => ({
      title: part.title,
      sections: part.sections.map((section) => ({
        id: section.id,
        title: section.title,
        navTitle: section.linkTitle === false ? section.navTitle : section.title,
        keywords: section.keywords,
        summary: section.summary,
        blocks: section.blocks.map(({ id, type, heading, content }) => ({ id, type, heading, content })),
      })),
      quizzes: part.quizzes.map(({ type, prompt, options, answer }) => ({ type, prompt, options, answer })),
    })),
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "요청을 처리하지 못했습니다.");
  return body;
}

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  $("#toastRegion").append(item);
  setTimeout(() => item.remove(), 2800);
}

function notice(message, error = false) {
  const node = $("#globalNotice");
  node.textContent = message;
  node.className = `notice${error ? " error" : ""}`;
  node.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearNotice() {
  $("#globalNotice").classList.add("hidden");
}

function normalizeState(saved = {}) {
  const base = emptyState();
  const merged = { ...base, ...saved };
  merged.sharing = {
    title: { ...base.sharing.title, ...(saved.sharing?.title || {}) },
    keywords: { ...base.sharing.keywords, ...(saved.sharing?.keywords || {}) },
  };
  merged.parts = (saved.parts?.length ? saved.parts : base.parts).map((part) => ({
    ...newPart(),
    ...part,
    sections: (part.sections?.length ? part.sections : [newSection()]).map((section) => ({
      ...newSection(),
      ...section,
      navTitle: section.navTitle || section.title || "",
      linkTitle: section.linkTitle !== false,
      blocks: (section.blocks?.length ? section.blocks : [newBlock()]).map((block) => ({ ...newBlock(block.type), ...block })),
    })),
    quizzes: (part.quizzes || []).map((quiz) => ({ ...newQuiz(quiz.type), ...quiz })),
  }));
  return merged;
}

function applyFormat(formatId, templateData = null) {
  const hasContent = state.freeContent.trim() || state.parts.some((part) =>
    part.sections.some((section) => section.summary.trim() || section.blocks.some((block) => block.content.trim()))
    || part.quizzes.some((quiz) => quiz.prompt.trim())
  );
  if (formatId !== state.templateId && hasContent && !confirm("작성 중인 본문 구조가 선택한 템플릿으로 바뀝니다. 기본 정보는 유지할까요?")) return;
  const keep = {
    number: state.number, slug: state.slug, title: state.title, subtitle: state.subtitle,
    description: state.description, keywords: state.keywords, sharing: state.sharing,
  };
  if (templateData) {
    state = normalizeState({ ...state, ...templateData, ...keep, templateId: formatId });
  } else if (formatId === "official") {
    state = normalizeState({ ...state, ...keep, mode: "guided", templateId: formatId, parts: officialStructure() });
  } else if (formatId === "sanghun") {
    state = normalizeState({ ...state, ...keep, mode: "guided", templateId: formatId, parts: sanghunStructure() });
  } else {
    state = normalizeState({ ...state, ...keep, mode: "free", templateId: "free", freeContent: state.freeContent || "" });
  }
  state.created = null;
  renderFormats();
  renderSharingControls();
  renderParts();
  renderQuizzes();
  syncModeEditor();
  updateSummary();
  toast(`'${[...BUILTIN_FORMATS, ...customTemplates].find((item) => item.id === formatId)?.name || "사용자"}' 형식을 적용했어요.`);
}

function renderFormats() {
  $("#formatGrid").innerHTML = BUILTIN_FORMATS.map((format) => `
    <button class="format-card ${state.templateId === format.id ? "active" : ""}" type="button" data-format-id="${format.id}">
      ${format.badge ? `<span class="format-badge">${format.badge}</span>` : ""}
      <span class="format-icon">${format.icon}</span>
      <strong>${format.name}</strong>
      <small>${format.description}</small>
    </button>
  `).join("");
  const library = $("#templateLibrary");
  library.classList.toggle("hidden", customTemplates.length === 0);
  library.innerHTML = customTemplates.map((item) => `
    <span class="template-chip">
      <button type="button" data-custom-template="${escapeHtml(item.id)}" style="color:var(--ink)">${escapeHtml(item.name)}</button>
      <button type="button" data-delete-template="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.name)} 삭제">×</button>
    </span>
  `).join("");
}

const TITLE_LOCATIONS = {
  document: "브라우저 탭 제목",
  breadcrumb: "상단 경로",
  sidebar: "왼쪽 목차 제목",
  page: "본문 큰 제목",
  home: "홈 강의 카드",
};

function shareRows(groupName, labels) {
  const group = state.sharing[groupName];
  return Object.entries(labels).map(([target, label]) => {
    const item = group[target];
    return `
      <label class="share-row">
        <input type="checkbox" data-share-group="${groupName}" data-share-target="${target}" ${item.linked ? "checked" : ""}>
        <span><span class="share-location">${label}</span> · ${item.linked ? "기본 입력과 공유" : "별도 내용 사용"}</span>
        ${item.linked ? "" : `<input type="text" data-share-override="${groupName}" data-share-target="${target}" value="${escapeHtml(item.value)}" placeholder="이 위치에만 표시할 내용">`}
      </label>`;
  }).join("");
}

function renderSharingControls() {
  $("#titleSharing").innerHTML = `
    <button class="share-summary" type="button" data-toggle-share="title"><span>⛓ 제목 공유 위치</span><span>${Object.values(state.sharing.title).filter((v) => v.linked).length}/5 연결</span></button>
    <div class="share-options">${shareRows("title", TITLE_LOCATIONS)}</div>
  `;
  $("#keywordSharing").innerHTML = `
    <button class="share-summary" type="button" data-toggle-share="keywords"><span>⛓ 키워드 공유 위치</span><span>${Object.values(state.sharing.keywords).filter((v) => v.linked).length}/2 연결</span></button>
    <div class="share-options">${shareRows("keywords", { page: "강의 상단 태그", home: "홈 카드 태그" })}</div>
  `;
}

function syncModeEditor() {
  const free = state.mode === "free";
  $("#partsEditor").classList.toggle("hidden", free);
  $("#freeEditor").classList.toggle("hidden", !free);
  $("#addPartBtn").classList.toggle("hidden", free);
  $(".writing-tip").classList.toggle("hidden", free);
  $("#freeContent").value = state.freeContent || "";
}

function templateStructureData() {
  return {
    mode: state.mode,
    freeContent: "",
    sharing: state.sharing,
    parts: state.parts.map((part) => ({
      ...part,
      id: uid(),
      sections: part.sections.map((section) => ({
        ...section,
        id: uid(),
        summary: "",
        keywords: "",
        blocks: section.blocks.map((block) => ({ ...block, id: uid(), content: "" })),
      })),
      quizzes: part.quizzes.map((quiz) => ({
        ...quiz, id: uid(), prompt: "", options: quiz.type === "mc" ? ["", "", ""] : [], answer: quiz.type === "ox" ? "o" : "",
      })),
    })),
  };
}

function showSaveTemplateModal() {
  openModal(`
    <span class="eyebrow">MY TEMPLATE</span>
    <h2 id="modalTitle">현재 구조를 템플릿으로 저장</h2>
    <p>작성한 실제 내용은 빼고 파트·섹션·블록·퀴즈 구성과 공유 규칙만 저장합니다.</p>
    <label class="field"><span>템플릿 이름</span><input id="templateName" placeholder="예: 김상훈 백엔드 템플릿" maxlength="60"></label>
    <label class="field"><span>설명</span><input id="templateDescription" placeholder="언제 사용하는 구조인지 짧게 적어주세요." maxlength="160"></label>
    <div class="modal-actions"><button class="secondary-btn" type="button" data-modal-close>취소</button><button class="primary-btn" type="button" data-save-template>저장</button></div>
  `);
}

async function saveTemplateFromModal() {
  const result = await api("/api/templates/save", {
    method: "POST",
    body: JSON.stringify({
      name: $("#templateName").value,
      description: $("#templateDescription").value,
      data: templateStructureData(),
    }),
  });
  if (!result.ok) return toast(result.message);
  customTemplates = customTemplates.filter((item) => item.id !== result.template.id && item.name !== result.template.name);
  customTemplates.push(result.template);
  closeModal();
  renderFormats();
  toast(result.message);
}

async function deleteTemplate(templateId) {
  const result = await api("/api/templates/delete", { method: "POST", body: JSON.stringify({ id: templateId }) });
  if (!result.ok) return toast(result.message);
  customTemplates = customTemplates.filter((item) => item.id !== templateId);
  if (state.templateId === templateId) state.templateId = "official";
  renderFormats();
  toast("사용자 템플릿을 삭제했어요.");
}

function schedulePreview(target = activePreviewTarget) {
  activePreviewTarget = target || activePreviewTarget;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateLivePreview, 220);
}

async function updateLivePreview() {
  try {
    const result = await api("/api/preview-draft", { method: "POST", body: JSON.stringify(payload()) });
    const frame = $("#livePreviewFrame");
    frame.onload = () => focusLivePreview(activePreviewTarget);
    frame.srcdoc = result.html;
  } catch {
    $("#previewFocusLabel").textContent = "미리보기를 준비하는 중";
  }
}

function focusLivePreview(target) {
  const frame = $("#livePreviewFrame");
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.querySelector("[data-live-focus]")?.removeAttribute("data-live-focus");
  doc.querySelector("#lecture-studio-live-style")?.remove();
  const style = doc.createElement("style");
  style.id = "lecture-studio-live-style";
  style.textContent = '[data-live-focus="true"]{outline:4px solid #516ee8!important;outline-offset:5px;box-shadow:0 0 0 10px rgba(81,110,232,.12)!important}';
  doc.head.append(style);
  const selected = doc.querySelector(target || ".page-head");
  if (selected) {
    selected.setAttribute("data-live-focus", "true");
    selected.scrollIntoView({ block: "center", behavior: "auto" });
    $("#previewFocusLabel").textContent = `편집 위치 · ${selected.textContent.trim().slice(0, 28) || "내용"}`;
  }
}

function saveDraft() {
  $("#saveState").innerHTML = '<span class="save-dot"></span> 저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    $("#saveState").innerHTML = '<span class="save-dot"></span> 임시저장됨';
  }, 350);
}

function updateSummary() {
  const previewParts = state.mode === "free" ? 1 : state.parts.length;
  const previewSections = state.mode === "free" ? 1 : state.parts.reduce((sum, part) => sum + part.sections.length, 0);
  const previewQuizzes = state.mode === "free" ? 0 : state.parts.reduce((sum, part) => sum + part.quizzes.length, 0);
  $("#partCount").textContent = previewParts;
  $("#sectionCount").textContent = previewSections;
  $("#quizCount").textContent = previewQuizzes;
  $("#folderPreview").textContent = `lectures/${state.number || "00"}-${state.slug || "english-name"}/`;
  $("#descriptionCount").textContent = state.description.length;
  saveDraft();
  schedulePreview();
}

function syncBasicFields() {
  ["number", "slug", "title", "subtitle", "description", "keywords"].forEach((key) => {
    const input = $(`#${key}`);
    input.value = state[key] || "";
    input.addEventListener("input", () => {
      state[key] = key === "slug" ? input.value.toLowerCase().replace(/[^a-z0-9-]/g, "") : input.value;
      if (key === "slug") input.value = state[key];
      if (key === "title" && !state.slug) {
        const proposed = slugify(input.value);
        if (proposed) {
          state.slug = proposed;
          $("#slug").value = proposed;
        }
      }
      state.created = null;
      updateSummary();
    });
    input.addEventListener("focus", () => schedulePreview(input.dataset.previewTarget || ".page-head"));
  });
}

function renderParts() {
  let sectionOffset = 0;
  $("#partsEditor").innerHTML = state.parts.map((part, pIndex) => {
    const renderedSections = part.sections.map((section, sIndex) => renderSection(section, sIndex, part.sections.length, sectionOffset + sIndex + 1)).join("");
    sectionOffset += part.sections.length;
    return `
    <article class="part-card" data-part-id="${part.id}">
      <header class="part-head">
        <label class="part-title-input">
          <span>파트 ${pIndex + 1}</span>
          <input data-field="part-title" data-preview-target=".part-group:nth-of-type(${pIndex + 1}) .part-title" value="${escapeHtml(part.title)}" placeholder="파트 제목 (예: 핵심 개념)">
        </label>
        <div class="row-actions">
          <button class="ghost-btn danger" type="button" data-action="remove-part" ${state.parts.length === 1 ? "disabled" : ""}>파트 삭제</button>
        </div>
      </header>
      <div class="sections-wrap">
        ${renderedSections}
        <button class="add-section-btn" type="button" data-action="add-section">＋ 섹션 추가</button>
      </div>
    </article>
  `; }).join("");
}

function renderSection(section, index, total, globalIndex) {
  return `
    <section class="section-card" data-section-id="${section.id}">
      <div class="section-top">
        <span class="section-label">섹션 ${index + 1}</span>
        <button class="ghost-btn danger" type="button" data-action="remove-section" ${total === 1 ? "disabled" : ""}>삭제</button>
      </div>
      <div class="section-fields">
        <label>본문 섹션 제목<input data-field="section-title" data-preview-target="#s${globalIndex} h2" value="${escapeHtml(section.title)}" placeholder="예: MVC 패턴 이해"></label>
        <label>핵심 키워드<input data-field="section-keywords" data-preview-target="#s${globalIndex} .subtitle" value="${escapeHtml(section.keywords)}" placeholder="Model, View, Controller"></label>
        <label class="full">쉽게 말하면<textarea data-field="section-summary" data-preview-target="#s${globalIndex} .tldr" rows="2" placeholder="친구에게 설명하듯 한두 문장으로 적어주세요.">${escapeHtml(section.summary)}</textarea></label>
        <label class="full share-row" style="grid-template-columns:auto 1fr">
          <input type="checkbox" data-field="section-link-title" ${section.linkTitle !== false ? "checked" : ""}>
          <span><span class="share-location">목차와 본문 제목 공유</span> · 이 페이지에서만 설정</span>
          ${section.linkTitle === false ? `<input type="text" data-field="section-nav-title" data-preview-target=".navlink[href='#s${globalIndex}']" value="${escapeHtml(section.navTitle)}" placeholder="목차에만 표시할 제목">` : ""}
        </label>
      </div>
      <div class="blocks">
        ${section.blocks.map((block, blockIndex) => renderBlock(block, globalIndex, blockIndex)).join("")}
      </div>
      <div class="add-blocks">
        <button class="add-chip" type="button" data-action="add-block" data-type="text">＋ 설명</button>
        <button class="add-chip" type="button" data-action="add-block" data-type="list">＋ 핵심 목록</button>
        <button class="add-chip" type="button" data-action="add-block" data-type="code">＋ 코드</button>
        <button class="add-chip" type="button" data-action="add-block" data-type="note">＋ 팁·주의</button>
      </div>
    </section>
  `;
}

function renderBlock(block, globalIndex, blockIndex) {
  const labels = { text: "설명", list: "핵심 목록", code: "코드", note: "팁·주의" };
  const placeholders = {
    text: "내용을 문장으로 적어주세요. 빈 줄을 넣으면 문단이 나뉘어요.",
    list: "한 줄에 항목 하나씩 적어주세요.",
    code: "코드나 명령어를 그대로 붙여넣으세요.",
    note: "헷갈리기 쉬운 점이나 실무 팁을 적어주세요.",
  };
  return `
    <div class="block-card" data-block-id="${block.id}">
      <div class="block-toolbar">
        <select data-field="block-type" data-preview-target="#s${globalIndex} .studio-block[data-block-index='${blockIndex}']" aria-label="내용 종류">
          ${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${block.type === value ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <input data-field="block-heading" data-preview-target="#s${globalIndex} .studio-block[data-block-index='${blockIndex}']" value="${escapeHtml(block.heading)}" placeholder="${block.type === "code" ? "코드 예시 제목" : "소제목 (선택)"}">
        <button class="ghost-btn danger" type="button" data-action="remove-block">삭제</button>
      </div>
      <textarea data-field="block-content" data-preview-target="#s${globalIndex} .studio-block[data-block-index='${blockIndex}']" placeholder="${placeholders[block.type]}">${escapeHtml(block.content)}</textarea>
    </div>
  `;
}

function findEditorTarget(element) {
  const partNode = element.closest("[data-part-id]");
  const part = state.parts.find((item) => item.id === partNode?.dataset.partId);
  const sectionNode = element.closest("[data-section-id]");
  const section = part?.sections.find((item) => item.id === sectionNode?.dataset.sectionId);
  const blockNode = element.closest("[data-block-id]");
  const block = section?.blocks.find((item) => item.id === blockNode?.dataset.blockId);
  return { part, section, block };
}

function onPartsInput(event) {
  const { part, section, block } = findEditorTarget(event.target);
  const field = event.target.dataset.field;
  if (field === "part-title") part.title = event.target.value;
  if (field === "section-title") {
    section.title = event.target.value;
    if (section.linkTitle !== false) section.navTitle = event.target.value;
  }
  if (field === "section-nav-title") section.navTitle = event.target.value;
  if (field === "section-link-title") {
    section.linkTitle = event.target.checked;
    if (section.linkTitle) section.navTitle = section.title;
    renderParts();
  }
  if (field === "section-keywords") section.keywords = event.target.value;
  if (field === "section-summary") section.summary = event.target.value;
  if (field === "block-heading") block.heading = event.target.value;
  if (field === "block-content") block.content = event.target.value;
  if (field === "block-type") {
    block.type = event.target.value;
    renderParts();
  }
  state.created = null;
  updateSummary();
}

function onPartsClick(event) {
  const action = event.target.dataset.action;
  if (!action) return;
  const { part, section, block } = findEditorTarget(event.target);
  if (action === "add-section") part.sections.push(newSection());
  if (action === "remove-section" && part.sections.length > 1) part.sections = part.sections.filter((item) => item !== section);
  if (action === "add-block") section.blocks.push(newBlock(event.target.dataset.type));
  if (action === "remove-block" && section.blocks.length > 1) section.blocks = section.blocks.filter((item) => item !== block);
  if (action === "remove-part" && state.parts.length > 1) state.parts = state.parts.filter((item) => item !== part);
  state.created = null;
  renderParts();
  renderQuizzes();
  updateSummary();
}

function renderQuizzes() {
  if (state.mode === "free") {
    $("#quizEditor").innerHTML = '<div class="empty-state">자유 작성 모드에서는 퀴즈 형식을 강제하지 않아요.<br>퀴즈가 필요하면 공식 또는 김상훈 템플릿을 선택해주세요.</div>';
    return;
  }
  $("#quizEditor").innerHTML = state.parts.map((part, pIndex) => `
    <article class="quiz-part" data-part-id="${part.id}">
      <header class="quiz-part-head">
        <strong>파트 ${pIndex + 1} · ${escapeHtml(part.title || "제목 없음")}</strong>
        <div class="add-quiz-row">
          <button class="add-chip" data-add-quiz="mc" type="button">＋ 객관식</button>
          <button class="add-chip" data-add-quiz="ox" type="button">＋ OX</button>
          <button class="add-chip" data-add-quiz="short" type="button">＋ 주관식</button>
        </div>
      </header>
      <div class="quiz-list">
        ${part.quizzes.length ? part.quizzes.map((quiz, qIndex) => renderQuiz(quiz, qIndex, pIndex + 1)).join("") : '<div class="empty-state">퀴즈가 없어도 괜찮아요.<br>위 버튼으로 추가할 수 있습니다.</div>'}
      </div>
    </article>
  `).join("");
}

function renderQuiz(quiz, index, partIndex) {
  let answerArea = "";
  if (quiz.type === "mc") {
    answerArea = quiz.options.map((option, optionIndex) => `
      <label class="option-row">
        <input type="radio" name="answer-${quiz.id}" data-field="quiz-answer" data-preview-target="#quiz-p${partIndex}" value="${optionIndex}" ${String(quiz.answer) === String(optionIndex) ? "checked" : ""} aria-label="${optionIndex + 1}번을 정답으로 선택">
        <input data-field="quiz-option" data-preview-target="#quiz-p${partIndex}" data-option-index="${optionIndex}" value="${escapeHtml(option)}" placeholder="보기 ${optionIndex + 1}">
      </label>`).join("");
  } else if (quiz.type === "ox") {
    answerArea = `<select data-field="quiz-answer" data-preview-target="#quiz-p${partIndex}" aria-label="OX 정답"><option value="o" ${quiz.answer === "o" ? "selected" : ""}>정답: O</option><option value="x" ${quiz.answer === "x" ? "selected" : ""}>정답: X</option></select>`;
  } else {
    answerArea = `<input data-field="quiz-answer" data-preview-target="#quiz-p${partIndex}" value="${escapeHtml(quiz.answer)}" placeholder="정답 입력 · 여러 개면 쉼표로 구분">`;
  }
  const typeLabel = { mc: "객관식", ox: "OX", short: "주관식" }[quiz.type];
  return `
    <div class="quiz-card" data-quiz-id="${quiz.id}">
      <div class="quiz-card-head"><span class="quiz-type">${index + 1}. ${typeLabel}</span><button class="ghost-btn danger" data-remove-quiz type="button">삭제</button></div>
      <input data-field="quiz-prompt" data-preview-target="#quiz-p${partIndex}" value="${escapeHtml(quiz.prompt)}" placeholder="문제를 입력하세요">
      ${answerArea}
    </div>
  `;
}

function findQuizTarget(element) {
  const partNode = element.closest("[data-part-id]");
  const part = state.parts.find((item) => item.id === partNode?.dataset.partId);
  const quizNode = element.closest("[data-quiz-id]");
  const quiz = part?.quizzes.find((item) => item.id === quizNode?.dataset.quizId);
  return { part, quiz };
}

function onQuizInput(event) {
  const { quiz } = findQuizTarget(event.target);
  if (!quiz) return;
  const field = event.target.dataset.field;
  if (field === "quiz-prompt") quiz.prompt = event.target.value;
  if (field === "quiz-answer") quiz.answer = event.target.value;
  if (field === "quiz-option") quiz.options[Number(event.target.dataset.optionIndex)] = event.target.value;
  state.created = null;
  updateSummary();
}

function onQuizClick(event) {
  const partNode = event.target.closest("[data-part-id]");
  const part = state.parts.find((item) => item.id === partNode?.dataset.partId);
  if (event.target.dataset.addQuiz) part.quizzes.push(newQuiz(event.target.dataset.addQuiz));
  if (event.target.hasAttribute("data-remove-quiz")) {
    const { quiz } = findQuizTarget(event.target);
    part.quizzes = part.quizzes.filter((item) => item !== quiz);
  }
  if (event.target.dataset.addQuiz || event.target.hasAttribute("data-remove-quiz")) {
    state.created = null;
    renderQuizzes();
    updateSummary();
  }
}

function showStep(step) {
  currentStep = Math.max(1, Math.min(4, step));
  $$(".step-panel").forEach((panel) => panel.classList.toggle("active", Number(panel.dataset.panel) === currentStep));
  $$(".step-link").forEach((link) => {
    const value = Number(link.dataset.step);
    link.classList.toggle("active", value === currentStep);
    link.classList.toggle("done", value < currentStep);
  });
  $("#prevBtn").disabled = currentStep === 1;
  $("#nextBtn").classList.toggle("hidden", currentStep === 4);
  $("#stepStatus").textContent = `${currentStep} / 4`;
  const nextLabels = { 1: "다음: 내용 작성 →", 2: "다음: 퀴즈 →", 3: "다음: 확인하기 →" };
  $("#nextBtn").textContent = nextLabels[currentStep] || "";
  if (currentStep === 3) renderQuizzes();
  if (currentStep === 4) renderFinalSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderFinalSummary() {
  const parts = state.mode === "free" ? 1 : state.parts.length;
  const sections = state.mode === "free" ? 1 : state.parts.reduce((sum, part) => sum + part.sections.length, 0);
  const quizzes = state.mode === "free" ? 0 : state.parts.reduce((sum, part) => sum + part.quizzes.length, 0);
  $("#summaryCard").innerHTML = `
    <span class="eyebrow">생성 예정</span>
    <h3>${escapeHtml(state.title || "제목 미입력")}</h3>
    <p>lectures/${escapeHtml(state.number || "00")}-${escapeHtml(state.slug || "영문-주소")}/index.html</p>
    <div class="summary-meta"><span>${state.mode === "free" ? "자유 작성" : `파트 ${parts}개`}</span><span>섹션 ${sections}개</span><span>퀴즈 ${quizzes}개</span></div>
  `;
  if (state.created) enableCreatedActions();
}

async function validate() {
  $("#validateBtn").disabled = true;
  $("#validateBtn").textContent = "검사 중…";
  try {
    const result = await api("/api/validate", { method: "POST", body: JSON.stringify(payload()) });
    const resultNode = $("#validationResults");
    resultNode.classList.remove("hidden");
    resultNode.innerHTML = `
      ${result.errors.length ? `<div class="errors"><b>수정이 필요한 항목</b><ul>${result.errors.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul></div>` : ""}
      ${result.warnings.length ? `<div class="warnings"><b>확인하면 좋은 항목</b><ul>${result.warnings.map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul></div>` : ""}
      ${!result.errors.length && !result.warnings.length ? "<div>모든 필수 항목이 잘 작성됐어요.</div>" : ""}
    `;
    $("#checkIcon").className = `status-icon ${result.ok ? "ok" : "error"}`;
    $("#checkIcon").textContent = result.ok ? "✓" : "!";
    $("#checkTitle").textContent = result.ok ? "페이지를 만들 준비가 됐어요" : `${result.errors.length}개 항목을 확인해주세요`;
    $("#checkSub").textContent = result.warnings.length ? `참고 ${result.warnings.length}개도 함께 확인하세요.` : "필수 검사 통과";
    return result;
  } catch (error) {
    notice(error.message, true);
    return { ok: false, errors: [error.message], warnings: [] };
  } finally {
    $("#validateBtn").disabled = false;
    $("#validateBtn").textContent = "다시 검사";
  }
}

function enableCreatedActions() {
  $("#previewCard").classList.remove("disabled");
  $("#deployCard").classList.remove("disabled");
  $("#previewBtn").disabled = false;
  $("#deployBtn").disabled = false;
}

async function createPage(overwrite = false) {
  clearNotice();
  const check = await validate();
  if (!check.ok) {
    notice("수정이 필요한 항목이 있어요. 아래 검사 결과를 확인해주세요.", true);
    return;
  }
  $("#createBtn").disabled = true;
  $("#createBtn").textContent = "만드는 중…";
  try {
    const body = { ...payload(), _overwrite: overwrite };
    const result = await api("/api/create", { method: "POST", body: JSON.stringify(body) });
    if (result.needsOverwrite) {
      showOverwriteModal(result.errors[0]);
      return;
    }
    if (!result.ok) {
      notice((result.errors || [result.message]).join(" "), true);
      return;
    }
    state.created = { folder: result.folder, previewUrl: result.previewUrl };
    saveDraft();
    enableCreatedActions();
    renderFinalSummary();
    toast("강의 페이지와 홈 카드를 만들었어요.");
    showSuccessModal(result);
  } catch (error) {
    notice(error.message, true);
  } finally {
    $("#createBtn").disabled = false;
    $("#createBtn").textContent = "페이지 만들기";
  }
}

function openModal(content) {
  $("#modalBody").innerHTML = content;
  $("#modalBackdrop").classList.remove("hidden");
  setTimeout(() => $(".modal button, .modal input")?.focus(), 20);
}

function closeModal() {
  $("#modalBackdrop").classList.add("hidden");
  $(".modal").classList.remove("wide");
  $("#modalBody").innerHTML = "";
}

function showSuccessModal(result) {
  openModal(`
    <span class="eyebrow">완료</span>
    <h2 id="modalTitle">페이지를 만들었어요</h2>
    <p>아래 항목을 자동으로 확인했습니다.</p>
    <div class="file-list">${result.checks.map((item) => `✓ ${escapeHtml(item)}`).join("<br>")}</div>
    ${result.warnings.length ? `<div class="warning-box" style="margin-top:10px">${result.warnings.map(escapeHtml).join("<br>")}</div>` : ""}
    <div class="modal-actions">
      <button class="secondary-btn" type="button" data-modal-close>계속 작성</button>
      <button class="primary-btn" type="button" data-modal-preview>지금 미리보기</button>
    </div>
  `);
}

function showOverwriteModal(message) {
  openModal(`
    <span class="eyebrow">기존 파일 보호</span>
    <h2 id="modalTitle">같은 페이지가 이미 있어요</h2>
    <p>${escapeHtml(message)}</p>
    <div class="warning-box">덮어쓰면 기존 index.html은 로컬 백업 폴더에 보관됩니다. 같은 폴더의 다른 파일은 건드리지 않아요.</div>
    <div class="modal-actions">
      <button class="secondary-btn" type="button" data-modal-close>취소</button>
      <button class="danger-btn" type="button" data-confirm-overwrite>백업 후 덮어쓰기</button>
    </div>
  `);
}

async function showDeployModal() {
  try {
    const ready = await api("/api/deploy/readiness");
    if (!ready.ok) {
      notice(ready.message, true);
      return;
    }
    const unrelated = ready.unrelatedChanges || [];
    openModal(`
      <span class="eyebrow">VS CODE 소스 제어</span>
      <h2 id="modalTitle">변경사항을 확인하세요</h2>
      <p>VS Code에서 아래 파일을 확인한 뒤 커밋하고 변경 내용을 동기화하면 됩니다.</p>
      <div class="file-list">${ready.files.map((file) => `• ${escapeHtml(file)}`).join("<br>")}</div>
      ${unrelated.length ? `<div class="warning-box" style="margin-top:10px">다른 작업 파일 ${unrelated.length}개도 VS Code에 표시됩니다. 이번 강의와 관계없는 파일은 선택하지 마세요.</div>` : ""}
      <div class="commit-box"><code id="recommendedCommit">${escapeHtml(ready.manifest.mode === "edit" ? `docs: ${ready.manifest.title} 강의 수정` : `add: ${ready.manifest.title} 강의 추가`)}</code><button class="secondary-btn small" type="button" data-copy-commit>복사</button></div>
      <div class="modal-actions">
        <button class="secondary-btn" type="button" data-modal-close>취소</button>
        <button class="deploy-btn" id="openVsCodeBtn" type="button" data-open-vscode>VS Code로 열기</button>
      </div>
    `);
  } catch (error) {
    notice(error.message, true);
  }
}

async function openVsCode() {
  const button = $("#openVsCodeBtn");
  button.disabled = true;
  button.textContent = "여는 중…";
  try {
    const result = await api("/api/open-vscode", { method: "POST", body: "{}" });
    if (!result.ok) {
      const detail = result.detail ? `\n${result.detail}` : "";
      $(".modal p").textContent = `${result.message}${detail}`;
      button.disabled = false;
      button.textContent = "다시 시도";
      return;
    }
    openModal(`
      <span class="eyebrow">다음 단계</span>
      <h2 id="modalTitle">VS Code를 열었어요</h2>
      <p>${escapeHtml(result.message)}</p>
      <div class="commit-box"><code id="recommendedCommit">${escapeHtml(result.commitMessage)}</code><button class="secondary-btn small" type="button" data-copy-commit>복사</button></div>
      <div class="modal-actions">
        <button class="secondary-btn" type="button" data-modal-close>닫기</button>
      </div>
    `);
  } catch (error) {
    button.disabled = false;
    button.textContent = "다시 시도";
    $(".modal p").textContent = error.message;
  }
}

async function showGitHelp() {
  try {
    const guide = await api("/api/git-guide");
    openModal(`
      <span class="eyebrow">REFERENCE</span>
      <h2 id="modalTitle">Git 명령어 참고</h2>
      <p>평소에는 VS Code 소스 제어를 권장합니다. 아래 내용은 명령의 의미를 확인할 때만 참고하세요.</p>
      <pre class="git-guide">${escapeHtml(guide.content)}</pre>
      <div class="modal-actions">
        <button class="secondary-btn" type="button" data-copy-guide>전체 복사</button>
        <button class="primary-btn" type="button" data-modal-close>확인</button>
      </div>
    `);
  } catch (error) {
    toast(error.message);
  }
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value);
    toast(message);
  } catch {
    toast("복사하지 못했습니다. 내용을 직접 선택해주세요.");
  }
}

function showExistingModal() {
  const lectures = context?.lectures || [];
  openModal(`
    <span class="eyebrow">기존 초안</span>
    <h2 id="modalTitle">수정할 강의를 선택하세요</h2>
    <p>기존 디자인과 기능은 잠그고, 화면에 보이는 글자만 안전하게 수정합니다.</p>
    <label class="field">
      <span>강의 폴더</span>
      <select id="existingSelect">
        ${lectures.map((item) => `<option value="${escapeHtml(item.folder)}">${escapeHtml(item.folder)} · ${escapeHtml(item.title)}${item.isTemplate ? " (빈 템플릿)" : ""}</option>`).join("")}
      </select>
    </label>
    <div class="modal-actions">
      <button class="secondary-btn" type="button" data-modal-close>취소</button>
      <button class="primary-btn" type="button" data-use-existing>안전 편집기 열기</button>
    </div>
  `);
}

function getDirectText(element) {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.nodeValue)
    .join("")
    .trim();
}

function setDirectText(element, value) {
  const textNodes = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE);
  if (textNodes.length) {
    textNodes[0].nodeValue = `${element.firstElementChild ? " " : ""}${value}`;
    textNodes.slice(1).forEach((node) => node.remove());
  } else {
    element.append(document.createTextNode(value));
  }
}

function openExistingEditor(folder, previewUrl, sourceHtml) {
  $(".modal").classList.add("wide");
  $("#modalBody").innerHTML = `
    <span class="eyebrow">기존 강의 안전 편집</span>
    <h2 id="modalTitle">${escapeHtml(folder)}</h2>
    <div class="existing-workspace">
      <div class="existing-frame-wrap">
        <iframe class="existing-frame" id="existingFrame" title="기존 강의 편집 화면"></iframe>
      </div>
      <aside class="existing-controls">
        <div class="existing-guide"><b>사용법</b><br>왼쪽 페이지에서 바꾸고 싶은 글자를 클릭한 뒤, 아래 입력칸에서 수정하세요. 링크 이동은 편집 중 잠깁니다.</div>
        <div class="protected-pill">✓ 디자인 · 기능 · 링크 구조 잠금</div>
        <label class="selected-copy">
          <span id="selectedLabel">수정할 글자를 선택하세요</span>
          <textarea id="selectedText" disabled placeholder="왼쪽 페이지의 제목, 설명, 목록, 코드, 퀴즈 등을 클릭하세요."></textarea>
        </label>
        <div class="share-panel hidden" id="existingShareBox"></div>
        <div class="existing-actions">
          <button class="primary-btn" id="saveExistingBtn" type="button">수정 내용 저장</button>
          <button class="secondary-btn" type="button" data-modal-close>취소</button>
        </div>
      </aside>
    </div>
  `;
  const frame = $("#existingFrame");
  let selected = null;
  let selectedGroup = null;
  const sessionLinks = {};
  const selector = [
    ".crumb-cur", ".sidebar h1", ".sidebar .sub", ".part-title", ".navlink",
    ".page-head h1", ".page-head p", ".badges span", ".sec h2", ".subtitle",
    ".tldr .txt", ".sec h4", ".sec p", ".b li", ".b li b", ".codehead",
    ".codebox code", ".note", ".quiz-wrap h2", ".quiz-wrap > p",
    ".quiz-qtext", ".quiz-opt",
  ].join(",");

  const titleGroup = (doc) => ({
    id: "lecture-title",
    name: "강의 제목",
    entries: [
      { id: "breadcrumb", label: "상단 경로", element: doc.querySelector(".crumb-cur"), read: (el) => getDirectText(el), write: (el, value) => setDirectText(el, value) },
      { id: "sidebar", label: "왼쪽 목차 제목", element: doc.querySelector(".sidebar h1"), read: (el) => getDirectText(el).replace(/^SKALA\\s*/, ""), write: (el, value) => setDirectText(el, `SKALA ${value}`) },
      { id: "page", label: "본문 큰 제목", element: doc.querySelector(".page-head h1"), read: (el) => getDirectText(el).replace(/\\s*—\\s*복습노트$/, ""), write: (el, value) => setDirectText(el, `${value} — 복습노트`) },
      { id: "document", label: "브라우저 탭 제목", element: doc.querySelector("title"), read: (el) => el.textContent.replace(/^SKALA\\s*\\|\\s*/, "").replace(/\\s*-\\s*복습노트$/, ""), write: (el, value) => { el.textContent = `SKALA | ${value} - 복습노트`; } },
    ].filter((entry) => entry.element),
  });

  function groupForElement(doc, element) {
    const title = titleGroup(doc);
    if (title.entries.some((entry) => entry.element === element)) return title;
    const section = element.closest(".sec");
    const nav = element.matches(".navlink") ? element : null;
    const sectionId = section?.id || nav?.getAttribute("href")?.slice(1);
    if (sectionId) {
      const bodyTitle = doc.querySelector(`#${CSS.escape(sectionId)} h2`);
      const navTitle = doc.querySelector(`.navlink[href="#${CSS.escape(sectionId)}"]`);
      if (element === bodyTitle || element === navTitle) {
        return {
          id: `section-${sectionId}`,
          name: "섹션 제목",
          entries: [
            { id: "body", label: "본문 섹션 제목", element: bodyTitle, read: (el) => getDirectText(el), write: (el, value) => setDirectText(el, value) },
            { id: "nav", label: "왼쪽 목차", element: navTitle, read: (el) => getDirectText(el).replace(/^\\d+\\.\\s*/, ""), write: (el, value) => {
              const prefix = getDirectText(el).match(/^\\d+\\.\\s*/)?.[0] || "";
              setDirectText(el, `${prefix}${value}`);
            } },
          ].filter((entry) => entry.element),
        };
      }
    }
    return null;
  }

  function renderExistingSharing(group, selectedElement) {
    const box = $("#existingShareBox");
    if (!group || group.entries.length < 2) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    if (!sessionLinks[group.id]) {
      sessionLinks[group.id] = Object.fromEntries(group.entries.map((entry) => [entry.id, true]));
    }
    const links = sessionLinks[group.id];
    box.classList.remove("hidden");
    box.innerHTML = `
      <button class="share-summary" type="button"><span>⛓ '${escapeHtml(group.name)}' 공유 위치</span><span>이번 편집에만 적용</span></button>
      <div class="share-options">
        ${group.entries.map((entry) => `
          <label class="share-row">
            <input type="checkbox" data-existing-link="${entry.id}" ${links[entry.id] ? "checked" : ""} ${entry.element === selectedElement ? "disabled" : ""}>
            <span><span class="share-location">${escapeHtml(entry.label)}</span>${entry.element === selectedElement ? " · 현재 편집 위치" : ""}</span>
          </label>`).join("")}
      </div>`;
    box.querySelectorAll("[data-existing-link]").forEach((input) => {
      input.addEventListener("change", () => { links[input.dataset.existingLink] = input.checked; });
    });
  }

  const prepareFrame = () => {
    const doc = frame.contentDocument;
    if (!doc || doc.querySelector("#lecture-studio-edit-style")) return;
    const style = doc.createElement("style");
    style.id = "lecture-studio-edit-style";
    style.textContent = `
      ${selector}{cursor:text!important}
      ${selector}:hover{outline:2px dashed #516ee8!important;outline-offset:3px}
      [data-studio-selected="true"]{outline:3px solid #18a77a!important;outline-offset:3px}
    `;
    doc.head.append(style);
    doc.addEventListener("click", (event) => {
      const target = event.target.closest(selector);
      const link = event.target.closest("a");
      if (link) event.preventDefault();
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      doc.querySelector("[data-studio-selected]")?.removeAttribute("data-studio-selected");
      selected = target;
      selectedGroup = groupForElement(doc, selected);
      selected.setAttribute("data-studio-selected", "true");
      $("#selectedText").disabled = false;
      const selectedEntry = selectedGroup?.entries.find((entry) => entry.element === selected);
      $("#selectedText").value = selectedEntry ? selectedEntry.read(selected) : getDirectText(selected);
      $("#selectedLabel").textContent = `선택됨 · ${selected.tagName.toLowerCase()}${selected.className ? ` · ${String(selected.className).split(" ")[0]}` : ""}`;
      renderExistingSharing(selectedGroup, selected);
      $("#selectedText").focus();
    }, true);
    $("#selectedText").addEventListener("input", () => {
      if (!selected) return;
      const value = $("#selectedText").value;
      if (selectedGroup) {
        const links = sessionLinks[selectedGroup.id];
        selectedGroup.entries.forEach((entry) => {
          if (entry.element === selected || links[entry.id]) entry.write(entry.element, value);
        });
      } else {
        setDirectText(selected, value);
      }
    });
  };
  frame.addEventListener("load", prepareFrame);
  frame.srcdoc = sourceHtml;

  $("#saveExistingBtn").addEventListener("click", async () => {
    const button = $("#saveExistingBtn");
    const doc = frame.contentDocument;
    doc.querySelector("#lecture-studio-edit-style")?.remove();
    doc.querySelector("[data-studio-selected]")?.removeAttribute("data-studio-selected");
    const source = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
    button.disabled = true;
    button.textContent = "보호 규칙 확인 중…";
    try {
      const result = await api("/api/save-existing", {
        method: "POST",
        body: JSON.stringify({ folder, html: source }),
      });
      if (!result.ok) {
        button.disabled = false;
        button.textContent = "수정 내용 저장";
        toast(result.message);
        return;
      }
      state.created = { folder: result.folder, previewUrl: result.previewUrl };
      closeModal();
      showStep(4);
      enableCreatedActions();
      openModal(`
        <span class="eyebrow">안전 저장 완료</span>
        <h2 id="modalTitle">기존 강의를 수정했어요</h2>
        <p>내용 외의 디자인과 기능은 그대로인지 모두 확인했습니다.</p>
        <div class="file-list">${result.checks.map((item) => `✓ ${escapeHtml(item)}`).join("<br>")}</div>
        <div class="modal-actions">
          <button class="secondary-btn" type="button" data-modal-close>닫기</button>
          <button class="primary-btn" type="button" data-modal-preview>미리보기</button>
        </div>
      `);
    } catch (error) {
      button.disabled = false;
      button.textContent = "수정 내용 저장";
      toast(error.message);
    }
  });
}

async function loadExistingFolder() {
  const folder = $("#existingSelect").value;
  try {
    const result = await api(`/api/existing?folder=${encodeURIComponent(folder)}`);
    openExistingEditor(folder, result.previewUrl, result.html);
  } catch (error) {
    toast(error.message);
  }
}

function bindEvents() {
  $("#partsEditor").addEventListener("input", onPartsInput);
  $("#partsEditor").addEventListener("change", onPartsInput);
  $("#partsEditor").addEventListener("click", onPartsClick);
  $("#partsEditor").addEventListener("focusin", (event) => schedulePreview(event.target.dataset.previewTarget || activePreviewTarget));
  $("#quizEditor").addEventListener("input", onQuizInput);
  $("#quizEditor").addEventListener("change", onQuizInput);
  $("#quizEditor").addEventListener("click", onQuizClick);
  $("#quizEditor").addEventListener("focusin", (event) => schedulePreview(event.target.dataset.previewTarget || activePreviewTarget));
  $("#formatGrid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-format-id]");
    if (card) applyFormat(card.dataset.formatId);
  });
  $("#templateLibrary").addEventListener("click", (event) => {
    const applyId = event.target.dataset.customTemplate;
    const deleteId = event.target.dataset.deleteTemplate;
    if (applyId) {
      const template = customTemplates.find((item) => item.id === applyId);
      if (template) applyFormat(template.id, template.data);
    }
    if (deleteId) deleteTemplate(deleteId);
  });
  $("#saveTemplateBtn").addEventListener("click", showSaveTemplateModal);
  [$("#titleSharing"), $("#keywordSharing")].forEach((container) => {
    container.addEventListener("change", (event) => {
      if (!event.target.dataset.shareGroup) return;
      const group = event.target.dataset.shareGroup;
      const target = event.target.dataset.shareTarget;
      state.sharing[group][target].linked = event.target.checked;
      renderSharingControls();
      updateSummary();
    });
    container.addEventListener("input", (event) => {
      if (!event.target.dataset.shareOverride) return;
      const group = event.target.dataset.shareOverride;
      const target = event.target.dataset.shareTarget;
      state.sharing[group][target].value = event.target.value;
      updateSummary();
    });
  });
  $("#addPartBtn").addEventListener("click", () => {
    if (state.parts.length >= 4) return toast("파트는 최대 4개까지 만들 수 있어요.");
    state.parts.push(newPart());
    renderParts();
    renderQuizzes();
    updateSummary();
  });
  $$(".step-link").forEach((link) => link.addEventListener("click", () => showStep(Number(link.dataset.step))));
  $("#prevBtn").addEventListener("click", () => showStep(currentStep - 1));
  $("#nextBtn").addEventListener("click", () => showStep(currentStep + 1));
  $("#validateBtn").addEventListener("click", validate);
  $("#createBtn").addEventListener("click", () => createPage(false));
  $("#previewBtn").addEventListener("click", () => {
    if (state.created) window.open(state.created.previewUrl, "_blank", "noopener");
  });
  $("#deployBtn").addEventListener("click", showDeployModal);
  $("#gitHelpBtn").addEventListener("click", showGitHelp);
  $("#livePreviewBtn").addEventListener("click", () => {
    $("#sidePreview").classList.toggle("open");
    updateLivePreview();
  });
  $("#closeLivePreviewBtn").addEventListener("click", () => $("#sidePreview").classList.remove("open"));
  $("#refreshPreviewBtn").addEventListener("click", updateLivePreview);
  $("#freeContent").addEventListener("input", () => {
    state.freeContent = $("#freeContent").value;
    state.created = null;
    updateSummary();
  });
  $("#freeContent").addEventListener("focus", () => schedulePreview("#s1"));
  $("#useExistingBtn").addEventListener("click", showExistingModal);
  $("#clearDraftBtn").addEventListener("click", () => {
    if (!confirm("현재 입력 내용을 모두 지우고 처음부터 시작할까요?")) return;
    localStorage.removeItem(DRAFT_KEY);
    state = emptyState();
    state.number = context?.nextNumber || "00";
    location.reload();
  });
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalBackdrop").addEventListener("click", (event) => {
    if (event.target === $("#modalBackdrop")) closeModal();
  });
  $("#modalBody").addEventListener("click", (event) => {
    if (event.target.hasAttribute("data-modal-close")) closeModal();
    if (event.target.hasAttribute("data-modal-preview")) {
      closeModal();
      window.open(state.created.previewUrl, "_blank", "noopener");
    }
    if (event.target.hasAttribute("data-confirm-overwrite")) {
      closeModal();
      createPage(true);
    }
    if (event.target.hasAttribute("data-open-vscode")) openVsCode();
    if (event.target.hasAttribute("data-copy-commit")) copyText($("#recommendedCommit").textContent, "커밋 메시지를 복사했어요.");
    if (event.target.hasAttribute("data-copy-guide")) copyText($(".git-guide").textContent, "Git 참고 내용을 복사했어요.");
    if (event.target.hasAttribute("data-save-template")) saveTemplateFromModal();
    if (event.target.hasAttribute("data-use-existing")) loadExistingFolder();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#modalBackdrop").classList.contains("hidden")) closeModal();
  });
}

async function initialize() {
  try {
    const [contextResult, templateResult] = await Promise.all([api("/api/context"), api("/api/templates")]);
    context = contextResult;
    customTemplates = templateResult.templates || [];
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try { state = normalizeState(JSON.parse(saved)); } catch { localStorage.removeItem(DRAFT_KEY); }
    } else {
      state = normalizeState({ ...emptyState(), parts: officialStructure() });
    }
    if (!state.number) state.number = context.nextNumber;
    if (!state.parts?.length) state.parts = officialStructure();
    const templates = context.lectures.filter((item) => item.isTemplate);
    $("#existingDraftText").textContent = templates.length
      ? `${templates.map((item) => item.folder).join(", ")}에 빈 템플릿이 있어요.`
      : `현재 강의 ${context.lectures.length}개 · 다음 번호 ${context.nextNumber}`;
    $("#useExistingBtn").disabled = context.lectures.length === 0;
    syncBasicFields();
    renderFormats();
    renderSharingControls();
    renderParts();
    renderQuizzes();
    syncModeEditor();
    updateSummary();
    if (state.created) enableCreatedActions();
    bindEvents();
  } catch (error) {
    notice(`스튜디오를 시작하지 못했습니다: ${error.message}`, true);
  }
}

initialize();

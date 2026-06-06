const state = {
  theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  documentName: '',
  sections: [],
  selectedSection: 0,
  selectedParagraph: 0,
  words: [],
  currentWordIndex: 0,
  timer: null,
  playing: false,
  wpm: 320,
  fontSize: 54,
  readerBg: '#141414',
  readerFg: '#f7f7f7',
  readerAccent: '#ef4444',
};

const demoText = `Abstract
Reading dense documents can be slow when the reader must constantly scan left to right and also decide which section matters most. This app turns a long document into a section-aware RSVP workspace.

Introduction
Long-form documents such as papers, reports, and chapters have natural structure. Readers often want to jump between key sections before they commit to a full read.

Results
The reading pane shows one word at a time and highlights an optimal recognition point in red. The user can modify the speed, colors, and font size directly below the display.`;

const $ = (id) => document.getElementById(id);
const landingView = $('landingView');
const appShell = $('appShell');
const fileInput = $('fileInput');
const processFileBtn = $('processFileBtn');
const processTextBtn = $('processTextBtn');
const pasteInput = $('pasteInput');
const demoBtn = $('demoBtn');
const sidebarSections = $('sidebarSections');
const docTitle = $('docTitle');
const docMetaName = $('docMetaName');
const parserStatus = $('parserStatus');
const docStats = $('docStats');
const currentSectionBadge = $('currentSectionBadge');
const paragraphTitle = $('paragraphTitle');
const paragraphMeta = $('paragraphMeta');
const rawParagraphText = $('rawParagraphText');
const wordFrame = $('wordFrame');
const wordCounter = $('wordCounter');
const readSpeedPill = $('readSpeedPill');
const durationPill = $('durationPill');
const progressFill = $('progressFill');
const progressLabel = $('progressLabel');
const playPauseBtn = $('playPauseBtn');
const resetBtn = $('resetBtn');
const fullscreenBtn = $('fullscreenBtn');
const readerStage = $('readerStage');
const fileName = $('fileName');
const backBtn = $('backBtn');
const wpmControl = $('wpmControl');
const fontSizeControl = $('fontSizeControl');
const readerBgControl = $('readerBgControl');
const readerFgControl = $('readerFgControl');
const readerAccentControl = $('readerAccentControl');
const wpmValue = $('wpmValue');
const fontSizeValue = $('fontSizeValue');
const readerBgValue = $('readerBgValue');
const readerFgValue = $('readerFgValue');
const readerAccentValue = $('readerAccentValue');

function iconMarkup(theme) {
  return theme === 'dark'
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
}

function applyTheme(nextTheme) {
  state.theme = nextTheme;
  document.documentElement.setAttribute('data-theme', nextTheme);
  $('themeToggle').innerHTML = iconMarkup(nextTheme);
  $('themeToggleApp').innerHTML = iconMarkup(nextTheme);
}

function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function tokenize(text) {
  return text.match(/\S+/g) || [];
}

function orpIndex(word) {
  const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
  const len = clean.length || word.length || 1;
  if (len <= 1) return 0;
  if (len <= 5) return 1;
  if (len <= 9) return 2;
  if (len <= 13) return 3;
  return 4;
}

function renderWord(word = 'Ready') {
  const idx = Math.min(orpIndex(word), Math.max(word.length - 1, 0));
  const pre = word.slice(0, idx);
  const orp = word[idx] || '';
  const post = word.slice(idx + 1);
  wordFrame.innerHTML = `<span>${escapeHtml(pre)}</span><span class="orp">${escapeHtml(orp)}</span><span>${escapeHtml(post)}</span>`;
}

function estimateDuration(words, wpm) {
  return words.length ? Math.round((words.length / wpm) * 60) : 0;
}

function updateReaderMeta() {
  const total = state.words.length;
  const current = Math.min(state.currentWordIndex + (total ? 1 : 0), total);
  wordCounter.textContent = `Word ${current} / ${total}`;
  readSpeedPill.textContent = `${state.wpm} WPM`;
  durationPill.textContent = `Estimated ${estimateDuration(state.words, state.wpm)}s`;
  progressFill.style.width = `${total ? (state.currentWordIndex / total) * 100 : 0}%`;
  progressLabel.textContent = total ? `${Math.min(current, total)} of ${total} words shown` : 'Waiting for paragraph selection.';
}

function applyReaderStyles() {
  document.documentElement.style.setProperty('--reader-bg', state.readerBg);
  document.documentElement.style.setProperty('--reader-fg', state.readerFg);
  document.documentElement.style.setProperty('--reader-accent', state.readerAccent);
  wordFrame.style.fontSize = `${state.fontSize}px`;
  wpmValue.textContent = `${state.wpm} WPM`;
  fontSizeValue.textContent = `${state.fontSize} px`;
  readerBgValue.textContent = state.readerBg;
  readerFgValue.textContent = state.readerFg;
  readerAccentValue.textContent = state.readerAccent;
  updateReaderMeta();
}

function stopReader() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.playing = false;
  playPauseBtn.textContent = 'Play';
}

function nextDelay(word) {
  const base = 60000 / state.wpm;
  if (/[,:;]$/.test(word)) return base * 1.35;
  if (/[.!?]$/.test(word)) return base * 1.8;
  if (word.length >= 9) return base * 1.18;
  return base;
}

function tickReader() {
  if (!state.playing || !state.words.length) return;
  if (state.currentWordIndex >= state.words.length) {
    stopReader();
    state.currentWordIndex = state.words.length;
    updateReaderMeta();
    return;
  }
  const word = state.words[state.currentWordIndex];
  renderWord(word);
  state.currentWordIndex += 1;
  updateReaderMeta();
  state.timer = setTimeout(tickReader, nextDelay(word));
}

function togglePlay() {
  if (!state.words.length) return;
  if (state.playing) {
    stopReader();
    return;
  }
  if (state.currentWordIndex >= state.words.length) state.currentWordIndex = 0;
  state.playing = true;
  playPauseBtn.textContent = 'Pause';
  tickReader();
}

function resetReader() {
  stopReader();
  state.currentWordIndex = 0;
  renderWord(state.words[0] || 'Ready');
  updateReaderMeta();
}

function updateFullscreenButton() {
  fullscreenBtn.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
}

async function toggleFullscreen() {
  if (!document.fullscreenEnabled) {
    progressLabel.textContent = 'Fullscreen is not available in this browser context.';
    return;
  }
  try {
    if (!document.fullscreenElement) {
      await readerStage.requestFullscreen({ navigationUI: 'hide' }).catch(() => readerStage.requestFullscreen());
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error(error);
    progressLabel.textContent = 'Fullscreen request was blocked by the browser.';
  }
}

function renderSidebar() {
  if (!state.sections.length) {
    sidebarSections.innerHTML = '<p class="tiny">No sections yet.</p>';
    return;
  }
  sidebarSections.innerHTML = state.sections.map((section, sIndex) => {
    const items = section.paragraphs.map((para, pIndex) => {
      const preview = `${para.text.split(/\s+/).slice(0, 12).join(' ')}…`;
      const active = sIndex === state.selectedSection && pIndex === state.selectedParagraph ? 'active' : '';
      return `<button class="paragraph-btn ${active}" data-section="${sIndex}" data-paragraph="${pIndex}"><strong>${para.label}</strong><span>${preview}</span></button>`;
    }).join('');
    return `<section class="section-block"><button class="section-toggle" type="button"><span>${section.title}</span><span>${section.paragraphs.length} nodes</span></button><div class="paragraph-list">${items}</div></section>`;
  }).join('');
  document.querySelectorAll('.paragraph-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectParagraph(Number(btn.dataset.section), Number(btn.dataset.paragraph)));
  });
}

function getCurrentParagraph() {
  const section = state.sections[state.selectedSection];
  if (!section) return null;
  return { section, paragraph: section.paragraphs[state.selectedParagraph] };
}

function loadParagraphText(text) {
  stopReader();
  state.words = tokenize(text);
  state.currentWordIndex = 0;
  rawParagraphText.textContent = text;
  renderWord(state.words[0] || 'Ready');
  updateReaderMeta();
}

function selectParagraph(sectionIndex, paragraphIndex) {
  state.selectedSection = sectionIndex;
  state.selectedParagraph = paragraphIndex;
  const current = getCurrentParagraph();
  if (!current) return;
  currentSectionBadge.textContent = current.section.title;
  paragraphTitle.textContent = current.paragraph.label;
  paragraphMeta.textContent = `${current.section.title} · ${current.paragraph.word_count} words`;
  loadParagraphText(current.paragraph.text);
  renderSidebar();
}

function setDocument(doc) {
  stopReader();
  state.sections = doc.sections || [];
  state.documentName = doc.title || 'Untitled document';
  state.selectedSection = 0;
  state.selectedParagraph = 0;
  docTitle.textContent = state.documentName;
  docMetaName.textContent = doc.source_type || 'Document';
  parserStatus.textContent = `Parsed ${doc.source_type.toLowerCase()} into ${doc.stats.sections} sections.`;
  docStats.textContent = `${doc.stats.sections} sections · ${doc.stats.paragraphs} paragraphs`;
  landingView.classList.add('hidden');
  appShell.classList.add('active');
  renderSidebar();
  selectParagraph(0, 0);
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).detail || 'Request failed');
  return res.json();
}

async function processText() {
  const text = pasteInput.value.trim();
  if (!text) return;
  parserStatus.textContent = 'Parsing pasted text…';
  const doc = await postJSON('/api/parse-text', { text, title: 'Pasted text' });
  setDocument(doc);
}

async function processFile() {
  const file = fileInput.files?.[0];
  if (!file) return;
  parserStatus.textContent = `Parsing ${file.name}…`;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/parse-file', { method: 'POST', body: form });
  if (!res.ok) throw new Error((await res.json()).detail || 'Upload failed');
  const doc = await res.json();
  setDocument(doc);
}

function goBack() {
  stopReader();
  appShell.classList.remove('active');
  landingView.classList.remove('hidden');
  parserStatus.textContent = 'Waiting for content.';
}

processTextBtn.addEventListener('click', () => processText().catch((e) => { parserStatus.textContent = e.message; }));
processFileBtn.addEventListener('click', () => processFile().catch((e) => { parserStatus.textContent = e.message; }));
demoBtn.addEventListener('click', async () => {
  pasteInput.value = demoText;
  processText().catch((e) => { parserStatus.textContent = e.message; });
});
fileInput.addEventListener('change', () => { fileName.textContent = fileInput.files?.[0]?.name || 'No file selected yet.'; });
playPauseBtn.addEventListener('click', togglePlay);
resetBtn.addEventListener('click', resetReader);
fullscreenBtn.addEventListener('click', toggleFullscreen);
backBtn.addEventListener('click', goBack);
$('themeToggle').addEventListener('click', toggleTheme);
$('themeToggleApp').addEventListener('click', toggleTheme);
document.addEventListener('fullscreenchange', updateFullscreenButton);

wpmControl.addEventListener('input', (e) => { state.wpm = Number(e.target.value); applyReaderStyles(); });
fontSizeControl.addEventListener('input', (e) => { state.fontSize = Number(e.target.value); applyReaderStyles(); });
readerBgControl.addEventListener('input', (e) => { state.readerBg = e.target.value; applyReaderStyles(); });
readerFgControl.addEventListener('input', (e) => { state.readerFg = e.target.value; applyReaderStyles(); });
readerAccentControl.addEventListener('input', (e) => { state.readerAccent = e.target.value; applyReaderStyles(); });

document.addEventListener('keydown', (e) => {
  const typing = ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName);
  if (e.code === 'Space' && appShell.classList.contains('active') && !typing) {
    e.preventDefault();
    togglePlay();
  }
  if (e.key.toLowerCase() === 'f' && appShell.classList.contains('active') && !typing) {
    toggleFullscreen();
  }
});

applyTheme(state.theme);
applyReaderStyles();
updateFullscreenButton();
renderWord('Ready');

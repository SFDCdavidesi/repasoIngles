const LOCALE = "es-ES";
const DEFAULT_DATASET = "data.json";
const HISTORY_STORAGE_KEY = "quiz_history_v1";
const HISTORY_MAX = 12;
const EMPTY_HISTORY_SUMMARY = "Selecciona una ejecucion para ver su resumen.";

const state = {
  datasetName: DEFAULT_DATASET,
  questions: [],
  currentIndex: 0,
  answers: [],
  finished: false,
  startedAt: null,
  attemptId: null,
  savedAttemptId: null
};

const el = {
  datasetName: document.getElementById("datasetName"),
  statusLine: document.getElementById("statusLine"),
  scoreQuestion: document.getElementById("scoreQuestion"),
  scoreCorrect: document.getElementById("scoreCorrect"),
  scoreWrong: document.getElementById("scoreWrong"),
  scorePercent: document.getElementById("scorePercent"),
  jsonFileInput: document.getElementById("jsonFileInput"),
  resetBtn: document.getElementById("resetBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  quizPanel: document.getElementById("quizPanel"),
  chipCounter: document.getElementById("chipCounter"),
  chipPage: document.getElementById("chipPage"),
  progressLabel: document.getElementById("progressLabel"),
  progressBar: document.getElementById("progressBar"),
  questionText: document.getElementById("questionText"),
  optionsContainer: document.getElementById("optionsContainer"),
  feedbackBox: document.getElementById("feedbackBox"),
  finalSummary: document.getElementById("finalSummary"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  historyContainer: document.getElementById("historyContainer"),
  historySummary: document.getElementById("historySummary"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn")
};

function getCorrectIndex(question) {
  if (!question || !Array.isArray(question.answers)) return -1;
  return question.answers.findIndex((a) => Boolean(a.selected));
}

function parseSafePage(value, fallback) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return fallback;
}

function isSelectedValue(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function hasExactlyOneCorrectAnswer(question) {
  return question.answers.filter((answer) => answer.selected).length === 1;
}

function parseQuestion(raw, index) {
  if (!raw || typeof raw !== "object") {
    return { page: index + 1, question: "", answers: [] };
  }

  const qText = String(raw.question || raw.qtext || raw.text || "").trim();
  const page = parseSafePage(raw.page, index + 1);
  const answersRaw = Array.isArray(raw.answers) ? raw.answers : [];

  const answers = answersRaw.map((a) => {
    if (typeof a === "string") {
      return { text: a, selected: false };
    }
    return {
      text: String(a.text || a.answer || "").trim(),
      selected: isSelectedValue(a.selected)
    };
  }).filter((a) => a.text.length > 0);

  return {
    page,
    question: qText,
    answers
  };
}

function sanitizeData(data) {
  const base = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data)
      ? data
      : [];

  const questions = base
    .map(parseQuestion)
    .filter((q) => q.question && q.answers.length >= 2 && hasExactlyOneCorrectAnswer(q))
    .map((q, idx) => ({ ...q, id: idx }));

  return questions;
}

function getStats() {
  const total = state.questions.length;
  let answered = 0;
  let correct = 0;

  state.answers.forEach((answerIndex, idx) => {
    if (answerIndex !== null && answerIndex !== undefined) {
      answered += 1;
      const correctIndex = getCorrectIndex(state.questions[idx]);
      if (correctIndex >= 0 && answerIndex === correctIndex) {
        correct += 1;
      }
    }
  });

  const wrong = answered - correct;
  const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  return { total, answered, correct, wrong, percent };
}

function updateScoreUI() {
  const stats = getStats();
  el.scoreQuestion.textContent = `${stats.answered}/${stats.total}`;
  el.scoreCorrect.textContent = String(stats.correct);
  el.scoreWrong.textContent = String(stats.wrong);
  el.scorePercent.textContent = `${stats.percent}%`;
}

function updateProgressUI() {
  const stats = getStats();
  const progress = stats.total > 0 ? Math.round((stats.answered / stats.total) * 100) : 0;
  el.progressBar.style.width = `${progress}%`;
  el.progressLabel.textContent = `${progress}% completado (${stats.answered}/${stats.total})`;
}

function renderFinalSummary() {
  const stats = getStats();
  if (!state.finished || !stats.total) {
    el.finalSummary.hidden = true;
    return;
  }
  const durationSec = state.startedAt ? Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) : 0;
  el.finalSummary.hidden = false;
  el.finalSummary.innerHTML = `
    <strong>Test finalizado</strong><br>
    Resultado: ${stats.correct}/${stats.total} (${stats.percent}%)<br>
    Contestadas: ${stats.answered}/${stats.total}<br>
    Falladas: ${stats.wrong}<br>
    Duracion aproximada: ${durationSec}s
  `;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Fecha desconocida";
  return d.toLocaleString(LOCALE);
}

function sanitizeHistoryItem(item) {
  if (!item || typeof item !== "object") return null;
  const total = Number(item.total);
  const answered = Number(item.answered);
  const correct = Number(item.correct);
  const wrong = Number(item.wrong);
  const percent = Number(item.percent);
  const durationSec = Number(item.durationSec);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(answered) || answered < 0 || answered > total) return null;
  if (!Number.isFinite(correct) || correct < 0 || correct > answered) return null;
  if (!Number.isFinite(wrong) || wrong < 0 || wrong > answered) return null;
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  if (!Number.isFinite(durationSec) || durationSec < 0) return null;

  return {
    id: String(item.id || `attempt_${Date.now()}`),
    dataset: String(item.dataset || DEFAULT_DATASET),
    date: String(item.date || new Date().toISOString()),
    total: Math.round(total),
    answered: Math.round(answered),
    correct: Math.round(correct),
    wrong: Math.round(wrong),
    percent: Math.round(percent),
    durationSec: Math.round(durationSec)
  };
}

function readHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeHistoryItem)
      .filter((item) => item !== null)
      .slice(0, HISTORY_MAX);
  } catch (_err) {
    return [];
  }
}

function writeHistory(items) {
  const compact = items.slice(0, HISTORY_MAX).map((i) => ({
    id: i.id,
    dataset: i.dataset,
    date: i.date,
    total: i.total,
    answered: i.answered,
    correct: i.correct,
    wrong: i.wrong,
    percent: i.percent,
    durationSec: i.durationSec
  }));
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(compact));
}

function clearHistoryStorage() {
  localStorage.removeItem(HISTORY_STORAGE_KEY);
}

function resetHistorySummary() {
  el.historySummary.className = "empty";
  el.historySummary.textContent = EMPTY_HISTORY_SUMMARY;
}

function saveAttemptSummary() {
  const stats = getStats();
  if (stats.total === 0 || stats.answered === 0 || !state.startedAt) return;
  if (!state.attemptId || state.savedAttemptId === state.attemptId) return;

  const durationSec = Math.max(1, Math.round((Date.now() - state.startedAt) / 1000));
  const item = {
    id: state.attemptId,
    dataset: state.datasetName,
    date: new Date().toISOString(),
    total: stats.total,
    answered: stats.answered,
    correct: stats.correct,
    wrong: stats.wrong,
    percent: stats.percent,
    durationSec
  };

  const list = readHistory();
  list.unshift(item);
  writeHistory(list);
  state.savedAttemptId = state.attemptId;
  renderHistory();
}

function renderHistorySummary(item) {
  el.historySummary.className = "empty";
  el.historySummary.innerHTML = `
    <strong>Resumen de ejecucion:</strong><br>
    Fecha: ${formatDate(item.date)}<br>
    Dataset: ${item.dataset}<br>
    Contestadas: ${item.answered}/${item.total}<br>
    Aciertos: ${item.correct} | Fallos: ${item.wrong}<br>
    Puntuacion: ${item.percent}%<br>
    Duracion: ${item.durationSec}s
  `;
}

function renderHistory() {
  const list = readHistory();
  el.historyContainer.innerHTML = "";

  if (list.length === 0) {
    el.historyContainer.innerHTML = `<div class="empty">No hay ejecuciones guardadas todavia.</div>`;
    resetHistorySummary();
    return;
  }

  list.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-item";

    const left = document.createElement("div");
    left.innerHTML = `
      <strong>${item.dataset}</strong><br>
      <span class="small">${formatDate(item.date)} | ${item.correct}/${item.answered} | ${item.percent}%</span>
    `;

    const right = document.createElement("button");
    right.type = "button";
    right.className = "btn-secondary";
    right.textContent = "Ver resumen";
    right.addEventListener("click", () => renderHistorySummary(item));

    row.appendChild(left);
    row.appendChild(right);
    el.historyContainer.appendChild(row);
  });
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  if (!q) {
    el.quizPanel.hidden = true;
    return;
  }

  const selectedIndex = state.answers[state.currentIndex];
  const correctIndex = getCorrectIndex(q);
  const hasAnswered = selectedIndex !== null && selectedIndex !== undefined;

  el.quizPanel.hidden = false;
  el.chipCounter.textContent = `Pregunta ${state.currentIndex + 1} de ${state.questions.length}`;
  el.chipPage.textContent = `Pagina original: ${q.page}`;
  el.questionText.textContent = q.question;
  el.optionsContainer.innerHTML = "";
  el.optionsContainer.setAttribute("aria-label", `Opciones para la pregunta ${state.currentIndex + 1}`);

  q.answers.forEach((ans, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option";
    btn.textContent = ans.text;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(idx === selectedIndex));
    btn.setAttribute("aria-label", `Opcion ${idx + 1}: ${ans.text}`);
    btn.id = `q${state.currentIndex}_opt${idx}`;

    if (hasAnswered) {
      if (idx === selectedIndex) btn.classList.add("selected");
      if (idx === correctIndex) btn.classList.add("correct");
      if (idx === selectedIndex && selectedIndex !== correctIndex) {
        btn.classList.add("wrong");
      }
    }

    btn.addEventListener("click", () => answerCurrent(idx));
    el.optionsContainer.appendChild(btn);
  });

  if (hasAnswered) {
    el.feedbackBox.hidden = false;
    if (selectedIndex === correctIndex && correctIndex >= 0) {
      el.feedbackBox.className = "feedback ok";
      el.feedbackBox.textContent = "Correcta. Muy bien.";
    } else {
      const rightText = correctIndex >= 0 ? q.answers[correctIndex].text : "No definida en data.json";
      el.feedbackBox.className = "feedback bad";
      el.feedbackBox.textContent = `Incorrecta. Respuesta correcta: ${rightText}`;
    }
  } else {
    el.feedbackBox.hidden = true;
  }

  el.prevBtn.disabled = state.currentIndex === 0;
  el.nextBtn.disabled = state.currentIndex === state.questions.length - 1;
  updateScoreUI();
  updateProgressUI();
  renderFinalSummary();
  renderNavigator();
}

function checkFinish() {
  const stats = getStats();
  if (stats.answered === stats.total && !state.finished) {
    state.finished = true;
    saveAttemptSummary();
    const durationSec = state.startedAt ? Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) : 0;
    el.statusLine.textContent = `Test completado: ${stats.correct}/${stats.total} (${stats.percent}%) en ${durationSec}s.`;
    renderFinalSummary();
  }
}

function answerCurrent(index) {
  if (!state.questions.length) return;
  state.answers[state.currentIndex] = index;
  renderQuestion();
  checkFinish();
}

function resetQuiz() {
  state.currentIndex = 0;
  state.answers = state.questions.map(() => null);
  state.finished = false;
  state.startedAt = Date.now();
  state.attemptId = `attempt_${state.startedAt}`;
  el.statusLine.textContent = `Test cargado con ${state.questions.length} preguntas.`;
  el.finalSummary.hidden = true;
  renderQuestion();
  renderNavigator();
}

function loadQuestions(data, datasetLabel) {
  const parsed = sanitizeData(data);
  if (parsed.length === 0) {
    throw new Error("No se encontraron preguntas validas. Cada pregunta debe tener texto, al menos 2 respuestas y exactamente 1 respuesta correcta.");
  }

  state.questions = parsed;
  state.datasetName = datasetLabel || DEFAULT_DATASET;
  el.datasetName.textContent = `Fuente: ${state.datasetName}`;
  resetQuiz();
}

async function loadDefaultJson() {
  const response = await fetch(DEFAULT_DATASET, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${DEFAULT_DATASET}. Verifica que exista en la carpeta del proyecto.`);
  }
  const data = await response.json();
  loadQuestions(data, DEFAULT_DATASET);
}

async function exportPdf() {
  if (!state.questions.length) return;
  const jspdfNs = window.jspdf;
  if (!jspdfNs || !jspdfNs.jsPDF) {
    alert("No se pudo cargar la libreria PDF.");
    return;
  }

  const { jsPDF } = jspdfNs;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 40;
  const width = 515;
  let y = 50;
  const stats = getStats();
  const durationSec = state.startedAt ? Math.max(1, Math.round((Date.now() - state.startedAt) / 1000)) : 0;

  function addLine(text, fontSize = 11, isBold = false) {
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, width);
    const needed = lines.length * (fontSize + 4);
    if (y + needed > 790) {
      doc.addPage();
      y = 50;
    }
    doc.text(lines, margin, y);
    y += needed + 4;
  }

  addLine("Repaso de preguntas", 15, true);
  addLine(`Fuente: ${state.datasetName}`, 10, false);
  addLine(`Generado: ${new Date().toLocaleString(LOCALE)}`, 10, false);
  addLine(`Resumen: ${stats.correct}/${stats.total} aciertos | ${stats.wrong} fallos | ${stats.percent}% | ${stats.answered}/${stats.total} contestadas | ${durationSec}s`, 10, false);
  addLine(" ", 10, false);

  state.questions.forEach((q, idx) => {
    const selectedIndex = state.answers[idx];
    const correctIndex = getCorrectIndex(q);

    addLine(`${idx + 1}. ${q.question}`, 12, true);
    q.answers.forEach((ans, aIdx) => {
      const marks = [];
      if (aIdx === correctIndex) marks.push("Correcta");
      if (aIdx === selectedIndex) marks.push("Tu respuesta");
      const badge = marks.length ? ` [${marks.join(" | ")}]` : "";
      addLine(`   - ${ans.text}${badge}`, 10, false);
    });
    if (selectedIndex === null || selectedIndex === undefined) {
      addLine("   - Sin responder", 10, false);
    }
    addLine(" ", 10, false);
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Pagina ${i} de ${pageCount}`, margin, 822);
  }

  doc.save("repaso_preguntas.pdf");
}

function wireEvents() {
  el.prevBtn.addEventListener("click", () => {
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  });

  el.nextBtn.addEventListener("click", () => {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
    }
  });

  el.resetBtn.addEventListener("click", () => {
    if (!state.questions.length) return;
    if (window.confirm("¿Seguro que quieres reiniciar el test? Se perdera el progreso actual.")) {
      resetQuiz();
    }
  });

  el.downloadPdfBtn.addEventListener("click", exportPdf);

  el.jsonFileInput.addEventListener("change", async (evt) => {
    const file = evt.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      loadQuestions(data, file.name);
    } catch (err) {
      el.statusLine.textContent = `Error al leer JSON: ${err.message}`;
    } finally {
      evt.target.value = "";
    }
  });

  el.clearHistoryBtn.addEventListener("click", () => {
    clearHistoryStorage();
    renderHistory();
    resetHistorySummary();
  });

  const navigatorPanel = document.getElementById("navigatorPanel");
  const toggleNavBtn = document.getElementById("toggleNavBtn");
  const closeNavBtn = document.getElementById("closeNavBtn");

  toggleNavBtn.addEventListener("click", () => {
    navigatorPanel.classList.toggle("open");
  });

  closeNavBtn.addEventListener("click", () => {
    navigatorPanel.classList.remove("open");
  });

  document.addEventListener("click", (evt) => {
    if (!navigatorPanel.contains(evt.target) && !toggleNavBtn.contains(evt.target) && navigatorPanel.classList.contains("open")) {
      navigatorPanel.classList.remove("open");
    }
  });
}

function renderNavigator() {
  const grid = document.getElementById("navigatorGrid");
  grid.innerHTML = "";

  for (let i = 0; i < state.questions.length; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-item";
    btn.textContent = String(i + 1);
    btn.setAttribute("aria-label", `Ir a pregunta ${i + 1}`);

    if (i === state.currentIndex) {
      btn.classList.add("current");
    }

    const answered = state.answers[i] !== null && state.answers[i] !== undefined;
    if (answered) {
      btn.classList.add("answered");
      const correctIndex = getCorrectIndex(state.questions[i]);
      if (state.answers[i] === correctIndex && correctIndex >= 0) {
        btn.classList.add("correct");
      }
    }

    btn.addEventListener("click", () => {
      state.currentIndex = i;
      renderQuestion();
      renderNavigator();
      document.getElementById("navigatorPanel").classList.remove("open");
    });

    grid.appendChild(btn);
  }
}

async function init() {
  wireEvents();
  resetHistorySummary();
  renderHistory();
  try {
    await loadDefaultJson();
  } catch (err) {
    el.statusLine.textContent = err.message;
    el.quizPanel.hidden = true;
  }
}

init();

// src/config.js
// ============================================================
// SINGLE SOURCE OF TRUTH — update this file each semester.
//
// Environment variables (define in .env.local):
//   VITE_SCRIPT_URL   — Google Apps Script deployment URL
//   VITE_API_SECRET   — Shared secret checked by GAS on every
//                        public PIN endpoint. Set the same value
//                        as the GAS "API_SECRET" script property.
// ============================================================

export const APP_CONFIG = {
  appTitle:    "Senior Project Jury Portal",
  courseName:  "EE 491 / EE 492 — Senior Project",
  department:  "Electrical & Electronics Engineering",
  university:  "TED University",

  scriptUrl:   import.meta.env.VITE_SCRIPT_URL  || "",
  apiSecret:   import.meta.env.VITE_API_SECRET  || "",

  showStudents: true,
};

// ── Groups / Projects ─────────────────────────────────────────
export const PROJECTS = [
  {
    id: 1,
    name: "Group 1",
    desc: "Göksiper Hava Savunma Sistemi",
    students: ["Mustafa Yusuf Ünal", "Ayça Naz Dedeoğlu", "Onur Mesci", "Çağan Erdoğan"],
  },
  {
    id: 2,
    name: "Group 2",
    desc: "Radome and Radar-Absorbing Material Electromagnetic Design Software (REMDET)",
    students: ["Niyazi Atilla Özer", "Bertan Ünver", "Ada Tatlı", "Nesibe Aydın"],
  },
  {
    id: 3,
    name: "Group 3",
    desc: "Smart Crosswalk",
    students: ["Sami Eren Germeç"],
  },
  {
    id: 4,
    name: "Group 4",
    desc: "Radar Cross Section (RCS) Analysis — Supporting Multi-Purpose Ray Tracing Algorithm",
    students: ["Ahmet Melih Yavuz", "Yasemin Erciyas"],
  },
  {
    id: 5,
    name: "Group 5",
    desc: "Monitoring Pilots' Health Status and Cognitive Abilities During Flight",
    students: ["Aysel Mine Çaylan", "Selimhan Kaynar", "Abdulkadir Sazlı", "Alp Efe İpek"],
  },
  {
    id: 6,
    name: "Group 6",
    desc: "AKKE — Smart Command and Control Glove",
    students: ["Şevval Kurtulmuş", "Abdullah Esin", "Berk Çakmak", "Ömer Efe Dikici"],
  },
];

// ── Evaluation Criteria ───────────────────────────────────────
// Order here controls display order in jury form AND admin panel.
// Sheet column order (G–J): Technical / Written / Oral / Teamwork
//
// id:         React key + data field name in rows (matches GAS export)
// color:      Chart color token used consistently across all dashboard charts
// mudek:      Array of MÜDEK outcome codes this criterion maps to
// rubric[].min/max: Numeric bounds for band classification logic
export const CRITERIA = [
  {
    id: "technical",
    label: "Technical Content",
    shortLabel: "Technical",
    color: "#F59E0B",
    mudek: ["1.2", "2", "3.1", "3.2"],
    max: 30,
    rubric: [
      { range: "27–30", level: "Excellent",    min: 27, max: 30, desc: "Problem is clearly defined with strong motivation. Design decisions are well-justified with engineering depth. Originality and mastery of relevant tools or methods are evident." },
      { range: "21–26", level: "Good",         min: 21, max: 26, desc: "Design is mostly clear and technically justified. Engineering decisions are largely supported." },
      { range: "13–20", level: "Developing",   min: 13, max: 20, desc: "Problem is stated but motivation or technical justification is insufficient." },
      { range: "0–12",  level: "Insufficient", min: 0,  max: 12, desc: "Vague problem definition and unjustified decisions. Superficial technical content." },
    ],
  },
  {
    id: "design",
    label: "Written Communication",
    shortLabel: "Written",
    color: "#22C55E",
    mudek: ["9.2"],
    max: 30,
    rubric: [
      { range: "27–30", level: "Excellent",    min: 27, max: 30, desc: "Poster layout is intuitive with clear information flow. Visuals are fully labelled and high quality. Technical content is presented in a way that is accessible to both technical and non-technical readers." },
      { range: "21–26", level: "Good",         min: 21, max: 26, desc: "Layout is mostly logical. Visuals are readable with minor gaps. Technical content is largely clear with small areas for improvement." },
      { range: "13–20", level: "Developing",   min: 13, max: 20, desc: "Occasional gaps in information flow. Some visuals are missing labels or captions. Technical content is only partially communicated." },
      { range: "0–12",  level: "Insufficient", min: 0,  max: 12, desc: "Confusing layout. Low-quality or unlabelled visuals. Technical content is unclear or missing." },
    ],
  },
  {
    id: "delivery",
    label: "Oral Communication",
    shortLabel: "Oral",
    color: "#3B82F6",
    mudek: ["9.1"],
    max: 30,
    rubric: [
      { range: "27–30", level: "Excellent",    min: 27, max: 30, desc: "Presentation is consciously adapted for both technical and non-technical jury members. Q&A responses are accurate, clear, and audience-appropriate." },
      { range: "21–26", level: "Good",         min: 21, max: 26, desc: "Presentation is mostly clear and well-paced. Most questions answered correctly. Audience adaptation is generally evident." },
      { range: "13–20", level: "Developing",   min: 13, max: 20, desc: "Understandable but inconsistent. Limited audience adaptation. Time management or Q&A depth needs improvement." },
      { range: "0–12",  level: "Insufficient", min: 0,  max: 12, desc: "Unclear or disorganised presentation. Most questions answered incorrectly or not at all." },
    ],
  },
  {
    id: "teamwork",
    label: "Teamwork",
    shortLabel: "Teamwork",
    color: "#EF4444",
    mudek: ["8.1", "8.2"],
    max: 10,
    rubric: [
      { range: "9–10", level: "Excellent",    min: 9, max: 10, desc: "All members participate actively and equally. Professional and ethical conduct observed throughout." },
      { range: "7–8",  level: "Good",         min: 7, max: 8,  desc: "Most members contribute. Minor knowledge gaps. Professionalism mostly observed." },
      { range: "4–6",  level: "Developing",   min: 4, max: 6,  desc: "Uneven participation. Some members are passive or unprepared." },
      { range: "0–3",  level: "Insufficient", min: 0, max: 3,  desc: "Very low participation or dominated by one person. Lack of professionalism observed." },
    ],
  },
];

// ── MÜDEK Dashboard constants ──────────────────────────────────

// Reference threshold line shown on Charts 1 and 2.
// Update here if the department formally adopts a different value.
export const MUDEK_THRESHOLD = 70;

// Achievement band colours — used by Chart 6 and the MÜDEK dropdown rubric tab.
export const BAND_COLORS = {
  Excellent:    { bg: "#DCFCE7", text: "#16A34A" },
  Good:         { bg: "#F7FEE7", text: "#65A30D" },
  Developing:   { bg: "#FEF9C3", text: "#CA8A04" },
  Insufficient: { bg: "#FEE2E2", text: "#DC2626" },
};

// All 18 MÜDEK outcome codes with English and Turkish text.
// Each CRITERIA entry's mudek[] array references codes from this object.
export const MUDEK_OUTCOMES = {
  "1.1": {
    en: "Knowledge in mathematics, natural sciences, fundamental engineering, computational methods, and discipline-specific topics.",
    tr: "Matematik, fen bilimleri, temel mühendislik, bilgisayarla hesaplama ve ilgili mühendislik disiplinine özgü konularda bilgi.",
  },
  "1.2": {
    en: "Ability to apply knowledge of mathematics, natural sciences, fundamental engineering, computation, and discipline-specific topics to solve complex engineering problems.",
    tr: "Matematik, fen bilimleri, temel mühendislik, bilgisayarla hesaplama ve ilgili mühendislik disiplinine özgü konulardaki bilgileri, karmaşık mühendislik problemlerinin çözümünde kullanabilme becerisi.",
  },
  "2": {
    en: "Ability to identify, formulate, and analyse complex engineering problems using fundamental science, mathematics, and engineering knowledge, with consideration of relevant UN Sustainable Development Goals.",
    tr: "Karmaşık mühendislik problemlerini, temel bilim, matematik ve mühendislik bilgilerini kullanarak ve ele alınan problemle ilgili BM Sürdürülebilir Kalkınma Amaçlarını gözetarak tanımlama, formüle etme ve analiz becerisi.",
  },
  "3.1": {
    en: "Ability to design creative solutions to complex engineering problems.",
    tr: "Karmaşık mühendislik problemlerine yaratıcı çözümler tasarlama becerisi.",
  },
  "3.2": {
    en: "Ability to design complex systems, processes, devices, or products under realistic constraints and conditions, meeting current and future requirements.",
    tr: "Karmaşık sistemleri, süreçleri, cihazları veya ürünleri gerçekçi kısıtları ve koşulları gözetarak, mevcut ve gelecekteki gereksinimleri karşılayacak biçimde tasarlama becerisi.",
  },
  "4": {
    en: "Ability to select and use appropriate techniques, resources, and modern engineering and IT tools — including estimation and modelling — for the analysis and solution of complex engineering problems, with awareness of their limitations.",
    tr: "Karmaşık mühendislik problemlerinin analizi ve çözümüne yönelik, tahmin ve modelleme de dahil olmak üzere, uygun teknikleri, kaynakları ve modern mühendislik ve bilişim araçlarını, sınırlamalarının da farkında olarak seçme ve kullanma becerisi.",
  },
  "5": {
    en: "Ability to use research methods for investigating complex engineering problems, including literature review, experiment design, experimentation, data collection, and analysis and interpretation of results.",
    tr: "Karmaşık mühendislik problemlerinin incelenmesi için literatür araştırması, deney tasarlama, deney yapma, veri toplama, sonuçları analiz etme ve yorumlama dahil, araştırma yöntemlerini kullanma becerisi.",
  },
  "6.1": {
    en: "Knowledge of the impacts of engineering applications on society, health and safety, economy, sustainability, and the environment within the scope of UN Sustainable Development Goals.",
    tr: "Mühendislik uygulamalarının BM Sürdürülebilir Kalkınma Amaçları kapsamında, topluma, sağlık ve güvenliğe, ekonomiye, sürdürülebilirlik ve çevreye etkileri hakkında bilgi.",
  },
  "6.2": {
    en: "Awareness of the legal consequences of engineering solutions.",
    tr: "Mühendislik çözümlerinin hukuksal sonuçları konusunda farkındalık.",
  },
  "7.1": {
    en: "Knowledge of acting in accordance with engineering professional principles and ethical responsibility.",
    tr: "Mühendislik meslek ilkelerine uygun davranma, etik sorumluluk hakkında bilgi.",
  },
  "7.2": {
    en: "Awareness of non-discrimination, impartiality, and inclusivity of diversity.",
    tr: "Hiçbir konuda ayrımcılık yapmadan, tarafsız davranma ve çeşitliliği kapsayıcı olma konularında farkındalık.",
  },
  "8.1": {
    en: "Ability to work effectively as a team member or leader in intra-disciplinary teams (in-person, remote, or hybrid).",
    tr: "Bireysel olarak disiplin içi takım çalışmalarında (yüz yüze, uzaktan veya karma) takım üyesi veya lideri olarak etkin biçimde çalışabilme becerisi.",
  },
  "8.2": {
    en: "Ability to work effectively as a team member or leader in multidisciplinary teams (in-person, remote, or hybrid).",
    tr: "Bireysel olarak çok disiplinli takımlarda (yüz yüze, uzaktan veya karma) takım üyesi veya lideri olarak etkin biçimde çalışabilme becerisi.",
  },
  "9.1": {
    en: "Ability to communicate effectively on technical topics orally, adapting to audience differences (education, language, profession, etc.).",
    tr: "Hedef kitlenin çeşitli farklılıklarını (eğitim, dil, meslek gibi) dikkate alarak, teknik konularda sözlü etkin iletişim kurma becerisi.",
  },
  "9.2": {
    en: "Ability to communicate effectively on technical topics in writing, adapting to audience differences (education, language, profession, etc.).",
    tr: "Hedef kitlenin çeşitli farklılıklarını (eğitim, dil, meslek gibi) dikkate alarak, teknik konularda yazılı etkin iletişim kurma becerisi.",
  },
  "10.1": {
    en: "Knowledge of business practices such as project management and economic feasibility analysis.",
    tr: "Proje yönetimi ve ekonomik yapılabilirlik analizi gibi iş hayatındaki uygulamalar hakkında bilgi.",
  },
  "10.2": {
    en: "Awareness of entrepreneurship and innovation.",
    tr: "Girişimcilik ve yenilikçilik hakkında farkındalık.",
  },
  "11": {
    en: "Lifelong learning skills including independent and continuous learning, adaptation to new and emerging technologies, and critical thinking about technological change.",
    tr: "Bağımsız ve sürekli öğrenebilme, yeni ve gelişmekte olan teknolojilere uyum sağlayabilme ve teknolojik değişimlerle ilgili sorgulayıcı düşünebilmeyi kapsayan yaşam boyu öğrenme becerisi.",
  },
};

// ── Derived helpers ───────────────────────────────────────────
export const TOTAL_MAX        = CRITERIA.reduce((s, c) => s + (Number(c.max) || 0), 0);
export const getCriterionById = (id) => CRITERIA.find((c) => c.id === id);
export const getProjectById   = (id) => PROJECTS.find((p) => p.id === id);

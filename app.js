// ── Constants ────────────────────────────────────────
const SM2_KEY         = 'swedish-sm2-state'
const DAILY_KEY       = 'swedish-daily-new'
const DAILY_NEW_LIMIT = 30

const POS_META = {
  verb:        { label: 'Verb',        color: '#4f46e5', bg: '#eef2ff' },
  noun:        { label: 'Noun',        color: '#0891b2', bg: '#ecfeff' },
  adj:         { label: 'Adjective',   color: '#059669', bg: '#ecfdf5' },
  adv:         { label: 'Adverb',      color: '#d97706', bg: '#fffbeb' },
  pronoun:     { label: 'Pronoun',     color: '#7c3aed', bg: '#f5f3ff' },
  prep:        { label: 'Preposition', color: '#db2777', bg: '#fdf2f8' },
  conj:        { label: 'Conjunction', color: '#dc2626', bg: '#fef2f2' },
  numeral:     { label: 'Number',      color: '#065f46', bg: '#ecfdf5' },
  particle:    { label: 'Particle',    color: '#92400e', bg: '#fffbeb' },
  interjection:{ label: 'Expression', color: '#be185d', bg: '#fdf2f8' },
  name:        { label: 'Name',        color: '#374151', bg: '#f9fafb' },
}

// Card-type display metadata (for non-vocab cards)
const CARD_TYPE_META = {
  cloze:    { label: 'Fill in the blank', color: '#7c3aed', bg: '#f5f3ff' },
  sentence: { label: 'Translate',         color: '#059669', bg: '#ecfdf5' },
}

const FILTER_GROUPS = [
  { key: 'All',        label: 'All',        pos: null },
  { key: 'Verbs',      label: 'Verbs',      pos: ['verb'] },
  { key: 'Nouns',      label: 'Nouns',      pos: ['noun'] },
  { key: 'Adjectives', label: 'Adjectives', pos: ['adj', 'adv'] },
  { key: 'Grammar',    label: 'Grammar',    pos: ['pronoun', 'prep', 'conj', 'particle'] },
  { key: 'Numbers',    label: 'Numbers',    pos: ['numeral', 'interjection', 'name'] },
  { key: 'Sentences',  label: 'Sentences 🔒', pos: null },
]

// ── State ────────────────────────────────────────────
let sm2State      = loadSm2State()
let dailyState    = loadDailyState()
let selectedGroup = 'All'
let queue         = []
let currentIndex  = 0
let isFlipped     = false
let sessionStats  = { rated: 0, newVocab: 0, newSent: 0 }

// ── Persistence ──────────────────────────────────────
function loadSm2State() {
  try { return JSON.parse(localStorage.getItem(SM2_KEY)) || {} }
  catch { return {} }
}

function saveSm2State() {
  localStorage.setItem(SM2_KEY, JSON.stringify(sm2State))
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function loadDailyState() {
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_KEY))
    if (raw && raw.date === todayStr()) return raw
    return { date: todayStr(), introduced: [] }
  } catch {
    return { date: todayStr(), introduced: [] }
  }
}

function saveDailyState() {
  localStorage.setItem(DAILY_KEY, JSON.stringify(dailyState))
}

// ── DOM refs ─────────────────────────────────────────
const $filterBar      = document.getElementById('filter-bar')
const $progressWrap   = document.getElementById('progress-wrap')
const $progressLabel  = document.getElementById('progress-label')
const $dueLabel       = document.getElementById('due-label')
const $progressFill   = document.getElementById('progress-fill')
const $cardScene      = document.getElementById('card-scene')
const $cardInner      = document.getElementById('card-inner')
const $frontBadge     = document.getElementById('front-badge')
const $frontWord      = document.getElementById('front-word')
const $backBadge      = document.getElementById('back-badge')
const $backWordSv     = document.getElementById('back-word-sv')
const $backWordEn     = document.getElementById('back-word-en')
const $ratings        = document.getElementById('ratings')
const $ratingsGrid    = document.getElementById('ratings-grid')
const $sessionComplete= document.getElementById('session-complete')
const $completeStats  = document.getElementById('complete-stats')
const $emptyState     = document.getElementById('empty-state')
const $audioBtn       = document.getElementById('audio-btn')
const $resetBtn       = document.getElementById('reset-btn')
const $restartBtn     = document.getElementById('restart-btn')
const $subtitle       = document.getElementById('subtitle')

// ── Init ─────────────────────────────────────────────
function init() {
  buildFilterBar()
  buildRatingButtons()
  startSession()

  $audioBtn.addEventListener('click', e => { e.stopPropagation(); speak() })
  $cardScene.addEventListener('click', handleCardClick)
  $resetBtn.addEventListener('click', handleReset)
  $restartBtn.addEventListener('click', () => startSession())
}

// ── Sentence helpers ──────────────────────────────────

// Returns all queue items (sentence + cloze) that are currently unlocked
function unlockedSentenceItems() {
  const items = []
  for (const sent of SENTENCES) {
    // Sentence unlocks when all component words have been seen at least once
    const allSeen = sent.wordIds.every(id => sm2State[id] !== undefined)
    if (!allSeen) continue

    items.push({ type: 'sentence', sentence: sent, sm2Key: 'sent_' + sent.id })

    // Cloze unlocks when the specific cloze word has been reviewed 3+ times
    const clozeState = sm2State[sent.clozeId]
    if (clozeState && clozeState.repetitions >= 3) {
      items.push({ type: 'cloze', sentence: sent, sm2Key: 'cloze_' + sent.id })
    }
  }
  return items
}

function sentenceDueCount() {
  const now = Date.now()
  return unlockedSentenceItems().filter(item => {
    const state = sm2State[item.sm2Key]
    return state && state.nextDue <= now
  }).length
}

// ── Filter bar ───────────────────────────────────────
function buildFilterBar() {
  const unlockedSent = unlockedSentenceItems().length

  // Update Sentences tab label: show lock/unlock based on progress
  FILTER_GROUPS.find(g => g.key === 'Sentences').label =
    unlockedSent > 0 ? 'Sentences' : 'Sentences 🔒'

  $filterBar.innerHTML = ''
  FILTER_GROUPS.forEach(group => {
    let count
    if (group.key === 'Sentences') {
      count = sentenceDueCount()
    } else if (group.key === 'All') {
      count = dueCount(WORDS, sm2State) + sentenceDueCount()
    } else {
      count = dueCount(wordsForGroup(group.key), sm2State)
    }

    const btn = document.createElement('button')
    btn.className = 'filter-btn' + (group.key === selectedGroup ? ' filter-btn--active' : '')
    btn.dataset.group = group.key
    btn.innerHTML = `${FILTER_GROUPS.find(g => g.key === group.key).label}<span class="filter-badge">${count}</span>`
    btn.addEventListener('click', () => {
      selectedGroup = group.key
      buildFilterBar()
      startSession()
    })
    $filterBar.appendChild(btn)
  })
}

function wordsForGroup(groupKey) {
  if (groupKey === 'All' || groupKey === 'Sentences') return WORDS
  const group = FILTER_GROUPS.find(g => g.key === groupKey)
  if (!group || !group.pos) return WORDS
  return WORDS.filter(w => group.pos.includes(w.pos))
}

// ── Session queue builder ────────────────────────────
function buildDailyQueue(words) {
  const now = Date.now()

  // ── Sentences-only filter ─────────────────────────
  if (selectedGroup === 'Sentences') {
    const allSentItems = unlockedSentenceItems()
    const sentReviews  = allSentItems
      .filter(item => sm2State[item.sm2Key] && sm2State[item.sm2Key].nextDue <= now)
      .sort((a, b) => sm2State[a.sm2Key].nextDue - sm2State[b.sm2Key].nextDue)
    const newSentItems = allSentItems.filter(item => !sm2State[item.sm2Key])
    return [...sentReviews, ...newSentItems]
  }

  // ── Vocab items ───────────────────────────────────
  const introduced = new Set(dailyState.introduced)

  const vocabReviews = words
    .filter(w => sm2State[w.id] && sm2State[w.id].nextDue <= now)
    .sort((a, b) => sm2State[a.id].nextDue - sm2State[b.id].nextDue)
    .map(w => ({ type: 'vocab', word: w, sm2Key: w.id }))

  const unseenWords  = words.filter(w => !sm2State[w.id])
  const resumedToday = unseenWords
    .filter(w => introduced.has(w.id))
    .map(w => ({ type: 'vocab', word: w, sm2Key: w.id }))

  const remaining = Math.max(0, DAILY_NEW_LIMIT - introduced.size)
  const freshNew  = unseenWords
    .filter(w => !introduced.has(w.id))
    .slice(0, Math.max(0, remaining - resumedToday.length))
    .map(w => ({ type: 'vocab', word: w, sm2Key: w.id }))

  freshNew.forEach(item => introduced.add(item.word.id))
  dailyState.introduced = [...introduced]
  saveDailyState()

  // ── POS-only filter (no sentences) ───────────────
  if (selectedGroup !== 'All') {
    return [...vocabReviews, ...resumedToday, ...freshNew]
  }

  // ── All: also include sentence + cloze ────────────
  const allSentItems = unlockedSentenceItems()
  const sentReviews  = allSentItems
    .filter(item => sm2State[item.sm2Key] && sm2State[item.sm2Key].nextDue <= now)
    .sort((a, b) => sm2State[a.sm2Key].nextDue - sm2State[b.sm2Key].nextDue)
  const newSentItems = allSentItems.filter(item => !sm2State[item.sm2Key])

  // Order: all reviews → new vocab → new sentences
  return [...vocabReviews, ...sentReviews, ...resumedToday, ...freshNew, ...newSentItems]
}

function startSession() {
  const words = wordsForGroup(selectedGroup)
  queue        = buildDailyQueue(words)
  currentIndex = 0
  isFlipped    = false
  sessionStats = { rated: 0, newVocab: 0, newSent: 0 }
  updateSubtitle(words)
  renderView()
}

function updateSubtitle(words) {
  if (selectedGroup === 'Sentences') {
    const sentDue  = sentenceDueCount()
    const unlocked = unlockedSentenceItems().length
    const parts = []
    if (sentDue > 0) parts.push(`${sentDue} review${sentDue !== 1 ? 's' : ''} due`)
    parts.push(`${unlocked} sentence${unlocked !== 1 ? 's' : ''} unlocked`)
    $subtitle.textContent = parts.join(' · ')
    return
  }

  const vocabDue   = dueCount(words, sm2State)
  const sentDue    = selectedGroup === 'All' ? sentenceDueCount() : 0
  const totalDue   = vocabDue + sentDue
  const newToday   = dailyState.introduced.length
  const parts = []
  if (totalDue > 0)  parts.push(`${totalDue} review${totalDue !== 1 ? 's' : ''} due`)
  if (newToday > 0)  parts.push(`${newToday}/${DAILY_NEW_LIMIT} new today`)
  else               parts.push(`${DAILY_NEW_LIMIT} new words/day`)
  $subtitle.textContent = parts.join(' · ')
}

// ── Rating buttons ───────────────────────────────────
function buildRatingButtons() {
  $ratingsGrid.innerHTML = ''
  RATINGS.forEach(({ label, quality, color, bg, description }) => {
    const btn = document.createElement('button')
    btn.className = 'rating-btn'
    btn.style.setProperty('--btn-color', color)
    btn.style.setProperty('--btn-bg', bg)
    btn.innerHTML = `<span class="rating-label">${label}</span><span class="rating-desc">${description}</span>`
    btn.addEventListener('click', () => handleRate(quality))
    $ratingsGrid.appendChild(btn)
  })
}

// ── Render ───────────────────────────────────────────
function renderView() {
  hide($progressWrap)
  hide($cardScene)
  hide($ratings)
  hide($sessionComplete)
  hide($emptyState)

  if (queue.length === 0) {
    if (selectedGroup === 'Sentences') {
      // Show a helpful message about how to unlock sentences
      document.querySelector('#empty-state h2').textContent = 'No sentences unlocked yet'
      document.querySelector('#empty-state p').textContent =
        'Keep reviewing vocabulary — sentences unlock once you know all their words.'
    } else {
      document.querySelector('#empty-state h2').textContent = 'No cards found'
      document.querySelector('#empty-state p').textContent = 'No cards in this category.'
    }
    show($emptyState)
    return
  }

  if (currentIndex >= queue.length) {
    const { newVocab, newSent, rated } = sessionStats
    const reviews = rated - newVocab - newSent
    const parts = []
    if (newVocab > 0)  parts.push(`${newVocab} new word${newVocab !== 1 ? 's' : ''}`)
    if (newSent > 0)   parts.push(`${newSent} new sentence${newSent !== 1 ? 's' : ''}`)
    if (reviews > 0)   parts.push(`${reviews} review${reviews !== 1 ? 's' : ''}`)
    if (parts.length === 0) parts.push(`${rated} card${rated !== 1 ? 's' : ''}`)
    $completeStats.textContent = `You studied ${parts.join(', ')} today.`
    show($sessionComplete)
    return
  }

  renderProgress()
  renderCard()
  show($progressWrap)
  show($cardScene)

  if (isFlipped) show($ratings)
}

function renderProgress() {
  const total = queue.length
  $progressLabel.textContent = `Card ${currentIndex + 1} of ${total}`

  const due = selectedGroup === 'Sentences'
    ? sentenceDueCount()
    : dueCount(wordsForGroup(selectedGroup), sm2State) +
      (selectedGroup === 'All' ? sentenceDueCount() : 0)

  if (due > 0) {
    $dueLabel.textContent = `${due} due today`
    show($dueLabel)
  } else {
    hide($dueLabel)
  }
  $progressFill.style.width = `${(currentIndex / total) * 100}%`
}

function renderCard() {
  const item = queue[currentIndex]

  if (item.type === 'vocab') {
    renderVocabCard(item)
  } else if (item.type === 'cloze') {
    renderClozeCard(item)
  } else {
    renderSentenceCard(item)
  }

  $cardInner.classList.toggle('card-inner--flipped', isFlipped)
  $cardScene.classList.remove('card-scene--ready')
  requestAnimationFrame(() => $cardScene.classList.add('card-scene--ready'))
}

function setBadge(el, text, color, bg) {
  el.textContent = text
  el.style.color = color
  el.style.background = bg
}

function renderVocabCard(item) {
  const word = item.word
  const meta = POS_META[word.pos] || POS_META['noun']
  setBadge($frontBadge, meta.label, meta.color, meta.bg)
  setBadge($backBadge,  meta.label, meta.color, meta.bg)

  // Front: big Swedish word + audio button
  $frontWord.className = 'card-word'
  $frontWord.textContent = word.sv
  show($audioBtn)

  // Back: small Swedish echo → divider → large English
  $backWordSv.className = 'card-word card-word--sm'
  $backWordSv.textContent = word.sv
  $backWordEn.className = 'card-answer'
  $backWordEn.textContent = word.en
}

function renderClozeCard(item) {
  const sent  = item.sentence
  const meta  = CARD_TYPE_META.cloze
  const clozeWord = WORDS.find(w => w.id === sent.clozeId)

  setBadge($frontBadge, meta.label, meta.color, meta.bg)
  setBadge($backBadge,  meta.label, meta.color, meta.bg)

  // Front: Swedish sentence with the cloze word blanked out
  $frontWord.className = 'card-word card-word--sentence'
  $frontWord.innerHTML = maskWord(sent.sv, clozeWord.sv, 'cloze-blank', '_____')
  hide($audioBtn)  // speaking would give away the word

  // Back: sentence with the answer highlighted + English below
  $backWordSv.className = 'card-word card-word--sentence'
  $backWordSv.innerHTML = maskWord(sent.sv, clozeWord.sv, 'cloze-answer', clozeWord.sv)
  $backWordEn.className = 'card-answer card-answer--sentence'
  $backWordEn.textContent = sent.en
}

function renderSentenceCard(item) {
  const sent = item.sentence
  const meta = CARD_TYPE_META.sentence

  setBadge($frontBadge, meta.label, meta.color, meta.bg)
  setBadge($backBadge,  meta.label, meta.color, meta.bg)

  // Front: English sentence (translate this)
  $frontWord.className = 'card-word card-word--sentence'
  $frontWord.textContent = sent.en
  hide($audioBtn)  // Swedish audio would give away the answer

  // Back: echo English prompt (small) → divider → Swedish answer (large)
  $backWordSv.className = 'card-word card-word--sm'
  $backWordSv.textContent = sent.en
  $backWordEn.className = 'card-answer card-answer--sentence'
  $backWordEn.textContent = sent.sv
}

// ── Interactions ─────────────────────────────────────
function handleCardClick() {
  if (isFlipped) return
  isFlipped = true
  $cardInner.classList.add('card-inner--flipped')
  show($audioBtn)   // always show audio on back
  show($ratings)
  speak()
}

function handleRate(quality) {
  const item  = queue[currentIndex]
  const isNew = !sm2State[item.sm2Key]
  const prev  = sm2State[item.sm2Key] || { ...DEFAULT_STATE }

  sm2State[item.sm2Key] = applyRating(prev, quality)
  saveSm2State()

  if (isNew) {
    if (item.type === 'vocab') sessionStats.newVocab++
    else                       sessionStats.newSent++
  }
  sessionStats.rated++
  currentIndex++
  isFlipped = false

  buildFilterBar()
  renderView()
}

function handleReset() {
  if (!confirm('Reset all spaced repetition progress? This cannot be undone.')) return
  sm2State   = {}
  dailyState = { date: todayStr(), introduced: [] }
  saveSm2State()
  saveDailyState()
  buildFilterBar()
  startSession()
}

// ── Audio ─────────────────────────────────────────────
function speak() {
  if (!window.speechSynthesis) return
  const item = queue[currentIndex]
  if (!item) return

  // For vocab speak the single word; for sentences speak the full Swedish sentence
  const text = item.type === 'vocab' ? item.word.sv : item.sentence.sv
  const rate = item.type === 'vocab' ? 0.85 : 0.9

  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'sv-SE'
  utter.rate = rate

  $audioBtn.classList.add('audio-btn--playing')
  utter.onend  = () => $audioBtn.classList.remove('audio-btn--playing')
  utter.onerror = () => $audioBtn.classList.remove('audio-btn--playing')

  window.speechSynthesis.speak(utter)
}

// ── HTML / text helpers ──────────────────────────────
function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Replace one occurrence of `targetWord` in `text` with a styled <span>.
// Uses a null-byte placeholder so we can escapeHtml the text safely first.
function maskWord(text, targetWord, className, display) {
  const MASK = '\x00'
  const re   = new RegExp(
    '(?<![\\wåäöÅÄÖ])' +
    targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '(?![\\wåäöÅÄÖ])',
    'i'
  )
  const withMask = text.replace(re, MASK)
  // Escape HTML in the surrounding text; MASK (\x00) is unaffected by escapeHtml
  return escapeHtml(withMask).replace(
    MASK,
    `<span class="${className}">${escapeHtml(display)}</span>`
  )
}

function show(el) { el.style.display = '' }
function hide(el) { el.style.display = 'none' }

// ── Start ─────────────────────────────────────────────
init()

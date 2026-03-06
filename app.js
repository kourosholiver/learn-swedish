// ── Constants ────────────────────────────────────────
const SM2_KEY        = 'swedish-sm2-state'
const DAILY_KEY      = 'swedish-daily-new'
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

// Filter groups shown in the UI
const FILTER_GROUPS = [
  { key: 'All',         label: 'All',         pos: null },
  { key: 'Verbs',       label: 'Verbs',       pos: ['verb'] },
  { key: 'Nouns',       label: 'Nouns',       pos: ['noun'] },
  { key: 'Adjectives',  label: 'Adjectives',  pos: ['adj', 'adv'] },
  { key: 'Grammar',     label: 'Grammar',     pos: ['pronoun', 'prep', 'conj', 'particle'] },
  { key: 'Numbers',     label: 'Numbers',     pos: ['numeral', 'interjection', 'name'] },
]

// ── State ────────────────────────────────────────────
let sm2State      = loadSm2State()
let dailyState    = loadDailyState()
let selectedGroup = 'All'
let queue         = []
let currentIndex  = 0
let isFlipped     = false
let sessionStats  = { rated: 0 }

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
    // New day — reset
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

// ── Filter bar ───────────────────────────────────────
function buildFilterBar() {
  $filterBar.innerHTML = ''
  FILTER_GROUPS.forEach(group => {
    const count = dueCount(wordsForGroup(group.key), sm2State)
    const btn = document.createElement('button')
    btn.className = 'filter-btn' + (group.key === selectedGroup ? ' filter-btn--active' : '')
    btn.dataset.group = group.key
    btn.innerHTML = `${group.label}<span class="filter-badge">${count}</span>`
    btn.addEventListener('click', () => {
      selectedGroup = group.key
      buildFilterBar()
      startSession()
    })
    $filterBar.appendChild(btn)
  })
}

function wordsForGroup(groupKey) {
  if (groupKey === 'All') return WORDS
  const group = FILTER_GROUPS.find(g => g.key === groupKey)
  if (!group || !group.pos) return WORDS
  return WORDS.filter(w => group.pos.includes(w.pos))
}

// ── Session ──────────────────────────────────────────
function buildDailyQueue(words) {
  const now = Date.now()
  const introduced = new Set(dailyState.introduced)

  // 1. Reviews: cards already seen and due now — always show all
  const reviews = words
    .filter(w => sm2State[w.id] && sm2State[w.id].nextDue <= now)
    .sort((a, b) => sm2State[a.id].nextDue - sm2State[b.id].nextDue)

  // 2. New cards (never seen)
  const unseen = words.filter(w => !sm2State[w.id])

  // Cards introduced earlier today (e.g. session restarted mid-day)
  const resumedToday = unseen.filter(w => introduced.has(w.id))

  // Fresh new cards up to remaining daily slots
  const remaining = Math.max(0, DAILY_NEW_LIMIT - introduced.size)
  const freshNew   = unseen
    .filter(w => !introduced.has(w.id))
    .slice(0, Math.max(0, remaining - resumedToday.length))

  // Record all newly introduced cards for today
  freshNew.forEach(w => introduced.add(w.id))
  dailyState.introduced = [...introduced]
  saveDailyState()

  return [...reviews, ...resumedToday, ...freshNew]
}

function startSession() {
  const words = wordsForGroup(selectedGroup)
  queue = buildDailyQueue(words)
  currentIndex = 0
  isFlipped = false
  sessionStats = { rated: 0 }
  updateSubtitle(words)
  renderView()
}

function updateSubtitle(words) {
  const reviews  = dueCount(words, sm2State)
  const newToday = dailyState.introduced.length
  const parts = []
  if (reviews > 0)  parts.push(`${reviews} review${reviews !== 1 ? 's' : ''} due`)
  if (newToday > 0) parts.push(`${newToday}/${DAILY_NEW_LIMIT} new today`)
  else              parts.push(`${DAILY_NEW_LIMIT} new words/day`)
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
    show($emptyState)
    return
  }

  if (currentIndex >= queue.length) {
    const newCount    = dailyState.introduced.length
    const reviewCount = sessionStats.rated - newCount
    const parts = []
    if (newCount > 0)    parts.push(`${newCount} new word${newCount !== 1 ? 's' : ''}`)
    if (reviewCount > 0) parts.push(`${reviewCount} review${reviewCount !== 1 ? 's' : ''}`)
    $completeStats.textContent = `You studied ${parts.join(' and ')} today.`
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
  const due = dueCount(wordsForGroup(selectedGroup), sm2State)
  $progressLabel.textContent = `Card ${currentIndex + 1} of ${total}`
  if (due > 0) {
    $dueLabel.textContent = `${due} due today`
    show($dueLabel)
  } else {
    hide($dueLabel)
  }
  $progressFill.style.width = `${(currentIndex / total) * 100}%`
}

function renderCard() {
  const word = queue[currentIndex]
  const meta = POS_META[word.pos] || POS_META['noun']

  // Badge
  $frontBadge.textContent = meta.label
  $frontBadge.style.color = meta.color
  $frontBadge.style.background = meta.bg

  $backBadge.textContent = meta.label
  $backBadge.style.color = meta.color
  $backBadge.style.background = meta.bg

  // Content
  $frontWord.textContent = word.sv
  $backWordSv.textContent = word.sv
  $backWordEn.textContent = word.en

  // Flip state
  $cardInner.classList.toggle('card-inner--flipped', isFlipped)

  // Animate card entrance
  $cardScene.classList.remove('card-scene--ready')
  requestAnimationFrame(() => $cardScene.classList.add('card-scene--ready'))
}

// ── Interactions ─────────────────────────────────────
function handleCardClick() {
  if (isFlipped) return
  isFlipped = true
  $cardInner.classList.add('card-inner--flipped')
  show($ratings)
  speak()
}

function handleRate(quality) {
  const word = queue[currentIndex]
  const prev = sm2State[word.id] || { ...DEFAULT_STATE }
  sm2State[word.id] = applyRating(prev, quality)
  saveSm2State()

  sessionStats.rated++
  currentIndex++
  isFlipped = false

  buildFilterBar() // refresh due counts
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
  const word = queue[currentIndex]
  if (!word) return

  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(word.sv)
  utter.lang = 'sv-SE'
  utter.rate = 0.85

  $audioBtn.classList.add('audio-btn--playing')
  utter.onend = () => $audioBtn.classList.remove('audio-btn--playing')
  utter.onerror = () => $audioBtn.classList.remove('audio-btn--playing')

  window.speechSynthesis.speak(utter)
}

// ── Helpers ──────────────────────────────────────────
function show(el) { el.style.display = '' }
function hide(el) { el.style.display = 'none' }

// ── Start ─────────────────────────────────────────────
init()

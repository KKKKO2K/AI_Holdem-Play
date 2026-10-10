(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const SUITS = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const HAND_NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
  const AI_DEFAULTS = [
    { name: 'NOVA', mascot: 'fox' },
    { name: 'Olive', mascot: 'owl' },
    { name: 'Miso', mascot: 'cat' },
    { name: 'Pippa', mascot: 'rabbit' },
    { name: 'Bram', mascot: 'lion' }
  ];
  const HUMAN_DEFAULTS = [
    { name: 'You', mascot: 'fox' },
    { name: 'Guest 2', mascot: 'lion' },
    { name: 'Guest 3', mascot: 'owl' },
    { name: 'Guest 4', mascot: 'cat' },
    { name: 'Guest 5', mascot: 'rabbit' },
    { name: 'Guest 6', mascot: 'lion' }
  ];
  const POSITIONS = {
    2: [[50, 91, 'bottom'], [50, 7, 'top']],
    3: [[50, 91, 'bottom'], [26, 19, 'side-left'], [74, 19, 'side-right']],
    4: [[50, 91, 'bottom'], [26, 19, 'side-left'], [50, 7, 'top'], [74, 19, 'side-right']],
    5: [[50, 91, 'bottom'], [26, 81, 'side-left'], [26, 19, 'side-left'], [74, 19, 'side-right'], [74, 81, 'side-right']],
    6: [[50, 91, 'bottom'], [26, 81, 'side-left'], [26, 19, 'side-left'], [50, 7, 'top'], [74, 19, 'side-right'], [74, 81, 'side-right']]
  };
  const MOBILE_ZONES = {
    2: { top: [1], bottom: [0] },
    3: { top: [1, 2], bottom: [0] },
    4: { top: [1, 2], bottom: [0, 3] },
    5: { top: [1, 2], bottom: [0, 3, 4] },
    6: { top: [1, 2, 3], bottom: [0, 4, 5] }
  };
  const strength = {
    balanced: { looseness: 0, aggression: 0.27, bluff: 0.035 },
    careful: { looseness: -0.08, aggression: 0.16, bluff: 0.012 },
    lively: { looseness: 0.06, aggression: 0.42, bluff: 0.09 }
  };

  const defaultSeats = [
    { name: 'You', type: 'human', mascot: 'fox' },
    { name: 'NOVA', type: 'ai', mascot: 'fox' },
    { name: 'Olive', type: 'ai', mascot: 'owl' },
    { name: 'Miso', type: 'ai', mascot: 'cat' }
  ];
  let game = makeGame(defaultSeats);
  let characterSession = HoldemAICharacterSession.create(game);
  const characterPresentation = HoldemAICharacterPresentation.create();
  const tableStory = HoldemTableStory.create();
  let playSettings = HoldemPlaySettings.load();
  const gameSound = HoldemSound.create();
  let savedMatch = HoldemMatchSave.load();
  let latestPublicLine = null;
  let winningPotIndex = 0;
  let handArchive = [];
  let archiveGame = null;
  let archiveHand = -1;
  let replayHand = null;
  let replayIndex = 0;
  let showdownSceneGame = null;
  let showdownSceneHand = -1;
  let showdownConsumed = false;
  let showdownSceneTimers = [];
  let characterCueTimer = null;
  let matchSeats = defaultSeats.map(p => Object.assign({}, p));
  let setupDraft = matchSeats.map(p => Object.assign({}, p));
  let activeViewer = null;
  let forceReveal = false;
  let thinking = false;
  let aiPaused = false;
  let lastAIError = '';
  let aiTimer = null;
  let aiPhase = 'idle';
  let generation = 0;
  let betAmount = 20;
  let lastEquityKey = '';
  let lastLiveKey = '';
  let modalReturnFocus = null;
  let setupInitiallyOpen = true;
  const $app = $('app-shell');
  const tableEffects = HoldemTableEffects.create({
    stage: $('table-stage'), pile: $('pot-chip-pile'), potPill: $('pot-pill'),
    indicator: $('turn-indicator'), panel: $('action-panel')
  });

  function renderRoster() {
    const rows = matchSeats.map((seat, i) => {
      const info = seat.type === 'ai' ? HoldemAIRoster.display(seat) : null;
      const text = info ? info.style + ' · ' + info.skill + ' · ' + info.note : 'Human guest';
      return '<li><strong>Seat ' + (i + 1) + ' · ' +
        escapeHTML(seat.name) + '</strong><small>' + escapeHTML(text) + '</small></li>';
    });
    $('roster-list').innerHTML = rows.join('');
  }

  function makeGame(players, boundary = null) {
    const next = new HoldemGame.Game({
      players: players.map(p => ({ name: p.name, type: p.type, mascot: p.mascot,
        aiStyle: p.aiStyle, aiSkill: p.aiSkill, aiTraits: p.aiTraits })),
      stack: 1500,
      smallBlind: 10,
      bigBlind: 20,
      deferInitialHand: !!boundary
    });
    if (boundary) next.restoreBoundary(boundary);
    if (next.status === 'idle' && typeof next.startHand === 'function') next.startHand();
    return next;
  }

  function fmt(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)).toLocaleString('en-US') : '0';
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  }

  function mascotSVG(kind, size) {
    const s = size || 42;
    const shapes = {
      fox: '<path d="M7 19 11 5l10 9h4l11-9 4 14v8c0 9-7 14-17 14S7 36 7 27v-8Z" fill="#d88a55" stroke="#875239" stroke-width="1.7"/><path d="M12 24c2-4 6-6 12-6s10 2 12 6v4c0 7-5 11-12 11s-12-4-12-11v-4Z" fill="#fff0d9"/><path d="M18 27h.1M30 27h.1" stroke="#283f35" stroke-width="3" stroke-linecap="round"/><path d="m21 32 3-2 3 2-3 2-3-2Z" fill="#68463e"/><path d="m11 9 4 4m18 0 4-4" stroke="#f3c58f" stroke-width="1.8"/>',
      lion: '<path d="m24 3 5 4 7-1 2 7 5 5-3 7 2 7-7 4-3 7-8-2-7 2-4-6-7-3 1-8-3-6 5-6 1-7 8 1 6-4Z" fill="#bd9250" stroke="#80623d" stroke-width="1.7"/><path d="M13 20c0-6 5-10 11-10s11 4 11 10v8c0 7-5 11-11 11s-11-4-11-11v-8Z" fill="#f7d9a2"/><path d="M18 23h.1M30 23h.1" stroke="#4b3c2b" stroke-width="3" stroke-linecap="round"/><path d="M20 29q4 4 8 0m-7 5q3 2 6 0" fill="none" stroke="#805947" stroke-width="1.5" stroke-linecap="round"/>',
      owl: '<path d="M8 19 7 7l11 5q6-3 12 0l11-5-1 13c3 5 2 12-2 17-4 5-10 7-15 7S12 42 8 37c-4-5-5-12 0-18Z" fill="#a47c58" stroke="#6e543d" stroke-width="1.7"/><path d="M9 23c0-8 7-13 15-13s15 5 15 13v7c0 8-7 13-15 13S9 38 9 30v-7Z" fill="#ead7b9"/><circle cx="18" cy="25" r="6" fill="#fff9e9"/><circle cx="30" cy="25" r="6" fill="#fff9e9"/><circle cx="19" cy="25" r="2.2" fill="#31463b"/><circle cx="29" cy="25" r="2.2" fill="#31463b"/><path d="m21 32 3-3 3 3-3 3-3-3Z" fill="#d29a50"/><path d="m14 38 5-2m10 0 5 2" stroke="#8b6847" stroke-width="1.6" stroke-linecap="round"/>',
      cat: '<path d="M8 18 9 5l11 8h8l11-8 1 13c4 5 3 14-1 19-4 5-9 7-14 7s-11-2-14-7c-4-5-5-14-2-19Z" fill="#8b9b86" stroke="#596b5c" stroke-width="1.7"/><path d="M13 23c0-7 5-11 11-11s11 4 11 11v6c0 7-5 12-11 12s-11-5-11-12v-6Z" fill="#f6e6cb"/><path d="M18 25h.1M30 25h.1" stroke="#314338" stroke-width="3" stroke-linecap="round"/><path d="m21 31 3-2 3 2-3 2-3-2Z" fill="#a86d67"/><path d="M13 31 5 29m9 5-8 1m28-4 8-2m-9 5 8 1" stroke="#687967" stroke-width="1.2" stroke-linecap="round"/>',
      rabbit: '<path d="M15 20C8 9 9 0 14 1c5 1 7 11 9 17M28 18c2-12 7-19 11-16 4 3 0 13-5 20" fill="#ded5c2" stroke="#9b917f" stroke-width="1.7"/><path d="M9 27c0-9 6-15 15-15s15 6 15 15v2c0 9-6 14-15 14S9 38 9 29v-2Z" fill="#f4e9d5" stroke="#9b917f" stroke-width="1.7"/><path d="M18 27h.1M30 27h.1" stroke="#3f4a3f" stroke-width="3" stroke-linecap="round"/><path d="m21 32 3-2 3 2-3 2-3-2Z" fill="#bc7e78"/><path d="M19 36q5 4 10 0" fill="none" stroke="#867568" stroke-width="1.5" stroke-linecap="round"/>'
    };
    return '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true" focusable="false">' + (shapes[kind] || shapes.fox) + '</svg>';
  }

  // Generated portrait assets for the full illustrated roster; SVG remains a fallback.
  function mascotPortrait(kind, mood) {
    const portraits = { fox: 'nova_fox', lion: 'lion', owl: 'owl', cat: 'cat', rabbit: 'rabbit' };
    if (!Object.prototype.hasOwnProperty.call(portraits, kind)) return mascotSVG(kind, 38);
    const name = portraits[kind];
    // Mood remains available through seat/status text. Old portrait emotes were
    // retired to legacy so all states retain the user's approved 2026-10-09 art.
    const path = 'assets/runtime/characters/' + name + '.webp';
    return '<img class="mascot-image" src="' + path + '" width="512" height="512" alt="" decoding="async">';
  }

  function rankText(rank) {
    if (Poker && typeof Poker.rankText === 'function') return Poker.rankText(Number(rank));
    const names = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J', 10: '10' };
    return names[rank] || String(rank);
  }

  function cardLabel(card) {
    return rankText(card.rank) + ' of ' + ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' }[card.suit] || 'cards');
  }

  function courtArt(rank, suit) {
    const file = rank === 13 ? 'court_king_lion' : rank === 12 ? 'court_queen_owl' : 'court_jack_fox';
    return '<span class="court-art"><img class="court-illustration" src="assets/runtime/cards/' + file + '_storybook.webp" width="560" height="784" alt="" decoding="async"></span><span class="court-label">' +
      (rank === 13 ? 'KING' : rank === 12 ? 'QUEEN' : 'KNAVE') + ' · ' + (SUITS[suit] || '') + '</span>';
  }

  function cardMarkup(card, mode) {
    if (!card) return '<span class="playing-card placeholder" role="img" aria-label="Community card not dealt"></span>';
    if (mode === 'back') {
      return '<span class="playing-card back" role="img" aria-label="Face-down card"><img class="card-back-art" src="assets/runtime/cards/card_back_botanical.webp" width="560" height="784" alt="" aria-hidden="true" decoding="async"></span>';
    }
    const rank = Number(card.rank);
    const symbol = SUITS[card.suit] || '?';
    const red = card.suit === 'h' || card.suit === 'd';
    const content = rank === 14 ?
      '<span class="ace-art" aria-hidden="true"><img class="ace-illustration" src="assets/runtime/cards/ace_' + ({s:'spade',h:'heart',d:'diamond',c:'club'}[card.suit] || 'spade') + '_botanical.webp" alt="" width="360" height="480" decoding="async"></span>' :
      rank >= 11 && rank <= 13 ? courtArt(rank, card.suit) :
      '<span class="card-center-suit" aria-hidden="true">' + symbol + '</span>';
    return '<span class="playing-card ' + (red ? 'red ' : '') + (rank === 14 ? 'ace' : rank >= 11 ? 'court' : 'numeric') +
      '" role="img" aria-label="' + escapeHTML(cardLabel(card)) + '">' +
      '<span class="card-corner top"><span class="card-rank">' + escapeHTML(rankText(rank)) + '</span><span class="card-mini-suit">' + symbol + '</span></span>' +
      content +
      '<span class="card-corner bottom" aria-hidden="true"><span class="card-rank">' + escapeHTML(rankText(rank)) + '</span><span class="card-mini-suit">' + symbol + '</span></span>' +
      '</span>';
  }

  function activeHumanCount() {
    return game && game.players ? game.players.filter(p => p.type === 'human').length : 0;
  }

  function anyModalOpen() {
    return !$('setup-overlay').hidden || !$('handoff-overlay').hidden || !$('help-overlay').hidden || !$('settings-overlay').hidden;
  }

  function nonGameModalOpen() {
    return !$('setup-overlay').hidden || !$('help-overlay').hidden || !$('settings-overlay').hidden;
  }

  function updateModalInert() {
    const modalOpen = anyModalOpen();
    $app.inert = modalOpen;
    $app.setAttribute('aria-hidden', modalOpen ? 'true' : 'false');
  }

  function focusFirst(overlay, preferred) {
    const target = preferred || overlay.querySelector('button:not([disabled]), select:not([disabled]), input:not([disabled])');
    if (target) target.focus();
  }

  function restoreFocus() {
    if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus();
    else $('reset-btn').focus();
    modalReturnFocus = null;
  }

  function announceTableState() {
    if (!game) return;
    const player = getTurnPlayer();
    const newest = Array.isArray(game.logs) && game.logs[0] ? game.logs[0].message : '';
    const modal = !$('setup-overlay').hidden ? 'setup' : !$('handoff-overlay').hidden ? 'handoff' : !$('help-overlay').hidden ? 'help' : !$('settings-overlay').hidden ? 'settings' : '';
    const key = [game.handNumber, game.street, game.status, game.turn, activeViewer, modal, newest].join('|');
    if (key === lastLiveKey) return;
    lastLiveKey = key;
    let message;
    if (modal === 'setup') message = 'Match setup. Choose the number of seats and player types.';
    else if (modal === 'help') message = 'Poker rules dialog open.';
    else if (modal === 'settings') message = 'Play settings dialog open.';
    else if (modal === 'handoff' && player) message = 'Pass the device to ' + player.name + '. Reveal their hand when ready.';
    else if (game.status === 'active' && player && player.type === 'human') {
      const legal = game.legal(game.turn);
      message = 'Hand ' + game.handNumber + ', ' + (HoldemGame.STREETS[game.street] || 'poker') + '. ' +
        player.name + ', your turn. ' + actionSummary(legal, player) + '.';
    } else if (game.status === 'active' && player) {
      message = 'Hand ' + game.handNumber + ', ' + (HoldemGame.STREETS[game.street] || 'poker') + '. ' + player.name + ' is thinking.';
    } else if (game.status === 'matchover') {
      const summary = outcome();
      message = summary ? summary.title : 'Match complete.';
    } else {
      const summary = outcome();
      message = summary ? summary.title + (summary.detail ? '. ' + summary.detail : '') : 'Hand complete.';
    }
    $('live-status').textContent = message;
  }

  function defaultsForSeat(index, type) {
    if (type === 'human') return Object.assign({}, HUMAN_DEFAULTS[index] || HUMAN_DEFAULTS[HUMAN_DEFAULTS.length - 1]);
    return Object.assign({}, AI_DEFAULTS[Math.min(index - (index > 0 ? 1 : 0), AI_DEFAULTS.length - 1)] || AI_DEFAULTS[0]);
  }

  function setupRowMarkup(index, data) {
    const avatar = data.mascot || 'fox';
    const style = HoldemAIRoster.styleMode(data);
    const skill = HoldemAIRoster.skillMode(data);
    const option = (value, label, chosen) =>
      '<option value="' + value + '"' + (chosen === value ? ' selected' : '') + '>' +
      escapeHTML(label) + '</option>';
    return '<div class="setup-seat-row" data-index="' + index + '">' +
      '<div class="setup-seat-person">' +
      '<span class="setup-seat-number">' + String(index + 1).padStart(2, '0') + '</span>' +
      mascotPortrait(avatar) +
      '<input class="setup-name" type="text" maxlength="20" aria-label="Player name for seat ' + (index + 1) + '" value="' + escapeHTML(data.name) + '">' +
      '</div>' +
      '<select class="setup-type" aria-label="Player type for seat ' + (index + 1) + '">' +
      '<option value="human"' + (data.type === 'human' ? ' selected' : '') + '>Human · hot-seat</option>' +
      '<option value="ai"' + (data.type === 'ai' ? ' selected' : '') + '>AI player</option>' +
      '</select>' +
      '<div class="setup-ai-profile"' + (data.type !== 'ai' ? ' hidden' : '') + '>' +
      '<label>Personality <select class="setup-style" aria-label="AI personality for seat ' + (index + 1) + '">' +
      option('mascot', 'Animal default', style) +
      option('random', 'Surprise me · per match', style) +
      HoldemAIRoster.STYLES.map(p => option(p.id, p.name + ' · ' + p.character, style)).join('') +
      '</select></label>' +
      '<label>Skill <select class="setup-skill" aria-label="AI skill for seat ' + (index + 1) + '">' +
      option('random', 'Mixed · per match', skill) +
      HoldemAIRoster.SKILLS.map(p => option(p.id, p.name, skill)).join('') +
      '</select></label>' +
      '</div></div>';
  }

  function saveDraftFromDOM() {
    document.querySelectorAll('.setup-seat-row').forEach(row => {
      const i = Number(row.dataset.index);
      if (!setupDraft[i]) setupDraft[i] = defaultsForSeat(i, 'ai');
      const name = row.querySelector('.setup-name').value.trim();
      const type = row.querySelector('.setup-type').value;
      setupDraft[i] = Object.assign({}, setupDraft[i], {
        name: name || defaultsForSeat(i, type).name, type,
        aiStyleMode: row.querySelector('.setup-style').value,
        aiSkillMode: row.querySelector('.setup-skill').value
      });
    });
  }

  function renderSetupRows() {
    const count = Number($('seat-count').value) || 4;
    saveDraftFromDOM();
    while (setupDraft.length < count) {
      const i = setupDraft.length;
      setupDraft.push(Object.assign(defaultsForSeat(i, 'ai'), { type: 'ai' }));
    }
    $('setup-seats').innerHTML = setupDraft.slice(0, count).map((p, i) => setupRowMarkup(i, p)).join('');
    $('setup-seats').querySelectorAll('.setup-seat-row').forEach(row => {
      const index = Number(row.dataset.index);
      const typeSelect = row.querySelector('.setup-type');
      const nameInput = row.querySelector('.setup-name');
      typeSelect.addEventListener('change', () => {
        const previousType = setupDraft[index].type;
        const previousName = nameInput.value.trim();
        saveDraftFromDOM();
        const type = typeSelect.value;
        const previousDefault = defaultsForSeat(index, previousType).name;
        if (!previousName || previousName === previousDefault) {
          nameInput.value = defaultsForSeat(index, type).name;
        }
        setupDraft[index].type = type;
        setupDraft[index].name = nameInput.value.trim();
        const mascot = type === 'ai' && nameInput.value.trim().toUpperCase() === 'NOVA' ? 'fox' : defaultsForSeat(index, type).mascot;
        setupDraft[index].mascot = mascot;
        row.querySelector('.mascot-image, svg').outerHTML = mascotPortrait(mascot);
        row.querySelector('.setup-ai-profile').hidden = type !== 'ai';
      });
      nameInput.addEventListener('input', () => {
        saveDraftFromDOM();
        if (nameInput.value.trim().toUpperCase() === 'NOVA' && typeSelect.value === 'ai') {
          setupDraft[index].mascot = 'fox';
          row.querySelector('.mascot-image, svg').outerHTML = mascotPortrait('fox');
        }
      });
    });
  }

  function readSetup() {
    saveDraftFromDOM();
    const count = Number($('seat-count').value) || 4;
    const chosen = setupDraft.slice(0, count).map((p, i) => {
      const type = p.type === 'human' ? 'human' : 'ai';
      const fallback = defaultsForSeat(i, type);
      const name = String(p.name || fallback.name).trim().slice(0, 20) || fallback.name;
      let mascot = p.mascot || fallback.mascot;
      if (type === 'ai' && name.toUpperCase() === 'NOVA') mascot = 'fox';
      return { name, type, mascot,
        aiStyleMode: HoldemAIRoster.styleMode(p),
        aiSkillMode: HoldemAIRoster.skillMode(p) };
    });
    return HoldemAIRoster.resolve(chosen);
  }

  function showSetup() {
    if (anyModalOpen() && $('setup-overlay').hidden && !$('help-overlay').hidden) return;
    modalReturnFocus = document.activeElement;
    clearAITimer();
    cancelShowdownScene();
    if (!setupInitiallyOpen) {
      setupDraft = matchSeats.map(p => Object.assign({}, p));
      $('seat-count').value = String(matchSeats.length);
    } else {
      setupDraft = matchSeats.map(p => Object.assign({}, p));
    }
    activeViewer = null;
    forceReveal = true;
    $('setup-error').hidden = true;
    $('setup-cancel').hidden = setupInitiallyOpen || !game;
    $('setup-overlay').hidden = false;
    $('handoff-overlay').hidden = true;
    $('help-overlay').hidden = true;
    $('settings-overlay').hidden = true;
    renderSetupRows();
    draw();
    updateModalInert();
    focusFirst($('setup-overlay'), $('seat-count'));
  }

  function updateResumeControls() {
    const available = !!savedMatch;
    $('resume-match-btn').hidden = !available;
    $('discard-save-btn').hidden = !available;
    $('resume-info').hidden = !available;
    if (available) $('resume-info').textContent =
      'Saved after Hand #' + savedMatch.boundary.hand +
      '. Continue with a newly dealt hand. Unfinished hands are not saved.';
  }

  function resumeMatch() {
    gameSound.unlock();
    const record = HoldemMatchSave.load();
    if (!record) {
      savedMatch = null;
      updateResumeControls();
      $('setup-error').textContent = 'No valid checkpoint was found. Start a new match.';
      $('setup-error').hidden = false;
      return;
    }
    clearAITimer();
    cancelShowdownScene();
    try {
      // Construct a fresh engine first. Every unsafe boundary or public
      // character state is rejected before swapping out the current match.
      const restored = makeGame(record.roster, record.boundary);
      const memories = HoldemAICharacterSession.create(restored, record.aiStates);
      game = restored;
      if (restored.status === 'active') gameSound.play('deal');
      characterSession = memories;
      characterPresentation.clear();
      if (characterCueTimer !== null) {
        window.clearTimeout(characterCueTimer);
        characterCueTimer = null;
      }
      matchSeats = record.roster.map(p => ({...p}));
      setupDraft = matchSeats.map(p => ({...p}));
      winningPotIndex = 0;
      handArchive = record.history;
      archiveGame = null;
      archiveHand = -1;
      replayHand = handArchive[0]?.hand ?? null;
      replayIndex = 0;
      rebuildHistoryList();
      renderRoster();
      activeViewer = null;
      forceReveal = true; // explicit handoff even in solo play
      thinking = false;
      aiPaused = false;
      lastAIError = '';
      betAmount = restored.bigBlind;
      lastEquityKey = '';
      setupInitiallyOpen = false;
      $('setup-overlay').hidden = true;
      $('setup-error').hidden = true;
      $('checkpoint-status').textContent =
        'Restored after Hand #' + record.boundary.hand +
        (restored.status === 'matchover' ? ' · match complete' : ' · new hand dealt');
      savedMatch = null;
      updateResumeControls();
      updateModalInert();
      draw();
    } catch (error) {
      console.error(error);
      $('setup-error').textContent = 'The checkpoint could not be restored. You can discard it and start fresh.';
      $('setup-error').hidden = false;
    }
  }

  function discardSavedMatch() {
    HoldemMatchSave.clear();
    savedMatch = null;
    updateResumeControls();
    $('checkpoint-status').textContent = 'Previous saved match discarded';
  }

  function startMatch() {
    gameSound.unlock(); // real Start button press; no autoplay on page load
    const seats = readSetup();
    if (!seats.some(p => p.type === 'human')) {
      $('setup-error').hidden = false;
      focusFirst($('setup-overlay'), $('setup-seats').querySelector('.setup-type'));
      return;
    }
    clearAITimer();
    cancelShowdownScene();
    try {
      winningPotIndex = 0;
      handArchive = [];
      archiveGame = null;
      archiveHand = -1;
      replayHand = null;
      replayIndex = 0;
      $('history-list').replaceChildren();
      game = makeGame(seats);
      gameSound.play('deal');
      HoldemMatchSave.clear();
      savedMatch = null;
      updateResumeControls();
      $('checkpoint-status').textContent = 'Autosaves at completed hands only';
      characterSession = HoldemAICharacterSession.create(game);
      characterPresentation.clear();
      if (characterCueTimer !== null) {
        window.clearTimeout(characterCueTimer);
        characterCueTimer = null;
      }
      matchSeats = seats.map(p => Object.assign({}, p));
      setupDraft = matchSeats.map(p => Object.assign({}, p));
      renderRoster();
      activeViewer = null;
      forceReveal = false;
      thinking = false;
      aiPaused = false;
      lastAIError = '';
      betAmount = Number(game.bigBlind) || 20;
      lastEquityKey = '';
      setupInitiallyOpen = false;
      $('setup-overlay').hidden = true;
      $('setup-error').hidden = true;
      updateModalInert();
      draw();
      if ($('handoff-overlay').hidden) {
        if (activeViewer === game.turn) $('call-btn').focus({ preventScroll: true });
        else $('reset-btn').focus();
      }
    } catch (error) {
      console.error(error);
      $('setup-error').textContent = error.message || 'The table could not start. Please review the seats.';
      $('setup-error').hidden = false;
    }
  }

  function closeSetup() {
    if ($('setup-cancel').hidden) return;
    $('setup-overlay').hidden = true;
    setupInitiallyOpen = false;
    updateModalInert();
    draw();
    if ($('handoff-overlay').hidden) restoreFocus();
  }

  function refreshSoundUI() {
    const pref = gameSound.settings();
    const toggle = $('sound-toggle');
    toggle.setAttribute('aria-pressed',String(pref.enabled));
    toggle.setAttribute('aria-label',pref.enabled ? 'Mute game sounds' : 'Enable game sounds');
    toggle.querySelector('.header-label').textContent = pref.enabled ? 'Sound on' : 'Sound off';
    toggle.title = pref.enabled ? 'Mute game sounds' : 'Enable game sounds';
    $('settings-sound').checked = pref.enabled;
    $('settings-volume').value = String(Math.round(pref.volume * 100));
    $('settings-volume-output').textContent = Math.round(pref.volume * 100) + '%';
    $('settings-volume').disabled = !pref.enabled;
    $('sound-preview-kind').disabled = !pref.enabled;
    $('sound-preview').disabled = !pref.enabled || pref.volume===0;
  }
  function soundAfterAction(beforeStreet,kind) {
    if (!game) return;
    // The bet/chip gesture always has its own audible identity, even if the
    // same action ends the betting street. Reveal/payout follow afterward.
    const action = ['fold','check','call','raise','allin'].includes(kind) ?
      kind : 'call';
    gameSound.play(action);
    // Let the physical action transient resolve before the street/award cue:
    // overlapping chip clacks with the board flip made both indistinct on phones.
    const afterAction = Math.min(.8, (HoldemSound.PATTERNS[action]?.duration || .24) + .055);
    if (game.status !== 'active')
      gameSound.play('award',{delay:afterAction});
    else if (game.street > beforeStreet)
      gameSound.play('reveal',{delay:afterAction});
  }
  function fillSettings() {
    refreshSoundUI();
    $('settings-pace').value = playSettings.pace;
    $('settings-reactions').value = playSettings.reactions;
    $('settings-showdown').checked = playSettings.showdown;
  }
  function openSettings() {
    if (nonGameModalOpen()) return;
    modalReturnFocus = document.activeElement;
    clearAITimer();
    cancelShowdownScene();
    activeViewer = null;
    forceReveal = true;
    $('handoff-overlay').hidden = true;
    fillSettings();
    $('settings-overlay').hidden = false;
    draw();
    updateModalInert();
    focusFirst($('settings-overlay'), $('settings-pace'));
  }
  function closeSettings() {
    $('settings-overlay').hidden = true;
    updateModalInert();
    draw();
    if ($('handoff-overlay').hidden) restoreFocus();
  }
  function applySettings() {
    gameSound.configure({enabled:$('settings-sound').checked,
      volume:Number($('settings-volume').value)/100});
    if (gameSound.settings().enabled) gameSound.unlock();
    refreshSoundUI();
    playSettings = HoldemPlaySettings.save({
      pace: $('settings-pace').value,
      reactions: $('settings-reactions').value,
      showdown: $('settings-showdown').checked
    });
    // Timers were already paused on entry. Re-render text; do not touch cards,
    // deal, public ledger, AI decision or current engine settlement.
    cancelShowdownScene();
    draw();
  }

  function openHelp() {
    if (nonGameModalOpen()) return;
    modalReturnFocus = document.activeElement;
    clearAITimer();
    cancelShowdownScene();
    activeViewer = null;
    forceReveal = true;
    $('handoff-overlay').hidden = true;
    $('help-overlay').hidden = false;
    draw();
    updateModalInert();
    focusFirst($('help-overlay'), $('help-close'));
  }

  function closeHelp() {
    $('help-overlay').hidden = true;
    updateModalInert();
    draw();
    if ($('handoff-overlay').hidden) restoreFocus();
  }

  function clearAITimer() {
    generation++;
    if (aiTimer !== null) window.clearTimeout(aiTimer);
    aiTimer = null;
    thinking = false;
    aiPhase = 'idle';
  }

  function getTurnPlayer() {
    if (!game || !Array.isArray(game.players) || game.turn < 0) return null;
    return game.players[game.turn] || null;
  }

  function resolveHumanPrivacy() {
    if (!game || game.status !== 'active' || !game.players[game.turn] || game.players[game.turn].type !== 'human') {
      if (game && game.status === 'active' && activeViewer !== null && game.turn !== activeViewer) activeViewer = null;
      return;
    }
    if (activeViewer === game.turn) return;
    const modalBlocked = !$('setup-overlay').hidden || !$('help-overlay').hidden || !$('settings-overlay').hidden;
    if (modalBlocked || document.hidden) return;
    if (activeHumanCount() === 1 && !forceReveal) {
      activeViewer = game.turn;
      return;
    }
    if (!$('handoff-overlay').hidden) return;
    $('handoff-title').textContent = 'Pass to ' + (game.players[game.turn].name || 'the next player');
    $('handoff-copy').textContent = 'Give the device to ' + (game.players[game.turn].name || 'the next player') +
      '. Their hole cards stay hidden until they choose to look.';
    $('handoff-overlay').hidden = false;
    updateModalInert();
    focusFirst($('handoff-overlay'), $('reveal-btn'));
  }

  function revealCurrentHand() {
    gameSound.unlock();
    if (!game || game.status !== 'active' || !game.players[game.turn] || game.players[game.turn].type !== 'human') return;
    activeViewer = game.turn;
    forceReveal = false;
    $('handoff-overlay').hidden = true;
    updateModalInert();
    draw();
    $('call-btn').focus({ preventScroll: true });
  }

  function resultIsShowdown() {
    return !!(game && game.status === 'finished' && game.result && game.result.reason === 'showdown');
  }

  function canShowPlayerCards(index) {
    const p = game.players[index];
    if (p.type === 'human') {
      // Solo play: one's own live hand remains visible at the outcome.
      // In hot-seat, always require explicit active-viewer authorization.
      const soloReview = resultIsShowdown() && activeHumanCount() === 1 &&
        !p.folded && p.inHand !== false && !anyModalOpen() &&
        !forceReveal && !document.hidden;
      return game.status === 'active' && activeViewer === index ||
        resultIsShowdown() && activeViewer === index && !p.folded ||
        soloReview;
    }
    return resultIsShowdown() && !p.folded && p.inHand !== false;
  }

  function seatIsOut(p) {
    // A 0-stack player is still ALL IN until the hand has settled.
    return p.stack <= 0 && (p.inHand === false || game.status !== 'active');
  }
  function seatState(index, p) {
    if (seatIsOut(p)) return 'OUT';
    if (p.folded) return 'FOLDED';
    if (p.stack <= 0 && p.inHand !== false && game.status === 'active') return 'ALL IN';
    if (game.status === 'active' && game.turn === index) {
      if (p.type === 'human') return 'YOUR TURN';
      if (thinking && game.turn === index) return 'THINKING';
      return 'ACTING';
    }
    if (game.status === 'finished' && game.result && Array.isArray(game.result.winners) && game.result.winners.includes(index)) return 'WINNER';
    return '';
  }

  function seatPositions(count) {
    return POSITIONS[count] || POSITIONS[4];
  }

  function playerMood(player, index) {
    if (!game || !player) return null;
    if (game.status === 'active') return thinking && game.turn === index && player.type === 'ai' ? 'thinking' : null;
    const result = game.result;
    if (!result) return null;
    const winners = Array.isArray(result.winners) ? result.winners.map(normalizeIndex) : [];
    if (Number.isInteger(result.winner)) winners.push(result.winner);
    return winners.includes(index) ? 'win' : 'lose';
  }

  function publishCharacterCues(cues) {
    if (!Array.isArray(cues) || !cues.length) return;
    characterPresentation.publish(cues, game.handNumber);
    if (characterCueTimer !== null) window.clearTimeout(characterCueTimer);
    const session = characterSession;
    characterCueTimer = window.setTimeout(() => {
      characterCueTimer = null;
      if (session !== characterSession) return;
      characterPresentation.expire();
      drawWithoutQueue();
    }, 2180);
  }

  function syncCharacterCues() {
    if (!characterSession) return;
    publishCharacterCues(characterSession.sync());
  }

  function cancelShowdownScene() {
    showdownSceneTimers.forEach(id => window.clearTimeout(id));
    showdownSceneTimers = [];
    $('showdown-cue').hidden = true;
    $('showdown-cue').dataset.phase = '';
    $('hand-finished').classList.remove('showdown-reveal');
  }
  function renderStoryMoments() {
    if (showdownSceneGame !== game || showdownSceneHand !== game.handNumber) {
      cancelShowdownScene();
      showdownSceneGame = game;
      showdownSceneHand = game.handNumber;
      showdownConsumed = false;
      tableStory.reset();
    }
    latestPublicLine = tableStory.observe(game);
    const valid = latestPublicLine && !anyModalOpen() &&
      game.status === 'active' && !document.hidden && !forceReveal;
    $('table-story-note').hidden = !valid || playSettings.reactions !== 'full';
    if (valid && playSettings.reactions === 'full') $('table-story-note').textContent =
      latestPublicLine.name + ' · ' + latestPublicLine.text;
    const scene = HoldemTableStory.showdown(game);
    if (!scene || showdownConsumed) return;
    // No engine pause: chips and result are settled and screen-reader-visible.
    showdownConsumed = true;
    if (anyModalOpen() || document.hidden || forceReveal || !playSettings.showdown ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const banner = $('showdown-cue');
    banner.hidden = false;
    banner.textContent = scene.intro;
    banner.dataset.phase = 'intro';
    $('hand-finished').classList.add('showdown-reveal');
    const currentGame = game, currentHand = game.handNumber;
    const safe = () => game === currentGame && game.handNumber === currentHand &&
      !anyModalOpen() && !document.hidden && !forceReveal;
    showdownSceneTimers.push(window.setTimeout(() => {
      if (!safe()) { cancelShowdownScene(); return; }
      banner.textContent = scene.outcome;
      banner.dataset.phase = 'awarded';
    }, 580));
    showdownSceneTimers.push(window.setTimeout(cancelShowdownScene, 1600));
  }

  function winningFive() {
    return HoldemShowdownFive.select(game, canShowPlayerCards, winningPotIndex);
  }

  function renderSeats() {
    if (!game || !Array.isArray(game.players)) return;
    $('table-stage').dataset.aiPhase = aiPhase;
    const positions = seatPositions(game.players.length);
    const zones = MOBILE_ZONES[game.players.length] || MOBILE_ZONES[4];
    const lastInOddZone = new Set();
    [zones.top, zones.bottom].forEach(indices => { if (indices.length === 3) lastInOddZone.add(indices[2]); });
    const bestFive = winningFive();
    const seatHTML = game.players.map((p, i) => {
      const pos = positions[i] || positions[positions.length - 1];
      const state = seatState(i, p);
      const visible = canShowPlayerCards(i);
      const holes = Array.isArray(p.cards) ? p.cards : [];
      const holeMarkup = holes.slice(0, 2).map((card, n) => {
        const html = cardMarkup(card, visible ? 'face' : 'back');
        const on = visible && bestFive && bestFive.seat === i &&
          bestFive.holeIndices.includes(n);
        return on ? html.replace('class="playing-card ', 'class="playing-card best-five-card ') : html;
      }).join('');
      const layoutClass = pos[2] === 'bottom' ? ' cards-up' : '';
      const button = game.button === i ? '<span class="dealer-chip" aria-label="Dealer button">D</span>' : '';
      const role = game.sb === i ? '<span class="seat-role">SB</span>' : game.bb === i ? '<span class="seat-role">BB</span>' : '';
      const aiHuman = p.type === 'human' ? 'HUMAN' : 'AI';
      const characterCue = p.type === 'ai' && playSettings.reactions !== 'off' ?
        characterPresentation.forSeat(i, game.handNumber) : null;
      const visibleCue = p.folded || (game.status !== 'active' &&
        characterCue && characterCue.kind === 'reaction') ? null : characterCue;
      const cueMarkup = visibleCue ?
        '<span class="character-cue" aria-hidden="true">' +
        escapeHTML(visibleCue.text) + '</span>' : '';
      const publicMoveMarkup = p.type === 'ai' && latestPublicLine &&
        latestPublicLine.hand === game.handNumber && latestPublicLine.seat === i &&
        game.status === 'active' && !anyModalOpen() && !forceReveal &&
        playSettings.reactions === 'full' ?
        '<span class="public-action-note" aria-hidden="true">' +
        escapeHTML(latestPublicLine.text) + '</span>' : '';
      const avatarBg = ({ fox: '#f2dfc9', lion: '#f1dfb8', owl: '#e7ddca', cat: '#dce6d9', rabbit: '#ece5d8' })[p.mascot] || '#eadfc9';
      const classes = 'seat ' + (game.status === 'active' && game.turn === i ? 'turn ' : '') +
        (seatIsOut(p) ? 'out ' : p.folded ? 'folded ' : '') +
        (game.status === 'finished' && game.result && Array.isArray(game.result.winners) && game.result.winners.includes(i) ? 'winner ' : '') +
        (p.type === 'human' ? 'human-seat ' : 'ai-seat ') +
        (p.type === 'ai' && game.status === 'active' && game.turn === i && thinking ? 'ai-thinking ' : '') +
        pos[2] + layoutClass +
        (visible ? ' hand-visible ' : ' ') + (lastInOddZone.has(i) ? 'mobile-last' : '');
      const label = 'Seat ' + (i + 1) + ', ' + p.name + ', ' + aiHuman +
        (state ? ', ' + state.toLowerCase() : '') +
        (visibleCue ? ', ' + visibleCue.text : '') +
        (visible ? ', private cards revealed' : ', private cards hidden');
      const bet = game.status === 'active' && Number(p.committed) > 0 ? '<span class="seat-bet">Bet ' + fmt(p.committed) + '</span>' : '';
      return '<div data-seat-index="' + i + '" class="' + classes + '" style="--seat-x:' + pos[0] + '%;--seat-y:' + pos[1] + '%;--avatar-bg:' + avatarBg + '" role="group" aria-label="' + escapeHTML(label) + '">' +
        button + role +
        '<span class="seat-avatar artwork-avatar">' + mascotPortrait(p.mascot || 'fox', playerMood(p, i)) + '</span>' +
        '<span class="seat-copy"><span class="seat-name-row"><span class="seat-name">' + escapeHTML(p.name) + '</span><span class="seat-type">' + aiHuman + '</span></span>' +
        '<span class="seat-stack"><i class="stack-dot" aria-hidden="true"></i>' + fmt(p.stack) + '</span>' + bet + cueMarkup + publicMoveMarkup + '</span>' +
        '<span class="seat-state">' + escapeHTML(state) + '</span>' +
        '<span class="seat-hole-cards ' + (visible ? 'revealed' : 'concealed') + '" aria-label="' + (visible ? 'Private cards for ' + escapeHTML(p.name) : 'Hidden private cards') + '">' + holeMarkup + '</span>' +
        '</div>';
    });
    const wrapZone = (name, indices) => '<div class="seat-zone seat-zone-' + name + (indices.length === 1 ? ' solo' : '') + '">' +
      indices.map(i => seatHTML[i]).join('') + '</div>';
    $('seat-layer').innerHTML = wrapZone('top', zones.top) + wrapZone('bottom', zones.bottom);
    const novaIndex = game.players.findIndex(p => p.type === 'ai' && p.name === 'NOVA');
    $('nova-spotlight').hidden = novaIndex < 0;
    if (novaIndex >= 0) {
      const src = 'assets/runtime/characters/nova_fox.webp';
      const portrait = $('nova-spotlight').querySelector('img');
      if (portrait.getAttribute('src') !== src) portrait.setAttribute('src', src);
    }
  }

  function renderBoard() {
    const board = game && Array.isArray(game.board) ? game.board : [];
    const bestFive = winningFive();
    const cards = Array.from({ length: 5 }, (_, i) => {
      const html = board[i] ? cardMarkup(board[i], 'face') : cardMarkup(null);
      return bestFive && bestFive.boardIndices.includes(i) ?
        html.replace('class="playing-card ', 'class="playing-card best-five-card ') : html;
    });
    $('community-cards').innerHTML = cards.join('');
    $('community-cards').setAttribute('aria-label', 'Community cards, ' + board.length + ' dealt');
    const value = game ? Number(game.pot) || 0 : 0;
    const settlement = game && game.result && game.result.publicSettlement;
    const settled = !!settlement && game.status !== 'active';
    $('pot-value').textContent = fmt(value);
    $('paid-payout').hidden = !settled;
    $('paid-value').textContent = settled ? fmt(settlement.payout) : '0';
    $('pot-pill').dataset.settled = String(settled);
    $('board-caption').textContent = !board.length ? 'The board is waiting' :
      board.length === 3 ? 'Three cards on the felt' :
      board.length === 4 ? 'The turn is in' : 'The river has landed';
    if (settled) $('board-caption').textContent = bestFive ?
      (bestFive.kind === 'main' ? 'Main pot' : 'Side pot ' + bestFive.potIndex) +
      ' · ' + bestFive.name + ' · winning five highlighted' :
      'Hand complete · chips paid';
    const allIn = game && game.status === 'active' && game.players.some(p => p.stack === 0 && p.inHand !== false);
    if (allIn) {
      const funded = game.players.filter(p => p.inHand && !p.folded && p.stack > 0).length;
      $('all-in-note').textContent = funded > 1 ? 'ALL-IN PLAYER · SIDE-POT BETTING CONTINUES' : 'ALL-IN AT THE TABLE';
    }
    $('all-in-note').hidden = !allIn;
    document.querySelectorAll('.phase-track li').forEach(step => {
      const n = Number(step.dataset.stage);
      step.classList.toggle('active', !!game && game.status === 'active' && n === game.street);
      step.classList.toggle('passed', !!game && (n < game.street || game.status !== 'active' && game.street === 3));
    });
  }

  function renderHandHistory() {
    if (!game || game.status !== 'finished' || !game.result ||
        archiveGame === game && archiveHand === game.handNumber) return;
    const record = HoldemHandHistory.capture(game);
    if (!record) return;
    archiveGame = game;
    archiveHand = game.handNumber;
    handArchive = HoldemHandHistory.append(handArchive, record);
    // Keep an older hand selected while another hand finishes.
    if (replayHand === null || !handArchive.some(entry => entry.hand === replayHand))
      replayHand = record.hand;
    rebuildHistoryList();
    // Save ONLY finished-hand stacks/public AI memories. Mid-hand decks,
    // hole cards and burns are never written to browser storage.
    const checkpoint = HoldemMatchSave.capture(game, matchSeats,
      characterSession, handArchive);
    if (checkpoint) {
      $('checkpoint-status').textContent = HoldemMatchSave.save(checkpoint) ?
        'Saved after Hand #' + checkpoint.boundary.hand +
          ' · refresh during a hand resumes here' :
        'Autosave unavailable in this browser · match remains in memory';
    }
  }

  function rebuildHistoryList() {
    const list = $('history-list');
    list.replaceChildren();
    handArchive.forEach(entry => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Hand #' + entry.hand + ' · ' +
        (entry.reason === 'showdown' ? 'Showdown' : 'Won by folds') +
        ' · ' + fmt(entry.settlement.payout);
      button.dataset.hand = String(entry.hand);
      button.className = entry.hand === replayHand ? 'history-selected' : '';
      button.addEventListener('click', () => {
        replayHand = entry.hand;
        replayIndex = 0;
        renderReplay();
        list.querySelectorAll('button').forEach(el => {
          el.classList.toggle('history-selected', el === button);
        });
      });
      li.append(button);
      list.append(li);
    });
    renderReplay();
  }

  function renderReplay() {
    const entry = handArchive.find(rec => rec.hand === replayHand);
    const panel = $('history-replay');
    panel.hidden = !entry;
    if (!entry) return;
    const steps = HoldemHandHistory.timeline(entry);
    replayIndex = Math.max(0, Math.min(steps.length - 1, replayIndex));
    const step = steps[replayIndex];
    $('history-progress').textContent = 'Hand #' + entry.hand + ' · ' +
      (replayIndex + 1) + ' / ' + steps.length;
    $('history-step').textContent = step.label;
    $('history-board').textContent = step.board.length ?
      step.board.map(c => rankText(c.rank) + (SUITS[c.suit] || '')).join(' ') :
      'Board: waiting';
    $('history-pot').textContent = step.pot === null ?
      '' : step.kind === 'result' ? 'Hand settled' :
      'Pot after action: ' + fmt(step.pot);
    $('history-revealed').textContent = step.kind === 'result' && step.revealed.length ?
      'Shown AI hands: ' + step.revealed.map(r =>
        entry.names[r.seat].name + ' ' + r.cards.map(c =>
          rankText(c.rank) + (SUITS[c.suit] || '')).join(' ')).join(' · ') : '';
    $('history-prev').disabled = replayIndex === 0;
    $('history-next').disabled = replayIndex === steps.length - 1;
  }

  function renderLog() {
    const logs = game && Array.isArray(game.logs) ? game.logs.slice(0, 8) : [];
    const list = $('event-log');
    list.replaceChildren();
    logs.forEach((entry, index) => {
      const li = document.createElement('li');
      const message = document.createElement('span');
      message.textContent = String(entry && entry.message || '');
      li.appendChild(message);
      if (entry && entry.street) {
        const stage = document.createElement('span');
        stage.className = 'log-stage';
        stage.textContent = String(entry.street);
        li.appendChild(stage);
      } else if (index === 0) {
        const newest = document.createElement('span');
        newest.className = 'log-stage';
        newest.textContent = 'NOW';
        li.appendChild(newest);
      }
      list.appendChild(li);
    });
    $('log-count').textContent = logs.length ? logs.length + ' notes' : 'Recent';
  }

  function rankDescription(rank) {
    if (!rank) return '';
    if (typeof rank.description === 'string' && rank.description) return rank.description;
    let score = Array.isArray(rank) ? rank : rank.score;
    const category = Array.isArray(score) ? Number(score[0]) : null;
    let title = rank.description || rank.name || rank.label || (category !== null ? HAND_NAMES[category] : '');
    if (category === 8 && Array.isArray(score)) title = Number(score[1]) === 14 ? 'Royal flush' : 'Straight flush';
    const kickers = Array.isArray(score) ? score.slice(1).map(v => rankText(Number(v))).filter(Boolean) : [];
    if (Array.isArray(rank.kickers)) kickers.push.apply(kickers, rank.kickers.map(v => rankText(Number(v))));
    if (!title && !kickers.length) return '';
    return String(title || 'Best hand') + (kickers.length ? ' · ' + kickers.join(' / ') : '');
  }

  function normalizeIndex(value) {
    if (Number.isInteger(value)) return value;
    if (value && Number.isInteger(value.index)) return value.index;
    if (value && Number.isInteger(value.player)) return value.player;
    return -1;
  }

  function raiseUnavailableReason(legal) {
    if (legal && legal.raiseRight === false) return 'Raising has not reopened.';
    if (legal && Number(legal.maxTotal) <= Number(game.currentBet || 0)) return 'Your remaining stack covers a call only.';
    const responder = game.players.some((p, i) => i !== game.turn && p.inHand && !p.folded && p.stack > 0);
    if (!responder) return 'No opponent can call a raise.';
    return 'Raising is unavailable at this stack.';
  }

  function actionSummary(legal, player) {
    if (!legal || !player) return 'No action is available.';
    const parts = [];
    if (legal.canCheck) parts.push('check');
    if (legal.canCall) parts.push('call ' + fmt(Number(legal.callAmount) || Math.min(legal.toCall, player.stack)));
    if (legal.canRaise) parts.push((legal.canFullRaise === false ? 'all-in raise to ' : 'raise to at least ') +
      fmt(legal.canFullRaise === false ? legal.maxTotal : legal.minTotal));
    else parts.push(raiseUnavailableReason(legal));
    if (legal.canFold !== false) parts.push('fold');
    return parts.join(', ');
  }

  function outcome() {
    const result = game && game.result || {};
    if (!result && game.status !== 'matchover') return null;
    const pots = Array.isArray(result.pots) ? result.pots : [];
    const payouts = [];
    const publicPots = result.publicSettlement ? result.publicSettlement.pots : [];
    publicPots.forEach((pot, i) => {
      const amount = Number(pot.amount) || 0;
      const awards = pot.awards || [];
      if (awards.length) payouts.push((i ? 'Side pot ' + i : 'Main pot') + ' · ' + fmt(amount) + ': ' + awards.map(a => (game.players[a.seat].name || 'Seat') + ' +' + fmt(a.amount)).join(' / '));
    });
    let winnerList = Array.isArray(result.winners) ? result.winners.map(normalizeIndex).filter(n => n >= 0) : [];
    if (!winnerList.length && Number.isInteger(result.winner) && result.winner >= 0) winnerList = [result.winner];
    winnerList = Array.from(new Set(winnerList));
    let title = '';
    if (game.status === 'matchover') {
      const remaining = game.players.filter(p => p.stack > 0).sort((a, b) => b.stack - a.stack);
      const champion = remaining.length ? remaining[0].name : '';
      title = champion ? champion + (champion === 'You' ? ' win the match' : ' wins the match') :
        'The match is complete';
    } else if (pots.length > 1) {
      title = 'Pots awarded';
    } else if (pots.length === 1 && Array.isArray(pots[0].winners) && pots[0].winners.length > 1) {
      title = 'The pot is split';
    } else if (winnerList.length === 1) {
      const winnerName = game.players[winnerList[0]] && game.players[winnerList[0]].name || 'A player';
      title = winnerName + (winnerName === 'You' ? ' take the pot' : ' takes the pot');
    } else if (winnerList.length > 1) {
      title = 'The pot is split';
    } else {
      title = result.message || 'Hand complete';
    }
    // A hot-seat showdown may conceal every human's hand. Never suggest
    // there are cards to compare unless the current viewer is authorized.
    const anyVisibleHand = result.reason === 'showdown' &&
      Array.isArray(result.ranks) && result.ranks.some((rank, i) =>
        rank && game.players[i] && !game.players[i].folded && canShowPlayerCards(i));
    const detail = [result.reason === 'fold' ? 'All other seats folded.' :
      anyVisibleHand ? 'Compare the revealed hands below.' : 'All pots have been awarded.'];
    return { title, detail: detail.join('  ·  '), winnerList, payouts };
  }

  function renderShowdownHands() {
    const target = $('showdown-hands');
    const potChoice = $('winning-five-pot');
    const result = game && game.result;
    if (!result || result.reason !== 'showdown' ||
        game.status !== 'finished' || !Array.isArray(result.ranks)) {
      target.hidden = true;
      target.replaceChildren();
      potChoice.hidden = true;
      potChoice.replaceChildren();
      return;
    }
    const bestFive = winningFive();
    const pots = result.publicSettlement && result.publicSettlement.pots || [];
    // Choosing a pot never reveals cards of an unauthorized human seat.
    potChoice.hidden = pots.length < 2;
    potChoice.replaceChildren();
    if (pots.length > 1) pots.forEach((pot, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = (pot.kind === 'main' ? 'Main pot' : 'Side pot ' + i) +
        ' · ' + fmt(pot.amount);
      potChoice.append(option);
    });
    potChoice.value = String(winningPotIndex);
    const totals = result.publicSettlement && result.publicSettlement.totals || [];
    const paid = seat => totals.find(row => row.seat === seat)?.amount || 0;
    const candidates = game.players.map((player, seat) => ({
      player, seat, rank: result.ranks[seat], amount: paid(seat)
    })).filter(row => row.rank && !row.player.folded && canShowPlayerCards(row.seat));
    candidates.sort((a, b) => Number(b.amount > 0) - Number(a.amount > 0) ||
      Number(b.player.type === 'human') - Number(a.player.type === 'human') ||
      b.amount - a.amount || a.seat - b.seat);
    // Show paid hands plus the owner's hand whenever possible. If the
    // table has more contenders, they stay visible on their own seats.
    const hero = candidates.find(row => row.player.type === 'human' && !row.amount);
    // A two-hand comparison remains readable without pushing the Next
    // hand button below the visible mobile viewport. Other public hands
    // remain available around the table and in the pot breakdown.
    const focused = candidates.slice(0, 2);
    if (hero && !focused.includes(hero)) focused[focused.length - 1] = hero;
    target.hidden = !focused.length;
    target.replaceChildren();
    for (const {player, seat, rank, amount} of focused) {
      const li = document.createElement('li');
      li.className = 'showdown-hand' + (amount ? ' showdown-awarded' : '');
      const left = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = player.name + (player.type === 'human' ? ' · Your hand' : '');
      const cards = document.createElement('span');
      cards.className = 'showdown-hole-summary';
      cards.textContent = player.cards.map(card =>
        rankText(card.rank) + (SUITS[card.suit] || '')).join(' ');
      left.append(name,cards);
      const right = document.createElement('div');
      right.className = 'showdown-combination';
      const description = document.createElement('strong');
      description.textContent = rankDescription(rank);
      const caption = document.createElement('span');
      caption.textContent = bestFive && bestFive.seat === seat ?
        'Best five: ' + bestFive.five.map(card =>
          rankText(card.rank) + (SUITS[card.suit] || '')).join(' ') :
        amount ? 'Won ' + fmt(amount) + ' chips' : 'Shown at showdown';
      right.append(description,caption);
      li.append(left,right);
      target.appendChild(li);
    }
  }

  function renderActions() {
    const active = !!game && game.status === 'active';
    const turnPlayer = active ? getTurnPlayer() : null;
    const humanTurn = !!(turnPlayer && turnPlayer.type === 'human');
    const revealed = humanTurn && activeViewer === game.turn;
    const modalBlocking = anyModalOpen();
    const ready = active && humanTurn && revealed && !thinking && !modalBlocking;
    const legal = ready ? game.legal(game.turn) : null;
    $('action-row').hidden = !active;
    $('hand-finished').hidden = active;
    if (active) renderShowdownHands();
    $('fold-btn').disabled = !ready || !!(legal && legal.canFold === false);
    $('call-btn').disabled = !ready || !legal || !(legal.canCheck || legal.canCall);
    $('raise-btn').disabled = !ready || !legal || !legal.canRaise;
    const actor = ready ? game.players[game.turn] : null;
    const maxTotal = legal ? Number(legal.maxTotal) || 0 : 0;
    $('allin-btn').disabled = !ready || !legal || !actor || actor.stack <= 0 || legal.canAllIn === false;
    $('raise-control').classList.toggle('unavailable', !legal || !legal.canRaise);
    $('bet-slider').disabled = !legal || !legal.canRaise;
    document.querySelectorAll('[data-bet]').forEach(button => { button.disabled = !legal || !legal.canRaise; });
    if (legal) {
      const callAmount = Number.isFinite(Number(legal.callAmount)) ? Number(legal.callAmount) : Math.min(Number(legal.toCall) || 0, Number(legal.stack != null ? legal.stack : actor.stack) || 0);
      $('call-label').textContent = Number(legal.toCall) > 0 ? 'Call ' + fmt(callAmount) : 'Check';
      $('allin-btn').querySelector('span').textContent =
        Number(legal.maxTotal) <= Number(game.currentBet || 0) && Number(legal.toCall) > 0
          ? 'Call all-in ' + fmt(callAmount) : 'All-in to ' + fmt(legal.maxTotal);
      $('raise-caption').textContent = legal.canFullRaise === false && legal.canRaise ? 'All-in raise to' : 'Raise to';
      const min = legal.canFullRaise === false ? maxTotal : Math.max(0, Number(legal.minTotal) || 0);
      const max = Math.max(min, maxTotal);
      $('bet-slider').min = String(min);
      $('bet-slider').max = String(max);
      $('bet-slider').step = '1';
      if (!Number.isFinite(betAmount) || betAmount < min || betAmount > max) betAmount = min;
      if (max === min) betAmount = max;
      $('bet-slider').value = String(betAmount);
      $('raise-value').textContent = fmt(betAmount);
      $('raise-label').textContent = legal.canFullRaise === false && legal.canRaise ? 'Raise all-in' : 'Raise';
    } else {
      $('call-label').textContent = 'Check / call';
      $('allin-btn').querySelector('span').textContent = 'All-in';
      $('raise-value').textContent = '—';
      $('raise-caption').textContent = 'Raise to';
      $('raise-label').textContent = 'Raise';
      $('bet-slider').value = '0';
    }
    if (active) {
      if (humanTurn && !ready) {
        $('turn-title').textContent = 'Private hand';
        $('turn-description').textContent = 'Pass the device and reveal your hand when you are ready.';
      } else if (humanTurn) {
        $('turn-title').textContent = 'YOUR TURN · ' + turnPlayer.name;
        $('turn-description').textContent = legal ? (legal.toCall > 0 ? 'Call ' + fmt(legal.callAmount) : 'Check for free') + ' · Raise-to is the total this round.' + (!legal.canRaise ? ' ' + raiseUnavailableReason(legal) : '') : 'No action is available.';
      } else {
        $('turn-title').textContent = aiPaused ? 'AI decision paused' :
          (turnPlayer && turnPlayer.name || 'AI player') +
          (aiPhase === 'pausing' ? ' takes a moment' : ' is thinking');
        $('turn-description').textContent = aiPaused ? lastAIError :
          aiPhase === 'follow' ? 'A move settles on the felt before the next turn.' :
          aiPhase === 'pausing' ? 'A quiet beat before the decision.' :
          'Watching the table. No one can see anyone else’s private cards.';
      }
    } else {
      const result = outcome();
      $('turn-title').textContent = game && game.status === 'matchover' ? 'Match complete' : 'Hand complete';
      $('turn-description').textContent = game && game.status === 'matchover' ? 'A new match can start whenever the table is ready.' : 'The cards have been settled.';
      const multiSidePots = game && game.result && Array.isArray(game.result.pots) && game.result.pots.length > 1;
      const tiedPot = game && game.result && Array.isArray(game.result.pots) && game.result.pots.length === 1 && game.result.pots[0].winners.length > 1;
      $('result-tag').textContent = multiSidePots ? 'POTS AWARDED' : tiedPot ? 'SPLIT POT' : game && game.status === 'matchover' ? 'MATCH COMPLETE' : game && game.result && game.result.reason === 'fold' ? 'HAND WON BY FOLD' : 'SHOWDOWN';
      $('result-title').textContent = result ? result.title : 'The hand is complete';
      $('result-detail').textContent = result ? result.detail : '';
      renderShowdownHands();
      const settlement = game && game.result && game.result.publicSettlement;
      // Exact payout remains beside the pot; don't triple-repeat it in
      // the result panel where hand strength needs the visual priority.
      $('result-total').textContent = settlement ? fmt(settlement.payout) + ' chips paid' : '';
      $('result-total').hidden = !!settlement;
      $('winner-awards').innerHTML = settlement ? settlement.totals.filter(a => a.amount > 0).map(a => '<li><span>' + escapeHTML(game.players[a.seat].name) + '</span><strong>+' + fmt(a.amount) + '</strong></li>').join('') : '';
      const singleAward = !!settlement && settlement.pots.length === 1 &&
        settlement.totals.filter(a => a.amount > 0).length === 1;
      $('winner-awards').classList.toggle('single-award-redundant', singleAward);
      $('winner-awards').setAttribute('aria-hidden', String(singleAward));
      $('pot-awards').innerHTML = result ? result.payouts.map(line => '<li>' + escapeHTML(line) + '</li>').join('') : '';
      $('settlement-details').hidden = !settlement || settlement.pots.length <= 1 && (!settlement.pots[0] || settlement.pots[0].awards.length <= 1);
      const aHumanWon = !!(result && result.winnerList.some(index => game.players[index] && game.players[index].type === 'human'));
      $('hand-finished').classList.toggle('human-victory', aHumanWon);
      const survivors = game && game.players ? game.players.filter(p => p.stack > 0).length : 0;
      const noHumanLeft = game && game.players.some(p => p.type === 'human') &&
        !game.players.some(p => p.type === 'human' && p.stack > 0);
      const spectating = noHumanLeft && game.status !== 'matchover' && survivors > 1;
      $('spectator-note').hidden = !spectating;
      $('new-match-now-btn').hidden = !spectating;
      $('next-hand-btn').innerHTML = game && game.status === 'matchover' || survivors <= 1 ?
        'New match <span aria-hidden="true">→</span>' :
        spectating ? 'Watch next hand <span aria-hidden="true">→</span>' :
        'Next hand <span aria-hidden="true">→</span>';
      if (spectating) $('turn-description').textContent =
        'All human seats are out of chips. You can spectate the AI table or start again.';
    }
    const wasActive = $('action-panel').dataset.handActive === 'true';
    $('action-panel').dataset.handActive = String(active);
    if (wasActive && !active && !modalBlocking) $('next-hand-btn').focus({ preventScroll: true });
    $('retry-ai-btn').hidden = !(active && turnPlayer && turnPlayer.type === 'ai' && aiPaused);
  }

  function equityEstimate() {
    const blocked = anyModalOpen() || document.hidden || forceReveal;
    const playerIndex = !blocked && activeViewer !== null ? activeViewer :
      !blocked && game && game.status === 'active' && game.players[game.turn] && game.players[game.turn].type === 'human' && activeHumanCount() === 1 ? game.turn : -1;
    const p = game && playerIndex >= 0 ? game.players[playerIndex] : null;
    if (!p || !Array.isArray(p.cards) || p.cards.length !== 2 || !Array.isArray(game.board)) {
      $('equity-number').innerHTML = '—<small>%</small>';
      $('equity-fill').style.width = '0%';
      return;
    }
    const key = playerIndex + ':' + game.handNumber + ':' + game.board.map(c => c.rank + c.suit).join(',') + ':' + p.cards.map(c => c.rank + c.suit).join(',');
    if (key === lastEquityKey) return;
    lastEquityKey = key;
    const opponents = Math.max(1, game.players.filter((op, i) => i !== playerIndex && !op.folded && op.inHand !== false).length);
    const estimate = Poker.equity(p.cards, game.board, 28, Math.random, opponents);
    if (!Number.isFinite(estimate)) {
      $('equity-number').innerHTML = '—<small>%</small>';
      $('equity-fill').style.width = '0%';
      return;
    }
    const pct = Math.round(Math.max(0, Math.min(1, estimate)) * 100);
    $('equity-number').innerHTML = pct + '<small>%</small>';
    $('equity-fill').style.width = pct + '%';
  }

  function draw() {
    if (!game) return;
    resolveHumanPrivacy();
    renderStoryMoments();
    renderSeats();
    renderBoard();
    renderLog();
    renderHandHistory();
    renderActions();
    tableEffects.render(game, { viewer: activeViewer, blocked: anyModalOpen() || document.hidden || forceReveal });
    equityEstimate();
    updateModalInert();
    announceTableState();
    if (game.status === 'active' && game.players[game.turn] && game.players[game.turn].type === 'ai' && !nonGameModalOpen() && !aiPaused) queueAI();
  }

  function legalForHuman() {
    if (!game || game.status !== 'active' || activeViewer !== game.turn || !game.players[game.turn] || game.players[game.turn].type !== 'human' || thinking) return null;
    return game.legal(game.turn);
  }

  function playerAct(type, amount) {
    gameSound.unlock();
    const legal = legalForHuman();
    if (!legal) return;
    const index = game.turn;
    const beforeStreet = game.street;
    const previousViewer = activeViewer;
    const previousForceReveal = forceReveal;
    try {
      if (type === 'check' && !legal.canCheck) throw new Error('You must call or fold.');
      if (type === 'call' && legal.toCall === 0) type = 'check';
      game.act(index, type, amount);
      soundAfterAction(beforeStreet,type);
      syncCharacterCues();
      activeViewer = null;
      forceReveal = false;
      if (game.status === 'active') activeViewer = null;
      else if (!game.result || game.result.reason !== 'showdown') activeViewer = null;
      betAmount = Number(game.bigBlind) || 20;
      draw();
    } catch (error) {
      console.error(error);
      activeViewer = previousViewer;
      forceReveal = previousForceReveal;
      draw();
      $('turn-description').textContent = error.message || 'That action is not available.';
      $('live-status').textContent = error.message || 'That action is not available.';
    }
  }

  // Three distinct phases: consideration, a neutral pre-action beat, then
  // breathing room for the previous public action. Only the final phase
  // can delay ANOTHER AI, never a human turn or settled payout.
  function queueAI() {
    if (aiTimer !== null || aiPaused || !game || game.status !== 'active' ||
        !game.players[game.turn] || game.players[game.turn].type !== 'ai') return;
    const token = ++generation;
    const expectedTurn = game.turn;
    const expectedHand = game.handNumber;
    let timing;
    try {
      const state = characterSession && characterSession.state(expectedTurn);
      timing = HoldemTableTempo.plan(
        { style: state && state.style },
        HoldemTableTempo.publicContext(game, expectedTurn));
    } catch (error) {
      console.error(error);
      aiPaused = true;
      lastAIError = 'AI pacing failed. Retry or start a new match.';
      drawWithoutQueue();
      return;
    }
    const current = () => token === generation && !!game &&
      game.status === 'active' && game.turn === expectedTurn &&
      game.handNumber === expectedHand && !nonGameModalOpen();
    const schedule = (ms, callback) => {
      aiTimer = window.setTimeout(() => {
        aiTimer = null;
        if (!current()) {
          thinking = false;
          aiPhase = 'idle';
          draw();
          return;
        }
        callback();
      }, HoldemPlaySettings.milliseconds(ms, playSettings));
    };
    thinking = true;
    aiPhase = 'thinking';
    drawWithoutQueue();
    schedule(timing.thinkMs, () => {
      aiPhase = 'pausing';
      drawWithoutQueue();
      schedule(timing.commitMs, () => {
        thinking = false;
        aiPhase = 'follow';
        try {
          chooseAIAction(expectedTurn);
        } catch (error) {
          console.error(error);
          aiPaused = true;
          lastAIError = 'AI decision failed: ' +
            (error && error.message || 'unknown error') +
            '. Retry or start a new match.';
        }
        const nextAI = !aiPaused && game.status === 'active' &&
          game.players[game.turn] && game.players[game.turn].type === 'ai' &&
          !nonGameModalOpen();
        if (nextAI) {
          // Keep the turn badge visible, but allow the last move to register.
          aiTimer = window.setTimeout(() => {
            aiTimer = null;
            aiPhase = 'idle';
            if (token === generation && !nonGameModalOpen()) draw();
          }, HoldemPlaySettings.milliseconds(timing.followMs, playSettings));
        } else {
          aiPhase = 'idle';
        }
        draw();
      });
    });
  }

  function drawWithoutQueue() {
    resolveHumanPrivacy();
    renderStoryMoments();
    renderSeats();
    renderBoard();
    renderLog();
    renderHandHistory();
    renderActions();
    tableEffects.render(game, { viewer: activeViewer, blocked: anyModalOpen() || document.hidden || forceReveal });
    equityEstimate();
    updateModalInert();
    announceTableState();
  }

  function chooseAIAction(index) {
    if (!window.HoldemAI) throw new Error('AI strategy module not loaded');
    // One authoritative game action only. CharacterSession uses the same
    // AI.decision path, but safely includes bounded public-history mood.
    const beforeStreet=game.street;
    const outcome=characterSession.act(index);
    const latest=game.publicActions[game.publicActions.length-1];
    soundAfterAction(beforeStreet,latest && latest.type);
    publishCharacterCues(outcome.cues);
  }

  function changeBet(value) {
    const legal = legalForHuman();
    if (!legal || !legal.canRaise) return;
    const min = legal.canFullRaise === false ? Number(legal.maxTotal) : Number(legal.minTotal);
    const max = Number(legal.maxTotal);
    betAmount = Math.max(min, Math.min(max, Number(value) || min));
    $('bet-slider').value = String(betAmount);
    $('raise-value').textContent = fmt(betAmount);
  }

  function presetAmount(kind) {
    const legal = legalForHuman();
    if (!legal || !legal.canRaise) return;
    const max = Number(legal.maxTotal);
    const min = legal.canFullRaise === false ? max : Number(legal.minTotal);
    let target = min;
    if (kind === 'max') target = max;
    if (kind === 'half') target = (Number(game.currentBet) || 0) + Math.ceil((Number(game.pot) + Math.min(Number(legal.toCall) || 0, game.players[game.turn].stack)) / 2);
    if (kind === 'pot') target = (Number(game.currentBet) || 0) + Number(game.pot) + Math.min(Number(legal.toCall) || 0, game.players[game.turn].stack);
    changeBet(Math.max(min, Math.min(max, target)));
  }

  function nextHand() {
    gameSound.unlock();
    if (!game) return;
    if (game.status === 'matchover' || game.players.filter(p => p.stack > 0).length <= 1) {
      showSetup();
      return;
    }
    clearAITimer();
    cancelShowdownScene();
    try {
      winningPotIndex = 0;
      game.startHand();
      gameSound.play('deal');
      characterPresentation.clear();
      if (characterCueTimer !== null) {
        window.clearTimeout(characterCueTimer);
        characterCueTimer = null;
      }
      syncCharacterCues();
      activeViewer = null;
      forceReveal = false;
      aiPaused = false;
      lastAIError = '';
      betAmount = Number(game.bigBlind) || 20;
      lastEquityKey = '';
      draw();
    } catch (error) {
      console.error(error);
      $('turn-description').textContent = error.message || 'The next hand could not start.';
    }
  }

  function focusableIn(overlay) {
    return Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!$('settings-overlay').hidden) { event.preventDefault(); closeSettings(); return; }
      if (!$('help-overlay').hidden) { event.preventDefault(); closeHelp(); return; }
      if (!$('setup-overlay').hidden && !$('setup-cancel').hidden) { event.preventDefault(); closeSetup(); return; }
    }
    const activeOverlay = !$('setup-overlay').hidden ? $('setup-overlay') :
      !$('handoff-overlay').hidden ? $('handoff-overlay') :
      !$('help-overlay').hidden ? $('help-overlay') :
      !$('settings-overlay').hidden ? $('settings-overlay') : null;
    if (activeOverlay && event.key === 'Tab') {
      const items = focusableIn(activeOverlay);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.repeat || activeOverlay) return;
    const target = event.target;
    if (target && target.matches && target.matches('input, select, textarea, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === 'n' && game && game.status !== 'active') { event.preventDefault(); nextHand(); return; }
    if (activeViewer !== game.turn || !game || game.status !== 'active' || !game.players[game.turn] || game.players[game.turn].type !== 'human') return;
    const legal = game.legal(game.turn);
    if (key === 'f' && legal.canFold !== false) { event.preventDefault(); playerAct('fold'); }
    else if (key === 'c' && (legal.canCall || legal.canCheck)) { event.preventDefault(); playerAct(legal.canCall ? 'call' : 'check'); }
    else if (key === 'r' && legal.canRaise) { event.preventDefault(); playerAct('raise', betAmount); }
    else if (key === 'a' && legal.canAllIn) { event.preventDefault(); playerAct('allin'); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelShowdownScene();
    if (document.hidden && activeViewer !== null) {
      activeViewer = null;
      forceReveal = true;
      draw();
    } else if (!document.hidden) draw();
  });
  window.addEventListener('blur', () => {
    if (activeViewer !== null) {
      activeViewer = null;
      forceReveal = true;
      draw();
    }
  });

  // Reserve the dock's actual height, including text wrapping and safe areas.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(entries => {
      document.documentElement.style.setProperty('--action-dock-height', Math.ceil(entries[0].target.getBoundingClientRect().height) + 'px');
    }).observe($('action-panel'));
  }

  $('seat-count').addEventListener('change', renderSetupRows);
  $('start-btn').addEventListener('click', startMatch);
  $('resume-match-btn').addEventListener('click', resumeMatch);
  $('discard-save-btn').addEventListener('click', discardSavedMatch);
  $('setup-cancel').addEventListener('click', closeSetup);
  $('reset-btn').addEventListener('click', showSetup);
  $('settings-btn').addEventListener('click', openSettings);
  $('sound-toggle').addEventListener('click', () => {
    const next = !gameSound.settings().enabled;
    gameSound.configure({enabled:next});
    if (next) { gameSound.unlock(); gameSound.play('check'); }
    refreshSoundUI();
  });
  $('settings-sound').addEventListener('change', applySettings);
  $('settings-volume').addEventListener('input', applySettings);
  $('sound-preview').addEventListener('click', () => {
    gameSound.unlock();
    gameSound.play($('sound-preview-kind').value);
  });
  $('settings-done').addEventListener('click', closeSettings);
  $('settings-pace').addEventListener('change', applySettings);
  $('settings-reactions').addEventListener('change', applySettings);
  $('settings-showdown').addEventListener('change', applySettings);
  $('help-btn').addEventListener('click', openHelp);
  $('help-close').addEventListener('click', closeHelp);
  $('help-done').addEventListener('click', closeHelp);
  $('reveal-btn').addEventListener('click', revealCurrentHand);
  $('next-hand-btn').addEventListener('click', nextHand);
  $('history-prev').addEventListener('click', () => {
    replayIndex--; renderReplay();
  });
  $('history-next').addEventListener('click', () => {
    replayIndex++; renderReplay();
  });
  $('winning-five-pot').addEventListener('change', event => {
    if (!game || game.status !== 'finished' || !game.result ||
        game.result.reason !== 'showdown') return;
    winningPotIndex = Number(event.target.value) || 0;
    drawWithoutQueue();
  });
  $('new-match-now-btn').addEventListener('click', showSetup);
  $('fold-btn').addEventListener('click', () => playerAct('fold'));
  $('call-btn').addEventListener('click', () => {
    const legal = legalForHuman();
    if (!legal) return;
    playerAct(Number(legal.toCall) > 0 ? 'call' : 'check');
  });
  $('raise-btn').addEventListener('click', () => playerAct('raise', betAmount));
  $('allin-btn').addEventListener('click', () => playerAct('allin'));
  $('retry-ai-btn').addEventListener('click', () => {
    aiPaused = false;
    lastAIError = '';
    draw();
  });
  $('bet-slider').addEventListener('input', event => changeBet(event.target.value));
  document.querySelectorAll('[data-bet]').forEach(button => button.addEventListener('click', () => presetAmount(button.dataset.bet)));

  refreshSoundUI();
  renderSetupRows();
  updateResumeControls();
  renderRoster();
  $('setup-overlay').hidden = false;
  $('setup-cancel').hidden = true;
  draw();
  updateModalInert();
  focusFirst($('setup-overlay'), $('seat-count'));
})();

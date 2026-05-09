// ─── State ───────────────────────────────────────────────────────────────
const state = {
  socket: null,
  roomCode: null,
  playerId: null,
  playerName: null,
  role: null,          // 'player' | 'imposter'
  myWord: null,        // null if imposter
  category: null,
  room: null,          // latest room state from server
  timerMax: 30,
  recognition: null,
  recognizing: false,
  speechSupported: false
};

// ─── Avatar colors ────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  '#e94560','#4ade80','#facc15','#60a5fa','#f472b6',
  '#a78bfa','#34d399','#fb923c','#38bdf8','#e879f9'
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function avatarInitial(name) {
  return name.trim().charAt(0).toUpperCase();
}
function makeAvatar(name, size = 36) {
  const el = document.createElement('div');
  el.className = 'player-avatar';
  el.style.cssText = `width:${size}px;height:${size}px;background:${avatarColor(name)};color:#000`;
  el.textContent = avatarInitial(name);
  return el;
}

// ─── Screen router ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${id}`);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

// ─── Toast ────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── Socket setup ─────────────────────────────────────────────────────────
function initSocket() {
  state.socket = io();

  state.socket.on('connect', () => {
    if (state.roomCode && state.playerId) {
      // reconnection — handled by server session if needed
    }
  });

  state.socket.on('error', ({ message }) => {
    toast(message, 'error');
  });

  state.socket.on('room:joined', ({ roomCode, playerId, playerName }) => {
    state.roomCode = roomCode;
    state.playerId = playerId;
    state.playerName = playerName;
    showScreen('lobby');
  });

  state.socket.on('player:role', ({ role, word, category, isImposter }) => {
    state.role = role;
    state.myWord = word;   // null for imposter
    state.category = category;
    renderRoleReveal();
  });

  state.socket.on('room:state', (room) => {
    state.room = room;
    handleRoomState(room);
  });

  state.socket.on('timer:update', (seconds) => {
    updateTimer(seconds);
  });
}

// ─── Room state handler ───────────────────────────────────────────────────
function handleRoomState(room) {
  if (!room) return;
  if (room.settings?.timerDuration) state.timerMax = room.settings.timerDuration;

  switch (room.phase) {
    case 'lobby':          renderLobby(room); break;
    case 'reveal':         updateRevealWaiting(room); break;
    case 'playing':        renderPlaying(room); break;
    case 'voting':         renderVoting(room); break;
    case 'imposter-guess': renderImposterGuessPhase(room); break;
    case 'results':        renderResults(room); break;
    case 'game-over':      renderGameOver(room); break;
  }
}

// ─── LOBBY ────────────────────────────────────────────────────────────────
function renderLobby(room) {
  currentScreenPhase = 'lobby';
  removeGuessOverlay();
  showScreen('lobby');

  document.getElementById('lobby-code').textContent = room.roomCode;
  document.getElementById('player-count-label').textContent =
    `Players (${room.players.length}/10)`;

  // Settings info
  document.getElementById('lobby-rounds').textContent = `${room.settings.totalRounds} rounds`;
  document.getElementById('lobby-imposters').textContent =
    `${room.settings.numImposters} imposter${room.settings.numImposters > 1 ? 's' : ''}`;
  document.getElementById('lobby-timer').textContent =
    room.settings.turnTimer ? '30 seconds' : 'Off';

  // Player list
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  room.players.forEach(p => {
    const item = document.createElement('div');
    item.className = 'player-item';
    const av = makeAvatar(p.name, 36);
    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = p.name;
    const badges = document.createElement('div');
    badges.className = 'player-badges';
    if (p.isHost) badges.innerHTML += '<span class="badge badge-yellow">Host</span>';
    if (p.id === state.playerId) badges.innerHTML += '<span class="badge badge-green">You</span>';
    item.appendChild(av);
    item.appendChild(nameEl);
    item.appendChild(badges);
    list.appendChild(item);
  });

  const isHost = isMyself(room, true);
  document.getElementById('lobby-host-controls').style.display = isHost ? 'flex' : 'none';
  document.getElementById('lobby-waiting-msg').style.display = isHost ? 'none' : 'block';
}

// ─── ROLE REVEAL ──────────────────────────────────────────────────────────
function renderRoleReveal() {
  showScreen('reveal');

  const room = state.room;
  const round = room ? room.round : 1;
  const totalRounds = room ? room.totalRounds : 3;
  document.getElementById('reveal-round-label').textContent =
    `Round ${round} of ${totalRounds}`;

  const card = document.getElementById('reveal-card');
  card.classList.remove('flipped');

  const back = document.getElementById('reveal-back');
  const isImposter = state.role === 'imposter';

  back.className = `reveal-face reveal-back ${isImposter ? 'imposter-card' : 'player-card'}`;
  document.getElementById('reveal-icon').textContent = isImposter ? '🕵️' : '👤';
  document.getElementById('reveal-role-label').textContent = isImposter ? 'YOU ARE THE IMPOSTER' : 'YOU ARE A CIVILIAN';
  document.getElementById('reveal-word').textContent = isImposter ? '???' : (state.myWord || '???');
  document.getElementById('reveal-category').textContent = isImposter
    ? 'Blend in & find the word!'
    : `Category: ${state.category}`;

  document.getElementById('reveal-confirmed').classList.remove('show');
  document.getElementById('reveal-waiting').textContent = '';
}

function updateRevealWaiting(room) {
  const revealScreen = document.getElementById('screen-reveal');
  if (!revealScreen.classList.contains('active')) {
    // Screen not showing yet — wait for player:role event to call renderRoleReveal
    return;
  }
  const revealed = room.players.filter(p => p.hasRevealed).length;
  const total = room.players.length;
  document.getElementById('reveal-waiting').textContent =
    `${revealed}/${total} players confirmed`;
}

// ─── PLAYING ──────────────────────────────────────────────────────────────
let currentScreenPhase = null;

function renderPlaying(room) {
  if (currentScreenPhase !== 'playing') {
    showScreen('playing');
    currentScreenPhase = 'playing';
    stopRecognition();
  }

  const myPlayer = room.players.find(p => p.id === state.playerId);
  const currentTurnPlayer = room.players.find(p => p.id === room.currentTurn);
  const isMyTurn = room.currentTurn === state.playerId;

  // Header
  document.getElementById('play-round-label').textContent =
    `Round ${room.round} of ${room.totalRounds}`;
  document.getElementById('play-phase-label').textContent = 'Discussion Phase';

  // Mini scoreboard
  renderMiniScores(room);

  // Turn banner
  const banner = document.getElementById('turn-banner');
  const turnName = document.getElementById('turn-name');
  const turnSub = document.getElementById('turn-sub');
  const turnIcon = document.getElementById('turn-icon');
  const speakingAnim = document.getElementById('speaking-anim');

  if (currentTurnPlayer) {
    banner.className = `turn-banner${isMyTurn ? ' is-my-turn' : ''}`;
    if (isMyTurn) {
      turnIcon.textContent = '🎤';
      turnName.textContent = 'Your Turn!';
      turnSub.textContent = 'Give a one-word clue';
    } else {
      turnIcon.textContent = '👤';
      turnName.textContent = currentTurnPlayer.name + "'s turn";
      turnSub.textContent = currentTurnPlayer.isSpeaking ? 'Speaking...' : 'Giving a clue';
    }
    speakingAnim.style.display = currentTurnPlayer.isSpeaking ? 'block' : 'none';
  }

  // My word peek
  document.getElementById('my-word-shown').textContent = state.myWord || '???';
  document.getElementById('my-role-badge').textContent =
    state.role === 'imposter' ? '🕵️ Imposter — figure out the word!' : '👤 Civilian';

  // Clue log
  renderClueLog(room.clues || []);

  // Voice zone
  const micBtn = document.getElementById('mic-btn');
  const submitBtn = document.getElementById('btn-submit-clue');
  const passBtn = document.getElementById('btn-pass-clue');

  if (isMyTurn) {
    micBtn.classList.remove('disabled-mic');
    submitBtn.disabled = false;
    passBtn.style.display = room.settings?.allowPassTurn ? '' : 'none';
  } else {
    micBtn.classList.add('disabled-mic');
    submitBtn.disabled = true;
    passBtn.style.display = 'none';
    stopRecognition();
  }

  // Timer visibility
  const timerRing = document.getElementById('timer-ring');
  timerRing.style.display = room.settings?.turnTimer ? 'block' : 'none';
}

function renderMiniScores(room) {
  const container = document.getElementById('mini-scores');
  container.innerHTML = '';
  room.players.forEach(p => {
    const el = document.createElement('div');
    el.className = `mini-score${p.id === room.currentTurn ? ' current-turn' : ''}`;
    const av = document.createElement('div');
    av.className = 'mini-score-avatar';
    av.style.background = avatarColor(p.name);
    av.style.color = '#000';
    av.textContent = avatarInitial(p.name);
    const pts = document.createElement('div');
    pts.className = 'mini-score-pts';
    pts.textContent = `${p.score}pt`;
    const name = document.createElement('div');
    name.className = 'mini-score-name';
    name.textContent = p.id === state.playerId ? 'You' : p.name;
    el.appendChild(av);
    el.appendChild(pts);
    el.appendChild(name);
    container.appendChild(el);
  });
}

function renderClueLog(clues) {
  const scroll = document.getElementById('clue-scroll');
  const noClues = document.getElementById('no-clues-yet');

  if (clues.length === 0) {
    if (noClues) noClues.style.display = 'block';
    const existing = scroll.querySelectorAll('.clue-item');
    existing.forEach(e => e.remove());
    return;
  }

  if (noClues) noClues.style.display = 'none';

  const existingCount = scroll.querySelectorAll('.clue-item').length;
  for (let i = existingCount; i < clues.length; i++) {
    const c = clues[i];
    const item = document.createElement('div');
    item.className = 'clue-item';
    const av = document.createElement('div');
    av.className = 'clue-avatar';
    av.style.background = avatarColor(c.playerName);
    av.style.color = '#000';
    av.textContent = avatarInitial(c.playerName);
    const textWrap = document.createElement('div');
    textWrap.className = 'clue-text';
    const nameEl = document.createElement('div');
    nameEl.className = 'clue-name';
    nameEl.textContent = c.playerName + (c.playerId === state.playerId ? ' (you)' : '');
    const clueEl = document.createElement('div');
    clueEl.className = `clue-word${c.clue === '(passed)' ? ' pass' : ''}`;
    clueEl.textContent = c.clue;
    textWrap.appendChild(nameEl);
    textWrap.appendChild(clueEl);
    item.appendChild(av);
    item.appendChild(textWrap);
    scroll.appendChild(item);
  }
  scroll.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// ─── VOTING ───────────────────────────────────────────────────────────────
function renderVoting(room) {
  if (currentScreenPhase !== 'voting') {
    showScreen('voting');
    currentScreenPhase = 'voting';
    stopRecognition();
  }

  const myPlayer = room.players.find(p => p.id === state.playerId);
  const hasVoted = myPlayer?.hasVoted;

  // Clue recap
  const recap = document.getElementById('vote-clue-recap');
  recap.innerHTML = '';
  (room.clues || []).forEach(c => {
    const item = document.createElement('div');
    item.className = 'clue-item';
    const av = document.createElement('div');
    av.className = 'clue-avatar';
    av.style.background = avatarColor(c.playerName);
    av.style.color = '#000';
    av.textContent = avatarInitial(c.playerName);
    const textWrap = document.createElement('div');
    textWrap.className = 'clue-text';
    const nameEl = document.createElement('div');
    nameEl.className = 'clue-name';
    nameEl.textContent = c.playerName;
    const clueEl = document.createElement('div');
    clueEl.className = `clue-word${c.clue === '(passed)' ? ' pass' : ''}`;
    clueEl.textContent = c.clue;
    textWrap.appendChild(nameEl);
    textWrap.appendChild(clueEl);
    item.appendChild(av);
    item.appendChild(textWrap);
    recap.appendChild(item);
  });

  // Vote grid
  document.getElementById('vote-you-voted').style.display = hasVoted ? 'block' : 'none';

  const grid = document.getElementById('vote-grid');
  grid.innerHTML = '';

  if (!hasVoted) {
    room.players.forEach(p => {
      if (p.id === state.playerId) return; // can't vote for yourself
      const card = document.createElement('div');
      card.className = 'vote-card';
      const av = document.createElement('div');
      av.className = 'vote-avatar';
      av.style.background = avatarColor(p.name);
      av.style.color = '#000';
      av.textContent = avatarInitial(p.name);
      const name = document.createElement('div');
      name.className = 'vote-name';
      name.textContent = p.name;
      card.appendChild(av);
      card.appendChild(name);
      card.onclick = () => castVote(p.id);
      grid.appendChild(card);
    });
  }

  const voted = room.players.filter(p => p.hasVoted).length;
  document.getElementById('vote-status').textContent =
    `${voted}/${room.players.length} votes cast`;
}

function castVote(votedForId) {
  state.socket.emit('game:vote', { votedForId });
}

// ─── IMPOSTER GUESS PHASE ─────────────────────────────────────────────────
let imposterGuessModalShown = false;

function renderImposterGuessPhase(room) {
  if (currentScreenPhase === 'imposter-guess') return;
  currentScreenPhase = 'imposter-guess';
  stopRecognition();

  const amIImposter = room.results?.imposters?.some(i => i.id === state.playerId);

  if (amIImposter) {
    showImposterGuessModal(room);
  } else {
    // Show waiting screen for other players
    showWaitingForImposterGuess(room);
  }
}

function showWaitingForImposterGuess(room) {
  if (!document.getElementById('imposter-guess-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'imposter-guess-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:900;background:rgba(0,0,0,0.85);
      display:flex;align-items:center;justify-content:center;padding:24px;
    `;
    const box = document.createElement('div');
    box.className = 'card';
    box.style.cssText = 'max-width:360px;width:100%;text-align:center;display:flex;flex-direction:column;gap:12px';
    const imposterNames = room.results?.imposters?.map(i => i.name).join(', ') || 'the imposter';
    box.innerHTML = `
      <div style="font-size:3rem">🕵️</div>
      <h2 style="color:var(--accent)">Imposter Caught!</h2>
      <p style="color:var(--text-muted);font-size:0.9rem">
        <strong>${imposterNames}</strong> is trying to guess the secret word...
      </p>
      <p style="color:var(--text-muted);font-size:0.8rem">Category: <strong style="color:var(--text)">${room.category}</strong></p>
      <div style="color:var(--text-muted);font-size:0.85rem">Waiting<span class="waiting-dots">...</span></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
}

function removeGuessOverlay() {
  const overlay = document.getElementById('imposter-guess-overlay');
  if (overlay) overlay.remove();
  imposterGuessModalShown = false;
}

// ─── RESULTS ─────────────────────────────────────────────────────────────
function renderResults(room) {
  removeGuessOverlay();
  if (currentScreenPhase !== 'results') {
    showScreen('results');
    currentScreenPhase = 'results';
  }

  const r = room.results;
  if (!r) return;

  document.getElementById('results-round-label').textContent =
    `Round ${room.round} Results`;

  const icon = document.getElementById('results-icon');
  const title = document.getElementById('results-title');
  const desc = document.getElementById('results-desc');

  if (r.caughtImposter && !r.imposterGuessedWord) {
    icon.textContent = '🎉';
    title.textContent = 'Civilians Win!';
    desc.textContent = `The imposter was caught${r.imposterGuessedWord === false ? ' and failed to guess the word' : ''}!`;
    title.style.color = 'var(--success)';
  } else if (r.imposterGuessedWord) {
    icon.textContent = '🕵️';
    title.textContent = 'Imposter Wins!';
    desc.textContent = 'Voted out but guessed the secret word!';
    title.style.color = 'var(--accent)';
  } else if (!r.caughtImposter) {
    icon.textContent = '🕵️';
    title.textContent = 'Imposter Wins!';
    desc.textContent = r.tie ? "It was a tie — imposter slipped away!" : "The imposter was not voted out!";
    title.style.color = 'var(--accent)';
  }

  document.getElementById('result-normal-word').textContent = r.normalWord;
  document.getElementById('result-imposter-word').textContent = '(no word)';

  // Imposters reveal
  const imposterEl = document.getElementById('results-imposters');
  imposterEl.innerHTML = '';
  r.imposters.forEach(imp => {
    const item = document.createElement('div');
    item.className = 'player-item';
    const av = makeAvatar(imp.name, 36);
    const nameEl = document.createElement('div');
    nameEl.className = 'player-name';
    nameEl.textContent = imp.name;
    const badge = document.createElement('span');
    badge.className = 'badge badge-red';
    badge.textContent = '🕵️ Imposter';
    item.appendChild(av);
    item.appendChild(nameEl);
    item.appendChild(badge);
    imposterEl.appendChild(item);
  });

  // Scoreboard
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const board = document.getElementById('scoreboard');
  board.innerHTML = '';
  sorted.forEach((p, i) => {
    const isImposter = r.imposters.some(imp => imp.id === p.id);
    const delta = r.scoreDeltas?.[p.id] || 0;
    const item = document.createElement('div');
    item.className = `score-item${isImposter ? ' is-imposter' : ''}`;
    const rank = document.createElement('div');
    rank.className = `score-rank${i === 0 ? ' top1' : ''}`;
    rank.textContent = i === 0 ? '🥇' : `${i + 1}.`;
    const av = makeAvatar(p.name, 32);
    const nameEl = document.createElement('div');
    nameEl.className = 'score-name';
    nameEl.textContent = p.name + (p.id === state.playerId ? ' (you)' : '') + (isImposter ? ' 🕵️' : '');
    const pts = document.createElement('div');
    pts.style.textAlign = 'right';
    const ptsMain = document.createElement('div');
    ptsMain.className = 'score-pts';
    ptsMain.textContent = `${p.score}pt`;
    if (delta > 0) {
      const deltaEl = document.createElement('div');
      deltaEl.className = 'score-delta';
      deltaEl.textContent = `+${delta}`;
      pts.appendChild(deltaEl);
    }
    pts.appendChild(ptsMain);
    item.appendChild(rank);
    item.appendChild(av);
    item.appendChild(nameEl);
    item.appendChild(pts);
    board.appendChild(item);
  });

  const isHost = isMyself(room, true);
  const nextRoundBtn = document.getElementById('btn-next-round');
  if (nextRoundBtn) {
    nextRoundBtn.textContent = room.round >= room.totalRounds
      ? 'See Final Scores' : 'Next Round ▶';
  }
  document.getElementById('results-host-actions').style.display = isHost ? 'block' : 'none';
  document.getElementById('results-wait-msg').style.display = isHost ? 'none' : 'block';
}

// ─── GAME OVER ────────────────────────────────────────────────────────────
function renderGameOver(room) {
  showScreen('game-over');
  currentScreenPhase = 'game-over';

  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  const board = document.getElementById('final-scoreboard');
  board.innerHTML = '';
  sorted.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'score-item';
    const rank = document.createElement('div');
    rank.className = `score-rank${i === 0 ? ' top1' : ''}`;
    rank.textContent = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const av = makeAvatar(p.name, 32);
    const nameEl = document.createElement('div');
    nameEl.className = 'score-name';
    nameEl.textContent = p.name + (p.id === state.playerId ? ' (you)' : '');
    const pts = document.createElement('div');
    pts.className = 'score-pts';
    pts.textContent = `${p.score}pt`;
    item.appendChild(rank);
    item.appendChild(av);
    item.appendChild(nameEl);
    item.appendChild(pts);
    board.appendChild(item);
  });

  const isHost = isMyself(room, true);
  document.getElementById('gameover-host-actions').style.display = isHost ? 'block' : 'none';
}

// ─── IMPOSTER GUESS MODAL ─────────────────────────────────────────────────
function showImposterGuessModal(room) {
  if (document.getElementById('imposter-guess-overlay')) return; // already shown

  const overlay = document.createElement('div');
  overlay.id = 'imposter-guess-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.85);
    display:flex;align-items:center;justify-content:center;padding:24px;
  `;
  const modal = document.createElement('div');
  modal.className = 'card';
  modal.style.cssText = 'max-width:360px;width:100%;text-align:center;display:flex;flex-direction:column;gap:16px';
  modal.innerHTML = `
    <div style="font-size:3rem">🕵️</div>
    <h2 style="color:var(--accent)">You've Been Caught!</h2>
    <p style="color:var(--text-muted);font-size:0.9rem">
      Guess the secret word to still win!<br>You have <strong>30 seconds</strong>.
    </p>
    <div style="font-size:0.8rem;color:var(--text-muted)">
      Category: <strong style="color:var(--text)">${room.category || '?'}</strong>
    </div>
    <input type="text" id="imposter-guess-input" placeholder="Type the secret word..."
      style="text-align:center;font-size:1.1rem;font-weight:700;letter-spacing:1px"
      autocomplete="off" autocorrect="off" spellcheck="false">
    <button class="btn btn-primary" id="imposter-guess-btn">Guess Word</button>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const input = modal.querySelector('#imposter-guess-input');
  const btn = modal.querySelector('#imposter-guess-btn');

  input.focus();
  btn.onclick = () => {
    const guess = input.value.trim();
    if (!guess) return;
    btn.disabled = true;
    btn.textContent = 'Guessing...';
    state.socket.emit('game:imposter-guess', { guess });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click();
  });
}

// ─── TIMER ────────────────────────────────────────────────────────────────
function updateTimer(seconds) {
  const ring = document.getElementById('timer-ring');
  const timerText = document.getElementById('timer-text');
  const progress = document.getElementById('timer-progress');

  if (seconds === null || seconds === undefined) {
    ring.style.display = 'none';
    return;
  }

  ring.style.display = 'block';
  timerText.textContent = seconds;

  const max = state.timerMax;
  const circumference = 138.2;
  const fraction = Math.max(0, seconds / max);
  progress.style.strokeDashoffset = circumference * (1 - fraction);

  if (seconds <= 10) {
    ring.classList.add('timer-urgent');
  } else {
    ring.classList.remove('timer-urgent');
  }
}

// ─── VOICE / SPEECH ───────────────────────────────────────────────────────
function initSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.speechSupported = false;
    document.getElementById('mic-btn').style.display = 'none';
    return;
  }
  state.speechSupported = true;
  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    state.recognizing = true;
    document.getElementById('mic-btn').classList.add('recording');
    document.getElementById('mic-btn').textContent = '⏹';
    state.socket.emit('player:speaking', { isSpeaking: true });
  };

  rec.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    const transcript = document.getElementById('voice-transcript');
    transcript.textContent = final || interim;
  };

  rec.onerror = (e) => {
    if (e.error !== 'no-speech') toast(`Mic error: ${e.error}`, 'error');
    stopRecognition();
  };

  rec.onend = () => {
    stopRecognition();
  };

  state.recognition = rec;
}

function toggleRecognition() {
  if (!state.speechSupported) return;
  if (state.recognizing) {
    stopRecognition();
  } else {
    startRecognition();
  }
}

function startRecognition() {
  if (!state.recognition || state.recognizing) return;
  try {
    state.recognition.start();
  } catch (e) { /* already started */ }
}

function stopRecognition() {
  state.recognizing = false;
  const btn = document.getElementById('mic-btn');
  btn.classList.remove('recording');
  btn.textContent = '🎤';
  if (state.recognition) {
    try { state.recognition.stop(); } catch (_) {}
  }
  state.socket.emit?.('player:speaking', { isSpeaking: false });
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function isMyself(room, asHost = false) {
  if (!room) return false;
  const p = room.players.find(p => p.id === state.playerId);
  return asHost ? p?.isHost : !!p;
}

function getMyPlayer(room) {
  return room?.players.find(p => p.id === state.playerId);
}

// ─── Event bindings ───────────────────────────────────────────────────────
function bindEvents() {
  // Home
  document.getElementById('btn-create').onclick = () => showScreen('create');
  document.getElementById('btn-join-nav').onclick = () => showScreen('join');

  // Create
  document.getElementById('btn-back-create').onclick = () => showScreen('home');
  document.getElementById('btn-create-room').onclick = () => {
    const name = document.getElementById('create-name').value.trim();
    if (!name) { toast('Enter your name', 'error'); return; }
    const settings = {
      totalRounds: parseInt(document.getElementById('setting-rounds').value),
      numImposters: parseInt(document.getElementById('setting-imposters').value),
      turnTimer: document.getElementById('setting-timer').checked,
      timerDuration: 30,
      allowPassTurn: document.getElementById('setting-pass').checked
    };
    state.socket.emit('room:create', { playerName: name, settings });
  };

  // Join
  document.getElementById('btn-back-join').onclick = () => showScreen('home');
  document.getElementById('btn-join-room').onclick = () => {
    const code = document.getElementById('join-code').value.trim();
    const name = document.getElementById('join-name').value.trim();
    if (!code || code.length < 4) { toast('Enter the 4-letter room code', 'error'); return; }
    if (!name) { toast('Enter your name', 'error'); return; }
    state.socket.emit('room:join', { roomCode: code, playerName: name });
  };
  document.getElementById('join-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  // Lobby code copy
  document.getElementById('lobby-code').onclick = () => {
    const code = document.getElementById('lobby-code').textContent;
    navigator.clipboard?.writeText(code).then(() => toast('Room code copied!', 'success'));
  };

  // Start game
  document.getElementById('btn-start-game').onclick = () => {
    state.socket.emit('game:start');
  };

  // Role reveal: tap 1 = flip card, tap 2 = confirm
  document.getElementById('reveal-card').addEventListener('click', () => {
    const card = document.getElementById('reveal-card');
    const confirmed = document.getElementById('reveal-confirmed');
    if (confirmed.classList.contains('show')) return; // already confirmed
    if (!card.classList.contains('flipped')) {
      card.classList.add('flipped');
    } else {
      confirmed.classList.add('show');
      state.socket.emit('player:revealed');
    }
  });

  // My word peek
  document.getElementById('my-word-peek').onclick = function() {
    const hidden = document.getElementById('my-word-hidden');
    const shown = document.getElementById('my-word-shown');
    const isShowing = shown.style.display !== 'none';
    hidden.style.display = isShowing ? 'block' : 'none';
    shown.style.display = isShowing ? 'none' : 'block';
  };

  // Mic button
  document.getElementById('mic-btn').onclick = toggleRecognition;

  // Submit clue
  document.getElementById('btn-submit-clue').onclick = () => {
    const transcript = document.getElementById('voice-transcript');
    const clue = transcript.textContent.trim();
    if (!clue) { toast('Enter a clue word first', 'error'); return; }
    stopRecognition();
    state.socket.emit('player:clue', { clue });
    transcript.textContent = '';
  };

  // Pass turn
  document.getElementById('btn-pass-clue').onclick = () => {
    stopRecognition();
    state.socket.emit('player:pass');
    document.getElementById('voice-transcript').textContent = '';
  };

  // Voice transcript enter key
  document.getElementById('voice-transcript').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('btn-submit-clue').click();
    }
  });

  // Results - next round / end game
  document.getElementById('btn-next-round').onclick = () => {
    const room = state.room;
    if (room && room.round >= room.totalRounds) {
      state.socket.emit('game:next-round'); // triggers game-over
    } else {
      state.socket.emit('game:next-round');
    }
  };
  document.getElementById('btn-end-game').onclick = () => {
    state.socket.emit('game:restart');
    currentScreenPhase = null;
  };

  // Game over
  document.getElementById('btn-play-again').onclick = () => {
    state.socket.emit('game:restart');
    currentScreenPhase = null;
  };
  document.getElementById('btn-back-home').onclick = () => {
    location.reload();
  };

  // Keyboard: submit on Enter in create-name / join inputs
  document.getElementById('create-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create-room').click();
  });
  document.getElementById('join-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join-room').click();
  });
  document.getElementById('join-code').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('join-name').focus();
  });
}

// ─── Socket additional handlers ────────────────────────────────────────────
function bindSocketExtras() {
  state.socket.on('game:imposter-guessed', ({ correct, guess, word }) => {
    removeGuessOverlay();
    if (correct) {
      toast(`🕵️ Imposter guessed "${guess}" correctly — Imposter wins!`, 'error', 4000);
    } else {
      toast(`❌ Wrong guess ("${guess}"). The word was "${word}". Civilians win!`, 'success', 4000);
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
function init() {
  initSocket();
  initSpeech();
  bindEvents();
  bindSocketExtras();
}

document.addEventListener('DOMContentLoaded', init);

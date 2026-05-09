const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static('public'));

// Single secret words per category — all civilians get this word; imposter gets nothing
const WORD_CATEGORIES = {
  'Food & Drinks': [
    'Pizza', 'Sushi', 'Coffee', 'Burger', 'Tacos', 'Chocolate', 'Pancake',
    'Ice Cream', 'Lemonade', 'Steak', 'Waffle', 'Pasta', 'Popcorn', 'Donut',
    'Cheesecake', 'Hot Dog', 'Smoothie', 'Croissant', 'Ramen', 'Barbecue'
  ],
  'Animals': [
    'Lion', 'Dolphin', 'Eagle', 'Penguin', 'Elephant', 'Gorilla', 'Crocodile',
    'Butterfly', 'Owl', 'Wolf', 'Flamingo', 'Panda', 'Cheetah', 'Octopus',
    'Koala', 'Peacock', 'Platypus', 'Kangaroo', 'Narwhal', 'Chameleon'
  ],
  'Sports': [
    'Soccer', 'Basketball', 'Tennis', 'Swimming', 'Boxing', 'Golf', 'Volleyball',
    'Cycling', 'Archery', 'Skiing', 'Baseball', 'Surfing', 'Wrestling', 'Gymnastics',
    'Ice Skating', 'Rock Climbing', 'Fencing', 'Polo', 'Rowing', 'Darts'
  ],
  'Places': [
    'Beach', 'Museum', 'Airport', 'Casino', 'Library', 'Stadium', 'Hospital',
    'Zoo', 'Restaurant', 'Cinema', 'Gym', 'School', 'Lighthouse', 'Aquarium',
    'Amusement Park', 'Observatory', 'Submarine', 'Space Station', 'Volcano', 'Jungle'
  ],
  'Technology': [
    'Smartphone', 'Laptop', 'Robot', 'Satellite', 'Drone', 'Smart Watch',
    'VR Headset', 'Electric Car', 'Camera', 'Printer', 'Submarine', 'Telescope',
    'Microscope', 'Radar', '3D Printer', 'Hovercraft', 'Nuclear Reactor', 'Laser'
  ],
  'Movies & TV': [
    'Western', 'Comedy', 'Horror', 'Documentary', 'Anime', 'Musical',
    'Thriller', 'Superhero', 'Sitcom', 'Reality TV', 'Talk Show', 'Soap Opera',
    'Cartoon', 'Detective', 'Fantasy', 'Science Fiction', 'Romance', 'War Film'
  ],
  'Nature': [
    'Volcano', 'Waterfall', 'Desert', 'Rainforest', 'Glacier', 'Canyon',
    'Coral Reef', 'Cave', 'Geyser', 'Iceberg', 'Tornado', 'Aurora', 'Tsunami',
    'Avalanche', 'Rainbow', 'Eclipse', 'Tide Pool', 'Quicksand', 'Fog', 'Thunderstorm'
  ],
  'Household': [
    'Sofa', 'Bathtub', 'Microwave', 'Lamp', 'Mirror', 'Refrigerator',
    'Bookshelf', 'Fireplace', 'Aquarium', 'Hammock', 'Telescope', 'Piano',
    'Trampoline', 'Blender', 'Dishwasher', 'Vacuum', 'Toaster', 'Alarm Clock'
  ],
  'Professions': [
    'Astronaut', 'Chef', 'Surgeon', 'Detective', 'Magician', 'Firefighter',
    'Architect', 'Photographer', 'Pilot', 'Scuba Diver', 'Zookeeper', 'Journalist',
    'Puppeteer', 'Sommelier', 'Taxidermist', 'Ventriloquist', 'Locksmith', 'Beekeeper'
  ],
  'Objects': [
    'Umbrella', 'Compass', 'Hourglass', 'Boomerang', 'Periscope', 'Kaleidoscope',
    'Lasso', 'Abacus', 'Accordion', 'Bagpipes', 'Catapult', 'Harmonica',
    'Jackhammer', 'Megaphone', 'Parachute', 'Slingshot', 'Sundial', 'Theremin'
  ]
};

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function pickRandomWord(recentCategories = []) {
  const categories = Object.keys(WORD_CATEGORIES).filter(c => !recentCategories.includes(c));
  const pool = categories.length > 0 ? categories : Object.keys(WORD_CATEGORIES);
  const category = pool[Math.floor(Math.random() * pool.length)];
  const words = WORD_CATEGORIES[category];
  const word = words[Math.floor(Math.random() * words.length)];
  return { category, word };
}

function assignRoles(players, numImposters) {
  const indices = [...Array(players.length).keys()].sort(() => Math.random() - 0.5);
  const imposterSet = new Set(indices.slice(0, numImposters));
  return players.map((p, i) => ({ ...p, role: imposterSet.has(i) ? 'imposter' : 'player' }));
}

function getRoom(code) { return rooms.get(code); }

function broadcastRoomState(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  const revealRoles = room.phase === 'results' || room.phase === 'game-over';

  io.to(roomCode).emit('room:state', {
    roomCode: room.roomCode,
    phase: room.phase,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isHost: p.isHost,
      hasRevealed: p.hasRevealed,
      hasVoted: p.hasVoted,
      isSpeaking: p.isSpeaking,
      clue: p.clue,
      isEliminated: p.isEliminated,
      role: revealRoles ? p.role : undefined
    })),
    currentTurn: room.currentTurn,
    round: room.round,
    totalRounds: room.totalRounds,
    category: room.category,
    votes: room.phase === 'results' ? room.votes : null,
    results: room.results || null,
    settings: room.settings,
    clues: room.clues,
    timer: room.timer,
    timerDuration: room.timerDuration
  });
}

function startTurnTimer(roomCode) {
  const room = getRoom(roomCode);
  if (!room || !room.settings.turnTimer) return;

  if (room.timerInterval) clearInterval(room.timerInterval);
  room.timer = room.timerDuration;
  io.to(roomCode).emit('timer:update', room.timer);

  room.timerInterval = setInterval(() => {
    const r = getRoom(roomCode);
    if (!r || r.phase !== 'playing') { clearInterval(room.timerInterval); return; }
    r.timer--;
    io.to(roomCode).emit('timer:update', r.timer);
    if (r.timer <= 0) {
      clearInterval(r.timerInterval);
      r.timerInterval = null;
      // Auto-pass the current player
      const current = r.players.find(p => p.id === r.currentTurn);
      if (current) { current.clue = '(time up)'; }
      advanceTurn(roomCode);
    }
  }, 1000);
}

function stopTimer(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;
  if (room.timerInterval) { clearInterval(room.timerInterval); room.timerInterval = null; }
  room.timer = null;
}

function advanceTurn(roomCode) {
  const room = getRoom(roomCode);
  if (!room || room.phase !== 'playing') return;

  stopTimer(roomCode);

  const players = room.players.filter(p => !p.isEliminated);
  const currentIdx = players.findIndex(p => p.id === room.currentTurn);
  const nextIdx = currentIdx + 1;

  if (nextIdx >= players.length) {
    // All players have gone — move to voting
    room.phase = 'voting';
    room.currentTurn = null;
    broadcastRoomState(roomCode);
    return;
  }

  room.currentTurn = players[nextIdx].id;
  const currentSpeaker = room.players.find(p => p.id === room.currentTurn);
  if (currentSpeaker) currentSpeaker.isSpeaking = false;

  broadcastRoomState(roomCode);
  if (room.settings.turnTimer) startTurnTimer(roomCode);
}

function startNewRound(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  room.round++;
  room.phase = 'reveal';
  room.votes = {};
  room.results = null;
  room.clues = [];
  room.currentTurn = null;

  const numImposters = Math.min(room.settings.numImposters, Math.floor(room.players.length / 3));
  const withRoles = assignRoles(room.players, Math.max(1, numImposters));
  room.players = withRoles.map(p => ({
    ...p,
    hasRevealed: false,
    hasVoted: false,
    isSpeaking: false,
    clue: null,
    isEliminated: false
  }));

  const wordData = pickRandomWord(room.usedCategories?.slice(-4));
  room.category = wordData.category;
  room.secretWord = wordData.word;
  if (!room.usedCategories) room.usedCategories = [];
  if (!room.usedCategories.includes(wordData.category)) room.usedCategories.push(wordData.category);

  broadcastRoomState(roomCode);

  // Send private role+word to each player
  room.players.forEach(p => {
    const sock = [...io.sockets.sockets.values()].find(s => s.id === p.socketId);
    if (sock) {
      sock.emit('player:role', {
        role: p.role,
        word: p.role === 'imposter' ? null : room.secretWord,
        category: room.category,
        isImposter: p.role === 'imposter'
      });
    }
  });
}

function resolveVotes(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return;

  // Count votes
  const voteCounts = {};
  room.players.forEach(p => { voteCounts[p.id] = 0; });
  Object.values(room.votes).forEach(id => { if (voteCounts[id] !== undefined) voteCounts[id]++; });

  const maxVotes = Math.max(...Object.values(voteCounts));
  const mostVoted = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);
  const isTie = mostVoted.length > 1;
  const eliminated = isTie ? null : mostVoted[0];
  const eliminatedPlayer = eliminated ? room.players.find(p => p.id === eliminated) : null;
  const imposters = room.players.filter(p => p.role === 'imposter');
  const caughtImposter = !isTie && eliminatedPlayer?.role === 'imposter';

  if (caughtImposter) {
    // Imposter is caught — they get one chance to guess the word
    room.phase = 'imposter-guess';
    room.results = {
      eliminated,
      eliminatedName: eliminatedPlayer?.name,
      caughtImposter: true,
      isTie: false,
      imposters: imposters.map(p => ({ id: p.id, name: p.name })),
      normalWord: room.secretWord,
      imposterNeedsToGuess: true,
      imposterGuessedWord: null,
      voteCounts,
      scoreDeltas: {}
    };
    broadcastRoomState(roomCode);

    // If imposter isn't connected or doesn't guess within 30s, auto-resolve
    room.guessTimeout = setTimeout(() => {
      const r = getRoom(roomCode);
      if (r && r.phase === 'imposter-guess') {
        finalizeRound(roomCode, false);
      }
    }, 30000);
  } else {
    // Imposter not caught — imposter wins immediately
    applyScores(room, false, isTie);
    room.results = {
      eliminated,
      eliminatedName: eliminatedPlayer?.name,
      caughtImposter: false,
      isTie,
      imposters: imposters.map(p => ({ id: p.id, name: p.name })),
      normalWord: room.secretWord,
      imposterNeedsToGuess: false,
      imposterGuessedWord: null,
      voteCounts,
      scoreDeltas: room._scoreDeltas || {}
    };
    room.phase = 'results';
    broadcastRoomState(roomCode);
  }
}

function finalizeRound(roomCode, imposterGuessedCorrectly) {
  const room = getRoom(roomCode);
  if (!room) return;

  if (room.guessTimeout) { clearTimeout(room.guessTimeout); room.guessTimeout = null; }

  // caughtImposter=true means civilians spotted them
  // If imposter guessed correctly → imposter still wins
  const imposterWins = imposterGuessedCorrectly;
  applyScores(room, !imposterWins, false);

  room.results = {
    ...room.results,
    imposterGuessedWord: imposterGuessedCorrectly,
    imposterNeedsToGuess: false,
    scoreDeltas: room._scoreDeltas || {}
  };
  room.phase = 'results';
  broadcastRoomState(roomCode);
}

function applyScores(room, civiliansWin, isTie) {
  const deltas = {};
  room.players.forEach(p => { deltas[p.id] = 0; });

  if (civiliansWin) {
    room.players.filter(p => p.role !== 'imposter').forEach(p => {
      p.score += 2;
      deltas[p.id] = 2;
    });
  } else {
    room.players.filter(p => p.role === 'imposter').forEach(p => {
      p.score += 3;
      deltas[p.id] = 3;
    });
    if (isTie) {
      // Partial points for civilians who at least participated
      room.players.filter(p => p.role !== 'imposter').forEach(p => {
        p.score += 0; // no points on tie
      });
    }
  }
  room._scoreDeltas = deltas;
}

// ─── Socket handlers ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayer = null;

  socket.on('room:create', ({ playerName, settings }) => {
    let code;
    do { code = generateRoomCode(); } while (rooms.has(code));

    const pid = uuidv4();
    const player = {
      id: pid, name: playerName.trim().slice(0, 20), score: 0,
      isHost: true, role: null, hasRevealed: false, hasVoted: false,
      isSpeaking: false, clue: null, isEliminated: false, socketId: socket.id
    };

    rooms.set(code, {
      roomCode: code, phase: 'lobby', players: [player],
      currentTurn: null, round: 0,
      totalRounds: settings?.totalRounds || 5,
      category: null, secretWord: null,
      votes: {}, results: null, clues: [],
      settings: {
        totalRounds: settings?.totalRounds || 5,
        numImposters: settings?.numImposters || 1,
        turnTimer: settings?.turnTimer !== false,
        timerDuration: settings?.timerDuration || 30,
        allowPassTurn: settings?.allowPassTurn !== false
      },
      usedCategories: [],
      timer: null, timerDuration: settings?.timerDuration || 30,
      timerInterval: null, guessTimeout: null, _scoreDeltas: {}
    });

    currentRoom = code;
    currentPlayer = pid;
    socket.join(code);
    socket.emit('room:joined', { roomCode: code, playerId: pid, playerName: player.name });
    broadcastRoomState(code);
  });

  socket.on('room:join', ({ roomCode, playerName }) => {
    const code = roomCode.trim().toUpperCase();
    const room = getRoom(code);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.phase !== 'lobby') { socket.emit('error', { message: 'Game already in progress' }); return; }
    if (room.players.length >= 10) { socket.emit('error', { message: 'Room is full (max 10 players)' }); return; }

    const pid = uuidv4();
    room.players.push({
      id: pid, name: playerName.trim().slice(0, 20), score: 0,
      isHost: false, role: null, hasRevealed: false, hasVoted: false,
      isSpeaking: false, clue: null, isEliminated: false, socketId: socket.id
    });
    currentRoom = code;
    currentPlayer = pid;
    socket.join(code);
    socket.emit('room:joined', { roomCode: code, playerId: pid, playerName: playerName.trim().slice(0, 20) });
    broadcastRoomState(code);
  });

  socket.on('game:start', () => {
    const room = getRoom(currentRoom);
    if (!room) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p?.isHost) return;
    if (room.players.length < 3) { socket.emit('error', { message: 'Need at least 3 players to start' }); return; }
    startNewRound(currentRoom);
  });

  socket.on('player:revealed', () => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'reveal') return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p || p.hasRevealed) return;
    p.hasRevealed = true;

    if (room.players.every(p => p.hasRevealed)) {
      room.phase = 'playing';
      room.currentTurn = room.players[0].id;
      broadcastRoomState(currentRoom);
      if (room.settings.turnTimer) startTurnTimer(currentRoom);
    } else {
      broadcastRoomState(currentRoom);
    }
  });

  socket.on('player:clue', ({ clue }) => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'playing' || room.currentTurn !== currentPlayer) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p) return;
    const sanitized = clue.trim().slice(0, 100);
    p.clue = sanitized;
    p.isSpeaking = false;
    room.clues.push({ playerId: currentPlayer, playerName: p.name, clue: sanitized });
    stopTimer(currentRoom);
    advanceTurn(currentRoom);
  });

  socket.on('player:pass', () => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'playing' || room.currentTurn !== currentPlayer) return;
    if (!room.settings.allowPassTurn) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (p) { p.clue = '(passed)'; p.isSpeaking = false; }
    stopTimer(currentRoom);
    advanceTurn(currentRoom);
  });

  socket.on('player:speaking', ({ isSpeaking }) => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'playing' || room.currentTurn !== currentPlayer) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (p) p.isSpeaking = isSpeaking;
    broadcastRoomState(currentRoom);
  });

  socket.on('game:vote', ({ votedForId }) => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'voting') return;
    const voter = room.players.find(p => p.id === currentPlayer);
    if (!voter || voter.hasVoted) return;
    if (votedForId === currentPlayer) { socket.emit('error', { message: "Can't vote for yourself" }); return; }
    voter.hasVoted = true;
    room.votes[currentPlayer] = votedForId;
    if (room.players.every(p => p.hasVoted)) {
      resolveVotes(currentRoom);
    } else {
      broadcastRoomState(currentRoom);
    }
  });

  socket.on('game:imposter-guess', ({ guess }) => {
    const room = getRoom(currentRoom);
    if (!room || room.phase !== 'imposter-guess') return;
    // Only the imposter can submit a guess
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p || p.role !== 'imposter') return;

    const correct = guess.trim().toLowerCase() === room.secretWord.toLowerCase();
    finalizeRound(currentRoom, correct);

    if (correct) {
      io.to(currentRoom).emit('game:imposter-guessed', { correct: true, guess: guess.trim() });
    } else {
      io.to(currentRoom).emit('game:imposter-guessed', { correct: false, guess: guess.trim(), word: room.secretWord });
    }
  });

  socket.on('game:next-round', () => {
    const room = getRoom(currentRoom);
    if (!room) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p?.isHost) return;
    if (room.round >= room.totalRounds) {
      room.phase = 'game-over';
      broadcastRoomState(currentRoom);
    } else {
      startNewRound(currentRoom);
    }
  });

  socket.on('game:restart', () => {
    const room = getRoom(currentRoom);
    if (!room) return;
    const p = room.players.find(p => p.id === currentPlayer);
    if (!p?.isHost) return;
    stopTimer(currentRoom);
    if (room.guessTimeout) { clearTimeout(room.guessTimeout); room.guessTimeout = null; }
    room.players.forEach(p => { p.score = 0; p.isEliminated = false; });
    room.round = 0;
    room.phase = 'lobby';
    room.usedCategories = [];
    room.clues = [];
    room.votes = {};
    room.results = null;
    broadcastRoomState(currentRoom);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room) return;

    const idx = room.players.findIndex(p => p.id === currentPlayer);
    if (idx === -1) return;
    const wasHost = room.players[idx].isHost;
    const wasCurrentTurn = room.currentTurn === currentPlayer;
    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      stopTimer(currentRoom);
      if (room.guessTimeout) clearTimeout(room.guessTimeout);
      rooms.delete(currentRoom);
      return;
    }

    if (wasHost) room.players[0].isHost = true;

    if (room.phase === 'playing' && wasCurrentTurn) {
      advanceTurn(currentRoom);
    } else if (room.phase === 'voting') {
      const allVoted = room.players.every(p => p.hasVoted);
      if (allVoted) resolveVotes(currentRoom);
      else broadcastRoomState(currentRoom);
    } else {
      broadcastRoomState(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Imposter game running on http://localhost:${PORT}`));

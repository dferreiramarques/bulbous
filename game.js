'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════
const COLORS            = ['red', 'blue', 'green', 'yellow'];
const SYMBOL_OF         = { red: 'triangle', yellow: 'triangle', blue: 'circle', green: 'circle' };
const TRICKS_PER_ROUND  = 4;
const TIE_BREAK_MS      = 20000; // 20 s for tied players to submit extra card

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Charm deck (34 cards) ────────────────────────────────────────────────────
let _cid = 0;
function buildCharmDeck() {
  _cid = 0;
  const d = [];
  for (const color of COLORS) {
    for (const v of [3, 4, 5, 6, 7, 8, 9])
      d.push({ id: ++_cid, type: 'numeric', color, symbol: null, value: v });
    d.push({ id: ++_cid, type: 'double', color, symbol: null, value: null });
  }
  d.push({ id: ++_cid, type: 'joker', color: null, symbol: 'circle',   value: null });
  d.push({ id: ++_cid, type: 'joker', color: null, symbol: 'triangle', value: null });
  return d; // 28 numeric + 4 double + 2 joker = 34
}

// ── Baelfungious factory ─────────────────────────────────────────────────────
// Returns 4 baelfungious for each colour provided (1-slot…4-slot)
function makeBaelfs(colors, ownerIdx) {
  const result = [];
  for (const color of colors) {
    for (const slots of [1, 2, 3, 4]) {
      result.push({
        color,
        symbol:   SYMBOL_OF[color],
        slots,
        bulbs:    [], // array of playerIdx who placed a bulb here
        complete: false,
        owner:    ownerIdx,
      });
    }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW GAME
// ══════════════════════════════════════════════════════════════════════════════
// lobbyPlayers : [{ name: string, isBot: boolean }]
// mode         : '4p' | '2p' | '2v2'
//   '4p'  → 4 players, individual (or solo: 1 human + bots using '4p' rules)
//   '2p'  → 2 players, each gets 8 baelfungious, 9-card hand
//   '2v2' → 4 players, fixed teams by symbol (seats 0&2 vs 1&3 — already
//           alternating in turn order). Scoring stays individual per player;
//           only the win condition sums each team's two totals (see VI.4).
function newGame(lobbyPlayers, mode) {
  const is2p      = mode === '2p';
  const is2v2     = mode === '2v2';
  const n         = lobbyPlayers.length;  // 4 for 4p/solo/2v2, 2 for 2p
  const handLimit = is2p ? 9 : 7;
  const numSlots  = is2p ? 2 : 1;        // active-baelf slots per player in centre

  const deck = shuffle(buildCharmDeck());

  // ── Colour / symbol assignment (random) ──────────────────────────────────
  let colorAssign;
  if (is2p) {
    // Randomly give each player a symbol; derive a representative colour
    const syms  = shuffle(['triangle', 'circle']);
    colorAssign = syms.map(s => s === 'triangle' ? 'red' : 'blue');
  } else if (is2v2) {
    // Fixed teams by seat parity (0&2 vs 1&3) — already alternating turn
    // order, matching the "sentem-se intercalados" rule. Which parity is
    // Círculo vs Triângulo, and which of its 2 colours each seat gets, is random.
    const circleIsEvenSeat = Math.random() < 0.5;
    const circleColors     = shuffle(['blue', 'green']);
    const triangleColors   = shuffle(['red', 'yellow']);
    colorAssign = [];
    for (let i = 0; i < n; i++) {
      const onCircle = ((i % 2 === 0) === circleIsEvenSeat);
      colorAssign.push(onCircle ? circleColors.shift() : triangleColors.shift());
    }
  } else {
    colorAssign = shuffle([...COLORS]).slice(0, n);
  }

  // ── Build players ─────────────────────────────────────────────────────────
  const players = lobbyPlayers.map((lp, i) => {
    const color  = colorAssign[i];
    const symbol = SYMBOL_OF[color];
    // Which Baelfungious colours does this player control?
    const bcolors = is2p
      ? (symbol === 'triangle' ? ['red', 'yellow'] : ['blue', 'green'])
      : [color];

    return {
      name:             lp.name,
      isBot:            !!lp.isBot,
      color,
      symbol,
      // Team = symbol in 2v2 (Círculo team plays blue/green, Triângulo team
      // plays red/yellow) — null in every other mode.
      team:             is2v2 ? symbol : null,
      hand:             deck.splice(0, handLimit),
      handLimit,
      baelfungious:     makeBaelfs(bcolors, i), // 4 for 4p/2v2, 8 for 2p
      // activeSlots[si] = index into baelfungious[], null if slot not yet filled
      activeSlots:      Array(numSlots).fill(null),
      endgameTriggered: false,
    };
  });

  // ── Initial replace-needed list (all players fill all slots before round 1) ─
  const replaceNeeded = [];
  for (let pi = 0; pi < n; pi++)
    for (let si = 0; si < numSlots; si++)
      replaceNeeded.push({ playerIdx: pi, slotIdx: si });

  return {
    mode, n, players, deck, discard: [],
    handLimit, numSlots,
    phase:       'CHOOSE_BAELFUNGIOUS',
    governorIdx: Math.floor(Math.random() * n),
    roundNum:    1,
    endgameFired: false,
    turnGen:     0,        // incremented each round; lets server cancel stale bot timers
    replaceNeeded,         // [{playerIdx, slotIdx}] — who still needs to pick
    trick:       null,
    trickNum:    0,        // 0..3 within a round — also indexes trickQueue
    trickQueue:  null,     // [{playerIdx, slotIdx}] × 4 — full round order, declared upfront
    contestedThisRound:    [],  // [{playerIdx, slotIdx}] already contested this round
    anyCompletedThisRound: false,
    lastTrickResult:       null,
    finalScores:           null,
    teamResult:            null,  // { totals: {circle,triangle}, winners: [...] } — 2v2 only
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function refillDeck(g) {
  if (g.deck.length === 0 && g.discard.length > 0) {
    g.deck    = shuffle([...g.discard]);
    g.discard = [];
  }
}

function drawN(g, n) {
  const drawn = [];
  let remaining = n;
  while (remaining > 0) {
    refillDeck(g);
    if (g.deck.length === 0) break; // truly empty
    const batch = g.deck.splice(0, Math.min(remaining, g.deck.length));
    drawn.push(...batch);
    remaining -= batch.length;
    if (remaining > 0 && g.deck.length === 0 && g.discard.length === 0) break;
  }
  return drawn;
}

// Removes from g.replaceNeeded any pending CHOOSE_BAELFUNGIOUS entry that
// has zero valid candidates (2-player mode only — a player's active slots
// must always be 2 different colours, see chooseBaelf). This can happen
// the instant a round starts (before anyone has chosen anything yet), not
// just as a side effect of another choice, so this must run both right
// after replaceNeeded is (re)built AND after every resolved choice —
// otherwise a truly unfillable slot leaves the phase stuck forever.
function pruneUnfillableChoices(g) {
  if (g.numSlots <= 1) return;
  g.replaceNeeded = g.replaceNeeded.filter((r) => {
    const p = g.players[r.playerIdx];
    const activeColors = p.activeSlots.filter((bi) => bi !== null).map((bi) => p.baelfungious[bi].color);
    return p.baelfungious.some(
      (b, i) => !b.complete && !p.activeSlots.includes(i) && !activeColors.includes(b.color)
    );
  });
}

// All centre baelfungious: [{playerIdx, slotIdx, baelfIdx, baelf}]
function getActives(g) {
  const out = [];
  for (let pi = 0; pi < g.n; pi++) {
    const p = g.players[pi];
    for (let si = 0; si < g.numSlots; si++) {
      const bi = p.activeSlots[si];
      if (bi !== null)
        out.push({ playerIdx: pi, slotIdx: si, baelfIdx: bi, baelf: p.baelfungious[bi] });
    }
  }
  return out;
}

// Card playability: colour OR symbol must match the target baelfungious
// Numeric/Double have colour only → colour must match
// Jokers have symbol only       → symbol must match
function canPlay(card, baelf) {
  if (card.type === 'joker') return card.symbol === baelf.symbol;
  return card.color === baelf.color;
}

// Score a bet against a baelf.
// Returns { total: number, jokerWin: boolean }
function scoreBet(cards, baelf) {
  if (!cards || cards.length === 0) return { total: 0, jokerWin: false };
  if (cards.find(c => c.type === 'joker'))  return { total: Infinity, jokerWin: true };
  let sum = 0, hasDouble = false;
  for (const c of cards) {
    if (c.type === 'numeric') sum += c.value;
    if (c.type === 'double' && c.color === baelf.color) hasDouble = true;
  }
  return { total: hasDouble ? sum * 2 : sum, jokerWin: false };
}

// Convenience: get the baelfungious that is the current trick target
function getTrickBaelf(g) {
  const t  = g.trick;
  const tp = g.players[t.targetPlayerIdx];
  return tp.baelfungious[tp.activeSlots[t.targetSlotIdx]];
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION: CHOOSE_BAELFUNGIOUS
// Used at game start AND after a completed baelf is replaced at end-of-round.
// Players choose independently (any order); server processes as they arrive.
// ══════════════════════════════════════════════════════════════════════════════
function chooseBaelf(g, playerIdx, baelfIdx) {
  if (g.phase !== 'CHOOSE_BAELFUNGIOUS') return { error: 'Fase incorreta' };

  // Find the first pending slot for this player
  const pendingIdx = g.replaceNeeded.findIndex(r => r.playerIdx === playerIdx);
  if (pendingIdx === -1) return { error: 'Não tens nenhuma escolha pendente' };

  const { slotIdx } = g.replaceNeeded[pendingIdx];
  const p     = g.players[playerIdx];
  const baelf = p.baelfungious[baelfIdx];

  if (!baelf)         return { error: 'Índice inválido' };
  if (baelf.complete) return { error: 'Baelfungious já completa' };
  if (p.activeSlots.includes(baelfIdx)) return { error: 'Já está ativa noutra posição' };

  // No Jogo de 2 Jogadores (numSlots > 1) cada jogador controla 2 cores, e as
  // suas posições ativas têm sempre de ser de cores diferentes — nunca 2 da
  // mesma cor ao mesmo tempo (ver REGRAS.md, III.B).
  if (g.numSlots > 1) {
    const activeColors = p.activeSlots
      .filter((bi) => bi !== null)
      .map((bi) => p.baelfungious[bi].color);
    if (activeColors.includes(baelf.color))
      return { error: 'Já tens uma Baelfungious ativa dessa cor' };
  }

  // Place the choice
  p.activeSlots[slotIdx] = baelfIdx;
  g.replaceNeeded.splice(pendingIdx, 1);

  // Esta escolha pode ter deixado uma outra posição pendente do mesmo
  // jogador sem nenhuma opção válida (ex.: a única cor que lhe resta já
  // está toda completa/ativa). Sem isto, essa posição ficaria à espera de
  // uma escolha impossível para sempre — trata-a como permanentemente
  // vazia, tal como o esgotamento total já é tratado em endRound.
  pruneUnfillableChoices(g);

  // ── Endgame check (after all pending for this player are resolved) ────────
  const stillPending = g.replaceNeeded.filter(r => r.playerIdx === playerIdx);
  if (stillPending.length === 0 && !p.endgameTriggered) {
    const activeSet = new Set(p.activeSlots.filter(s => s !== null));
    const reserve   = p.baelfungious.filter((b, bi) => !b.complete && !activeSet.has(bi));
    if (reserve.length === 0) {
      p.endgameTriggered = true;
      g.endgameFired     = true;
    }
  }

  // ── All pending resolved → begin the round ───────────────────────────────
  if (g.replaceNeeded.length === 0) {
    g.contestedThisRound    = [];
    g.anyCompletedThisRound = false;
    g.trickNum              = 0;
    g.trickQueue             = null;
    g.trick                 = null;
    g.phase                 = 'CHOOSE_SEQUENCE';
  }

  return { ok: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION: CHOOSE_SEQUENCE
// Governor (Governante) declares, in one go, the full order in which the 4
// active Baelfungious will be contested this round — before any card is
// played. The order is fixed for the whole round once declared.
// ══════════════════════════════════════════════════════════════════════════════
function chooseSequence(g, playerIdx, order) {
  if (g.phase !== 'CHOOSE_SEQUENCE') return { error: 'Fase incorreta' };
  if (playerIdx !== g.governorIdx)   return { error: 'Não és o Governante da Ronda' };

  const actives = getActives(g); // nothing contested yet at round start
  if (!Array.isArray(order) || order.length !== actives.length)
    return { error: `Tens de declarar a ordem das ${actives.length} Baelfungious ativas` };

  const seen = new Set();
  for (const o of order) {
    if (!o || typeof o.playerIdx !== 'number' || typeof o.slotIdx !== 'number')
      return { error: 'Sequência inválida' };
    const key = `${o.playerIdx}-${o.slotIdx}`;
    if (seen.has(key)) return { error: 'Cada Baelfungious só pode aparecer uma vez na sequência' };
    seen.add(key);
    if (!actives.find(a => a.playerIdx === o.playerIdx && a.slotIdx === o.slotIdx))
      return { error: 'Alvo inválido na sequência' };
  }

  g.trickQueue = order.map(o => ({ playerIdx: o.playerIdx, slotIdx: o.slotIdx }));
  startTrickFromQueue(g);
  return { ok: true };
}

// Builds g.trick from g.trickQueue[g.trickNum] and moves to PLAYER_ACTIONS.
// Used both right after the sequence is declared and after each trick
// resolves, for as long as tricks remain in the declared order.
function startTrickFromQueue(g) {
  const { playerIdx: targetPlayerIdx, slotIdx: targetSlotIdx } = g.trickQueue[g.trickNum];

  // Action order: governor first, then clockwise
  const order = Array.from({ length: g.n }, (_, i) => (g.governorIdx + i) % g.n);

  g.trick = {
    targetPlayerIdx,
    targetSlotIdx,
    actionOrder:       order,
    currentActorIdx:   0,
    bets:              Array(g.n).fill(null),   // null=not yet acted, []=no bet
    actionTypes:       Array(g.n).fill(null),   // 'bet'|'swap'|'pass'
    revealed:          false,
    tiedPlayers:       [],
    tieBreakCards:     Array(g.n).fill(null),
    tieBreakSubmitted: Array(g.n).fill(false),
    waitingForDiscard: -1,  // playerIdx who must discard excess, or -1
    discardExcess:     0,
  };

  g.phase = 'PLAYER_ACTIONS';
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION: PLAYER_ACT  (BET / SWAP / PASS)
// Players act sequentially starting from the governor.
// ══════════════════════════════════════════════════════════════════════════════
function playerAct(g, playerIdx, action) {
  if (g.phase !== 'PLAYER_ACTIONS') return { error: 'Fase incorreta' };
  const t = g.trick;

  // If someone needs to discard excess first
  if (t.waitingForDiscard !== -1) {
    if (playerIdx !== t.waitingForDiscard)
      return { error: 'Aguarda que o outro jogador descarte as cartas em excesso' };
    return { error: 'Usa a ação DISCARD_EXCESS para descartar' };
  }

  const expected = t.actionOrder[t.currentActorIdx];
  if (playerIdx !== expected) return { error: 'Não é a tua vez de agir' };

  const p     = g.players[playerIdx];
  const baelf = getTrickBaelf(g);

  // ── BET ──────────────────────────────────────────────────────────────────
  if (action.type === 'BET') {
    const { cardIds } = action;
    if (!Array.isArray(cardIds) || cardIds.length === 0)
      return { error: 'Aposta pelo menos 1 carta. Para não jogar, usa PASSAR.' };

    const cards = cardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return { error: 'Carta(s) não encontrada(s) na mão' };

    for (const c of cards) {
      if (!canPlay(c, baelf))
        return { error: `A carta ${descCard(c)} não pode ser jogada nesta Baelfungious (cor ou símbolo não correspondem)` };
    }

    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    t.bets[playerIdx]        = cards;
    t.actionTypes[playerIdx] = 'bet';

  // ── SWAP ─────────────────────────────────────────────────────────────────
  } else if (action.type === 'SWAP') {
    const { cardIds } = action;
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 2)
      return { error: 'Troca 1 ou 2 cartas' };

    const cards = cardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return { error: 'Carta(s) não encontrada(s) na mão' };

    for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
    g.discard.push(...cards);
    p.hand.push(...drawN(g, cards.length));

    t.bets[playerIdx]        = [];
    t.actionTypes[playerIdx] = 'swap';

  // ── PASS ─────────────────────────────────────────────────────────────────
  } else if (action.type === 'PASS') {
    const drawn = drawN(g, 1);
    p.hand.push(...drawn);

    t.bets[playerIdx]        = [];
    t.actionTypes[playerIdx] = 'pass';

    // If over hand limit, player must discard before the next actor goes
    if (p.hand.length > p.handLimit) {
      t.waitingForDiscard = playerIdx;
      t.discardExcess     = p.hand.length - p.handLimit;
      return { ok: true };
    }

  } else {
    return { error: 'Tipo de ação desconhecido: ' + action.type };
  }

  advanceActor(g);
  return { ok: true };
}

// ── DISCARD_EXCESS (after PASS put hand over limit) ──────────────────────────
function discardExcess(g, playerIdx, cardIds) {
  if (g.phase !== 'PLAYER_ACTIONS') return { error: 'Fase incorreta' };
  const t = g.trick;
  if (t.waitingForDiscard !== playerIdx) return { error: 'Não é a tua vez de descartar' };

  const excess = t.discardExcess;
  if (!Array.isArray(cardIds) || cardIds.length !== excess)
    return { error: `Descarta exactamente ${excess} carta(s)` };

  const p     = g.players[playerIdx];
  const cards = cardIds.map(id => p.hand.find(c => c.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return { error: 'Carta(s) não encontrada(s) na mão' };

  for (const c of cards) p.hand.splice(p.hand.indexOf(c), 1);
  g.discard.push(...cards);

  t.waitingForDiscard = -1;
  t.discardExcess     = 0;
  advanceActor(g);
  return { ok: true };
}

function advanceActor(g) {
  g.trick.currentActorIdx++;
  if (g.trick.currentActorIdx >= g.n) revealTrick(g);
}

// ══════════════════════════════════════════════════════════════════════════════
// REVEAL
// Called automatically when all players have acted.
// ══════════════════════════════════════════════════════════════════════════════
function revealTrick(g) {
  const t     = g.trick;
  t.revealed  = true;
  const baelf = getTrickBaelf(g);

  // Calculate score for each player who placed a bet
  const scores = g.players.map((_, i) => {
    if (t.actionTypes[i] === 'bet' && t.bets[i] && t.bets[i].length > 0)
      return scoreBet(t.bets[i], baelf);
    return null;
  });

  const bettors = scores.map((s, i) => s ? i : -1).filter(i => i !== -1);

  // Base result object (may be augmented by tiebreak later)
  const result = {
    roundNum:              g.roundNum,
    trickNum:              g.trickNum,
    trickTargetPlayerIdx: t.targetPlayerIdx,
    trickTargetSlotIdx:   t.targetSlotIdx,
    bets:        t.bets,
    actionTypes: t.actionTypes,
    scores,
    winner:      null,
    tied:        false,
    tiedPlayers: [],
  };

  // Nobody bet → nothing happens
  if (bettors.length === 0) {
    g.lastTrickResult = result;
    finishTrick(g);
    return;
  }

  // Determine winners (joker auto-wins; else highest total)
  const jokerWinners = bettors.filter(i => scores[i].jokerWin);
  let winners;
  if (jokerWinners.length > 0) {
    winners = jokerWinners; // at most 1 (only one joker of each symbol per game)
  } else {
    const maxTotal = Math.max(...bettors.map(i => scores[i].total));
    winners        = bettors.filter(i => scores[i].total === maxTotal);
  }

  if (winners.length === 1) {
    // Clear winner
    placeBulb(g, winners[0]);
    discardBets(g);
    result.winner    = winners[0];
    g.lastTrickResult = result;
    finishTrick(g);
  } else {
    // Tie → enter TIE_BREAK phase
    t.tiedPlayers       = winners;
    t.tieBreakCards     = Array(g.n).fill(null);
    t.tieBreakSubmitted = Array(g.n).fill(false);
    // Pre-approve players not involved in the tie
    for (let i = 0; i < g.n; i++) {
      if (!winners.includes(i)) t.tieBreakSubmitted[i] = true;
    }
    result.tied        = true;
    result.tiedPlayers = winners;
    g.lastTrickResult  = result;
    g.phase = 'TIE_BREAK';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION: TIE_BREAK
// Tied players may OPTIONALLY play 1 extra card of the same colour as the
// active Baelfungious (simultaneous, with server-side timer).
// cardId = null means the player chooses not to play.
// ══════════════════════════════════════════════════════════════════════════════
function tieBreakAct(g, playerIdx, cardId) {
  if (g.phase !== 'TIE_BREAK') return { error: 'Fase incorreta' };
  const t = g.trick;
  if (!t.tiedPlayers.includes(playerIdx)) return { error: 'Não estás empatado nesta vaza' };
  if (t.tieBreakSubmitted[playerIdx])     return { error: 'Já submeteste a tua decisão' };

  if (cardId !== null) {
    const p     = g.players[playerIdx];
    const baelf = getTrickBaelf(g);
    const card  = p.hand.find(c => c.id === cardId);
    if (!card) return { error: 'Carta não encontrada na mão' };
    // Only same-colour cards (Jokers have null colour → rejected)
    if (card.color !== baelf.color)
      return { error: 'Só podes jogar uma carta da mesma cor da Baelfungious para desempatar' };
    p.hand.splice(p.hand.indexOf(card), 1);
    t.tieBreakCards[playerIdx] = card;
  }

  t.tieBreakSubmitted[playerIdx] = true;
  if (t.tiedPlayers.every(i => t.tieBreakSubmitted[i])) resolveTieBreak(g);
  return { ok: true };
}

// Called by server when the TIE_BREAK timer expires
function tieBreakTimeout(g) {
  if (g.phase !== 'TIE_BREAK') return;
  const t = g.trick;
  for (const pi of t.tiedPlayers) {
    if (!t.tieBreakSubmitted[pi]) t.tieBreakSubmitted[pi] = true;
    // tieBreakCards[pi] stays null → player passed
  }
  resolveTieBreak(g);
}

function resolveTieBreak(g) {
  const t    = g.trick;
  const played = t.tiedPlayers.filter(i => t.tieBreakCards[i] !== null);

  // Discard all tiebreak cards that were played
  for (const i of played) g.discard.push(t.tieBreakCards[i]);

  let winner = null;

  if (played.length > 0) {
    // Only players who played a card can win; compare original total + new card value
    const totals = played.map(i => {
      const orig  = g.lastTrickResult.scores[i].total; // already includes ×2 if any
      const extra = t.tieBreakCards[i]?.value || 0;    // Double = null → 0
      return { i, total: orig === Infinity ? Infinity : orig + extra };
    });
    const max  = Math.max(...totals.map(x => x.total));
    const wins = totals.filter(x => x.total === max).map(x => x.i);
    if (wins.length === 1) winner = wins[0];
    // else still tied → winner stays null, nothing happens
  }
  // If nobody played → winner stays null

  g.lastTrickResult.tieWinner     = winner;
  g.lastTrickResult.tieBreakCards = [...t.tieBreakCards];

  if (winner !== null) placeBulb(g, winner);
  discardBets(g);
  finishTrick(g);
}

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL: BULB, DISCARD, ADVANCE
// ══════════════════════════════════════════════════════════════════════════════
function placeBulb(g, winnerIdx) {
  const baelf = getTrickBaelf(g);
  baelf.bulbs.push(winnerIdx);
  if (baelf.bulbs.length >= baelf.slots) {
    baelf.complete          = true;
    g.anyCompletedThisRound = true;
  }
}

function discardBets(g) {
  const t = g.trick;
  for (let i = 0; i < g.n; i++) {
    if (t.bets[i] && t.bets[i].length > 0) g.discard.push(...t.bets[i]);
  }
}

function finishTrick(g) {
  g.contestedThisRound.push({ playerIdx: g.trick.targetPlayerIdx, slotIdx: g.trick.targetSlotIdx });
  g.trickNum++;

  // Normally trickQueue.length === TRICKS_PER_ROUND (4), but a starved
  // 2-player slot (see endRound) can leave fewer Baelfungious active for a
  // round — always trust the actual declared sequence length, not the
  // usual constant, so we never index past the end of trickQueue.
  if (g.trickNum >= g.trickQueue.length) {
    endRound(g);
  } else {
    // Next trick in the sequence declared at the start of this round —
    // no new choice, the order was fixed before the round began.
    g.trick = null;
    startTrickFromQueue(g);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// END OF ROUND
// ══════════════════════════════════════════════════════════════════════════════
function endRound(g) {
  g.trick      = null;
  g.trickNum   = 0;
  g.trickQueue = null;

  // 1. Draw cards if at least one Baelfungious completed this round
  if (g.anyCompletedThisRound) {
    for (const p of g.players) {
      const need = p.handLimit - p.hand.length;
      if (need > 0) p.hand.push(...drawN(g, need));
    }
  }

  // 2. Check endgame (triggered during chooseBaelf when player placed their last)
  if (g.endgameFired) {
    g.finalScores = calcFinalScore(g);
    g.teamResult  = g.mode === '2v2' ? calcTeamResult(g, g.finalScores) : null;
    g.phase       = 'GAME_OVER';
    return;
  }

  // 3. Pass governor token left
  g.governorIdx = (g.governorIdx + 1) % g.n;
  g.roundNum++;
  g.contestedThisRound    = [];
  g.anyCompletedThisRound = false;
  g.turnGen++;

  // 4. Find slots that need replacement (active baelf completed this round).
  // Processed per player (not per slot in isolation): in 2-player mode a
  // player can have both of their 2 active slots complete in the same round,
  // and the reserve of un-activated Baelfungious is shared between them — so
  // slot A and slot B must not each independently "see" the same last
  // spare card as available (that double-counts a resource that can only
  // go to one of them).
  const replaceNeeded = [];
  for (let pi = 0; pi < g.n; pi++) {
    const p = g.players[pi];
    const slotsToFill = [];
    for (let si = 0; si < g.numSlots; si++) {
      const bi = p.activeSlots[si];
      if (bi === null || !p.baelfungious[bi].complete) continue;
      p.activeSlots[si] = null; // clear now; which card refills it is decided below
      slotsToFill.push(si);
    }
    if (slotsToFill.length === 0) continue;

    const activeSet = new Set(p.activeSlots.filter(s => s !== null));
    const available  = p.baelfungious.filter((b, i) => !b.complete && !activeSet.has(i));

    for (const si of slotsToFill) {
      if (available.length > 0) {
        replaceNeeded.push({ playerIdx: pi, slotIdx: si });
        available.pop(); // reserve one spare for this slot so a sibling slot can't also claim it
      }
      // else: nothing left for this slot — it stays permanently empty.
    }

    // If every slot we just tried to fill came up empty (zero pending
    // entries pushed for this player), chooseBaelf will never run for them
    // again this game, so the endgame check that normally lives there must
    // fire here instead.
    const pendingForP = replaceNeeded.filter(r => r.playerIdx === pi).length;
    if (pendingForP === 0 && !p.endgameTriggered) {
      p.endgameTriggered = true;
      g.endgameFired     = true;
    }
  }

  if (replaceNeeded.length > 0) {
    g.replaceNeeded = replaceNeeded;
    // A entrada pode já nascer sem opção válida (ex. a única cor que falta
    // reabastecer a este jogador já ficou toda completa numa ronda
    // anterior) — antes de sequer chegar a CHOOSE_BAELFUNGIOUS, tira já as
    // que não têm hipótese, para não ficarem à espera de uma escolha
    // impossível sem ninguém alguma vez a resolver.
    pruneUnfillableChoices(g);
    g.phase = g.replaceNeeded.length > 0 ? 'CHOOSE_BAELFUNGIOUS' : 'CHOOSE_SEQUENCE';
  } else {
    g.replaceNeeded = [];
    g.phase         = 'CHOOSE_SEQUENCE';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FINAL SCORING
// ══════════════════════════════════════════════════════════════════════════════
function calcFinalScore(g) {
  const s = g.players.map((p, i) => ({
    idx:      i,
    name:     p.name,
    color:    p.color,
    bulbs:    0,
    majority: 0,
    collection: 0,
    total:    0,
    controlled: { colors: new Set(), types: new Set() },
  }));

  const allBaelfs = g.players.flatMap(p => p.baelfungious);

  // 1. Count every bulb placed (complete or incomplete = 1 pt each)
  for (const b of allBaelfs) {
    for (const wi of b.bulbs) if (s[wi]) s[wi].bulbs++;
  }

  // 2. Majority bonus (only on COMPLETE baelfungious)
  for (const b of allBaelfs) {
    if (!b.complete) continue;
    const counts = {};
    for (const wi of b.bulbs) counts[wi] = (counts[wi] || 0) + 1;
    const vals    = Object.values(counts);
    if (vals.length === 0) continue;
    const maxVal  = Math.max(...vals);
    const leaders = Object.keys(counts).filter(k => counts[k] === maxVal).map(Number);

    if (leaders.length === 1) {
      s[leaders[0]].majority += 3;
    } else {
      for (const li of leaders) s[li].majority += 1; // tied majority
    }

    // Track for collection bonus. b.slots (1-4) is the specimen type:
    // 1=Juvenil, 2=Adulto, 3=Bailio, 4=Líder.
    for (const li of leaders) {
      s[li].controlled.colors.add(b.color);
      s[li].controlled.types.add(b.slots);
    }
  }

  // 3. Collection bonuses (rulebook VI.3)
  for (const sc of s) {
    if (sc.controlled.colors.size >= 4) sc.collection += 5;  // Todas as Cores
    if (sc.controlled.types.size  >= 4) sc.collection += 10; // Todos os Espécimes (Líder, Bailio, Adulto, Juvenil)
    sc.total = sc.bulbs + sc.majority + sc.collection;
    // Convert sets to arrays for JSON serialisation
    sc.controlled.colors = [...sc.controlled.colors];
    sc.controlled.types  = [...sc.controlled.types];
  }

  return s;
}

// Sum each team's individual totals (2v2 only). Pontuação continua sempre
// individual — isto só decide qual equipa venceu (VI.4 do rulebook).
function calcTeamResult(g, scores) {
  const totals = {};
  for (const sc of scores) {
    const team = g.players[sc.idx].team;
    totals[team] = (totals[team] || 0) + sc.total;
  }
  const teamNames = Object.keys(totals);
  const maxTotal  = Math.max(...teamNames.map(t => totals[t]));
  const winners   = teamNames.filter(t => totals[t] === maxTotal);
  return { totals, winners }; // winners.length > 1 → vitória partilhada
}

// ══════════════════════════════════════════════════════════════════════════════
// BUILD VIEW  —  per-player privacy barrier
// Never send raw game state; always go through buildView.
// ══════════════════════════════════════════════════════════════════════════════
function buildView(g, playerIdx) {
  const me = g.players[playerIdx];
  const t  = g.trick;

  let trickView = null;
  if (t) {
    trickView = {
      targetPlayerIdx: t.targetPlayerIdx,
      targetSlotIdx:   t.targetSlotIdx,
      actionOrder:     t.actionOrder,
      currentActorIdx: t.currentActorIdx,
      // actionTypes visible to all — 'bet'|'swap'|'pass'|null shows what others did
      actionTypes:     t.actionTypes,
      // Bet cards: own cards always visible; others' hidden until reveal
      bets: t.bets.map((b, i) => {
        if (i === playerIdx) return b;         // own bet: always show
        if (t.revealed)      return b;         // after reveal: show all
        return b !== null ? [] : null;         // others: show acted/not but not content
      }),
      revealed:          t.revealed,
      tiedPlayers:       t.tiedPlayers,
      tieBreakSubmitted: t.tieBreakSubmitted,
      tieBreakCards: t.tieBreakCards.map((c, i) => {
        if (i === playerIdx) return c;         // own: always show
        if (t.revealed)      return c;         // after resolve: show all
        return c !== null ? {} : null;         // others: show played-something or null
      }),
      waitingForDiscard: t.waitingForDiscard,
      discardExcess:     t.discardExcess,
    };
  }

  return {
    myIdx:        playerIdx,
    mode:         g.mode,
    phase:        g.phase,
    roundNum:     g.roundNum,
    governorIdx:  g.governorIdx,
    endgameFired: g.endgameFired,

    players: g.players.map((p, i) => ({
      name:             p.name,
      color:            p.color,
      symbol:           p.symbol,
      team:             p.team,       // 'circle' | 'triangle' | null (2v2 only)
      isBot:            p.isBot,
      handSize:         p.hand.length,
      activeSlots:      p.activeSlots,
      baelfungious:     p.baelfungious,  // fully visible (no private info on baelfs)
      endgameTriggered: p.endgameTriggered,
    })),

    myHand:      me.hand,
    deckSize:    g.deck.length,
    discardTop:  g.discard.length > 0 ? g.discard[g.discard.length - 1] : null,
    discardSize: g.discard.length,

    trick:              trickView,
    trickQueue:         g.trickQueue,   // full declared order for this round, once set
    trickNum:           g.trickNum,     // 0..3 — index of current trick within trickQueue
    replaceNeeded:      g.replaceNeeded || [],
    anyCompletedThisRound: g.anyCompletedThisRound,
    lastTrickResult:    g.lastTrickResult,
    finalScores:        g.finalScores,
    teamResult:         g.teamResult,   // { totals, winners } — 2v2 only
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// BOT AI
// ══════════════════════════════════════════════════════════════════════════════

function botChooseBaelf(g, playerIdx) {
  const p         = g.players[playerIdx];
  const activeSet = new Set(p.activeSlots.filter(s => s !== null));
  // Mesma regra de chooseBaelf: no Jogo de 2 Jogadores não pode escolher uma
  // cor já ativa noutra das suas posições.
  const activeColors = g.numSlots > 1
    ? p.activeSlots.filter(bi => bi !== null).map(bi => p.baelfungious[bi].color)
    : [];
  let available = p.baelfungious
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => !b.complete && !activeSet.has(i) && !activeColors.includes(b.color));
  if (!available.length) {
    // Nada de cor válida sobra (ex. essa cor já ficou toda completa) — em
    // vez de travar o jogo à espera de uma escolha impossível, esta posição
    // fica vazia (mesmo tratamento do esgotamento total em endRound).
    return null;
  }
  // Randomize strategy: 40% prefer fewest slots, 30% prefer most slots, 30% random
  const r = Math.random();
  if (r < 0.40) available.sort((a, b) => a.b.slots - b.b.slots);      // aggressive (fast complete)
  else if (r < 0.70) available.sort((a, b) => b.b.slots - a.b.slots); // defensive (big slots)
  // else: random order (already random since JS sort stability with no comparator is impl-defined)
  else return available[Math.floor(Math.random() * available.length)].i;
  return available[0].i;
}

// Bot version of the Governor declaring the round's full sequence upfront.
// Same randomized aggressive/defensive/random spread as botChooseBaelf, but
// applied to ordering rather than picking one target at a time.
function botChooseSequence(g) {
  let opts = getActives(g);
  if (!opts.length) return [];
  const r = Math.random();
  if (r < 0.40) opts = [...opts].sort((a, b) => a.baelf.slots - b.baelf.slots);      // aggressive first
  else if (r < 0.70) opts = [...opts].sort((a, b) => b.baelf.slots - a.baelf.slots); // defensive first
  else opts = shuffle(opts);                                                        // random order
  return opts.map(o => ({ playerIdx: o.playerIdx, slotIdx: o.slotIdx }));
}

function botAct(g, playerIdx) {
  const p      = g.players[playerIdx];
  const baelf  = getTrickBaelf(g);
  const valid  = p.hand.filter(c => canPlay(c, baelf));

  // Sort valid cards by value descending (play strong cards)
  valid.sort((a, b) => (b.value || 0) - (a.value || 0));

  if (valid.length === 0) {
    // Can't bet; swap 1 random card if possible, else pass
    if (p.hand.length > 0) {
      const card = p.hand[Math.floor(Math.random() * p.hand.length)];
      return { type: 'SWAP', cardIds: [card.id] };
    }
    return { type: 'PASS' };
  }

  // 65% bet, 20% swap, 15% pass
  const r = Math.random();
  if (r < 0.65) {
    // Bet 1 or 2 valid cards (prefer joker alone, or 1-2 numerics)
    const joker = valid.find(c => c.type === 'joker');
    if (joker) return { type: 'BET', cardIds: [joker.id] };
    const num = Math.min(valid.length, Math.floor(Math.random() * 2) + 1);
    return { type: 'BET', cardIds: shuffle(valid).slice(0, num).map(c => c.id) };
  } else if (r < 0.85 && p.hand.length > 0) {
    // Swap lowest-value cards
    const sorted = [...p.hand].sort((a, b) => (a.value || 0) - (b.value || 0));
    const num    = Math.random() < 0.5 ? 1 : Math.min(2, sorted.length);
    return { type: 'SWAP', cardIds: sorted.slice(0, num).map(c => c.id) };
  }
  return { type: 'PASS' };
}

function botTieBreak(g, playerIdx) {
  const p     = g.players[playerIdx];
  const baelf = getTrickBaelf(g);
  // Play highest-value same-colour card, 60% of the time
  const eligible = p.hand
    .filter(c => c.color === baelf.color && c.type === 'numeric')
    .sort((a, b) => b.value - a.value);
  if (eligible.length > 0 && Math.random() < 0.6) return eligible[0].id;
  return null; // pass
}

function botDiscardExcess(g, playerIdx) {
  const p      = g.players[playerIdx];
  const excess = g.trick.discardExcess;
  // Discard lowest-value cards first
  const sorted = [...p.hand].sort((a, b) => (a.value || 0) - (b.value || 0));
  return sorted.slice(0, excess).map(c => c.id);
}

// ══════════════════════════════════════════════════════════════════════════════
// BOT TICK
// Returns { playerIdx, msg } if a bot can act right now, else null.
// server.js calls this (with a short delay) after every state change.
// ══════════════════════════════════════════════════════════════════════════════
function getBotAction(g) {
  if (g.phase === 'CHOOSE_BAELFUNGIOUS') {
    for (const r of (g.replaceNeeded || [])) {
      if (g.players[r.playerIdx].isBot) {
        const bi = botChooseBaelf(g, r.playerIdx);
        if (bi !== null)
          return { playerIdx: r.playerIdx, msg: { type: 'CHOOSE_BAELF', baelfIdx: bi } };
      }
    }
  }

  if (g.phase === 'CHOOSE_SEQUENCE' && g.players[g.governorIdx].isBot) {
    const order = botChooseSequence(g);
    if (order.length) return { playerIdx: g.governorIdx, msg: { type: 'CHOOSE_SEQUENCE', order } };
  }

  if (g.phase === 'PLAYER_ACTIONS' && g.trick) {
    const t = g.trick;
    // Excess discard first
    if (t.waitingForDiscard !== -1 && g.players[t.waitingForDiscard].isBot) {
      const ids = botDiscardExcess(g, t.waitingForDiscard);
      return { playerIdx: t.waitingForDiscard, msg: { type: 'DISCARD_EXCESS', cardIds: ids } };
    }
    const expected = t.actionOrder[t.currentActorIdx];
    if (expected !== undefined && g.players[expected].isBot)
      return { playerIdx: expected, msg: { type: 'PLAYER_ACT', ...botAct(g, expected) } };
  }

  if (g.phase === 'TIE_BREAK' && g.trick) {
    for (const pi of g.trick.tiedPlayers) {
      if (g.players[pi].isBot && !g.trick.tieBreakSubmitted[pi])
        return { playerIdx: pi, msg: { type: 'TIE_BREAK', cardId: botTieBreak(g, pi) } };
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ACTION DISPATCHER (called from server.js)
// ══════════════════════════════════════════════════════════════════════════════
function handleAction(g, playerIdx, msg) {
  switch (msg.type) {
    case 'CHOOSE_BAELF':     return chooseBaelf(g, playerIdx, msg.baelfIdx);
    case 'CHOOSE_SEQUENCE':  return chooseSequence(g, playerIdx, msg.order);
    // Client and bots may send BET/SWAP/PASS directly (or wrapped as PLAYER_ACT)
    case 'PLAYER_ACT':
    case 'BET':
    case 'SWAP':
    case 'PASS':           return playerAct(g, playerIdx, msg);
    case 'DISCARD_EXCESS': return discardExcess(g, playerIdx, msg.cardIds);
    case 'TIE_BREAK':      return tieBreakAct(g, playerIdx, msg.cardId ?? null);
    default:               return { error: 'Ação desconhecida: ' + msg.type };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS FOR CLIENT-SIDE DISPLAY (descriptions)
// ══════════════════════════════════════════════════════════════════════════════
function descCard(c) {
  if (c.type === 'joker')   return `Joker ${c.symbol === 'circle' ? '⭕' : '▲'}`;
  if (c.type === 'double')  return `×2 ${c.color}`;
  return `${c.value} ${c.color}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
module.exports = {
  newGame,
  handleAction,
  buildView,
  getBotAction,
  tieBreakTimeout,
  // Constants needed by server.js
  TIE_BREAK_MS,
  TRICKS_PER_ROUND,
};

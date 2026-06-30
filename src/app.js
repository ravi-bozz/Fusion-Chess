import { ChessEngine, TYPES, WHITE, BLACK, pieceName, reviveGameState, sameSquare, squareName } from "./engine.js";

const symbols = {
  white: { king: "&#9812;", queen: "&#9813;", rook: "&#9814;", bishop: "&#9815;", knight: "&#9816;", pawn: "&#9817;" },
  black: { king: "&#9818;", queen: "&#9819;", rook: "&#9820;", bishop: "&#9821;", knight: "&#9822;", pawn: "&#9823;" }
};

let engine = new ChessEngine();
let selected = null;
let legalMoves = [];
let fusionMode = false;
let fusionSelection = [];
let resurrectionArmed = { [WHITE]: false, [BLACK]: false };
let remoteSession = null;
let pollTimer = null;

const boardEl = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const fusionBtn = document.querySelector("#fusionBtn");
const resurrectBtn = document.querySelector("#resurrectBtn");
const fusionState = document.querySelector("#fusionState");
const resurrectState = document.querySelector("#resurrectState");
const capturedWhite = document.querySelector("#capturedWhite");
const capturedBlack = document.querySelector("#capturedBlack");
const historyEl = document.querySelector("#history");
const undoBtn = document.querySelector("#undoBtn");
const fullscreenBtn = document.querySelector("#fullscreenBtn");
const createRoomBtn = document.querySelector("#createRoomBtn");
const joinRoomBtn = document.querySelector("#joinRoomBtn");
const roomCodeInput = document.querySelector("#roomCodeInput");
const remoteStatus = document.querySelector("#remoteStatus");
const dialog = document.querySelector("#choiceDialog");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogText = document.querySelector("#dialogText");
const dialogActions = document.querySelector("#dialogActions");

render();

fusionBtn.addEventListener("click", () => {
  if (!canAct()) return;
  fusionMode = !fusionMode;
  fusionSelection = [];
  selected = null;
  legalMoves = [];
  render();
});

resurrectBtn.addEventListener("click", () => {
  if (!canAct()) return;
  if (engine.state.pendingResurrection) {
    openResurrectionChoice();
    return;
  }
  const player = engine.state.players[engine.state.turn];
  if (player.resurrectionUsed || engine.state.winner || engine.state.draw) return;
  resurrectionArmed[engine.state.turn] = !resurrectionArmed[engine.state.turn];
  render();
});

undoBtn.addEventListener("click", () => {
  if (remoteSession) return showMessage("Remote game", "Undo is disabled in remote mode.");
  engine.undo();
  selected = null;
  fusionSelection = [];
  fusionMode = false;
  render();
});

fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  fullscreenBtn.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Fullscreen";
  fullscreenBtn.title = document.fullscreenElement ? "Exit fullscreen" : "Enter fullscreen";
});

createRoomBtn.addEventListener("click", () => createRemoteRoom());
joinRoomBtn.addEventListener("click", () => joinRemoteRoom());
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});
roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRemoteRoom();
});

function render() {
  boardEl.innerHTML = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const square = { x, y };
      const piece = engine.state.board.get(square);
      const cell = document.createElement("button");
      cell.className = `square ${(x + y) % 2 ? "dark" : "light"}`;
      cell.dataset.x = x;
      cell.dataset.y = y;
      cell.dataset.file = "abcdefgh"[x];
      cell.dataset.rank = 8 - y;
      cell.setAttribute("aria-label", `${squareName(square)} ${piece ? pieceName(piece) : "empty"}`);
      cell.draggable = canAct() && !!piece && piece.color === engine.state.turn && !engine.state.pendingResurrection;
      if (selected && sameSquare(selected, square)) cell.classList.add("selected");
      if (fusionSelection.some((item) => sameSquare(item, square))) cell.classList.add("fusion-selected");
      if (legalMoves.some((move) => sameSquare(move.to, square))) cell.classList.add("legal");
      if (piece) cell.innerHTML = pieceMarkup(piece);
      cell.addEventListener("click", () => onSquareClick(square));
      cell.addEventListener("dragstart", (event) => onDragStart(event, square));
      cell.addEventListener("dragover", (event) => event.preventDefault());
      cell.addEventListener("drop", (event) => onDrop(event, square));
      boardEl.append(cell);
    }
  }

  const state = engine.state;
  statusText.textContent = state.pendingResurrection
    ? `${title(state.pendingResurrection.color)} may use Resurrection Swap now`
    : state.message;
  const actorColor = state.pendingResurrection?.color ?? state.turn;
  const player = state.players[actorColor];
  fusionBtn.disabled = !canAct() || player.fusionUsed || !!state.pendingResurrection || !!state.winner || state.draw;
  fusionBtn.classList.toggle("active", fusionMode);
  fusionState.textContent = player.fusionUsed ? "Used" : fusionMode ? "Select two pieces" : "Available";
  resurrectBtn.disabled = !canAct() || player.resurrectionUsed || !!state.winner || state.draw;
  resurrectBtn.classList.toggle("active", resurrectionArmed[actorColor] && !state.pendingResurrection);
  resurrectState.textContent = state.players[state.pendingResurrection?.color ?? state.turn].resurrectionUsed
    ? "Used"
    : state.pendingResurrection ? "Use or decline" : resurrectionArmed[actorColor] ? "Armed" : "Arm before capture";
  capturedWhite.innerHTML = capturedMarkup(state.players[WHITE].captured);
  capturedBlack.innerHTML = capturedMarkup(state.players[BLACK].captured);
  historyEl.innerHTML = state.moveHistory.map((entry) => `<li>${entry.notation}</li>`).join("");
  undoBtn.disabled = !!remoteSession;
  updateRemoteStatus();
}

function onSquareClick(square) {
  if (!canAct()) return;
  if (engine.state.pendingResurrection) return;
  if (fusionMode) return handleFusionSelection(square);
  const piece = engine.state.board.get(square);
  if (selected && legalMoves.some((move) => sameSquare(move.to, square))) {
    completeMove(selected, square);
    return;
  }
  if (piece?.color === engine.state.turn) {
    selected = square;
    legalMoves = engine.legalMovesFrom(square);
  } else {
    selected = null;
    legalMoves = [];
  }
  render();
}

function onDragStart(event, square) {
  if (!canAct()) return;
  selected = square;
  legalMoves = engine.legalMovesFrom(square);
  event.dataTransfer.setData("text/plain", JSON.stringify(square));
  render();
}

function onDrop(event, to) {
  event.preventDefault();
  if (!canAct()) return;
  const from = JSON.parse(event.dataTransfer.getData("text/plain"));
  completeMove(from, to);
}

async function completeMove(from, to) {
  try {
    const moving = engine.state.board.get(from);
    if (moving?.type === TYPES.PAWN && (to.y === 0 || to.y === 7)) {
      return openPromotionChoice(from, to);
    }
    if (remoteSession) await sendRemoteAction({ type: "move", from, to });
    else engine.move(from, to);
    selected = null;
    legalMoves = [];
    render();
    maybeOpenArmedResurrection();
  } catch (error) {
    showMessage("Illegal move", error.message);
  }
}

function handleFusionSelection(square) {
  const piece = engine.state.board.get(square);
  if (!piece || piece.color !== engine.state.turn || piece.type === TYPES.KING || piece.type === TYPES.FUSION) return;
  if (fusionSelection.some((item) => sameSquare(item, square))) {
    fusionSelection = fusionSelection.filter((item) => !sameSquare(item, square));
  } else if (fusionSelection.length < 2) {
    fusionSelection.push(square);
  }
  if (fusionSelection.length === 2) openFusionDestinationChoice();
  render();
}

function openPromotionChoice(from, to) {
  openDialog("Promote pawn", "Choose the promoted piece.", [
    ["Queen", () => finishPromotion(from, to, TYPES.QUEEN)],
    ["Rook", () => finishPromotion(from, to, TYPES.ROOK)],
    ["Bishop", () => finishPromotion(from, to, TYPES.BISHOP)],
    ["Knight", () => finishPromotion(from, to, TYPES.KNIGHT)]
  ]);
}

async function finishPromotion(from, to, type) {
  dialog.close();
  if (remoteSession) await sendRemoteAction({ type: "move", from, to, promotion: type });
  else engine.move(from, to, type);
  selected = null;
  legalMoves = [];
  render();
  maybeOpenArmedResurrection();
}

function openFusionDestinationChoice() {
  const [a, b] = fusionSelection;
  openDialog("Create Fusion Piece", "Place the new piece on either source square.", [
    [squareName(a), () => finishFusion(a)],
    [squareName(b), () => finishFusion(b)],
    ["Cancel", () => { dialog.close(); fusionSelection = []; render(); }]
  ]);
}

async function finishFusion(destination) {
  try {
    const [a, b] = fusionSelection;
    if (remoteSession) await sendRemoteAction({ type: "fusion", squareA: a, squareB: b, destination });
    else engine.fusionMove(a, b, destination);
    dialog.close();
    fusionMode = false;
    fusionSelection = [];
    render();
  } catch (error) {
    showMessage("Fusion unavailable", error.message);
  }
}

function openResurrectionChoice() {
  const pending = engine.state.pendingResurrection;
  if (!pending || dialog.open || !canAct()) return;
  resurrectionArmed[pending.color] = false;
  openDialog("Resurrection Swap", `Sacrifice your capturing piece and revive the captured ${pieceName(pending.captured)} as your own?`, [
    ["Use", async () => {
      dialog.close();
      if (remoteSession) await sendRemoteAction({ type: "resurrect" });
      else engine.activateResurrectionSwap();
      resurrectionArmed[pending.color] = false;
      render();
    }],
    ["Decline", async () => {
      dialog.close();
      if (remoteSession) await sendRemoteAction({ type: "declineResurrection" });
      else engine.declineResurrectionSwap();
      resurrectionArmed[pending.color] = false;
      render();
    }]
  ]);
}

function maybeOpenArmedResurrection() {
  const pendingColor = engine.state.pendingResurrection?.color;
  if (pendingColor && resurrectionArmed[pendingColor] && canAct()) {
    openResurrectionChoice();
  }
}

async function createRemoteRoom() {
  try {
    const room = await api("/api/rooms", { method: "POST" });
    applyRemoteRoom(room);
    startPolling();
  } catch (error) {
    showMessage("Remote mode unavailable", error.message);
  }
}

async function joinRemoteRoom() {
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) return showMessage("Room code needed", "Enter the room code from the player who created the game.");
  try {
    const room = await api(`/api/rooms/${code}/join`, { method: "POST" });
    applyRemoteRoom(room);
    startPolling();
  } catch (error) {
    showMessage("Could not join room", error.message);
  }
}

async function sendRemoteAction(action) {
  const room = await api(`/api/rooms/${remoteSession.code}/actions`, {
    method: "POST",
    body: JSON.stringify({ ...action, playerId: remoteSession.playerId })
  });
  applyRemoteRoom(room);
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!remoteSession || document.hidden) return;
    try {
      const room = await api(`/api/rooms/${remoteSession.code}?playerId=${encodeURIComponent(remoteSession.playerId)}`);
      if (room.version !== remoteSession.version) applyRemoteRoom(room);
    } catch (error) {
      remoteStatus.textContent = `Remote disconnected: ${error.message}`;
    }
  }, 1200);
}

function applyRemoteRoom(room) {
  remoteSession = {
    code: room.code,
    color: room.color,
    playerId: room.playerId,
    version: room.version,
    players: room.players
  };
  engine = new ChessEngine(reviveGameState(room.state));
  selected = null;
  legalMoves = [];
  fusionMode = false;
  fusionSelection = [];
  if (engine.state.players[remoteSession.color]?.resurrectionUsed) resurrectionArmed[remoteSession.color] = false;
  roomCodeInput.value = room.code;
  render();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Remote mode needs the Node server. Stop the static server and run: npm start");
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function canAct() {
  if (!remoteSession) return true;
  if (!remoteSession.color) return false;
  const pendingColor = engine.state.pendingResurrection?.color;
  return pendingColor ? remoteSession.color === pendingColor : remoteSession.color === engine.state.turn;
}

function updateRemoteStatus() {
  if (!remoteSession) {
    remoteStatus.textContent = "Local mode";
    return;
  }
  const opponentColor = remoteSession.color === WHITE ? BLACK : WHITE;
  const opponentReady = remoteSession.players?.[opponentColor];
  const turnText = canAct() ? "Your move" : "Waiting";
  remoteStatus.textContent = `Room ${remoteSession.code} | You are ${title(remoteSession.color)} | ${opponentReady ? turnText : "Waiting for opponent"}`;
}

function openDialog(titleText, bodyText, actions) {
  dialogTitle.textContent = titleText;
  dialogText.textContent = bodyText;
  dialogActions.innerHTML = "";
  for (const [label, action] of actions) {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", action);
    dialogActions.append(button);
  }
  if (!dialog.open) dialog.showModal();
}

function showMessage(titleText, bodyText) {
  openDialog(titleText, bodyText, [["OK", () => dialog.close()]]);
}

function pieceMarkup(piece) {
  if (piece.type === TYPES.FUSION) {
    const [first, second] = piece.components;
    const letters = piece.components.map((type) => type[0].toUpperCase()).join("");
    return `
      <span class="piece fusion-piece ${piece.color}" title="${pieceName(piece)}">
        <span class="fusion-ring"></span>
        <span class="fusion-symbol primary">${symbols[piece.color][first]}</span>
        <span class="fusion-symbol secondary">${symbols[piece.color][second]}</span>
        <span class="fusion-label">${letters}</span>
      </span>
    `;
  }
  return `<span class="piece ${piece.color}">${symbols[piece.color][piece.type]}</span>`;
}

function capturedMarkup(pieces) {
  return pieces.map((piece) => {
    if (piece.type === TYPES.FUSION) {
      const [first, second] = piece.components;
      return `<span class="captured-fusion" title="${pieceName(piece)}">${symbols[piece.color][first]}${symbols[piece.color][second]}</span>`;
    }
    return `<span title="${pieceName(piece)}">${symbols[piece.color][piece.type]}</span>`;
  }).join("");
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

import { ChessEngine, TYPES, WHITE, BLACK, pieceName, sameSquare, squareName } from "./engine.js";

const symbols = {
  white: { king: "♔", queen: "♕", rook: "♖", bishop: "♗", knight: "♘", pawn: "♙" },
  black: { king: "♚", queen: "♛", rook: "♜", bishop: "♝", knight: "♞", pawn: "♟" }
};

const engine = new ChessEngine();
let selected = null;
let legalMoves = [];
let fusionMode = false;
let fusionSelection = [];

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
const dialog = document.querySelector("#choiceDialog");
const dialogTitle = document.querySelector("#dialogTitle");
const dialogText = document.querySelector("#dialogText");
const dialogActions = document.querySelector("#dialogActions");

render();

fusionBtn.addEventListener("click", () => {
  fusionMode = !fusionMode;
  fusionSelection = [];
  selected = null;
  legalMoves = [];
  render();
});

resurrectBtn.addEventListener("click", () => openResurrectionChoice());

undoBtn.addEventListener("click", () => {
  engine.undo();
  selected = null;
  fusionSelection = [];
  fusionMode = false;
  render();
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
      cell.setAttribute("aria-label", `${squareName(square)} ${piece ? pieceName(piece) : "empty"}`);
      cell.draggable = !!piece && piece.color === engine.state.turn && !engine.state.pendingResurrection;
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
  const player = state.players[state.turn];
  fusionBtn.disabled = player.fusionUsed || !!state.pendingResurrection || !!state.winner || state.draw;
  fusionBtn.classList.toggle("active", fusionMode);
  fusionState.textContent = player.fusionUsed ? "Used" : fusionMode ? "Select two pieces" : "Available";
  resurrectBtn.disabled = !state.pendingResurrection;
  resurrectState.textContent = state.players[state.pendingResurrection?.color ?? state.turn].resurrectionUsed
    ? "Used"
    : state.pendingResurrection ? "Available now" : "Capture first";
  capturedWhite.innerHTML = capturedMarkup(state.players[WHITE].captured);
  capturedBlack.innerHTML = capturedMarkup(state.players[BLACK].captured);
  historyEl.innerHTML = state.moveHistory.map((entry) => `<li>${entry.notation}</li>`).join("");
  if (state.pendingResurrection) openResurrectionChoice();
}

function onSquareClick(square) {
  if (engine.state.pendingResurrection) return openResurrectionChoice();
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
  selected = square;
  legalMoves = engine.legalMovesFrom(square);
  event.dataTransfer.setData("text/plain", JSON.stringify(square));
  render();
}

function onDrop(event, to) {
  event.preventDefault();
  const from = JSON.parse(event.dataTransfer.getData("text/plain"));
  completeMove(from, to);
}

function completeMove(from, to) {
  try {
    const moving = engine.state.board.get(from);
    if (moving?.type === TYPES.PAWN && (to.y === 0 || to.y === 7)) {
      return openPromotionChoice(from, to);
    }
    engine.move(from, to);
    selected = null;
    legalMoves = [];
    render();
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

function finishPromotion(from, to, type) {
  dialog.close();
  engine.move(from, to, type);
  selected = null;
  legalMoves = [];
  render();
}

function openFusionDestinationChoice() {
  const [a, b] = fusionSelection;
  openDialog("Create Fusion Piece", "Place the new piece on either source square.", [
    [squareName(a), () => finishFusion(a)],
    [squareName(b), () => finishFusion(b)],
    ["Cancel", () => { dialog.close(); fusionSelection = []; render(); }]
  ]);
}

function finishFusion(destination) {
  try {
    const [a, b] = fusionSelection;
    engine.fusionMove(a, b, destination);
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
  if (!pending || dialog.open) return;
  openDialog("Resurrection Swap", `Sacrifice your capturing piece and revive the captured ${pieceName(pending.captured)} as your own?`, [
    ["Use", () => { dialog.close(); engine.activateResurrectionSwap(); render(); }],
    ["Decline", () => { dialog.close(); engine.declineResurrectionSwap(); render(); }]
  ]);
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
    const letters = piece.components.map((type) => type[0].toUpperCase()).join("");
    return `<span class="piece fusion-piece ${piece.color}">F<span>${letters}</span></span>`;
  }
  return `<span class="piece ${piece.color}">${symbols[piece.color][piece.type]}</span>`;
}

function capturedMarkup(pieces) {
  return pieces.map((piece) => `<span title="${pieceName(piece)}">${piece.type === TYPES.FUSION ? "F" : symbols[piece.color][piece.type]}</span>`).join("");
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

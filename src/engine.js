export const WHITE = "white";
export const BLACK = "black";
export const TYPES = {
  KING: "king",
  QUEEN: "queen",
  ROOK: "rook",
  BISHOP: "bishop",
  KNIGHT: "knight",
  PAWN: "pawn",
  FUSION: "fusion"
};

const ORTHOGONAL = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONAL = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_STEPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING_STEPS = [...ORTHOGONAL, ...DIAGONAL];
let nextPieceId = 1;

export class Piece {
  constructor(type, color, options = {}) {
    this.id = options.id ?? `p${nextPieceId++}`;
    this.type = type;
    this.color = color;
    this.hasMoved = options.hasMoved ?? false;
  }

  clone() {
    return new Piece(this.type, this.color, { id: this.id, hasMoved: this.hasMoved });
  }
}

export class FusionPiece extends Piece {
  constructor(color, components, options = {}) {
    super(TYPES.FUSION, color, options);
    this.components = [...new Set(components)].filter((type) => type !== TYPES.KING && type !== TYPES.FUSION);
  }

  clone() {
    return new FusionPiece(this.color, this.components, { id: this.id, hasMoved: this.hasMoved });
  }
}

export class Player {
  constructor(color) {
    this.color = color;
    this.resurrectionUsed = false;
    this.fusionUsed = false;
    this.captured = [];
  }

  clone() {
    const player = new Player(this.color);
    player.resurrectionUsed = this.resurrectionUsed;
    player.fusionUsed = this.fusionUsed;
    player.captured = this.captured.map((piece) => piece.clone());
    return player;
  }
}

export class Move {
  constructor({ from, to, piece, captured = null, promotion = null, castle = null, enPassant = false }) {
    this.from = from;
    this.to = to;
    this.piece = piece;
    this.captured = captured;
    this.promotion = promotion;
    this.castle = castle;
    this.enPassant = enPassant;
  }
}

export class Board {
  constructor(grid = null) {
    this.grid = grid ?? Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  static initial() {
    const board = new Board();
    const back = [TYPES.ROOK, TYPES.KNIGHT, TYPES.BISHOP, TYPES.QUEEN, TYPES.KING, TYPES.BISHOP, TYPES.KNIGHT, TYPES.ROOK];
    for (let x = 0; x < 8; x += 1) {
      board.set({ x, y: 0 }, new Piece(back[x], BLACK));
      board.set({ x, y: 1 }, new Piece(TYPES.PAWN, BLACK));
      board.set({ x, y: 6 }, new Piece(TYPES.PAWN, WHITE));
      board.set({ x, y: 7 }, new Piece(back[x], WHITE));
    }
    return board;
  }

  clone() {
    return new Board(this.grid.map((row) => row.map((piece) => piece?.clone() ?? null)));
  }

  inBounds(square) {
    return square.x >= 0 && square.x < 8 && square.y >= 0 && square.y < 8;
  }

  get(square) {
    return this.inBounds(square) ? this.grid[square.y][square.x] : null;
  }

  set(square, piece) {
    if (this.inBounds(square)) this.grid[square.y][square.x] = piece;
  }

  move(from, to) {
    const piece = this.get(from);
    this.set(from, null);
    this.set(to, piece);
    return piece;
  }

  allPieces(color = null) {
    const pieces = [];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = this.grid[y][x];
        if (piece && (!color || piece.color === color)) pieces.push({ piece, square: { x, y } });
      }
    }
    return pieces;
  }
}

export class GameState {
  constructor() {
    this.board = Board.initial();
    this.players = { [WHITE]: new Player(WHITE), [BLACK]: new Player(BLACK) };
    this.turn = WHITE;
    this.moveHistory = [];
    this.snapshots = [];
    this.pendingResurrection = null;
    this.winner = null;
    this.draw = false;
    this.message = "White to move";
    this.enPassantTarget = null;
  }

  clone() {
    const state = Object.create(GameState.prototype);
    state.board = this.board.clone();
    state.players = { [WHITE]: this.players[WHITE].clone(), [BLACK]: this.players[BLACK].clone() };
    state.turn = this.turn;
    state.moveHistory = this.moveHistory.map((entry) => ({ ...entry }));
    state.snapshots = [];
    state.pendingResurrection = this.pendingResurrection ? {
      color: this.pendingResurrection.color,
      square: { ...this.pendingResurrection.square },
      captured: this.pendingResurrection.captured.clone(),
      sacrificedId: this.pendingResurrection.sacrificedId
    } : null;
    state.winner = this.winner;
    state.draw = this.draw;
    state.message = this.message;
    state.enPassantTarget = this.enPassantTarget ? { ...this.enPassantTarget } : null;
    return state;
  }
}

export class ChessEngine {
  constructor(state = new GameState()) {
    this.state = state;
  }

  opponent(color) {
    return color === WHITE ? BLACK : WHITE;
  }

  legalMovesFrom(square) {
    const piece = this.state.board.get(square);
    if (!piece || piece.color !== this.state.turn || this.state.pendingResurrection || this.state.winner || this.state.draw) return [];
    return this.pseudoMoves(square, piece, true).filter((move) => this.isLegalMove(move));
  }

  allLegalMoves(color = this.state.turn) {
    const original = this.state.turn;
    this.state.turn = color;
    const moves = this.state.board.allPieces(color).flatMap(({ square }) => this.legalMovesFrom(square));
    this.state.turn = original;
    return moves;
  }

  move(from, to, promotion = TYPES.QUEEN) {
    const legal = this.legalMovesFrom(from).find((move) => sameSquare(move.to, to));
    if (!legal) throw new Error("Illegal move");
    this.saveSnapshot();
    this.applyMove(legal, promotion);
    this.finalizeTurn(legal);
    return legal;
  }

  activateResurrectionSwap() {
    const pending = this.state.pendingResurrection;
    if (!pending) throw new Error("No capture is available for Resurrection Swap");
    const player = this.state.players[pending.color];
    if (player.resurrectionUsed) throw new Error("Resurrection Swap has already been used");
    if (pending.captured.type === TYPES.KING) throw new Error("Kings cannot be resurrected");

    this.saveSnapshot();
    const resurrected = pending.captured.type === TYPES.FUSION
      ? new FusionPiece(pending.color, pending.captured.components)
      : new Piece(pending.captured.type, pending.color);
    resurrected.hasMoved = true;
    this.state.board.set(pending.square, resurrected);
    if (this.isInCheck(pending.color)) {
      this.restoreSnapshot();
      throw new Error("Resurrection Swap would leave your king in check");
    }
    player.resurrectionUsed = true;
    this.state.pendingResurrection = null;
    this.state.moveHistory.push({ notation: `${title(pending.color)} used Resurrection Swap`, special: "resurrection" });
    this.updateGameStatus();
  }

  declineResurrectionSwap() {
    this.state.pendingResurrection = null;
    this.updateGameStatus();
  }

  fusionMove(squareA, squareB, destination) {
    const player = this.state.players[this.state.turn];
    const pieceA = this.state.board.get(squareA);
    const pieceB = this.state.board.get(squareB);
    if (player.fusionUsed) throw new Error("Fusion Move has already been used");
    if (!pieceA || !pieceB || pieceA.color !== this.state.turn || pieceB.color !== this.state.turn) throw new Error("Select two friendly pieces");
    if (pieceA.type === TYPES.KING || pieceB.type === TYPES.KING) throw new Error("Kings cannot be fused");
    if (pieceA.type === TYPES.FUSION || pieceB.type === TYPES.FUSION) throw new Error("Fusion Pieces cannot be fused again");
    if (!sameSquare(destination, squareA) && !sameSquare(destination, squareB)) throw new Error("Fusion Piece must be placed on one source square");

    this.saveSnapshot();
    const components = [pieceA.type, pieceB.type];
    const fusion = new FusionPiece(this.state.turn, components);
    this.state.board.set(squareA, null);
    this.state.board.set(squareB, null);
    this.state.board.set(destination, fusion);
    if (this.isInCheck(this.state.turn)) {
      this.restoreSnapshot();
      throw new Error("Fusion Move would leave your king in check");
    }
    player.fusionUsed = true;
    this.state.pendingResurrection = null;
    this.state.moveHistory.push({ notation: `${title(this.state.turn)} fused ${pieceName(pieceA)} + ${pieceName(pieceB)}`, special: "fusion" });
    this.state.turn = this.opponent(this.state.turn);
    this.updateGameStatus();
  }

  undo() {
    if (!this.state.snapshots.length) return false;
    this.restoreSnapshot();
    return true;
  }

  saveSnapshot() {
    this.state.snapshots.push(this.state.clone());
  }

  restoreSnapshot() {
    const snapshot = this.state.snapshots.pop();
    if (snapshot) this.state = snapshot;
  }

  applyMove(move, promotion = TYPES.QUEEN) {
    const moving = this.state.board.get(move.from);
    const capturedSquare = move.enPassant ? { x: move.to.x, y: move.from.y } : move.to;
    const captured = this.state.board.get(capturedSquare);
    this.state.board.set(move.from, null);
    if (move.enPassant) this.state.board.set(capturedSquare, null);
    if (move.castle) {
      const rook = this.state.board.get(move.castle.rookFrom);
      this.state.board.set(move.castle.rookFrom, null);
      this.state.board.set(move.castle.rookTo, rook);
      if (rook) rook.hasMoved = true;
    }

    let placed = moving;
    if (moving.type === TYPES.PAWN && (move.to.y === 0 || move.to.y === 7)) {
      placed = new Piece(promotion, moving.color, { id: moving.id, hasMoved: true });
    } else {
      moving.hasMoved = true;
    }
    this.state.board.set(move.to, placed);
    this.state.enPassantTarget = null;
    if (moving.type === TYPES.PAWN && Math.abs(move.from.y - move.to.y) === 2) {
      this.state.enPassantTarget = { x: move.from.x, y: (move.from.y + move.to.y) / 2 };
    }
    move.captured = captured?.clone() ?? null;
  }

  finalizeTurn(move) {
    const mover = move.piece.color;
    if (move.captured) {
      this.state.players[mover].captured.push(move.captured.clone());
      const canResurrect = !this.state.players[mover].resurrectionUsed && move.captured.type !== TYPES.KING;
      this.state.pendingResurrection = canResurrect ? {
        color: mover,
        square: { ...move.to },
        captured: move.captured.clone(),
        sacrificedId: move.piece.id
      } : null;
    } else {
      this.state.pendingResurrection = null;
    }
    this.state.moveHistory.push({ notation: this.notation(move), move });
    this.state.turn = this.opponent(mover);
    this.updateGameStatus();
  }

  updateGameStatus() {
    const color = this.state.turn;
    const legal = this.state.pendingResurrection ? [1] : this.allLegalMoves(color);
    this.state.winner = null;
    this.state.draw = false;
    if (!legal.length) {
      if (this.isInCheck(color)) {
        this.state.winner = this.opponent(color);
        this.state.message = `Checkmate. ${title(this.state.winner)} wins.`;
      } else {
        this.state.draw = true;
        this.state.message = "Stalemate.";
      }
      return;
    }
    this.state.message = `${title(color)} to move${this.isInCheck(color) ? " - check" : ""}`;
  }

  isLegalMove(move) {
    const clone = new ChessEngine(this.state.clone());
    clone.applyMove(new Move({
      from: { ...move.from },
      to: { ...move.to },
      piece: move.piece.clone(),
      captured: move.captured?.clone() ?? null,
      castle: move.castle ? { rookFrom: { ...move.castle.rookFrom }, rookTo: { ...move.castle.rookTo } } : null,
      enPassant: move.enPassant
    }));
    return !clone.isInCheck(move.piece.color);
  }

  isInCheck(color) {
    const king = this.state.board.allPieces(color).find(({ piece }) => piece.type === TYPES.KING);
    if (!king) return true;
    return this.isSquareAttacked(king.square, this.opponent(color));
  }

  isSquareAttacked(square, byColor) {
    return this.state.board.allPieces(byColor).some(({ piece, square: from }) => {
      return this.pseudoMoves(from, piece, false).some((move) => sameSquare(move.to, square));
    });
  }

  pseudoMoves(square, piece, includeCastling) {
    const activeTypes = piece.type === TYPES.FUSION ? piece.components : [piece.type];
    const moves = [];
    for (const type of activeTypes) {
      if (type === TYPES.PAWN) moves.push(...this.pawnMoves(square, piece));
      if (type === TYPES.KNIGHT) moves.push(...this.stepMoves(square, piece, KNIGHT_STEPS));
      if (type === TYPES.BISHOP) moves.push(...this.slideMoves(square, piece, DIAGONAL));
      if (type === TYPES.ROOK) moves.push(...this.slideMoves(square, piece, ORTHOGONAL));
      if (type === TYPES.QUEEN) moves.push(...this.slideMoves(square, piece, [...ORTHOGONAL, ...DIAGONAL]));
      if (type === TYPES.KING) moves.push(...this.kingMoves(square, piece, includeCastling));
    }
    return dedupeMoves(moves);
  }

  pawnMoves(square, piece) {
    const moves = [];
    const dir = piece.color === WHITE ? -1 : 1;
    const startRank = piece.color === WHITE ? 6 : 1;
    const one = { x: square.x, y: square.y + dir };
    if (this.state.board.inBounds(one) && !this.state.board.get(one)) {
      moves.push(new Move({ from: square, to: one, piece }));
      const two = { x: square.x, y: square.y + dir * 2 };
      if (square.y === startRank && !this.state.board.get(two)) moves.push(new Move({ from: square, to: two, piece }));
    }
    for (const dx of [-1, 1]) {
      const to = { x: square.x + dx, y: square.y + dir };
      if (!this.state.board.inBounds(to)) continue;
      const target = this.state.board.get(to);
      if (target && target.color !== piece.color) moves.push(new Move({ from: square, to, piece, captured: target }));
      if (this.state.enPassantTarget && sameSquare(to, this.state.enPassantTarget)) {
        const captured = this.state.board.get({ x: to.x, y: square.y });
        if (captured?.type === TYPES.PAWN && captured.color !== piece.color) {
          moves.push(new Move({ from: square, to, piece, captured, enPassant: true }));
        }
      }
    }
    return moves;
  }

  stepMoves(square, piece, steps) {
    return steps.flatMap(([dx, dy]) => {
      const to = { x: square.x + dx, y: square.y + dy };
      if (!this.state.board.inBounds(to)) return [];
      const target = this.state.board.get(to);
      return !target || target.color !== piece.color ? [new Move({ from: square, to, piece, captured: target })] : [];
    });
  }

  slideMoves(square, piece, directions) {
    const moves = [];
    for (const [dx, dy] of directions) {
      let to = { x: square.x + dx, y: square.y + dy };
      while (this.state.board.inBounds(to)) {
        const target = this.state.board.get(to);
        if (!target) {
          moves.push(new Move({ from: square, to: { ...to }, piece }));
        } else {
          if (target.color !== piece.color) moves.push(new Move({ from: square, to: { ...to }, piece, captured: target }));
          break;
        }
        to = { x: to.x + dx, y: to.y + dy };
      }
    }
    return moves;
  }

  kingMoves(square, piece, includeCastling) {
    const moves = this.stepMoves(square, piece, KING_STEPS);
    if (!includeCastling || piece.hasMoved || this.isInCheck(piece.color)) return moves;
    const y = piece.color === WHITE ? 7 : 0;
    for (const side of [{ rookX: 7, kingToX: 6, rookToX: 5, clear: [5, 6] }, { rookX: 0, kingToX: 2, rookToX: 3, clear: [1, 2, 3] }]) {
      const rook = this.state.board.get({ x: side.rookX, y });
      if (!rook || rook.type !== TYPES.ROOK || rook.color !== piece.color || rook.hasMoved) continue;
      if (side.clear.some((x) => this.state.board.get({ x, y }))) continue;
      const through = side.kingToX === 6 ? [5, 6] : [3, 2];
      if (through.some((x) => this.isSquareAttacked({ x, y }, this.opponent(piece.color)))) continue;
      moves.push(new Move({
        from: square,
        to: { x: side.kingToX, y },
        piece,
        castle: { rookFrom: { x: side.rookX, y }, rookTo: { x: side.rookToX, y } }
      }));
    }
    return moves;
  }

  notation(move) {
    const capture = move.captured ? "x" : "-";
    const special = move.castle ? (move.to.x === 6 ? "O-O" : "O-O-O") : `${pieceName(move.piece)} ${squareName(move.from)}${capture}${squareName(move.to)}`;
    return `${title(move.piece.color)}: ${special}`;
  }
}

export function sameSquare(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

export function squareName(square) {
  return `${"abcdefgh"[square.x]}${8 - square.y}`;
}

export function pieceName(piece) {
  if (!piece) return "";
  if (piece.type === TYPES.FUSION) return `Fusion(${piece.components.map(title).join("+")})`;
  return title(piece.type);
}

export function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function reviveGameState(data) {
  const state = Object.create(GameState.prototype);
  state.board = new Board(data.board.grid.map((row) => row.map(revivePiece)));
  state.players = {
    [WHITE]: revivePlayer(data.players[WHITE]),
    [BLACK]: revivePlayer(data.players[BLACK])
  };
  state.turn = data.turn;
  state.moveHistory = data.moveHistory ?? [];
  state.snapshots = [];
  state.pendingResurrection = data.pendingResurrection ? {
    color: data.pendingResurrection.color,
    square: { ...data.pendingResurrection.square },
    captured: revivePiece(data.pendingResurrection.captured),
    sacrificedId: data.pendingResurrection.sacrificedId
  } : null;
  state.winner = data.winner ?? null;
  state.draw = data.draw ?? false;
  state.message = data.message ?? "White to move";
  state.enPassantTarget = data.enPassantTarget ? { ...data.enPassantTarget } : null;
  return state;
}

function revivePlayer(data) {
  const player = new Player(data.color);
  player.resurrectionUsed = data.resurrectionUsed;
  player.fusionUsed = data.fusionUsed;
  player.captured = (data.captured ?? []).map(revivePiece);
  return player;
}

function revivePiece(data) {
  if (!data) return null;
  if (data.type === TYPES.FUSION) {
    return new FusionPiece(data.color, data.components, { id: data.id, hasMoved: data.hasMoved });
  }
  return new Piece(data.type, data.color, { id: data.id, hasMoved: data.hasMoved });
}

function dedupeMoves(moves) {
  const seen = new Set();
  return moves.filter((move) => {
    const key = `${move.from.x},${move.from.y}-${move.to.x},${move.to.y}-${move.enPassant}-${move.castle?.rookFrom.x ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

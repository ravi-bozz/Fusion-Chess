import test from "node:test";
import assert from "node:assert/strict";
import { ChessEngine, GameState, Piece, FusionPiece, Board, TYPES, WHITE, BLACK } from "../src/engine.js";

function emptyEngine(turn = WHITE) {
  const state = new GameState();
  state.board = new Board();
  state.turn = turn;
  state.players[WHITE].captured = [];
  state.players[BLACK].captured = [];
  state.moveHistory = [];
  state.snapshots = [];
  return new ChessEngine(state);
}

test("initial board has twenty legal white moves", () => {
  const engine = new ChessEngine();
  assert.equal(engine.allLegalMoves(WHITE).length, 20);
});

test("illegal moves are rejected", () => {
  const engine = new ChessEngine();
  assert.throws(() => engine.move({ x: 0, y: 6 }, { x: 0, y: 3 }), /Illegal move/);
});

test("castling moves king and rook", () => {
  const engine = emptyEngine();
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 7, y: 7 }, new Piece(TYPES.ROOK, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.move({ x: 4, y: 7 }, { x: 6, y: 7 });
  assert.equal(engine.state.board.get({ x: 6, y: 7 }).type, TYPES.KING);
  assert.equal(engine.state.board.get({ x: 5, y: 7 }).type, TYPES.ROOK);
});

test("en passant captures the advanced pawn", () => {
  const engine = emptyEngine(BLACK);
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.state.board.set({ x: 3, y: 3 }, new Piece(TYPES.PAWN, WHITE));
  engine.state.board.set({ x: 4, y: 1 }, new Piece(TYPES.PAWN, BLACK));
  engine.move({ x: 4, y: 1 }, { x: 4, y: 3 });
  engine.move({ x: 3, y: 3 }, { x: 4, y: 2 });
  assert.equal(engine.state.board.get({ x: 4, y: 3 }), null);
  assert.equal(engine.state.board.get({ x: 4, y: 2 }).color, WHITE);
});

test("pawn promotion creates selected piece", () => {
  const engine = emptyEngine();
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.state.board.set({ x: 0, y: 1 }, new Piece(TYPES.PAWN, WHITE));
  engine.move({ x: 0, y: 1 }, { x: 0, y: 0 }, TYPES.KNIGHT);
  assert.equal(engine.state.board.get({ x: 0, y: 0 }).type, TYPES.KNIGHT);
});

test("resurrection swap sacrifices capturer and changes ownership", () => {
  const engine = emptyEngine();
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.state.board.set({ x: 1, y: 7 }, new Piece(TYPES.KNIGHT, WHITE));
  engine.state.board.set({ x: 2, y: 5 }, new Piece(TYPES.BISHOP, BLACK));
  engine.move({ x: 1, y: 7 }, { x: 2, y: 5 });
  engine.activateResurrectionSwap();
  const piece = engine.state.board.get({ x: 2, y: 5 });
  assert.equal(piece.type, TYPES.BISHOP);
  assert.equal(piece.color, WHITE);
  assert.equal(engine.state.players[WHITE].resurrectionUsed, true);
});

test("fusion piece inherits both movement abilities", () => {
  const engine = emptyEngine();
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.state.board.set({ x: 0, y: 7 }, new Piece(TYPES.ROOK, WHITE));
  engine.state.board.set({ x: 1, y: 7 }, new Piece(TYPES.KNIGHT, WHITE));
  engine.fusionMove({ x: 0, y: 7 }, { x: 1, y: 7 }, { x: 0, y: 7 });
  const fusion = engine.state.board.get({ x: 0, y: 7 });
  assert.ok(fusion instanceof FusionPiece);
  engine.state.turn = WHITE;
  const targets = engine.legalMovesFrom({ x: 0, y: 7 }).map((move) => `${move.to.x},${move.to.y}`);
  assert.ok(targets.includes("0,0"));
  assert.ok(targets.includes("2,6"));
});

test("fusion cannot use a king", () => {
  const engine = emptyEngine();
  engine.state.board.set({ x: 4, y: 7 }, new Piece(TYPES.KING, WHITE));
  engine.state.board.set({ x: 4, y: 0 }, new Piece(TYPES.KING, BLACK));
  engine.state.board.set({ x: 0, y: 7 }, new Piece(TYPES.ROOK, WHITE));
  assert.throws(() => engine.fusionMove({ x: 4, y: 7 }, { x: 0, y: 7 }, { x: 0, y: 7 }), /Kings cannot/);
});

test("undo restores board and ability state", () => {
  const engine = new ChessEngine();
  engine.move({ x: 4, y: 6 }, { x: 4, y: 4 });
  assert.equal(engine.undo(), true);
  assert.equal(engine.state.board.get({ x: 4, y: 6 }).type, TYPES.PAWN);
  assert.equal(engine.state.turn, WHITE);
});

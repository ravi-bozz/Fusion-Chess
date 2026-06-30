import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ChessEngine, WHITE, BLACK } from "./src/engine.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const rooms = new Map();
const port = Number(process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  try {
    if (request.url.startsWith("/api/")) {
      await handleApi(request, response);
      return;
    }
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, error.statusCode ?? 500, { error: error.message || "Server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Fusion Chess remote server running at http://localhost:${port}`);
});

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const code = createRoomCode();
    const playerId = createPlayerId();
    rooms.set(code, {
      code,
      engine: new ChessEngine(),
      version: 1,
      players: { [WHITE]: playerId, [BLACK]: null },
      createdAt: Date.now()
    });
    sendRoom(response, rooms.get(code), WHITE, playerId);
    return;
  }

  if (parts[0] === "api" && parts[1] === "rooms" && parts[2]) {
    const room = rooms.get(parts[2].toUpperCase());
    if (!room) throw httpError(404, "Room not found");

    if (request.method === "POST" && parts.length === 4 && parts[3] === "join") {
      if (room.players[BLACK]) throw httpError(409, "Room already has two players");
      const playerId = createPlayerId();
      room.players[BLACK] = playerId;
      room.version += 1;
      sendRoom(response, room, BLACK, playerId);
      return;
    }

    if (request.method === "GET" && parts.length === 3) {
      const playerId = url.searchParams.get("playerId");
      sendRoom(response, room, colorForPlayer(room, playerId), playerId);
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[3] === "actions") {
      const body = await readJson(request);
      const color = colorForPlayer(room, body.playerId);
      if (!color) throw httpError(403, "You are not a player in this room");
      applyRemoteAction(room, color, body);
      room.version += 1;
      sendRoom(response, room, color, body.playerId);
      return;
    }
  }

  throw httpError(404, "Not found");
}

function applyRemoteAction(room, color, action) {
  const engine = room.engine;
  const pendingColor = engine.state.pendingResurrection?.color ?? null;
  const actorCanMove = pendingColor ? color === pendingColor : color === engine.state.turn;
  if (!actorCanMove) throw httpError(409, "It is not your turn");

  if (action.type === "move") {
    engine.move(action.from, action.to, action.promotion);
  } else if (action.type === "fusion") {
    engine.fusionMove(action.squareA, action.squareB, action.destination);
  } else if (action.type === "resurrect") {
    engine.activateResurrectionSwap();
  } else if (action.type === "declineResurrection") {
    engine.declineResurrectionSwap();
  } else {
    throw httpError(400, "Unknown action");
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(normalize(root))) throw httpError(403, "Forbidden");
  const data = await readFile(filePath);
  response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
  response.end(data);
}

function sendRoom(response, room, color, playerId) {
  sendJson(response, 200, {
    code: room.code,
    color,
    playerId,
    version: room.version,
    players: {
      white: !!room.players[WHITE],
      black: !!room.players[BLACK]
    },
    state: room.engine.state
  });
}

function colorForPlayer(room, playerId) {
  if (playerId && room.players[WHITE] === playerId) return WHITE;
  if (playerId && room.players[BLACK] === playerId) return BLACK;
  return null;
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function createPlayerId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

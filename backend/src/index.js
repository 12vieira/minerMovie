const express = require("express");
const Database = require("better-sqlite3");

const app = express();
app.use(express.json());

// Conecta/cria o banco
const db = new Database("./database.db");

// ==========================
// Criação das tabelas
// ==========================

// Tabela de salas
const createRoomsTable = `
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  winner_movie_id INTEGER
)
`;
db.prepare(createRoomsTable).run();

// Tabela de usuários
const createUsersTable = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL,
  room_id INTEGER NOT NULL,
  is_host INTEGER DEFAULT 0,
  FOREIGN KEY(room_id) REFERENCES rooms(id)
)
`;
db.prepare(createUsersTable).run();

// Tabela de filmes
const createMoviesTable = `
CREATE TABLE IF NOT EXISTS movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  year INTEGER,
  room_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  FOREIGN KEY(room_id) REFERENCES rooms(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
)
`;
db.prepare(createMoviesTable).run();

// ==========================
// Endpoint: Criar sala
// ==========================
app.post("/rooms", (req, res) => {
  const { hostName } = req.body;
  if (!hostName) {
    return res.status(400).json({ error: "hostName é obrigatório" });
  }

  // Gera código de 4 letras/números
  const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

  // Insere sala
  const stmt = db.prepare("INSERT INTO rooms (code) VALUES (?)");
  const info = stmt.run(roomCode);

  // Cria token do host
  const token = Math.random().toString(36).substring(2);

  // Insere host na tabela users
  const stmtUser = db.prepare(`
    INSERT INTO users (name, token, room_id, is_host)
    VALUES (?, ?, ?, 1)
  `);
  stmtUser.run(hostName, token, info.lastInsertRowid);

  res.json({
    roomCode,
    host: {
      name: hostName,
      token: token
    }
  });
});

// ==========================
// Endpoint: Entrar na sala
// ==========================
app.post("/rooms/join", (req, res) => {
  const { roomCode, displayName } = req.body;

  if (!roomCode || !displayName) {
    return res.status(400).json({ error: "roomCode e displayName são obrigatórios" });
  }

  // Verifica se a sala existe
  const room = db.prepare("SELECT * FROM rooms WHERE code = ?").get(roomCode);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  if (room.status === "finished") {
    return res.status(400).json({ error: "Sala já foi finalizada" });
  }

  // Gera token para o convidado
  const token = Math.random().toString(36).substring(2);

  // Insere usuário
  const stmt = db.prepare(`
    INSERT INTO users (name, token, room_id, is_host)
    VALUES (?, ?, ?, 0)
  `);
  stmt.run(displayName, token, room.id);

  res.json({
    name: displayName,
    token: token
  });
});

// ==========================
// Endpoint: Adicionar filme
// ==========================
app.post("/movies", (req, res) => {
  const { token, title, year } = req.body;

  if (!token || !title) {
    return res.status(400).json({ error: "token e title são obrigatórios" });
  }

  // Busca o usuário pelo token
  const user = db.prepare("SELECT * FROM users WHERE token = ?").get(token);
  if (!user) return res.status(401).json({ error: "Token inválido" });

  // Busca a sala do usuário
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  if (room.status === "finished") {
    return res.status(400).json({ error: "Sala já finalizada" });
  }

  // Insere o filme
  const stmt = db.prepare(`
    INSERT INTO movies (title, year, room_id, user_id)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(title, year || null, room.id, user.id);

  // Retorna a lista atualizada de filmes da sala
  const movies = db.prepare(`
    SELECT m.id, m.title, m.year, u.name as addedBy
    FROM movies m
    JOIN users u ON m.user_id = u.id
    WHERE m.room_id = ?
  `).all(room.id);

  res.json({ movies });
});

// ==========================
// Endpoint: Finalizar sala
// ==========================
// Finalizar sala e sortear filme
app.post("/rooms/finish", (req, res) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ error: "token é obrigatório" });

  // Busca o usuário pelo token
  const user = db.prepare("SELECT * FROM users WHERE token = ?").get(token);
  if (!user) return res.status(401).json({ error: "Token inválido" });

  // Verifica se é host
  if (user.is_host !== 1) return res.status(403).json({ error: "Apenas o host pode finalizar a sala" });

  // Busca a sala
  const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(user.room_id);
  if (!room) return res.status(404).json({ error: "Sala não encontrada" });

  if (room.status === "finished") return res.status(400).json({ error: "Sala já finalizada" });

  // Pega todos os filmes da sala
  const movies = db.prepare("SELECT * FROM movies WHERE room_id = ?").all(room.id);
  if (movies.length === 0) return res.status(400).json({ error: "Nenhum filme para sortear" });

  // Sorteia um filme aleatório
  const winner = movies[Math.floor(Math.random() * movies.length)];

  // Atualiza a sala
  db.prepare("UPDATE rooms SET status = 'finished', winner_movie_id = ? WHERE id = ?")
    .run(winner.id, room.id);

  // Retorna resultado
  res.json({
    message: "Sala finalizada!",
    winner: {
      id: winner.id,
      title: winner.title,
      year: winner.year
    }
  });
});



// ==========================
// Inicia servidor
// ==========================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

const FRONTEND_DIR = path.join(__dirname, "../frontend");

app.use(express.static(FRONTEND_DIR));

const DB_FILE = path.join(__dirname, "db.json");

// ======================================================
// BANCO DE DADOS
// ======================================================

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      usuarios: [],
      pacientes: [],
      triagens: [],
      consultas: [],
      internacoes: [],
      tv_chamada: null,
      tv_historico: []
    };
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  if (!db.usuarios) db.usuarios = [];
  if (!db.pacientes) db.pacientes = [];
  if (!db.triagens) db.triagens = [];
  if (!db.consultas) db.consultas = [];
  if (!db.internacoes) db.internacoes = [];
  if (!db.tv_chamada) db.tv_chamada = null;
  if (!db.tv_historico) db.tv_historico = [];

  return db;
}

function writeDB(data) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2)
  );
}

// ======================================================
// LOGIN
// ======================================================

app.post("/login", (req, res) => {
  const db = readDB();

  const user = db.usuarios.find(u =>
    u.usuario === req.body.usuario &&
    u.senha === req.body.senha
  );

  if (!user) {
    return res.status(401).json({
      erro: "Login inválido"
    });
  }

  res.json(user);
});

// ======================================================
// ATENDIMENTO
// ======================================================

app.post("/atendimento", (req, res) => {
  const db = readDB();

  const paciente = {
    id: Date.now(),
    nome: req.body.nome,
    cpf: req.body.cpf,
    tipo: req.body.tipo,
    status: "triagem",
    createdAt: new Date()
  };

  db.pacientes.push(paciente);

  writeDB(db);

  res.json(paciente);
});

// ======================================================
// LISTAR PACIENTES
// ======================================================

app.get("/pacientes", (req, res) => {
  const db = readDB();

  res.json(db.pacientes);
});

// ======================================================
// TRIAGEM
// ======================================================

app.post("/triagem", (req, res) => {
  const db = readDB();

  let risco = req.body.risco;

  const temperatura = Number(req.body.temperatura);

  if (temperatura >= 39) {
    risco = "vermelho";
  } else if (temperatura >= 38) {
    risco = "amarelo";
  } else if (!risco) {
    risco = "verde";
  }

  const triagem = {
    id: Date.now(),
    nome: req.body.nome,
    sintoma: req.body.sintoma,
    temperatura: req.body.temperatura,
    alergia: req.body.alergia,
    observacao: req.body.observacao,
    risco,
    status: "aguardando_medico",
    createdAt: new Date()
  };

  db.triagens.push(triagem);

  // Atualiza o paciente correspondente
  const paciente = db.pacientes.find(
    p => p.nome === req.body.nome
  );

  if (paciente) {
    paciente.status = "aguardando_medico";
  }

  writeDB(db);

  res.json(triagem);
});

// ======================================================
// LISTAR TRIAGENS
// ======================================================

app.get("/triagens", (req, res) => {
  const db = readDB();

  const triagens = db.triagens.filter(
    t =>
      t.status === "aguardando_medico" ||
      t.status === "em_atendimento"
  );

  res.json(triagens);
});

// ======================================================
// TV
// ======================================================

app.post("/tv/chamar", (req, res) => {
  const db = readDB();

  const chamada = {
    id: Date.now().toString(),
    localTipo: req.body.localTipo,
    localNumero: req.body.localNumero,
    paciente: req.body.paciente,
    hora: new Date().toLocaleTimeString(
      "pt-BR",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    )
  };

  db.tv_chamada = chamada;

  db.tv_historico.unshift(chamada);

  if (db.tv_historico.length > 5) {
    db.tv_historico.pop();
  }

  writeDB(db);

  res.json(chamada);
});

app.get("/tv/chamada", (req, res) => {
  const db = readDB();

  res.json({
    chamada: db.tv_chamada,
    historico: db.tv_historico
  });
});

// ======================================================
// LISTA DE MEDICAÇÕES
// ======================================================

app.get("/lista-medicacoes", (req, res) => {
  res.json([
    "Dipirona",
    "Paracetamol",
    "Ibuprofeno",
    "Amoxicilina",
    "Azitromicina",
    "Loratadina",
    "Omeprazol",
    "Buscopan",
    "Dramin",
    "Soro fisiológico"
  ]);
});

// ======================================================
// CONSULTA MÉDICA
// ======================================================

app.post("/consulta", (req, res) => {
  const db = readDB();

  const consulta = {
    id: Date.now(),
    paciente: req.body.paciente,
    diagnostico: req.body.diagnostico || "",
    medicacao: req.body.medicacao || "",
    obs: req.body.obs || "",
    tipoDestino: req.body.tipoDestino || "alta",
    createdAt: new Date()
  };

  db.consultas.push(consulta);

  // Atualiza paciente
  const paciente = db.pacientes.find(
    p => p.nome === req.body.paciente
  );

  if (paciente) {
    if (req.body.tipoDestino === "internacao") {
      paciente.status = "internado";
    } else if (req.body.medicacao) {
      paciente.status = "sala_medicacao";
    } else {
      paciente.status = "alta";
    }
  }

  // Atualiza triagem
  const triagem = db.triagens.find(
    t => t.nome === req.body.paciente &&
         t.status !== "alta"
  );

  if (triagem) {
    if (req.body.tipoDestino === "internacao") {
      triagem.status = "internado";
    } else if (req.body.medicacao) {
      triagem.status = "sala_medicacao";
    } else {
      triagem.status = "alta";
    }
  }

  writeDB(db);

  res.json(consulta);
});

// ======================================================
// LISTAR CONSULTAS
// ======================================================

app.get("/medicacoes", (req, res) => {
  const db = readDB();

  res.json(db.consultas);
});

// ======================================================
// INTERNAÇÃO
// ======================================================

// Criar internação
app.post("/internacoes", (req, res) => {
  const db = readDB();

  const internacao = {
    id: Date.now(),
    paciente: req.body.paciente,
    cpf: req.body.cpf || "",
    leito: req.body.leito || "",
    quarto: req.body.quarto || "",
    motivo: req.body.motivo || "",
    diagnostico: req.body.diagnostico || "",
    observacao: req.body.observacao || "",
    medicacao: req.body.medicacao || "",
    status: "internado",
    dataInternacao: new Date(),
    dataAlta: null
  };

  db.internacoes.push(internacao);

  // Atualiza paciente
  const paciente = db.pacientes.find(
    p => p.nome === req.body.paciente
  );

  if (paciente) {
    paciente.status = "internado";
  }

  // Atualiza triagem
  const triagem = db.triagens.find(
    t => t.nome === req.body.paciente &&
         t.status !== "alta"
  );

  if (triagem) {
    triagem.status = "internado";
  }

  writeDB(db);

  res.json(internacao);
});

// Listar somente pacientes internados
app.get("/internacoes", (req, res) => {
  const db = readDB();

  const internados = db.internacoes.filter(
    i => i.status === "internado"
  );

  res.json(internados);
});

// Buscar internação específica
app.get("/internacoes/:id", (req, res) => {
  const db = readDB();

  const internacao = db.internacoes.find(
    i => String(i.id) === String(req.params.id)
  );

  if (!internacao) {
    return res.status(404).json({
      erro: "Internação não encontrada"
    });
  }

  res.json(internacao);
});

// Dar alta ao paciente internado
app.post("/internacoes/:id/alta", (req, res) => {
  const db = readDB();

  const internacao = db.internacoes.find(
    i => String(i.id) === String(req.params.id)
  );

  if (!internacao) {
    return res.status(404).json({
      erro: "Internação não encontrada"
    });
  }

  internacao.status = "alta";
  internacao.dataAlta = new Date();

  // Atualiza paciente
  const paciente = db.pacientes.find(
    p => p.nome === internacao.paciente
  );

  if (paciente) {
    paciente.status = "alta";
  }

  // Atualiza triagem
  const triagem = db.triagens.find(
    t => t.nome === internacao.paciente
  );

  if (triagem) {
    triagem.status = "alta";
  }

  writeDB(db);

  res.json({
    sucesso: true,
    internacao
  });
});

// ======================================================
// ALTA DIRETA
// ======================================================

app.post("/alta", (req, res) => {
  const db = readDB();

  const nome = req.body.paciente;

  const paciente = db.pacientes.find(
    p => p.nome === nome
  );

  if (paciente) {
    paciente.status = "alta";
  }

  const triagem = db.triagens.find(
    t => t.nome === nome
  );

  if (triagem) {
    triagem.status = "alta";
  }

  writeDB(db);

  res.json({
    sucesso: true,
    paciente: nome
  });
});

// ======================================================
// PÁGINA INICIAL
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(
    path.join(FRONTEND_DIR, "index.html")
  );
});

// ======================================================
// SERVIDOR
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🏥 Hospital Pro rodando na porta ${PORT}`
  );
});

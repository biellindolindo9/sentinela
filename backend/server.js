```js
const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json());
app.use(cors());

// ===============================
// FRONTEND
// ===============================

const FRONTEND_DIR = path.join(__dirname, "../frontend");

app.use(express.static(FRONTEND_DIR));

// ===============================
// BANCO DE DADOS
// ===============================

const DB_FILE = path.join(__dirname, "db.json");

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      usuarios: [],
      pacientes: [],
      triagens: [],
      consultas: [],
      tv_chamada: null,
      tv_historico: []
    };
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  if (!db.usuarios) db.usuarios = [];
  if (!db.pacientes) db.pacientes = [];
  if (!db.triagens) db.triagens = [];
  if (!db.consultas) db.consultas = [];
  if (!db.tv_chamada) db.tv_chamada = null;
  if (!db.tv_historico) db.tv_historico = [];

  return db;
}

function writeDB(data) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// ===============================
// LOGIN
// ===============================

app.post("/login", (req, res) => {
  try {
    const db = readDB();

    const user = db.usuarios.find(
      u =>
        u.usuario === req.body.usuario &&
        u.senha === req.body.senha
    );

    if (!user) {
      return res.status(401).json({
        erro: "Login inválido"
      });
    }

    res.json(user);

  } catch (error) {
    console.error("Erro no login:", error);

    res.status(500).json({
      erro: "Erro interno no servidor"
    });
  }
});

// ===============================
// ATENDIMENTO - CADASTRAR PACIENTE
// ===============================

app.post("/atendimento", (req, res) => {
  try {
    const db = readDB();

    const paciente = {
      id: Date.now(),
      nome: req.body.nome,
      cpf: req.body.cpf,
      tipo: req.body.tipo,
      status: "triagem",
      createdAt: new Date().toISOString()
    };

    db.pacientes.push(paciente);

    writeDB(db);

    res.json(paciente);

  } catch (error) {
    console.error("Erro ao cadastrar paciente:", error);

    res.status(500).json({
      erro: "Erro ao cadastrar paciente"
    });
  }
});

// ===============================
// LISTAR PACIENTES
// ===============================

app.get("/pacientes", (req, res) => {
  try {
    const db = readDB();

    res.json(db.pacientes);

  } catch (error) {
    console.error("Erro ao listar pacientes:", error);

    res.status(500).json({
      erro: "Erro ao listar pacientes"
    });
  }
});

// ===============================
// TRIAGEM
// ===============================

app.post("/triagem", (req, res) => {
  try {
    const db = readDB();

    let risco = req.body.risco;

    const temperatura = Number(req.body.temperatura);

    if (!isNaN(temperatura)) {
      if (temperatura >= 39) {
        risco = "vermelho";
      } else if (temperatura >= 38) {
        risco = "amarelo";
      } else if (!risco) {
        risco = "verde";
      }
    }

    if (!risco) {
      risco = "verde";
    }

    const triagem = {
      id: Date.now(),
      nome: req.body.nome,
      sintoma: req.body.sintoma || req.body.sintomas || "",
      sintomas: req.body.sintomas || req.body.sintoma || "",
      temperatura: req.body.temperatura ?? req.body.temp ?? "",
      temp: req.body.temp ?? req.body.temperatura ?? "",
      alergia: req.body.alergia || "",
      observacao: req.body.observacao || "",
      risco,
      status: "aguardando_medico",
      createdAt: new Date().toISOString()
    };

    db.triagens.push(triagem);

    writeDB(db);

    res.json(triagem);

  } catch (error) {
    console.error("Erro na triagem:", error);

    res.status(500).json({
      erro: "Erro ao realizar triagem"
    });
  }
});

// ===============================
// LISTAR TRIAGENS
// ===============================

app.get("/triagens", (req, res) => {
  try {
    const db = readDB();

    res.json(db.triagens);

  } catch (error) {
    console.error("Erro ao listar triagens:", error);

    res.status(500).json({
      erro: "Erro ao listar triagens"
    });
  }
});

// ===============================
// MÍDIA INDOOR - CHAMAR PACIENTE
// ===============================

app.post("/tv/chamar", (req, res) => {
  try {
    const db = readDB();

    const chamada = {
      id: Date.now().toString(),
      localTipo: req.body.localTipo,
      localNumero: req.body.localNumero,
      paciente: req.body.paciente,
      hora: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      })
    };

    db.tv_chamada = chamada;

    db.tv_historico.unshift(chamada);

    if (db.tv_historico.length > 5) {
      db.tv_historico.pop();
    }

    writeDB(db);

    res.json(chamada);

  } catch (error) {
    console.error("Erro ao chamar paciente na TV:", error);

    res.status(500).json({
      erro: "Erro ao chamar paciente na TV"
    });
  }
});

// ===============================
// MÍDIA INDOOR - CONSULTAR CHAMADA
// ===============================

app.get("/tv/chamada", (req, res) => {
  try {
    const db = readDB();

    res.json({
      chamada: db.tv_chamada,
      historico: db.tv_historico
    });

  } catch (error) {
    console.error("Erro ao consultar TV:", error);

    res.status(500).json({
      erro: "Erro ao consultar chamada da TV"
    });
  }
});

// ===============================
// LISTA DE MEDICAÇÕES
// ===============================

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

// ===============================
// CONSULTA
// ===============================

app.post("/consulta", (req, res) => {
  try {
    const db = readDB();

    const consulta = {
      id: Date.now(),
      paciente: req.body.paciente,
      diagnostico: req.body.diagnostico,
      medicacao: req.body.medicacao,
      obs: req.body.obs,
      createdAt: new Date().toISOString()
    };

    db.consultas.push(consulta);

    writeDB(db);

    res.json(consulta);

  } catch (error) {
    console.error("Erro ao salvar consulta:", error);

    res.status(500).json({
      erro: "Erro ao salvar consulta"
    });
  }
});

// ===============================
// LISTAR MEDICAÇÕES / CONSULTAS
// ===============================

app.get("/medicacoes", (req, res) => {
  try {
    const db = readDB();

    res.json(db.consultas);

  } catch (error) {
    console.error("Erro ao listar medicações:", error);

    res.status(500).json({
      erro: "Erro ao listar medicações"
    });
  }
});

// ===============================
// ROTA PRINCIPAL
// ===============================

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// ===============================
// SERVIDOR
// ===============================

// O Render fornece a porta através de process.env.PORT.
// Localmente, caso ela não exista, usamos 3000.

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🏥 Hospital Pro rodando na porta ${PORT}`);
});
```

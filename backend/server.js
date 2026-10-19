const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(cors());

const FRONTEND_DIR = path.join(__dirname, "../frontend");
const DB_FILE = path.join(__dirname, "db.json");

app.use(express.static(FRONTEND_DIR));

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
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ======================================================
// CLASSIFICAÇÃO DE RISCO
// ======================================================

// Sinais de alerta que não devem aguardar uma resposta da IA.
// A equipe de saúde deve avaliar imediatamente esses casos.
function identificarSinalDeEmergencia(sintoma, observacao) {
  const texto = `${sintoma || ""} ${observacao || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const sinais = [
    "infarto",
    "suspeita de avc",
    "falta_ar_grave",
    "falta de ar grave",
    "hemorragia",
    "convulsao",
    "dor no peito intensa",
    "perda de consciencia",
    "inconsciente",
    "dificuldade grave para respirar",
    "lábios azulados",
    "labios azulados"
  ];

  return sinais.some(sinal => texto.includes(
    sinal.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  ));
}

function classificarPorRegras(sintoma, temperatura, observacao) {
  if (identificarSinalDeEmergencia(sintoma, observacao)) {
    return {
      risco: "vermelho",
      justificativa:
        "Foi identificado um possível sinal de emergência. A equipe deve avaliar o paciente imediatamente.",
      metodo: "regra de segurança"
    };
  }

  if (temperatura >= 39) {
    return {
      risco: "vermelho",
      justificativa:
        "A temperatura informada é elevada e requer avaliação rápida da equipe de saúde.",
      metodo: "regras de segurança; IA indisponível"
    };
  }

  if (
    temperatura >= 38 ||
    ["febre", "vomito", "diarreia", "falta_ar_moderada"].includes(sintoma)
  ) {
    return {
      risco: "amarelo",
      justificativa:
        "Os dados indicam necessidade de avaliação prioritária pela equipe de saúde.",
      metodo: "regras de segurança; IA indisponível"
    };
  }

  return {
    risco: "verde",
    justificativa:
      "As informações fornecidas não indicaram os sinais de alerta previstos nas regras automáticas. A avaliação profissional continua necessária.",
    metodo: "regras de segurança; IA indisponível"
  };
}

// A IA é usada como apoio à decisão, nunca como diagnóstico definitivo.
app.post("/classificar-risco", async (req, res) => {
  const sintoma = String(req.body.sintoma || "").trim();
  const observacao = String(req.body.observacao || "").trim();
  const temperatura = Number(req.body.temperatura);

  if (
    !sintoma ||
    !Number.isFinite(temperatura) ||
    temperatura < 30 ||
    temperatura > 45
  ) {
    return res.status(400).json({
      erro: "Informe o sintoma e uma temperatura válida."
    });
  }

  // Não esperar pela IA diante de possíveis sinais de emergência.
  if (identificarSinalDeEmergencia(sintoma, observacao)) {
    return res.json({
      ...classificarPorRegras(sintoma, temperatura, observacao)
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;

  // Sem chave configurada, o sistema usa regras de segurança
  // e deixa explícito que a IA não foi utilizada.
  if (!apiKey) {
    return res.json(
      classificarPorRegras(sintoma, temperatura, observacao)
    );
  }

  try {
    const resposta = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions: `
Você é um sistema de apoio à classificação inicial de risco em um
protótipo hospitalar. Não faça diagnóstico e não recomende medicamentos.
Use somente os sintomas, a temperatura e as observações informadas.
Se houver dúvida ou informação insuficiente, escolha amarelo para
avaliação profissional prioritária. Nunca classifique como verde um
caso que possa indicar risco relevante.
As cores são apenas uma sugestão para revisão de um profissional:
vermelho = possível emergência; amarelo = avaliação prioritária;
verde = menor prioridade aparente, sem garantir ausência de risco.
Responda exclusivamente em JSON válido com:
{"risco":"vermelho|amarelo|verde","justificativa":"explicação curta em português"}.
Não inclua nomes, dados pessoais, diagnósticos definitivos ou tratamento.
        `.trim(),
        input: JSON.stringify({
          sintoma,
          temperatura,
          observacao
        }),
        text: {
          format: {
            type: "json_object"
          }
        }
      })
    });

    if (!resposta.ok) {
      const detalhe = await resposta.text();
      console.error("Falha na API de IA:", resposta.status, detalhe);

      // Se a IA falhar, usar as regras locais e informar o método.
      return res.json(
        classificarPorRegras(sintoma, temperatura, observacao)
      );
    }

    const dados = await resposta.json();
    const textoSaida = dados.output_text;

    if (!textoSaida) {
      return res.json(
        classificarPorRegras(sintoma, temperatura, observacao)
      );
    }

    const classificacao = JSON.parse(textoSaida);
    const riscosPermitidos = ["vermelho", "amarelo", "verde"];

    if (!riscosPermitidos.includes(classificacao.risco)) {
      return res.json(
        classificarPorRegras(sintoma, temperatura, observacao)
      );
    }

    // A temperatura elevada continua sendo um alerta de segurança.
    // A IA não pode reduzir a prioridade estabelecida por essa regra.
    const regraTemperatura =
      classificarPorRegras(sintoma, temperatura, observacao);

    if (
      regraTemperatura.risco === "vermelho" ||
      (regraTemperatura.risco === "amarelo" &&
        classificacao.risco === "verde")
    ) {
      return res.json({
        ...regraTemperatura,
        metodo: "IA com regra de segurança"
      });
    }

    return res.json({
      risco: classificacao.risco,
      justificativa: String(
        classificacao.justificativa ||
        "Sugestão automática que precisa de revisão profissional."
      ).slice(0, 500),
      metodo: "IA (apoio à decisão; requer validação profissional)"
    });

  } catch (erro) {
    console.error("Erro ao classificar risco:", erro);

    return res.json(
      classificarPorRegras(sintoma, temperatura, observacao)
    );
  }
});

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
    return res.status(401).json({ erro: "Login inválido" });
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
// SALVAR TRIAGEM
// ======================================================

app.post("/triagem", (req, res) => {
  const db = readDB();

  const nome = String(req.body.nome || "").trim();
  const sintoma = String(req.body.sintoma || "").trim();
  const temperatura = Number(req.body.temperatura);
  const risco = String(req.body.risco || "").toLowerCase();

  if (!nome || !sintoma || !Number.isFinite(temperatura)) {
    return res.status(400).json({
      erro: "Nome, sintoma e temperatura são obrigatórios."
    });
  }

  if (!["vermelho", "amarelo", "verde"].includes(risco)) {
    return res.status(400).json({
      erro: "Classificação de risco inválida."
    });
  }

  const triagem = {
    id: Date.now(),
    pacienteId: req.body.pacienteId || null,
    nome,
    sintoma,
    temperatura,
    alergia: req.body.alergia || "",
    observacao: req.body.observacao || "",
    risco,
    justificativaRisco: req.body.justificativaRisco || "",
    metodoClassificacao: req.body.metodoClassificacao || "não informado",
    status: "aguardando_medico",
    createdAt: new Date()
  };

  db.triagens.push(triagem);

  // Prioriza o ID para não atualizar outro paciente com o mesmo nome.
  let paciente = null;

  if (req.body.pacienteId) {
    paciente = db.pacientes.find(
      p => String(p.id) === String(req.body.pacienteId)
    );
  }

  if (!paciente) {
    paciente = db.pacientes.find(p => p.nome === nome);
  }

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

  const triagens = db.triagens.filter(t =>
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

  const triagem = db.triagens.find(
    t => t.nome === req.body.paciente && t.status !== "alta"
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
// LISTAR CONSULTAS / MEDICAÇÕES
// ======================================================

app.get("/medicacoes", (req, res) => {
  const db = readDB();
  res.json(db.consultas);
});

// ======================================================
// INTERNAÇÃO
// ======================================================

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

  const paciente = db.pacientes.find(
    p => p.nome === req.body.paciente
  );

  if (paciente) paciente.status = "internado";

  const triagem = db.triagens.find(
    t => t.nome === req.body.paciente && t.status !== "alta"
  );

  if (triagem) triagem.status = "internado";

  writeDB(db);
  res.json(internacao);
});

app.get("/internacoes", (req, res) => {
  const db = readDB();

  res.json(
    db.internacoes.filter(i => i.status === "internado")
  );
});

app.get("/internacoes/:id", (req, res) => {
  const db = readDB();

  const internacao = db.internacoes.find(
    i => String(i.id) === String(req.params.id)
  );

  if (!internacao) {
    return res.status(404).json({ erro: "Internação não encontrada" });
  }

  res.json(internacao);
});

app.post("/internacoes/:id/alta", (req, res) => {
  const db = readDB();

  const internacao = db.internacoes.find(
    i => String(i.id) === String(req.params.id)
  );

  if (!internacao) {
    return res.status(404).json({ erro: "Internação não encontrada" });
  }

  internacao.status = "alta";
  internacao.dataAlta = new Date();

  const paciente = db.pacientes.find(
    p => p.nome === internacao.paciente
  );

  if (paciente) paciente.status = "alta";

  const triagem = db.triagens.find(
    t => t.nome === internacao.paciente
  );

  if (triagem) triagem.status = "alta";

  writeDB(db);
  res.json({ sucesso: true, internacao });
});

// ======================================================
// ALTA DIRETA
// ======================================================

app.post("/alta", (req, res) => {
  const db = readDB();
  const nome = req.body.paciente;

  const paciente = db.pacientes.find(p => p.nome === nome);
  if (paciente) paciente.status = "alta";

  const triagem = db.triagens.find(t => t.nome === nome);
  if (triagem) triagem.status = "alta";

  writeDB(db);
  res.json({ sucesso: true, paciente: nome });
});

// ======================================================
// PÁGINA INICIAL
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// ======================================================
// SERVIDOR
// ======================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🏥 Sentinela rodando na porta ${PORT}`);
});

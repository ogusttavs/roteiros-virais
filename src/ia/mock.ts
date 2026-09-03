/**
 * Modo AI_PROVIDER=mock: uma resposta determinada pela entrada, por tarefa,
 * sem chamar a API (custo zero). Todo teste automatizado roda em mock;
 * so scripts/ia-fumaca.ts chama a API de verdade. A saida passa pelo
 * mesmo schema Zod que a chamada real usaria, entao um mock mal formado
 * quebra o teste que o usa, nao passa disfarcado.
 */
import type { ParametrosGeracao } from "./cliente";
import type { ResultadoGeracao, TarefaIA } from "./tipos";

const USO_ZERO = {
  tokensEntrada: 0,
  tokensSaida: 0,
  tokensCacheLeitura: 0,
  tokensCacheEscrita: 0,
};

export async function gerarMock<T>(params: ParametrosGeracao<T>): Promise<ResultadoGeracao<T>> {
  const dados = params.schema.parse(construirSaidaMock(params.tarefa, params.entrada));
  return { dados, modelo: "mock", ...USO_ZERO };
}

/**
 * Exportada para src/ia/lote.ts reusar o mesmo mock por tarefa no lote,
 * em vez de um objeto generico que so passaria em schema com tudo opcional.
 */
export function construirSaidaMock(tarefa: TarefaIA, entrada: string): unknown {
  switch (tarefa) {
    case "avaliarResposta":
      return mockAvaliarResposta(entrada);
    case "compilarPerfil":
      return mockCompilarPerfil(entrada);
    case "avaliarTema":
      return mockAvaliarTema(entrada);
    case "roteiro":
      return mockRoteiro(entrada);
    case "verificarTexto":
      return mockVerificarTexto(entrada);
    case "temasDoDia":
      return mockTemasDoDia(entrada);
    case "extrairVideo":
      return mockExtrairVideo(entrada);
    case "analisarVisual":
      return mockAnalisarVisual();
    case "modeloNicho":
      return mockModeloNicho(entrada);
    default: {
      const _exaustivo: never = tarefa;
      throw new Error(`tarefa sem mock: ${String(_exaustivo)}`);
    }
  }
}

/** Extrai o texto depois de um rotulo tipo "Resposta do cliente: X" da entrada montada. */
function extrairCampo(entrada: string, rotulo: string): string {
  const linha = entrada.split("\n").find((l) => l.startsWith(rotulo));
  return linha ? linha.slice(rotulo.length).trim() : "";
}

function contarOcorrencias(texto: string, padrao: RegExp): number {
  return texto.match(padrao)?.length ?? 0;
}

/**
 * A nota cresce com o tamanho e a concretude da resposta: numero, nome
 * proprio (palavra maiuscula fora do inicio da frase) e frase entre aspas.
 */
function mockAvaliarResposta(entrada: string) {
  const resposta = extrairCampo(entrada, "Resposta do cliente:");
  const tamanho = resposta.trim().length;

  let nota = Math.min(5, tamanho / 20);
  if (/\d/.test(resposta)) nota += 1.5;
  if (/["“][^"”]+["”]/.test(resposta)) nota += 1.5;
  if (/[a-záéíóúâêôãõç]\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+/.test(resposta)) nota += 1;
  nota = Math.max(0, Math.min(10, Math.round(nota * 10) / 10));

  const concreto = nota >= 7;
  return {
    nota,
    bom: concreto ? "A resposta tem exemplo concreto." : "A resposta e curta ou generica.",
    melhorar: concreto
      ? "Poderia trazer mais um numero ou exemplo."
      : "Falta um exemplo real, com numero ou nome.",
    como: "Escreva como se fosse para alguem que nunca ouviu falar do seu ramo, com um caso real.",
    exemplo:
      "Eu vendo o meu produto principal por um preco fixo, e mostro para o cliente exatamente o que ele leva junto, com um exemplo real de quem comprou essa semana.",
    impacto: "Uma resposta mais concreta gera um roteiro mais parecido com voce.",
  };
}

function mockCompilarPerfil(entrada: string) {
  const primeiraLinha = entrada.split("\n")[0] ?? "";
  return {
    fatos: {
      oQueVende: primeiraLinha || "servico principal do negocio",
      preco: "faixa de preco informada no briefing",
      clienteIdeal: "pessoa descrita no briefing",
      medos: ["medo ou duvida antes de comprar"],
      frasesDaFala: ["frase real que o cliente disse que fala"],
      proibicoes: [],
      cenasFilmaveis: ["cena do dia a dia do negocio"],
      concorrentes: [],
      perfisAdmirados: [],
    },
    resumo: `Perfil compilado a partir do briefing. ${primeiraLinha}`.trim(),
  };
}

const PILAR_PADRAO = { nota: 6, justificativa: "avaliacao simulada, sem chamada de IA" };

function mockAvaliarTema(entrada: string) {
  const evidencias = contarOcorrencias(entrada, /\bid \d+:/g);
  const notaViralizar = evidencias >= 3 ? 9 : evidencias >= 1 ? 7 : 4;
  const pilares = {
    viralizar: {
      nota: notaViralizar,
      justificativa: `${evidencias} video(s) de evidencia recebido(s)`,
    },
    gerarCliente: PILAR_PADRAO,
    encaixe: PILAR_PADRAO,
    novidade: PILAR_PADRAO,
    facilidade: PILAR_PADRAO,
  };
  const nota =
    Object.values(pilares).reduce((soma, p) => soma + p.nota, 0) / Object.values(pilares).length;

  return {
    pilares,
    nota: Math.round(nota * 10) / 10,
    recomendacao:
      evidencias > 0 ? "tema com evidencia suficiente" : "ajustar para um angulo com evidencia",
    anguloSugerido: evidencias > 0 ? null : "angulo vizinho simulado",
    evidencias: extrairIds(entrada),
  };
}

function extrairIds(entrada: string): number[] {
  const encontrados = entrada.match(/\bid (\d+):/g) ?? [];
  return encontrados.map((m) => Number(m.replace(/\D/g, "")));
}

function mockRoteiro(entrada: string) {
  const tema = extrairCampo(entrada, "Tema escolhido:") || "tema simulado";
  const ids = extrairIds(entrada);

  return {
    titulo: tema,
    duracaoS: 40,
    gancho: `os 3 primeiros segundos sobre ${tema}`,
    corpo: `Explicacao direta sobre ${tema}, com uma cena real do negocio.`,
    fechamento: "resumo do que foi mostrado",
    chamadaFinal: "comenta se voce ja passou por isso",
    cenas: [{ momento: "abertura", oQueFazer: "mostrar o local de verdade" }],
    ondeGravar: "no proprio local do negocio, com o cliente aparecendo",
    edicao: {
      textoNaTela: [{ quando: "abertura", oQue: tema, onde: "topo da tela" }],
      ritmoDeCorte: "moderado",
      recursos: [],
      audio: null,
      referencia:
        ids[0] !== undefined ? { videoId: ids[0], segundo: 4, oQueOlhar: "o gancho" } : null,
    },
    evidencias: ids,
  };
}

function mockVerificarTexto(entrada: string) {
  const texto = extrairCampo(entrada, "Texto a conferir:") || entrada;
  const gritando = /!{2,}/.test(texto) || texto === texto.toUpperCase();
  return {
    aprovado: !gritando,
    motivo: gritando ? "tom exagerado para o texto de tela" : null,
  };
}

function mockTemasDoDia(entrada: string) {
  const ids = extrairIds(entrada);
  const puxaPara = ["alcance", "engajamento", "conversao"] as const;

  return {
    temas: [0, 1, 2].map((i) => ({
      titulo: `tema simulado ${i + 1}`,
      descricao: "tema derivado dos videos que estao subindo hoje",
      porQue: "esta subindo mais rapido que o normal da conta",
      evidencias: ids.length > 0 ? [ids[i % ids.length]] : [],
      puxaPara: puxaPara[i],
    })),
  };
}

function mockExtrairVideo(entrada: string) {
  const titulo = extrairCampo(entrada, "Titulo:") || "video simulado";
  const nichoLinha = extrairCampo(entrada, "Nicho:");
  const termos = (nichoLinha.match(/termos: ([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const textoBusca = entrada.toLowerCase();
  const pertenceAoNicho = termos.length === 0 || termos.some((termo) => textoBusca.includes(termo));

  return {
    assunto: titulo,
    gancho: `abertura sobre ${titulo}`,
    estrutura: "gancho, explicacao, demonstracao, fechamento",
    fechamento: "resumo do que foi mostrado",
    chamadaFinal: "comenta se voce ja passou por isso",
    formato: "fala_para_camera" as const,
    porQueFuncionou: "mostra o problema acontecendo de verdade",
    etiquetas: titulo
      .toLowerCase()
      .split(" ")
      .filter((palavra) => palavra.length > 3)
      .slice(0, 4),
    pertenceAoNicho,
    motivoNicho: pertenceAoNicho
      ? "a transcricao cita termo do nicho"
      : "a transcricao nao cita nenhum termo do nicho",
  };
}

function mockAnalisarVisual() {
  return {
    falaParaCamera: true,
    textoNaTela: [{ quando: "abertura", onde: "topo", oQue: "texto simulado" }],
    cenario: "ambiente do negocio",
    ritmoDeCorte: "moderado",
    recursos: [],
    momentoChave: { segundo: 4, oQue: "o recurso principal aparece" },
  };
}

function mockModeloNicho(entrada: string) {
  const videos = contarOcorrencias(entrada, /\bid \d+:/g);
  return {
    resumo: `Modelo simulado a partir de ${videos} video(s) de evidencia.`,
    ganchos: [
      { tipo: "pergunta direta", exemplo: "voce ja passou por isso", frequencia: "frequente" },
    ],
    duracaoTipicaS: { min: 20, max: 60 },
    estruturas: ["gancho, explicacao, demonstracao, fechamento"],
    fechamentos: ["resumo do que foi mostrado"],
    chamadasFinais: ["comenta se voce ja passou por isso"],
    formatos: [{ formato: "fala_para_camera", participacao: "maioria" }],
    edicao: {
      textoNaTela: "titulo curto no topo",
      ritmoDeCorte: "moderado",
      recursos: [],
      audio: null,
    },
    assuntosQuentes: ["assunto simulado"],
  };
}

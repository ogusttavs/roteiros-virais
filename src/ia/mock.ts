/**
 * Modo AI_PROVIDER=mock: uma resposta determinada pela entrada, por tarefa,
 * sem chamar a API (custo zero). Todo teste automatizado roda em mock;
 * so scripts/ia-fumaca.ts chama a API de verdade. A saida passa pelo
 * mesmo schema Zod que a chamada real usaria, entao um mock mal formado
 * quebra o teste que o usa, não passa disfarcado.
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
  const dados = params.schema.parse(construirSaidaMock(params.tarefa, params.entrada, params.sistemaEstavel));
  return { dados, modelo: "mock", ...USO_ZERO };
}

/**
 * Exportada para src/ia/lote.ts reusar o mesmo mock por tarefa no lote,
 * em vez de um objeto generico que so passaria em schema com tudo opcional.
 * `sistemaEstavel` e opcional (so "roteiro" usa, para saber o formato,
 * V9c, item 2: a entrada não diz "story" em lugar nenhum, so o sistema).
 */
export function construirSaidaMock(tarefa: TarefaIA, entrada: string, sistemaEstavel = ""): unknown {
  switch (tarefa) {
    case "avaliarResposta":
      return mockAvaliarResposta(entrada);
    case "compilarPerfil":
      return mockCompilarPerfil(entrada, sistemaEstavel);
    case "avaliarTema":
      return mockAvaliarTema(entrada);
    case "roteiro":
      return mockRoteiro(entrada, sistemaEstavel);
    case "verificarTexto":
      return mockVerificarTexto(entrada);
    case "temasDoDia":
      return mockTemasDoDia(entrada);
    case "extrairVideo":
      return mockExtrairVideo(entrada);
    case "extrairVideoSemFala":
      return mockExtrairVideoSemFala(entrada);
    case "analisarVisual":
      return mockAnalisarVisual();
    case "modeloNicho":
      return mockModeloNicho(entrada);
    case "filtrarNoticias":
      return mockFiltrarNoticias(entrada);
    case "aprenderCliente":
      return mockAprenderCliente(entrada);
    case "classificarAbertura":
      return mockClassificarAbertura(entrada);
    case "lerMomento":
      return mockLerMomento(entrada);
    case "lerAgenda":
      return mockLerAgenda(entrada);
    case "planejarDia":
      return mockPlanejarDia(entrada);
    case "sugerirContasDoSetor":
      return mockSugerirContasDoSetor(entrada);
    case "classificarContaDoSetor":
      return mockClassificarContaDoSetor(entrada);
    case "organizarFalaBriefing":
      return mockOrganizarFalaBriefing(entrada);
    case "filtrarEvidenciaPorMarca":
      return mockFiltrarEvidenciaPorMarca(entrada);
    case "aindaValeRoteiro":
      return mockAindaValeRoteiro(entrada);
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
    impacto: "Uma resposta mais concreta gera um roteiro mais parecido com você.",
  };
}

/**
 * P1, item 4: `montarSistemaEstavel(tipo)` tem um texto proprio para pessoa
 * ("uma pessoa que vai gravar", nunca "um dono de pequeno negocio"); o mock
 * le isso do mesmo jeito que `mockRoteiro` le "R-IG-STORY-01" no sistema
 * estavel para saber o formato, sem precisar de outro parametro na tarefa.
 */
function mockCompilarPerfil(entrada: string, sistemaEstavel: string) {
  const primeiraLinha = entrada.split("\n")[0] ?? "";
  const ehPessoa = sistemaEstavel.includes("uma pessoa que vai gravar");
  return {
    fatos: {
      oQueVende: primeiraLinha || (ehPessoa ? "do que ela quer ser lembrada" : "servico principal do negocio"),
      preco: ehPessoa ? "os negocios ou parcerias que ela oferece" : "faixa de preco informada no briefing",
      clienteIdeal: ehPessoa ? "tipo de pessoa que ela quer que a siga" : "pessoa descrita no briefing",
      medos: [ehPessoa ? "o que o publico quer ver ou perguntar" : "medo ou duvida antes de comprar"],
      frasesDaFala: ["frase real que o cliente disse que fala"],
      proibicoes: [],
      cenasFilmaveis: [ehPessoa ? "cena da semana dela" : "cena do dia a dia do negocio"],
      concorrentes: [],
      perfisAdmirados: [],
      ...(ehPessoa
        ? { historia: "episodio da virada simulado", posicionamentos: ["opiniao simulada que gera conversa"] }
        : {}),
    },
    resumo: `Perfil compilado a partir do briefing. ${primeiraLinha}`.trim(),
  };
}

const PILAR_PADRAO = { nota: 6, justificativa: "avaliacao simulada, sem chamada de IA" };

/**
 * Gatilho de teste (revisao do PR #17, etapa 12, ajuste 1): o mock sempre
 * ecoa os ids que recebeu, entao não ha jeito natural de simular a IA
 * inventando evidencia (o defeito que o Fable achou rodando com chave
 * real). Um tema com esta frase faz o mock devolver um id que nunca
 * existiu na entrada, para o teste de integracao confirmar que
 * `evidenciasFornecidas` (agora também em `avaliarTema`) reprova isso.
 */
const MARCADOR_EVIDENCIA_INVENTADA = "invente uma evidencia que não existe";

/**
 * Gatilho de teste (V5b, item 4): com `PILAR_PADRAO` fixo em 6, a media dos
 * cinco pilares nunca passa de 6,6 mesmo com evidencia forte (9 em
 * "viralizar"), entao não ha texto natural que leve o mock ao estado
 * "naMeta" (nota >= 9). Um tema com esta frase faz todos os pilares
 * pontuarem alto, para o e2e de Tema livre exercitar esse estado de verdade.
 */
const MARCADOR_NOTA_ALTA = "aprova este tema de teste sem ressalva";

function mockAvaliarTema(entrada: string) {
  const tema = extrairCampo(entrada, "Tema proposto:");
  const notaAlta = tema.includes(MARCADOR_NOTA_ALTA);
  const evidencias = contarOcorrencias(entrada, /\bid \d+:/g);
  const notaViralizar = notaAlta ? 9.4 : evidencias >= 3 ? 9 : evidencias >= 1 ? 7 : 4;
  const pilarPadrao = notaAlta ? { ...PILAR_PADRAO, nota: 9.4 } : PILAR_PADRAO;
  const pilares = {
    viralizar: {
      nota: notaViralizar,
      justificativa: `${evidencias} video(s) de evidencia recebido(s)`,
    },
    gerarCliente: pilarPadrao,
    encaixe: pilarPadrao,
    novidade: pilarPadrao,
    facilidade: pilarPadrao,
  };
  const nota =
    Object.values(pilares).reduce((soma, p) => soma + p.nota, 0) / Object.values(pilares).length;
  const notaArredondada = Math.round(nota * 10) / 10;
  const aprovado = notaArredondada >= 9;
  const idsCitados = extrairIds(entrada);

  return {
    pilares,
    nota: notaArredondada,
    recomendacao: aprovado ? "tema com evidencia suficiente" : "ajustar para um angulo com evidencia",
    anguloSugerido: aprovado ? null : "angulo vizinho simulado",
    evidencias: tema.includes(MARCADOR_EVIDENCIA_INVENTADA) ? [...idsCitados, 999999] : idsCitados,
  };
}

function extrairIds(entrada: string): number[] {
  const encontrados = entrada.match(/\bid (\d+):/g) ?? [];
  return encontrados.map((m) => Number(m.replace(/\D/g, "")));
}

/**
 * "reprovou a versão anterior" só aparece na entrada quando
 * `anguloParaEvitar` está presente (`prompts/roteiro.ts`, `montarEntrada`,
 * E27 parte 1, item 3; antes "pediu outro ângulo"): um pedido de verdade de
 * ângulo diferente, não só "não repita o histórico". Sem isto, o mock
 * devolvia o mesmo gancho de sempre para o mesmo tema, e a reescrita
 * colidia com o próprio verificador local novo (achado do primeiro uso no
 * iPad, item 3, `verificarLocalmente`, ganchosRecentes): a v2 da série
 * repetia o gancho da v1, que é um roteiro recente do mesmo cliente.
 */
/**
 * "Muito longo" só aparece na entrada quando é um dos motivos da
 * reprovação (E27, parte 1, item 4): o mock devolve uma duração menor que
 * o padrão de 40s, para o roteiro reescrito conseguir passar na checagem
 * do verificador (a nova versão tem de ficar mais curta que a reprovada).
 */
const TIPOS_ABERTURA_MOCK = [
  "cena",
  "resultado",
  "objeto",
  "fala_direta",
  "numero",
  "contraste",
  "pergunta",
  "outro",
] as const;

/** Uma primeira palavra distinta por tipo (V4, item 7a): cinco tipos diferentes viram cinco ganchos com primeira palavra diferente, sem precisar de chave real para provar isso. */
const PRIMEIRA_PALAVRA_MOCK_POR_TIPO: Record<(typeof TIPOS_ABERTURA_MOCK)[number], string> = {
  cena: "veja",
  resultado: "pronto",
  objeto: "aqui",
  fala_direta: "escuta",
  numero: "3",
  contraste: "antes",
  pergunta: "sera",
  outro: "olha",
};

/**
 * `prompts/roteiro.ts`, `formatarInstrucaoAbertura` (V4, item 3): quando o
 * serviço instrui um tipo concreto, a entrada tem "Tipo de abertura: X,";
 * quando deixa livre, tem "Tipo de abertura: livre" e, às vezes, "menos
 * estes: a, b" com os tipos a evitar. O mock obedece do mesmo jeito que um
 * modelo de verdade deveria: usa o tipo instruído, ou escolhe o primeiro
 * tipo fora da lista de proibidos.
 */
function tipoAberturaEscolhidoPeloMock(entrada: string): (typeof TIPOS_ABERTURA_MOCK)[number] {
  const instruido = entrada.match(/Tipo de abertura: (\w+),/)?.[1];
  if (instruido && (TIPOS_ABERTURA_MOCK as readonly string[]).includes(instruido)) {
    return instruido as (typeof TIPOS_ABERTURA_MOCK)[number];
  }
  const proibidosBrutos = entrada.match(/deste cliente: ([^.]+)\./)?.[1] ?? "";
  const proibidos = proibidosBrutos.split(",").map((t) => t.trim());
  return TIPOS_ABERTURA_MOCK.find((t) => !proibidos.includes(t)) ?? "outro";
}

/**
 * V9a, item 1: sem "Tema escolhido:" na entrada (`montarEntrada` pula essa
 * linha com momento), o tema simulado vem de "O que está acontecendo:",
 * para o mock não ficar sempre igual em todo caso de momento; `temaCurto`
 * só sai preenchido aqui, mesma regra do prompt de verdade (regra dura 10).
 */
/**
 * V9c, item 2: 3 cartões determinísticos, o primeiro citando o tema (R-IG-STORY-02), o do meio
 * com a única figurinha (R-IG-STORY-04) e o último fechando com um verbo de resposta, sem
 * "segue" (R-IG-STORY-01 e 07). `porQueAssim` cita duas regras reais, como o modelo de verdade faria.
 */
function mockCartoesStory(tema: string, reprovado: boolean) {
  return {
    cartoes: [
      {
        oQueFalar: reprovado ? `Outro jeito de contar sobre ${tema}` : `Hoje eu vou te contar sobre ${tema}`,
        oQueMostrar: "o local do negocio de verdade",
        textoNaTela: tema,
        figurinha: "nenhuma" as const,
      },
      {
        oQueFalar: "aqui a gente lida com isso toda semana, e você já deve ter passado por isso também",
        oQueMostrar: "o processo acontecendo",
        textoNaTela: "e você, já passou por isso",
        figurinha: "perguntas" as const,
      },
      {
        oQueFalar: "manda a sua duvida aqui na caixinha que eu respondo",
        oQueMostrar: "convite final, olhando para a camera",
        textoNaTela: "manda sua duvida",
        figurinha: "nenhuma" as const,
      },
    ],
    porQueAssim: [
      { regra: "R-IG-STORY-02", motivo: "o primeiro cartao já cita o assunto para quem já segue continuar vendo" },
      { regra: "R-IG-STORY-04", motivo: "a caixinha de perguntas pede interacao de quem esta vendo" },
    ],
  };
}

/** M4, item 4: cenas sem fala, mesma estrutura de `mockCartoesStory`, com `oQueFalar` sempre vazio e legenda do post. */
function mockCenasSemFala(tema: string, reprovado: boolean) {
  return {
    cartoes: [
      { oQueFalar: "", oQueMostrar: "o local do negocio de verdade, sem ninguem falando", textoNaTela: tema, figurinha: "nenhuma" as const },
      {
        oQueFalar: "",
        oQueMostrar: reprovado ? "outro angulo do processo acontecendo" : "o processo acontecendo",
        textoNaTela: "e você, já passou por isso",
        figurinha: "nenhuma" as const,
      },
      { oQueFalar: "", oQueMostrar: "o resultado final em destaque", textoNaTela: "chama no direct", figurinha: "nenhuma" as const },
    ],
    porQueAssim: [],
    legenda: `${tema}. Manda a sua duvida aqui na legenda ou no direct.`,
  };
}

/**
 * R1, item 2: o Reels falado também cita regra de plataforma agora, como o Story já fazia; a
 * rede vem do bloco "Siga as regras do <rede> à risca" que `montarSistemaEstavel` monta, achada
 * aqui pela marca única da primeira regra de cada conjunto (mesma técnica de `ehStory` abaixo).
 */
function mockPorQueAssimReels(sistemaEstavel: string): { regra: string; motivo: string }[] {
  if (sistemaEstavel.includes("R-TT-VIDEO-01")) {
    return [{ regra: "R-TT-VIDEO-01", motivo: "o vídeo já mostra o problema nos primeiros segundos" }];
  }
  if (sistemaEstavel.includes("R-YT-SHORT-01")) {
    return [{ regra: "R-YT-SHORT-01", motivo: "o vídeo fica dentro do tempo curto que este nicho pede" }];
  }
  if (sistemaEstavel.includes("R-IG-REEL-01")) {
    return [{ regra: "R-IG-REEL-01", motivo: "o gancho já mostra o assunto nos primeiros segundos" }];
  }
  return [];
}

function mockRoteiro(entrada: string, sistemaEstavel: string) {
  const ehMomento = entrada.includes("O momento que a pessoa descreveu agora:");
  const tema = ehMomento
    ? extrairCampo(entrada, "O que está acontecendo:") || "momento simulado"
    : extrairCampo(entrada, "Tema escolhido:") || "tema simulado";
  const reprovado = entrada.includes("reprovou a versão anterior");
  const reprovadoMuitoLongo = entrada.includes("Muito longo");
  const ids = extrairIds(entrada);
  // V9c, item 2: so o sistema estavel diz o formato (a entrada nunca cita "story"); a marca
  // do bloco de estrutura de Story e o numero da primeira regra da lista.
  const ehStory = sistemaEstavel.includes("R-IG-STORY-01");
  // M4, item 4: idem para o estilo sem fala, marca unica do bloco de estrutura dele.
  const ehSemFala = sistemaEstavel.includes("Estrutura do roteiro sem fala:");
  const tipoAbertura = ehStory || ehSemFala ? null : tipoAberturaEscolhidoPeloMock(entrada);
  const primeiraPalavra = tipoAbertura ? PRIMEIRA_PALAVRA_MOCK_POR_TIPO[tipoAbertura] : "";

  const narrativa = ehSemFala
    ? { gancho: null, corpo: null, fechamento: null, chamadaFinal: null, ...mockCenasSemFala(tema, reprovado) }
    : ehStory
      ? { gancho: null, corpo: null, fechamento: null, chamadaFinal: null, legenda: null, ...mockCartoesStory(tema, reprovado) }
      : {
          gancho: reprovado
            ? `${primeiraPalavra}, um jeito diferente de mostrar ${tema}`
            : `${primeiraPalavra}, os 3 primeiros segundos sobre ${tema}`,
          corpo: reprovado
            ? `Outro angulo sobre ${tema}, com uma cena real do negocio.`
            : `Explicacao direta sobre ${tema}, com uma cena real do negocio.`,
          fechamento: "resumo do que foi mostrado",
          chamadaFinal: "comenta se você já passou por isso",
          cartoes: null,
          porQueAssim: mockPorQueAssimReels(sistemaEstavel),
          legenda: null,
        };

  /**
   * H4, item 1: por padrão o mock simula o modelo escolhendo o primeiro id da evidência
   * recebida como referência (o id existe de verdade, então passa em `validarReferenciaDoModelo`).
   * Este marcador simula o modelo alucinando um id fora da evidência, para o teste de
   * integração confirmar que o código rejeita (vira "sem referência"), nunca um id trocado.
   */
  const referencia = tema.includes("simule um id de referencia fora da lista de evidencia")
    ? { videoId: 999999, segundo: 9, oQueOlhar: "video fora da evidencia disponivel" }
    : ids[0] !== undefined
      ? { videoId: ids[0], segundo: 4, oQueOlhar: "o gancho" }
      : null;

  return {
    temaCurto: ehMomento ? `sobre ${tema}`.slice(0, 60) : null,
    titulo: tema,
    duracaoS: reprovadoMuitoLongo ? 25 : 40,
    ...narrativa,
    cenas: [{ momento: "abertura", oQueFazer: "mostrar o local de verdade" }],
    ondeGravar: "no proprio local do negocio, com o cliente aparecendo",
    edicao: {
      textoNaTela: [{ quando: "abertura", oQue: tema, onde: "topo da tela" }],
      ritmoDeCorte: "moderado",
      recursos: [],
      audio: null,
      referencia,
    },
    evidencias: ids,
    tipoAbertura,
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

/** As primeiras 8 noticias numeradas da entrada, com um angulo derivado do titulo. */
function mockFiltrarNoticias(entrada: string) {
  const blocoNoticias = entrada.split("Noticias:\n")[1] ?? "";
  const linhas = blocoNoticias.split("\n").filter((l) => /^\d+\./.test(l));

  return {
    relevantes: linhas.slice(0, 8).map((linha) => {
      const indice = Number(linha.match(/^(\d+)\./)?.[1] ?? 0);
      const titulo = linha.replace(/^\d+\.\s*/, "").split(":")[0].trim();
      return { indice, angulo: `saiu hoje que ${titulo}, explique o que muda para o seu cliente` };
    }),
  };
}

/** Ids de noticia da entrada montada ("noticia 123: titulo: resumo"), igual a extrairIds para video. */
function extrairIdsNoticias(entrada: string): number[] {
  const encontrados = entrada.match(/\bnoticia (\d+):/g) ?? [];
  return encontrados.map((m) => Number(m.replace(/\D/g, "")));
}

/**
 * Mesmo gatilho de teste que `MARCADOR_EVIDENCIA_INVENTADA` (mockAvaliarTema
 * acima), para o teste de integracao do job `temasDoDia` confirmar que
 * `evidenciaValida` reprova as duas tentativas e as duas ficam registradas
 * (correcao do dia 1 da etapa 14, `PROXIMO.md`).
 */
const MARCADOR_EVIDENCIA_INVENTADA_TEMA = "invente um id de evidencia que não existe";

function mockTemasDoDia(entrada: string) {
  const ids = extrairIds(entrada);
  const idsNoticias = extrairIdsNoticias(entrada);
  const puxaPara = ["alcance", "engajamento", "conversao"] as const;

  if (entrada.includes(MARCADOR_EVIDENCIA_INVENTADA_TEMA)) {
    return {
      temas: [0, 1, 2].map((i) => ({
        titulo: `tema simulado ${i + 1}`,
        descricao: "tema derivado dos videos que estao subindo hoje",
        porQue: "esta subindo mais rapido que o normal da conta",
        evidencias: [999999],
        evidenciasNoticias: [],
        puxaPara: puxaPara[i],
      })),
    };
  }

  return {
    // V2b, item 8: cada tema cita todos os ids de video disponiveis (não so
    // um por rodizio), para o mock simular uma prova de verdade quando o
    // teste cria video suficiente (3+ de 2+ contas); sem isso, nenhum tema
    // simulado passaria na checagem de prova por codigo.
    temas: [0, 1, 2].map((i) => ({
      titulo: `tema simulado ${i + 1}`,
      descricao: "tema derivado dos videos que estao subindo hoje",
      porQue: "esta subindo mais rapido que o normal da conta",
      evidencias: ids,
      evidenciasNoticias: idsNoticias.length > 0 ? [idsNoticias[i % idsNoticias.length]] : [],
      puxaPara: puxaPara[i],
    })),
  };
}

/**
 * H4, item 2: título com "pov" ou "meme simulado" marca o vídeo como meme (recorte/notícia não
 * têm marcador de teste próprio ainda, "original" é o padrão); `serveDeModelo` segue direto de
 * `tipoConteudo`, mesma regra do prompt de verdade.
 */
function tipoConteudoMock(titulo: string): { tipoConteudo: "original" | "meme"; serveDeModelo: boolean } {
  const ehMeme = /\bpov\b|meme simulado/i.test(titulo);
  return { tipoConteudo: ehMeme ? "meme" : "original", serveDeModelo: !ehMeme };
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
    chamadaFinal: "comenta se você já passou por isso",
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
      : "a transcricao não cita nenhum termo do nicho",
    idioma: "pt-BR" as const,
    tipoAbertura: "outro" as const,
    ...tipoConteudoMock(titulo),
  };
}

/** M3, item 2: mesma ideia de mockExtrairVideo, sem os campos de fala (`idioma`, `tipoAbertura`). */
function mockExtrairVideoSemFala(entrada: string) {
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
    gancho: `o que aparece na tela sobre ${titulo}`,
    estrutura: "cena, demonstracao, fechamento",
    fechamento: "resumo do que foi mostrado",
    chamadaFinal: "comenta se você já passou por isso",
    formato: "esquete" as const,
    porQueFuncionou: "mostra o problema acontecendo de verdade",
    etiquetas: titulo
      .toLowerCase()
      .split(" ")
      .filter((palavra) => palavra.length > 3)
      .slice(0, 4),
    pertenceAoNicho,
    motivoNicho: pertenceAoNicho ? "a legenda cita termo do nicho" : "a legenda não cita nenhum termo do nicho",
  };
}

/** V4, item 2: classifica pelo gancho, sem chave real (`scripts/preencher-tipo-abertura.ts`). */
function mockClassificarAbertura(entrada: string) {
  const gancho = extrairCampo(entrada, "Gancho:").toLowerCase();
  if (gancho.includes("?")) return { tipoAbertura: "pergunta" as const };
  if (/\d/.test(gancho)) return { tipoAbertura: "numero" as const };
  return { tipoAbertura: "cena" as const };
}

/**
 * V9a, item 3: separa por frase, na ordem em que a pessoa falou (mesmo
 * espírito de `mockRoteiro`, determinístico a partir da entrada, sem chave
 * real). `lerMomento.ts`, `montarEntrada`, sempre manda o texto na linha
 * seguinte ao rótulo.
 */
function mockLerMomento(entrada: string) {
  const texto = entrada.split("O que a pessoa disse ou escreveu:\n")[1]?.trim() || entrada.trim();
  const frases = texto
    .split(/[.!?]+\s*/)
    .map((frase) => frase.trim())
    .filter(Boolean);
  return {
    onde: frases[0] || texto,
    oQueEstaAcontecendo: frases[1] || texto,
    oQueDaParaMostrar: frases[2] || frases[1] || texto,
  };
}

/**
 * P2, item 3: tira algumas muletas de fala comuns, por regex, e junta os espaços que sobram. Um
 * mock de verdade nunca faria isso perfeitamente (é IA), mas é o bastante para o teste provar que
 * o texto que chega na tela não é a fala crua.
 */
const MULETAS_DE_FALA = /\b(é|tipo|né|então assim|daí|enfim)\b,?/gi;

function mockOrganizarFalaBriefing(entrada: string): { textoOrganizado: string } {
  const textoFalado = entrada.split("O que a pessoa falou:\n")[1]?.trim() ?? entrada.trim();
  const semMuletas = textoFalado.replace(MULETAS_DE_FALA, "").replace(/\s{2,}/g, " ").trim();
  return { textoOrganizado: semMuletas || textoFalado };
}

/**
 * V9b, item 1: separa por ";" (um bloco por dia) e por ":" dentro do bloco
 * (referenciaDia contra o resto), como no formato de exemplo do plano
 * ("segunda: voo para Dubai; terça: feira, fornecedor às 15h"). Nunca
 * resolve data (isso é `src/lib/data-relativa.ts`, por código); o mock só
 * imita a separação em dias que o modelo de verdade faria.
 */
function mockLerAgenda(entrada: string) {
  const texto = entrada.split("A agenda que a pessoa contou:\n")[1]?.trim() || entrada.trim();
  const blocos = texto
    .split(";")
    .map((bloco) => bloco.trim())
    .filter(Boolean);

  const dias = blocos.map((bloco) => {
    const [referenciaBruta, ...resto] = bloco.split(":");
    const referenciaDia = (referenciaBruta ?? "").trim() || "hoje";
    const linhaResto = resto.join(":").trim();
    const partes = linhaResto
      .split(",")
      .map((parte) => parte.trim())
      .filter(Boolean);
    return {
      referenciaDia,
      lugar: partes[0] ?? "",
      compromissos: partes.length > 0 ? partes : [linhaResto || "compromisso simulado"],
    };
  });

  return { dias };
}

/** V9b, item 2: uma sugestão por compromisso (até 3), o objetivo rodiziando entre os três. */
function mockPlanejarDia(entrada: string) {
  const lugar = extrairCampo(entrada, "Lugar:") || "o lugar";
  const linhasCompromissos =
    entrada
      .split("Compromissos do dia:\n")[1]
      ?.split("\n")
      .map((linha) => linha.replace(/^-\s*/, "").trim())
      .filter(Boolean) ?? [];

  const OBJETIVOS_MOCK = ["engajamento", "alcance", "conversao"] as const;
  const compromissos = linhasCompromissos.length > 0 ? linhasCompromissos : ["compromisso simulado"];

  const sugestoes = compromissos.slice(0, 3).map((compromisso, indice) => ({
    situacao: compromisso,
    oQueMostrar: `a cena de ${lugar} durante ${compromisso}`,
    objetivo: OBJETIVOS_MOCK[indice % OBJETIVOS_MOCK.length],
  }));

  return { sugestoes };
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
      { tipo: "pergunta direta", exemplo: "você já passou por isso", frequencia: "frequente" },
    ],
    duracaoTipicaS: { min: 20, max: 60 },
    estruturas: ["gancho, explicacao, demonstracao, fechamento"],
    fechamentos: ["resumo do que foi mostrado"],
    chamadasFinais: ["comenta se você já passou por isso"],
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

const IDS_MOTIVO_VALIDOS = new Set([
  "nao_e_assim_que_eu_falo",
  "nao_da_para_gravar_hoje",
  "ja_falei_disso",
  "nao_e_o_meu_cliente",
  "muito_longo",
  "nao_combina_com_o_objetivo",
  "gancho_fraco",
  "outro_motivo",
]);

/**
 * Uma regra por motivo estruturado distinto que aparece nas reprovações
 * (E27, parte 2, item 2): o teste de integração do job confere que duas
 * reprovações com o mesmo motivo consolidam numa regra só (a contagem quem
 * soma é o código, não o mock). Uma reprovação só com texto livre (sem
 * motivo estruturado) vira uma regra a mais, com `motivoOrigem` nulo.
 */
/** M2, item 1c: uma sugestão por rede, com o handle derivado do nome do setor, para o teste distinguir setores. */
function mockSugerirContasDoSetor(entrada: string) {
  const setor = extrairCampo(entrada, "Setor:") || "setor simulado";
  const slug = setor.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "setor";
  return {
    contas: [
      { rede: "youtube" as const, handle: `@${slug}-youtube`, porQue: `canal simulado do setor ${setor}` },
      { rede: "tiktok" as const, handle: `${slug}-tiktok`, porQue: `perfil simulado do setor ${setor}` },
      { rede: "instagram" as const, handle: `${slug}.instagram`, porQue: `perfil simulado do setor ${setor}` },
    ],
    termos: [`${setor} dica`, `${setor} tutorial`],
    hashtags: [slug, `${slug}dicas`],
  };
}

/** M2, item 2: mesma ideia de mockExtrairVideo/pertenceAoNicho, aplicada aos titulos do perfil em vez de a um video. */
function mockClassificarContaDoSetor(entrada: string) {
  const setorLinha = extrairCampo(entrada, "Setor:");
  const termos = (setorLinha.match(/termos: ([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const textoBusca = entrada.toLowerCase();
  const pertenceAoSetor = termos.length === 0 || termos.some((termo) => textoBusca.includes(termo));
  return {
    pertenceAoSetor,
    motivo: pertenceAoSetor
      ? "os titulos ou legendas citam termo do setor"
      : "os titulos ou legendas não citam nenhum termo do setor",
  };
}

/**
 * H4, item 3: aprova todos os ids por padrão (o filtro de marca só reprova quando o teste pede,
 * com este marcador no perfil compilado); sem isso, todo teste existente que já usa evidência
 * precisaria saber deste filtro novo só para continuar passando como antes.
 */
const MARCADOR_REPROVA_EVIDENCIA_POR_MARCA = "reprove toda a evidencia por nao combinar com a marca";

function mockFiltrarEvidenciaPorMarca(entrada: string) {
  const ids = extrairIds(entrada);
  if (entrada.includes(MARCADOR_REPROVA_EVIDENCIA_POR_MARCA)) {
    return { aprovados: [] };
  }
  return { aprovados: ids };
}

/**
 * E39b, item (a): o candidato mais forte entre os que chegam da velocidade (o mesmo "Xx a
 * velocidade normal da conta" que `aindaValeRoteiro.montarEntrada` escreve), determinístico por
 * entrada, sem chave real. Abaixo do limiar, "continua valendo"; a partir dele, troca pelo mais
 * forte dos candidatos (maior velocidade primeiro).
 */
const LIMIAR_MOCK_AINDA_VALE = 3;

function mockAindaValeRoteiro(entrada: string) {
  const candidatos = [...entrada.matchAll(/id (\d+): ([^(\n]+)\(([\d.]+)x/g)].map((m) => ({
    id: Number(m[1]),
    assunto: m[2].trim(),
    velocidade: Number(m[3]),
  }));
  const maisForte = candidatos
    .filter((c) => c.velocidade >= LIMIAR_MOCK_AINDA_VALE)
    .sort((a, b) => b.velocidade - a.velocidade)[0];

  if (!maisForte) {
    return { valeAinda: true, videoId: null, motivo: "nada mais forte apareceu desde que o roteiro foi escrito" };
  }
  return { valeAinda: false, videoId: maisForte.id, motivo: `${maisForte.assunto} esta subindo mais forte agora` };
}

function mockAprenderCliente(entrada: string) {
  const blocoReprovacoes = entrada.split("\n\nRegras já ativas hoje")[0] ?? entrada;

  /**
   * Saída vazia (segunda rodada do PR #42, item 4): qualquer texto livre
   * marcado com "[exemplo] sem regra" simula a regra dura 2 do prompt
   * ("reprovações não sustentam nada de específico, devolva lista vazia"),
   * sem precisar de uma chave real para testar o job não quebrando nem
   * apagando regra nenhuma.
   */
  if (blocoReprovacoes.includes("[exemplo] sem regra")) {
    return { regras: [] };
  }

  const motivosEncontrados = new Set<string>();
  for (const match of blocoReprovacoes.matchAll(/motivo\(s\) ([^\n;]+)/g)) {
    for (const token of match[1].split(",").map((s) => s.trim())) {
      if (IDS_MOTIVO_VALIDOS.has(token)) motivosEncontrados.add(token);
    }
  }
  const temTextoLivreSemMotivo = /nenhum motivo estruturado[^\n]*; o que o cliente escreveu/.test(blocoReprovacoes);

  const regras: { regra: string; motivoOrigem: string | null }[] = [...motivosEncontrados].map((motivo) => ({
    regra: `[exemplo] regra derivada do motivo ${motivo}`,
    motivoOrigem: motivo,
  }));
  if (temTextoLivreSemMotivo) {
    regras.push({ regra: "[exemplo] regra derivada do texto livre", motivoOrigem: null });
  }

  return { regras: regras.slice(0, 10) };
}

/**
 * Verificador em duas camadas (plano de execucao, etapa 4): checagens
 * locais primeiro (travessao, emoji, jargao, proibicoes do briefing, ids de
 * evidencia quando exigidos), depois a tarefa barata verificarTexto.
 * Reprovou, refaz uma vez com o motivo anexado a entrada; reprovou de novo,
 * ErroIA nomeado. As duas tentativas ficam registradas em geracoes_ia.
 */
import type { CartaoStory, EstiloRoteiro, Ficha, FormatoRoteiro, TipoAbertura } from "@/db/schema";
import { PALAVRAS_VAZIAS } from "@/lib/palavras-vazias";
import { EMOJI, encontrarProblemas, MOTIVO_EMOJI, MOTIVO_TRAVESSAO } from "@/lib/regras-de-texto";

import { gerarEstruturado, type ParametrosGeracao } from "./cliente";
import { ErroIA } from "./erro";
import { NUMEROS_REGRAS_STORY } from "./prompts/regras-formato";
import type { InstrucaoAbertura } from "./prompts/roteiro";
import * as verificarTexto from "./prompts/verificarTexto";
import type { GeneroTexto } from "./prompts/verificarTexto";
import { registrarGeracao } from "./registro";

export type ResultadoVerificacaoLocal = {
  aprovado: boolean;
  motivos: string[];
};

/**
 * E49 PR 1, a ficha "Que guardem para depois": o corpo precisa ter algo para usar mais tarde, em passos numerados ou na ordem, uma lista com contagem, uma receita ou um modelo
 * para copiar. Heurística de texto de propósito (o que ela não pega fica para a revisão com a chave real): procura os sinais mais comuns e só reprova quando não há nenhum.
 */
export function temAlgoParaGuardar(corpo: string): boolean {
  const t = corpo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Passos numerados: o 1 e o 2 (um "R$ 2.500" ou um "em 3. Depois" sozinhos não bastam).
  if (/(^|[^\d.,$])1\s*[.):-]\s*\S[\s\S]*?(^|[^\d.,$])2\s*[.):-]\s*\S/.test(t)) return true;
  // "Passo 1", "etapa 1", "dica 1", "1o passo", "passo a passo".
  if (/\b(passo|etapa|dica)\s*(1|um)\b|\b1(o|a)?\s*(passo|etapa|dica)\b|\bpasso a passo\b|\bprimeiro passo\b/.test(t)) return true;
  // Na ordem, escrito: pelo menos dois marcadores de ordem diferentes ("primeiro ... depois ... por fim"), ou a ordem dita ("nessa ordem").
  if (/\b(nessa|nesta|na|essa|esta) ordem\b|\bordem certa\b/.test(t)) return true;
  const ordem = ["primeiro", "segundo", "terceiro", "depois", "em seguida", "por fim", "por ultimo", "no final"].filter((m) => new RegExp(String.raw`\b${m}\b`).test(t));
  if (ordem.length >= 2) return true;
  // Lista anunciada com contagem: "dois erros", "oito jeitos", "5 dicas", "tres cuidados".
  if (
    /\b(dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|[2-9]|10)\s+(dicas?|passos?|erros?|jeitos?|formas?|maneiras?|coisas?|itens?|truques?|motivos?|sinais?|ingredientes?|etapas?|regras?|habitos?|cuidados?|produtos?|perguntas?|mitos?|segredos?|razoes|ideias?|opcoes|exemplos?|situacoes|mudancas?)\b/.test(t)
  ) {
    return true;
  }
  // Três verbos seguidos no imperativo, em sequência ("lava, enxagua e seca"): uma sequência de ações para repetir.
  if (/\b[a-z]{3,}(a|e|i)\s*,\s*[a-z]{3,}(a|e|i)\s+e\s+[a-z]{3,}(a|e|i)\b/.test(t) && /\b(ordem|depois|sequencia|assim)\b/.test(t)) return true;
  // Algo para copiar.
  if (/\b(modelo pronto|copia e cola|copie e cole|prompt pronto)\b/.test(t)) return true;
  return false;
}

/**
 * So checagem local, sem chamada de IA: pura, facil de testar. Uma
 * proibicao e considerada ferida quando a frase inteira (sem acento,
 * minuscula) aparece dentro do texto gerado; e uma checagem simples de
 * proposito, o que ela nao pega fica para a tarefa verificarTexto.
 */
export function verificarLocalmente(
  campos: Record<string, string>,
  opcoes: {
    proibicoes?: string[];
    evidencias?: number[];
    exigeEvidencia?: boolean;
    /**
     * Os ids que de fato entraram na entrada (revisao do PR #17, etapa 11):
     * sem isto, o verificador so conferia se a lista de evidencias citadas
     * nao estava vazia, nunca se os ids citados eram reais. Na rodada com
     * chave real o modelo inventou ids (a segunda tentativa, depois de
     * reprovado por "sem evidencia", preferiu inventar a admitir que nao
     * tinha nenhuma). Quando informado, todo id citado que nao esta aqui
     * reprova a geracao.
     */
    evidenciasFornecidas?: number[];
    /**
     * O gancho dos roteiros recentes do mesmo cliente (achado do primeiro
     * uso no iPad, item 3): segunda camada de defesa, por codigo, alem da
     * instrucao no prompt (mesmo espirito da licao do PR #17, so instrucao
     * no prompt nao bastava). So reprova quando `campos.gancho` existe;
     * tarefas sem esse campo ignoram a checagem mesmo se a lista vier.
     */
    ganchosRecentes?: string[];
    /**
     * V4, item 5, roteiro sem vício: a primeira palavra do gancho (sem
     * acento, minúscula) não pode repetir a de nenhum dos últimos 5
     * roteiros do cliente ("Espera", "Para", "Olha" são o vício que motivou
     * a etapa). Checagem separada da de `ganchosRecentes` acima: aquela
     * compara as seis primeiras palavras contra os roteiros dos últimos 10
     * dias (achado do iPad, um jeito de pegar o mesmo ângulo reaparecendo);
     * esta pega só o tique de abrir sempre pela mesma palavra, mesmo quando
     * o resto do gancho muda, contra os últimos 5 (contagem, não dias).
     */
    ganchosUltimos5?: string[];
    /**
     * V4, item 5: o tipo de abertura que este roteiro declarou usar, e o do
     * roteiro anterior do cliente. Reprova quando são iguais, a menos que
     * `tipoAberturaAnterior` já venha `null` (quem chama zera isso quando o
     * próprio serviço mandou repetir de propósito, `escolherTipoAbertura`
     * "libera o tipo usado há mais tempo" por falta de alternativa: aí não é
     * vício do modelo, é a única opção que a evidência de hoje tinha).
     */
    /** Nulo em Story (V9c): `escolherTipoAbertura` (V4) não se aplica, a checagem abaixo não roda. */
    tipoAberturaAtual?: TipoAbertura | null;
    tipoAberturaAnterior?: TipoAbertura | null;
    /**
     * V5, item 0b (revisão do PR #48): o que `escolherTipoAbertura` de fato
     * instruiu para este roteiro. Reprova quando o serviço instruiu um tipo
     * concreto e o modelo declarou outro, e quando a instrução era livre e o
     * tipo declarado está na lista dos proibidos. Cinto de segurança: na
     * prova com chave real o modelo obedeceu 9 de 9, mas o checo antigo (só
     * contra o roteiro anterior) deixava passar um modelo que ignorasse a
     * instrução e declarasse um tipo qualquer nunca usado antes.
     */
    instrucaoAbertura?: InstrucaoAbertura;
    /**
     * E27, parte 1, item 4: quando o cliente reprovou por "muito longo", a
     * nova versão precisa ficar mais curta que a reprovada. `campos` só tem
     * texto; duração é numérica, por isso entra à parte, já calculada por
     * quem chama.
     */
    duracaoParaMuitoLongo?: { anteriorS: number; novaS: number };
    /**
     * M5b, achado 4 da revisão do motor (01/10/2026): a duração real do roteiro (`duracaoS` da
     * saída) e a faixa de percentis 25 a 75 do modelo do nicho (`ModeloNicho.duracaoTipicaS`,
     * calculada por SQL em `jobs/modelo-nicho.ts`, nunca mais inventada pelo modelo). Fora da
     * faixa, reprova aqui; antes disto o roteiro era só encaixado na faixa depois de escrito
     * (`respeitarDuracaoDoNicho`, removida). Sem faixa (nicho sem modelo ainda, ou sem vídeo com
     * duração gravada o bastante para medir), a checagem não roda, igual a antes.
     */
    duracaoS?: number;
    faixaDuracaoNicho?: { min: number; max: number };
    /**
     * V9a, item 2: com o momento (o gancho precisa nascer da cena que está
     * na frente do celular), as palavras de conteúdo de `onde` e
     * `oQueEstaAcontecendo` (`palavrasDeConteudo`, abaixo). Reprova quando
     * `campos.gancho` existe e nenhuma delas aparece nele; campos.corpo não
     * conta, a regra é sobre os primeiros três segundos.
     */
    palavrasDoMomento?: string[];
    /**
     * V9c, item 3: as checagens conferíveis por código da seção 9.1
     * (`R-IG-STORY-03` a `07`), só quando `formato === "story"`.
     * `porQueAssim` é conferido sempre que vier, mesmo em Reels (vazio lá,
     * a checagem não encontra nada para reprovar).
     */
    formato?: FormatoRoteiro;
    /**
     * M4, item 4: sem fala sempre usa `cartoes` (a mesma estrutura de Story), nos dois formatos;
     * tem prioridade sobre o `formato === "story"` abaixo, que checa fala e figurinha, coisas que
     * não existem aqui. Nenhum `oQueFalar` preenchido, texto na tela dentro do limite, `legenda`
     * presente.
     */
    estilo?: EstiloRoteiro;
    /** E49 PR 1: a ficha do Reels falado; "guardem" exige algo para usar mais tarde no corpo (`temAlgoParaGuardar`). */
    ficha?: Ficha;
    cartoes?: CartaoStory[] | null;
    legenda?: string | null;
    porQueAssim?: { regra: string; motivo: string }[];
    /**
     * R1, item 2: os números válidos para `porQueAssim`, pelo formato e pela rede de verdade deste
     * roteiro (Story sempre usa `R-IG-STORY`; Reels falado usa a rede principal da marca,
     * `regrasDoReels`). Sem valor, usa `R-IG-STORY` (o único conjunto que existia antes da R1).
     */
    numerosRegrasPlataforma?: Set<string>;
    /**
     * V9d, item 1: os valores brutos de `gancho`, `corpo` e `chamadaFinal`, antes do filtro de
     * `extrairCamposRoteiro` (que já tira do `campos` qualquer um vazio ou nulo, em qualquer
     * formato). Sem isto, um roteiro em Reels que saísse com `gancho` nulo (o schema 2.0.0 aceita,
     * pensado para Story) não tinha nenhum campo `campos.gancho` para reprovar, e um roteiro em
     * branco passava. Só confere em `formato === "reels"`; em Story a estrutura é `cartoes`, abaixo.
     */
    narrativa?: { gancho: string | null; corpo: string | null; chamadaFinal: string | null };
  } = {},
): ResultadoVerificacaoLocal {
  const motivos: string[] = [];

  for (const [nomeCampo, valor] of Object.entries(campos)) {
    for (const problema of encontrarProblemas(valor)) {
      motivos.push(`${nomeCampo}: ${problema}`);
    }
    const semAcento = problemaDeAcentuacao(valor);
    if (semAcento) {
      motivos.push(`${nomeCampo}: ${semAcento}`);
    }
  }

  const textoJunto = normalizar(Object.values(campos).join(" "));
  for (const proibicao of opcoes.proibicoes ?? []) {
    if (proibicao.trim() && textoJunto.includes(normalizar(proibicao))) {
      motivos.push(`fere a proibicao do cliente: "${proibicao}"`);
    }
  }

  if (campos.gancho && opcoes.ganchosRecentes && opcoes.ganchosRecentes.length > 0) {
    const inicioNovo = inicioDoGancho(campos.gancho);
    const repeteRecente = opcoes.ganchosRecentes.some(
      (recente) => inicioDoGancho(recente) === inicioNovo,
    );
    if (repeteRecente) {
      motivos.push(
        "gancho: repete ou parafraseia as primeiras palavras de um gancho recente do mesmo cliente",
      );
    }
  }

  if (campos.gancho && opcoes.ganchosUltimos5 && opcoes.ganchosUltimos5.length > 0) {
    const palavraNova = primeiraPalavra(campos.gancho);
    const repetePrimeiraPalavra =
      palavraNova !== "" && opcoes.ganchosUltimos5.some((g) => primeiraPalavra(g) === palavraNova);
    if (repetePrimeiraPalavra) {
      motivos.push(
        `gancho: começa com a mesma primeira palavra ("${palavraNova}") de um dos últimos 5 roteiros do cliente`,
      );
    }
  }

  if (
    opcoes.tipoAberturaAtual &&
    opcoes.tipoAberturaAnterior &&
    opcoes.tipoAberturaAtual === opcoes.tipoAberturaAnterior
  ) {
    motivos.push(
      `tipoAbertura: repete o tipo de abertura do roteiro anterior ("${opcoes.tipoAberturaAtual}")`,
    );
  }

  if (opcoes.tipoAberturaAtual && opcoes.instrucaoAbertura) {
    const instrucao = opcoes.instrucaoAbertura;
    if (instrucao.tipo !== null && opcoes.tipoAberturaAtual !== instrucao.tipo) {
      motivos.push(
        `tipoAbertura: o serviço instruiu "${instrucao.tipo}" e o modelo declarou "${opcoes.tipoAberturaAtual}"`,
      );
    } else if (
      instrucao.tipo === null &&
      instrucao.tiposProibidos.includes(opcoes.tipoAberturaAtual)
    ) {
      motivos.push(
        `tipoAbertura: a instrução era livre, evitando ${instrucao.tiposProibidos.join(", ")}, e o modelo declarou "${opcoes.tipoAberturaAtual}", um dos proibidos`,
      );
    }
  }

  if (campos.gancho && opcoes.palavrasDoMomento && opcoes.palavrasDoMomento.length > 0) {
    const ganchoNormalizado = normalizar(campos.gancho);
    const citaAlguma = opcoes.palavrasDoMomento.some((palavra) =>
      ganchoNormalizado.includes(palavra),
    );
    if (!citaAlguma) {
      motivos.push(
        "gancho: não cita nenhum elemento concreto do momento descrito (onde ou o que está acontecendo) nos primeiros segundos",
      );
    }
  }

  const evidenciasCitadas = opcoes.evidencias ?? [];

  if (opcoes.exigeEvidencia && evidenciasCitadas.length === 0) {
    motivos.push("sem ids de evidencia, e a tarefa exige evidencia");
  }

  if (
    opcoes.duracaoParaMuitoLongo &&
    opcoes.duracaoParaMuitoLongo.novaS >= opcoes.duracaoParaMuitoLongo.anteriorS
  ) {
    motivos.push(
      `duracao: reprovado por "muito longo" (${opcoes.duracaoParaMuitoLongo.anteriorS}s), mas a nova ` +
        `versao ficou com ${opcoes.duracaoParaMuitoLongo.novaS}s, nao mais curta`,
    );
  }

  if (
    opcoes.duracaoS !== undefined &&
    opcoes.faixaDuracaoNicho &&
    (opcoes.duracaoS < opcoes.faixaDuracaoNicho.min || opcoes.duracaoS > opcoes.faixaDuracaoNicho.max)
  ) {
    motivos.push(
      `duracao: ${opcoes.duracaoS}s fora da faixa tipica do nicho (${opcoes.faixaDuracaoNicho.min}s a ` +
        `${opcoes.faixaDuracaoNicho.max}s, M5b achado 4)`,
    );
  }

  if (opcoes.evidenciasFornecidas) {
    const fornecidas = new Set(opcoes.evidenciasFornecidas);
    const inventadas = evidenciasCitadas.filter((id) => !fornecidas.has(id));
    if (inventadas.length > 0) {
      motivos.push(`cita evidencia que nao foi fornecida: ${inventadas.join(", ")}`);
    }
  }

  if (opcoes.estilo === "sem_fala") {
    if (!opcoes.cartoes || opcoes.cartoes.length === 0) {
      motivos.push("cartoes: nulo ou vazio, um roteiro sem fala precisa de cenas (M4, item 4)");
    } else {
      motivos.push(...verificarCartoesSemFala(opcoes.cartoes, opcoes.legenda));
    }
  } else if (opcoes.formato === "story") {
    if (!opcoes.cartoes || opcoes.cartoes.length === 0) {
      motivos.push("cartoes: nulo ou vazio, um roteiro em story precisa de cartões (V9d, item 1)");
    } else {
      motivos.push(...verificarCartoesStory(opcoes.cartoes));
    }
  }

  if (opcoes.estilo !== "sem_fala" && opcoes.formato === "reels" && opcoes.narrativa) {
    const { gancho, corpo, chamadaFinal } = opcoes.narrativa;
    if (!gancho?.trim()) {
      motivos.push("gancho: nulo ou vazio, um roteiro em reels precisa de gancho (V9d, item 1)");
    }
    if (!corpo?.trim()) {
      motivos.push("corpo: nulo ou vazio, um roteiro em reels precisa de corpo (V9d, item 1)");
    }
    if (!chamadaFinal?.trim()) {
      motivos.push(
        "chamadaFinal: nula ou vazia, um roteiro em reels precisa de chamada final (V9d, item 1)",
      );
    }
    if (opcoes.ficha === "guardem" && corpo?.trim() && !temAlgoParaGuardar(corpo)) {
      motivos.push("corpo: a ficha 'que guardem para depois' pede passo a passo, lista ou algo para copiar, e o corpo nao tem nenhum (E49 PR 1)");
    }
  }

  if (opcoes.porQueAssim && opcoes.porQueAssim.length > 0) {
    const numerosValidos = opcoes.numerosRegrasPlataforma ?? NUMEROS_REGRAS_STORY;
    const invalidas = opcoes.porQueAssim
      .map((item) => item.regra)
      .filter((regra) => !numerosValidos.has(regra));
    if (invalidas.length > 0) {
      motivos.push(`porQueAssim cita regra que nao existe na lista: ${invalidas.join(", ")}`);
    }
  }

  return { aprovado: motivos.length === 0, motivos };
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * H2, item 2 (achado do Gustavo em 29/09/2026: a análise de uma resposta saiu sem acento
 * nenhum, "voce", "nao", "ja", "tambem", apesar de o prompt pedir acentuação; reproduzido em
 * local com uma resposta do cliente digitada sem acento, o modelo imitou o jeito de escrever
 * dela). A resposta do cliente pode vir sem acento; o texto que a IA escreve para o cliente ler
 * nunca pode. Duas checagens, nunca aplicadas ao que o cliente escreveu (`campos` aqui é sempre
 * saída da IA, nunca entrada: `extrairCampos` de cada tarefa já filtra isso antes de chegar
 * aqui). `voce`/`nao`/`tambem`/`ja` como palavra inteira reprova em qualquer tamanho, sinal
 * forte demais para esperar 200 caracteres; nenhum caractere acentuado só reprova a partir de
 * 200, porque um texto curto pode não ter nenhuma vogal acentuável por acaso.
 *
 * Revisão do PR #83 (achado do Fable): a checagem de palavra inteira reprovava texto legítimo
 * em dois casos. Primeiro, quando a IA cita entre aspas uma frase literal do cliente (a P5 e a
 * P9 pedem isso; a frase do cliente pode vir sem acento, a checagem não sabia separar "a IA
 * escreveu" de "a IA citou"). Segundo, sigla ou nome próprio em maiúsculas ("JA Envelopamentos")
 * batia na mesma palavra por acaso, sem ser o advérbio "já". Duas defesas: tira do texto o que
 * está entre aspas (retas, curvas e simples) antes de testar; e ignora o bater quando a palavra
 * inteira encontrada está toda em maiúsculas (sigla), nunca quando é só a inicial maiúscula
 * (começo de frase, "Ja virou rotina", continua reprovando).
 */
const ENTRE_ASPAS = /"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g;
const PALAVRAS_SEM_ACENTO = /\b(voce|nao|tambem|ja)\b/gi;
const TEM_CARACTERE_ACENTUADO = /[áàâãéèêíïóôõöúüçÁÀÂÃÉÈÊÍÏÓÔÕÖÚÜÇ]/;
const MINIMO_CARACTERES_PARA_EXIGIR_ACENTO = 200;
/**
 * M5b, achado 10: só este motivo (o conjunto fechado de quatro palavras) é corrigível por código
 * de forma determinística (`corrigirMecanicamente`, abaixo); o outro ramo de `problemaDeAcentuacao`
 * ("200 caracteres sem nenhum acento") não diz ONDE falta acento, não dá para corrigir por código.
 */
const MOTIVO_PALAVRA_SEM_ACENTO = 'sem acentuacao: tem "voce", "nao", "tambem" ou "ja" sem o acento (H2, achado de 29/09/2026)';

function temPalavraSemAcento(texto: string): boolean {
  for (const encontrada of texto.matchAll(PALAVRAS_SEM_ACENTO)) {
    const palavra = encontrada[0];
    if (palavra !== palavra.toUpperCase()) return true;
  }
  return false;
}

function problemaDeAcentuacao(texto: string): string | null {
  const semAspas = texto.replace(ENTRE_ASPAS, "");
  if (temPalavraSemAcento(semAspas)) {
    return MOTIVO_PALAVRA_SEM_ACENTO;
  }
  if (semAspas.length > MINIMO_CARACTERES_PARA_EXIGIR_ACENTO && !TEM_CARACTERE_ACENTUADO.test(semAspas)) {
    return `sem acentuacao: mais de ${MINIMO_CARACTERES_PARA_EXIGIR_ACENTO} caracteres sem nenhum acento (H2, achado de 29/09/2026)`;
  }
  return null;
}

const PALAVRAS_INICIO_GANCHO = 6;

/** Minusculas, sem acento, sem pontuacao: as seis primeiras palavras, para comparar ganchos entre si. */
function inicioDoGancho(texto: string): string {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/)
    .slice(0, PALAVRAS_INICIO_GANCHO)
    .join(" ");
}

/** So a primeira palavra, minuscula, sem acento, sem pontuacao (V4, item 5: o tique de abrir sempre igual). */
function primeiraPalavra(texto: string): string {
  return (
    normalizar(texto)
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

/**
 * Palavras curtas ou de ligação demais para contar como "elemento concreto" do momento (V9a,
 * item 2). M5b, achado 6: vem de `PALAVRAS_VAZIAS` (`lib/palavras-vazias.ts`), a mesma lista que
 * `servicos/pesquisa.ts` usa para a evidência do tema e do roteiro, para as duas nunca divergirem;
 * normalizada aqui (sem acento) porque este verificador compara contra `normalizar(texto)`.
 */
const PALAVRAS_PARADA_MOMENTO = new Set([...PALAVRAS_VAZIAS].map((palavra) => normalizar(palavra)));

/**
 * As palavras de conteúdo de um texto (V9a, item 2, verificador local do
 * momento): minúsculas, sem acento, com 4 letras ou mais, fora da lista de
 * parada acima. Pura e exportada para o teste unitário (3 casos: cita, não
 * cita, cita só no corpo) e para `servicos/roteiro.ts` montar
 * `palavrasDoMomento` a partir de `onde` e `oQueEstaAcontecendo`.
 */
export function palavrasDeConteudo(texto: string): string[] {
  const palavras = normalizar(texto)
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 4 && !PALAVRAS_PARADA_MOMENTO.has(palavra));
  return [...new Set(palavras)];
}

/**
 * 2,5 palavras por segundo, até 60 segundos por story (`R-IG-STORY-03`, decisão do Gustavo em
 * 01/10/2026, E40: era 15s, número nosso sem base; 60 é o teto que a documentação da Central de
 * Ajuda dá, acima disso o aplicativo oferece o cortador).
 */
const PALAVRAS_POR_SEGUNDO_STORY = 2.5;
const SEGUNDOS_MAX_POR_CARTAO = 60;
const PALAVRAS_MAX_POR_CARTAO = Math.floor(PALAVRAS_POR_SEGUNDO_STORY * SEGUNDOS_MAX_POR_CARTAO);

/** Verbo que fecha a conversa no último cartão (`R-IG-STORY-07`): "me chama" e "no direct" contam como duas palavras. */
const VERBOS_RESPOSTA_STORY = ["responde", "vota", "manda", "toca", "chama", "comenta", "conta"];

/**
 * V9d, item 0 (achados do golden set de Stories rodado com chave real depois do ajuste do prompt):
 * "qual dos dois você já usou?" fecha pedindo resposta tanto quanto "vota aqui", mas não usa nenhum
 * verbo da lista acima. Uma pergunta direta no último cartão (termina com "?") também conta como
 * pedir resposta; basta um dos dois sinais (o verbo ou a pergunta) para aprovar. Rodada seguinte do
 * mesmo golden set: "me conta aqui qual é a mancha" também fecha pedindo resposta, e "conta" (de
 * "contar") entrou na lista.
 */
function fechaPedindoResposta(ultimoCartaoFalar: string): boolean {
  return (
    VERBOS_RESPOSTA_STORY.some((verbo) => ultimoCartaoFalar.includes(verbo)) ||
    ultimoCartaoFalar.includes("?")
  );
}

function contarPalavras(texto: string): number {
  return normalizar(texto).trim().split(/\s+/).filter(Boolean).length;
}

/**
 * O que a seção 9.1 marca como "sim" (conferível por código) para Story
 * (V9c, item 3; contagem ajustada na E40): número de stories entre 1 e 5 e
 * até 60 segundos de fala por story (`R-IG-STORY-03`, o schema permite 1 a
 * 5, esta é a segunda camada, mesmo espírito do resto do verificador);
 * algum story com figurinha (`R-IG-STORY-04`); texto na tela em todo story
 * (`R-IG-STORY-05`, já que todo story tem fala, `oQueFalar` é obrigatório
 * no schema); o último story com verbo de resposta e sem "segue"
 * (`R-IG-STORY-01` e `R-IG-STORY-07`; com um story só, ele é o primeiro e o
 * último ao mesmo tempo, e o índice `cartoes.length - 1` já cobre os dois).
 */
function verificarCartoesStory(cartoes: CartaoStory[]): string[] {
  const motivos: string[] = [];

  if (cartoes.length < 1 || cartoes.length > 5) {
    motivos.push(`cartoes: ${cartoes.length} story(ies), a regra R-IG-STORY-03 pede de 1 a 5`);
  }

  cartoes.forEach((cartao, indice) => {
    const palavras = contarPalavras(cartao.oQueFalar);
    if (palavras > PALAVRAS_MAX_POR_CARTAO) {
      motivos.push(
        `cartao ${indice + 1}: ${palavras} palavras passam de ${PALAVRAS_MAX_POR_CARTAO} (R-IG-STORY-03, ate 60s de fala)`,
      );
    }
    if (!cartao.textoNaTela.trim()) {
      motivos.push(`cartao ${indice + 1}: sem texto na tela (R-IG-STORY-05)`);
    }
  });

  const temFigurinha = cartoes.some((cartao) => cartao.figurinha !== "nenhuma");
  if (!temFigurinha) {
    motivos.push("cartoes: nenhum pede interacao por figurinha (R-IG-STORY-04)");
  }

  const ultimo = normalizar(cartoes[cartoes.length - 1]?.oQueFalar ?? "");
  if (/\bsegue\b|\bseguir\b/.test(ultimo)) {
    motivos.push('ultimo cartao: pede para "seguir", quem ve story ja segue (R-IG-STORY-01)');
  }
  if (!fechaPedindoResposta(ultimo)) {
    motivos.push("ultimo cartao: nao fecha pedindo resposta (R-IG-STORY-07)");
  }

  return motivos;
}

/**
 * M4, item 4: "o texto que entra na tela (curto, no máximo 8 palavras por vez)" do prompt é por
 * troca de texto, não por cartão inteiro (um cartão pode trocar o texto mais de uma vez); o teto
 * aqui é generoso o bastante para caber três trocas de 8 palavras num só cartão, sem abrir espaço
 * para um parágrafo inteiro disfarçado de "texto na tela".
 */
const PALAVRAS_MAX_TEXTO_NA_TELA_SEM_FALA = 24;

/**
 * As checagens conferíveis por código do roteiro sem fala (M4, item 4): nenhum cartão com fala
 * preenchida, texto na tela presente e dentro do limite, o que mostrar presente, e a legenda do
 * post presente (o roteiro falado não precisa dela, a chamada final já é fala).
 */
function verificarCartoesSemFala(
  cartoes: CartaoStory[],
  legenda: string | null | undefined,
): string[] {
  const motivos: string[] = [];

  if (cartoes.length < 2 || cartoes.length > 5) {
    motivos.push(`cartoes: ${cartoes.length} cena(s), um roteiro sem fala precisa de 2 a 5`);
  }

  cartoes.forEach((cartao, indice) => {
    if (cartao.oQueFalar.trim()) {
      motivos.push(
        `cena ${indice + 1}: tem fala preenchida, um roteiro sem fala não pode ter fala em bloco nenhum`,
      );
    }
    if (!cartao.oQueMostrar.trim()) {
      motivos.push(`cena ${indice + 1}: sem o que mostrar`);
    }
    if (!cartao.textoNaTela.trim()) {
      motivos.push(`cena ${indice + 1}: sem texto na tela`);
    } else {
      const palavras = contarPalavras(cartao.textoNaTela);
      if (palavras > PALAVRAS_MAX_TEXTO_NA_TELA_SEM_FALA) {
        motivos.push(
          `cena ${indice + 1}: ${palavras} palavras de texto na tela passam de ${PALAVRAS_MAX_TEXTO_NA_TELA_SEM_FALA}`,
        );
      }
    }
  });

  if (!legenda || !legenda.trim()) {
    motivos.push("legenda: nula ou vazia, um roteiro sem fala precisa da legenda do post pronta");
  }

  return motivos;
}

export type ParametrosGeracaoVerificada<T> = ParametrosGeracao<T> & {
  versaoPrompt: string;
  clienteId?: number;
  proibicoes?: string[];
  exigeEvidencia?: boolean;
  /** Os ids que entraram na entrada, para o verificador reprovar qualquer id citado fora daqui. */
  evidenciasFornecidas?: number[];
  /** O gancho dos roteiros recentes do mesmo cliente (ver `verificarLocalmente`). */
  ganchosRecentes?: string[];
  /** V4, item 5: o gancho dos últimos 5 roteiros do cliente, para a checagem de primeira palavra (ver `verificarLocalmente`). */
  ganchosUltimos5?: string[];
  /** V4, item 5: o tipo de abertura do roteiro anterior do cliente (ver `verificarLocalmente`). */
  tipoAberturaAnterior?: TipoAbertura | null;
  /** V5, item 0b: o que `escolherTipoAbertura` instruiu, para o verificador conferir contra a instrução (ver `verificarLocalmente`). */
  instrucaoAbertura?: InstrucaoAbertura;
  extrairTipoAbertura?: (dados: T) => TipoAbertura | null;
  /**
   * Duração da versão reprovada, em segundos (E27, parte 1, item 4): só
   * informada quando o cliente reprovou por "muito longo", junto com
   * `extrairDuracaoS` (a tarefa é genérica em `T`, não sabe de antemão se a
   * saída tem duração). A nova versão precisa ficar mais curta que esta.
   */
  duracaoReprovadaS?: number;
  extrairDuracaoS?: (dados: T) => number;
  /** M5b, achado 4: a faixa de percentis 25 a 75 do modelo do nicho, para `verificarLocalmente` reprovar fora dela (ver lá). */
  faixaDuracaoNicho?: { min: number; max: number };
  /**
   * "padrao" (default) ou "analise" (rodada de acabamento de 06/09, item
   * 1): qual criterio de tom a tarefa verificarTexto usa. Ver
   * `prompts/verificarTexto.ts`.
   */
  generoTexto?: GeneroTexto;
  /** V9a, item 2: as palavras de conteúdo do momento, para `verificarLocalmente` (ver lá). */
  palavrasDoMomento?: string[];
  /**
   * O roteiro não inventa fato: tudo o que foi dito ou escrito para o texto (o momento, o perfil, o tema, a evidência), para o `verificarTexto` reprovar o fato concreto que não
   * está aqui (ver `prompts/verificarTexto.ts`). Ausente, a conferência não roda (as outras tarefas não mudam).
   */
  fontesDosFatos?: string;
  /** V9c, item 3: o formato do roteiro, e como extrair os cartões e o "por que assim" da saída, quando houver. */
  formato?: FormatoRoteiro;
  /** M4, item 4: o estilo do roteiro; sem fala troca a checagem de cartões (ver `verificarLocalmente`). */
  estilo?: EstiloRoteiro;
  /** E49 PR 1: a ficha do Reels falado (ver `verificarLocalmente`). */
  ficha?: Ficha;
  extrairCartoes?: (dados: T) => CartaoStory[] | null;
  extrairPorQueAssim?: (dados: T) => { regra: string; motivo: string }[];
  /** R1, item 2: os números válidos para `porQueAssim` deste roteiro específico (ver `verificarLocalmente`). */
  numerosRegrasPlataforma?: Set<string>;
  /** M4, item 4: a legenda do post, só no estilo sem fala. */
  extrairLegenda?: (dados: T) => string | null;
  /** V9d, item 1: gancho, corpo e chamadaFinal brutos, para `verificarLocalmente` reprovar um Reels vazio (ver lá). */
  extrairNarrativa?: (dados: T) => {
    gancho: string | null;
    corpo: string | null;
    chamadaFinal: string | null;
  };
  extrairCampos: (dados: T) => Record<string, string>;
  extrairEvidencias?: (dados: T) => number[];
  /**
   * Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação (quando a tarefa tem
   * um) precisa continuar sendo a última linha da entrada mesmo na segunda tentativa; antes,
   * `gerarComVerificacao` colava o motivo da reprovação depois da entrada inteira (que já vinha
   * com o lembrete embutido no fim), empurrando o lembrete para o meio do texto. Quem monta a
   * entrada não inclui mais o próprio lembrete: passa o texto dele aqui, e `gerarComVerificacao`
   * garante que ele vem por último nas duas tentativas.
   */
  lembreteFinal?: string;
};

export type ResultadoVerificacao<T> = {
  dados: T;
  /**
   * Id da linha de `geracoes_ia` da tentativa aprovada (etapa 11, decisão 4
   * do `PROXIMO.md`): quem chama pode gravar a avaliação do cliente
   * ("gostei", "não gostei", o motivo de pedir outro ângulo) nessa mesma
   * linha depois, sem precisar buscar de novo por tarefa e cliente.
   */
  geracaoId: number;
};

/**
 * V10, item 2 (achado da revisão): o texto que marca a entrada da segunda
 * tentativa. `admin-acompanhamento.ts` usa esta mesma constante para achar
 * "reprovada duas vezes" só entre uma primeira e a sua própria segunda
 * tentativa (nunca entre duas tarefas de invocações diferentes que por
 * acaso caíram lado a lado em `geracoes_ia`, ex. duas perguntas seguidas do
 * briefing, mesma tarefa, mesmo cliente, cada uma com a sua própria
 * primeira tentativa).
 */
export const MARCADOR_SEGUNDA_TENTATIVA = "A tentativa anterior foi reprovada.";

/**
 * Gera, verifica em duas camadas, e refaz uma vez se reprovar. As duas
 * tentativas (quando houver a segunda) ficam registradas em geracoes_ia.
 */
export async function gerarComVerificacao<T>(
  params: ParametrosGeracaoVerificada<T>,
): Promise<ResultadoVerificacao<T>> {
  // Achado 11: o lembrete (quando houver) sempre por último, nas duas tentativas.
  const comLembrete = (entrada: string): string =>
    params.lembreteFinal ? `${entrada}\n\n${params.lembreteFinal}` : entrada;

  const primeira = await tentarGerarEVerificar({ ...params, entrada: comLembrete(params.entrada) });
  if (primeira.aprovado) return { dados: primeira.dados, geracaoId: primeira.geracaoId };

  /**
   * Revisão do Fable no PR #102 (M5b, achado 4): a faixa de duração do nicho reprova a primeira
   * tentativa (o modelo recebe o motivo e tem a chance de acertar), mas nunca derruba a geração
   * sozinha. Na segunda tentativa a faixa não é conferida: a duração que vier é gravada como é,
   * sem encaixe. A pessoa esperando o roteiro não pode receber um erro porque o vídeo saiu alguns
   * segundos fora dos percentis do setor.
   */
  const segunda = await tentarGerarEVerificar({
    ...params,
    faixaDuracaoNicho: undefined,
    // E49 PR 1: a heurística da ficha "que guardem" vale só na primeira tentativa, como a faixa de duração: nunca derruba a geração sozinha.
    ficha: undefined,
    entrada: comLembrete(`${params.entrada}\n\n${MARCADOR_SEGUNDA_TENTATIVA} Motivo: ${primeira.motivos.join("; ")}. Corrija isso.`),
  });
  if (segunda.aprovado) return { dados: segunda.dados, geracaoId: segunda.geracaoId };

  throw new ErroIA(`tarefa "${params.tarefa}" reprovada duas vezes: ${segunda.motivos.join("; ")}`);
}

/**
 * As opções locais de `verificarLocalmente` a partir dos parâmetros genéricos da tarefa e de uma
 * saída concreta (M5b, achado 10): extraída para `tentarGerarEVerificar` poder chamar de novo
 * depois de `corrigirMecanicamente`, sem duplicar a montagem.
 */
function opcoesVerificacaoLocal<T>(params: ParametrosGeracaoVerificada<T>, dados: T) {
  return {
    proibicoes: params.proibicoes,
    evidencias: params.extrairEvidencias?.(dados) ?? [],
    exigeEvidencia: params.exigeEvidencia,
    evidenciasFornecidas: params.evidenciasFornecidas,
    ganchosRecentes: params.ganchosRecentes,
    ganchosUltimos5: params.ganchosUltimos5,
    tipoAberturaAtual: params.extrairTipoAbertura?.(dados),
    tipoAberturaAnterior: params.tipoAberturaAnterior,
    instrucaoAbertura: params.instrucaoAbertura,
    duracaoParaMuitoLongo:
      params.duracaoReprovadaS !== undefined && params.extrairDuracaoS
        ? { anteriorS: params.duracaoReprovadaS, novaS: params.extrairDuracaoS(dados) }
        : undefined,
    duracaoS: params.extrairDuracaoS?.(dados),
    faixaDuracaoNicho: params.faixaDuracaoNicho,
    palavrasDoMomento: params.palavrasDoMomento,
    formato: params.formato,
    estilo: params.estilo,
    ficha: params.ficha,
    cartoes: params.extrairCartoes?.(dados),
    legenda: params.extrairLegenda?.(dados),
    porQueAssim: params.extrairPorQueAssim?.(dados),
    numerosRegrasPlataforma: params.numerosRegrasPlataforma,
    narrativa: params.extrairNarrativa?.(dados),
  };
}

async function tentarGerarEVerificar<T>(
  params: ParametrosGeracaoVerificada<T>,
): Promise<{ aprovado: boolean; dados: T; motivos: string[]; geracaoId: number }> {
  const inicio = Date.now();
  const resultado = await gerarEstruturado(params);
  const duracaoMs = Date.now() - inicio;

  let dados = resultado.dados;
  let campos = params.extrairCampos(dados);
  let evidencias = params.extrairEvidencias?.(dados) ?? [];
  let local = verificarLocalmente(campos, opcoesVerificacaoLocal(params, dados));

  /**
   * M5b, achado 10 da revisão do motor (01/10/2026): quando a única coisa que reprovou é
   * mecânica (travessão, emoji, ou o conjunto fechado "voce/nao/tambem/ja" sem acento), corrige
   * por código em vez de gastar o modelo forte de novo numa segunda tentativa inteira
   * (`gerarComVerificacao`, abaixo). Só aceita a correção se ela realmente zera os motivos
   * locais; sobrou algum motivo (ou a correção introduziu um novo, caso que não deveria
   * acontecer dado que as três transformações são seguras), segue com os dados originais e o
   * motivo original, para `gerarComVerificacao` decidir a segunda tentativa normalmente.
   */
  if (!local.aprovado && local.motivos.every(ehMotivoMecanico)) {
    const corrigidos = corrigirMecanicamente(dados);
    const camposCorrigidos = params.extrairCampos(corrigidos);
    const localCorrigido = verificarLocalmente(camposCorrigidos, opcoesVerificacaoLocal(params, corrigidos));
    if (localCorrigido.aprovado) {
      dados = corrigidos;
      campos = camposCorrigidos;
      evidencias = params.extrairEvidencias?.(corrigidos) ?? [];
      local = localCorrigido;
    }
  }

  let aprovado = local.aprovado;
  let motivos = local.motivos;

  /**
   * Sem nenhum campo (segunda rodada do PR #42, item 4: a saída vazia do
   * `aprenderCliente`, regra dura 2 do prompt, "sem padrão real, devolva
   * lista vazia"), não há texto nenhum para conferir tom ou proibição: o
   * aprovado local já basta, e chamar `verificarTexto` com uma string vazia
   * só gastaria uma chamada de IA para nada, registrando uma linha de
   * verificação sem sentido em `geracoes_ia`.
   */
  if (aprovado && Object.keys(campos).length > 0) {
    const textoJunto = Object.values(campos).join("\n");
    const verificacao = await gerarEstruturado({
      tarefa: "verificarTexto",
      nivel: verificarTexto.nivel,
      effort: verificarTexto.esforco,
      schema: verificarTexto.schema,
      sistemaEstavel: verificarTexto.montarSistemaEstavel(params.generoTexto, Boolean(params.fontesDosFatos)),
      entrada: verificarTexto.montarEntrada({
        texto: textoJunto,
        proibicoes: params.proibicoes ?? [],
        fontes: params.fontesDosFatos,
      }),
    });
    aprovado = verificacao.dados.aprovado;
    motivos = verificacao.dados.aprovado ? [] : [verificacao.dados.motivo ?? "reprovado"];

    await registrarGeracao({
      tarefa: "verificarTexto",
      versaoPrompt: verificarTexto.versao,
      modelo: verificacao.modelo,
      nivel: verificarTexto.nivel,
      clienteId: params.clienteId,
      entradas: { texto: textoJunto },
      saida: verificacao.dados,
      uso: {
        tokensEntrada: verificacao.tokensEntrada,
        tokensSaida: verificacao.tokensSaida,
        tokensCacheLeitura: verificacao.tokensCacheLeitura,
        tokensCacheEscrita: verificacao.tokensCacheEscrita,
      },
    });
  }

  const geracaoId = await registrarGeracao({
    tarefa: params.tarefa,
    versaoPrompt: params.versaoPrompt,
    modelo: resultado.modelo,
    nivel: params.nivel,
    clienteId: params.clienteId,
    entradas: { entrada: params.entrada },
    evidencias,
    saida: dados as Record<string, unknown>,
    uso: {
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      tokensCacheLeitura: resultado.tokensCacheLeitura,
      tokensCacheEscrita: resultado.tokensCacheEscrita,
    },
    motivoAvaliacao: motivos.length > 0 ? motivos.join("; ") : undefined,
    duracaoMs,
  });

  return { aprovado, dados, motivos, geracaoId };
}

/**
 * M5b, achado 10 da revisão do motor: só reprovações que uma transformação determinística de
 * texto resolve sozinha, sem precisar de nenhum julgamento (jargão, por exemplo, exige escolher
 * uma reformulação, então não entra aqui; o segundo ramo de `problemaDeAcentuacao`, "200
 * caracteres sem nenhum acento", também não, porque não diz onde o acento falta).
 */
function ehMotivoMecanico(motivo: string): boolean {
  return motivo.includes(MOTIVO_TRAVESSAO) || motivo.includes(MOTIVO_EMOJI) || motivo.includes(MOTIVO_PALAVRA_SEM_ACENTO);
}

const EMOJI_GLOBAL = new RegExp(EMOJI.source, "gu");
const SUBSTITUICOES_ACENTO: Record<string, string> = { voce: "você", nao: "não", tambem: "também", ja: "já" };

/**
 * Mesma regra de `temPalavraSemAcento` (preserva o que está entre aspas, ignora sigla toda em
 * maiúsculas), mas substitui em vez de só detectar.
 */
function corrigirAcentuacao(texto: string): string {
  let ultimo = 0;
  let corrigido = "";
  for (const m of texto.matchAll(ENTRE_ASPAS)) {
    corrigido += substituirPalavrasSemAcento(texto.slice(ultimo, m.index));
    corrigido += m[0];
    ultimo = (m.index ?? 0) + m[0].length;
  }
  corrigido += substituirPalavrasSemAcento(texto.slice(ultimo));
  return corrigido;
}

function substituirPalavrasSemAcento(trecho: string): string {
  return trecho.replace(/\b(voce|nao|tambem|ja)\b/gi, (palavra) =>
    palavra === palavra.toUpperCase() ? palavra : SUBSTITUICOES_ACENTO[palavra.toLowerCase()],
  );
}

/**
 * As três correções mecânicas (M5b, achado 10): tira emoji, troca travessão por vírgula (regra 1
 * do CLAUDE.md: "vírgula, dois-pontos ou reformular a frase"; vírgula é a troca mecânica segura) e
 * corrige o conjunto fechado de palavras sem acento. Pura, sobre uma string só.
 */
function corrigirTextoMecanicamente(texto: string): string {
  const semEmoji = texto.replace(EMOJI_GLOBAL, "").replace(/ {2,}/g, " ");
  const semTravessao = semEmoji
    .replaceAll("—", ",")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,([,.;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .replace(/^,\s*/, "")
    .replace(/\s*,$/, "");
  return corrigirAcentuacao(semTravessao).trim();
}

/**
 * Aplica `corrigirTextoMecanicamente` em toda folha de string de uma saída de IA, não importa a
 * forma (roteiro, briefing, tema): percorre objetos e arrays, sem precisar saber o schema de cada
 * tarefa. As três transformações nunca dependem de qual campo é, então são seguras em qualquer
 * folha. Devolve um valor novo, nunca muta `dados`.
 */
function corrigirMecanicamente<T>(dados: T): T {
  return corrigirValorMecanicamente(dados) as T;
}

function corrigirValorMecanicamente(valor: unknown): unknown {
  if (typeof valor === "string") return corrigirTextoMecanicamente(valor);
  if (Array.isArray(valor)) return valor.map(corrigirValorMecanicamente);
  if (valor !== null && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([chave, v]) => [chave, corrigirValorMecanicamente(v)]));
  }
  return valor;
}

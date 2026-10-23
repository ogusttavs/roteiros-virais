/**
 * E52 (PR 3), o roteiro longo no servidor: a escrita de um vídeo do YouTube de mais de três minutos, por capítulos. `gerarConteudoLongo` é o que `gerarConteudo` (`servicos/roteiro.ts`)
 * chama quando o pedido é `duracao: "longo"`: o contexto do cliente já vem montado de lá (perfil, camada exclusiva, modelo do nicho, regras, recentes); aqui entram o que é do longo.
 *
 * 1. **A duração-alvo vem do banco, não de regra fixa** (`medidaDosLongos`, PR 1): a mediana dos vídeos longos do ramo acima do piso, arredondada a 30 segundos. Sem medida (menos de 3 vídeos
 *    longos) o roteiro longo NÃO sai: diz que o ramo ainda não tem longos suficientes, em vez de inventar uma duração (decisão do Fable).
 * 2. **A estrutura de referência** (até 3 vídeos longos do ramo com a leitura `analise_longa`, PR 2) e a estrutura típica medida (quantos capítulos, de que tamanho) entram na entrada.
 * 3. **O código confere o que o modelo pode errar** (`verificarCapitulos`: R-YT-VIDEO-05 a 08 e a soma na duração; mais os pontos curtos e o gancho inteiro de cada capítulo), pelo gancho
 *    do verificador (`verificarExtra`): a tentativa reprovada recebe o motivo na segunda.
 * 4. **O início de cada capítulo é calculado** (a soma das durações antes dele), então "a primeira marcação é 00:00" e "em ordem crescente" valem por construção.
 *
 * Não importa `roteiro.ts` (que o importa): o erro é o próprio, e o chamador o converte em `ErroRoteiro`.
 */
import { and, eq, inArray } from "drizzle-orm";

import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { videos, type ConteudoRoteiro, type Objetivo } from "@/db/schema";
import { NUMEROS_REGRAS_ROTEIRO_LONGO } from "@/ia/prompts/regras-formato";
import type { NoticiaDoAssuntoNaEntrada, PerguntaPresaNaEntrada } from "@/ia/prompts/roteiro";
import * as roteiroLongoIA from "@/ia/prompts/roteiroLongo";
import { gerarComVerificacao, palavrasDeConteudo } from "@/ia/verificador";
import { verificarConformidadeDoLongo } from "@/ia/verificar-copy-roteiro";
import {
  camposCorridosDosCapitulos,
  iniciosDosCapitulos,
  LIMITE_DO_TITULO_DO_VIDEO,
  MAXIMO_DE_CAPITULOS_DO_ROTEIRO,
  PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO,
  PALAVRAS_MAX_POR_PONTO,
  PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO,
  PONTOS_MAX_POR_CAPITULO,
  PONTOS_MIN_POR_CAPITULO,
  somaDosCapitulos,
  verificarCapitulos,
} from "@/lib/capitulos-do-roteiro";
import { config } from "@/lib/config";
import { lerPorQueEmLinhas, limparPorQueDosBlocos } from "@/lib/por-que-do-bloco";
import { limparParaPromptSemAspas } from "@/servicos/noticias-assuntos";
import type { VozNumerada } from "@/servicos/vozes-do-publico";
import { textosRoteiro } from "@/textos/roteiro";

import { ramoAtualDoCliente } from "./ramos";
import { longosDoSetor, type MedidaDosLongos, medirOsLongos, type VideoLongoDoSetor } from "./videos-longos";

/** Erro do roteiro longo com frase pronta para a pessoa; `roteiro.ts` o converte em `ErroRoteiro`. */
export class ErroDoRoteiroLongo extends Error {}

/** O arredondamento da duração-alvo: de 30 em 30 segundos, para a pessoa ler "9 minutos e meio" e não "9 minutos e 17 segundos". */
const PASSO_DA_DURACAO_S = 30;
const MAXIMO_DE_REFERENCIAS = 3;

/**
 * A duração-alvo do roteiro longo a partir da medida do ramo: a mediana, de 30 em 30 segundos, dentro do que ainda é longo (acima do teto dos curtos mais um passo, até o limite do longo). Nula sem medida (amostra abaixo do mínimo): o roteiro
 * não sai.
 */
export function duracaoAlvoDaMedida(medida: MedidaDosLongos): number | null {
  if (medida.forca === "nenhuma" || !medida.duracaoS) return null;
  const arredondada = Math.round(medida.duracaoS.mediana / PASSO_DA_DURACAO_S) * PASSO_DA_DURACAO_S;
  // O arredondamento de uma mediana de 181 s daria 180 s, que já é curto: o piso é o primeiro passo acima do teto dos curtos, o limite de cima é o do longo.
  const piso = config.regras.tetoDuracaoReferenciaS + PASSO_DA_DURACAO_S;
  return Math.min(Math.max(arredondada, piso), config.regras.videoLongoMaxS);
}

/** O que a tela do "Quanto tempo?" precisa saber do ramo: se o vídeo longo pode ser escrito agora e, se pode, com quantos segundos (a duração-alvo, a mesma que o roteiro vai pedir). */
export type DadosDoLongo = { disponivel: boolean; duracaoS: number | null };

/** O longo do ramo para a tela: sem ramo ou sem a medida (menos de três vídeos longos), indisponível; o que a tela diz com calma, antes de a pessoa escrever o tema. */
export async function longoDoRamo(nichoId: number | null, agora: Date = new Date()): Promise<DadosDoLongo> {
  if (!nichoId) return { disponivel: false, duracaoS: null };
  const longos = await longosDoSetor(nichoId, { agora, dias: config.regras.longosMedidaJanelaDias });
  const duracaoS = duracaoAlvoDaMedida(medirOsLongos(longos));
  return { disponivel: duracaoS !== null, duracaoS };
}

/**
 * Diz, ANTES de resolver o tema do dia e de qualquer chamada de IA, se o ramo tem a medida que o roteiro longo pede: sem ela, a frase que a tela mostra (e não a de "não há tema do dia",
 * que seria outro assunto). Não devolve a duração (`gerarConteudoLongo` a calcula de novo, numa leitura só dela): é só a porta.
 */
export async function conferirQueOLongoSai(nichoId: number, agora: Date = new Date()): Promise<void> {
  const longos = await longosDoSetor(nichoId, { agora, dias: config.regras.longosMedidaJanelaDias });
  if (duracaoAlvoDaMedida(medirOsLongos(longos)) === null) throw new ErroDoRoteiroLongo(textosRoteiro.longo.semLongos);
}

function palavras(texto: string): number {
  return texto.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Tudo o que o modelo pode errar no roteiro longo e o código sabe conferir (além dos capítulos: o título, o gancho do vídeo, os pontos curtos e o gancho inteiro de cada capítulo).
 * `tentativa` 2 não exige que a soma chegue perto da duração pedida (a duração do roteiro é a soma que vier, como a faixa de duração dos curtos, que nunca derruba a geração sozinha),
 * mas a soma continua tendo de ser a de um vídeo longo: acima do teto dos curtos e até o limite do longo. As regras do YouTube (capítulos, 10 segundos) valem nas duas.
 */
export function motivosDoRoteiroLongo(saida: roteiroLongoIA.SaidaRoteiroLongo, duracaoAlvoS: number, tentativa: 1 | 2 = 1): string[] {
  const motivos = verificarCapitulos(
    saida.capitulos.map((c) => ({ nome: c.nome, duracaoS: c.duracaoS })),
    duracaoAlvoS,
    { exigirSoma: tentativa === 1, somaMaiorQueS: config.regras.tetoDuracaoReferenciaS, somaAteS: config.regras.videoLongoMaxS },
  );

  if (!saida.titulo.trim()) motivos.push("titulo: vazio");
  else if (Array.from(saida.titulo).length > LIMITE_DO_TITULO_DO_VIDEO) {
    motivos.push(`titulo: ${Array.from(saida.titulo).length} caracteres, o limite e ${LIMITE_DO_TITULO_DO_VIDEO}`);
  } else if (saida.titulo.includes("[") || saida.titulo.includes("]")) {
    motivos.push("titulo: leva espaco marcado entre colchetes; o titulo vai direto para o YouTube, o espaco marcado fica nos pontos");
  }
  if (!saida.gancho.trim()) motivos.push("gancho: vazio, os primeiros 30 segundos entregam o que o titulo prometeu (R-YT-VIDEO-01)");
  if (!saida.chamadaFinal.trim()) motivos.push("chamadaFinal: vazia, o ultimo capitulo fecha com a chamada final");
  if (!saida.miniatura.trim()) motivos.push("miniatura: vazia, diga o que aparece nela e o texto curto, se houver");
  if (!saida.ondeGravar.trim()) motivos.push("ondeGravar: vazio, todo video diz onde gravar");

  saida.capitulos.forEach((c, i) => {
    const n = i + 1;
    const ultimo = i === saida.capitulos.length - 1;
    const pontos = c.pontos.map((p) => p.trim()).filter(Boolean);
    if (pontos.length < PONTOS_MIN_POR_CAPITULO || pontos.length > PONTOS_MAX_POR_CAPITULO) {
      motivos.push(`capitulo ${n}: ${pontos.length} pontos, o capitulo tem de ${PONTOS_MIN_POR_CAPITULO} a ${PONTOS_MAX_POR_CAPITULO} pontos curtos do que falar e mostrar`);
    }
    pontos.forEach((p, j) => {
      if (palavras(p) > PALAVRAS_MAX_POR_PONTO) motivos.push(`capitulo ${n}, ponto ${j + 1}: ${palavras(p)} palavras passam de ${PALAVRAS_MAX_POR_PONTO}; e ponto curto, nao fala escrita`);
    });
    if (!c.naImagem.trim()) motivos.push(`capitulo ${n}: sem o que a camera mostra`);
    if (!c.comoEditar.trim()) motivos.push(`capitulo ${n}: sem como editar`);
    if (!ultimo) {
      const gancho = (c.ganchoParaOProximo ?? "").trim();
      if (!gancho) motivos.push(`capitulo ${n}: sem o gancho para o proximo capitulo`);
      else if (palavras(gancho) < PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO) {
        motivos.push(`capitulo ${n}: o gancho tem ${palavras(gancho)} palavras, e uma frase inteira que segura a pessoa ate o proximo capitulo (de ${PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO} a ${PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO}), nao um rotulo`);
      } else if (palavras(gancho) > PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO) {
        motivos.push(`capitulo ${n}: o gancho tem ${palavras(gancho)} palavras, e uma frase so (ate ${PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO})`);
      }
    }
  });

  return motivos;
}

/** Os campos de texto do roteiro longo que o verificador local e o de texto conferem (travessão, emoji, jargão, proibição, fato): o servidor e o golden set leem os mesmos. */
export function camposDoRoteiroLongo(d: roteiroLongoIA.SaidaRoteiroLongo): Record<string, string> {
  const campos: Record<string, string> = { titulo: d.titulo, miniatura: d.miniatura, gancho: d.gancho, chamadaFinal: d.chamadaFinal, ondeGravar: d.ondeGravar, ritmoDeCorte: d.edicao.ritmoDeCorte };
  d.capitulos.forEach((c, i) => {
    campos[`capitulo${i}Nome`] = c.nome;
    c.pontos.forEach((p, j) => {
      campos[`capitulo${i}Ponto${j}`] = p;
    });
    campos[`capitulo${i}NaImagem`] = c.naImagem;
    campos[`capitulo${i}ComoEditar`] = c.comoEditar;
    if (c.ganchoParaOProximo) campos[`capitulo${i}Gancho`] = c.ganchoParaOProximo;
  });
  d.porQueAssim.forEach((item, i) => {
    campos[`porQueAssim${i}`] = item.motivo;
  });
  d.edicao.textoNaTela.forEach((item, i) => {
    campos[`textoNaTela${i}`] = item.oQue;
  });
  d.edicao.recursos.forEach((r, i) => {
    campos[`recurso${i}`] = r;
  });
  if (d.edicao.audio) campos.audio = d.edicao.audio;
  if (d.edicao.referencia) campos.referenciaOQueOlhar = d.edicao.referencia.oQueOlhar;
  if (d.temaCurto) campos.temaCurto = d.temaCurto;
  return campos;
}

type ReferenciaDoRamo = roteiroLongoIA.ReferenciaLongaNaEntrada;

/** Os vídeos longos do ramo que já têm a leitura da estrutura (`analise_longa`), os mais fora da curva primeiro, para o modelo ver como o ramo estrutura um vídeo longo. */
async function referenciasDoRamo(nichoId: number, doSetor: VideoLongoDoSetor[]): Promise<ReferenciaDoRamo[]> {
  // O Brasil primeiro (E31): entre os que têm leitura, o vídeo brasileiro vem antes do internacional, e dentro de cada grupo a ordem de sempre (os mais fora da curva).
  const comLeitura = doSetor.filter((v) => v.temAnaliseLonga && v.classificacao !== "outro");
  const ids = [...comLeitura.filter((v) => v.classificacao === "brasileiro"), ...comLeitura.filter((v) => v.classificacao !== "brasileiro")]
    .slice(0, MAXIMO_DE_REFERENCIAS)
    .map((v) => v.id);
  if (ids.length === 0) return [];

  const linhas = await db()
    .select({ id: videos.id, titulo: videos.titulo, duracaoS: videos.duracaoS, analise: videos.analiseLonga })
    .from(videos)
    .where(and(inArray(videos.id, ids), eq(videos.nichoId, nichoId)));
  const porId = new Map(linhas.map((l) => [l.id, l]));
  return ids.flatMap((id) => {
    const l = porId.get(id);
    if (!l?.analise) return [];
    const a = l.analise;
    return [
      {
        id: l.id,
        titulo: limparParaPromptSemAspas(l.titulo ?? "", 120),
        duracaoS: l.duracaoS ?? 0,
        abertura: { promessa: limparParaPromptSemAspas(a.abertura.promessa, 200), entregaAteS: a.abertura.entregaAteS },
        capitulos: a.capitulos.map((c) => ({
          inicioS: c.inicioS,
          nome: limparParaPromptSemAspas(c.nome, 80),
          oQueFaz: limparParaPromptSemAspas(c.oQueFaz, 160),
          gancho: c.gancho ? limparParaPromptSemAspas(c.gancho, 160) : null,
        })),
        lacos: a.lacos.map((x) => ({ oQue: limparParaPromptSemAspas(x.oQue, 160) })),
        fechamento: { oQueFaz: limparParaPromptSemAspas(a.fechamento.oQueFaz, 160), apontaParaProximoVideo: a.fechamento.apontaParaProximoVideo },
        tempos: a.origemDosCapitulos === "descricao" ? ("exatos" as const) : ("aproximados" as const),
      },
    ];
  });
}

/** Das regras que o modelo diz ter seguido, só as que existem na lista do roteiro longo (uma citação inventada é descartada, nunca derruba a geração). */
function regrasCitadasQueExistem(itens: { regra: string; motivo: string }[]): { regra: string; motivo: string }[] {
  return itens.filter((item) => NUMEROS_REGRAS_ROTEIRO_LONGO.has(item.regra));
}

/**
 * Do que o modelo escreveu para o que o produto guarda (pura, para provar cada trava): o início de cada capítulo é CALCULADO (a soma das durações antes, o modelo só escreve as
 * durações), o último capítulo nunca guarda gancho, os textos saem aparados, a referência de edição e as evidências são só as que estavam na entrada (um id fora delas é descartado,
 * nunca trocado por outro: é a segunda camada depois do verificador, a mesma da tese "sem evidência não inventa"), e as regras citadas são só as que existem.
 */
export function conteudoDoRoteiroLongo(saida: roteiroLongoIA.SaidaRoteiroLongo, idsDasReferencias: number[]): { conteudo: ConteudoRoteiro; referenciaVideoId: number | null } {
  const idsPermitidos = new Set(idsDasReferencias);
  const medidos = saida.capitulos.map((c) => ({ ...c, duracaoS: Math.round(c.duracaoS) }));
  const inicios = iniciosDosCapitulos(medidos);
  const capitulos = medidos.slice(0, MAXIMO_DE_CAPITULOS_DO_ROTEIRO).map((c, i, todos) => ({
    nome: c.nome.replace(/\s+/g, " ").trim(),
    inicioS: inicios[i],
    duracaoS: c.duracaoS,
    tom: c.tom,
    pontos: c.pontos.map((p) => p.trim()).filter(Boolean),
    naImagem: c.naImagem.trim(),
    ganchoParaOProximo: i === todos.length - 1 ? null : (c.ganchoParaOProximo ?? "").trim() || null,
    comoEditar: c.comoEditar.trim(),
  }));
  const duracaoS = somaDosCapitulos(capitulos);
  const corridos = camposCorridosDosCapitulos(capitulos);

  // O modelo escolhe QUAL vídeo serve de referência, nunca o segundo: o vídeo longo não tem momento-chave medido, e um segundo escrito pelo modelo mandaria a pessoa para um trecho
  // inventado (o mesmo cuidado do curto, PR #88). O segundo é sempre o começo.
  const referenciaDoModelo = saida.edicao.referencia;
  const referenciaEscolhida =
    referenciaDoModelo && referenciaDoModelo.videoId !== null && idsPermitidos.has(referenciaDoModelo.videoId)
      ? { videoId: referenciaDoModelo.videoId, segundo: 0, oQueOlhar: referenciaDoModelo.oQueOlhar }
      : null;
  const semEvidencia = idsDasReferencias.length === 0;

  const conteudo: ConteudoRoteiro = {
    titulo: saida.titulo.trim(),
    duracaoS,
    gancho: saida.gancho.trim(),
    // O resumo dos capítulos em texto corrido: o que o resto do produto que ainda lê gancho, corpo e fechamento (a reescrita, a edição, o texto para colar) enxerga.
    corpo: corridos.corpo,
    fechamento: corridos.fechamento,
    chamadaFinal: saida.chamadaFinal.trim(),
    cartoes: null,
    porQueAssim: regrasCitadasQueExistem(saida.porQueAssim),
    // E50 parte 2, PR 3: o "por quê" do gancho, de cada capítulo, da chamada e de cada frase na tela; o vídeo é só um dos de referência (o segundo é sempre o começo, como na referência de edição).
    porQueDosBlocos: limparPorQueDosBlocos(lerPorQueEmLinhas(saida.porQueDosBlocos), {
      forma: { tipo: "longo", capitulos: capitulos.length, telas: saida.edicao.textoNaTela.length },
      escopo: "longo",
      segundoDosVideos: new Map(idsDasReferencias.map((id) => [id, 0])),
    }),
    // O momento em segundos ("95 segundos"), a forma que os leitores do roteiro (a página, o modo gravação, o PDF e a imagem) leem; a tela do longo usa `capitulos`, com o tempo da lista.
    cenas: corridos.cenas,
    ondeGravar: saida.ondeGravar,
    edicao: {
      textoNaTela: saida.edicao.textoNaTela,
      ritmoDeCorte: saida.edicao.ritmoDeCorte,
      recursos: saida.edicao.recursos,
      audio: saida.edicao.audio,
      referencia: referenciaEscolhida,
    },
    evidencias: semEvidencia ? [] : saida.evidencias.filter((id) => idsPermitidos.has(id)),
    semEvidencia,
    // A referência é do ramo, não do tema: nunca "forte" (vários vídeos sobre o mesmo tema), mas também não "fraca" quando há estrutura lida.
    forcaEvidencia: semEvidencia ? null : "media",
    capitulos,
    miniatura: saida.miniatura.trim(),
  };

  return { conteudo, referenciaVideoId: referenciaEscolhida?.videoId ?? null };
}

export type DadosDoRoteiroLongo = {
  clienteId: number;
  nichoId: number;
  tipo: "negocio" | "pessoa";
  persona?: string | null;
  quemAparece?: string | null;
  perfilCompilado: string;
  camadaExclusiva: string;
  modeloNicho: string;
  regrasCliente: { regra: string; contagem: number }[];
  /** E16, nível conta: o bloco do que rendeu nos vídeos já postados DESTA marca (`desempenhoDaConta`, sem a duração); vazio sem dado suficiente. */
  desempenhoDaConta?: string;
  proibicoes: string[];
  /** 22/10/2026: o tema é da própria pessoa (Tema livre): as proibições do briefing viram aviso, nunca bloqueio. */
  temaDaPessoa?: boolean;
  tema: string;
  objetivo: Objetivo;
  objetivoDoVideo?: string;
  observacao?: string;
  /** O que vale como fato (o perfil, o tema, o momento, a notícia, as vozes do público), montado por quem chama: o verificador reprova o fato afirmado fora disto. */
  fontesDosFatos: string;
  roteirosRecentes: { tema: string; objetivo: Objetivo; status: string; gancho: string }[];
  ganchosUltimos5: string[];
  anguloParaEvitar?: { gancho: string; motivos: string[]; motivoTexto?: string };
  momento?: { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };
  marcaCitada?: { nome: string; perfilCompilado: string };
  noticia?: { titulo: string; resumo: string | null; angulo: string | null };
  noticiasDoAssunto?: NoticiaDoAssuntoNaEntrada[];
  temaDoMomento?: boolean;
  vozesDoPublico?: VozNumerada[];
  lidasEm?: string;
  perguntaPresa?: PerguntaPresaNaEntrada;
  agora?: Date;
};

export type ConteudoLongoGerado = {
  conteudo: ConteudoRoteiro;
  geracaoId: number;
  referenciaVideoId: number | null;
  /** Sempre nulo: a rotação de tipos de abertura é do Reels (`escolherTipoAbertura`); o longo não instrui nem grava tipo, como o Story e o sem fala. */
  tipoAbertura: null;
  temaCurto: string | null;
};

export async function gerarConteudoLongo(dados: DadosDoRoteiroLongo): Promise<ConteudoLongoGerado> {
  const agora = dados.agora ?? new Date();
  // Uma leitura só: a medida e as referências saem da mesma lista (a janela larga da medida, `longosMedidaJanelaDias`).
  const longos = await longosDoSetor(dados.nichoId, { agora, dias: config.regras.longosMedidaJanelaDias });
  const medida = medirOsLongos(longos);
  const duracaoAlvoS = duracaoAlvoDaMedida(medida);
  if (duracaoAlvoS === null || medida.forca === "nenhuma" || !medida.duracaoS) {
    throw new ErroDoRoteiroLongo(textosRoteiro.longo.semLongos);
  }

  const referencias = await referenciasDoRamo(dados.nichoId, longos);
  const idsDasReferencias = referencias.map((r) => r.id);
  // E50 parte 2, PR 4: o ramo de saúde liga o R-CONF-07 também no longo.
  const ramoSaude = ramoPorSlug((await ramoAtualDoCliente(dados.nichoId))?.ramoSlug)?.grupo === "saude";

  const { dados: saida, geracaoId } = await gerarComVerificacao({
    tarefa: "roteiroLongo",
    nivel: roteiroLongoIA.nivel,
    effort: roteiroLongoIA.esforco,
    versaoPrompt: roteiroLongoIA.versao,
    clienteId: dados.clienteId,
    schema: roteiroLongoIA.schema,
    numerosRegrasPlataforma: NUMEROS_REGRAS_ROTEIRO_LONGO,
    sistemaEstavel: roteiroLongoIA.montarSistemaEstavel({
      perfilCompilado: dados.perfilCompilado,
      modeloNicho: dados.modeloNicho,
      camadaExclusiva: dados.camadaExclusiva,
      regrasCliente: dados.regrasCliente,
      desempenhoDaConta: dados.desempenhoDaConta,
      tipo: dados.tipo,
      persona: dados.persona,
      quemAparece: dados.quemAparece,
    }),
    entrada: roteiroLongoIA.montarEntrada({
      tema: dados.tema,
      objetivo: dados.objetivo,
      objetivoDoVideo: dados.objetivoDoVideo,
      observacao: dados.observacao,
      duracaoAlvoS,
      duracaoDoRamo: {
        p25: medida.duracaoS.p25,
        mediana: medida.duracaoS.mediana,
        p75: medida.duracaoS.p75,
        amostra: medida.amostra,
        forca: medida.forca,
      },
      estruturaDoRamo: medida.capitulos,
      titulosDoRamo: medida.titulos.map((t) => limparParaPromptSemAspas(t, 120)),
      referencias,
      roteirosRecentes: dados.roteirosRecentes,
      anguloParaEvitar: dados.anguloParaEvitar,
      momento: dados.momento,
      marcaCitada: dados.marcaCitada,
      noticia: dados.noticia,
      noticiasDoAssunto: dados.noticiasDoAssunto,
      temaDoMomento: dados.temaDoMomento,
      vozesDoPublico: dados.vozesDoPublico,
      lidasEm: dados.lidasEm,
      perguntaPresa: dados.perguntaPresa,
      proibicoesComoAviso: dados.temaDaPessoa ? dados.proibicoes : undefined,
    }),
    fontesDosFatos: dados.fontesDosFatos,
    lembreteFinal: roteiroLongoIA.LEMBRETE_ACENTUACAO,
    proibicoes: dados.proibicoes,
    citarProibicaoVale: dados.temaDaPessoa,
    exigeEvidencia: referencias.length > 0,
    evidenciasFornecidas: idsDasReferencias,
    palavrasDoMomento: dados.momento ? palavrasDeConteudo(`${dados.momento.onde} ${dados.momento.oQueEstaAcontecendo}`) : undefined,
    ganchosRecentes: dados.anguloParaEvitar ? [...dados.roteirosRecentes.map((r) => r.gancho), dados.anguloParaEvitar.gancho] : dados.roteirosRecentes.map((r) => r.gancho),
    ganchosUltimos5: dados.ganchosUltimos5,
    generoTexto: "roteiro",
    extrairPorQueAssim: (d) => regrasCitadasQueExistem(d.porQueAssim),
    extrairCampos: camposDoRoteiroLongo,
    extrairEvidencias: (d) => d.evidencias,
    // E50 parte 2, PR 4: as R-CONF (e só elas) valem também no longo, nas duas tentativas.
    verificarExtra: (d, tentativa) => [...verificarConformidadeDoLongo(d, { fontes: dados.fontesDosFatos, ramoSaude }), ...motivosDoRoteiroLongo(d, duracaoAlvoS, tentativa)],
  });

  const { conteudo, referenciaVideoId } = conteudoDoRoteiroLongo(saida, idsDasReferencias);

  return {
    conteudo,
    geracaoId,
    referenciaVideoId,
    tipoAbertura: null,
    temaCurto: saida.temaCurto,
  };
}

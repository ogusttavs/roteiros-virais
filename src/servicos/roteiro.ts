/**
 * O roteiro (etapa 11, decisões do `PROXIMO.md`, "é o produto"): a partir
 * do tema e do objetivo, monta a entrada com o perfil compilado, o modelo
 * do nicho, a camada exclusiva do cliente e a evidência do banco, chama a
 * tarefa `roteiro` com o verificador, escolhe o vídeo de referência e
 * grava. `reprovarERescrever` (E27, parte 1; antes `outroAngulo`) gera a
 * versão seguinte com a instrução de resolver o motivo da reprovação sem
 * mudar o objetivo; `marcarGravado` e `marcarPostado` avançam o status.
 */
import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { forcaDaEvidencia } from "@/config/forca-evidencia";
import { objetivoDaFicha } from "@/config/fichas";
import { formatoPorChave } from "@/config/formatos";
import { rotuloDoMotivo, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { db } from "@/db";
import {
  ESTILOS_ROTEIRO,
  FORMATOS_ROTEIRO,
  geracoesIA,
  MOMENTOS_DO_DIA,
  planoGravacoes,
  roteiros,
  VALORES_QUEM_GRAVA,
  videosCliente,
  type AindaValeResultado,
  type Cliente,
  type ConteudoRoteiro,
  type EstiloRoteiro,
  type FormatoRoteiro,
  type Momento,
  type MomentoDoDia,
  type Ficha,
  type Objetivo,
  type Plataforma,
  type QuemGrava,
  type TipoAbertura,
} from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ROTULO_FIGURINHA } from "@/ia/enums";
import * as aindaValeIA from "@/ia/prompts/aindaValeRoteiro";
import * as filtrarEvidenciaPorMarca from "@/ia/prompts/filtrarEvidenciaPorMarca";
import { NUMEROS_REGRAS_STORY, regrasDoReels } from "@/ia/prompts/regras-formato";
import * as roteiroIA from "@/ia/prompts/roteiro";
import type { InstrucaoAbertura } from "@/ia/prompts/roteiro";
import { registrarGeracao } from "@/ia/registro";
import { gerarComVerificacao, palavrasDeConteudo } from "@/ia/verificador";
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { comArroba } from "@/lib/perfil-redes";
import { textosRoteiro } from "@/textos/roteiro";

import { regrasAtivasDoCliente } from "./aprendizado";
import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { filtroDeFormatosDaMarca } from "./formatos";
import { noticiaPorId } from "./noticias";
import { leiturasDoCliente } from "./perfis-analisados";
import {
  evidenciaParaRoteiro,
  evidenciaPorIds,
  formatarModeloNicho,
  modeloNichoAtual,
  reguaDoSetor,
  subindoHojeComAnalise,
  type VideoEvidenciaRoteiro,
} from "./pesquisa";
import {
  aplicarProporcaoBrasil,
  classificarBrasil,
  preferirRedePrincipal,
} from "./proporcao-brasil";
import { ramosAlternativosDaMarca } from "./ramos-da-conta";
import { temasParaCliente } from "./temas";

export class ErroRoteiro extends Error {}

/**
 * V9d, item 2: `formato` chega à Server Action como texto livre do navegador, não como o tipo
 * `FormatoRoteiro` (isso é só compilação, o valor de verdade na rede pode ser qualquer coisa).
 * Confere contra `FORMATOS_ROTEIRO` antes de chegar ao banco; `undefined` continua `undefined` (a
 * ausência de formato cai no padrão "reels" mais adiante, em `gerarRoteiro`/`aceitar`).
 */
export function validarFormato(valor: string | undefined): FormatoRoteiro | undefined {
  if (valor === undefined) return undefined;
  if (!(FORMATOS_ROTEIRO as readonly string[]).includes(valor)) {
    throw new ErroRoteiro("formato de roteiro invalido.");
  }
  return valor as FormatoRoteiro;
}

/** M4, item 2: mesmo cuidado de `validarFormato`, para o estilo que chega como texto livre do navegador. */
export function validarEstilo(valor: string | undefined): EstiloRoteiro | undefined {
  if (valor === undefined) return undefined;
  if (!(ESTILOS_ROTEIRO as readonly string[]).includes(valor)) {
    throw new ErroRoteiro("estilo de roteiro invalido.");
  }
  return valor as EstiloRoteiro;
}

/** V12c, item 3: mesmo cuidado de `validarFormato`, para quem aparece que chega como texto livre do navegador. */
export function validarQuemAparece(valor: string | undefined): QuemGrava | undefined {
  if (valor === undefined || valor === "") return undefined;
  if (!(VALORES_QUEM_GRAVA as readonly string[]).includes(valor)) {
    throw new ErroRoteiro("quem aparece invalido.");
  }
  return valor as QuemGrava;
}

/** E39a: mesmo cuidado de `validarFormato`, para o momento do dia (só Story) que chega como texto livre do navegador. */
export function validarMomentoDoDia(valor: string | undefined): MomentoDoDia | undefined {
  if (valor === undefined || valor === "") return undefined;
  if (!(MOMENTOS_DO_DIA as readonly string[]).includes(valor)) {
    throw new ErroRoteiro("momento do dia invalido.");
  }
  return valor as MomentoDoDia;
}

/**
 * E39a: "para quando é?" chega como ISO (`YYYY-MM-DD`) da tela de Criar. Nunca no passado, para
 * não marcar um roteiro num dia que já passou; sem teto, "planeje com a antecedência que quiser".
 */
export function validarData(valor: string | undefined): string | undefined {
  if (valor === undefined || valor === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    throw new ErroRoteiro("data invalida.");
  }
  if (valor < hojeISO()) {
    throw new ErroRoteiro("a data nao pode ser no passado.");
  }
  return valor;
}

const LIMITE_EVIDENCIA = 8;
const DIAS_HISTORICO = 10;
/** V4, item 3 e item 5: quantos roteiros recentes contam para nao repetir tipo de abertura nem primeira palavra do gancho. */
const ULTIMOS_ROTEIROS_PARA_ABERTURA = 5;

const DIA_MS = 24 * 60 * 60 * 1000;
function diasAtras(dias: number): Date {
  return new Date(Date.now() - dias * DIA_MS);
}

export type RoteiroLinha = typeof roteiros.$inferSelect;

/**
 * O texto e a edição do roteiro (a coluna "conteudo" do banco). O nome do
 * helper evita o literal aparecer em `.tsx` (`checar-texto` trata "conteúdo"
 * como jargão de marketing, brief-frontend.md seção 8; o nome da coluna é
 * o termo de domínio certo em `roteiro.ts`, só não pode ecoar em tela).
 */
export function corpoDoRoteiro(roteiro: RoteiroLinha): ConteudoRoteiro {
  return roteiro.conteudo;
}

function splitParagrafos(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

type BlocoReels = "abertura" | "meio" | "fechamento" | "chamada";

/** Até quantos segundos do início um `quando` ainda conta como abertura (revisão do PR #62, item 1). */
const LIMIAR_ABERTURA_S = 3;
/** A partir de que fração da duração um `quando` já conta como chamada final. */
const FRACAO_CHAMADA = 0.85;
/** A partir de que fração da duração um `quando` já conta como fechamento. */
const FRACAO_FECHAMENTO = 0.65;

/**
 * O primeiro número do `quando` livre (revisão do PR #62, item 1: conferido
 * no banco de produção, os 30 itens de `edicao.textoNaTela` dos cinco
 * roteiros de Reels vieram sempre em segundos, "0 a 5 segundos", "8s a 12s",
 * "26 segundos", nunca com as palavras que a primeira versão desta rodada
 * tentava casar). `null` sem nenhum número ("Do começo ao fim", "legenda o
 * tempo todo").
 */
function primeiroSegundo(quando: string): number | null {
  const numero = /\d+/.exec(quando);
  return numero ? Number(numero[0]) : null;
}

/** Em qual dos quatro blocos um segundo cai, pela posição dentro da duração do roteiro (revisão do PR #62, item 1). */
function blocoDoSegundo(segundo: number, duracaoS: number): BlocoReels {
  if (segundo <= LIMIAR_ABERTURA_S) return "abertura";
  if (segundo >= duracaoS * FRACAO_CHAMADA) return "chamada";
  if (segundo >= duracaoS * FRACAO_FECHAMENTO) return "fechamento";
  return "meio";
}

/**
 * O que mostrar num bloco de Reels (V11, item 6b; casamento por posição
 * desde a revisão do PR #62, item 1, não mais por palavra-chave): um item
 * sem número no `quando` sempre cai na abertura, com o `quando` na frente da
 * linha (`textosRoteiro.mostrar.textoNaTela`).
 */
function mostrarNoBlocoReels(
  edicao: ConteudoRoteiro["edicao"],
  duracaoS: number,
  bloco: BlocoReels,
): string[] {
  return edicao.textoNaTela
    .filter((item) => {
      const segundo = primeiroSegundo(item.quando);
      return segundo === null ? bloco === "abertura" : blocoDoSegundo(segundo, duracaoS) === bloco;
    })
    .map((item) => textosRoteiro.mostrar.textoNaTelaComQuando(item.quando, item.oQue));
}

/** O que mostrar num cartão de Story (V11, item 6a): sempre as três linhas, a figurinha só quando pedida. */
function mostrarNoCartao(cartao: NonNullable<ConteudoRoteiro["cartoes"]>[number]): string[] {
  const linhas = [
    textosRoteiro.mostrar.oQueMostrar(cartao.oQueMostrar),
    textosRoteiro.mostrar.textoNaTela(cartao.textoNaTela),
  ];
  if (cartao.figurinha !== "nenhuma") {
    linhas.push(textosRoteiro.mostrar.figurinha(ROTULO_FIGURINHA[cartao.figurinha]));
  }
  return linhas;
}

/**
 * O roteiro em blocos de leitura, um por vez (V9c, item 4): em Reels, os
 * quatro de sempre (gancho, corpo, fechamento, chamada); em Story, um bloco
 * por cartão, com o que falar. `mostrar` (V11, item 6) é o que mostrar
 * enquanto grava aquele bloco, menor que a fala e nunca competindo com ela
 * (modo gravação, `GravacaoTela.tsx`); o PDF e `RoteiroTela.tsx` continuam
 * como estão, ignoram o campo. Usada por `RoteiroTela.tsx`,
 * `/roteiros/[id]/gravar` e `/roteiros/[id]/imprimir`.
 */
export function blocosParaLeitura(
  roteiro: RoteiroLinha,
): { rotulo: string; paragrafos: string[]; mostrar?: string[] }[] {
  const corpo = corpoDoRoteiro(roteiro);
  /**
   * M4, item 5: sem fala sempre usa `cartoes` (a mesma estrutura de Story), nos dois formatos, por
   * isso o estilo decide antes do formato. Sem fala não tem campo de fala: `paragrafos` fica vazio
   * (o modo de leitura mostra só o que tem; `mostrarNoCartao` já junta o que mostrar e o texto na
   * tela, as duas coisas que existem aqui).
   */
  if (roteiro.estilo === "sem_fala" && corpo.cartoes) {
    return corpo.cartoes.map((cartao, indice) => ({
      rotulo: textosRoteiro.blocos.cena(indice + 1, corpo.cartoes!.length),
      paragrafos: [],
      mostrar: mostrarNoCartao(cartao),
    }));
  }
  if (roteiro.formato === "story" && corpo.cartoes) {
    return corpo.cartoes.map((cartao, indice) => ({
      rotulo: textosRoteiro.blocos.story(indice + 1, corpo.cartoes!.length),
      paragrafos: [cartao.oQueFalar],
      mostrar: mostrarNoCartao(cartao),
    }));
  }
  return [
    {
      rotulo: textosRoteiro.blocos.abertura,
      paragrafos: [corpo.gancho],
      mostrar: mostrarNoBlocoReels(corpo.edicao, corpo.duracaoS, "abertura"),
    },
    {
      rotulo: textosRoteiro.blocos.meio,
      paragrafos: splitParagrafos(corpo.corpo),
      mostrar: mostrarNoBlocoReels(corpo.edicao, corpo.duracaoS, "meio"),
    },
    {
      rotulo: textosRoteiro.blocos.fechamento,
      paragrafos: splitParagrafos(corpo.fechamento),
      mostrar: mostrarNoBlocoReels(corpo.edicao, corpo.duracaoS, "fechamento"),
    },
    {
      rotulo: textosRoteiro.blocos.chamada,
      paragrafos: [corpo.chamadaFinal],
      mostrar: mostrarNoBlocoReels(corpo.edicao, corpo.duracaoS, "chamada"),
    },
  ];
}

/**
 * E40, item 1: o texto narrativo de um `ConteudoRoteiro`, achatado numa string só, para comparar
 * a versão original com a editada (`aprender-cliente`, o sinal de edição). Mesma ordem de
 * `blocosParaLeitura`, sem o `mostrar` do modo gravação, que não é texto que a pessoa edita.
 */
export function textoNarrativo(
  conteudo: ConteudoRoteiro,
  formato: FormatoRoteiro,
  estilo: EstiloRoteiro,
): string {
  if (estilo === "sem_fala" && conteudo.cartoes) {
    const cenas = conteudo.cartoes.map((c) => `${c.oQueMostrar}\n${c.textoNaTela}`).join("\n\n");
    return conteudo.legenda ? `${cenas}\n\n${conteudo.legenda}` : cenas;
  }
  if (formato === "story" && conteudo.cartoes) {
    return conteudo.cartoes.map((c) => c.oQueFalar).join("\n\n");
  }
  return [conteudo.gancho, conteudo.corpo, conteudo.fechamento, conteudo.chamadaFinal].join("\n\n");
}

export type OrigemRoteiro =
  | { origem: "sugerido"; temaIndice: number }
  | { origem: "livre"; textoTema: string }
  /**
   * V9a, item 1: a pessoa contou o momento (por áudio ou por texto) em vez
   * de escolher ou escrever um tema; `momento` é a mesma forma gravada em
   * `roteiros.momento`. Quem confere que a pessoa é membro da marca citada
   * (`momento.marcaId`, item 4) é a Server Action, via
   * `garantirMembroDaMarca`, antes de chamar `gerarRoteiro`; este serviço
   * só resolve o nome e o perfil dela (`marcaCitadaPorId`, abaixo), sem
   * saber de sessão.
   */
  | { origem: "momento"; momento: Momento };

/** V9c, item 1: "reels" (padrão) se ausente, para quem chama de antes da etapa continuar valendo. */
export type ParametrosGerarRoteiro = OrigemRoteiro & {
  objetivo: Objetivo;
  /**
   * E49 PR 1: a ficha do "O que você quer que esse vídeo faça?", só Reels. Quando vem, ela decide o `objetivo` que se grava (`objetivoDaFicha`) e a estrutura do roteiro; no
   * Story é ignorada (o Story não pergunta). Ausente: o objetivo de sempre, sem ficha.
   */
  ficha?: Ficha | null;
  observacao?: string;
  formato?: FormatoRoteiro;
  /** M4, item 2: "falado" (padrão) se ausente. */
  estilo?: EstiloRoteiro;
  /** E39a: para quando é, ISO (hoje, padrão, se ausente). */
  data?: string;
  /** E39a: em que momento do dia, só para Story. */
  momentoDoDia?: MomentoDoDia;
  /**
   * E40, item 2: "o que este vídeo precisa comunicar?", opcional. Com `origem: "momento"`, o
   * campo vem de `momento.objetivoDoVideo` em vez deste (a folha do momento já guarda os dois
   * juntos); este só serve a origem `sugerido` e `livre`.
   */
  objetivoDoVideo?: string;
  /**
   * V12c, item 3, a E37b: quem aparece NESTE vídeo, só quando a pessoa trocou na folha
   * "Gravar agora" ou no passo do objetivo. Ausente usa o `quemGrava` do briefing
   * (`resolverQuemAparece`, abaixo); a troca vale só para este roteiro, o briefing não muda.
   */
  quemAparece?: QuemGrava;
  /**
   * E43: presente quando o tema nasceu de "Criar vídeo com esta notícia" (Tema livre, estado
   * `comNoticia`). Resolvida aqui, escopada pelo nicho do cliente, nunca confiando num id de outro
   * setor vindo do client; `origem` continua `"livre"` (é o mesmo fluxo de tema livre, só com um
   * ponto de partida), a notícia vira um campo próprio em vez de uma quarta origem.
   */
  noticiaId?: number;
};

/**
 * V12c, item 3: o valor efetivo para ESTE roteiro, nunca escrito no cliente. `undefined` quando
 * nem o roteiro nem o briefing têm um valor (cliente nunca passou pela tela de dados fixos).
 */
function resolverQuemAparece(override: QuemGrava | undefined, cliente: Cliente): QuemGrava | undefined {
  return override ?? cliente.quemGrava ?? undefined;
}

/**
 * A camada exclusiva do cliente (alcance, região, concorrentes, perfis
 * admirados) para o bloco estável do prompt (etapa 11, decisão 1): decisão
 * adiada na etapa 10 porque, ali, só o tema e a nota importam; aqui, região
 * e concorrente mudam de verdade a cena e o gancho.
 *
 * V12c, item 1, a E37b: cidade e bairro saíram da tela; `alcance` e `regiao`
 * mandam agora. Cliente sem `alcance` (nunca passou pela tela nova, ou
 * migrado sem cidade) não entra na camada, como antes.
 */
/**
 * E38, partes 2 e 3: a leitura curta de um perfil citado ou da própria marca, conferido de
 * verdade na API (`perfisAnalisados`); `undefined`/erro nunca entra aqui, só o que a API confirmou.
 */
export type LeituraPerfilExclusiva = { handle: string; leitura: string };

export function formatarCamadaExclusiva(
  cliente: Pick<Cliente, "alcance" | "regiao" | "pais" | "paises" | "camadaExclusiva">,
  leiturasPerfis: LeituraPerfilExclusiva[] = [],
): string {
  const linhas: string[] = [];
  if (cliente.alcance === "local" && cliente.regiao) {
    linhas.push(`Região: ${cliente.regiao}.`);
  } else if (cliente.alcance === "brasil") {
    linhas.push("Vende para o Brasil inteiro: não cite cidade nem bairro, nem fale como negócio de bairro.");
  } else if (cliente.alcance === "outro_pais" && cliente.pais) {
    // E42a, item 1: o motor nao muda nesta etapa (a pesquisa de video continua so no Brasil), so o
    // roteiro sabe para quem a pessoa esta falando.
    linhas.push(`Público no exterior, em ${cliente.pais}: não cite cidade nem bairro do Brasil.`);
  } else if (cliente.alcance === "mais_de_um_pais" && cliente.paises) {
    linhas.push(`Público no exterior, em mais de um país (${cliente.paises}): não cite cidade nem bairro do Brasil.`);
  }
  if (cliente.camadaExclusiva.concorrentes.length > 0) {
    linhas.push(
      `Concorrente citado pelo cliente: ${cliente.camadaExclusiva.concorrentes.join(", ")}.`,
    );
  }
  if (cliente.camadaExclusiva.perfisAdmirados.length > 0) {
    linhas.push(
      `Perfil que o cliente admira: ${cliente.camadaExclusiva.perfisAdmirados.join(", ")}.`,
    );
  }
  for (const leitura of leiturasPerfis) {
    linhas.push(`Sobre ${comArroba(leitura.handle)}: ${leitura.leitura}`);
  }
  return linhas.length > 0
    ? linhas.join(" ")
    : "nenhum dado exclusivo deste cliente registrado ainda.";
}

/**
 * Nome e perfil compilado da marca que a pessoa citou durante o momento
 * (V9a, item 4, `momento.marcaId`). `undefined` sem `marcaId`, ou se a marca
 * ou o perfil dela sumiram entretanto (nunca derruba a geração por isso, o
 * roteiro sai sem a camada secundária). Quem confere que a pessoa é membro
 * dela é a Server Action, antes de chegar aqui (ver `OrigemRoteiro`).
 */
async function marcaCitadaPorId(
  marcaId: number | undefined,
): Promise<{ nome: string; perfilCompilado: string } | undefined> {
  if (!marcaId) return undefined;
  const marca = await clientePorId(marcaId);
  if (!marca) return undefined;
  const perfil = await perfilDoCliente(marcaId);
  if (!perfil) return undefined;
  return { nome: marca.nome, perfilCompilado: formatarPerfilCompilado(perfil) };
}

/**
 * H4, item 1 (achado do Gustavo em produção em 01/10, o caso do roteiro 12: a referência
 * escolhida por código, pelo maior múltiplo, saiu um meme sem nada a ver com o roteiro, "a
 * referência é um meme e o Bruno nunca faria um vídeo desse"). Antes disto, `escolherReferencia`
 * decidia em código, pelo maior fora da curva; agora o modelo devolve qual vídeo de fato usou
 * como modelo de estrutura (`edicao.referencia.videoId`), ou nulo quando nenhum serve, e o
 * código só confere que o id pertence à evidência fornecida, nunca escolhe por conta própria.
 * Referência errada é pior que referência nenhuma: um id fora da lista (alucinado) ou nenhuma
 * referência devolvida vira "sem referência" (a tela já tem esse estado), nunca um id trocado
 * por outro.
 */
function validarReferenciaDoModelo(
  referencia: roteiroIA.SaidaRoteiro["edicao"]["referencia"],
  evidencias: VideoEvidenciaRoteiro[],
): { videoId: number; segundo: number; oQueOlhar: string } | null {
  if (!referencia || referencia.videoId === null) return null;
  const video = evidencias.find((e) => e.id === referencia.videoId);
  if (!video) return null;
  /**
   * Revisão do Fable no PR #88: o modelo escolhe QUAL vídeo, nunca o segundo. O segundo só existe
   * quando a análise visual do vídeo tem um momento chave (medido no vídeo de verdade); sem isso é
   * 0, e a tela não mostra "o trecho começa em". Um segundo inventado mandaria a pessoa para um
   * ponto do vídeo que não tem nada.
   */
  const momento = video.analiseVisual?.momentoChave;
  if (momento) return { videoId: video.id, segundo: momento.segundo, oQueOlhar: momento.oQue };
  return { videoId: video.id, segundo: 0, oQueOlhar: referencia.oQueOlhar || video.gancho };
}

/**
 * H4, item 3 (achado do Gustavo em produção em 01/10, o mesmo caso do roteiro 12): depois que a
 * evidência do roteiro já está pronta (`combinarEvidencias`), um filtro barato tira o que fere
 * uma proibição do briefing ou destoa do tom da pessoa, antes da geração forte usar essa lista
 * (tema do dia, roteiro e referência, item 1). Falha no filtro nunca derruba a geração: sem o
 * filtro, o roteiro sai como antes desta etapa (evidência sem o encaixe de marca conferido),
 * nunca sem roteiro nenhum, mesmo raciocínio de `marcaCitadaPorId`.
 */
async function filtrarEvidenciaPelaMarca(
  evidencias: VideoEvidenciaRoteiro[],
  perfilCompilado: string,
  clienteId: number,
): Promise<VideoEvidenciaRoteiro[]> {
  if (evidencias.length === 0) return evidencias;
  try {
    const resultado = await gerarEstruturado({
      tarefa: "filtrarEvidenciaPorMarca",
      nivel: filtrarEvidenciaPorMarca.nivel,
      effort: filtrarEvidenciaPorMarca.esforco,
      schema: filtrarEvidenciaPorMarca.schema,
      sistemaEstavel: filtrarEvidenciaPorMarca.montarSistemaEstavel(),
      entrada: filtrarEvidenciaPorMarca.montarEntrada({
        perfilCompilado,
        evidencias: evidencias.map((v) => ({ id: v.id, assunto: v.assunto, gancho: v.gancho })),
      }),
    });

    await registrarGeracao({
      tarefa: "filtrarEvidenciaPorMarca",
      versaoPrompt: filtrarEvidenciaPorMarca.versao,
      modelo: resultado.modelo,
      nivel: filtrarEvidenciaPorMarca.nivel,
      clienteId,
      entradas: { evidenciasIds: evidencias.map((v) => v.id) },
      saida: resultado.dados,
      uso: {
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida,
        tokensCacheLeitura: resultado.tokensCacheLeitura,
        tokensCacheEscrita: resultado.tokensCacheEscrita,
      },
    });

    const aprovados = new Set(resultado.dados.aprovados);
    return evidencias.filter((v) => aprovados.has(v.id));
  } catch (falha) {
    logger.error({ err: falha, clienteId }, "nao foi possivel filtrar a evidencia pela marca");
    return evidencias;
  }
}

type EvidenciaParaAbertura = {
  tipoAbertura: TipoAbertura | null;
  foraDaCurva: number;
  contaBrasileira: boolean;
  gancho: string;
};

/** Maior múltiplo primeiro, brasileiro antes em caso de empate (V4, item 3c: "a evidência mais forte"). */
function compararForcaDeAbertura(a: EvidenciaParaAbertura, b: EvidenciaParaAbertura): number {
  if (b.foraDaCurva !== a.foraDaCurva) return b.foraDaCurva - a.foraDaCurva;
  return Number(b.contaBrasileira) - Number(a.contaBrasileira);
}

function melhorEvidenciaDoTipo(
  evidencias: readonly EvidenciaParaAbertura[],
  tipo: TipoAbertura,
): EvidenciaParaAbertura | undefined {
  return evidencias.filter((e) => e.tipoAbertura === tipo).sort(compararForcaDeAbertura)[0];
}

/** (c): dos tipos disponíveis, o que tem a evidência mais forte. */
function melhorTipo(
  candidatos: readonly TipoAbertura[],
  evidencias: readonly EvidenciaParaAbertura[],
): TipoAbertura {
  const comEvidencia = candidatos
    .map((tipo) => ({ tipo, evidencia: melhorEvidenciaDoTipo(evidencias, tipo)! }))
    .sort((a, b) => compararForcaDeAbertura(a.evidencia, b.evidencia));
  return comEvidencia[0].tipo;
}

/**
 * (d): nenhum tipo da evidência sobrou fora dos últimos usados, libera o
 * usado há mais tempo, ou seja, o candidato cuja ocorrência mais recente em
 * `ultimosTipos` (mais recente primeiro) está mais para trás.
 */
function tipoUsadoHaMaisTempo(
  ultimosTipos: readonly (TipoAbertura | null)[],
  candidatos: readonly TipoAbertura[],
): TipoAbertura {
  let melhor = candidatos[0];
  let melhorIndice = -1;
  for (const tipo of candidatos) {
    const indice = ultimosTipos.findIndex((t) => t === tipo);
    if (indice > melhorIndice) {
      melhorIndice = indice;
      melhor = tipo;
    }
  }
  return melhor;
}

/**
 * A abertura do próximo roteiro, escopo 5.12 item 7 e `PROXIMO.md`, item 3:
 * (a) os tipos presentes na evidência de hoje, (b) tira os já usados nos
 * últimos roteiros do cliente, (c) dos que sobram, o de evidência mais
 * forte, (d) sem nenhum sobrando, libera o usado há mais tempo, (e) sem
 * nenhuma evidência tipada (nicho novo), só a lista do que evitar. Pura,
 * testada com tabela de casos.
 */
export function escolherTipoAbertura(
  evidencias: readonly EvidenciaParaAbertura[],
  ultimosTipos: readonly (TipoAbertura | null)[],
): InstrucaoAbertura {
  const tiposNaEvidencia = [
    ...new Set(evidencias.map((e) => e.tipoAbertura).filter((t): t is TipoAbertura => t !== null)),
  ];
  const usadosRecentes = new Set(ultimosTipos.filter((t): t is TipoAbertura => t !== null));

  if (tiposNaEvidencia.length === 0) {
    return { tipo: null, tiposProibidos: [...usadosRecentes] };
  }

  const disponiveis = tiposNaEvidencia.filter((t) => !usadosRecentes.has(t));
  const tipoEscolhido =
    disponiveis.length > 0
      ? melhorTipo(disponiveis, evidencias)
      : tipoUsadoHaMaisTempo(ultimosTipos, tiposNaEvidencia);

  const exemplo = melhorEvidenciaDoTipo(evidencias, tipoEscolhido);
  return { tipo: tipoEscolhido, ganchoExemplo: exemplo?.gancho ?? null };
}

/**
 * Os ids já vetados pelo tema do dia entram primeiro; junta com a busca sem
 * duplicar, prefere a rede principal da marca sem excluir as outras (V12,
 * item 3a), e a proporção 70/30 (V2b, item 6) faz o corte final para o
 * `limite` de verdade, no lugar do corte simples por tamanho que havia
 * antes. O loop não para mais em `limite` (achado ao implementar a
 * proporção): parar cedo tiraria candidato brasileiro da busca que a
 * proporção poderia ter preferido no lugar de um internacional que "chegou
 * primeiro" na lista prevista.
 */
/** M4, item 3: "preferência por referência sem fala", mesmo espírito de `preferirRedePrincipal`. */
function preferirSemFala(itens: VideoEvidenciaRoteiro[]): VideoEvidenciaRoteiro[] {
  const preferidos = itens.filter((v) => v.semFala === true);
  const outros = itens.filter((v) => v.semFala !== true);
  return [...preferidos, ...outros];
}

function combinarEvidencias(
  prevista: VideoEvidenciaRoteiro[],
  daBusca: VideoEvidenciaRoteiro[],
  limite: number,
  proporcaoBrasil: number,
  redePrincipal: Plataforma | null,
  /** M4, item 3: evidência obrigatória igual ao falado, com preferência por referência sem fala. */
  estilo: EstiloRoteiro,
): VideoEvidenciaRoteiro[] {
  const combinado = [...prevista];
  const idsJaIncluidos = new Set(prevista.map((v) => v.id));
  for (const video of daBusca) {
    if (idsJaIncluidos.has(video.id)) continue;
    combinado.push(video);
    idsJaIncluidos.add(video.id);
  }
  const preferido = preferirRedePrincipal(
    estilo === "sem_fala" ? preferirSemFala(combinado) : combinado,
    redePrincipal,
    (v) => v.plataforma,
  );
  return aplicarProporcaoBrasil(
    preferido,
    limite,
    (v) => classificarBrasil(v.idioma, v.contaBrasileira),
    proporcaoBrasil,
  );
}

/**
 * O tema (texto) e, para um tema sugerido, os ids de evidência que
 * `temasDoDia` já validou. "sugerido" usa o índice do tema do dia do
 * cliente (hipótese mais simples: não existe uma tabela por tema, só o
 * array de três do dia; registrado como decisão em `TODO.md`, etapa 11).
 */
async function resolverTema(
  cliente: Cliente,
  params: ParametrosGerarRoteiro,
): Promise<{ tema: string; evidenciasPrevistas: number[] }> {
  if (params.origem === "livre") {
    return { tema: params.textoTema, evidenciasPrevistas: [] };
  }

  /**
   * V9a, item 1: o tema de verdade só existe depois de gerar (o `temaCurto`
   * que o modelo devolve, `gerarConteudo` usa para regravar `tema` em
   * `gerarRoteiro`). Este aqui é só um valor provisório, para o caso raro
   * do modelo devolver `temaCurto` nulo; nunca entra na entrada da IA
   * (`montarEntrada` pula a linha "Tema escolhido" com `momento`).
   */
  if (params.origem === "momento") {
    const resumo = params.momento.oQueEstaAcontecendo.trim().slice(0, 80);
    return { tema: resumo || "o momento que você descreveu", evidenciasPrevistas: [] };
  }

  const resultado = await temasParaCliente(cliente);
  if (resultado.status !== "ok") {
    throw new ErroRoteiro("nao ha tema do dia disponivel para este cliente.");
  }
  const tema = resultado.temas[params.temaIndice];
  if (!tema) {
    throw new ErroRoteiro("tema nao encontrado para o indice pedido.");
  }
  return { tema: tema.titulo, evidenciasPrevistas: tema.evidencias };
}

/**
 * Dos últimos `dias` dias, com o gancho de cada um (achado do primeiro uso no
 * iPad, item 3: o roteiro do dia 2 começou igual ao do dia 1 porque esta
 * consulta nunca levava o gancho, só título, objetivo e status, e o modelo
 * não tinha como saber qual frase de abertura já foi usada). Por dias corridos
 * em vez de contagem fixa, para o histórico crescer com o cliente sem um
 * número escolhido a dedo.
 */
type RoteiroRecente = {
  tema: string;
  objetivo: Objetivo;
  status: string;
  gancho: string;
  origem: OrigemRoteiro["origem"];
};

async function historicoDeRoteiros(clienteId: number, dias: number): Promise<RoteiroRecente[]> {
  const linhas = await db()
    .select({
      tema: roteiros.tema,
      objetivo: roteiros.objetivo,
      status: roteiros.status,
      conteudo: roteiros.conteudo,
      origem: roteiros.origem,
    })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.criadoEm, diasAtras(dias))))
    .orderBy(desc(roteiros.criadoEm));

  return linhas.map((r) => ({
    tema: r.tema,
    objetivo: r.objetivo,
    status: r.status,
    gancho: r.conteudo.gancho,
    origem: r.origem,
  }));
}

/**
 * Os últimos `ULTIMOS_ROTEIROS_PARA_ABERTURA` roteiros do cliente, por
 * contagem (não por dia, ao contrário de `historicoDeRoteiros`), mais
 * recente primeiro (V4, itens 3 e 5): de onde `escolherTipoAbertura` lê o
 * que não repetir, e de onde sai o gancho para a checagem da primeira
 * palavra no verificador. Escopado por `clienteId`, que já é a marca ativa
 * (item 7c: nunca mistura com outra marca do mesmo login).
 */
async function ultimosRoteirosParaAbertura(
  clienteId: number,
): Promise<{ tipoAbertura: TipoAbertura | null; gancho: string }[]> {
  const linhas = await db()
    .select({ tipoAbertura: roteiros.tipoAbertura, conteudo: roteiros.conteudo })
    .from(roteiros)
    .where(eq(roteiros.clienteId, clienteId))
    .orderBy(desc(roteiros.criadoEm))
    .limit(ULTIMOS_ROTEIROS_PARA_ABERTURA);

  return linhas.map((r) => ({ tipoAbertura: r.tipoAbertura, gancho: r.conteudo.gancho }));
}

/** Todas as versões da mesma série (etapa 11, decisão 4): a raiz e quem aponta para ela. */
async function buscarSerie(raizId: number): Promise<RoteiroLinha[]> {
  return db()
    .select()
    .from(roteiros)
    .where(or(eq(roteiros.id, raizId), eq(roteiros.versaoDe, raizId)))
    .orderBy(desc(roteiros.versao));
}

/**
 * Campos de texto do roteiro que passam pelo verificador (regra dura 4: sem
 * jargão, emoji, travessão). Exportada para `scripts/avaliar-roteiros.ts`
 * rodar a mesma checagem que a produção usa (dia 1 da etapa 14, item 5).
 */
export function extrairCamposRoteiro(dados: roteiroIA.SaidaRoteiro): Record<string, string> {
  const campos: Record<string, string> = {
    titulo: dados.titulo,
    ondeGravar: dados.ondeGravar,
    ritmoDeCorte: dados.edicao.ritmoDeCorte,
  };
  // V9c, item 2: nulos em Story (o texto de verdade está em cartoes, abaixo).
  if (dados.gancho) campos.gancho = dados.gancho;
  if (dados.corpo) campos.corpo = dados.corpo;
  if (dados.fechamento) campos.fechamento = dados.fechamento;
  if (dados.chamadaFinal) campos.chamadaFinal = dados.chamadaFinal;
  dados.cartoes?.forEach((cartao, i) => {
    campos[`cartao${i}Falar`] = cartao.oQueFalar;
    campos[`cartao${i}Mostrar`] = cartao.oQueMostrar;
    campos[`cartao${i}TextoNaTela`] = cartao.textoNaTela;
  });
  dados.porQueAssim.forEach((item, i) => {
    campos[`porQueAssim${i}`] = item.motivo;
  });
  dados.cenas.forEach((cena, i) => {
    campos[`cena${i}`] = cena.oQueFazer;
  });
  dados.edicao.textoNaTela.forEach((item, i) => {
    campos[`textoNaTela${i}`] = item.oQue;
  });
  dados.edicao.recursos.forEach((recurso, i) => {
    campos[`recurso${i}`] = recurso;
  });
  if (dados.edicao.audio) campos.audio = dados.edicao.audio;
  if (dados.edicao.referencia) campos.referenciaOQueOlhar = dados.edicao.referencia.oQueOlhar;
  if (dados.temaCurto) campos.temaCurto = dados.temaCurto;
  // M4: só no estilo sem fala (o verificador de texto confere jargão, emoji e travessão aqui também).
  if (dados.legenda) campos.legenda = dados.legenda;
  return campos;
}

type MontarERoteiroDados = {
  clienteId: number;
  cliente: Cliente;
  tema: string;
  objetivo: Objetivo;
  /** E49 PR 1: a ficha, só no Reels; dirige a estrutura do pedido e o verificador. */
  ficha?: Ficha | null;
  /** V9c, item 1: "reels" ou "story"; troca o bloco de estrutura do prompt e o verificador por regra. */
  formato: FormatoRoteiro;
  /** M4, item 2: "falado" ou "sem_fala", ortogonal ao formato; troca o bloco de estrutura e o verificador. */
  estilo: EstiloRoteiro;
  /** E40, item 2: "o que este vídeo precisa comunicar?", opcional; entra no prompt acima do tema. */
  objetivoDoVideo?: string;
  /** V12c, item 3, a E37b: override deste roteiro; `undefined` usa o `quemGrava` do cliente. */
  quemAparece?: QuemGrava;
  observacao?: string;
  evidenciasPrevistas: number[];
  /**
   * A versão reprovada (E27, parte 1): `motivosIds` são os ids de
   * `MOTIVOS_REPROVACAO` (fonte da verdade para a lógica de código, como o
   * verificador de duração); `montarEntrada` recebe os rótulos deles, nunca
   * os ids. `duracaoAnteriorS` só importa com o motivo "muito_longo".
   */
  anguloParaEvitar?: {
    gancho: string;
    corpo: string;
    motivosIds: IdMotivoReprovacao[];
    motivoTexto?: string;
    duracaoAnteriorS: number;
  };
  /**
   * V9a, item 1: presente só quando `origem = "momento"`. Faz `gerarConteudo`
   * pular a busca de evidência inteira (nunca chama `evidenciaParaRoteiro`
   * nem `evidenciaPorIds`), forçar `semEvidencia` e `forcaEvidencia: "media"`
   * (a cena descrita é a própria evidência, não um vídeo do banco), e passar
   * o bloco do momento e o contexto de série para o prompt.
   */
  momento?: Momento;
  /**
   * E43: presente quando o tema nasceu de "Criar vídeo com esta notícia". Ao contrário do
   * momento, não muda a busca de evidência (continua normal, pelo tema); só acrescenta o bloco da
   * notícia na entrada do prompt.
   */
  noticia?: { titulo: string; resumo: string | null; angulo: string | null };
};

/** O miolo comum a `gerarRoteiro` e `outroAngulo`: busca contexto, chama a IA, monta o conteúdo. */
async function gerarConteudo(dados: MontarERoteiroDados): Promise<{
  conteudo: ConteudoRoteiro;
  geracaoId: number;
  referenciaVideoId: number | null;
  /** Nulo em Story (V9c, item 2): `escolherTipoAbertura` (V4) não se aplica a este formato. */
  tipoAbertura: TipoAbertura | null;
  /** V9a, item 1: o `temaCurto` que o modelo devolveu, só com `momento`; `gerarRoteiro` usa para regravar `tema`. */
  temaCurto: string | null;
  /** V12c, item 3: o valor efetivo (override deste roteiro, ou o `quemGrava` do cliente), para `gerarRoteiro` gravar. */
  quemAparece: QuemGrava | undefined;
}> {
  if (!dados.cliente.nichoId) {
    throw new ErroRoteiro("este cliente ainda nao tem um nicho definido.");
  }
  const nichoId = dados.cliente.nichoId;

  const perfil = await perfilDoCliente(dados.clienteId);
  if (!perfil) {
    throw new ErroRoteiro("o briefing deste cliente ainda nao foi compilado.");
  }

  const ehMomento = dados.momento !== undefined;
  const alternativos = ehMomento ? [] : (await ramosAlternativosDaMarca(dados.clienteId)).map((a) => a.nichoId);
  // E44 PR 1: só vídeo de formato ligado para a marca serve de referência.
  const formatosDaMarca = ehMomento ? undefined : await filtroDeFormatosDaMarca(dados.clienteId);

  const [
    daBusca,
    prevista,
    modeloNichoLinha,
    roteirosRecentes,
    regrasCliente,
    ultimosRoteiros,
    marcaCitada,
  ] = await Promise.all([
    // E45 PR 3: a evidência olha o ramo principal e os alternativos da marca (o modelo do nicho, abaixo, continua sendo o do principal).
    ehMomento ? Promise.resolve([]) : evidenciaParaRoteiro(nichoId, dados.tema, LIMITE_EVIDENCIA, alternativos, formatosDaMarca),
    ehMomento ? Promise.resolve([]) : // A evidência prevista (a que sustentou o tema do dia) não é cortada pelas chaves da marca: o tema já nasceu dela, e cortá-la na hora do roteiro o deixaria
    // sem a prova que o motivou. Só o corte duro `serve_de_modelo` vale (decisão 106, E44 PR 2).
    evidenciaPorIds(dados.evidenciasPrevistas),
    modeloNichoAtual(nichoId),
    historicoDeRoteiros(dados.clienteId, DIAS_HISTORICO),
    regrasAtivasDoCliente(dados.clienteId),
    ultimosRoteirosParaAbertura(dados.clienteId),
    marcaCitadaPorId(dados.momento?.marcaId),
  ]);

  const { proporcaoBrasil } = await reguaDoSetor(nichoId);
  const perfilCompilado = formatarPerfilCompilado(perfil);
  const evidenciasCombinadas = ehMomento
    ? []
    : combinarEvidencias(
        prevista,
        daBusca,
        LIMITE_EVIDENCIA,
        proporcaoBrasil,
        dados.cliente.redePrincipal,
        dados.estilo,
      );
  const evidencias = ehMomento
    ? []
    : await filtrarEvidenciaPelaMarca(
        evidenciasCombinadas,
        // E38 PR 2: o filtro continua julgando pelo perfil de sempre, sem o bloco do que a pessoa
        // confirmou sobre o site e as redes (mais texto no "na dúvida, reprove" mudaria o que ele
        // reprova, e não há conjunto de referência dele para medir).
        formatarPerfilCompilado(perfil, { semContextoConfirmado: true }),
        dados.clienteId,
      );
  const semEvidencia = ehMomento ? true : evidencias.length === 0;
  const evidenciasFornecidas = evidencias.map((v) => v.id);

  /**
   * V9a, item 2: os últimos momentos gravados por este cliente, "o que já
   * foi gravado nesta sequência" (reaproveita `historicoDeRoteiros`, já
   * limitado aos últimos `DIAS_HISTORICO` dias, em vez de uma consulta
   * nova); só os 3 mais recentes, e só com `momento`.
   */
  const contextoDeSerie = ehMomento
    ? roteirosRecentes
        .filter((r) => r.origem === "momento")
        .slice(0, 3)
        .map((r) => ({ tema: r.tema, gancho: r.gancho }))
    : undefined;

  const palavrasDoMomento = dados.momento
    ? palavrasDeConteudo(`${dados.momento.onde} ${dados.momento.oQueEstaAcontecendo}`)
    : undefined;

  const ultimosTiposAbertura = ultimosRoteiros.map((r) => r.tipoAbertura);
  const instrucaoAbertura = escolherTipoAbertura(evidencias, ultimosTiposAbertura);
  /**
   * V4, item 5: o verificador só reprova repetir o tipo do roteiro anterior
   * quando essa repetição não foi o próprio serviço quem decidiu. Sem isto,
   * um cliente cuja evidência só tem um tipo (ou nenhum novo sobrando fora
   * dos últimos 5, o caso (d) de `escolherTipoAbertura`) nunca conseguiria
   * gerar de novo: o serviço instruiria repetir de propósito, e o
   * verificador reprovaria a instrução que ele mesmo deu, sempre, sem saída.
   */
  const tipoAberturaAnterior = ultimosTiposAbertura[0] ?? null;
  const tipoAberturaAnteriorParaVerificar =
    instrucaoAbertura.tipo !== null && instrucaoAbertura.tipo === tipoAberturaAnterior
      ? null
      : tipoAberturaAnterior;

  const quemApareceResolvido = resolverQuemAparece(dados.quemAparece, dados.cliente);

  /**
   * Hotfix de 01/10/2026 (achado do Gustavo em produção): `porQueAssim` só existia em Story
   * falado, o único formato com regras numeradas de plataforma no prompt. R1, item 2: o Reels
   * falado passa a ter regras de plataforma também (a rede principal da marca), então `usaPorQueAssim`
   * passa a valer para os dois; sem fala continua de fora (nenhuma regra numerada ainda).
   */
  const usaPorQueAssim = dados.estilo !== "sem_fala";
  /** R1, item 2: a rede principal da marca escolhe o conjunto de regras que o Reels falado segue. */
  const redeReels = regrasDoReels(dados.cliente.redePrincipal, modeloNichoLinha?.modelo.duracaoTipicaS?.max);
  const numerosRegrasValidas =
    dados.formato === "story" ? NUMEROS_REGRAS_STORY : new Set(redeReels.regras.map((r) => r.numero));

  /**
   * Revisão do Fable no PR #89: `porQueAssim` explica o roteiro, não é o roteiro. Uma citação de
   * regra que não está na lista válida deste formato e desta rede é descartada aqui, antes do
   * verificador e do que se grava, em vez de reprovar a geração inteira: foi esse campo, citando
   * regra em texto livre, que deixou o Gustavo sem Reels em produção em 01/10 (quatro gerações
   * reprovadas seguidas). O que sobra é só citação de regra que existe.
   */
  const porQueAssimValido = (itens: { regra: string; motivo: string }[]) =>
    usaPorQueAssim ? itens.filter((item) => numerosRegrasValidas.has(item.regra)) : [];

  /** E38, partes 2 e 3: a leitura de cada perfil citado ou da própria marca, conferido na API de
   * verdade, como evidência exclusiva a mais no prompt. Só o que a API confirmou (nunca erro nem pendente). */
  const leiturasPerfis = (await leiturasDoCliente(dados.clienteId))
    .filter((l) => l.existeNaRede && l.leitura)
    .map((l) => ({ handle: l.handle, leitura: l.leitura as string }));

  const { dados: saida, geracaoId } = await gerarComVerificacao({
    tarefa: "roteiro",
    nivel: roteiroIA.nivel,
    effort: roteiroIA.esforco,
    versaoPrompt: roteiroIA.versao,
    clienteId: dados.clienteId,
    schema: roteiroIA.schema,
    numerosRegrasPlataforma: numerosRegrasValidas,
    sistemaEstavel: roteiroIA.montarSistemaEstavel({
      perfilCompilado,
      modeloNicho: formatarModeloNicho(modeloNichoLinha?.modelo ?? null),
      camadaExclusiva: formatarCamadaExclusiva(dados.cliente, leiturasPerfis),
      redePrincipal: dados.cliente.redePrincipal,
      duracaoTipicaMaxS: modeloNichoLinha?.modelo.duracaoTipicaS?.max,
      regrasCliente,
      tipo: dados.cliente.tipo,
      persona: dados.cliente.persona,
      quemAparece: quemApareceResolvido,
      formato: dados.formato,
      estilo: dados.estilo,
    }),
    entrada: roteiroIA.montarEntrada({
      tema: dados.tema,
      objetivo: dados.objetivo,
      ficha: dados.ficha ?? undefined,
      objetivoDoVideo: dados.objetivoDoVideo ?? dados.momento?.objetivoDoVideo,
      formato: dados.formato,
      estilo: dados.estilo,
      observacao: dados.observacao,
      evidencias: evidencias.map((v) => ({
        id: v.id,
        assunto: v.assunto,
        gancho: v.gancho,
        estrutura: v.estrutura,
        fechamento: v.fechamento,
        chamadaFinal: v.chamadaFinal,
        foraDaCurva: v.foraDaCurva,
        momentoChave: v.analiseVisual?.momentoChave
          ? `aos ${v.analiseVisual.momentoChave.segundo}s, ${v.analiseVisual.momentoChave.oQue}`
          : undefined,
        semFala: v.semFala ?? undefined,
        formato: formatoPorChave(v.formatoCatalogo)?.nome,
      })),
      roteirosRecentes,
      instrucaoAbertura,
      anguloParaEvitar: dados.anguloParaEvitar
        ? {
            gancho: dados.anguloParaEvitar.gancho,
            corpo: dados.anguloParaEvitar.corpo,
            motivos: dados.anguloParaEvitar.motivosIds.map(rotuloDoMotivo),
            motivoTexto: dados.anguloParaEvitar.motivoTexto,
          }
        : undefined,
      momento: dados.momento
        ? {
            onde: dados.momento.onde,
            oQueEstaAcontecendo: dados.momento.oQueEstaAcontecendo,
            oQueDaParaMostrar: dados.momento.oQueDaParaMostrar,
          }
        : undefined,
      contextoDeSerie,
      marcaCitada,
      noticia: dados.noticia,
    }),
    // Achado 11 da revisão do motor (01/10/2026): o lembrete de acentuação vem por aqui, não mais
    // embutido em `montarEntrada`, para continuar sendo a última linha também na segunda tentativa.
    lembreteFinal: roteiroIA.LEMBRETE_ACENTUACAO,
    proibicoes: perfil.fatos.proibicoes,
    exigeEvidencia: !semEvidencia,
    evidenciasFornecidas,
    palavrasDoMomento,
    /**
     * O gancho da versão reprovada entra aqui também (E27, parte 1, item 4:
     * "com gancho_fraco, o gancho novo tem de ser diferente do reprovado, a
     * regra dos ganchos recentes já existe"), não só quando o motivo é
     * "gancho fraco": nunca repetir o gancho que acabou de ser reprovado é
     * uma defesa boa para qualquer motivo, e `historicoDeRoteiros` já traria
     * essa versão de qualquer jeito enquanto ela estiver nos últimos
     * `DIAS_HISTORICO` dias; aqui fica garantido mesmo fora dessa janela.
     */
    ganchosRecentes: dados.anguloParaEvitar
      ? [...roteirosRecentes.map((r) => r.gancho), dados.anguloParaEvitar.gancho]
      : roteirosRecentes.map((r) => r.gancho),
    ganchosUltimos5: ultimosRoteiros.map((r) => r.gancho),
    tipoAberturaAnterior: tipoAberturaAnteriorParaVerificar,
    instrucaoAbertura,
    extrairTipoAbertura: (d) => d.tipoAbertura,
    duracaoReprovadaS: dados.anguloParaEvitar?.motivosIds.includes("muito_longo")
      ? dados.anguloParaEvitar.duracaoAnteriorS
      : undefined,
    extrairDuracaoS: (d) => d.duracaoS,
    // M5b, achado 4: duração fora da faixa real do nicho reprova a primeira tentativa no
    // verificador, em vez de ser encaixada depois (`respeitarDuracaoDoNicho`, removida junto desta
    // etapa). Revisão do Fable no PR #102: só o Reels falado; a faixa é medida em vídeo com fala
    // do feed, e um Story (soma de cartões) ou um vídeo sem fala (8 a 15 s é normal) fora dela é
    // legítimo.
    faixaDuracaoNicho:
      dados.formato === "story" || dados.estilo === "sem_fala"
        ? undefined
        : (modeloNichoLinha?.modelo.duracaoTipicaS ?? undefined),
    generoTexto: "roteiro",
    formato: dados.formato,
    estilo: dados.estilo,
    ficha: dados.ficha ?? undefined,
    extrairCartoes: (d) => d.cartoes,
    extrairLegenda: (d) => d.legenda,
    extrairPorQueAssim: (d) => porQueAssimValido(d.porQueAssim),
    extrairNarrativa: (d) => ({ gancho: d.gancho, corpo: d.corpo, chamadaFinal: d.chamadaFinal }),
    extrairCampos: (d) => extrairCamposRoteiro({ ...d, porQueAssim: porQueAssimValido(d.porQueAssim) }),
    extrairEvidencias: (d) => d.evidencias,
  });

  const referenciaEscolhida = validarReferenciaDoModelo(saida.edicao.referencia, evidencias);
  const duracaoS = saida.duracaoS;
  /**
   * M5b, achado 6 da revisão do motor (01/10/2026): a força da evidência precisa refletir o que
   * o roteiro de fato cita, não o conjunto inteiro oferecido ao modelo (`evidencias`, até
   * `LIMITE_EVIDENCIA`). Antes, um roteiro que citasse 1 vídeo fraco podia sair com "forte" só
   * porque o pool oferecido tinha vídeos fortes que ele nem usou.
   */
  const idsEvidenciaCitados = new Set(saida.evidencias);
  const evidenciasCitadas = evidencias.filter((v) => idsEvidenciaCitados.has(v.id));

  const conteudo: ConteudoRoteiro = {
    titulo: saida.titulo,
    duracaoS,
    // V9c, item 2: nulos em Story (o schema aceita nulo); "" para ConteudoRoteiro continuar `string` em todo o resto do código.
    gancho: saida.gancho ?? "",
    corpo: saida.corpo ?? "",
    fechamento: saida.fechamento ?? "",
    chamadaFinal: saida.chamadaFinal ?? "",
    cartoes: saida.cartoes,
    porQueAssim: porQueAssimValido(saida.porQueAssim),
    cenas: saida.cenas,
    ondeGravar: saida.ondeGravar,
    edicao: {
      textoNaTela: saida.edicao.textoNaTela,
      ritmoDeCorte: saida.edicao.ritmoDeCorte,
      recursos: saida.edicao.recursos,
      audio: saida.edicao.audio,
      referencia: referenciaEscolhida,
    },
    /**
     * Forcado a [] quando semEvidencia, em vez de confiar em saida.evidencias
     * (revisao do PR #17): o verificador ja reprova qualquer id fora de
     * evidenciasFornecidas, mas a tese do produto (sem evidencia, nao
     * inventa) merece a segunda camada de defesa que o projeto sempre usa
     * para saida de IA.
     */
    evidencias: semEvidencia ? [] : saida.evidencias,
    semEvidencia,
    /**
     * V9a, item 1: com momento a força é sempre "media", fixada por código
     * (não por `forcaDaEvidencia`, que não sabe avaliar uma cena descrita
     * pela própria pessoa, só vídeo do banco); a cena real não é "fraca"
     * (tema novo, pouca prova), mas também não é "forte" (vários vídeos
     * confirmando), então fica no meio.
     */
    // E42a, item 4: a força lê a régua do setor (já resolvida acima, para `combinarEvidencias`),
    // nunca mais fixa em 0,7.
    forcaEvidencia: ehMomento ? "media" : semEvidencia ? null : forcaDaEvidencia(evidenciasCitadas, undefined, proporcaoBrasil),
    legenda: saida.legenda,
  };

  return {
    conteudo,
    geracaoId,
    referenciaVideoId: referenciaEscolhida?.videoId ?? null,
    tipoAbertura: saida.tipoAbertura,
    temaCurto: saida.temaCurto,
    quemAparece: quemApareceResolvido,
  };
}

/**
 * Gera o roteiro do dia (etapa 11, decisão 1 do `PROXIMO.md`): resolve o
 * tema (sugerido ou livre), monta o contexto, chama a IA com o verificador,
 * e grava a versão 1.
 */
export async function gerarRoteiro(
  clienteId: number,
  params: ParametrosGerarRoteiro,
): Promise<RoteiroLinha> {
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroRoteiro("cliente nao encontrado.");

  const { tema, evidenciasPrevistas } = await resolverTema(cliente, params);
  const momento = params.origem === "momento" ? params.momento : undefined;
  const formato = params.formato ?? "reels";
  const estilo = params.estilo ?? "falado";
  // E49 PR 1: só o Reels tem ficha; ela decide o objetivo que se grava.
  const ficha = formato === "reels" && params.ficha ? params.ficha : null;
  const objetivo = ficha ? objetivoDaFicha(ficha) : params.objetivo;
  // E43: escopada pelo nicho do cliente, nunca confiando num id de outro setor vindo do client.
  const noticiaLinha =
    params.noticiaId && cliente.nichoId ? await noticiaPorId(params.noticiaId, cliente.nichoId) : null;
  const noticia = noticiaLinha
    ? { titulo: noticiaLinha.titulo, resumo: noticiaLinha.resumo, angulo: noticiaLinha.angulo }
    : undefined;

  const { conteudo, geracaoId, referenciaVideoId, tipoAbertura, temaCurto } = await gerarConteudo({
    clienteId,
    cliente,
    tema,
    objetivo,
    ficha,
    formato,
    estilo,
    objetivoDoVideo: params.objetivoDoVideo,
    quemAparece: params.quemAparece,
    observacao: params.observacao,
    evidenciasPrevistas,
    momento,
    noticia,
  });

  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: params.data ?? hojeISO(),
      momentoDoDia: params.momentoDoDia ?? null,
      // V9a, item 1: com momento, o tema de verdade é o que o modelo devolveu (temaCurto), não o provisório.
      tema: momento ? (temaCurto ?? tema) : tema,
      origem: params.origem,
      momento: momento ?? null,
      objetivo,
      ficha,
      formato,
      estilo,
      // E40, item 2: da origem momento, o mesmo campo que já está dentro de `momento`.
      objetivoDoVideo: params.objetivoDoVideo ?? momento?.objetivoDoVideo,
      // V12c, item 3: só grava quando é diferente do padrão do cliente, para a troca por vídeo nunca sobrescrever o briefing.
      quemAparece: params.quemAparece ?? null,
      // E43: só quando a notícia foi de fato encontrada no setor do cliente (nunca um id solto).
      noticiaId: noticiaLinha?.id ?? null,
      conteudo,
      referenciaVideoId,
      geracaoId,
      status: "gerado",
      tipoAbertura,
    })
    .returning();

  return roteiro;
}

/**
 * Reprovar e reescrever (E27, parte 1; antes "outro ângulo", etapa 11,
 * decisão 4): gera primeiro a versão seguinte da mesma série, com o mesmo
 * objetivo, com a instrução explícita de resolver o motivo sem repetir o
 * gancho nem a estrutura da versão reprovada; só depois que ela existe,
 * marca a versão atual como reprovada, com o motivo estruturado (um ou
 * mais, obrigatório) e o texto livre opcional.
 *
 * Item 1 do acabamento da E27 (revisão do PR #41): antes a marcação vinha
 * primeiro. Se `gerarConteudo` falhasse (erro de IA ou de rede), a v1
 * ficava marcada como reprovada, sem nenhuma v2 no lugar, e o cliente
 * perdia o próprio roteiro. Gerando primeiro, um erro não escreve nada: a
 * v1 continua exatamente como estava.
 */
export async function reprovarERescrever(
  roteiroId: number,
  motivosIds: IdMotivoReprovacao[],
  motivoTexto?: string,
): Promise<RoteiroLinha> {
  if (motivosIds.length === 0) {
    throw new ErroRoteiro("selecione pelo menos um motivo para reprovar o roteiro.");
  }

  const [atual] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  const cliente = await clientePorId(atual.clienteId);
  if (!cliente) throw new ErroRoteiro("cliente nao encontrado.");

  const raizId = atual.versaoDe ?? atual.id;
  const serie = await buscarSerie(raizId);
  const proximaVersao = Math.max(...serie.map((r) => r.versao)) + 1;

  // V9a, item 1: um roteiro de momento reescrito continua sem busca de evidência, com o mesmo bloco na entrada.
  const momento = atual.momento ?? undefined;
  // E43: idem, a reescrita mantém a notícia de origem da versão anterior.
  const noticiaLinha =
    atual.noticiaId && cliente.nichoId ? await noticiaPorId(atual.noticiaId, cliente.nichoId) : null;
  const noticia = noticiaLinha
    ? { titulo: noticiaLinha.titulo, resumo: noticiaLinha.resumo, angulo: noticiaLinha.angulo }
    : undefined;

  const { conteudo, geracaoId, referenciaVideoId, tipoAbertura, temaCurto } = await gerarConteudo({
    clienteId: atual.clienteId,
    cliente,
    tema: atual.tema,
    objetivo: atual.objetivo,
    // E49 PR 1: a reescrita mantém a ficha da versão anterior.
    ficha: atual.ficha,
    // V9c, item 1: a reescrita mantem o formato da versao anterior, nunca troca sozinha.
    formato: atual.formato,
    // M4, item 2: idem para o estilo ("mantém o estilo do roteiro de origem").
    estilo: atual.estilo,
    // E40, item 2: idem, a reescrita mantém o recado do vídeo da versão anterior.
    objetivoDoVideo: atual.objetivoDoVideo ?? undefined,
    // V12c, item 3: idem, a reescrita mantém quem aparece da versão anterior.
    quemAparece: atual.quemAparece ?? undefined,
    evidenciasPrevistas: atual.conteudo.evidencias,
    anguloParaEvitar: {
      gancho: atual.conteudo.gancho,
      corpo: atual.conteudo.corpo,
      motivosIds,
      motivoTexto,
      duracaoAnteriorS: atual.conteudo.duracaoS,
    },
    momento,
    noticia,
  });

  const [novaVersao] = await db()
    .insert(roteiros)
    .values({
      clienteId: atual.clienteId,
      // E39a: a reescrita é uma nova versão do MESMO item marcado, continua no dia e no momento de origem.
      data: atual.data,
      momentoDoDia: atual.momentoDoDia,
      tema: momento ? (temaCurto ?? atual.tema) : atual.tema,
      origem: atual.origem,
      momento: momento ?? null,
      objetivo: atual.objetivo,
      ficha: atual.ficha,
      formato: atual.formato,
      estilo: atual.estilo,
      objetivoDoVideo: atual.objetivoDoVideo,
      quemAparece: atual.quemAparece,
      // E43: idem, a reescrita mantém a notícia de origem.
      noticiaId: atual.noticiaId,
      conteudo,
      referenciaVideoId,
      versao: proximaVersao,
      versaoDe: raizId,
      geracaoId,
      status: "gerado",
      tipoAbertura,
    })
    .returning();

  if (atual.geracaoId) {
    await db()
      .update(geracoesIA)
      .set({ avaliacao: "reprovado", motivosAvaliacao: motivosIds, motivoAvaliacao: motivoTexto })
      .where(eq(geracoesIA.id, atual.geracaoId));
  }
  await db().update(roteiros).set({ reprovadoEm: new Date() }).where(eq(roteiros.id, roteiroId));

  /**
   * A memória do cliente (E27, parte 2, item 2): por evento, não bloqueia a
   * tela (`boss().send`, não `await` da execução do job). O cliente vê a
   * nova versão do roteiro na hora; a regra aprendida aparece no Briefing
   * pouco depois, quando o worker processar a fila.
   *
   * A fila nunca derruba a reescrita (segunda rodada do PR #42, item 6): a
   * memória é o bônus, a reescrita é o que o cliente está esperando na
   * tela. Se o pg-boss estiver fora do ar, o erro fica só no log; o cliente
   * simplesmente não ganha uma regra aprendida nesta rodada.
   *
   * `singletonKey` por cliente com janela de 60s (item 5 do acabamento da
   * E27, observação do PR #42, "duas reprovações seguidas, uma rodada só"):
   * a segunda reprovação do mesmo cliente a poucos segundos da primeira nao
   * enfileira um segundo job, o pg-boss descarta o envio duplicado (send
   * resolve para null, sem lançar).
   */
  try {
    await garantirBossPronto();
    await boss().send(
      FILAS.aprenderCliente,
      { clienteId: atual.clienteId },
      { singletonKey: String(atual.clienteId), singletonSeconds: 60 },
    );
  } catch (erro) {
    logger.error(
      { err: erro, clienteId: atual.clienteId, roteiroId },
      "nao foi possivel enfileirar aprender-cliente",
    );
  }

  return novaVersao;
}

/**
 * E40, item 1: os campos de texto que a pessoa pode editar na tela, sem chamar IA. `cartoes`
 * chega como a lista inteira, na mesma ordem de `corpo.cartoes` (Story ou sem fala); um cartão
 * que a pessoa não tocou chega igual ao que já estava, a tela sempre manda a lista inteira.
 */
export type CamposEditaveisRoteiro = {
  gancho?: string;
  corpo?: string;
  fechamento?: string;
  chamadaFinal?: string;
  cartoes?: { oQueFalar: string; oQueMostrar: string; textoNaTela: string }[];
  legenda?: string;
};

/** E37a, item 0 (resto da revisão do PR #82): teto por campo da edição manual, sem exceção. */
const LIMITE_CARACTERES_EDICAO = 2000;

function campoEditadoOuAtual(novo: string | undefined, atual: string): string {
  if (novo === undefined) return atual;
  const aparado = novo.trim();
  if (aparado.length > LIMITE_CARACTERES_EDICAO) {
    throw new ErroRoteiro(textosRoteiro.editando.textoMuitoLongo(LIMITE_CARACTERES_EDICAO));
  }
  return aparado;
}

/**
 * E40, item 1: salva a edição manual da pessoa, sem chamar IA. Na primeira edição deste
 * roteiro, `conteudoOriginal` guarda a versão que a IA escreveu (edições seguintes não
 * sobrescrevem: o original é sempre o que a IA de fato gerou). Enfileira `aprender-cliente`
 * (E27, parte 2) com o mesmo padrão de `reprovarERescrever`, para a diferença entre o texto
 * original e o editado virar mais um sinal de aprendizado.
 *
 * E37a, item 0 (resto da revisão do PR #82): sem teto, um texto enorme ia para o banco e depois
 * para o prompt do `aprender-cliente` (custo de IA). Cada campo de texto (`gancho`, `corpo`,
 * `fechamento`, `chamadaFinal`, `legenda`, e os três campos de cada cartão) passa por
 * `campoEditadoOuAtual`: `trim`, teto de 2.000 caracteres, erro nomeado acima do teto. A lista
 * de cartões editada nunca fica maior que a original: índice além do que já existia é um erro,
 * não uma inserção silenciosa (o `.map` abaixo já não cresceria o array sozinho, mas uma lista
 * maior enviada pela tela precisa avisar, não ser ignorada calada).
 */
export async function editarRoteiro(
  roteiroId: number,
  campos: CamposEditaveisRoteiro,
): Promise<RoteiroLinha> {
  const [atual] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  const conteudoAtual = atual.conteudo;

  if (campos.cartoes && campos.cartoes.length > (conteudoAtual.cartoes?.length ?? 0)) {
    throw new ErroRoteiro(textosRoteiro.editando.listaMaiorQueOriginal);
  }

  const novoConteudo: ConteudoRoteiro = {
    ...conteudoAtual,
    gancho: campoEditadoOuAtual(campos.gancho, conteudoAtual.gancho),
    corpo: campoEditadoOuAtual(campos.corpo, conteudoAtual.corpo),
    fechamento: campoEditadoOuAtual(campos.fechamento, conteudoAtual.fechamento),
    chamadaFinal: campoEditadoOuAtual(campos.chamadaFinal, conteudoAtual.chamadaFinal),
    // A figurinha nao se edita (e escolha da IA, nao um campo de texto); so os tres campos de
    // texto do cartao trocam, por indice, a mesma ordem que a tela recebeu.
    cartoes:
      campos.cartoes && conteudoAtual.cartoes
        ? conteudoAtual.cartoes.map((cartao, indice) => ({
            ...cartao,
            oQueFalar: campoEditadoOuAtual(campos.cartoes![indice]?.oQueFalar, cartao.oQueFalar),
            oQueMostrar: campoEditadoOuAtual(campos.cartoes![indice]?.oQueMostrar, cartao.oQueMostrar),
            textoNaTela: campoEditadoOuAtual(campos.cartoes![indice]?.textoNaTela, cartao.textoNaTela),
          }))
        : conteudoAtual.cartoes,
    legenda: campos.legenda !== undefined ? campoEditadoOuAtual(campos.legenda, conteudoAtual.legenda ?? "") : conteudoAtual.legenda,
  };

  const [roteiro] = await db()
    .update(roteiros)
    .set({
      conteudo: novoConteudo,
      conteudoOriginal: atual.conteudoOriginal ?? conteudoAtual,
      editadoPelaPessoa: true,
      editadoEm: new Date(),
    })
    .where(eq(roteiros.id, roteiroId))
    .returning();
  if (!roteiro) throw new ErroRoteiro("roteiro nao encontrado.");

  try {
    await garantirBossPronto();
    await boss().send(
      FILAS.aprenderCliente,
      { clienteId: atual.clienteId },
      { singletonKey: String(atual.clienteId), singletonSeconds: 60 },
    );
  } catch (erro) {
    logger.error(
      { err: erro, clienteId: atual.clienteId, roteiroId },
      "nao foi possivel enfileirar aprender-cliente",
    );
  }

  return roteiro;
}

export async function marcarGravado(roteiroId: number): Promise<RoteiroLinha> {
  const [roteiro] = await db()
    .update(roteiros)
    .set({ status: "gravado", gravadoEm: new Date() })
    .where(eq(roteiros.id, roteiroId))
    .returning();
  if (!roteiro) throw new ErroRoteiro("roteiro nao encontrado.");
  return roteiro;
}

/**
 * O domínio da URL diz a plataforma; o formato do caminho diz o id externo
 * (etapa 11, decisão 5). Sem reconhecer nenhum dos dois, grava só a URL e
 * deixa o resto nulo: a medição da curva por API oficial é da fase 3.
 */
function inferirPlataforma(url: string): {
  plataforma: Plataforma | null;
  idExterno: string | null;
} {
  let analisada: URL;
  try {
    analisada = new URL(url);
  } catch {
    return { plataforma: null, idExterno: null };
  }

  const host = analisada.hostname.replace(/^www\./, "");

  if (host === "youtu.be") {
    return { plataforma: "youtube", idExterno: analisada.pathname.slice(1) || null };
  }
  if (host.endsWith("youtube.com")) {
    return { plataforma: "youtube", idExterno: analisada.searchParams.get("v") };
  }
  if (host.endsWith("tiktok.com")) {
    const match = /\/video\/(\d+)/.exec(analisada.pathname);
    return { plataforma: "tiktok", idExterno: match?.[1] ?? null };
  }
  if (host.endsWith("instagram.com")) {
    const match = /\/(?:reel|p)\/([^/]+)/.exec(analisada.pathname);
    return { plataforma: "instagram", idExterno: match?.[1] ?? null };
  }
  return { plataforma: null, idExterno: null };
}

/**
 * Marca postado (etapa 11, decisão 5 do `PROXIMO.md`): cria a linha em
 * `videos_cliente` (a base do acompanhamento da curva, fase 3), com a
 * plataforma e o id externo inferidos da URL quando dá.
 */
export async function marcarPostado(roteiroId: number, url: string): Promise<RoteiroLinha> {
  const [atual] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  const { plataforma, idExterno } = inferirPlataforma(url);

  await db().insert(videosCliente).values({
    clienteId: atual.clienteId,
    roteiroId: atual.id,
    plataforma,
    url,
    idExterno,
  });

  const [roteiro] = await db()
    .update(roteiros)
    .set({
      status: "postado",
      urlPostado: url,
      postadoEm: new Date(),
      gravadoEm: atual.gravadoEm ?? new Date(),
    })
    .where(eq(roteiros.id, roteiroId))
    .returning();
  if (!roteiro) throw new ErroRoteiro("roteiro nao encontrado.");
  return roteiro;
}

/** "gostei" ou "não gostei" (etapa 11, decisão 4): gravado na geração deste roteiro. */
export async function avaliarRoteiro(
  roteiroId: number,
  avaliacao: "gostei" | "nao_gostei",
): Promise<void> {
  const [atual] = await db()
    .select({ geracaoId: roteiros.geracaoId })
    .from(roteiros)
    .where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");
  if (!atual.geracaoId) return;

  await db().update(geracoesIA).set({ avaliacao }).where(eq(geracoesIA.id, atual.geracaoId));
}

export type VersaoRoteiro = {
  id: number;
  versao: number;
  criadoEm: Date;
  atual: boolean;
  /** Nula na versão em uso; marcada na versão que o cliente reprovou (E27, parte 1). */
  reprovadoEm: Date | null;
  /** Rótulos de tela, já traduzidos de `MOTIVOS_REPROVACAO`; nulo sem reprovação. */
  motivos: string[] | null;
  motivoTexto: string | null;
};

/**
 * As versões da mesma série, mais recente primeiro (etapa 11, tela
 * "Versões"). A versão reprovada (E27, parte 1) traz os motivos, buscados
 * na geração dela (`geracoesIA`), para o bloco de versões mostrar "você
 * reprovou por: X e Y".
 */
export async function versoesDoRoteiro(roteiroId: number): Promise<VersaoRoteiro[]> {
  const [atual] = await db()
    .select({ id: roteiros.id, versaoDe: roteiros.versaoDe })
    .from(roteiros)
    .where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  const raizId = atual.versaoDe ?? atual.id;
  const serie = await buscarSerie(raizId);
  const maisRecente = serie[0]?.id;

  const idsGeracaoReprovada = serie
    .filter((r) => r.reprovadoEm !== null && r.geracaoId !== null)
    .map((r) => r.geracaoId as number);
  const geracoes =
    idsGeracaoReprovada.length > 0
      ? await db()
          .select({
            id: geracoesIA.id,
            motivosAvaliacao: geracoesIA.motivosAvaliacao,
            motivoAvaliacao: geracoesIA.motivoAvaliacao,
          })
          .from(geracoesIA)
          .where(inArray(geracoesIA.id, idsGeracaoReprovada))
      : [];
  const geracaoPorId = new Map(geracoes.map((g) => [g.id, g]));

  return serie.map((r) => {
    const geracao = r.geracaoId !== null ? geracaoPorId.get(r.geracaoId) : undefined;
    return {
      id: r.id,
      versao: r.versao,
      criadoEm: r.criadoEm,
      atual: r.id === maisRecente,
      reprovadoEm: r.reprovadoEm,
      motivos: geracao?.motivosAvaliacao?.map(rotuloDoMotivo) ?? null,
      motivoTexto: geracao?.motivoAvaliacao ?? null,
    };
  });
}

/** Só a ponta de cada série (sem versão mais nova apontando `versaoDe` para ela). */
const SEM_VERSAO_MAIS_NOVA = sql`not exists (select 1 from roteiros mais_novo where mais_novo.versao_de = roteiros.id)`;

/**
 * O roteiro mais recente gerado hoje para o cliente (etapa 11, decisão 6:
 * o cartão de roteiro em `/hoje`, quando já existe). `null` sem nenhum
 * roteiro de hoje ainda.
 */
export async function roteiroDeHoje(clienteId: number): Promise<RoteiroLinha | null> {
  const linhas = await db()
    .select()
    .from(roteiros)
    .where(eq(roteiros.clienteId, clienteId))
    .orderBy(desc(roteiros.criadoEm))
    .limit(1);

  const [roteiro] = linhas;
  return roteiro && roteiro.data === hojeISO() ? roteiro : null;
}

/**
 * Todos os roteiros de hoje do cliente, mais recente primeiro, só a ponta de
 * cada série (V9b-0, plano `sem_limite`: o Hoje mostra um cartão por
 * roteiro do dia, não só o mais recente). Mesmo filtro de "ponta de série"
 * de `roteirosDoCliente`.
 */
export async function roteirosDeHoje(clienteId: number): Promise<RoteiroLinha[]> {
  return db()
    .select()
    .from(roteiros)
    .where(
      and(eq(roteiros.clienteId, clienteId), eq(roteiros.data, hojeISO()), SEM_VERSAO_MAIS_NOVA),
    )
    .orderBy(desc(roteiros.criadoEm));
}

/** A data no formato "YYYY-MM-DD" somada de `dias` (positivo ou negativo), sem depender do fuso do servidor. */
export function somarDiasISO(dataISO: string, dias: number): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia + dias, 12)).toISOString().slice(0, 10);
}

/** E39a, dúvida 4 do desenho: a semana do calendário, segunda a domingo (hoje só a grade do mês; a faixa e a visão Semana são a janela a partir de hoje, `inicioDaJanelaISO`). */
function segundaDaSemanaISO(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const diaDaSemana = new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay(); // 0 domingo .. 6 sabado
  const voltarAteSegunda = diaDaSemana === 0 ? 6 : diaDaSemana - 1;
  return somarDiasISO(dataISO, -voltarAteSegunda);
}

/**
 * A3, item 1 (pedido do Gustavo no iPhone, 03/10/2026): a janela de sete dias começa HOJE, nunca na segunda. As janelas são blocos de sete dias contados a
 * partir de hoje (hoje a hoje+6, a anterior é hoje-7 a hoje-1, a seguinte hoje+7 a hoje+13), então tocar num dia da faixa não desloca a janela e as setas
 * (sete dias) caem sempre no bloco vizinho. Devolve o primeiro dia do bloco que contém `dia`.
 */
export function inicioDaJanelaISO(dia: string, hoje: string): string {
  const [a1, m1, d1] = dia.split("-").map(Number);
  const [a2, m2, d2] = hoje.split("-").map(Number);
  const diferenca = Math.round((Date.UTC(a1, m1 - 1, d1, 12) - Date.UTC(a2, m2 - 1, d2, 12)) / 86_400_000);
  return somarDiasISO(hoje, Math.floor(diferenca / 7) * 7);
}

const DIAS_DA_SEMANA_CURTO = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** O nome curto do dia da semana de uma data ("sex"), para a janela que não começa na segunda. */
function diaCurtoDe(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const indiceDomingoZero = new Date(Date.UTC(ano, mes - 1, dia, 12)).getUTCDay();
  return DIAS_DA_SEMANA_CURTO[(indiceDomingoZero + 6) % 7];
}

export type MarcaDiaAgenda = { qtdReels: number; qtdStories: number };
export type DiaDaSemanaAgenda = {
  data: string;
  diaDoMes: number;
  diaDaSemanaCurto: string;
  hoje: boolean;
  /** A3: o dia já passou (a janela anterior, que a seta para trás mostra). */
  passado: boolean;
  marca: MarcaDiaAgenda;
};

/**
 * E39a, item 3 (A3, item 1: agora a janela de sete dias a partir de hoje, a que contém `dataReferencia`), com uma marca por dia
 * (um ponto por Reels, um anel por Story, com a contagem de cada um quando há mais de um; revisão
 * do Fable no PR #90: o plano é "quantos roteiros quiser por dia" para toda marca, então o Reels
 * também pode ter mais de um, como o Story já tinha). Só conta a ponta de cada série (reescrever
 * um roteiro não soma uma marca a mais no mesmo dia). E39b, item (b): um atrasado arquivado sai
 * da marca do dia dele, "sai da agenda" vale aqui também, não só na lista de atrasados.
 */
export async function semanaDaAgenda(clienteId: number, dataReferencia: string): Promise<DiaDaSemanaAgenda[]> {
  const hoje = hojeISO();
  const inicio = inicioDaJanelaISO(dataReferencia, hoje);
  const fim = somarDiasISO(inicio, 6);

  const linhas = await db()
    .select({ data: roteiros.data, formato: roteiros.formato })
    .from(roteiros)
    .where(
      and(
        eq(roteiros.clienteId, clienteId),
        gte(roteiros.data, inicio),
        lte(roteiros.data, fim),
        isNull(roteiros.arquivadoEm),
        SEM_VERSAO_MAIS_NOVA,
      ),
    );

  const porDia = new Map<string, MarcaDiaAgenda>();
  for (const linha of linhas) {
    const atual = porDia.get(linha.data) ?? { qtdReels: 0, qtdStories: 0 };
    if (linha.formato === "reels") atual.qtdReels += 1;
    else atual.qtdStories += 1;
    porDia.set(linha.data, atual);
  }

  return Array.from({ length: 7 }, (_, indice) => {
    const data = somarDiasISO(inicio, indice);
    return {
      data,
      diaDoMes: Number(data.split("-")[2]),
      diaDaSemanaCurto: diaCurtoDe(data),
      hoje: data === hoje,
      passado: data < hoje,
      marca: porDia.get(data) ?? { qtdReels: 0, qtdStories: 0 },
    };
  });
}

/**
 * E39a: o próximo dia com algo marcado, depois de hoje (para o aviso "nada para hoje, o próximo
 * marcado é X" no dia vazio da Agenda). `null` sem nada planejado à frente.
 */
export async function proximoDiaMarcado(clienteId: number, apartirDe: string): Promise<{ data: string; formato: FormatoRoteiro } | null> {
  const [linha] = await db()
    .select({ data: roteiros.data, formato: roteiros.formato })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.data, apartirDe), SEM_VERSAO_MAIS_NOVA))
    .orderBy(roteiros.data)
    .limit(1);
  return linha ?? null;
}

export type ItemAgendaDoDia = {
  id: number;
  tema: string;
  titulo: string;
  status: "gerado" | "gravado" | "postado";
  momentoDoDia: MomentoDoDia | null;
  objetivo: Objetivo;
  duracaoS: number;
  criadoEm: Date;
  /** E39b, item (a): nulo até a pessoa tocar em "Conferir" (só preenchido no destaque do Reels). */
  aindaValeResultado: AindaValeResultado | null;
};
export type AgendaDoDia = { reels: ItemAgendaDoDia[]; stories: ItemAgendaDoDia[] };

const ORDEM_MOMENTO_DO_DIA: Record<MomentoDoDia, number> = { manha: 0, meio_dia: 1, fim_tarde: 2, noite: 3 };
const ORDEM_STATUS_AGENDA: Record<ItemAgendaDoDia["status"], number> = { gerado: 0, gravado: 1, postado: 2 };

function linhaParaItemAgenda(linha: RoteiroLinha): ItemAgendaDoDia {
  return {
    id: linha.id,
    tema: linha.tema,
    titulo: corpoDoRoteiro(linha).titulo,
    status: linha.status,
    momentoDoDia: linha.momentoDoDia,
    objetivo: linha.objetivo,
    duracaoS: corpoDoRoteiro(linha).duracaoS,
    criadoEm: linha.criadoEm,
    aindaValeResultado: aindaValeDeHoje(linha),
  };
}

/**
 * E39a, item 3: o que está marcado para um dia (o Reels e os Stories, na ordem da parte do dia).
 * Revisão do Fable no PR #90: o plano é "quantos roteiros quiser por dia" para toda marca, então
 * `reels` é uma lista, como `stories` já era; o primeiro (a gravar antes de gravado antes de
 * postado, e dentro do mesmo estado o mais antigo primeiro) é o destaque da tela, os demais
 * entram embaixo dele, nas mesmas linhas que os Stories usam. E39b, item (b): um atrasado
 * arquivado não aparece mais aqui, nem no dia que era dele (só continua no Histórico).
 */
export async function agendaDoDia(clienteId: number, data: string): Promise<AgendaDoDia> {
  const linhas = await db()
    .select()
    .from(roteiros)
    .where(
      and(eq(roteiros.clienteId, clienteId), eq(roteiros.data, data), isNull(roteiros.arquivadoEm), SEM_VERSAO_MAIS_NOVA),
    )
    .orderBy(desc(roteiros.criadoEm));

  const reelsOrdenados = linhas
    .filter((linha) => linha.formato === "reels")
    .sort((a, b) => ORDEM_STATUS_AGENDA[a.status] - ORDEM_STATUS_AGENDA[b.status] || a.criadoEm.getTime() - b.criadoEm.getTime());
  const storiesOrdenados = linhas
    .filter((linha) => linha.formato === "story")
    .sort((a, b) => {
      const ordemA = a.momentoDoDia ? ORDEM_MOMENTO_DO_DIA[a.momentoDoDia] : 99;
      const ordemB = b.momentoDoDia ? ORDEM_MOMENTO_DO_DIA[b.momentoDoDia] : 99;
      return ordemA - ordemB;
    });

  return {
    reels: reelsOrdenados.map(linhaParaItemAgenda),
    stories: storiesOrdenados.map(linhaParaItemAgenda),
  };
}

export type ItemAtrasado = ItemAgendaDoDia & { data: string };

/**
 * E39b, item (b): o que estava marcado para um dia que já passou e continua "a gravar" (nunca
 * gravado nem arquivado). Mais antigo primeiro, para o cartão mostrar o mais urgente no alto.
 */
export async function atrasados(clienteId: number, hoje: string): Promise<ItemAtrasado[]> {
  const linhas = await db()
    .select()
    .from(roteiros)
    .where(
      and(
        eq(roteiros.clienteId, clienteId),
        eq(roteiros.status, "gerado"),
        lt(roteiros.data, hoje),
        isNull(roteiros.arquivadoEm),
        SEM_VERSAO_MAIS_NOVA,
      ),
    )
    .orderBy(roteiros.data);
  return linhas.map((linha) => ({ ...linhaParaItemAgenda(linha), data: linha.data }));
}

/**
 * E39b, item (b): "Arquivar" num atrasado. O roteiro continua existindo (aparece no Histórico),
 * só sai da lista de atrasados e da agenda do dia que ele tinha.
 */
export async function arquivarRoteiro(roteiroId: number): Promise<void> {
  await db().update(roteiros).set({ arquivadoEm: new Date() }).where(eq(roteiros.id, roteiroId));
}

/**
 * E39c, parte 2a: o "desfazer" do toast de "Arquivar" no menu de três ações. Alguns segundos para
 * voltar atrás sem precisar procurar o roteiro no Histórico.
 */
export async function desarquivarRoteiro(roteiroId: number): Promise<void> {
  await db().update(roteiros).set({ arquivadoEm: null }).where(eq(roteiros.id, roteiroId));
}

/**
 * E39b, item (b): "Mudar o dia" e "Gravar hoje" num atrasado usam a mesma troca, só muda qual
 * data chega (a de hoje, no segundo caso). `validarData` já garante que não é no passado.
 */
export async function mudarDataRoteiro(roteiroId: number, novaData: string): Promise<void> {
  const validada = validarData(novaData);
  if (!validada) throw new ErroRoteiro("data invalida.");
  await db().update(roteiros).set({ data: validada }).where(eq(roteiros.id, roteiroId));
}

/**
 * Revisão do Fable no PR #91: a resposta de "ainda vale?" só vale no dia em que foi conferida. O
 * que está subindo muda todo dia, e um roteiro remarcado para outro dia (ou conferido ontem e
 * ainda não gravado) tem de poder ser conferido de novo; sem isto a primeira resposta ficava
 * guardada para sempre.
 */
function aindaValeDeHoje(linha: {
  aindaValeChecadoEm: Date | null;
  aindaValeResultado: AindaValeResultado | null;
}): AindaValeResultado | null {
  if (!linha.aindaValeChecadoEm || !linha.aindaValeResultado) return null;
  return hojeISO(linha.aindaValeChecadoEm) === hojeISO() ? linha.aindaValeResultado : null;
}

/** Quantos candidatos de "o que está subindo hoje" entram na checagem de "ainda vale?" (E39b, item a). */
const LIMITE_CANDIDATOS_AINDA_VALE = 15;

/**
 * E39b, item (a): "ainda vale?", só para o Reels em destaque da Agenda, quando ele foi escrito
 * antes de hoje e continua "a gravar". Um toque, nunca automático; o resultado fica guardado em
 * `roteiros.aindaValeChecadoEm`/`aindaValeResultado`, então abrir a tela de novo no mesmo dia não
 * repete a chamada de IA, só mostra o que já foi respondido.
 */
export async function conferirAindaVale(roteiroId: number): Promise<AindaValeResultado> {
  const [atual] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");
  const jaConferidoHoje = aindaValeDeHoje(atual);
  if (jaConferidoHoje) return jaConferidoHoje;

  const cliente = await clientePorId(atual.clienteId);
  const candidatos = cliente?.nichoId
    ? await subindoHojeComAnalise(cliente.nichoId, LIMITE_CANDIDATOS_AINDA_VALE)
    : [];
  const diasAtras = Math.max(1, Math.round((Date.now() - atual.criadoEm.getTime()) / DIA_MS));

  let resultado: AindaValeResultado = { vale: true };
  if (candidatos.length > 0) {
    const geracaoInicio = Date.now();
    const saida = await gerarEstruturado({
      tarefa: "aindaValeRoteiro",
      nivel: aindaValeIA.nivel,
      effort: aindaValeIA.esforco,
      schema: aindaValeIA.schema,
      sistemaEstavel: aindaValeIA.montarSistemaEstavel(),
      entrada: aindaValeIA.montarEntrada({
        tema: atual.tema,
        diasAtras,
        candidatos: candidatos.map((c) => ({ id: c.id, assunto: c.assunto, velocidadeRelativa: c.velocidadeRelativa })),
      }),
    });

    await registrarGeracao({
      tarefa: "aindaValeRoteiro",
      versaoPrompt: aindaValeIA.versao,
      modelo: saida.modelo,
      nivel: aindaValeIA.nivel,
      clienteId: atual.clienteId,
      entradas: { roteiroId, candidatosIds: candidatos.map((c) => c.id), diasAtras },
      saida: saida.dados,
      uso: {
        tokensEntrada: saida.tokensEntrada,
        tokensSaida: saida.tokensSaida,
        tokensCacheLeitura: saida.tokensCacheLeitura,
        tokensCacheEscrita: saida.tokensCacheEscrita,
      },
      duracaoMs: Date.now() - geracaoInicio,
    });

    // Nunca confia num id fora da lista oferecida (mesma defesa de `validarReferenciaDoModelo`).
    const candidatoEscolhido =
      !saida.dados.valeAinda && saida.dados.videoId !== null
        ? candidatos.find((c) => c.id === saida.dados.videoId)
        : undefined;
    resultado = candidatoEscolhido
      ? { vale: false, videoId: candidatoEscolhido.id, assunto: candidatoEscolhido.assunto }
      : { vale: true };
  }

  await db()
    .update(roteiros)
    .set({ aindaValeChecadoEm: new Date(), aindaValeResultado: resultado })
    .where(eq(roteiros.id, roteiroId));

  return resultado;
}

export type DiaDoMes = {
  data: string;
  diaDoMes: number;
  foraDoMes: boolean;
  passado: boolean;
  hoje: boolean;
  atrasado: boolean;
  marca: MarcaDiaAgenda;
};

function ultimoDiaDoMesISO(anoMes: string): string {
  const [ano, mes] = anoMes.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0, 12)).toISOString().slice(0, 10);
}

/**
 * E39b, item (e), o calendário: o mês inteiro de `anoMes` ("AAAA-MM"), em semanas completas (os
 * dias do mês vizinho que completam a primeira e a última semana entram marcados como
 * `foraDoMes`, para a grade de 7 colunas nunca ficar com buraco). `atrasado` é por dia, não por
 * item: um dia com qualquer roteiro "a gravar" de data passada (sem arquivar) entra marcado.
 *
 * E39c, parte 1: "Contar a minha agenda" pode marcar um dia só com um item do plano ainda
 * "sugerido", sem roteiro nenhum; a marca do dia conta os dois juntos (sem inventar um terceiro
 * símbolo na grade, que é desenho, não código), por isso o dia pode mostrar uma marca mesmo sem
 * nenhum roteiro na lista de baixo.
 */
export async function mesDaAgenda(clienteId: number, anoMes: string): Promise<DiaDoMes[]> {
  const hoje = hojeISO();
  const primeiroDiaDoMes = `${anoMes}-01`;
  const ultimoDiaDoMes = ultimoDiaDoMesISO(anoMes);
  const inicioGrade = segundaDaSemanaISO(primeiroDiaDoMes);
  const fimGrade = somarDiasISO(segundaDaSemanaISO(ultimoDiaDoMes), 6);

  const [linhas, linhasPlano] = await Promise.all([
    db()
      .select({
        data: roteiros.data,
        formato: roteiros.formato,
        status: roteiros.status,
      })
      .from(roteiros)
      .where(
        and(
          eq(roteiros.clienteId, clienteId),
          gte(roteiros.data, inicioGrade),
          lte(roteiros.data, fimGrade),
          isNull(roteiros.arquivadoEm),
          SEM_VERSAO_MAIS_NOVA,
        ),
      ),
    /**
     * E39c, parte 1: um item do plano ainda "sugerido" (sem roteiro próprio) também marca o dia na
     * grade, do mesmo jeito que um roteiro já escrito; "aceito" e "gravado" já têm `roteiroId` e já
     * contam pela consulta de cima, então contar os dois juntos duplicaria a marca.
     */
    db()
      .select({ dia: planoGravacoes.dia, formato: planoGravacoes.formato })
      .from(planoGravacoes)
      .where(
        and(
          eq(planoGravacoes.clienteId, clienteId),
          eq(planoGravacoes.estado, "sugerido"),
          gte(planoGravacoes.dia, inicioGrade),
          lte(planoGravacoes.dia, fimGrade),
        ),
      ),
  ]);

  const porDia = new Map<string, { marca: MarcaDiaAgenda; atrasado: boolean }>();
  for (const linha of linhas) {
    const atual = porDia.get(linha.data) ?? { marca: { qtdReels: 0, qtdStories: 0 }, atrasado: false };
    if (linha.formato === "reels") atual.marca.qtdReels += 1;
    else atual.marca.qtdStories += 1;
    if (linha.status === "gerado" && linha.data < hoje) atual.atrasado = true;
    porDia.set(linha.data, atual);
  }
  for (const linha of linhasPlano) {
    const atual = porDia.get(linha.dia) ?? { marca: { qtdReels: 0, qtdStories: 0 }, atrasado: false };
    if (linha.formato === "reels") atual.marca.qtdReels += 1;
    else atual.marca.qtdStories += 1;
    porDia.set(linha.dia, atual);
  }

  const dias: DiaDoMes[] = [];
  for (let data = inicioGrade; data <= fimGrade; data = somarDiasISO(data, 1)) {
    const info = porDia.get(data);
    dias.push({
      data,
      diaDoMes: Number(data.split("-")[2]),
      foraDoMes: data < primeiroDiaDoMes || data > ultimoDiaDoMes,
      passado: data < hoje,
      hoje: data === hoje,
      atrasado: info?.atrasado ?? false,
      marca: info?.marca ?? { qtdReels: 0, qtdStories: 0 },
    });
  }
  return dias;
}

export type ItemSemanaPlano = {
  id: number;
  /** Sem roteiro próprio ainda, só o que "Contar a minha agenda" gerou (`planoGravacoes`, estado "sugerido"). */
  sugerido: boolean;
  tipo: FormatoRoteiro;
  momentoDoDia: MomentoDoDia | null;
  /** Só um sugerido tem lugar (de onde veio na agenda); um roteiro já escrito é `null`. */
  lugar: string | null;
  titulo: string;
  status: "gerado" | "gravado" | "postado";
  objetivo: Objetivo;
};
export type DiaSemanaPlano = {
  data: string;
  diaDoMes: number;
  diaDaSemanaCurto: string;
  hoje: boolean;
  passado: boolean;
  itens: ItemSemanaPlano[];
};

/**
 * Passo 12 do Opus, a visão Semana do planejador (`/planejamento`, aba própria desde a decisão do
 * Gustavo de 01/10, 22:15; A3, item 1: a janela de sete dias a partir de hoje que contém `dataReferencia`), cada um com os
 * roteiros já escritos e os itens do plano ainda "sugerido" juntos, mesmo espírito de
 * `mesDaAgenda` (um sugerido também aparece, sem roteiro próprio ainda; virar roteiro continua
 * pelas portas de sempre). `titulo` de um sugerido vem de `situacao` (o compromisso da agenda que
 * gerou aquele item), o único texto que a pessoa já escreveu sobre ele.
 */
export async function semanaPlanoDaAgenda(clienteId: number, dataReferencia: string): Promise<DiaSemanaPlano[]> {
  const hoje = hojeISO();
  const segunda = inicioDaJanelaISO(dataReferencia, hoje);
  const domingo = somarDiasISO(segunda, 6);

  const [linhasRoteiro, linhasPlano] = await Promise.all([
    db()
      .select()
      .from(roteiros)
      .where(
        and(
          eq(roteiros.clienteId, clienteId),
          gte(roteiros.data, segunda),
          lte(roteiros.data, domingo),
          isNull(roteiros.arquivadoEm),
          SEM_VERSAO_MAIS_NOVA,
        ),
      ),
    db()
      .select()
      .from(planoGravacoes)
      .where(
        and(
          eq(planoGravacoes.clienteId, clienteId),
          eq(planoGravacoes.estado, "sugerido"),
          gte(planoGravacoes.dia, segunda),
          lte(planoGravacoes.dia, domingo),
        ),
      ),
  ]);

  const porDia = new Map<string, ItemSemanaPlano[]>();
  for (const linha of linhasRoteiro) {
    const atual = porDia.get(linha.data) ?? [];
    atual.push({
      id: linha.id,
      sugerido: false,
      tipo: linha.formato,
      momentoDoDia: linha.momentoDoDia,
      lugar: null,
      titulo: corpoDoRoteiro(linha).titulo,
      status: linha.status,
      objetivo: linha.objetivo,
    });
    porDia.set(linha.data, atual);
  }
  for (const linha of linhasPlano) {
    const atual = porDia.get(linha.dia) ?? [];
    atual.push({
      id: linha.id,
      sugerido: true,
      tipo: linha.formato,
      momentoDoDia: null,
      lugar: linha.lugar,
      titulo: linha.situacao,
      status: "gerado",
      objetivo: linha.objetivo,
    });
    porDia.set(linha.dia, atual);
  }

  return Array.from({ length: 7 }, (_, indice) => {
    const data = somarDiasISO(segunda, indice);
    return {
      data,
      diaDoMes: Number(data.split("-")[2]),
      diaDaSemanaCurto: diaCurtoDe(data),
      hoje: data === hoje,
      passado: data < hoje,
      itens: porDia.get(data) ?? [],
    };
  });
}

/**
 * R1, item 0c: a base da recuperação quando a tela de espera acha que a conexão caiu, mas o
 * servidor pode ter terminado de gerar mesmo assim (geração não depende da aba continuar
 * aberta, `momento-continua-sem-espera.test.ts`). Em vez de mostrar erro na hora, a tela confere
 * se já existe um roteiro desta marca criado depois do início da espera; se existe, é o que
 * acabou de ser gerado, e a tela abre ele em vez do erro.
 */
export async function roteiroMaisRecenteDesde(clienteId: number, desde: Date): Promise<{ id: number } | null> {
  const [roteiro] = await db()
    .select({ id: roteiros.id })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.criadoEm, desde)))
    .orderBy(desc(roteiros.criadoEm))
    .limit(1);
  return roteiro ?? null;
}

/**
 * Um roteiro pelo id, só se pertencer ao cliente pedido (isolamento no
 * nível de rota, mesmo padrão do briefing): dado de um cliente nunca
 * aparece para outro.
 */
export async function roteiroPorId(
  roteiroId: number,
  clienteId: number,
): Promise<RoteiroLinha | null> {
  const [roteiro] = await db()
    .select()
    .from(roteiros)
    .where(and(eq(roteiros.id, roteiroId), eq(roteiros.clienteId, clienteId)));
  return roteiro ?? null;
}

export type RoteiroHistoricoLinha = {
  id: number;
  data: string;
  tema: string;
  status: "gerado" | "gravado" | "postado";
  gravadoEm: Date | null;
  postadoEm: Date | null;
  /** V9a, item 5: `HistoricoTela` mostra o rótulo "momento" só para esta origem. */
  origem: OrigemRoteiro["origem"];
  /** V9c, item 4: `HistoricoTela` mostra "· story" ao lado da data, como "· momento". */
  formato: FormatoRoteiro;
};

/**
 * A lista de `/historico` (etapa 12, decisão 3 do `PROXIMO.md`): mais
 * recente primeiro, só a versão atual de cada série ("outro ângulo" nunca
 * duplica linha no histórico).
 */
export async function roteirosDoCliente(
  clienteId: number,
  limite = 200,
): Promise<RoteiroHistoricoLinha[]> {
  return db()
    .select({
      id: roteiros.id,
      data: roteiros.data,
      tema: roteiros.tema,
      status: roteiros.status,
      gravadoEm: roteiros.gravadoEm,
      postadoEm: roteiros.postadoEm,
      origem: roteiros.origem,
      formato: roteiros.formato,
    })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), SEM_VERSAO_MAIS_NOVA))
    .orderBy(desc(roteiros.data), desc(roteiros.criadoEm))
    .limit(limite);
}

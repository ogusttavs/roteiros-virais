/**
 * O roteiro (etapa 11, decisões do `PROXIMO.md`, "é o produto"): a partir
 * do tema e do objetivo, monta a entrada com o perfil compilado, o modelo
 * do nicho, a camada exclusiva do cliente e a evidência do banco, chama a
 * tarefa `roteiro` com o verificador, escolhe o vídeo de referência e
 * grava. `outroAngulo` gera a versão seguinte com a instrução de diferir
 * da anterior; `marcarGravado` e `marcarPostado` avançam o status.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  geracoesIA,
  roteiros,
  videosCliente,
  type Cliente,
  type ConteudoRoteiro,
  type Objetivo,
  type Plataforma,
} from "@/db/schema";
import * as roteiroIA from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { hojeISO } from "@/lib/config";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import {
  evidenciaParaRoteiro,
  evidenciaPorIds,
  formatarModeloNicho,
  modeloNichoAtual,
  type VideoEvidenciaRoteiro,
} from "./pesquisa";
import { temasParaCliente } from "./temas";

export class ErroRoteiro extends Error {}

const LIMITE_EVIDENCIA = 8;
const LIMITE_HISTORICO = 10;

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

export type OrigemRoteiro =
  { origem: "sugerido"; temaIndice: number } | { origem: "livre"; textoTema: string };

export type ParametrosGerarRoteiro = OrigemRoteiro & { objetivo: Objetivo; observacao?: string };

/**
 * A camada exclusiva do cliente (cidade, bairro, concorrentes, perfis
 * admirados) para o bloco estável do prompt (etapa 11, decisão 1): decisão
 * adiada na etapa 10 porque, ali, só o tema e a nota importam; aqui, cidade
 * e concorrente mudam de verdade a cena e o gancho.
 */
function formatarCamadaExclusiva(cliente: Cliente): string {
  const linhas: string[] = [];
  if (cliente.cidade) {
    linhas.push(
      cliente.bairro
        ? `Cidade: ${cliente.cidade}, bairro ${cliente.bairro}.`
        : `Cidade: ${cliente.cidade}.`,
    );
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
  return linhas.length > 0
    ? linhas.join(" ")
    : "nenhum dado exclusivo deste cliente registrado ainda.";
}

/**
 * O vídeo de referência (etapa 11, decisão 3): prefere o que tem análise
 * visual com momento chave (a cena exata que funcionou); sem isso, o de
 * maior fora da curva. Decidido em código, não pela IA, para a tela sempre
 * mostrar um segundo e uma frase que existem de verdade.
 */
function escolherReferencia(
  evidencias: VideoEvidenciaRoteiro[],
): { videoId: number; segundo: number; oQueOlhar: string } | null {
  if (evidencias.length === 0) return null;

  const comMomento = evidencias.find((e) => e.analiseVisual?.momentoChave);
  if (comMomento?.analiseVisual?.momentoChave) {
    return {
      videoId: comMomento.id,
      segundo: comMomento.analiseVisual.momentoChave.segundo,
      oQueOlhar: comMomento.analiseVisual.momentoChave.oQue,
    };
  }

  const [maiorForaDaCurva] = [...evidencias].sort((a, b) => b.foraDaCurva - a.foraDaCurva);
  return { videoId: maiorForaDaCurva.id, segundo: 0, oQueOlhar: maiorForaDaCurva.gancho };
}

/** Os ids já vetados pelo tema do dia entram primeiro; completa até o limite com a busca. */
function combinarEvidencias(
  prevista: VideoEvidenciaRoteiro[],
  daBusca: VideoEvidenciaRoteiro[],
  limite: number,
): VideoEvidenciaRoteiro[] {
  const combinado = [...prevista];
  const idsJaIncluidos = new Set(prevista.map((v) => v.id));
  for (const video of daBusca) {
    if (combinado.length >= limite) break;
    if (idsJaIncluidos.has(video.id)) continue;
    combinado.push(video);
    idsJaIncluidos.add(video.id);
  }
  return combinado.slice(0, limite);
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

async function historicoDeRoteiros(
  clienteId: number,
  limite: number,
): Promise<{ tema: string; objetivo: Objetivo; status: string }[]> {
  return db()
    .select({ tema: roteiros.tema, objetivo: roteiros.objetivo, status: roteiros.status })
    .from(roteiros)
    .where(eq(roteiros.clienteId, clienteId))
    .orderBy(desc(roteiros.criadoEm))
    .limit(limite);
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
 * A duração vem do modelo do nicho (regra dura 5, briefing-e-rubricas.md
 * seção 7): o prompt já pede isso, mas nada garante que o modelo obedeça.
 * Sem faixa (nicho sem modelo ainda), aceita a duração que veio.
 */
function respeitarDuracaoDoNicho(
  duracaoS: number,
  faixa: { min: number; max: number } | undefined,
): number {
  if (!faixa) return duracaoS;
  return Math.min(Math.max(duracaoS, faixa.min), faixa.max);
}

/** Campos de texto do roteiro que passam pelo verificador (regra dura 4: sem jargão, emoji, travessão). */
function extrairCamposRoteiro(dados: roteiroIA.SaidaRoteiro): Record<string, string> {
  const campos: Record<string, string> = {
    titulo: dados.titulo,
    gancho: dados.gancho,
    corpo: dados.corpo,
    fechamento: dados.fechamento,
    chamadaFinal: dados.chamadaFinal,
    ondeGravar: dados.ondeGravar,
    ritmoDeCorte: dados.edicao.ritmoDeCorte,
  };
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
  return campos;
}

type MontarERoteiroDados = {
  clienteId: number;
  cliente: Cliente;
  tema: string;
  objetivo: Objetivo;
  observacao?: string;
  evidenciasPrevistas: number[];
  anguloParaEvitar?: { gancho: string; corpo: string };
};

/** O miolo comum a `gerarRoteiro` e `outroAngulo`: busca contexto, chama a IA, monta o conteúdo. */
async function gerarConteudo(
  dados: MontarERoteiroDados,
): Promise<{ conteudo: ConteudoRoteiro; geracaoId: number; referenciaVideoId: number | null }> {
  if (!dados.cliente.nichoId) {
    throw new ErroRoteiro("este cliente ainda nao tem um nicho definido.");
  }
  const nichoId = dados.cliente.nichoId;

  const perfil = await perfilDoCliente(dados.clienteId);
  if (!perfil) {
    throw new ErroRoteiro("o briefing deste cliente ainda nao foi compilado.");
  }

  const [daBusca, prevista, modeloNichoLinha, roteirosRecentes] = await Promise.all([
    evidenciaParaRoteiro(nichoId, dados.tema, LIMITE_EVIDENCIA),
    evidenciaPorIds(dados.evidenciasPrevistas),
    modeloNichoAtual(nichoId),
    historicoDeRoteiros(dados.clienteId, LIMITE_HISTORICO),
  ]);

  const evidencias = combinarEvidencias(prevista, daBusca, LIMITE_EVIDENCIA);
  const referenciaEscolhida = escolherReferencia(evidencias);
  const semEvidencia = evidencias.length === 0;
  const evidenciasFornecidas = evidencias.map((v) => v.id);

  const { dados: saida, geracaoId } = await gerarComVerificacao({
    tarefa: "roteiro",
    nivel: roteiroIA.nivel,
    effort: roteiroIA.esforco,
    versaoPrompt: roteiroIA.versao,
    clienteId: dados.clienteId,
    schema: roteiroIA.schema,
    sistemaEstavel: roteiroIA.montarSistemaEstavel({
      perfilCompilado: formatarPerfilCompilado(perfil),
      modeloNicho: formatarModeloNicho(modeloNichoLinha?.modelo ?? null),
      camadaExclusiva: formatarCamadaExclusiva(dados.cliente),
    }),
    entrada: roteiroIA.montarEntrada({
      tema: dados.tema,
      objetivo: dados.objetivo,
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
      })),
      roteirosRecentes,
      anguloParaEvitar: dados.anguloParaEvitar,
    }),
    proibicoes: perfil.fatos.proibicoes,
    exigeEvidencia: !semEvidencia,
    evidenciasFornecidas,
    extrairCampos: extrairCamposRoteiro,
    extrairEvidencias: (d) => d.evidencias,
  });

  const duracaoS = respeitarDuracaoDoNicho(saida.duracaoS, modeloNichoLinha?.modelo.duracaoTipicaS);

  const conteudo: ConteudoRoteiro = {
    titulo: saida.titulo,
    duracaoS,
    gancho: saida.gancho,
    corpo: saida.corpo,
    fechamento: saida.fechamento,
    chamadaFinal: saida.chamadaFinal,
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
  };

  return { conteudo, geracaoId, referenciaVideoId: referenciaEscolhida?.videoId ?? null };
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

  const { conteudo, geracaoId, referenciaVideoId } = await gerarConteudo({
    clienteId,
    cliente,
    tema,
    objetivo: params.objetivo,
    observacao: params.observacao,
    evidenciasPrevistas,
  });

  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: hojeISO(),
      tema,
      origem: params.origem,
      objetivo: params.objetivo,
      conteudo,
      referenciaVideoId,
      geracaoId,
      status: "gerado",
    })
    .returning();

  return roteiro;
}

/**
 * Outro ângulo (etapa 11, decisão 4 do `PROXIMO.md`): gera a versão
 * seguinte da mesma série, com a instrução explícita de diferir do gancho
 * e da estrutura da versão atual, e grava a avaliação "outro ângulo" (com
 * o motivo, se o cliente deu um) na geração da versão anterior.
 */
export async function outroAngulo(roteiroId: number, motivo?: string): Promise<RoteiroLinha> {
  const [atual] = await db().select().from(roteiros).where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  if (atual.geracaoId) {
    await db()
      .update(geracoesIA)
      .set({ avaliacao: "outro_angulo", motivoAvaliacao: motivo })
      .where(eq(geracoesIA.id, atual.geracaoId));
  }

  const cliente = await clientePorId(atual.clienteId);
  if (!cliente) throw new ErroRoteiro("cliente nao encontrado.");

  const raizId = atual.versaoDe ?? atual.id;
  const serie = await buscarSerie(raizId);
  const proximaVersao = Math.max(...serie.map((r) => r.versao)) + 1;

  const { conteudo, geracaoId, referenciaVideoId } = await gerarConteudo({
    clienteId: atual.clienteId,
    cliente,
    tema: atual.tema,
    objetivo: atual.objetivo,
    observacao: motivo,
    evidenciasPrevistas: atual.conteudo.evidencias,
    anguloParaEvitar: { gancho: atual.conteudo.gancho, corpo: atual.conteudo.corpo },
  });

  const [novaVersao] = await db()
    .insert(roteiros)
    .values({
      clienteId: atual.clienteId,
      data: hojeISO(),
      tema: atual.tema,
      origem: atual.origem,
      objetivo: atual.objetivo,
      conteudo,
      referenciaVideoId,
      versao: proximaVersao,
      versaoDe: raizId,
      geracaoId,
      status: "gerado",
    })
    .returning();

  return novaVersao;
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

export type VersaoRoteiro = { id: number; versao: number; criadoEm: Date; atual: boolean };

/** As versões da mesma série, mais recente primeiro (etapa 11, tela "Versões"). */
export async function versoesDoRoteiro(roteiroId: number): Promise<VersaoRoteiro[]> {
  const [atual] = await db()
    .select({ id: roteiros.id, versaoDe: roteiros.versaoDe })
    .from(roteiros)
    .where(eq(roteiros.id, roteiroId));
  if (!atual) throw new ErroRoteiro("roteiro nao encontrado.");

  const raizId = atual.versaoDe ?? atual.id;
  const serie = await buscarSerie(raizId);
  const maisRecente = serie[0]?.id;

  return serie.map((r) => ({
    id: r.id,
    versao: r.versao,
    criadoEm: r.criadoEm,
    atual: r.id === maisRecente,
  }));
}

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
};

/** Só a ponta de cada série (sem versão mais nova apontando `versaoDe` para ela). */
const SEM_VERSAO_MAIS_NOVA = sql`not exists (select 1 from roteiros mais_novo where mais_novo.versao_de = roteiros.id)`;

/**
 * A lista de `/historico` (etapa 12, decisão 3 do `PROXIMO.md`): mais
 * recente primeiro, só a versão atual de cada série ("outro ângulo" nunca
 * duplica linha no histórico).
 */
export async function roteirosDoCliente(clienteId: number, limite = 200): Promise<RoteiroHistoricoLinha[]> {
  return db()
    .select({
      id: roteiros.id,
      data: roteiros.data,
      tema: roteiros.tema,
      status: roteiros.status,
      gravadoEm: roteiros.gravadoEm,
      postadoEm: roteiros.postadoEm,
    })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), SEM_VERSAO_MAIS_NOVA))
    .orderBy(desc(roteiros.data), desc(roteiros.criadoEm))
    .limit(limite);
}

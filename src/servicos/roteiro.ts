/**
 * O roteiro (etapa 11, decisões do `PROXIMO.md`, "é o produto"): a partir
 * do tema e do objetivo, monta a entrada com o perfil compilado, o modelo
 * do nicho, a camada exclusiva do cliente e a evidência do banco, chama a
 * tarefa `roteiro` com o verificador, escolhe o vídeo de referência e
 * grava. `reprovarERescrever` (E27, parte 1; antes `outroAngulo`) gera a
 * versão seguinte com a instrução de resolver o motivo da reprovação sem
 * mudar o objetivo; `marcarGravado` e `marcarPostado` avançam o status.
 */
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { rotuloDoMotivo, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
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
const DIAS_HISTORICO = 10;

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

/**
 * Dos últimos `dias` dias, com o gancho de cada um (achado do primeiro uso no
 * iPad, item 3: o roteiro do dia 2 começou igual ao do dia 1 porque esta
 * consulta nunca levava o gancho, só título, objetivo e status, e o modelo
 * não tinha como saber qual frase de abertura já foi usada). Por dias corridos
 * em vez de contagem fixa, para o histórico crescer com o cliente sem um
 * número escolhido a dedo.
 */
async function historicoDeRoteiros(
  clienteId: number,
  dias: number,
): Promise<{ tema: string; objetivo: Objetivo; status: string; gancho: string }[]> {
  const linhas = await db()
    .select({
      tema: roteiros.tema,
      objetivo: roteiros.objetivo,
      status: roteiros.status,
      conteudo: roteiros.conteudo,
    })
    .from(roteiros)
    .where(and(eq(roteiros.clienteId, clienteId), gte(roteiros.criadoEm, diasAtras(dias))))
    .orderBy(desc(roteiros.criadoEm));

  return linhas.map((r) => ({
    tema: r.tema,
    objetivo: r.objetivo,
    status: r.status,
    gancho: r.conteudo.gancho,
  }));
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

/**
 * Campos de texto do roteiro que passam pelo verificador (regra dura 4: sem
 * jargão, emoji, travessão). Exportada para `scripts/avaliar-roteiros.ts`
 * rodar a mesma checagem que a produção usa (dia 1 da etapa 14, item 5).
 */
export function extrairCamposRoteiro(dados: roteiroIA.SaidaRoteiro): Record<string, string> {
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
    historicoDeRoteiros(dados.clienteId, DIAS_HISTORICO),
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
      anguloParaEvitar: dados.anguloParaEvitar
        ? {
            gancho: dados.anguloParaEvitar.gancho,
            corpo: dados.anguloParaEvitar.corpo,
            motivos: dados.anguloParaEvitar.motivosIds.map(rotuloDoMotivo),
            motivoTexto: dados.anguloParaEvitar.motivoTexto,
          }
        : undefined,
    }),
    proibicoes: perfil.fatos.proibicoes,
    exigeEvidencia: !semEvidencia,
    evidenciasFornecidas,
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
    duracaoReprovadaS: dados.anguloParaEvitar?.motivosIds.includes("muito_longo")
      ? dados.anguloParaEvitar.duracaoAnteriorS
      : undefined,
    extrairDuracaoS: (d) => d.duracaoS,
    generoTexto: "roteiro",
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
 * Reprovar e reescrever (E27, parte 1; antes "outro ângulo", etapa 11,
 * decisão 4): marca a versão atual como reprovada, com o motivo
 * estruturado (um ou mais, obrigatório) e o texto livre opcional, e gera a
 * versão seguinte da mesma série, com o mesmo objetivo, com a instrução
 * explícita de resolver o motivo sem repetir o gancho nem a estrutura da
 * versão reprovada.
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

  if (atual.geracaoId) {
    await db()
      .update(geracoesIA)
      .set({ avaliacao: "reprovado", motivosAvaliacao: motivosIds, motivoAvaliacao: motivoTexto })
      .where(eq(geracoesIA.id, atual.geracaoId));
  }
  await db().update(roteiros).set({ reprovadoEm: new Date() }).where(eq(roteiros.id, roteiroId));

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
    evidenciasPrevistas: atual.conteudo.evidencias,
    anguloParaEvitar: {
      gancho: atual.conteudo.gancho,
      corpo: atual.conteudo.corpo,
      motivosIds,
      motivoTexto,
      duracaoAnteriorS: atual.conteudo.duracaoS,
    },
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

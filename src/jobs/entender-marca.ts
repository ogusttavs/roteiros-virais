/**
 * Job `entender-marca` (E38 PR 2, "o que entendemos da sua marca"): lê o site e as redes da PRÓPRIA
 * marca (nunca por memória do modelo, sempre por código: o leitor seguro de `site-api.ts`, e a
 * mesma conferência de `pesquisa-de-setor` que o `analisar-perfil` usa), pede à IA as afirmações
 * curtas que a pessoa confirma ou corrige no briefing, e junta com o que já existe sem nunca
 * atropelar uma resposta dela (`contexto-marca-regras.ts`).
 *
 * Dois modos na mesma fila (`FILAS.entenderMarca`, job longo, sem repetição automática):
 * - sem `clienteId` (o cron diário das 01:30, ou o botão "rodar agora" do admin): o despachante.
 *   Por IDADE, não por calendário: enfileira a marca que nunca foi lida, a que passou de
 *   `diasEntreLeituraMarca` desde a última leitura boa e a que tem uma nova tentativa marcada que
 *   venceu. O cron do pg-boss não recupera um disparo perdido (worker reiniciando no minuto
 *   marcado perderia o mês inteiro); por idade, o dia seguinte pega.
 * - com `clienteId` (evento: a pessoa salvou o site ou um perfil; ou o próprio despachante): lê
 *   aquela marca.
 *
 * Falha esperada NUNCA lança (site fora do ar, bloqueio, rede restrita, IA reprovada duas vezes):
 * grava o motivo e uma próxima tentativa e retorna. Só erro de infraestrutura (banco, IA fora do
 * ar) lança. Duas razões: `executarComRegistro` marca erro no painel de acompanhamento (o site de
 * um cliente fora do ar não é um job quebrado), e a fila longa não repete (a leitura inteira no
 * site do cliente não pode rodar três vezes). Nada do texto das páginas vai ao log nem ao resumo.
 *
 * A regra de "não rodar duas vezes" mora no BANCO (idade da última leitura boa, trava
 * `lendo_desde`, hash das fontes), nunca em `singletonSeconds`, que são janelas alinhadas à época.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type FonteContextoMarca,
  type FonteDoContexto,
  clientes,
  contextoMarca,
  contextoMarcaItens,
  geracoesIA,
} from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import * as entenderMarcaIA from "@/ia/prompts/entenderMarca";
import { gerarComVerificacao } from "@/ia/verificador";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";
import { limparCampoPerfil } from "@/lib/perfil-redes";
import { perfilDoCliente } from "@/servicos/briefing";
import { enfileirarEntenderMarca, marcaTemFonteParaLer } from "@/servicos/contexto-marca";
import {
  MINUTOS_TRAVA_LEITURA,
  itemVisivel,
  lerIdAnterior,
  reconciliarItens,
  resumirVideosParaIA,
  tentativaRecenteDemais,
  textoParaMostrar,
} from "@/servicos/contexto-marca-regras";

import { ErroMetaApi, erroMetaEhDaConta } from "./meta-api";
import { type ContaConfirmada, confirmarInstagram, confirmarYoutube } from "./pesquisa-de-setor";
import { type ResultadoLeituraSite, lerSiteDaMarca } from "./site-api";
import { ErroYoutubeApi } from "./youtube-api";

export type PayloadEntenderMarca = {
  clienteId?: number;
  origem?: "mensal" | "evento" | "manual";
  /** Ignora a idade, o intervalo entre leituras, o hash e o teto do mês (só `npm run job -- entender-marca <id> --forcar`). */
  forcar?: boolean;
} | null;

/** Para os testes trocarem a rede por uma função falsa (o resto do job roda de verdade). */
export type DepsEntenderMarca = {
  lerSite?: (urlSalva: string) => Promise<ResultadoLeituraSite>;
  confirmarRede?: (rede: "instagram" | "youtube", handle: string) => Promise<ContaConfirmada | null>;
};

const DIA_MS = 86_400_000;
/** Falha que costuma passar sozinha (site fora do ar, rede indisponível, IA reprovada): tenta de novo em 3 dias. */
const DIAS_NOVA_TENTATIVA_TRANSITORIA = 3;
/** Motivos do leitor de site que costumam passar sozinhos; o resto (rede social, bloqueio, sem texto) espera o ciclo normal. */
const MOTIVOS_DE_SITE_TRANSITORIOS = new Set<string>(["erro_do_site", "tempo_esgotado", "sem_resposta", "robots_indisponivel"]);

const PAGINAS_NO_MAXIMO = 5;

function inicioDoMes(agora: Date): Date {
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
}

/** Quanto a tarefa já gastou neste mês, lido do banco (soma em memória não vale: o job pode repetir). */
async function custoDoMesUsd(agora: Date): Promise<number> {
  const [linha] = await db()
    .select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "entenderMarca"), gte(geracoesIA.criadoEm, inicioDoMes(agora))));
  return Number(linha?.total ?? 0);
}

/** sha256 do que foi lido: o texto limpo das páginas e os títulos dos vídeos (nunca os números de visualização, que mudam todo dia). */
export function hashDasFontes(
  hashesDasPaginas: string[],
  redes: { rede: string; titulos: string[] }[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ site: [...hashesDasPaginas].sort(), redes: redes.map((r) => [r.rede, r.titulos]) }))
    .digest("hex");
}

/**
 * O despachante: quem precisa ser lido hoje. Elegível quando a marca está ativa, tem de onde ler, e
 * (a) nunca foi lida, ou (b) a última leitura boa passou de `diasEntreLeituraMarca`, ou (c) tem uma
 * nova tentativa marcada que venceu. Uma tentativa marcada para o futuro segura a marca mesmo que
 * esteja velha (nada de insistir no site de quem acabou de falhar).
 */
async function despachar(agora: Date): Promise<Record<string, unknown>> {
  const gastoDoMes = await custoDoMesUsd(agora);
  if (gastoDoMes >= config.regras.tetoCustoLeituraMarcaMesUsd) {
    logger.warn({ gastoDoMes }, "entender-marca: teto de custo do mês atingido, nada enfileirado");
    return { modo: "despacho", paradoPeloTeto: true, custoDoMesUsd: gastoDoMes };
  }

  const limiteDeIdade = new Date(agora.getTime() - config.regras.diasEntreLeituraMarca * DIA_MS);
  const candidatas = await db()
    .select({ id: clientes.id, site: clientes.site, perfis: clientes.perfis })
    .from(clientes)
    .leftJoin(contextoMarca, eq(contextoMarca.clienteId, clientes.id))
    .where(
      and(
        eq(clientes.ativo, true),
        or(
          and(isNull(contextoMarca.proximaTentativaEm), or(isNull(contextoMarca.ultimaLeituraOkEm), lte(contextoMarca.ultimaLeituraOkEm, limiteDeIdade))),
          lte(contextoMarca.proximaTentativaEm, agora),
        ),
        or(isNull(contextoMarca.lendoDesde), lte(contextoMarca.lendoDesde, new Date(agora.getTime() - MINUTOS_TRAVA_LEITURA * 60_000))),
      ),
    )
    .orderBy(sql`${contextoMarca.ultimaLeituraOkEm} asc nulls first`, asc(clientes.id));

  const comFonte = candidatas.filter(marcaTemFonteParaLer);
  const dasRodada = comFonte.slice(0, config.regras.leiturasDeMarcaPorRodada);

  let enfileiradas = 0;
  let jaNaFila = 0;
  for (const marca of dasRodada) {
    try {
      // Janela de 12 horas: o despachante roda todo dia, e uma marca já na fila não entra duas vezes.
      const entrou = await enfileirarEntenderMarca(marca.id, "mensal", { janelaSegundos: 12 * 3600 });
      if (entrou) enfileiradas += 1;
      else jaNaFila += 1;
    } catch (erro) {
      logger.error({ err: erro, clienteId: marca.id }, "entender-marca: nao foi possivel enfileirar a marca");
    }
  }

  return {
    modo: "despacho",
    marcasElegiveis: comFonte.length,
    enfileiradas,
    jaNaFila,
    ficaramParaAmanha: Math.max(0, comFonte.length - dasRodada.length),
    custoDoMesUsd: gastoDoMes,
  };
}

type RedeLida = {
  rede: "instagram" | "youtube";
  handle: string;
  resumo: ReturnType<typeof resumirVideosParaIA>;
};

async function confirmarRedeReal(rede: "instagram" | "youtube", handle: string): Promise<ContaConfirmada | null> {
  return rede === "youtube" ? confirmarYoutube(handle) : confirmarInstagram(handle);
}

/** Uma rede da própria marca: lida, ou o motivo de não ter sido (a tela escolhe a frase pelo motivo). */
async function lerRede(
  clienteId: number,
  rede: "instagram" | "youtube",
  handleBruto: string,
  deps: DepsEntenderMarca,
): Promise<{ fonte: FonteDoContexto; lida: RedeLida | null; transitorio: boolean }> {
  const naoLida = (motivo: string, transitorio = false) => ({
    fonte: { tipo: rede, lida: false, motivo } satisfies FonteDoContexto,
    lida: null,
    transitorio,
  });

  const handle = limparCampoPerfil(handleBruto, rede);
  if (!handle) return naoLida("nao_encontrado");
  if (rede === "instagram" && !deps.confirmarRede && !config.coleta.metaAtivo) return naoLida("desligada");

  let confirmado: ContaConfirmada | null;
  try {
    confirmado = await (deps.confirmarRede ?? confirmarRedeReal)(rede, handle);
  } catch (erro) {
    if (erro instanceof ErroYoutubeApi && erro.message.includes("playlistNotFound")) return naoLida("sem_videos");
    if (erro instanceof ErroMetaApi && erroMetaEhDaConta(erro)) return naoLida("conta_restrita");
    logger.error({ err: erro, clienteId, rede }, "entender-marca: falha lendo a rede da marca");
    return naoLida("indisponivel", true);
  }
  if (!confirmado) return naoLida("nao_encontrado");

  const resumo = resumirVideosParaIA(confirmado.videos.map((video) => ({ titulo: video.titulo, views: video.views })));
  if (resumo.videos.length === 0) return naoLida("sem_videos");
  return {
    fonte: { tipo: rede, lida: true, quantidade: resumo.videos.length },
    lida: { rede, handle, resumo },
    transitorio: false,
  };
}

function caminhoDaPagina(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

function enderecoDoSite(resultado: ResultadoLeituraSite, urlSalva: string): string {
  for (const candidato of [resultado.hostFinal, urlSalva]) {
    if (!candidato) continue;
    try {
      return new URL(candidato.includes("://") ? candidato : `https://${candidato}`).host;
    } catch {
      continue;
    }
  }
  return "site da marca";
}

async function lerMarca(
  pedido: { clienteId: number; origem: "mensal" | "evento" | "manual"; forcar: boolean },
  agora: Date,
  deps: DepsEntenderMarca,
): Promise<Record<string, unknown>> {
  const { clienteId, origem, forcar } = pedido;
  const inicioReal = new Date();
  const resumoBase = { modo: "leitura", clienteId, origem };

  const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
  if (!cliente || !cliente.ativo) return { ...resumoBase, pulado: "marca_inativa" };
  if (!marcaTemFonteParaLer(cliente)) return { ...resumoBase, pulado: "sem_fontes" };

  await db().insert(contextoMarca).values({ clienteId }).onConflictDoNothing();
  const [antes] = await db().select().from(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));

  if (!forcar) {
    if (origem === "evento" && tentativaRecenteDemais(antes?.ultimaTentativaEm ?? null, agora, config.regras.minutosEntreLeiturasMarcaPorEvento)) {
      // A pessoa mexeu de novo logo depois de uma leitura: não bate no site dela de novo agora, mas também não perde o que mudou.
      const minutos = config.regras.minutosEntreLeiturasMarcaPorEvento;
      const reenfileirada = await enfileirarEntenderMarca(clienteId, "evento", {
        chave: `marca-${clienteId}-depois`,
        janelaSegundos: minutos * 60,
        depoisDeSegundos: minutos * 60 + 5,
      }).catch(() => false);
      return { ...resumoBase, pulado: "recente_demais", reenfileirada };
    }
    if (origem === "mensal") {
      const idadeMs = antes?.ultimaLeituraOkEm ? agora.getTime() - antes.ultimaLeituraOkEm.getTime() : null;
      if (idadeMs !== null && idadeMs < config.regras.diasEntreLeituraMarca * DIA_MS && !(antes?.proximaTentativaEm && antes.proximaTentativaEm <= agora)) {
        return { ...resumoBase, pulado: "lido_recentemente" };
      }
      if (antes?.proximaTentativaEm && antes.proximaTentativaEm > agora) {
        return { ...resumoBase, pulado: "aguardando_nova_tentativa" };
      }
    }
    const gastoDoMes = await custoDoMesUsd(agora);
    if (gastoDoMes >= config.regras.tetoCustoLeituraMarcaMesUsd) {
      logger.warn({ clienteId, gastoDoMes }, "entender-marca: teto de custo do mês atingido");
      return { ...resumoBase, pulado: "teto_do_mes", custoDoMesUsd: gastoDoMes };
    }
  }

  // A trava: duas leituras da mesma marca nunca rodam juntas (job vencido por cima do original, clique duplo).
  const travou = await db()
    .update(contextoMarca)
    .set({ lendoDesde: agora, ultimaTentativaEm: agora })
    .where(
      and(
        eq(contextoMarca.clienteId, clienteId),
        or(isNull(contextoMarca.lendoDesde), lte(contextoMarca.lendoDesde, new Date(agora.getTime() - MINUTOS_TRAVA_LEITURA * 60_000))),
      ),
    )
    .returning({ id: contextoMarca.id });
  if (travou.length === 0) return { ...resumoBase, pulado: "ja_lendo" };

  try {
    return await lerMarcaComTrava({ ...resumoBase, forcar }, cliente, antes, agora, inicioReal, deps);
  } finally {
    await db()
      .update(contextoMarca)
      .set({ lendoDesde: null })
      .where(eq(contextoMarca.clienteId, clienteId))
      .catch((erro: unknown) => logger.error({ err: erro, clienteId }, "entender-marca: nao soltou a trava"));
  }
}

async function lerMarcaComTrava(
  resumoBase: { modo: string; clienteId: number; origem: string; forcar: boolean },
  cliente: typeof clientes.$inferSelect,
  antes: typeof contextoMarca.$inferSelect | undefined,
  agora: Date,
  inicioReal: Date,
  deps: DepsEntenderMarca,
): Promise<Record<string, unknown>> {
  const clienteId = cliente.id;
  const fontes: FonteDoContexto[] = [];
  let transitorio = false;

  // 1. O site.
  let site: { endereco: string; paginas: entenderMarcaIA.PaginaParaIA[] } | null = null;
  let hashesDasPaginas: string[] = [];
  if (cliente.site?.trim()) {
    const resultado = await (deps.lerSite ?? lerSiteDaMarca)(cliente.site.trim());
    const paginas = resultado.paginas.filter((pagina) => pagina.texto.trim() !== "").slice(0, PAGINAS_NO_MAXIMO);
    if (paginas.length > 0) {
      site = { endereco: enderecoDoSite(resultado, cliente.site), paginas: paginas.map((p) => ({ caminho: caminhoDaPagina(p.url), texto: p.texto })) };
      hashesDasPaginas = paginas.map((p) => p.hash);
      fontes.push({ tipo: "site", lida: true, quantidade: paginas.length });
    } else {
      const motivo = resultado.motivoGeral ?? "sem_texto";
      fontes.push({ tipo: "site", lida: false, motivo });
      if (MOTIVOS_DE_SITE_TRANSITORIOS.has(motivo)) transitorio = true;
    }
  }

  // 2. As redes da própria marca (Instagram pela Meta, YouTube pela Data API; o TikTok fica de fora, Apify suspenso).
  const redes: RedeLida[] = [];
  for (const rede of ["instagram", "youtube"] as const) {
    const handle = cliente.perfis?.[rede]?.trim();
    if (!handle) continue;
    const lida = await lerRede(clienteId, rede, handle, deps);
    fontes.push(lida.fonte);
    if (lida.lida) redes.push(lida.lida);
    if (lida.transitorio) transitorio = true;
  }

  const fontesLidas = new Set<FonteContextoMarca>(fontes.filter((f) => f.lida && f.tipo !== "tiktok").map((f) => f.tipo as FonteContextoMarca));
  const resumoDasFontes = fontes.map((f) => ({ tipo: f.tipo, lida: f.lida, motivo: f.motivo, quantidade: f.quantidade }));
  const quandoTentarDeNovo = (): Date =>
    new Date(agora.getTime() + (transitorio ? DIAS_NOVA_TENTATIVA_TRANSITORIA : config.regras.diasEntreLeituraMarca) * DIA_MS);

  // Nada lido: não há o que perguntar à IA. Grava o motivo de cada fonte para a tela dizer o que houve.
  if (fontesLidas.size === 0) {
    await db()
      .update(contextoMarca)
      .set({ fontes, proximaTentativaEm: quandoTentarDeNovo(), atualizadoEm: new Date() })
      .where(eq(contextoMarca.clienteId, clienteId));
    return { ...resumoBase, pulado: "nada_lido", fontes: resumoDasFontes };
  }

  // 3. Mesmas fontes de antes: não gasta IA, só confirma que a leitura continua em dia.
  const hash = hashDasFontes(hashesDasPaginas, redes.map((r) => ({ rede: r.rede, titulos: r.resumo.videos.map((v) => v.titulo) })));
  if (!resumoBase.forcar && antes?.hashFontes === hash && antes.ultimaLeituraOkEm) {
    await db()
      .update(contextoMarca)
      .set({ fontes, ultimaLeituraOkEm: agora, proximaTentativaEm: transitorio ? quandoTentarDeNovo() : null, atualizadoEm: new Date() })
      .where(eq(contextoMarca.clienteId, clienteId));
    return { ...resumoBase, hashIgual: true, fontes: resumoDasFontes, custoUsd: 0 };
  }

  // 4. A IA.
  const itensDoBanco = await db().select().from(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId)).orderBy(asc(contextoMarcaItens.id));
  const perfil = await perfilDoCliente(clienteId);
  const resumoDoBriefing = perfil ? [perfil.resumo, `O que vende: ${perfil.fatos.oQueVende}`, `Cliente ideal: ${perfil.fatos.clienteIdeal}`].filter(Boolean).join(" ") : "";

  let saida: entenderMarcaIA.SaidaEntenderMarca;
  try {
    const { dados } = await gerarComVerificacao({
      tarefa: "entenderMarca",
      nivel: entenderMarcaIA.nivel,
      effort: entenderMarcaIA.esforco,
      versaoPrompt: entenderMarcaIA.versao,
      clienteId,
      schema: entenderMarcaIA.schema,
      sistemaEstavel: entenderMarcaIA.montarSistemaEstavel(),
      entrada: entenderMarcaIA.montarEntrada({
        nomeDaMarca: cliente.nome,
        tipo: cliente.tipo,
        resumoDoBriefing,
        itensAtuais: itensDoBanco
          .filter((item) => item.estado !== "recusado" && itemVisivel(item))
          .map((item) => ({
            id: item.id,
            categoria: item.categoria,
            origem: item.origem,
            estado: item.estado as "para_confirmar" | "confirmado" | "corrigido",
            texto: textoParaMostrar(item),
          })),
        itensTirados: itensDoBanco.filter((item) => item.estado === "recusado").slice(-15).map((item) => item.texto),
        site,
        redes: redes.map((r) => ({ rede: r.rede, handle: r.handle, medianaVisualizacoes: r.resumo.medianaVisualizacoes, videos: r.resumo.videos })),
      }),
      generoTexto: "padrao",
      extrairCampos: (d) => Object.fromEntries(d.itens.map((item, indice) => [`item${indice + 1}`, item.texto])),
      lembreteFinal: entenderMarcaIA.LEMBRETE_ACENTUACAO,
      maxTokens: 2_500,
    });
    saida = dados;
  } catch (erro) {
    if (!(erro instanceof ErroIA)) throw erro;
    // Reprovada duas vezes pelo verificador (ou a IA recusou): falha esperada, nova tentativa em alguns dias.
    logger.error({ err: erro, clienteId }, "entender-marca: a IA nao produziu um texto aprovado");
    await db()
      .update(contextoMarca)
      .set({ fontes, proximaTentativaEm: new Date(agora.getTime() + DIAS_NOVA_TENTATIVA_TRANSITORIA * DIA_MS), atualizadoEm: new Date() })
      .where(eq(contextoMarca.clienteId, clienteId));
    return { ...resumoBase, pulado: "ia_reprovada", fontes: resumoDasFontes };
  }

  // 5. Junta com o que já existe, numa transação, com as linhas travadas (a pessoa pode estar confirmando agora).
  const reconciliacao = await db().transaction(async (tx) => {
    const existentes = await tx.select().from(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId)).for("update");
    const resultado = reconciliarItens({
      existentes,
      propostos: saida.itens.map((item) => ({
        categoria: item.categoria,
        origem: item.origem,
        texto: item.texto,
        idAnterior: lerIdAnterior(item.idAnterior),
        alemDoBriefing: item.alemDoBriefing,
      })),
      fontesLidas,
      primeiraLeitura: existentes.length === 0 && !antes?.ultimaLeituraOkEm,
      agora,
    });
    for (const novo of resultado.criar) {
      await tx.insert(contextoMarcaItens).values({ clienteId, ...novo, ultimaVezVistoEm: agora });
    }
    for (const { id, ...campos } of resultado.atualizar) {
      await tx
        .update(contextoMarcaItens)
        .set({ ...campos, atualizadoEm: new Date() })
        .where(and(eq(contextoMarcaItens.id, id), eq(contextoMarcaItens.clienteId, clienteId), ne(contextoMarcaItens.estado, "recusado")));
    }
    await tx
      .update(contextoMarca)
      .set({
        hashFontes: hash,
        fontes,
        ultimaLeituraOkEm: agora,
        proximaTentativaEm: transitorio ? quandoTentarDeNovo() : null,
        atualizadoEm: new Date(),
      })
      .where(eq(contextoMarca.clienteId, clienteId));
    return resultado;
  });

  const [gasto] = await db()
    .select({ total: sql<string>`coalesce(sum(${geracoesIA.custoUsd}), 0)` })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.clienteId, clienteId), inArray(geracoesIA.tarefa, ["entenderMarca", "verificarTexto"]), gte(geracoesIA.criadoEm, inicioReal)));

  return {
    ...resumoBase,
    fontes: resumoDasFontes,
    itens: reconciliacao.resumo,
    custoUsd: Number(gasto?.total ?? 0),
    ...(transitorio ? { novaTentativaEm: quandoTentarDeNovo().toISOString() } : {}),
  };
}

export async function rodarEntenderMarca(
  payload: PayloadEntenderMarca = null,
  agora: Date = new Date(),
  deps: DepsEntenderMarca = {},
): Promise<Record<string, unknown>> {
  const clienteId = payload?.clienteId;
  if (clienteId === undefined || !Number.isInteger(clienteId)) return despachar(agora);
  return lerMarca({ clienteId, origem: payload?.origem ?? "evento", forcar: payload?.forcar === true }, agora, deps);
}

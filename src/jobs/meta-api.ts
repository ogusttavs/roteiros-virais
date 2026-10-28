/**
 * Cliente fino da Graph API da Meta (E6 parte 3, segunda rodada, item 1):
 * `GET` com `access_token`, versao fixa `v26.0` (confirmada rodando de
 * verdade em 08/09/2026, `acessos/meta-app.md`, tres chamadas de prova
 * pela conta da Velura). So chamar quando `config.coleta.metaAtivo`; quem
 * chama confere isso antes (o cliente nao valida sozinho, para nao
 * duplicar a checagem em cada job).
 *
 * Business Discovery (perfil e posts de qualquer conta comercial/criador,
 * de graca, `estrategia/plano-de-execucao.md`, item i) e Hashtag Search
 * (`top_media`, sinal de assunto, sem conta dona nem views).
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { asc, count, eq, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { chamadasMetaApi, configuracaoAdmin, type ViaDaLigacao } from "@/db/schema";
import { config } from "@/lib/config";
import { enderecoDoGraphDaVia, provaDoSegredo } from "@/lib/meta-oauth";

const BASE = "https://graph.facebook.com/v26.0";

/**
 * E19b: o acesso de uma conta ligada pela própria pessoa. `via` diz em que servidor ele vale: `facebook` é `graph.facebook.com` (como sempre); `instagram` é `graph.instagram.com`
 * (`pesquisa/plataformas/docs/meta/ig-media-referencia.md`, `ig-media-insights.md`: coluna "URL de hospedagem"). Uma `string` sozinha é o acesso da via do Facebook (os chamadores de antes).
 */
export type AcessoDaConta = { token: string; via: ViaDaLigacao };
export type TokenOuAcesso = string | AcessoDaConta;

function acessoDe(valor: TokenOuAcesso): AcessoDaConta {
  return typeof valor === "string" ? { token: valor, via: "facebook" } : valor;
}

/**
 * 200 chamadas por hora por conta profissional conectada (o item i do
 * plano). Janela corrida, nao por hora de relogio: `chamadas_meta_api`
 * guarda o instante de cada chamada, sem distincao de hora, para o
 * limitador comparar contra "as ultimas 60 minutos" de verdade.
 */
export const LIMITE_CHAMADAS_HORA = 200;
export const JANELA_MS = 60 * 60 * 1000;

/**
 * Erro da Meta com codigo, subcodigo e mensagem (PROXIMO.md, item 1): a
 * Graph API devolve isso tanto com status HTTP de erro quanto, as vezes,
 * com 200 e um corpo `{ error: {...} }` (achado documentado da API, nao
 * testado ainda contra uma resposta real de erro nesta rodada).
 */
export class ErroMetaApi extends Error {
  constructor(
    message: string,
    public readonly codigo?: number,
    public readonly subcodigo?: number,
  ) {
    super(message);
  }
}

type ErroMeta = { message?: string; code?: number; error_subcode?: number };

/**
 * Codigo 100 (Business Discovery de conta que nao e comercial ou de
 * criador) e codigo 110 (`{"code": 110, "error_subcode": 2207013, "message":
 * "Invalid user id"}`, chamada real do Fable contra um handle inventado,
 * revisao do PR #35: conta que nao existe) sao erro da CONTA chamada: so
 * essa conta deve virar `api_indisponivel_em`. Achado da leitura previa do
 * Fable, 09/09/2026, correcao 1 do `PROXIMO.md`: antes, qualquer
 * `ErroMetaApi` marcava a conta, e um token vencido ou um limite de taxa
 * (que afetam TODAS as contas, nao uma so) marcava as 50 contas vigiadas de
 * uma vez e jogava todas de volta para o Apify pago, sem nunca mais tentar
 * a API. Sem o 110, uma conta inexistente (ou, pela mesma familia de erro,
 * uma conta pessoal) nunca era marcada, era tentada todo dia para sempre e
 * nunca caia para o Apify: o inverso do problema original.
 */
export const CODIGOS_ERRO_DE_CONTA = [100, 110];

/** Token vencido (190) ou limite de taxa (4, 17, 32, 613): afeta a chamada inteira, nao uma conta. */
export const CODIGOS_TOKEN_OU_LIMITE = [190, 4, 17, 32, 613];

/**
 * Hashtag que nao existe na Meta (achado da prova do PR #38, 10/09/2026): a
 * hipotese de que `ig_hashtag_search` devolveria vazio estava errada.
 * Chamada real contra "limpezadepaineldecarro" devolveu `code 24`,
 * `error_subcode 2207024`, `type OAuthException`, "The requested resource
 * does not exist" (`error_user_title` "Nao foi possivel encontrar uma
 * hashtag correspondente"). So os dois juntos, nao so o `code`: 24 sozinho e
 * o codigo generico "resource does not exist" da Graph API, usado para
 * varios recursos alem de hashtag.
 */
export const CODIGO_HASHTAG_INEXISTENTE = 24;
export const SUBCODIGO_HASHTAG_INEXISTENTE = 2207024;

export function erroMetaEhDaConta(erro: ErroMetaApi): boolean {
  return erro.codigo !== undefined && CODIGOS_ERRO_DE_CONTA.includes(erro.codigo);
}

export function erroMetaEhTokenOuLimite(erro: ErroMetaApi): boolean {
  return erro.codigo !== undefined && CODIGOS_TOKEN_OU_LIMITE.includes(erro.codigo);
}

export function erroMetaEhHashtagInexistente(erro: ErroMetaApi): boolean {
  return erro.codigo === CODIGO_HASHTAG_INEXISTENTE && erro.subcodigo === SUBCODIGO_HASHTAG_INEXISTENTE;
}

/**
 * O limite do aplicativo na Meta (achado de 05/10/2026, madrugada): `meta-contas` e `contas-base` falharam com "(#4) Application request limit reached", porque o aplicativo
 * sem aprovação tem o limite de desenvolvimento por hora e as duas rotinas pediam dezenas de contas a cinco minutos uma da outra. A Meta diz o quanto do limite já foi usado em
 * toda resposta, nos cabeçalhos `x-app-usage` e `x-business-use-case-usage` (porcentagens de 0 a 100). Passando de `LIMITE_DE_USO_PERCENTUAL`, a próxima chamada já nem sai:
 * lança `PausaDaMeta`, que as rotinas tratam como "limite da Meta, continua na próxima hora" (não é erro) em vez de esbarrar no código 4.
 */
export const LIMITE_DE_USO_PERCENTUAL = 80;

/**
 * A fatia das hashtags (23/10/2026, passo 5 do `pesquisa/estudo-instagram-sem-apify.md`): `meta-hashtags` não rodava desde 05/10 porque `meta-contas` (e a faixa Meta de `contas-base`) levava o
 * uso do aplicativo até o limite de 80% todo dia, e a pausa, que vale para tudo, já estava de pé quando as hashtags chegavam. Agora a leitura de contas (a Business Discovery, que é o consumo
 * grande: dezenas de pedidos por rodada) para antes, em `LIMITE_DE_USO_PERCENTUAL - RESERVA_DAS_HASHTAGS_PERCENTUAL` (60%), com uma pausa só dela; os 20 pontos que sobram ficam para a hashtag
 * (até 30 resoluções e um `recent_media` por termo por dia, bem menos que as contas) e para o resto (curva do cliente). O 20 é um palpite pela ordem de grandeza e deve ser recalibrado com os
 * números que o resumo da noite passa a trazer (`usoDaMeta`, `ResumoDeUsoDaMeta`).
 */
export const RESERVA_DAS_HASHTAGS_PERCENTUAL = 20;
export const LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL = LIMITE_DE_USO_PERCENTUAL - RESERVA_DAS_HASHTAGS_PERCENTUAL;

/** Quanto a Meta fica em pausa depois de passar do limite (ou de um erro de limite): a hora seguinte. */
export const PAUSA_DA_META_MS = 60 * 60 * 1000;
export const MOTIVO_DA_PAUSA = "limite da Meta, continua na próxima hora";

/**
 * Quem está chamando, para a fatia das hashtags: `contas` é a Business Discovery (a leitura em massa, que para em 60%) e `geral` é todo o resto (hashtag, mídia do cliente, Páginas), que só para
 * em 80%. Uma chamada `contas` obedece às duas pausas; uma `geral`, só à de 80%.
 */
export type ClasseDeChamada = "geral" | "contas";

const CHAVES_DA_PAUSA: Record<ClasseDeChamada, { ate: string; causa: string }> = {
  geral: { ate: "meta_pausa_ate", causa: "meta_pausa_causa" },
  contas: { ate: "meta_pausa_contas_ate", causa: "meta_pausa_contas_causa" },
};

/** As três medidas de uso que a Meta devolve (`limites-graph-rate-limiting.md`): percentuais de 0 a 100 na janela de uma hora. */
export type MedidaDeUso = "call_count" | "total_cputime" | "total_time";
const MEDIDAS_DE_USO: MedidaDeUso[] = ["call_count", "total_time", "total_cputime"];
/** O cabeçalho de onde a medida veio. O `x-ad-account-usage` é da API de Anúncios: só é guardado, nunca pausa. */
export type FonteDeUso = "x-app-usage" | "x-business-use-case-usage" | "x-ad-account-usage";

export type MedidasVistas = Partial<Record<MedidaDeUso, number>>;

/** O que os cabeçalhos de uma resposta dizem, com o maior valor de cada medida quando o cabeçalho traz vários objetos. */
export type LeituraDeUso = {
  app: MedidasVistas | null;
  buc: (MedidasVistas & { estimated_time_to_regain_access?: number }) | null;
  tiposBuc: string[];
  adAccount: { acc_id_util_pct: number } | null;
  esperaMin: number | null;
};

/** Quanto do limite já foi usado, na maior das medidas, e (quando a Meta diz) em quantos minutos o acesso volta. */
export type UsoDaMeta = { percentual: number; medida: string; esperaMin: number | null };

type Cabecalhos = { get(nome: string): string | null };

function juntarMaior(alvo: MedidasVistas, objeto: unknown): boolean {
  if (typeof objeto !== "object" || objeto === null) return false;
  let achou = false;
  for (const medida of MEDIDAS_DE_USO) {
    const valor = (objeto as Record<string, unknown>)[medida];
    if (typeof valor === "number" && Number.isFinite(valor)) {
      alvo[medida] = Math.max(alvo[medida] ?? valor, valor);
      achou = true;
    }
  }
  return achou;
}

/**
 * Lê `x-app-usage` ({"call_count":12,"total_time":3,"total_cputime":5}), `x-business-use-case-usage` ({"<id>":[{"type":"instagram","call_count":..,"estimated_time_to_regain_access":0}]}, até 32
 * objetos) e `x-ad-account-usage` ({"acc_id_util_pct":9.67}); nomes e formato conferidos em `pesquisa/plataformas/docs/meta/limites-graph-rate-limiting.md` (baixado em 23/10/2026). Cabeçalho
 * ausente ou que não é JSON não derruba nada: aquele campo fica nulo.
 */
export function lerCabecalhosDeUso(cabecalhos: Cabecalhos): LeituraDeUso {
  const leitura: LeituraDeUso = { app: null, buc: null, tiposBuc: [], adAccount: null, esperaMin: null };
  const lerJson = (nome: string): unknown => {
    const cru = cabecalhos.get(nome);
    if (!cru) return undefined;
    try {
      return JSON.parse(cru) as unknown;
    } catch {
      return undefined;
    }
  };

  const app: MedidasVistas = {};
  if (juntarMaior(app, lerJson("x-app-usage"))) leitura.app = app;

  const buc: MedidasVistas & { estimated_time_to_regain_access?: number } = {};
  const dadoBuc = lerJson("x-business-use-case-usage");
  let achouBuc = false;
  if (typeof dadoBuc === "object" && dadoBuc !== null) {
    for (const lista of Object.values(dadoBuc)) {
      if (!Array.isArray(lista)) continue;
      for (const item of lista) {
        if (juntarMaior(buc, item)) achouBuc = true;
        const registro = item as { type?: unknown; estimated_time_to_regain_access?: unknown } | null;
        if (typeof registro?.type === "string" && !leitura.tiposBuc.includes(registro.type)) leitura.tiposBuc.push(registro.type);
        const espera = registro?.estimated_time_to_regain_access;
        if (typeof espera === "number" && espera > 0) {
          buc.estimated_time_to_regain_access = Math.max(buc.estimated_time_to_regain_access ?? 0, espera);
          leitura.esperaMin = Math.max(leitura.esperaMin ?? 0, espera);
        }
      }
    }
  }
  if (achouBuc) leitura.buc = buc;

  const anuncios = lerJson("x-ad-account-usage") as { acc_id_util_pct?: unknown } | null | undefined;
  if (typeof anuncios?.acc_id_util_pct === "number" && Number.isFinite(anuncios.acc_id_util_pct)) {
    leitura.adAccount = { acc_id_util_pct: anuncios.acc_id_util_pct };
  }
  return leitura;
}

/** A maior das medidas que contam para a pausa (`x-app-usage` e `x-business-use-case-usage`), com o cabeçalho de onde veio. Empate: a primeira lida (app antes de BUC). */
export function maiorUsoDaLeitura(leitura: LeituraDeUso): { fonte: FonteDeUso; medida: MedidaDeUso; percentual: number } | null {
  let maior: { fonte: FonteDeUso; medida: MedidaDeUso; percentual: number } | null = null;
  const candidatos: [FonteDeUso, MedidasVistas | null][] = [
    ["x-app-usage", leitura.app],
    ["x-business-use-case-usage", leitura.buc],
  ];
  for (const [fonte, medidas] of candidatos) {
    if (!medidas) continue;
    for (const medida of MEDIDAS_DE_USO) {
      const valor = medidas[medida];
      if (valor !== undefined && (maior === null || valor > maior.percentual)) maior = { fonte, medida, percentual: valor };
    }
  }
  return maior;
}

/** Só a maior medida e a espera, sem dizer o cabeçalho (o que as rotinas liam antes da medição de 23/10/2026). */
export function lerUsoDaMeta(cabecalhos: Cabecalhos): UsoDaMeta | null {
  const leitura = lerCabecalhosDeUso(cabecalhos);
  const maior = maiorUsoDaLeitura(leitura);
  return maior ? { percentual: maior.percentual, medida: maior.medida, esperaMin: leitura.esperaMin } : null;
}

/** Por que a Meta foi pausada: qual medida de qual cabeçalho passou de qual limite, ou qual código de erro a Meta devolveu. */
export type CausaDaPausa = {
  origem: "uso" | "erro";
  classe: ClasseDeChamada;
  fonte?: FonteDeUso;
  medida?: MedidaDeUso;
  percentual?: number;
  limite?: number;
  codigoDeErro?: number;
};

/** O que o resumo da rotina guarda do uso do aplicativo: o maior valor visto de cada medida em cada cabeçalho, e qual medida pausou. Sem token, sem endereço, só números. */
export type ResumoDeUsoDaMeta = {
  respostas: number;
  respostasComCabecalhoDeUso: number;
  xAppUsage?: MedidasVistas;
  xBusinessUseCaseUsage?: MedidasVistas & { estimated_time_to_regain_access?: number; tipos?: string[] };
  xAdAccountUsage?: { acc_id_util_pct: number };
  maior?: { fonte: FonteDeUso; medida: MedidaDeUso; percentual: number };
  pausa?: CausaDaPausa & { herdada: boolean };
};

const armazenamentoDoMedidor = new AsyncLocalStorage<MedidorDeUsoDaMeta>();

function mesclarMaior(atual: MedidasVistas | undefined, novo: MedidasVistas): MedidasVistas {
  const saida: MedidasVistas = { ...atual };
  for (const medida of MEDIDAS_DE_USO) {
    const valor = novo[medida];
    if (valor !== undefined) saida[medida] = Math.max(saida[medida] ?? valor, valor);
  }
  return saida;
}

/**
 * Mede o uso do aplicativo durante uma rotina (passo 4 do estudo de 23/10/2026): tudo o que `chamar` ler nos cabeçalhos dentro de `executar` vai para este medidor (escopo por execução, via
 * `AsyncLocalStorage`: duas rotinas ao mesmo tempo no worker não misturam os números). `resumo()` é o que a rotina põe no resultado, para o banco guardar em `execucoes_job.resumo`.
 */
export class MedidorDeUsoDaMeta {
  private dados: ResumoDeUsoDaMeta = { respostas: 0, respostasComCabecalhoDeUso: 0 };

  executar<T>(fazer: () => Promise<T>): Promise<T> {
    return armazenamentoDoMedidor.run(this, fazer);
  }

  registrar(leitura: LeituraDeUso): void {
    this.dados.respostas += 1;
    if (leitura.app !== null || leitura.buc !== null || leitura.adAccount !== null) this.dados.respostasComCabecalhoDeUso += 1;
    if (leitura.app) this.dados.xAppUsage = mesclarMaior(this.dados.xAppUsage, leitura.app);
    if (leitura.buc) {
      const anterior = this.dados.xBusinessUseCaseUsage;
      const espera = Math.max(anterior?.estimated_time_to_regain_access ?? 0, leitura.buc.estimated_time_to_regain_access ?? 0);
      this.dados.xBusinessUseCaseUsage = {
        ...mesclarMaior(anterior, leitura.buc),
        ...(espera > 0 ? { estimated_time_to_regain_access: espera } : {}),
        tipos: Array.from(new Set([...(anterior?.tipos ?? []), ...leitura.tiposBuc])),
      };
    }
    if (leitura.adAccount) {
      this.dados.xAdAccountUsage = { acc_id_util_pct: Math.max(this.dados.xAdAccountUsage?.acc_id_util_pct ?? 0, leitura.adAccount.acc_id_util_pct) };
    }
    const maior = maiorUsoDaLeitura(leitura);
    if (maior && (!this.dados.maior || maior.percentual > this.dados.maior.percentual)) this.dados.maior = maior;
  }

  /** `herdada`: a pausa já estava de pé quando a rotina chegou (outra rotina a pôs); falso quando foi esta rotina que a pôs. */
  notarPausa(causa: CausaDaPausa | undefined, herdada: boolean): void {
    if (!causa) return;
    // A primeira pausa que a rotina viu é a que vale: a mesma pausa vista de novo a cada chamada recusada não a troca.
    if (!this.dados.pausa) this.dados.pausa = { ...causa, herdada };
  }

  resumo(): ResumoDeUsoDaMeta {
    return structuredClone(this.dados);
  }
}

/** Uma frase curta para o cartão da rotina: "total_time em 83% (x-app-usage), limite de 60%". */
export function descreverCausaDaPausa(causa: CausaDaPausa): string {
  if (causa.origem === "erro") return `a Meta devolveu o código ${causa.codigoDeErro ?? "?"}`;
  return `${causa.medida} em ${causa.percentual}% (${causa.fonte}), limite de ${causa.limite}%`;
}

/**
 * Roda uma rotina com o medidor ligado e devolve o resultado dela com o uso do aplicativo: `usoDaMeta` (o maior valor visto de cada medida, `ResumoDeUsoDaMeta`) e, quando a rotina viu a
 * Meta em pausa, `medidaQuePausou` (a frase de `descreverCausaDaPausa`). É o que as rotinas da Meta (`meta-contas`, `meta-hashtags`, `contas-base`) devolvem como resumo da noite.
 */
export async function comMedicaoDeUso<T extends Record<string, unknown>>(
  fazer: () => Promise<T>,
): Promise<T & { usoDaMeta: ResumoDeUsoDaMeta; medidaQuePausou?: string }> {
  const medidor = new MedidorDeUsoDaMeta();
  const resultado = await medidor.executar(fazer);
  const usoDaMeta = medidor.resumo();
  return { ...resultado, usoDaMeta, ...(usoDaMeta.pausa ? { medidaQuePausou: descreverCausaDaPausa(usoDaMeta.pausa) } : {}) };
}

/** A Meta está em pausa por limite até `retomaEm`. */
export class PausaDaMeta extends ErroMetaApi {
  constructor(
    public readonly retomaEm: Date,
    public readonly motivo: string = MOTIVO_DA_PAUSA,
    public readonly causa?: CausaDaPausa,
  ) {
    // Código 4 (limite do aplicativo): quem ainda trata `ErroMetaApi` de limite (a curva do cliente) continua tratando esta pausa como limite.
    super(`${motivo} (pausa até ${retomaEm.toISOString()})`, 4);
  }
}

async function lerConfiguracao(chave: string): Promise<string | null> {
  const [linha] = await db().select({ valor: configuracaoAdmin.valor }).from(configuracaoAdmin).where(eq(configuracaoAdmin.chave, chave));
  return linha?.valor ?? null;
}

function dataValida(valor: string | null): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function causaValida(valor: string | null): CausaDaPausa | undefined {
  if (!valor) return undefined;
  try {
    const dado = JSON.parse(valor) as CausaDaPausa | null;
    return dado && (dado.origem === "uso" || dado.origem === "erro") ? dado : undefined;
  } catch {
    return undefined;
  }
}

/** Até quando vale a pausa geral (a de 80%, que vale para todo mundo). Nulo se nunca houve. */
export async function pausaDaMetaAte(): Promise<Date | null> {
  return dataValida(await lerConfiguracao(CHAVES_DA_PAUSA.geral.ate));
}

/**
 * Põe a Meta em pausa até `ate` (nunca encurta uma pausa que já vale por mais tempo). Devolve até quando ela vale. `classe` diz de qual pausa se trata (a geral, de 80%, ou a das contas, de 60%);
 * a causa guardada só troca quando a pausa é de fato estendida.
 */
export async function pausarMeta(ate: Date, causa?: CausaDaPausa, classe: ClasseDeChamada = "geral"): Promise<Date> {
  const chaves = CHAVES_DA_PAUSA[classe];
  const atual = dataValida(await lerConfiguracao(chaves.ate));
  const estende = !atual || ate > atual;
  const valor = estende ? ate : atual;
  await db()
    .insert(configuracaoAdmin)
    .values({ chave: chaves.ate, valor: valor.toISOString() })
    .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: valor.toISOString(), atualizadoEm: new Date() } });
  if (estende && causa) {
    await db()
      .insert(configuracaoAdmin)
      .values({ chave: chaves.causa, valor: JSON.stringify(causa) })
      .onConflictDoUpdate({ target: configuracaoAdmin.chave, set: { valor: JSON.stringify(causa), atualizadoEm: new Date() } });
  }
  return valor;
}

/** A pausa que vale agora para essa classe de chamada, com a causa guardada, ou nulo. `contas` obedece à pausa de 60% e à de 80%, a que for mais longe. */
export async function pausaVigenteComCausa(agora: Date = new Date(), classe: ClasseDeChamada = "geral"): Promise<{ ate: Date; causa?: CausaDaPausa } | null> {
  const classes: ClasseDeChamada[] = classe === "contas" ? ["geral", "contas"] : ["geral"];
  let melhor: { ate: Date; causa?: CausaDaPausa } | null = null;
  for (const c of classes) {
    const ate = dataValida(await lerConfiguracao(CHAVES_DA_PAUSA[c].ate));
    if (ate && ate > agora && (!melhor || ate > melhor.ate)) melhor = { ate, causa: causaValida(await lerConfiguracao(CHAVES_DA_PAUSA[c].causa)) };
  }
  return melhor;
}

/** A pausa que vale agora, ou nulo: as rotinas conferem antes de cada chamada. */
export async function pausaVigenteDaMeta(agora: Date = new Date(), classe: ClasseDeChamada = "geral"): Promise<Date | null> {
  return (await pausaVigenteComCausa(agora, classe))?.ate ?? null;
}

/**
 * Quanto esperar entre duas chamadas da Meta: espalha os pedidos ao longo da janela em vez de despejar as 200 da hora em poucos minutos. Padrão 2 s (`META_INTERVALO_MS`
 * muda; o teste põe 0). Estado do processo: dois jobs ao mesmo tempo no worker dividem o mesmo ritmo.
 */
let ultimaChamadaEm = 0;
export function intervaloEntreChamadasMs(): number {
  const cru = process.env.META_INTERVALO_MS;
  const dado = Number(cru);
  return cru !== undefined && cru !== "" && Number.isFinite(dado) ? dado : 2000;
}

async function esperarRitmo(): Promise<void> {
  const intervalo = intervaloEntreChamadasMs();
  if (intervalo <= 0) return;
  const agora = Date.now();
  const minha = Math.max(agora, ultimaChamadaEm + intervalo);
  // Reserva a vez antes de dormir: dois pedidos ao mesmo tempo não acordam juntos.
  ultimaChamadaEm = minha;
  if (minha > agora) await new Promise((resolve) => setTimeout(resolve, minha - agora));
}

/**
 * Quantas chamadas ja aconteceram desde `desde` (inclusive). Exportada para
 * o admin mostrar "chamadas usadas na hora" (PROXIMO.md, item 5). `count()`
 * no banco em vez de trazer as linhas para contar em memoria (achado da
 * leitura previa do Fable, correcao 5: `chamadas_meta_api` cresce sem
 * parar, e `length` sobre todas as linhas piora a cada chamada).
 */
export async function chamadasDesde(desde: Date): Promise<number> {
  const [linha] = await db()
    .select({ total: count() })
    .from(chamadasMetaApi)
    .where(gte(chamadasMetaApi.criadoEm, desde));
  return linha?.total ?? 0;
}

async function chamadaMaisAntigaDesde(desde: Date): Promise<Date | null> {
  const [linha] = await db()
    .select({ criadoEm: chamadasMetaApi.criadoEm })
    .from(chamadasMetaApi)
    .where(gte(chamadasMetaApi.criadoEm, desde))
    .orderBy(asc(chamadasMetaApi.criadoEm))
    .limit(1);
  return linha?.criadoEm ?? null;
}

/**
 * Apaga o que ja saiu da janela antes de inserir a nova (correcao 5): sem
 * isso a tabela cresce sem parar (nunca ha uma limpeza). Nao muda a conta
 * de `chamadasDesde` (que ja filtra por `criadoEm`), so evita acumular lixo.
 */
async function registrarChamada(): Promise<void> {
  await db().delete(chamadasMetaApi).where(lt(chamadasMetaApi.criadoEm, new Date(Date.now() - JANELA_MS)));
  await db().insert(chamadasMetaApi).values({});
}

/**
 * Quanto falta, em ms, para a chamada mais antiga da janela sair dela (0 se
 * já saiu). Funcao pura, testada direto, sem banco nem tempo real: o
 * limitador (`aguardarJanela`) so soma a folga de 1s para nunca calcular
 * em cima da hora exata.
 */
export function calcularEsperaMs(maisAntigaNaJanela: Date, agora: Date, janelaMs = JANELA_MS): number {
  const restante = maisAntigaNaJanela.getTime() + janelaMs - agora.getTime();
  return Math.max(restante, 0);
}

/**
 * Nunca deixa a proxima chamada estourar 200 por hora: espera ate a mais
 * antiga da janela sair dela, e reconfere (outra chamada pode ter
 * acontecido enquanto esperava, num worker com mais de um job rodando).
 * `agora`/`esperar` injetaveis (E6 parte 3, item 1, criterio de teste):
 * testar "espera e retoma" sem esperar de verdade uma hora, avancando um
 * relogio falso a cada `esperar` chamado, em vez de mockar temporizador
 * global (o pool do pg depende de temporizador de verdade).
 */
export async function aguardarJanela(opts?: {
  limite?: number;
  janelaMs?: number;
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
}): Promise<void> {
  const limite = opts?.limite ?? LIMITE_CHAMADAS_HORA;
  const janelaMs = opts?.janelaMs ?? JANELA_MS;
  const agora = opts?.agora ?? (() => new Date());
  const esperar = opts?.esperar ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (;;) {
    const cutoff = new Date(agora().getTime() - janelaMs);
    const total = await chamadasDesde(cutoff);
    if (total < limite) return;

    const maisAntiga = await chamadaMaisAntigaDesde(cutoff);
    if (!maisAntiga) return;

    const esperaMs = calcularEsperaMs(maisAntiga, agora(), janelaMs) + 1000;
    await esperar(esperaMs);
  }
}

/**
 * `tokenDaConta` (E19 PR 1): o token de uma conta ligada pela propria pessoa (`servicos/conta-conectada.ts`). Sem ele, a chamada e a de sempre, pelo token do usuario do sistema (V8).
 * Com ele, a chamada e feita COM O ACESSO DA PESSOA e so enxerga o que ela liberou; a pausa da Meta (limite do aplicativo) e o ritmo entre chamadas valem do mesmo jeito, mas a janela
 * de 200 por hora e o registro dela NAO: aquele limite e da conta chamadora do sistema (Business Discovery, item i do plano), e a conta da pessoa tem o limite dela. O endereco leva o
 * token (e a `appsecret_proof`, quando o segredo do aplicativo existe): nunca vai para log, nem aqui nem em erro.
 */
async function chamar<T>(caminho: string, parametros: Record<string, string>, tokenDaConta?: TokenOuAcesso, classe: ClasseDeChamada = "geral"): Promise<T> {
  const medidor = armazenamentoDoMedidor.getStore();
  const pausa = await pausaVigenteComCausa(new Date(), classe);
  if (pausa) {
    medidor?.notarPausa(pausa.causa, true);
    throw new PausaDaMeta(pausa.ate, MOTIVO_DA_PAUSA, pausa.causa);
  }
  if (tokenDaConta === undefined) await aguardarJanela();
  await esperarRitmo();

  const acesso = tokenDaConta === undefined ? undefined : acessoDe(tokenDaConta);
  const url = new URL(`${acesso?.via === "instagram" ? enderecoDoGraphDaVia("instagram") : BASE}/${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) {
    url.searchParams.set(chave, valor);
  }
  url.searchParams.set("access_token", acesso?.token ?? config.coleta.metaToken);
  // A prova do segredo é da via do Facebook (`graph-requisicoes-seguras.md`); a via do Instagram não a prevê.
  if (acesso?.via === "facebook" && config.metaConexao.appSecret) {
    url.searchParams.set("appsecret_proof", provaDoSegredo(acesso.token));
  }

  /**
   * Antes do `fetch`, nao depois (correcao 5): uma chamada que falha na
   * rede tambem conta para o limite de 200/hora da Meta (a Meta ja recebeu
   * a requisicao antes de ela falhar do lado de ca).
   */
  if (tokenDaConta === undefined) await registrarChamada();
  const resposta = await fetch(url);

  /**
   * O quanto do limite do aplicativo já foi usado (e o maior valor de cada medida vai para o medidor da rotina). Passou de 80%: a pausa geral começa agora (esta resposta ainda vale; a próxima
   * chamada é que não sai). Passou de 60%: começa a pausa das contas, que deixa a fatia das hashtags livre (`RESERVA_DAS_HASHTAGS_PERCENTUAL`). Só o número e o nome da medida vão para o resumo
   * e para a causa da pausa; nada do endereço (que leva o token).
   */
  const leitura = lerCabecalhosDeUso(resposta.headers);
  medidor?.registrar(leitura);
  const maior = maiorUsoDaLeitura(leitura);
  if (maior) {
    const ate = new Date(Date.now() + Math.max(PAUSA_DA_META_MS, (leitura.esperaMin ?? 0) * 60_000));
    if (maior.percentual >= LIMITE_DE_USO_PERCENTUAL) {
      const causa: CausaDaPausa = { origem: "uso", classe: "geral", ...maior, limite: LIMITE_DE_USO_PERCENTUAL };
      await pausarMeta(ate, causa);
      medidor?.notarPausa(causa, false);
    } else if (maior.percentual >= LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL) {
      const causa: CausaDaPausa = { origem: "uso", classe: "contas", ...maior, limite: LIMITE_DE_USO_DAS_CONTAS_PERCENTUAL };
      await pausarMeta(ate, causa, "contas");
      medidor?.notarPausa(causa, false);
    }
  }

  let corpo: { error?: ErroMeta } & Record<string, unknown>;
  try {
    corpo = (await resposta.json()) as { error?: ErroMeta } & Record<string, unknown>;
  } catch {
    /**
     * Um 5xx com corpo HTML (nao JSON) faria `resposta.json()` lancar um
     * erro generico sem codigo (correcao 6); embrulhar em `ErroMetaApi` com
     * o status HTTP deixa o item 1 classificar do mesmo jeito (nenhum dos
     * codigos conhecidos bate com um status HTTP, entao cai no caminho
     * "registra e segue sem marcar").
     */
    throw new ErroMetaApi(`Meta API respondeu ${resposta.status} sem corpo em JSON`, resposta.status);
  }
  if (!resposta.ok || corpo.error) {
    const erro = corpo.error ?? {};
    // O 4 (e os outros de limite de taxa, menos o token vencido) é o aplicativo no limite: pausa a hora seguinte e sai como pausa, não como erro.
    if (erro.code !== undefined && erro.code !== 190 && CODIGOS_TOKEN_OU_LIMITE.includes(erro.code)) {
      const causa: CausaDaPausa = { origem: "erro", classe: "geral", codigoDeErro: erro.code };
      const ate = await pausarMeta(new Date(Date.now() + PAUSA_DA_META_MS), causa);
      medidor?.notarPausa(causa, false);
      throw new PausaDaMeta(ate, `${MOTIVO_DA_PAUSA} (a Meta devolveu o código ${erro.code})`, causa);
    }
    throw new ErroMetaApi(erro.message ?? `Meta API respondeu ${resposta.status}`, erro.code, erro.error_subcode);
  }
  return corpo as T;
}

export type MetaPaginacao = { cursors?: { after?: string; before?: string }; next?: string };

/**
 * Segue `paging.cursors.after` ate `maxPaginas` (PROXIMO.md, item 1:
 * "paginacao por after"). `maxPaginas` existe para nunca entrar num laco
 * sem fim contra uma resposta inesperada da API.
 */
export async function buscarTodasAsPaginas<T>(
  caminho: string,
  parametros: Record<string, string>,
  maxPaginas = 10,
  tokenDaConta?: TokenOuAcesso,
): Promise<T[]> {
  let resultado: T[] = [];
  let after: string | undefined;

  for (let i = 0; i < maxPaginas; i += 1) {
    const params = after ? { ...parametros, after } : parametros;
    const resposta = await chamar<{ data?: T[]; paging?: MetaPaginacao }>(caminho, params, tokenDaConta);
    resultado = resultado.concat(resposta.data ?? []);
    after = resposta.paging?.cursors?.after;
    if (!after) break;
  }
  return resultado;
}

/** So os campos que a normalizacao usa (`estrategia/plano-de-execucao.md`, item i). */
export type BusinessDiscoveryMedia = {
  id: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  view_count?: number;
  like_count?: number;
  comments_count?: number;
};

export type BusinessDiscovery = {
  username: string;
  followers_count?: number;
  media?: { data: BusinessDiscoveryMedia[]; paging?: MetaPaginacao };
};

/**
 * Quantas mídias a Business Discovery pede por conta (23/10/2026, passo 5 do `pesquisa/estudo-instagram-sem-apify.md`): eram 50. Cada pedido traz as mídias com 11 campos, entre eles
 * `media_url` (endereço assinado de 700 caracteres ou mais) e `thumbnail_url`, então o peso do pedido (tempo total e CPU, que também limitam o aplicativo, `limites-graph-rate-limiting.md`)
 * cresce com as mídias. 25 cobrem o que uma conta vigiada costuma postar entre duas leituras (a rotina lê cada conta pelo menos uma vez por dia). A conta que passar disso perde os mais
 * antigos da janela (já guardados nas leituras anteriores). Quem precisa de outro número (a confirmação de candidata em `pesquisa-de-setor.ts`) passa o dele.
 */
export const MIDIAS_POR_CONTA = 25;

/**
 * Perfil e posts recentes de uma conta comercial ou de criador, pelo ponto
 * de vista da conta chamadora (`config.coleta.metaIgId`). `null` quando a
 * conta e pessoal ou tem restricao de idade: a Meta devolve erro nesses
 * casos (nao confirmado ainda com uma chamada real; ver `ErroMetaApi`
 * capturado por quem chama, `contas-base.ts`/`vigilancia.ts`, que marca
 * `contas.api_indisponivel_em` e deixa para o Apify).
 */
export async function buscarBusinessDiscovery(handle: string, limite = MIDIAS_POR_CONTA): Promise<BusinessDiscovery | null> {
  /**
   * Só os campos que o produto lê (conferido em 23/10/2026 em `normalizadores/meta.ts`, `coleta-comum.ts` e `analisar-visual.ts`): `username` e `followers_count` da conta; `id`, `permalink`,
   * `caption`, `timestamp`, `view_count`, `like_count` e `comments_count` do vídeo; `media_type` e `media_product_type` para saber se é vídeo (`ehVideo`); `media_url` (guardado em
   * `videos.midia_url` para a análise visual) e `thumbnail_url` (a capa). `media_count` saiu: ninguém o lia.
   */
  const campos =
    `username,followers_count,media.limit(${limite})` +
    `{id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,view_count,like_count,comments_count}`;
  const resposta = await chamar<{ business_discovery?: BusinessDiscovery }>(
    config.coleta.metaIgId,
    { fields: `business_discovery.username(${handle}){${campos}}` },
    undefined,
    "contas",
  );
  return resposta.business_discovery ?? null;
}

/**
 * `null` quando a hashtag nao existe na Meta: tanto por resposta vazia
 * (nunca visto ainda) quanto pelo `code 24`/`error_subcode 2207024` que a
 * prova do PR #38 achou (`erroMetaEhHashtagInexistente`). Qualquer outro
 * erro continua subindo para `meta-hashtags.ts` tratar como falha.
 */
export async function buscarIdDaHashtag(termo: string): Promise<string | null> {
  try {
    const resposta = await chamar<{ data?: { id: string }[] }>("ig_hashtag_search", {
      user_id: config.coleta.metaIgId,
      q: termo,
    });
    return resposta.data?.[0]?.id ?? null;
  } catch (erro) {
    if (erro instanceof ErroMetaApi && erroMetaEhHashtagInexistente(erro)) return null;
    throw erro;
  }
}

/** So os campos que a normalizacao usa; nunca traz a conta dona nem views (item i do plano). */
export type HashtagTopMediaItem = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

/**
 * `top_media` (deixou de ser usada pelo job `meta-hashtags`, ajuste 2 da
 * revisao do PR #35: chamada real do Fable contra a hashtag "limpeza"
 * devolveu 50 itens, nenhum VIDEO, so IMAGE (48) e CAROUSEL_ALBUM (2)).
 * Fica exportada, sem uso no motor por enquanto.
 */
export async function buscarTopMediaDaHashtag(hashtagId: string, limite = 50): Promise<HashtagTopMediaItem[]> {
  const resposta = await chamar<{ data?: HashtagTopMediaItem[] }>(`${hashtagId}/top_media`, {
    user_id: config.coleta.metaIgId,
    fields: "caption,media_type,media_url,permalink,timestamp,like_count,comments_count",
    limit: String(limite),
  });
  return resposta.data ?? [];
}

/**
 * Uma Pagina que o usuario do sistema do token enxerga, com a conta do
 * Instagram ligada a ela (V8, item 1). So tem `instagramBusinessAccountId`
 * quando a Pagina tem uma conta profissional ou de criador ligada.
 */
export type PaginaComInstagram = { pageId: string; pageName?: string; instagramBusinessAccountId: string; username: string };

type ContaDoPortfolio = {
  id: string;
  name?: string;
  instagram_business_account?: { id: string; username?: string };
};

/**
 * As Paginas do Portfolio empresarial que o token enxerga, com a conta do
 * Instagram de cada uma (V8, item 1; confirmado rodando de verdade em
 * 08/09/2026, `acessos/meta-app.md`: `me/accounts?fields=name,
 * instagram_business_account` devolveu 20 Paginas do Gustavo, cada uma com o
 * id do Instagram ligado). So as que tem Instagram ligado entram no
 * resultado; sem `username` (raro, a API sempre trouxe nas provas), a Pagina
 * tambem sai, porque `resolverMetaIgId` casa pelo `username`.
 */
export async function buscarPaginasComInstagram(): Promise<PaginaComInstagram[]> {
  const paginas = await buscarTodasAsPaginas<ContaDoPortfolio>("me/accounts", {
    fields: "name,instagram_business_account{id,username}",
  });
  return paginas
    .filter((pagina): pagina is ContaDoPortfolio & { instagram_business_account: { id: string; username: string } } =>
      Boolean(pagina.instagram_business_account?.id && pagina.instagram_business_account.username),
    )
    .map((pagina) => ({
      pageId: pagina.id,
      pageName: pagina.name,
      instagramBusinessAccountId: pagina.instagram_business_account.id,
      username: pagina.instagram_business_account.username,
    }));
}

/**
 * So os campos que `curva-cliente.ts` usa (V8, item 2). `total_views_count` e
 * o campo confirmado para midia de video (Reels inclusive) da PROPRIA conta
 * ligada por login do Facebook, verificado em 21/09/2026 contra
 * https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/:
 * "Total view count of video content across all surfaces", que so funciona
 * fora da Business Discovery (o `view_count` de `BusinessDiscoveryMedia`,
 * acima, e o equivalente so para Reels de conta de TERCEIRO). Ausente em
 * midia que nao e video (post so de foto, carrossel).
 */
export type MetaMediaItem = {
  id: string;
  permalink?: string;
  media_type?: string;
  media_product_type?: string;
  like_count?: number;
  comments_count?: number;
  total_views_count?: number;
};

const CAMPOS_MEDIA_DA_CONTA = "permalink,media_type,media_product_type,like_count,comments_count,total_views_count";
/**
 * E19b, via do Instagram: `total_views_count` é "Disponível apenas para a API do Instagram com o Login do Facebook" (`ig-media-referencia.md`), então a lista não o pede; `like_count` e
 * `comments_count` valem nas duas vias. As visualizações vêm de `buscarViewsDaMidia` (métrica `views` do `insights`, permissão `instagram_business_manage_insights`).
 */
const CAMPOS_MEDIA_DA_CONTA_INSTAGRAM = "permalink,media_type,media_product_type,like_count,comments_count";

function camposDaMidia(acesso?: TokenOuAcesso): string {
  return acesso !== undefined && acessoDe(acesso).via === "instagram" ? CAMPOS_MEDIA_DA_CONTA_INSTAGRAM : CAMPOS_MEDIA_DA_CONTA;
}

/**
 * A midia da propria conta do cliente, mais recente primeiro (V8, item 2):
 * `curva-cliente.ts` casa o codigo curto do `permalink` de cada item com o
 * `idExterno` (o codigo que a propria pagina extraiu da url que o cliente
 * colou em "Postei") para achar o video certo, na primeira medicao. 10
 * paginas (250 midias) cobrem de sobra um cliente que posta com frequencia
 * normal e cujo video tem no maximo 30 dias (`LIMITE_DIAS` de `curva.ts`).
 */
export async function buscarMediaDaConta(igId: string, maxPaginas = 10, tokenDaConta?: TokenOuAcesso): Promise<MetaMediaItem[]> {
  return buscarTodasAsPaginas<MetaMediaItem>(`${igId}/media`, { fields: camposDaMidia(tokenDaConta) }, maxPaginas, tokenDaConta);
}

/**
 * Uma midia especifica pelo id que `buscarMediaDaConta` ja achou e guardou
 * (V8, item 2, "nas seguintes leia a midia direto pelo id, uma chamada so"):
 * evita listar a conta inteira de novo a cada medicao.
 */
export async function buscarMediaPorId(mediaId: string, tokenDaConta?: TokenOuAcesso): Promise<MetaMediaItem> {
  return chamar<MetaMediaItem>(mediaId, { fields: camposDaMidia(tokenDaConta) }, tokenDaConta);
}

/**
 * E19b: as visualizações de uma mídia da conta ligada pelo Instagram: `GET /<mídia>/insights?metric=views` (`ig-media-insights.md`: `views` vale para FEED, REELS e STORY; só orgânico).
 * A resposta traz o valor em `values[0].value` ou em `total_value.value`. Sem dado (a Meta devolve um conjunto vazio quando ainda não há, e leva até 48 horas), devolve 0. Erro da Meta sobe como
 * `ErroMetaApi`, para quem chama decidir se é da conta (permissão) ou passageiro.
 */
export async function buscarViewsDaMidia(mediaId: string, acesso: TokenOuAcesso): Promise<number> {
  const resposta = await chamar<{ data?: { values?: { value?: unknown }[]; total_value?: { value?: unknown } }[] }>(`${mediaId}/insights`, { metric: "views" }, acesso);
  const linha = resposta.data?.[0];
  const valor = linha?.total_value?.value ?? linha?.values?.[0]?.value;
  return typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? valor : 0;
}

/** Mesmos campos do `top_media`, mais `media_product_type` (distingue REELS de VIDEO puro, como a Business Discovery). */
export type HashtagRecentMediaItem = HashtagTopMediaItem & { media_product_type?: string };

/**
 * `<hashtagId>/recent_media` (ajuste 2 da revisao do PR #35): a mesma
 * chamada real, contra `recent_media`, devolveu 38 VIDEO (todos com
 * `media_product_type = REELS`) em 50 itens, `media_url` presente em 21
 * deles. Substitui `buscarTopMediaDaHashtag` no job `meta-hashtags`.
 *
 * Limite padrao 25, nao 50 (achado da fumaca do ajuste 5, 09/09/2026): a
 * mesma chamada com `limit=50` devolveu "Please reduce the amount of data
 * you're asking for, then retry your request"; o `media_url` de um reel e
 * uma url longa (700+ caracteres, assinada), e 50 delas de uma vez excede
 * algum limite de tamanho de resposta que o `top_media` (sem essa mesma
 * combinacao de campos, na chamada de prova do Fable) nao bateu. `limit=25`
 * confirmado funcionando contra a hashtag "limpeza" de verdade.
 */
export async function buscarRecentMediaDaHashtag(hashtagId: string, limite = 25): Promise<HashtagRecentMediaItem[]> {
  const resposta = await chamar<{ data?: HashtagRecentMediaItem[] }>(`${hashtagId}/recent_media`, {
    user_id: config.coleta.metaIgId,
    fields: "caption,media_type,media_product_type,media_url,permalink,timestamp,like_count,comments_count",
    limit: String(limite),
  });
  return resposta.data ?? [];
}

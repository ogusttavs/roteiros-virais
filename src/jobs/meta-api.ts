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
import { asc, count, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { chamadasMetaApi } from "@/db/schema";
import { config } from "@/lib/config";

const BASE = "https://graph.facebook.com/v26.0";

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
 * criador, confirmado no item 6 desta rodada com uma conta pessoal de
 * verdade) e erro da CONTA chamada: so essa conta deve virar
 * `api_indisponivel_em`. Achado da leitura previa do Fable, 09/09/2026,
 * correcao 1 do `PROXIMO.md`: antes, qualquer `ErroMetaApi` marcava a conta,
 * e um token vencido ou um limite de taxa (que afetam TODAS as contas, nao
 * uma so) marcava as 50 contas vigiadas de uma vez e jogava todas de volta
 * para o Apify pago, sem nunca mais tentar a API.
 */
export const CODIGOS_ERRO_DE_CONTA = [100];

/** Token vencido (190) ou limite de taxa (4, 17, 32, 613): afeta a chamada inteira, nao uma conta. */
export const CODIGOS_TOKEN_OU_LIMITE = [190, 4, 17, 32, 613];

export function erroMetaEhDaConta(erro: ErroMetaApi): boolean {
  return erro.codigo !== undefined && CODIGOS_ERRO_DE_CONTA.includes(erro.codigo);
}

export function erroMetaEhTokenOuLimite(erro: ErroMetaApi): boolean {
  return erro.codigo !== undefined && CODIGOS_TOKEN_OU_LIMITE.includes(erro.codigo);
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

async function chamar<T>(caminho: string, parametros: Record<string, string>): Promise<T> {
  await aguardarJanela();

  const url = new URL(`${BASE}/${caminho}`);
  for (const [chave, valor] of Object.entries(parametros)) {
    url.searchParams.set(chave, valor);
  }
  url.searchParams.set("access_token", config.coleta.metaToken);

  /**
   * Antes do `fetch`, nao depois (correcao 5): uma chamada que falha na
   * rede tambem conta para o limite de 200/hora da Meta (a Meta ja recebeu
   * a requisicao antes de ela falhar do lado de ca).
   */
  await registrarChamada();
  const resposta = await fetch(url);

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
): Promise<T[]> {
  let resultado: T[] = [];
  let after: string | undefined;

  for (let i = 0; i < maxPaginas; i += 1) {
    const params = after ? { ...parametros, after } : parametros;
    const resposta = await chamar<{ data?: T[]; paging?: MetaPaginacao }>(caminho, params);
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
  media_count?: number;
  media?: { data: BusinessDiscoveryMedia[]; paging?: MetaPaginacao };
};

/**
 * Perfil e posts recentes de uma conta comercial ou de criador, pelo ponto
 * de vista da conta chamadora (`config.coleta.metaIgId`). `null` quando a
 * conta e pessoal ou tem restricao de idade: a Meta devolve erro nesses
 * casos (nao confirmado ainda com uma chamada real; ver `ErroMetaApi`
 * capturado por quem chama, `contas-base.ts`/`vigilancia.ts`, que marca
 * `contas.api_indisponivel_em` e deixa para o Apify).
 */
export async function buscarBusinessDiscovery(handle: string, limite = 50): Promise<BusinessDiscovery | null> {
  const campos =
    `username,followers_count,media_count,media.limit(${limite})` +
    `{id,media_type,media_product_type,media_url,thumbnail_url,permalink,caption,timestamp,view_count,like_count,comments_count}`;
  const resposta = await chamar<{ business_discovery?: BusinessDiscovery }>(config.coleta.metaIgId, {
    fields: `business_discovery.username(${handle}){${campos}}`,
  });
  return resposta.business_discovery ?? null;
}

/** `null` quando a hashtag nao existe na Meta (achado possivel, nunca testado ainda). */
export async function buscarIdDaHashtag(termo: string): Promise<string | null> {
  const resposta = await chamar<{ data?: { id: string }[] }>("ig_hashtag_search", {
    user_id: config.coleta.metaIgId,
    q: termo,
  });
  return resposta.data?.[0]?.id ?? null;
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

export async function buscarTopMediaDaHashtag(hashtagId: string, limite = 50): Promise<HashtagTopMediaItem[]> {
  const resposta = await chamar<{ data?: HashtagTopMediaItem[] }>(`${hashtagId}/top_media`, {
    user_id: config.coleta.metaIgId,
    fields: "caption,media_type,media_url,permalink,timestamp,like_count,comments_count",
    limit: String(limite),
  });
  return resposta.data ?? [];
}

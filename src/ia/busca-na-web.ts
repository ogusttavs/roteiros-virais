/**
 * E54, a pesquisa na hora: a chamada à ferramenta de busca na web do lado da Anthropic (`web_search_20250305`, a única que roda no
 * modelo barato; contrato conferido em 06/10/2026 em `estrategia/referencia-sdk-anthropic.md`, "Busca na web"). Mora em `src/ia/`
 * como o resto (nada fora daqui importa o SDK) e NÃO passa por `gerarEstruturado`: a resposta traz blocos que a saída estruturada
 * não conhece (`server_tool_use`, `web_search_tool_result`) e o texto vem com `citations` coladas, que são o que sustenta cada dado.
 *
 * Duas partes:
 * - `lerBlocosDaBusca`, pura: das linhas de texto da resposta (cada uma com as citações dos blocos que a formaram), do que a busca
 *   devolveu (url, título, idade da página) e de quantas buscas foram feitas. É testada com respostas gravadas, sem rede.
 * - `buscarNaWeb`: a chamada. Com `AI_PROVIDER=mock` devolve a resposta simulada (`mock-busca.ts`), sem rede e sem custo; com a
 *   chave real, trata `pause_turn` (a busca longa pede para reenviar a mensagem como veio) e soma o uso de todas as voltas.
 *
 * Risco conhecido, a provar com a chave (a prova real fica pendente nesta semana sem gasto): `output_config.format` junto com
 * citações pode voltar 400; por isso a saída aqui é texto livre e a validação é do código.
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

import { config } from "@/lib/config";

import { anthropic, traduzirErro } from "./cliente";
import { ErroIA } from "./erro";
import { buscaSimulada } from "./mock-busca";
import type { UsoTokens } from "./registro";

/** O que uma citação da ferramenta diz: de qual página, com qual título, e o trecho literal (até 150 caracteres). */
export type CitacaoDaBusca = { url: string; titulo: string | null; trecho: string };

/** Uma linha do texto da resposta ("- A inflação foi de 4,5%..."), com as citações dos blocos que a formaram. */
export type LinhaDaBusca = { texto: string; citacoes: CitacaoDaBusca[] };

/** Uma página que a busca devolveu, com a idade que a ferramenta deu (ex.: "April 30, 2025"; pode vir nula). */
export type PaginaDaBusca = { url: string; titulo: string | null; idade: string | null };

export type RespostaDaBusca = {
  linhas: LinhaDaBusca[];
  /** Todo o texto da resposta, para reconhecer o "não encontrei dado confiável". */
  texto: string;
  paginas: PaginaDaBusca[];
  /** Quantas buscas a ferramenta fez de verdade (as que deram erro não contam, não são cobradas). */
  buscas: number;
  /** Códigos de erro que a ferramenta devolveu (`max_uses_exceeded`, `unavailable`...). */
  errosDaFerramenta: string[];
  modelo: string;
  uso: UsoTokens;
};

export type ParametrosDaBusca = {
  sistemaEstavel: string;
  entrada: string;
  /** `max_uses` da ferramenta: o teto de buscas desta pesquisa. */
  maxBuscas: number;
  /** `allowed_domains`: só estes (e os subdomínios deles) chegam ao modelo. */
  dominios: string[];
};

/** Uma resposta do SDK, no que importa aqui (estrutural, para o leitor puro rodar com fixtures sem importar o SDK). */
export type BlocoDeResposta = {
  type: string;
  text?: string;
  name?: string;
  citations?: { type?: string; url?: string; title?: string | null; cited_text?: string }[] | null;
  content?: unknown;
};

const MAXIMO_DE_VOLTAS = 3;
const MAX_TOKENS_DA_BUSCA = 4000;

/** Lê os blocos de uma ou mais voltas da resposta. Pura. */
export function lerBlocosDaBusca(blocos: BlocoDeResposta[]): Omit<RespostaDaBusca, "modelo" | "uso"> {
  const linhas: LinhaDaBusca[] = [{ texto: "", citacoes: [] }];
  const paginas: PaginaDaBusca[] = [];
  const errosDaFerramenta: string[] = [];
  let buscas = 0;
  let texto = "";

  for (const bloco of blocos) {
    if (bloco.type === "server_tool_use" && bloco.name === "web_search") {
      buscas += 1;
    } else if (bloco.type === "web_search_tool_result") {
      const conteudo = bloco.content;
      if (Array.isArray(conteudo)) {
        for (const item of conteudo as { type?: string; url?: string; title?: string | null; page_age?: string | null }[]) {
          if (item?.type === "web_search_result" && typeof item.url === "string") {
            paginas.push({ url: item.url, titulo: typeof item.title === "string" ? item.title : null, idade: typeof item.page_age === "string" ? item.page_age : null });
          }
        }
      } else if (conteudo && typeof conteudo === "object" && (conteudo as { type?: string }).type === "web_search_tool_result_error") {
        const codigo = (conteudo as { error_code?: string }).error_code;
        errosDaFerramenta.push(typeof codigo === "string" ? codigo : "erro_desconhecido");
        // A busca com erro não é cobrada (referência, "Busca na web"): não conta.
        buscas = Math.max(0, buscas - 1);
      }
    } else if (bloco.type === "text") {
      const pedaco = bloco.text ?? "";
      texto += pedaco;
      const citacoes: CitacaoDaBusca[] = (bloco.citations ?? [])
        .filter((c) => c?.type === "web_search_result_location" && typeof c.url === "string" && typeof c.cited_text === "string")
        .map((c) => ({ url: c.url as string, titulo: typeof c.title === "string" ? c.title : null, trecho: (c.cited_text as string).trim() }));
      pedaco.split("\n").forEach((parte, i) => {
        if (i > 0) linhas.push({ texto: "", citacoes: [] });
        const atual = linhas[linhas.length - 1];
        atual.texto += parte;
        // A citação vale para a linha que ela ajudou a formar; um bloco só de espaço não leva citação para a linha seguinte.
        if (parte.trim() !== "") {
          for (const c of citacoes) {
            if (!atual.citacoes.some((x) => x.url === c.url && x.trecho === c.trecho)) atual.citacoes.push(c);
          }
        }
      });
    }
  }

  return { linhas: linhas.filter((l) => l.texto.trim() !== ""), texto: texto.trim(), paginas, buscas, errosDaFerramenta };
}

function somar(a: UsoTokens, b: Partial<UsoTokens>): UsoTokens {
  return {
    tokensEntrada: a.tokensEntrada + (b.tokensEntrada ?? 0),
    tokensSaida: a.tokensSaida + (b.tokensSaida ?? 0),
    tokensCacheLeitura: a.tokensCacheLeitura + (b.tokensCacheLeitura ?? 0),
    tokensCacheEscrita: a.tokensCacheEscrita + (b.tokensCacheEscrita ?? 0),
    buscasNaWeb: (a.buscasNaWeb ?? 0) + (b.buscasNaWeb ?? 0),
  };
}

/**
 * O erro da busca que já gastou: leva o uso das voltas que deram certo (as buscas cobradas e os tokens), para quem chama registrar o
 * custo e contar a pesquisa no teto do dia em vez de perder o gasto (uma busca que cai na segunda volta ainda custou a primeira).
 */
export class ErroDaBusca extends ErroIA {
  readonly usoParcial: UsoTokens;

  constructor(mensagemTecnica: string, usoParcial: UsoTokens, mensagemCliente?: string) {
    super(mensagemTecnica, mensagemCliente);
    this.name = "ErroDaBusca";
    this.usoParcial = usoParcial;
  }
}

const SEM_USO: UsoTokens = { tokensEntrada: 0, tokensSaida: 0, tokensCacheLeitura: 0, tokensCacheEscrita: 0, buscasNaWeb: 0 };
/** Cada tentativa gasta buscas pagas: nada de repetir sozinho (o SDK repetiria duas vezes por padrão) e um prazo por volta. */
const OPCOES_DA_REQUISICAO = { maxRetries: 0, timeout: 120_000 };

/**
 * Faz a pesquisa. `ErroIA` quando a API recusa (busca desligada no Console da organização volta 400, limite, rede); `ErroDaBusca`
 * (um `ErroIA`) quando já houve gasto, com o uso das voltas anteriores. O custo das buscas sai de `usage.server_tool_use.web_search_requests`,
 * que é o que a Anthropic cobra, não da contagem de blocos. O teto de buscas vale para a pesquisa inteira: cada volta pede só as que sobram,
 * e uma resposta que não terminou (pausa sem fim, texto cortado, recusa) é erro, não "sem dado".
 */
export async function buscarNaWeb(params: ParametrosDaBusca): Promise<RespostaDaBusca> {
  if (config.ia.provedor === "mock") return buscaSimulada(params);

  let mensagens: MessageParam[] = [{ role: "user", content: params.entrada.toWellFormed() }];
  const blocos: BlocoDeResposta[] = [];
  let uso: UsoTokens = { ...SEM_USO };
  let modelo: string = config.ia.modeloBarato;
  let ultimoMotivo: string | null = null;

  const falhar = (erro: unknown): never => {
    const base = erro instanceof ErroIA ? erro : traduzirErro(erro, "pesquisaNaHora");
    throw new ErroDaBusca(base.message, uso, base.mensagemCliente);
  };

  for (let volta = 0; volta < MAXIMO_DE_VOLTAS; volta += 1) {
    const restantes = params.maxBuscas - (uso.buscasNaWeb ?? 0);
    if (restantes <= 0) {
      ultimoMotivo = "pause_turn";
      break;
    }
    let resposta;
    try {
      resposta = await anthropic().messages.create(
        {
          model: config.ia.modeloBarato,
          max_tokens: MAX_TOKENS_DA_BUSCA,
          system: [{ type: "text", text: params.sistemaEstavel.toWellFormed(), cache_control: { type: "ephemeral" } }],
          messages: mensagens,
          tools: [
            {
              type: "web_search_20250305",
              name: "web_search",
              max_uses: restantes,
              allowed_domains: params.dominios,
              user_location: { type: "approximate", country: "BR" },
            },
          ],
        },
        OPCOES_DA_REQUISICAO,
      );
    } catch (erro) {
      return falhar(erro);
    }
    modelo = resposta.model;
    // O texto de uma volta nunca continua a linha da anterior: a fronteira entre as voltas é uma quebra de linha.
    if (blocos.length > 0) blocos.push({ type: "text", text: "\n" });
    blocos.push(...(resposta.content as unknown as BlocoDeResposta[]));
    uso = somar(uso, {
      tokensEntrada: resposta.usage.input_tokens,
      tokensSaida: resposta.usage.output_tokens,
      tokensCacheLeitura: resposta.usage.cache_read_input_tokens ?? 0,
      tokensCacheEscrita: resposta.usage.cache_creation_input_tokens ?? 0,
      buscasNaWeb: resposta.usage.server_tool_use?.web_search_requests ?? 0,
    });
    ultimoMotivo = resposta.stop_reason;
    if (resposta.stop_reason !== "pause_turn") break;
    // A busca longa pausa o turno: a mensagem do assistente volta como veio (com o `encrypted_content`) e o modelo continua.
    mensagens = [...mensagens, { role: "assistant", content: resposta.content as unknown as MessageParam["content"] }];
  }

  if (ultimoMotivo === "refusal") return falhar(new ErroIA('recusa do modelo na tarefa "pesquisaNaHora"'));
  if (ultimoMotivo === "pause_turn") return falhar(new ErroIA('a busca nao terminou (pausas demais ou teto de buscas atingido) na tarefa "pesquisaNaHora"'));
  if (ultimoMotivo === "max_tokens") return falhar(new ErroIA('a resposta da busca foi cortada (max_tokens) na tarefa "pesquisaNaHora"'));

  const lido = lerBlocosDaBusca(blocos);
  // O custo é o que a Anthropic contou; se ela não contou (resposta sem `usage.server_tool_use`), a contagem dos blocos é a melhor leitura.
  const buscasCobradas = uso.buscasNaWeb && uso.buscasNaWeb > 0 ? uso.buscasNaWeb : lido.buscas;
  return { ...lido, buscas: buscasCobradas, modelo, uso: { ...uso, buscasNaWeb: buscasCobradas } };
}

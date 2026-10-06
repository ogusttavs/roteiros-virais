/**
 * A busca de rede da coleta dos assuntos (E53), com a mesma guarda do leitor de site da marca: só https na porta 443, sem credencial na URL, sem IP literal, host dentro da lista curada
 * (`hostPermitido`), DNS que só aceita IP público (`criarAgenteSeguro`), redirecionamento seguido à mão (cada salto passa pela mesma checagem, no máximo 3) e teto de bytes lidos. O link
 * de um item de feed vem de fora: sem isto, um item com `https://x/*http://roteiros-postgres:5432/` mandaria o worker conectar na própria rede.
 */
import { isIP } from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

import { criarAgenteSeguro, type BuscarLeitor } from "./site-api";

export class ErroBuscaSegura extends Error {}

const MAXIMO_DE_SALTOS = 3;
let agenteCompartilhado: Agent | null = null;

function agente(): Agent {
  agenteCompartilhado ??= criarAgenteSeguro({ conexaoMs: 5_000, requisicaoMs: 15_000 });
  return agenteCompartilhado;
}

/** Valida um endereço para busca: devolve a URL ou lança `ErroBuscaSegura`. Serve também para conferir um endereço antes de gravar. */
export function validarEnderecoDeBusca(texto: string, hostPermitido: (host: string) => boolean): URL {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new ErroBuscaSegura("endereco invalido");
  }
  if (url.protocol !== "https:") throw new ErroBuscaSegura("so https");
  if (url.port !== "" && url.port !== "443") throw new ErroBuscaSegura("so a porta 443");
  if (url.username !== "" || url.password !== "") throw new ErroBuscaSegura("endereco com credencial");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) throw new ErroBuscaSegura("endereco de IP direto");
  if (!hostPermitido(host)) throw new ErroBuscaSegura("host fora da lista");
  return url;
}

export type OpcoesDaBusca = {
  aceita: string;
  limiteBytes: number;
  tempoMs: number;
  hostPermitido: (host: string) => boolean;
  /** Substitui o transporte (testes). */
  buscar?: BuscarLeitor;
};

export type RespostaLida = { bytes: Uint8Array; truncado: boolean };

/** Baixa o começo de um endereço (até `limiteBytes`), seguindo redirecionamentos só para destinos que passam na mesma guarda. */
export async function lerComGuarda(inicial: string, opcoes: OpcoesDaBusca): Promise<RespostaLida> {
  const sinal = AbortSignal.timeout(opcoes.tempoMs);
  const buscar: BuscarLeitor = opcoes.buscar ?? ((url, init) => undiciFetch(url, { ...init, dispatcher: agente() }) as unknown as ReturnType<BuscarLeitor>);
  let atual = validarEnderecoDeBusca(inicial, opcoes.hostPermitido);
  for (let salto = 0; salto <= MAXIMO_DE_SALTOS; salto += 1) {
    const resposta = await buscar(atual.href, {
      method: "GET",
      headers: { "user-agent": "Mozilla/5.0 (compatible; Klaki/1.0; leitor de feeds)", accept: opcoes.aceita },
      redirect: "manual",
      signal: sinal,
    });
    if (resposta.status >= 300 && resposta.status < 400) {
      const destino = resposta.headers.get("location");
      await resposta.body?.cancel().catch(() => undefined);
      if (!destino) throw new ErroBuscaSegura("redirecionamento sem destino");
      atual = validarEnderecoDeBusca(new URL(destino, atual).href, opcoes.hostPermitido);
      continue;
    }
    if (resposta.status < 200 || resposta.status >= 300) throw new ErroBuscaSegura(`respondeu ${resposta.status}`);
    if (!resposta.body) return { bytes: new Uint8Array(), truncado: false };
    const leitor = resposta.body.getReader();
    const pedacos: Uint8Array[] = [];
    let lidos = 0;
    let truncado = false;
    while (true) {
      const { done, value } = await leitor.read();
      if (done || !value) break;
      pedacos.push(value);
      lidos += value.length;
      if (lidos >= opcoes.limiteBytes) {
        truncado = true;
        break;
      }
    }
    await leitor.cancel().catch(() => undefined);
    const junto = new Uint8Array(Math.min(lidos, opcoes.limiteBytes));
    let posicao = 0;
    for (const p of pedacos) {
      const cabe = Math.min(p.length, junto.length - posicao);
      if (cabe <= 0) break;
      junto.set(p.subarray(0, cabe), posicao);
      posicao += cabe;
    }
    return { bytes: junto, truncado };
  }
  throw new ErroBuscaSegura("redirecionamentos demais");
}

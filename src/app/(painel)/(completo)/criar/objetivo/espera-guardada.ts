/**
 * E74 PR 1: o que a tela do objetivo guarda no `sessionStorage` (por tema) enquanto o servidor escreve as três versões, para
 * sobreviver a sair da tela e voltar: o instante em que a espera começou e, quando a resposta chega (mesmo com a pessoa fora
 * da tela), o desfecho: o grupo pronto ou a frase do erro.
 *
 * E74 PR 2a (R-c): a espera guarda também o id do pedido, gravado ANTES de a rede ser usada. Com o id, a verdade é o servidor
 * (`GET /api/pedidos/estado?id=`) e o `sessionStorage` é só o atalho para achar o pedido; sem ele (a espera guardada por uma aba
 * de antes da subida), vale o caminho do PR 1.
 */

/** Quanto tempo a espera guardada vale. É o mesmo número que a tela promete ("Pode levar até 4 minutos", `textosObjetivo.esperaVersoesDuracao`); passado isso, a escrita já terminou ou falhou e a tela volta ao formulário. */
export const ESPERA_MAXIMA_MIN = 4;
export const ESPERA_MAXIMA_MS = ESPERA_MAXIMA_MIN * 60_000;
/**
 * A espera com o id do pedido vale mais: quem diz se acabou é o servidor (a varredura fecha o pedido parado em 6 minutos sem batimento), e a espera só precisa durar até a tela perguntar a
 * ele. Dez minutos cobrem o pedido mais lento mais a varredura.
 */
export const ESPERA_COM_PEDIDO_MS = 10 * 60_000;

const CHAVE_ESPERA = "objetivo-escrevendo";
const CHAVE_DESFECHO = "objetivo-desfecho";

export type Desfecho = { grupo: string } | { erro: string };
export type EsperaGuardada = { desde: number; pedidoId: string | null };

/** Lê o valor guardado: o formato do PR 2a (`{"desde", "pedidoId"}`) ou o número do PR 1 (só o instante). */
function lerValor(bruto: string | null, agora: number): EsperaGuardada | null {
  if (bruto === null) return null;
  let desde = Number(bruto);
  let pedidoId: string | null = null;
  if (!Number.isFinite(desde)) {
    try {
      const lido = JSON.parse(bruto) as { desde?: unknown; pedidoId?: unknown };
      desde = typeof lido.desde === "number" ? lido.desde : NaN;
      pedidoId = typeof lido.pedidoId === "string" && lido.pedidoId ? lido.pedidoId : null;
    } catch {
      return null;
    }
  }
  if (!Number.isFinite(desde) || desde <= 0) return null;
  const prazo = pedidoId ? ESPERA_COM_PEDIDO_MS : ESPERA_MAXIMA_MS;
  return agora - desde <= prazo ? { desde, pedidoId } : null;
}

export function lerEspera(chaveDoTema: string, agora = Date.now()): EsperaGuardada | null {
  try {
    return lerValor(window.sessionStorage.getItem(`${CHAVE_ESPERA}:${chaveDoTema}`), agora);
  } catch {
    return null;
  }
}

export function guardarEspera(chaveDoTema: string, espera: EsperaGuardada | null) {
  try {
    if (espera === null) window.sessionStorage.removeItem(`${CHAVE_ESPERA}:${chaveDoTema}`);
    else window.sessionStorage.setItem(`${CHAVE_ESPERA}:${chaveDoTema}`, JSON.stringify(espera));
  } catch {
    // sem sessionStorage: a tela segue funcionando, só não lembra da espera
  }
}

/** Grava o desfecho (a espera acabou) para quem voltar à tela do mesmo tema; `null` apaga. */
export function guardarDesfecho(chaveDoTema: string, desfecho: Desfecho | null) {
  try {
    if (desfecho === null) {
      window.sessionStorage.removeItem(`${CHAVE_DESFECHO}:${chaveDoTema}`);
      return;
    }
    window.sessionStorage.setItem(`${CHAVE_DESFECHO}:${chaveDoTema}`, JSON.stringify({ ...desfecho, em: Date.now() }));
    window.sessionStorage.removeItem(`${CHAVE_ESPERA}:${chaveDoTema}`);
  } catch {
    // idem
  }
}

/** Lê o desfecho guardado (e o apaga: vale uma vez); `null` sem desfecho, ilegível ou velho demais. */
export function tomarDesfecho(chaveDoTema: string, agora = Date.now()): Desfecho | null {
  try {
    const chave = `${CHAVE_DESFECHO}:${chaveDoTema}`;
    const bruto = window.sessionStorage.getItem(chave);
    if (bruto === null) return null;
    window.sessionStorage.removeItem(chave);
    const lido = JSON.parse(bruto) as { grupo?: unknown; erro?: unknown; em?: unknown };
    if (typeof lido.em !== "number" || agora - lido.em > ESPERA_MAXIMA_MS) return null;
    if (typeof lido.grupo === "string" && lido.grupo) return { grupo: lido.grupo };
    if (typeof lido.erro === "string" && lido.erro) return { erro: lido.erro };
    return null;
  } catch {
    return null;
  }
}

/** Todas as esperas guardadas e ainda dentro do prazo, com a chave de cada uma. */
function esperasGuardadas(agora: number): { chave: string; espera: EsperaGuardada }[] {
  const achadas: { chave: string; espera: EsperaGuardada }[] = [];
  try {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const chave = window.sessionStorage.key(i);
      if (!chave?.startsWith(`${CHAVE_ESPERA}:`)) continue;
      const espera = lerValor(window.sessionStorage.getItem(chave), agora);
      if (espera) achadas.push({ chave, espera });
    }
  } catch {
    // sem sessionStorage
  }
  return achadas;
}

/**
 * Quanto tempo o pedido tem para aparecer no servidor depois de a espera começar. A ação cria o pedido antes de gastar qualquer coisa, em milissegundos; um id que o servidor não conhece passado
 * isto é um pedido que nunca chegou (a rede caiu antes), e mandar o MESMO id de novo é seguro (o servidor não escreve duas vezes).
 */
export const GRACA_DO_PEDIDO_MS = 20_000;

/** Alguma escrita de versões (de qualquer tema) guardada e dentro do prazo? É o que o Hoje usa para mostrar "escrevendo" antes de a primeira consulta ao servidor voltar. */
export function haEsperaGuardada(agora = Date.now()): boolean {
  return esperasGuardadas(agora).length > 0;
}

/**
 * Depois de o servidor responder: ainda há espera desta aba que ele não resolveu? A do PR 1 (sem id) vale pelo prazo dela; a com id vale enquanto o servidor diz que o pedido anda (`andando`)
 * ou enquanto ele ainda pode estar chegando (`GRACA_DO_PEDIDO_MS`). Um id que o servidor não conhece depois disso nunca chegou, e o "Escrevendo" não fica pendurado nele.
 */
export function haEsperaSemResposta(andando: ReadonlySet<string>, agora = Date.now()): boolean {
  return esperasGuardadas(agora).some(({ espera }) => espera.pedidoId === null || andando.has(espera.pedidoId) || agora - espera.desde < GRACA_DO_PEDIDO_MS);
}

/** Os ids dos pedidos das esperas guardadas nesta aba (o Hoje os segue até ficarem prontos ou falharem). */
export function pedidosDasEsperas(agora = Date.now()): string[] {
  return esperasGuardadas(agora)
    .map((e) => e.espera.pedidoId)
    .filter((id): id is string => id !== null);
}

/** Este pedido terminou (pronto ou falho): a espera dele não vale mais. As de outros pedidos ficam (R-b: nada apaga a espera de um pedido por causa de outro). */
export function limparEsperaDoPedido(pedidoId: string) {
  try {
    for (const { chave, espera } of esperasGuardadas(Date.now())) if (espera.pedidoId === pedidoId) window.sessionStorage.removeItem(chave);
  } catch {
    // idem
  }
}

/** Apaga todas as esperas guardadas (as que não têm pedido e venceram o prazo saem sozinhas). */
export function limparEsperasGuardadas() {
  try {
    const velhas: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const chave = window.sessionStorage.key(i);
      if (chave?.startsWith(`${CHAVE_ESPERA}:`)) velhas.push(chave);
    }
    for (const chave of velhas) window.sessionStorage.removeItem(chave);
  } catch {
    // idem
  }
}

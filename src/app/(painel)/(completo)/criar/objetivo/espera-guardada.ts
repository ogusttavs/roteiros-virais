/**
 * E74 PR 1: o que a tela do objetivo guarda no `sessionStorage` (por tema) enquanto o servidor escreve as três versões, para
 * sobreviver a sair da tela e voltar: o instante em que a espera começou e, quando a resposta chega (mesmo com a pessoa fora
 * da tela), o desfecho: o grupo pronto ou a frase do erro.
 */

/** Quanto tempo a espera guardada vale. É o mesmo número que a tela promete ("Pode levar até 4 minutos", `textosObjetivo.esperaVersoesDuracao`); passado isso, a escrita já terminou ou falhou e a tela volta ao formulário. */
export const ESPERA_MAXIMA_MIN = 4;
export const ESPERA_MAXIMA_MS = ESPERA_MAXIMA_MIN * 60_000;

const CHAVE_ESPERA = "objetivo-escrevendo";
const CHAVE_DESFECHO = "objetivo-desfecho";

export type Desfecho = { grupo: string } | { erro: string };

export function lerEspera(chaveDoTema: string, agora = Date.now()): number | null {
  try {
    const lido = Number(window.sessionStorage.getItem(`${CHAVE_ESPERA}:${chaveDoTema}`));
    return Number.isFinite(lido) && lido > 0 && agora - lido <= ESPERA_MAXIMA_MS ? lido : null;
  } catch {
    return null;
  }
}

export function guardarEspera(chaveDoTema: string, desdeMs: number | null) {
  try {
    if (desdeMs === null) window.sessionStorage.removeItem(`${CHAVE_ESPERA}:${chaveDoTema}`);
    else window.sessionStorage.setItem(`${CHAVE_ESPERA}:${chaveDoTema}`, String(desdeMs));
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

/** Alguma escrita de versões (de qualquer tema) guardada e dentro do prazo? É o que o Hoje usa para mostrar "escrevendo" antes de a primeira versão existir no servidor. */
export function haEsperaGuardada(agora = Date.now()): boolean {
  try {
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const chave = window.sessionStorage.key(i);
      if (!chave?.startsWith(`${CHAVE_ESPERA}:`)) continue;
      const lido = Number(window.sessionStorage.getItem(chave));
      if (Number.isFinite(lido) && lido > 0 && agora - lido <= ESPERA_MAXIMA_MS) return true;
    }
  } catch {
    // sem sessionStorage
  }
  return false;
}

/** As versões ficaram prontas: o que estava guardado como "escrevendo" não vale mais. */
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

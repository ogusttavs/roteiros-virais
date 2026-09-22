import { paginaVeioDoGuardado } from "./offline";

/**
 * O que o aparelho sabe da rede, num lugar só (V7, item 8 do PROXIMO.md), para
 * a faixa "Sem conexão" do painel (`Conexao.tsx`) e para o modo gravação
 * (`useSemRede.ts`), que fica fora do layout do painel, dizerem a mesma coisa.
 *
 * Sem rede = `navigator.onLine` falso OU a página que está na tela foi servida
 * do guardado (`paginaVeioDoGuardado`). O segundo sinal existe porque
 * `navigator.onLine` mente: continua "true" com sinal fraco, com portal de
 * wifi e logo depois de recarregar sem rede. A marca do guardado só some
 * quando a rede volta de verdade: o evento `online` ou uma conferência que
 * deu certo (`avisarRedeVoltou`, chamada por `Conexao`).
 *
 * Só roda no navegador; no servidor todo mundo vê "com rede", igual à
 * primeira renderização da hidratação.
 */
let veioDoGuardado = false;
let iniciado = false;
const ouvintes = new Set<() => void>();

function avisar() {
  ouvintes.forEach((ouvinte) => ouvinte());
}

function iniciar() {
  if (iniciado || typeof window === "undefined") return;
  iniciado = true;
  veioDoGuardado = paginaVeioDoGuardado();
  window.addEventListener("online", aoVoltarOnline);
  window.addEventListener("offline", avisar);
}

/** O navegador avisou que a rede voltou: some a marca do guardado e quem assina relê o estado (sempre, mesmo sem a marca). */
function aoVoltarOnline() {
  veioDoGuardado = false;
  avisar();
}

/** Uma conferência de verdade deu certo (`Conexao`): some a marca do guardado e todo mundo é avisado. */
export function avisarRedeVoltou() {
  if (!veioDoGuardado) return;
  veioDoGuardado = false;
  avisar();
}

/** A página na tela é uma cópia guardada: continua assim até a rede voltar. */
export function paginaEstaNoGuardado(): boolean {
  iniciar();
  return veioDoGuardado;
}

export function assinarEstadoDeRede(aoMudar: () => void): () => void {
  iniciar();
  ouvintes.add(aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
  };
}

/** Sem rede agora, pelos dois sinais. */
export function lerSemRede(): boolean {
  iniciar();
  return !navigator.onLine || veioDoGuardado;
}

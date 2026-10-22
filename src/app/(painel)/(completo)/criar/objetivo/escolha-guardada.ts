/**
 * O que a pessoa já escolheu no passo do objetivo, guardado no `sessionStorage` do navegador POR TEMA (hotfix de 22/10/2026). Quem sai do passo (a pessoa toca em "Ver mais em Referências" e volta) ou
 * o recarrega encontra a ficha, o formato, o estilo, o "para quando é", "quem aparece" e o que o vídeo precisa comunicar como deixou. É só do aparelho e da aba: nada disto vai ao servidor, e uma
 * aba nova começa do zero. Tudo o que se lê passa por conferência (o `sessionStorage` é texto livre): valor que não é de uma lista conhecida é descartado, nunca usado.
 */
import { FICHAS_EM_ORDEM } from "@/config/fichas";
import type { EstiloRoteiro, Ficha, FormatoRoteiro, MomentoDoDia, QuemGrava } from "@/db/schema";
import { ESTILOS_ROTEIRO_EM_ORDEM, FORMATOS_ROTEIRO_EM_ORDEM } from "@/ia/enums";

export type EscolhaGuardada = {
  ficha: Ficha | null;
  /** A lista das cinco já fechou numa só (a pessoa escolheu uma). */
  compacta: boolean;
  formato: FormatoRoteiro;
  estilo: EstiloRoteiro;
  /** A pessoa mexeu no estilo: só então a escolha vale mais que a sugestão do tema. */
  estiloTocado: boolean;
  objetivoDoVideo: string;
  quemAparece: QuemGrava | "";
  data: string;
  momentoDoDia: MomentoDoDia | null;
};

type Armazenamento = Pick<Storage, "getItem" | "setItem">;

const QUEM_GRAVA = ["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"];
const MOMENTOS = ["manha", "meio_dia", "fim_tarde", "noite"];

/** A chave de um tema: a origem e tudo o que identifica ESTE tema (o texto, a notícia, o assunto, a pergunta, a pesquisa). Dois temas nunca dividem a mesma escolha. */
export function chaveDaEscolha(partes: (string | number | null | undefined)[]): string {
  return `objetivo-escolha:${JSON.stringify(partes.map((p) => p ?? null))}`;
}

function armazenamentoDaAba(): Armazenamento | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Navegador com o armazenamento bloqueado: a tela funciona sem guardar nada.
    return null;
  }
}

/** Lê e confere. `hoje` (ISO) é o piso do "para quando é": um dia que já passou não volta. Devolve só o que vale. */
export function lerEscolha(chave: string, hoje: string, armazenamento: Armazenamento | null = armazenamentoDaAba()): Partial<EscolhaGuardada> | null {
  if (!armazenamento) return null;
  let bruto: unknown;
  try {
    const texto = armazenamento.getItem(chave);
    bruto = texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
  if (typeof bruto !== "object" || bruto === null) return null;
  const e = bruto as Record<string, unknown>;
  const escolha: Partial<EscolhaGuardada> = {};
  if (typeof e.ficha === "string" && (FICHAS_EM_ORDEM as string[]).includes(e.ficha)) {
    escolha.ficha = e.ficha as Ficha;
    escolha.compacta = e.compacta === true;
  }
  if (typeof e.formato === "string" && (FORMATOS_ROTEIRO_EM_ORDEM as string[]).includes(e.formato)) escolha.formato = e.formato as FormatoRoteiro;
  if (e.estiloTocado === true && typeof e.estilo === "string" && (ESTILOS_ROTEIRO_EM_ORDEM as string[]).includes(e.estilo)) {
    escolha.estilo = e.estilo as EstiloRoteiro;
    escolha.estiloTocado = true;
  }
  if (typeof e.objetivoDoVideo === "string") escolha.objetivoDoVideo = e.objetivoDoVideo.slice(0, 200);
  if (typeof e.quemAparece === "string" && (e.quemAparece === "" || QUEM_GRAVA.includes(e.quemAparece))) escolha.quemAparece = e.quemAparece as QuemGrava | "";
  if (typeof e.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.data) && e.data >= hoje) escolha.data = e.data;
  if (typeof e.momentoDoDia === "string" && MOMENTOS.includes(e.momentoDoDia)) escolha.momentoDoDia = e.momentoDoDia as MomentoDoDia;
  return Object.keys(escolha).length > 0 ? escolha : null;
}

export function gravarEscolha(chave: string, escolha: EscolhaGuardada, armazenamento: Armazenamento | null = armazenamentoDaAba()): void {
  if (!armazenamento) return;
  try {
    armazenamento.setItem(chave, JSON.stringify(escolha));
  } catch {
    // Sem espaço ou bloqueado: a escolha só não fica guardada.
  }
}

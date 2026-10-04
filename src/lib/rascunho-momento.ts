/**
 * O rascunho do momento (a folha "Gravar agora"): o que a pessoa já escreveu fica no aparelho (sessionStorage, por marca) até ela gerar o roteiro ou limpar. Sem servidor: é só para não perder
 * o que digitou ao sair do Criar sem gerar. Tudo em `try/catch` (o armazenamento pode faltar, estar cheio ou bloqueado) e nunca lança. Funções puras sobre um `Storage`, para testar sem navegador.
 */

export type RascunhoDoMomento = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  objetivoDoVideo: string;
  transcricao: string | null;
};

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Um rascunho por marca: trocar de marca nunca mostra o texto da outra. */
export function chaveDoRascunhoDoMomento(marcaId: number): string {
  return `rascunho-do-momento:${marcaId}`;
}

export function armazenamentoDaSessao(): Armazenamento | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rascunhoEstaVazio(r: Pick<RascunhoDoMomento, "onde" | "oQueEstaAcontecendo" | "oQueDaParaMostrar" | "objetivoDoVideo">): boolean {
  return [r.onde, r.oQueEstaAcontecendo, r.oQueDaParaMostrar, r.objetivoDoVideo].every((texto) => texto.trim() === "");
}

export function lerRascunhoDoMomento(armazenamento: Armazenamento | null, chave: string): RascunhoDoMomento | null {
  if (!armazenamento) return null;
  try {
    const bruto = armazenamento.getItem(chave);
    if (!bruto) return null;
    const dado = JSON.parse(bruto) as Partial<RascunhoDoMomento>;
    if (typeof dado !== "object" || dado === null) return null;
    const r: RascunhoDoMomento = {
      onde: typeof dado.onde === "string" ? dado.onde : "",
      oQueEstaAcontecendo: typeof dado.oQueEstaAcontecendo === "string" ? dado.oQueEstaAcontecendo : "",
      oQueDaParaMostrar: typeof dado.oQueDaParaMostrar === "string" ? dado.oQueDaParaMostrar : "",
      objetivoDoVideo: typeof dado.objetivoDoVideo === "string" ? dado.objetivoDoVideo : "",
      transcricao: typeof dado.transcricao === "string" ? dado.transcricao : null,
    };
    return rascunhoEstaVazio(r) ? null : r;
  } catch {
    return null;
  }
}

/** Grava; um rascunho vazio apaga (nada de chave com texto em branco sobrando). */
export function gravarRascunhoDoMomento(armazenamento: Armazenamento | null, chave: string, rascunho: RascunhoDoMomento): void {
  if (!armazenamento) return;
  try {
    if (rascunhoEstaVazio(rascunho)) armazenamento.removeItem(chave);
    else armazenamento.setItem(chave, JSON.stringify(rascunho));
  } catch {
    // Sem armazenamento, o rascunho só não sobrevive; a folha funciona igual.
  }
}

export function apagarRascunhoDoMomento(armazenamento: Armazenamento | null, chave: string): void {
  if (!armazenamento) return;
  try {
    armazenamento.removeItem(chave);
  } catch {
    // Idem.
  }
}

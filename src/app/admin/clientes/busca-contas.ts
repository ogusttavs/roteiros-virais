import type { ContaAdmin } from "@/servicos/admin-contas";

/** A busca e os filtros da lista de Contas (E46 PR 1), sem React para provar sem navegador. */
export type FiltroDeContas = "todas" | "usando" | "parou" | "nao_entrou";

/** Sem acento e sem maiúscula, para "clinica" achar "Clínica". */
export function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function noFiltro(conta: ContaAdmin, filtro: FiltroDeContas): boolean {
  if (filtro === "usando") return conta.usando;
  if (filtro === "parou") return conta.parou;
  if (filtro === "nao_entrou") return conta.nuncaEntrou;
  return true;
}

/** A conta casa com a busca pelo nome dela, pelo ramo, ou pelo nome ou e-mail de qualquer pessoa com acesso. */
export function casaComABusca(conta: ContaAdmin, busca: string): boolean {
  const termo = normalizar(busca);
  if (!termo) return true;
  if (normalizar(conta.nome).includes(termo) || normalizar(conta.ramoNome ?? "").includes(termo)) return true;
  return conta.quemTemAcesso.some((p) => normalizar(p.nome).includes(termo) || normalizar(p.email).includes(termo));
}

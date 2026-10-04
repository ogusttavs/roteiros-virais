import { db } from "@/db";
import { nichos } from "@/db/schema";
import { exigirAdmin } from "@/lib/sessao";
import { listarContasAdmin } from "@/servicos/admin-contas";

import { type FiltroDeContas } from "./busca-contas";
import { TabelaContas } from "./TabelaContas";

const FILTROS_VALIDOS: FiltroDeContas[] = ["todas", "usando", "parou", "nao_entrou"];

/** `/admin/clientes`: a lista de Contas (E46 PR 1). `?filtro=parou` abre já filtrada (o Início aponta para ela). */
export default async function AdminContas({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  await exigirAdmin();
  const { filtro } = await searchParams;

  const [contas, nichosListados] = await Promise.all([listarContasAdmin(), db().select({ id: nichos.id, nome: nichos.nome }).from(nichos)]);
  const filtroInicial = FILTROS_VALIDOS.find((f) => f === filtro) ?? "todas";

  return <TabelaContas contas={contas} nichos={nichosListados} filtroInicial={filtroInicial} />;
}

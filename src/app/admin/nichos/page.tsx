import { exigirAdmin } from "@/lib/sessao";
import { listarNichosComContagem } from "@/servicos/admin-coleta";

import { ListaNichos } from "./ListaNichos";

export default async function AdminNichos() {
  await exigirAdmin();

  const nichosListados = await listarNichosComContagem();

  return <ListaNichos nichos={nichosListados} />;
}

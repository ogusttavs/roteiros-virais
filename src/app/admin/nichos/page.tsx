import { listarNichosComContagem } from "@/servicos/admin-coleta";

import { ListaNichos } from "./ListaNichos";

export default async function AdminNichos() {
  const nichosListados = await listarNichosComContagem();

  return <ListaNichos nichos={nichosListados} />;
}

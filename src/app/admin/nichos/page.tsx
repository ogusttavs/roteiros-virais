import { exigirAdmin } from "@/lib/sessao";
import { listarNichosComContagem } from "@/servicos/admin-coleta";
import { listarPedidosAbertos } from "@/servicos/pedidos-de-ramo";

import { ListaNichos } from "./ListaNichos";

export default async function AdminNichos() {
  await exigirAdmin();

  const [nichosListados, pedidos] = await Promise.all([listarNichosComContagem(), listarPedidosAbertos()]);

  return <ListaNichos nichos={nichosListados} pedidos={pedidos} />;
}

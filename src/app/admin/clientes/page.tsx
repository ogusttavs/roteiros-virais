import { db } from "@/db";
import { nichos } from "@/db/schema";
import { listarClientesAdmin } from "@/servicos/admin-coleta";

import { TabelaClientes } from "./TabelaClientes";

export default async function AdminClientes() {
  const [clientesListados, nichosListados] = await Promise.all([
    listarClientesAdmin(),
    db().select({ id: nichos.id, nome: nichos.nome }).from(nichos),
  ]);

  return <TabelaClientes clientes={clientesListados} nichos={nichosListados} />;
}

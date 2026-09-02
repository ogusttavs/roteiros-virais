import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sessaoAtual } from "@/lib/sessao";
import { briefingCompleto, clienteDoUsuario } from "@/servicos/clientes";

/**
 * Cliente sem briefing completo cai em /comecar em qualquer rota do painel
 * (plano de execucao, etapa 3). /comecar fica fora deste grupo, senao o
 * redirecionamento vira um loop.
 */
export default async function LayoutCompleto({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente || !(await briefingCompleto(cliente.id))) {
    redirect("/comecar");
  }

  return <>{children}</>;
}

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sessaoAtual } from "@/lib/sessao";
import {
  acessouHoje,
  briefingCompleto,
  clienteAtivoDoUsuario,
  preferenciasDoUsuario,
  registrarAcessoHoje,
} from "@/servicos/clientes";

import { FolhaAceiteTermos } from "../_casca/FolhaAceiteTermos";

/**
 * Cliente sem briefing completo cai em /comecar em qualquer rota do painel
 * (plano de execucao, etapa 3). /comecar fica fora deste grupo, senao o
 * redirecionamento vira um loop.
 *
 * Quem ainda nao aceitou os termos (etapa 12, decisao 7; V3, item 7: e da
 * pessoa, nao da marca) nao ve a rota pedida: só a folha de aceite, ate
 * aceitar, em qualquer marca. `ultimo_acesso_em` e gravado no maximo uma vez
 * por dia por marca, antes dessa checagem (o job `lembrete` usa esse campo,
 * e quem esta preso na folha ainda assim "abriu o painel hoje").
 */
export default async function LayoutCompleto({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente || !(await briefingCompleto(cliente.id))) {
    redirect("/comecar");
  }

  if (!acessouHoje(cliente.ultimoAcessoEm)) {
    await registrarAcessoHoje(sessao.user.id, cliente.id);
  }

  const preferencias = await preferenciasDoUsuario(sessao.user.id);
  if (!preferencias?.aceitouTermosEm) {
    return <FolhaAceiteTermos />;
  }

  return <>{children}</>;
}

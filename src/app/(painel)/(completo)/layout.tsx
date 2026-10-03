import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import {
  acessouHoje,
  briefingCompleto,
  clienteAtivoDoUsuario,
  preferenciasDoUsuario,
  registrarAcessoHoje,
} from "@/servicos/clientes";
import { aparelhosSemFalha, pedidoDePushPodeAparecer } from "@/servicos/push";
import { VERSAO_TERMOS_EM } from "@/textos/termos";
import { PedidoDeAviso } from "@/ui/componentes/PedidoDeAviso";

import { FolhaAceiteTermos } from "../_casca/FolhaAceiteTermos";
import { OuvinteInstalacao } from "../_casca/OuvinteInstalacao";

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
 *
 * E37b, item 9: versao nova dos termos pede aceite de novo, mesmo de quem
 * ja tinha aceitado uma versao anterior (`aceitouTermosEm` mais antigo que
 * `VERSAO_TERMOS_EM`). Aceitar de novo so atualiza a data, nunca duplica a
 * linha (`aceitarTermos`, servicos/clientes.ts).
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
  if (!preferencias?.aceitouTermosEm || preferencias.aceitouTermosEm < VERSAO_TERMOS_EM) {
    return <FolhaAceiteTermos />;
  }

  // E48 PR 2: o pedido de permissão do aviso de manhã (só aparece no aplicativo instalado, no celular, e uma vez: o navegador confere o resto). Só os aparelhos sem falha corrente contam (A2): a pessoa cuja inscrição já falha pode ser convidada a ligar de novo.
  const aparelhosDoAviso = await aparelhosSemFalha(sessao.user.id);
  return (
    <>
      <OuvinteInstalacao instalado={Boolean(preferencias.instaladoEm)} />
      <PedidoDeAviso
        podeAparecer={pedidoDePushPodeAparecer(preferencias, aparelhosDoAviso, new Date())}
        chavePublica={config.push.publicKey}
      />
      {children}
    </>
  );
}

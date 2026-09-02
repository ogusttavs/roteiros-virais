import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { blocoInicial, garantirBriefing } from "@/servicos/briefing";
import { briefingCompleto, clienteDoUsuario, listarNichosAtivos } from "@/servicos/clientes";

import { ComecarWizard } from "./ComecarWizard";

export default async function Comecar() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  if (await briefingCompleto(cliente.id)) {
    redirect("/hoje");
  }

  const [briefing, nichos] = await Promise.all([garantirBriefing(cliente.id), listarNichosAtivos()]);

  const dadosFixosCompletos = Boolean(cliente.cidade) && Boolean(cliente.nichoId || cliente.ramoOutro);

  return (
    <ComecarWizard
      nichos={nichos}
      dadosFixosCompletos={dadosFixosCompletos}
      dadosFixosIniciais={{
        nome: cliente.nome,
        cidade: cliente.cidade,
        bairro: cliente.bairro,
        nichoId: cliente.nichoId,
        ramoOutro: cliente.ramoOutro,
        persona: cliente.persona,
        perfis: cliente.perfis,
        quemGrava: cliente.quemGrava,
      }}
      respostasIniciais={briefing.respostas}
      avaliacoesIniciais={briefing.avaliacoes}
      notaGeralInicial={Number(briefing.notaGeral ?? 0)}
      blocoInicial={blocoInicial(briefing.avaliacoes)}
      meta={config.regras.notaMinimaBriefing}
    />
  );
}

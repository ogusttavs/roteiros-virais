import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { regrasDoCliente } from "@/servicos/aprendizado";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteDoUsuario } from "@/servicos/clientes";

import { BriefingVivo } from "./BriefingVivo";

export default async function Briefing() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const briefing = await garantirBriefing(cliente.id);
  const regras = await regrasDoCliente(cliente.id);

  return (
    <BriefingVivo
      respostasIniciais={briefing.respostas}
      avaliacoesIniciais={briefing.avaliacoes}
      notaGeralInicial={Number(briefing.notaGeral ?? 0)}
      perfil={briefing.perfil}
      regrasIniciais={regras}
      meta={config.regras.notaMinimaBriefing}
    />
  );
}

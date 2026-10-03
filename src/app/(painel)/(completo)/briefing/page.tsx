import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { regrasDoCliente } from "@/servicos/aprendizado";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { secaoDoCliente } from "@/servicos/contexto-marca";
import { leiturasDoCliente } from "@/servicos/perfis-analisados";

import { BriefingVivo } from "./BriefingVivo";

export default async function Briefing() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const [briefing, regras, perfisAnalisados, contextoMarca] = await Promise.all([
    garantirBriefing(cliente.id),
    regrasDoCliente(cliente.id),
    leiturasDoCliente(cliente.id),
    secaoDoCliente(cliente),
  ]);

  return (
    <BriefingVivo
      respostasIniciais={briefing.respostas}
      avaliacoesIniciais={briefing.avaliacoes}
      notaGeralInicial={Number(briefing.notaGeral ?? 0)}
      perfil={briefing.perfil}
      regrasIniciais={regras}
      perfisAnalisados={perfisAnalisados}
      contextoMarca={contextoMarca}
      meta={config.regras.notaMinimaBriefing}
      tipo={cliente.tipo}
    />
  );
}

import { redirect } from "next/navigation";

import { config } from "@/lib/config";
import { sessaoDoPainel } from "@/lib/ver-como";
import { regrasDoCliente } from "@/servicos/aprendizado";
import { garantirBriefing } from "@/servicos/briefing";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { secaoDoCliente } from "@/servicos/contexto-marca";
import { formatosDaMarcaComEstado } from "@/servicos/formatos";
import { leiturasDoCliente } from "@/servicos/perfis-analisados";

import { BriefingVivo } from "./BriefingVivo";

export default async function Briefing() {
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const [briefing, regras, perfisAnalisados, contextoMarca, tipos] = await Promise.all([
    garantirBriefing(cliente.id),
    regrasDoCliente(cliente.id),
    leiturasDoCliente(cliente.id),
    secaoDoCliente(cliente),
    formatosDaMarcaComEstado(cliente.id),
  ]);
  // "Respondido em 3 de outubro": a resposta mais recente do cliente, se ele já respondeu algum tipo.
  const respostas = tipos.map((t) => t.respostaDoClienteEm).filter((d): d is Date => d !== null);
  const maisRecente = respostas.length > 0 ? new Date(Math.max(...respostas.map((d) => d.getTime()))) : null;

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
      tiposIniciais={tipos.map((t) => ({ chave: t.chave, ligada: t.ligada }))}
      tiposRespondidoEm={maisRecente ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(maisRecente) : null}
    />
  );
}

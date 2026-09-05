import { History } from "lucide-react";
import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { curvasDoHistorico } from "@/servicos/curva";
import { agruparPorSemana } from "@/servicos/historico-regras";
import { roteirosDoCliente } from "@/servicos/roteiro";
import { resumoHistorico } from "@/servicos/temas";
import { textosHistorico } from "@/textos/historico";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { HistoricoTela } from "./HistoricoTela";

export default async function Historico() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const [resumo, roteiros] = await Promise.all([resumoHistorico(cliente.id), roteirosDoCliente(cliente.id)]);

  if (roteiros.length === 0) {
    return (
      <EstadoVazio
        icone={<History size={24} strokeWidth={1.5} aria-hidden="true" />}
        frase={textosHistorico.vazio}
        acao={{ rotulo: textosHistorico.verTema, href: "/hoje" }}
      />
    );
  }

  const idsPostados = roteiros.filter((r) => r.status === "postado").map((r) => r.id);
  const curvas = await curvasDoHistorico(cliente.id, idsPostados);
  const comCurva = roteiros.map((r) => ({ ...r, curva: curvas.get(r.id) ?? null }));

  return <HistoricoTela resumo={resumo} grupos={agruparPorSemana(comCurva)} />;
}

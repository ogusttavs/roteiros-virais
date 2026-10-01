import { redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { agendaDoDia, mesDaAgenda } from "@/servicos/roteiro";

import { MesTela } from "./MesTela";

function anoMesValido(valor: string | undefined, hoje: string): string {
  if (valor && /^\d{4}-\d{2}$/.test(valor)) return valor;
  return hoje.slice(0, 7);
}

function primeiroDiaDoMes(anoMes: string): string {
  return `${anoMes}-01`;
}

function diaValido(valor: string | undefined, anoMes: string, hoje: string): string {
  if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) && valor.startsWith(anoMes)) return valor;
  return hoje.startsWith(anoMes) ? hoje : primeiroDiaDoMes(anoMes);
}

type Props = { searchParams: Promise<{ mes?: string; dia?: string }> };

/**
 * `/hoje/mes` (E39b, item e, o calendário): o mês inteiro, navegável sem limite para a frente (e
 * para trás, para rever), desenho do Opus (passo 10, `Hoje.dc.html`, estado `calendario`). Tocar
 * num dia mostra a agenda dele abaixo da grade, sem sair da tela; nada se cria aqui, como no Hoje.
 */
export default async function Mes({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  const hoje = hojeISO();
  const { mes, dia } = await searchParams;
  const anoMes = anoMesValido(mes, hoje);
  const diaSelecionado = diaValido(dia, anoMes, hoje);

  const [dias, agendaDoDiaSelecionado] = await Promise.all([
    mesDaAgenda(cliente.id, anoMes),
    agendaDoDia(cliente.id, diaSelecionado),
  ]);

  return (
    <MesTela
      anoMes={anoMes}
      dias={dias}
      diaSelecionado={diaSelecionado}
      agendaDoDiaSelecionado={agendaDoDiaSelecionado}
      hoje={hoje}
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
    />
  );
}

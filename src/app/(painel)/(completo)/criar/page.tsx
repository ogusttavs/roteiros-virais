import { redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario, marcasDoUsuario } from "@/servicos/clientes";
import { planoDoDia, planoQueVem } from "@/servicos/plano";
import { temasParaCliente } from "@/servicos/temas";

import { CriarTela } from "./CriarTela";

type Props = { searchParams: Promise<{ data?: string }> };

/**
 * `/criar` (E39a, design v2, `Criar.dc.html`, estado `inicio`): a oficina. Os quatro caminhos sem
 * competir entre si (os temas de hoje, um assunto seu, contar o momento, planejar os próximos
 * dias); o plano de hoje, quando existe, continua aqui (não estava desenhado no `inicio`, mas é a
 * hipótese mais simples: ele é algo para criar, não algo para acompanhar, e Hoje virou só
 * acompanhamento). Nada se mostra do que já foi criado; isso é o trabalho de `/hoje`.
 *
 * Revisão do Fable no PR #90, decisão pendente 5: "Criar roteiro" a partir de um dia vazio que
 * não é hoje leva a data daquele dia (`?data=`), repassada aos quatro caminhos; a pessoa tocou
 * naquele dia porque quer um roteiro para ele.
 */
export default async function Criar({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const [cliente, marcas] = await Promise.all([clienteAtivoDoUsuario(sessao.user.id), marcasDoUsuario(sessao.user.id)]);
  if (!cliente) {
    redirect("/entrar");
  }

  const hoje = hojeISO();
  const { data } = await searchParams;
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= hoje ? data : undefined;

  const [resultadoTemas, planoDeHoje, planoOsDiasQueVem] = await Promise.all([
    temasParaCliente(cliente).catch(() => null),
    planoDoDia(cliente.id, hoje),
    planoQueVem(cliente.id, hoje),
  ]);
  const objetivoRecomendado = resultadoTemas?.status === "ok" ? resultadoTemas.objetivoRecomendado : null;
  const outrasMarcas = marcas.filter((marca) => marca.id !== cliente.id);

  return (
    <CriarTela
      marcaAtiva={cliente}
      marcas={marcas}
      nomePessoa={sessao.user.name}
      objetivoRecomendado={objetivoRecomendado}
      outrasMarcas={outrasMarcas}
      planoDeHoje={planoDeHoje}
      planoQueVem={planoOsDiasQueVem}
      tipo={cliente.tipo}
      quemGravaPadrao={cliente.quemGrava}
      dataInicial={dataInicial}
    />
  );
}

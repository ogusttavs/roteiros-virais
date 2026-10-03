import { redirect } from "next/navigation";

import { classificarMultiplo, formatarMultiplo, formatarViewsCompacto, diasDesde, fraseDiasAtras, rotuloMultiploConta } from "@/lib/formatarNumero";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { pedidoAbertoDaMarca } from "@/servicos/pedidos-de-ramo";
import { evidenciaResumoPorIds, setorAindaLendo, setorSemBase, type EvidenciaResumo } from "@/servicos/pesquisa";
import { temasParaCliente, type ResultadoTemasHoje } from "@/servicos/temas";
import type { EvidenciaTema } from "@/ui/componentes/TemaCartao";

import { avisoSemTema } from "./aviso-sem-tema";
import { TemasTela } from "./TemasTela";

function paraEvidenciaTema(resumo: EvidenciaResumo | null): EvidenciaTema | null {
  if (!resumo) return null;
  const faixa = classificarMultiplo(resumo.multiplicador);
  return {
    conta: resumo.contaNome ?? resumo.contaHandle,
    multiplo: formatarMultiplo(resumo.multiplicador),
    rotulo: rotuloMultiploConta(faixa, resumo.contaMedianaOrigem),
    views: formatarViewsCompacto(resumo.views),
    quando: resumo.publicadoEm ? fraseDiasAtras(diasDesde(resumo.publicadoEm)) : fraseDiasAtras(0),
    parecidos: resumo.quantidadeParecidos,
  };
}

type Props = { searchParams: Promise<{ data?: string }> };

/**
 * `/criar/temas` (E39a, a porta "Os temas de hoje"; migrado da antiga porta Reels de `/hoje`, que
 * virou agenda). H3, item 1: a tela sempre abre, com ou sem tema, com ou sem falha na busca;
 * `avisoSemTema` substitui os cartões quando não há tema de verdade.
 *
 * `?data=`, revisão do Fable no PR #90: veio de "Criar roteiro" num dia vazio; repassada ao
 * escolher um tema, para `/criar/objetivo` já nascer com aquele dia marcado.
 */
export default async function Temas({ searchParams }: Props) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  const { data } = await searchParams;
  const dataInicial = data && /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : undefined;

  const resultado = await temasParaCliente(cliente).catch((): ResultadoTemasHoje | { status: "erro" } => ({
    status: "erro",
  }));

  const temas = resultado.status === "ok" ? resultado.temas : [];
  const evidenciasTemas = await Promise.all(
    temas.map((tema) => evidenciaResumoPorIds(tema.evidencias).then(paraEvidenciaTema)),
  );
  // O que se sabe do ramo quando não há tema (E45 PR 2): sem setor e com pedido de ramo aberto, o ramo está sendo conferido; com setor sem vídeo
  // nenhum, está começando a ser pesquisado; com vídeo e sem análise, está sendo lido.
  const estadoDoRamo =
    resultado.status !== "sem_tema"
      ? {}
      : cliente.nichoId
        ? { aindaLendo: await setorAindaLendo(cliente.nichoId), semBase: await setorSemBase(cliente.nichoId) }
        : { emConferencia: (await pedidoAbertoDaMarca(cliente.id)) !== null };
  const aviso = avisoSemTema(resultado, new Date(), estadoDoRamo);

  return (
    <TemasTela
      temas={temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
      aviso={aviso}
      redePrincipal={cliente.redePrincipal}
      dataInicial={dataInicial}
    />
  );
}

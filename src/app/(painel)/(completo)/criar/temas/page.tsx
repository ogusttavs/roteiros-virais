import { redirect } from "next/navigation";

import { hojeISO } from "@/lib/config";
import { classificarMultiplo, formatarMultiplo, formatarViewsCompacto, diasDesde, fraseDiasAtras, rotuloMultiploConta } from "@/lib/formatarNumero";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { cartaoEmAltaSemFalha } from "@/servicos/em-alta";
import { pedidoAbertoDaMarca } from "@/servicos/pedidos-de-ramo";
import { evidenciaResumoPorIds, setorAindaLendo, setorSemBase, type EvidenciaResumo } from "@/servicos/pesquisa";
import { pedirTemaDeHoje, temasParaCliente, type ResultadoTemasHoje } from "@/servicos/temas";
import { perguntasDaTelaSemFalha } from "@/servicos/vozes-do-publico";
import { textosHoje } from "@/textos/hoje";
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
  const sessao = await sessaoDoPainel();
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
  // O tema de madrugada só sai para ramo em uso: sem tema de hoje e com o ramo já lido, o tema nasce agora (a tela espera e se atualiza sozinha).
  const podePedirTema =
    resultado.status === "sem_tema" && cliente.nichoId !== null && !("aindaLendo" in estadoDoRamo && (estadoDoRamo.aindaLendo || estadoDoRamo.semBase));
  const gerando = podePedirTema ? (await pedirTemaDeHoje(cliente.nichoId!)) === "gerando" : false;
  // E55 PR 2b: o assunto em alta hoje (o tema do momento) sai da lista comum e vira o cartão, só para hoje: quem escolhe o tema para outro dia (`?data=`) não o recebe.
  const emAlta = resultado.status === "ok" && (!dataInicial || dataInicial === hojeISO()) ? await cartaoEmAltaSemFalha(cliente, hojeISO()) : null;
  // Se o dia só tinha o assunto do momento e o cartão não vem (já foi usado e arquivado, ou se escolhe para outro dia), a lista ficaria em branco: o aviso entra no lugar, com o caminho do assunto próprio.
  const soSobrouOMomento = resultado.status === "ok" && !emAlta && !temas.some((tema) => !tema.doMomento);
  const aviso = gerando ? null : soSobrouOMomento ? textosHoje.emAlta.soOMomento : avisoSemTema(resultado, new Date(), estadoDoRamo);
  // E28 (parte 3b): o que o público do setor perguntou nos comentários esta semana, depois dos três temas (nulo, sem erro, no setor sem leitura).
  const perguntas = await perguntasDaTelaSemFalha(cliente.nichoId);

  return (
    <TemasTela
      temas={temas}
      evidenciasTemas={evidenciasTemas}
      avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
      aviso={aviso}
      gerando={gerando}
      redePrincipal={cliente.redePrincipal}
      dataInicial={dataInicial}
      emAlta={emAlta}
      perguntas={perguntas}
    />
  );
}

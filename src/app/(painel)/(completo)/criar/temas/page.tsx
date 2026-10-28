import { redirect } from "next/navigation";

import { datasDeHojeEProximas } from "@/config/datas";
import { hojeISO } from "@/lib/config";
import { destinoSemMarca } from "@/lib/destino-sem-marca";
import { classificarMultiplo, formatarMultiplo, formatarViewsCompacto, diasDesde, fraseDiasAtras, rotuloMultiploConta } from "@/lib/formatarNumero";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ramosDaMarcaParaDatasSemFalha } from "@/servicos/datas";
import { cartaoEmAltaSemFalha } from "@/servicos/em-alta";
import { noticiaDeOrigemDoRoteiro } from "@/servicos/noticias";
import { pedidoAbertoDaMarca } from "@/servicos/pedidos-de-ramo";
import { evidenciaResumoPorIds, setorAindaLendo, setorSemBase, type EvidenciaResumo } from "@/servicos/pesquisa";
import { pedirTemaDeHoje, temasParaCliente, type ResultadoTemasHoje } from "@/servicos/temas";
import { perguntasDaTelaSemFalha } from "@/servicos/vozes-do-publico";
import { textosHoje } from "@/textos/hoje";
import type { EvidenciaTema, FonteNoticiaTema } from "@/ui/componentes/TemaCartao";

import { avisoSemTema, deveRenovarTemaVelho } from "./aviso-sem-tema";
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
    redirect(destinoSemMarca(sessao.user.role));
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
  // Hotfix de 23/10/2026: o tema que nasceu de uma notícia (nenhum vídeo o sustenta) diz qual; o cartão mostra isto no lugar do bloco do vídeo.
  const fontesNoticias = await Promise.all(
    temas.map(async (tema): Promise<FonteNoticiaTema | null> => {
      const idNoticia = tema.evidencias.length === 0 && !tema.doMomento ? (tema.evidenciasNoticias ?? [])[0] : undefined;
      if (idNoticia === undefined) return null;
      const noticia = await noticiaDeOrigemDoRoteiro(idNoticia).catch(() => null);
      if (!noticia) return null;
      return {
        titulo: noticia.titulo,
        veiculo: noticia.fonte,
        quando: textosHoje.temaDeNoticia.quando(noticia.publicadoEm ? diasDesde(noticia.publicadoEm) : 0),
      };
    }),
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
  // A pessoa que volta depois de o ramo ficar parado (27/10/2026: 5 dias sem abrir o aplicativo) vê o tema que ainda vale e o de hoje é pedido em silêncio; a próxima abertura já o traz.
  if (cliente.nichoId !== null && deveRenovarTemaVelho(resultado, hojeISO(), new Date(), dataInicial)) {
    await pedirTemaDeHoje(cliente.nichoId);
  }
  // E55 PR 2b: o assunto em alta hoje (o tema do momento) sai da lista comum e vira o cartão, só para hoje: quem escolhe o tema para outro dia (`?data=`) não o recebe.
  const emAlta = resultado.status === "ok" && (!dataInicial || dataInicial === hojeISO()) ? await cartaoEmAltaSemFalha(cliente, hojeISO()) : null;
  // Se o dia só tinha o assunto do momento e o cartão não vem (já foi usado e arquivado, ou se escolhe para outro dia), a lista ficaria em branco: o aviso entra no lugar, com o caminho do assunto próprio.
  const soSobrouOMomento = resultado.status === "ok" && !emAlta && !temas.some((tema) => !tema.doMomento);
  const aviso = gerando ? null : soSobrouOMomento ? textosHoje.emAlta.soOMomento : avisoSemTema(resultado, new Date(), estadoDoRamo);
  // E28 (parte 3b): o que o público do setor perguntou nos comentários esta semana, depois dos três temas (nulo, sem erro, no setor sem leitura).
  const perguntas = await perguntasDaTelaSemFalha(cliente.nichoId);
  // E60: a data que vem aí (de hoje até 7 dias) como ponto de partida, com a fonte dita na tela. Sem IA e sem pesquisa: é a data do calendário da marca.
  const datas = datasDeHojeEProximas(hojeISO(), await ramosDaMarcaParaDatasSemFalha(cliente));

  return (
    <TemasTela
      temas={temas}
      evidenciasTemas={evidenciasTemas}
      fontesNoticias={fontesNoticias}
      avisoLinhaEditorial={resultado.status === "ok" ? resultado.avisoLinhaEditorial : null}
      aviso={aviso}
      gerando={gerando}
      redePrincipal={cliente.redePrincipal}
      dataInicial={dataInicial}
      emAlta={emAlta}
      perguntas={perguntas}
      datas={datas}
    />
  );
}

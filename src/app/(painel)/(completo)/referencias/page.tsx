import { Bookmark } from "lucide-react";
import { redirect } from "next/navigation";

import { TAMANHO_PAGINA_TODOS_PADRAO } from "@/config/referencias";
import type { AnaliseVideo } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import {
  contagensPorFiltroReferencias,
  referenciasDoNicho,
  resolverPlataformasReferencias,
  setorAindaLendo,
  todosOsVideosDoNicho,
  type OrdemReferencias,
  type TipoConteudoFiltravel,
} from "@/servicos/pesquisa";
import { favoritosDoCliente } from "@/servicos/referencias";
import { textosReferencias } from "@/textos/referencias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { ReferenciasTela, type Segmento } from "./ReferenciasTela";

const PERIODOS_VALIDOS = new Set([7, 30, 90]);
const FORMATOS_VALIDOS = new Set<AnaliseVideo["formato"]>(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]);
const ORDENS_VALIDAS = new Set<OrdemReferencias>(["recentes", "views", "multiplo", "velocidade"]);
/** As mesmas quatro faixas que a folha "Filtrar" mostra (`textosReferencias.viewsFaixas`): nunca duas listas divergindo. */
const VIEWS_MIN_VALIDOS = new Set(textosReferencias.viewsFaixas.map((f) => f.valor));
const TIPOS_CONTEUDO_VALIDOS = new Set<TipoConteudoFiltravel>(["meme", "recorte"]);
/** Teto de bom senso para `quantidade` vinda da URL: evita um pool absurdo se alguém editar o endereço à mão. */
const QUANTIDADE_MAXIMA_TODOS = 300;

type SearchParams = {
  seg?: string;
  periodo?: string;
  busca?: string;
  plataforma?: string;
  formato?: string;
  ordem?: string;
  views?: string;
  fala?: string;
  brasil?: string;
  tipo?: string;
  quantidade?: string;
};

function listaValida<T extends string>(valor: string | undefined, validos: Set<T>): T[] {
  if (!valor) return [];
  return valor
    .split(",")
    .filter((v): v is T => validos.has(v as T));
}

/** "sim"/"nao" na URL viram `true`/`false`; qualquer outra coisa (ou ausente) é "os dois", undefined. */
function booleanoValido(valor: string | undefined): boolean | undefined {
  if (valor === "sim") return true;
  if (valor === "nao") return false;
  return undefined;
}

export default async function Referencias({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    redirect("/entrar");
  }

  if (!cliente.nichoId) {
    return (
      <EstadoVazio icone={<Bookmark size={24} strokeWidth={1.5} aria-hidden="true" />} frase={textosReferencias.vazioSemNicho} />
    );
  }

  const params = await searchParams;
  const segmento: Segmento = params.seg === "salvos" ? "salvos" : params.seg === "todos" ? "todos" : "foradacurva";
  // R2b, item 1: o desenho (passo 14) mostra "Todos" com 90 dias de período por padrão, contra 7 das
  // outras duas abas; só vale quando a URL não pede um período explícito.
  const periodoPadrao = segmento === "todos" ? 90 : 7;
  const periodoNumero = Number(params.periodo);
  const periodoDias = PERIODOS_VALIDOS.has(periodoNumero) ? periodoNumero : periodoPadrao;
  const busca = params.busca ?? "";
  const formatosAtivos = listaValida(params.formato, FORMATOS_VALIDOS);
  const ordem = ORDENS_VALIDAS.has(params.ordem as OrdemReferencias) ? (params.ordem as OrdemReferencias) : undefined;
  const viewsMinNumero = Number(params.views);
  const viewsMin = VIEWS_MIN_VALIDOS.has(viewsMinNumero) ? viewsMinNumero : undefined;
  const comFala = booleanoValido(params.fala);
  const brasil = booleanoValido(params.brasil);
  const tiposConteudo = listaValida(params.tipo, TIPOS_CONTEUDO_VALIDOS);
  const quantidadeNumero = Number(params.quantidade);
  const quantidade =
    segmento === "todos" && Number.isInteger(quantidadeNumero) && quantidadeNumero > TAMANHO_PAGINA_TODOS_PADRAO
      ? Math.min(quantidadeNumero, QUANTIDADE_MAXIMA_TODOS)
      : TAMANHO_PAGINA_TODOS_PADRAO;

  const favoritos = await favoritosDoCliente(cliente.id);
  const apenasIds = segmento === "salvos" ? [...favoritos] : undefined;

  /**
   * As contagens por plataforma precisam vir antes de resolver
   * `plataformasAtivas` (item 8, V12b): é delas que a gente sabe se a rede
   * principal tem algum vídeo no período, antes de decidir se o prefiltro
   * vale a pena. `referenciasDoNicho`/`todosOsVideosDoNicho` só rodam depois,
   * então os dois deixaram de ser paralelos (eram um `Promise.all`).
   *
   * R2b, item 2: `plataformas` e `formatos` continuam de fora deste primeiro cálculo (igual já era),
   * mas os quatro filtros novos entram, porque `contagensPorFiltroReferencias` só acerta "quantos
   * cada opção traria, mantendo os outros filtros como estão" quando os outros filtros em vigor
   * chegam junto. `semRegua` (o terceiro argumento) segue o segmento: só "Todos" conta sem o piso
   * nem o múltiplo.
   */
  const contagensFiltro = await contagensPorFiltroReferencias(
    cliente.nichoId,
    { periodoDias, busca, apenasIds, viewsMin, comFala, brasil, tiposConteudo },
    segmento === "todos",
  );

  const { plataformas: plataformasAtivas, redePrincipalSemVideo } = resolverPlataformasReferencias(
    params.plataforma,
    cliente.redePrincipal,
    contagensFiltro.porPlataforma,
  );

  const filtrosBase = {
    periodoDias,
    busca,
    plataformas: plataformasAtivas,
    formatos: formatosAtivos,
    apenasIds,
    ordem,
    viewsMin,
    comFala,
    brasil,
    tiposConteudo,
  };

  const resultado =
    segmento === "todos"
      ? await todosOsVideosDoNicho(cliente.nichoId, { ...filtrosBase, limite: quantidade }, 0)
      : await referenciasDoNicho(cliente.nichoId, filtrosBase);

  /**
   * M1, item 5: só consulta quando o resultado já está vazio, e não na aba "Salvos" (fica vazia por
   * não ter favorito nenhum, o que não tem relação com a análise do setor).
   */
  const aindaLendo = segmento !== "salvos" && resultado.total === 0 ? await setorAindaLendo(cliente.nichoId) : false;

  return (
    <ReferenciasTela
      videos={resultado.videos}
      total={resultado.total}
      favoritosIniciais={[...favoritos]}
      segmento={segmento}
      periodoDias={periodoDias}
      busca={busca}
      plataformasAtivas={plataformasAtivas}
      formatosAtivos={formatosAtivos}
      ordem={ordem}
      viewsMin={viewsMin}
      comFala={comFala}
      brasil={brasil}
      tiposConteudo={tiposConteudo}
      quantidade={quantidade}
      contagensFiltro={contagensFiltro}
      redePrincipalSemVideo={redePrincipalSemVideo}
      aindaLendo={aindaLendo}
    />
  );
}

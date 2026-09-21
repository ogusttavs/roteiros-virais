import { Bookmark } from "lucide-react";
import { redirect } from "next/navigation";

import type { AnaliseVideo, Plataforma } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { contagensPorFiltroReferencias, referenciasDoNicho } from "@/servicos/pesquisa";
import { favoritosDoCliente } from "@/servicos/referencias";
import { textosReferencias } from "@/textos/referencias";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { ReferenciasTela, type Segmento } from "./ReferenciasTela";

const PERIODOS_VALIDOS = new Set([7, 30, 90]);
const PLATAFORMAS_VALIDAS = new Set<Plataforma>(["youtube", "tiktok", "instagram"]);
const FORMATOS_VALIDOS = new Set<AnaliseVideo["formato"]>(["fala_para_camera", "podcast", "caixinha", "esquete", "outro"]);

type SearchParams = { seg?: string; periodo?: string; busca?: string; plataforma?: string; formato?: string };

function listaValida<T extends string>(valor: string | undefined, validos: Set<T>): T[] {
  if (!valor) return [];
  return valor
    .split(",")
    .filter((v): v is T => validos.has(v as T));
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
  const segmento: Segmento = params.seg === "salvos" ? "salvos" : "foradacurva";
  const periodoNumero = Number(params.periodo);
  const periodoDias = PERIODOS_VALIDOS.has(periodoNumero) ? periodoNumero : 7;
  const busca = params.busca ?? "";
  const plataformasAtivas = listaValida(params.plataforma, PLATAFORMAS_VALIDAS);
  const formatosAtivos = listaValida(params.formato, FORMATOS_VALIDOS);

  const favoritos = await favoritosDoCliente(cliente.id);

  const filtrosBase = {
    periodoDias,
    busca,
    plataformas: plataformasAtivas,
    formatos: formatosAtivos,
    apenasIds: segmento === "salvos" ? [...favoritos] : undefined,
  };

  const [resultado, contagensFiltro] = await Promise.all([
    referenciasDoNicho(cliente.nichoId, filtrosBase),
    contagensPorFiltroReferencias(cliente.nichoId, { periodoDias, busca, apenasIds: filtrosBase.apenasIds }),
  ]);

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
      contagensFiltro={contagensFiltro}
    />
  );
}

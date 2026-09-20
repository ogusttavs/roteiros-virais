"use client";

import { usePathname } from "next/navigation";

import { CabecalhoCelular } from "./CabecalhoCelular";
import type { MarcaResumo } from "./SeletorMarcaCelular";

type Props = { nomeProduto: string; marcaAtiva: MarcaResumo; marcas: MarcaResumo[]; nomePessoa: string };

/**
 * Hoje e Roteiro (design v2) têm a própria barra fixa no topo
 * (`BarraTopo`, visível em toda largura, não só no celular): mostrar o
 * `CabecalhoCelular` genérico ali em cima empilharia duas barras. As
 * telas que ainda não migraram continuam com o cabeçalho genérico normal
 * (`PROXIMO.md`, D2 parte 1, item 3, "onde o design mostra"). Nessas duas,
 * a pílula de marca entra no `direita` do `BarraTopo` da própria tela
 * (V3, item 3), não aqui.
 */
const ROTAS_COM_BARRA_PROPRIA = ["/hoje"];

function temBarraPropria(pathname: string): boolean {
  return ROTAS_COM_BARRA_PROPRIA.includes(pathname) || pathname.startsWith("/roteiros/");
}

export function CascaCabecalhoCelular({ nomeProduto, marcaAtiva, marcas, nomePessoa }: Props) {
  const pathname = usePathname();
  if (temBarraPropria(pathname)) return null;
  return (
    <CabecalhoCelular nomeProduto={nomeProduto} marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
  );
}

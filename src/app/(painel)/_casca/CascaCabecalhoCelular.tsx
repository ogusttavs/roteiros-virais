"use client";

import { usePathname } from "next/navigation";

import { CabecalhoCelular } from "./CabecalhoCelular";

type Props = { nomeProduto: string; iniciais: string; rotuloConta: string };

/**
 * Hoje e Roteiro (design v2) têm a própria barra fixa no topo
 * (`BarraTopo`, visível em toda largura, não só no celular): mostrar o
 * `CabecalhoCelular` genérico ali em cima empilharia duas barras. As
 * telas que ainda não migraram continuam com o cabeçalho genérico normal
 * (`PROXIMO.md`, D2 parte 1, item 3, "onde o design mostra").
 */
const ROTAS_COM_BARRA_PROPRIA = ["/hoje"];

function temBarraPropria(pathname: string): boolean {
  return ROTAS_COM_BARRA_PROPRIA.includes(pathname) || pathname.startsWith("/roteiros/");
}

export function CascaCabecalhoCelular({ nomeProduto, iniciais, rotuloConta }: Props) {
  const pathname = usePathname();
  if (temBarraPropria(pathname)) return null;
  return <CabecalhoCelular nomeProduto={nomeProduto} iniciais={iniciais} rotuloConta={rotuloConta} />;
}

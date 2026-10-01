"use client";

import { usePathname } from "next/navigation";

import { CabecalhoCelular } from "./CabecalhoCelular";
import type { MarcaResumo } from "./SeletorMarcaCelular";

type Props = { nomeProduto: string; marcaAtiva: MarcaResumo; marcas: MarcaResumo[]; nomePessoa: string };

/**
 * Hoje, Criar, Criar/temas, Tema livre e Roteiro (design v2) têm a própria
 * barra fixa no topo (`BarraTopo`, visível em toda largura, não só no
 * celular): mostrar o `CabecalhoCelular` genérico ali em cima empilharia duas
 * barras (no Tema livre, o nome do produto e o Atualizar apareciam borrados
 * por baixo do vidro da barra da tela; V7, item 2 do PROXIMO.md). As telas
 * que ainda não migraram continuam com o cabeçalho genérico normal
 * (`PROXIMO.md`, D2 parte 1, item 3, "onde o design mostra"); `/criar/objetivo`
 * é uma delas (herdou de `/hoje/objetivo`, nunca teve `BarraTopo` própria). Em
 * Hoje, Criar e Roteiro, a pílula de marca entra no `direita` do `BarraTopo`
 * da própria tela (V3, item 3; E39a: Criar também), não aqui; a barra do Tema
 * livre e a de Criar/temas não têm pílula, então neles a troca de marca fica
 * em Hoje.
 */
const ROTAS_COM_BARRA_PROPRIA = ["/hoje", "/criar"];

function temBarraPropria(pathname: string): boolean {
  return (
    ROTAS_COM_BARRA_PROPRIA.includes(pathname) ||
    pathname.startsWith("/criar/tema-livre") ||
    pathname.startsWith("/criar/temas") ||
    pathname.startsWith("/roteiros/")
  );
}

export function CascaCabecalhoCelular({ nomeProduto, marcaAtiva, marcas, nomePessoa }: Props) {
  const pathname = usePathname();
  if (temBarraPropria(pathname)) return null;
  return (
    <CabecalhoCelular nomeProduto={nomeProduto} marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
  );
}

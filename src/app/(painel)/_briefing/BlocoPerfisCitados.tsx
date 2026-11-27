"use client";

import { useEffect, useState } from "react";

import type { Plataforma, TipoPerfilCitado } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";
import { ListaPerfisCitados, type ItemPerfilCitado } from "@/ui/componentes/ListaPerfisCitados";

import { adicionarPerfilCitadoAction, listarPerfisCitadosAction, removerPerfilCitadoAction } from "./acoes";

const LIMITE_POR_LISTA = 10;

type ListasCitadas = Awaited<ReturnType<typeof listarPerfisCitadosAction>>;

/**
 * E76 PR 2: a P12 e a P13 montam juntas (o briefing vivo mostra todas as perguntas, e o Começar deixa os cinco blocos
 * montados), e cada uma pede a sua lista. Uma busca só para as duas: a segunda que monta enquanto a primeira está no ar
 * pega a mesma resposta. Depois que ela chega, a próxima montagem busca de novo (nunca uma lista velha).
 */
let buscaEmCurso: Promise<ListasCitadas> | null = null;

function buscarListas(): Promise<ListasCitadas> {
  if (!buscaEmCurso) {
    buscaEmCurso = listarPerfisCitadosAction().finally(() => {
      buscaEmCurso = null;
    });
  }
  return buscaEmCurso;
}

/**
 * V12c, item 7, a E37b (design v2, `Briefing.dc.html`, `.perfis-citados`): a lista de @ acima do
 * campo de texto. E76 PR 2: eram as duas na P12; agora os concorrentes ficam na P12 e os perfis
 * admirados na P13, uma lista por pergunta (`tipo`). Busca a lista ao montar (a marca sempre vem da
 * sessão, na Server Action); cada adicionar/tirar fala com o servidor direto, sem esperar "Avaliar
 * esta resposta" (item 8, nesta etapa só guarda e mostra).
 */
export function BlocoPerfisCitados({ tipo }: { tipo: TipoPerfilCitado }) {
  const [itens, setItens] = useState<ItemPerfilCitado[] | null>(null);
  const t = textosBriefing.perfisCitados;

  useEffect(() => {
    let cancelado = false;
    buscarListas()
      .then((resultado) => {
        if (!cancelado) setItens(tipo === "concorrente" ? resultado.concorrentes : resultado.admira);
      })
      .catch(() => {
        // Sem a lista por falha de rede: a lista fica vazia, a pessoa ainda adiciona (o adicionar
        // tenta de novo); o campo de texto embaixo continua funcionando normalmente.
        if (!cancelado) setItens([]);
      });
    return () => {
      cancelado = true;
    };
  }, [tipo]);

  if (itens === null) return null;
  const lista = itens;

  async function adicionar(rede: Plataforma, handle: string) {
    const criado = await adicionarPerfilCitadoAction(tipo, { rede, handle });
    setItens([...lista, { id: criado.id, rede: criado.rede, handle: criado.handle }]);
  }

  async function remover(id: number) {
    setItens(lista.filter((item) => item.id !== id));
    await removerPerfilCitadoAction(id);
  }

  return (
    <div>
      <ListaPerfisCitados
        titulo={tipo === "concorrente" ? t.concorrentes : t.admira}
        ajuda={t.ajudaPerfil}
        itens={lista}
        onAdicionar={(rede, handle) => adicionar(rede, handle)}
        onRemover={(id) => void remover(id)}
        textoAdicionar={t.adicionarOutro}
        textoTirar={t.tirar}
        avisoInvalido={t.perfilInvalido}
        limite={LIMITE_POR_LISTA}
      />
    </div>
  );
}

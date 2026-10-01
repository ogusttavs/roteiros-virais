"use client";

import { useEffect, useState } from "react";

import type { Plataforma } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";
import { ListaPerfisCitados, type ItemPerfilCitado } from "@/ui/componentes/ListaPerfisCitados";

import { adicionarPerfilCitadoAction, listarPerfisCitadosAction, removerPerfilCitadoAction } from "./acoes";

const LIMITE_POR_LISTA = 10;

/**
 * V12c, item 7, a E37b (design v2, `Briefing.dc.html`, `.perfis-citados`):
 * as duas listas acima do campo de texto da P12, só na P12. Busca a lista
 * ao montar (a marca sempre vem da sessão, na Server Action); cada
 * adicionar/tirar fala com o servidor direto, sem esperar "Avaliar esta
 * resposta" (item 8, nesta etapa só guarda e mostra).
 */
export function BlocoPerfisCitados() {
  const [concorrentes, setConcorrentes] = useState<ItemPerfilCitado[] | null>(null);
  const [admira, setAdmira] = useState<ItemPerfilCitado[] | null>(null);
  const t = textosBriefing.perfisCitados;

  useEffect(() => {
    let cancelado = false;
    listarPerfisCitadosAction()
      .then((resultado) => {
        if (cancelado) return;
        setConcorrentes(resultado.concorrentes);
        setAdmira(resultado.admira);
      })
      .catch(() => {
        // Sem a lista por falha de rede: as duas listas ficam vazias, a pessoa ainda adiciona
        // (o adicionar tenta de novo); o campo de texto embaixo continua funcionando normalmente.
        if (!cancelado) {
          setConcorrentes([]);
          setAdmira([]);
        }
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (concorrentes === null || admira === null) return null;

  async function adicionar(
    tipo: "concorrente" | "admira",
    itens: ItemPerfilCitado[],
    setItens: (itens: ItemPerfilCitado[]) => void,
    rede: Plataforma,
    handle: string,
  ) {
    const criado = await adicionarPerfilCitadoAction(tipo, { rede, handle });
    setItens([...itens, { id: criado.id, rede: criado.rede, handle: criado.handle }]);
  }

  async function remover(itens: ItemPerfilCitado[], setItens: (itens: ItemPerfilCitado[]) => void, id: number) {
    setItens(itens.filter((item) => item.id !== id));
    await removerPerfilCitadoAction(id);
  }

  return (
    <div>
      <ListaPerfisCitados
        titulo={t.concorrentes}
        ajuda={t.ajudaConcorrentes}
        itens={concorrentes}
        onAdicionar={(rede, handle) => adicionar("concorrente", concorrentes, setConcorrentes, rede, handle)}
        onRemover={(id) => void remover(concorrentes, setConcorrentes, id)}
        textoAdicionar={t.adicionarOutro}
        textoTirar={t.tirar}
        avisoInvalido={t.perfilInvalido}
        limite={LIMITE_POR_LISTA}
      />
      <ListaPerfisCitados
        titulo={t.admira}
        itens={admira}
        onAdicionar={(rede, handle) => adicionar("admira", admira, setAdmira, rede, handle)}
        onRemover={(id) => void remover(admira, setAdmira, id)}
        textoAdicionar={t.adicionarOutro}
        textoTirar={t.tirar}
        avisoInvalido={t.perfilInvalido}
        limite={LIMITE_POR_LISTA}
      />
    </div>
  );
}

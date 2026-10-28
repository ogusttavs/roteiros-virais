"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { DiaSemanaPlano } from "@/servicos/roteiro";

/**
 * Um roteiro que a pessoa mudou de dia (arrastando ou pelo "Não vou gravar hoje") e que a tela do planejador já mostra no dia novo.
 *
 * Por que existe: depois de `mudarDataAtrasadoAction` a tela dependia só de o Next.js aplicar a revalidação que a própria ação pede. Medido em 28/10/2026 (Next 15.5.25 e
 * React 19.2.8, build de produção): a ação grava, a resposta chega inteira e o roteador monta o estado novo, mas em parte das vezes a transição nunca termina e a tela
 * continua com o item no dia antigo (sem erro, sem aviso); um `router.refresh()` junto não resolveu (a mesma transição fica presa). Aqui o item muda de lugar na hora, e a
 * revalidação do servidor só confirma. Mesmo raciocínio de `HojeTela.tsx` (o item some da lista sem esperar o `router.refresh()`).
 */
export type MovidoDeDia = { id: number; de: string; para: string };

type Contexto = { movidos: MovidoDeDia[]; registrar: (movido: MovidoDeDia) => void; esquecer: (ids: number[]) => void; esquecerTodos: () => void };

const SEM_PROVEDOR: Contexto = { movidos: [], registrar: () => {}, esquecer: () => {}, esquecerTodos: () => {} };
const ContextoMovidos = createContext<Contexto>(SEM_PROVEDOR);

/** Fica em `PlanejadorTela`: vale enquanto a pessoa está no planejador; quem registra fora dele (o menu do Hoje) cai no contexto vazio e não faz nada. */
export function ProvedorMovidosDeDia({ children }: { children: ReactNode }) {
  const [movidos, setMovidos] = useState<MovidoDeDia[]>([]);
  const registrar = useCallback((movido: MovidoDeDia) => {
    if (movido.de === movido.para) return;
    // Mover de novo o mesmo roteiro vale só o último destino, contado a partir do dia em que ele estava antes do primeiro movimento.
    setMovidos((atuais) => {
      const anterior = atuais.find((outro) => outro.id === movido.id);
      return [...atuais.filter((outro) => outro.id !== movido.id), { id: movido.id, de: anterior?.de ?? movido.de, para: movido.para }];
    });
  }, []);
  const esquecer = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setMovidos((atuais) => atuais.filter((movido) => !ids.includes(movido.id)));
  }, []);
  const esquecerTodos = useCallback(() => setMovidos((atuais) => (atuais.length === 0 ? atuais : [])), []);
  const valor = useMemo(() => ({ movidos, registrar, esquecer, esquecerTodos }), [movidos, registrar, esquecer, esquecerTodos]);
  return <ContextoMovidos.Provider value={valor}>{children}</ContextoMovidos.Provider>;
}

export function useMovidosDeDia(): Contexto {
  return useContext(ContextoMovidos);
}

/** Os dias da Semana com cada item movido já no dia novo; sem movidos devolve os mesmos `dias`, sem copiar nada. */
export function diasComMovidos(dias: DiaSemanaPlano[], movidos: MovidoDeDia[]): DiaSemanaPlano[] {
  let resultado = dias;
  for (const movido of movidos) {
    const dia = resultado.find((d) => d.itens.some((item) => !item.sugerido && item.id === movido.id));
    const item = dia?.itens.find((i) => !i.sugerido && i.id === movido.id);
    if (!dia || !item || dia.data === movido.para) continue;
    resultado = resultado.map((d) => {
      if (d.data === dia.data) return { ...d, itens: d.itens.filter((i) => i !== item) };
      if (d.data === movido.para) return { ...d, itens: [...d.itens, item] };
      return d;
    });
  }
  return resultado;
}

/**
 * Os ids que a Semana já recebeu do servidor fora do dia de antes: a revalidação chegou (o item está no dia novo, ou em outro, se mudou por outro lado), o aviso local
 * não precisa mais valer. Item que não está nesta semana fica como está (não dá para saber daqui).
 */
export function idsJaConfirmados(dias: DiaSemanaPlano[], movidos: MovidoDeDia[]): number[] {
  return movidos
    .filter((movido) => dias.some((d) => d.data !== movido.de && d.itens.some((item) => !item.sugerido && item.id === movido.id)))
    .map((movido) => movido.id);
}

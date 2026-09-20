"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useTrocarMarca } from "./useTrocarMarca";

type TrocaMarcaValor = ReturnType<typeof useTrocarMarca>;

const TrocaMarcaContext = createContext<TrocaMarcaValor | null>(null);

/**
 * Uma troca de marca por vez para a sessão inteira (V3, item 3, estado
 * `trocando`): sem isto, a pílula do celular e o seletor do desktop tinham
 * cada um o próprio `useTrocarMarca`, e a própria tela (o esqueleto "Abrindo
 * <marca>" de Hoje) não tinha como saber que uma troca estava em andamento.
 * Um provedor só, em `(painel)/layout.tsx`, por cima da casca e de
 * `{children}`.
 */
export function TrocaMarcaProvider({ children }: { children: ReactNode }) {
  const valor = useTrocarMarca();
  return <TrocaMarcaContext.Provider value={valor}>{children}</TrocaMarcaContext.Provider>;
}

export function useTrocaMarca(): TrocaMarcaValor {
  const contexto = useContext(TrocaMarcaContext);
  if (!contexto) {
    throw new Error("useTrocaMarca só funciona dentro de TrocaMarcaProvider ((painel)/layout.tsx).");
  }
  return contexto;
}

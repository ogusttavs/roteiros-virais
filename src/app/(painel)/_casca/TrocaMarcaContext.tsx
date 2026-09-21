"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useTrocarMarca } from "./useTrocarMarca";

type TrocaMarcaValor = ReturnType<typeof useTrocarMarca>;

const TrocaMarcaContext = createContext<TrocaMarcaValor | null>(null);

/** Quanto o aviso de falha da troca fica na tela antes de sumir sozinho (V7, item 4 do PROXIMO.md). */
const TEMPO_DO_AVISO_MS = 6000;

/**
 * Uma troca de marca por vez para a sessão inteira (V3, item 3, estado
 * `trocando`): sem isto, a pílula do celular e o seletor do desktop tinham
 * cada um o próprio `useTrocarMarca`, e a própria tela (o esqueleto "Abrindo
 * <marca>" de Hoje) não tinha como saber que uma troca estava em andamento.
 * Um provedor só, em `(painel)/layout.tsx`, por cima da casca e de
 * `{children}`.
 *
 * O aviso de falha (`erro`) mora aqui, no provedor que persiste entre telas
 * (V7, item 4 do PROXIMO.md): sem o filtro abaixo ele ficava fixo até a
 * próxima troca, sobre a barra de ações do Roteiro e as abas. Quem consome o
 * valor só recebe o aviso por 6 s, e só na tela em que a troca falhou.
 */
export function TrocaMarcaProvider({ children }: { children: ReactNode }) {
  const troca = useTrocarMarca();
  const pathname = usePathname();
  const [avisoVisivel, setAvisoVisivel] = useState(false);

  useEffect(() => {
    if (!troca.erro) {
      setAvisoVisivel(false);
      return;
    }
    setAvisoVisivel(true);
    const id = setTimeout(() => setAvisoVisivel(false), TEMPO_DO_AVISO_MS);
    return () => clearTimeout(id);
  }, [troca.erro]);

  // Outra tela: o aviso da troca que falhou na anterior não vai junto.
  useEffect(() => {
    setAvisoVisivel(false);
  }, [pathname]);

  const valor: TrocaMarcaValor = { ...troca, erro: avisoVisivel ? troca.erro : null };
  return <TrocaMarcaContext.Provider value={valor}>{children}</TrocaMarcaContext.Provider>;
}

/**
 * Como `useTrocaMarca`, mas devolve `null` fora do `TrocaMarcaProvider` em vez de lancar: para os componentes
 * compartilhados com telas que ficam fora do painel (`PerguntaCampo`, usado tambem em /comecar).
 */
export function useTrocaMarcaOpcional(): TrocaMarcaValor | null {
  return useContext(TrocaMarcaContext);
}

export function useTrocaMarca(): TrocaMarcaValor {
  const contexto = useContext(TrocaMarcaContext);
  if (!contexto) {
    throw new Error("useTrocaMarca só funciona dentro de TrocaMarcaProvider ((painel)/layout.tsx).");
  }
  return contexto;
}

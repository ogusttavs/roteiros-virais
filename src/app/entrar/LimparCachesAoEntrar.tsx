"use client";

import { useEffect } from "react";

import { limparCachesDoAparelho } from "@/lib/offline";

/**
 * Toda vez que "/entrar" aparece de verdade (a pagina redireciona para
 * `/hoje` quando ja existe sessao, `page.tsx`), a sessao acabou ou nunca
 * existiu (V8, item 0 do PROXIMO.md, o resto da revisao do PR #53): o
 * roteiro que o service worker guardou (V7) e dado de cliente, e nao pode
 * continuar legivel sem rede depois disso. So o navegador registra o
 * service worker em producao (`Conexao.tsx`), mas apagar o Cache Storage
 * funciona em qualquer ambiente que o suporte, com ou sem o worker ativo.
 */
export function LimparCachesAoEntrar() {
  useEffect(() => {
    void limparCachesDoAparelho();
  }, []);
  return null;
}

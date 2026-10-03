"use client";

import { useEffect } from "react";

import { comecarAOuvirInstalacao, jaEstaInstalado } from "@/ui/instalacao";

import { registrarInstalacaoAction } from "./instalar-acoes";

/**
 * Fica no layout do painel (E48 PR 1) e não mostra nada. Faz duas coisas que precisam existir antes de qualquer tela:
 * guarda o pedido de instalação que o Android manda cedo (a folha de convite o usa depois), e, na primeira abertura em modo aplicativo
 * (tela cheia), grava que a pessoa instalou. `instalado` vem do servidor: já gravado, não chama de novo.
 */
export function OuvinteInstalacao({ instalado }: { instalado: boolean }) {
  useEffect(() => comecarAOuvirInstalacao(), []);

  useEffect(() => {
    if (instalado) return;
    if (jaEstaInstalado()) void registrarInstalacaoAction().catch(() => undefined);
  }, [instalado]);

  return null;
}

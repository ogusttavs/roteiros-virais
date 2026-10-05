"use client";

import { useEffect } from "react";

import { conferirAviso } from "./conferir-aviso";

/**
 * Ao abrir o painel, confere o aviso de manhã deste aparelho e reinscreve sozinho se a inscrição morreu (`conferirAviso`). Não mostra nada. Fica fora do modo "ver
 * como" (o layout só o monta fora dele).
 */
export function ReinscreverAviso({ chavePublica }: { chavePublica: string }) {
  useEffect(() => {
    if (chavePublica) void conferirAviso(chavePublica);
  }, [chavePublica]);
  return null;
}

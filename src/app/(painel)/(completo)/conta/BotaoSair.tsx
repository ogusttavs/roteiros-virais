"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { textosConta } from "@/textos/conta";
import { Botao } from "@/ui/componentes/Botao";

export function BotaoSair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    await authClient.signOut();
    router.push("/entrar");
    router.refresh();
  }

  return (
    <Botao variante="secundario" carregando={saindo} onClick={sair}>
      {textosConta.sair}
    </Botao>
  );
}

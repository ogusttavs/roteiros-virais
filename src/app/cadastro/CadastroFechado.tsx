"use client";

import Link from "next/link";
import { useState } from "react";

import { QueroTestar, type TextosDoFormulario } from "@/app/QueroTestar";
import type { textosCadastro } from "@/textos/cadastro";

import { CabecaDoCartao, CartaoDeConta, TelaDeConta } from "./pecas";
import styles from "./pecas.module.css";

/**
 * O cadastro fechado (a chave `CADASTRO_ABERTO` desligada, E63 PR 2): `/criar-conta` mostra o formulário de interessado de hoje, o mesmo da página de entrada, no cartão de vidro,
 * e o "Pedido enviado" no lugar dele quando a pessoa envia. Sem o caminho do teste ao lado: não há teste para começar sozinho.
 */
export function CadastroFechado({ textos, formulario }: { textos: typeof textosCadastro.cadastroFechado; formulario: TextosDoFormulario }) {
  const [enviado, setEnviado] = useState(false);

  if (enviado) {
    return (
      <TelaDeConta>
        <CartaoDeConta>
          <CabecaDoCartao confirmado={textos.enviado} titulo={textos.enviadoTitulo} subtitulo={textos.enviadoTexto} />
          <Link href="/" className={styles.botaoLinkVazio}>
            {textos.voltar}
          </Link>
        </CartaoDeConta>
      </TelaDeConta>
    );
  }

  return (
    <TelaDeConta>
      <CartaoDeConta largo>
        <CabecaDoCartao titulo={textos.titulo} subtitulo={textos.subtitulo} />
        <QueroTestar textos={formulario} aoEnviar={() => setEnviado(true)} />
        <Link href="/entrar" className={styles.linkAcao}>
          {textos.jaTenhoConta}
        </Link>
      </CartaoDeConta>
    </TelaDeConta>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";

import { dispararJobAction } from "./acoes";
import styles from "./BotaoRodarJob.module.css";

const t = textosAdmin.jobs;

export function BotaoRodarJob({ nome }: { nome: string }) {
  const router = useRouter();
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(null);

  async function rodar() {
    setRodando(true);
    setMensagem(null);
    const resultado = await dispararJobAction(nome);
    setMensagem(
      resultado.ok ? { tipo: "sucesso", texto: t.sucesso } : { tipo: "erro", texto: t.erroDisparar(resultado.mensagem) },
    );
    setRodando(false);
    router.refresh();
  }

  return (
    <span className={styles.envoltorio}>
      <Botao variante="secundario" tamanho="md" carregando={rodando} onClick={rodar}>
        {rodando ? t.disparando : t.botaoDisparar(nome)}
      </Botao>
      {mensagem ? (
        <span className={mensagem.tipo === "erro" ? styles.erro : styles.sucesso} role="status">
          {mensagem.texto}
        </span>
      ) : null}
    </span>
  );
}

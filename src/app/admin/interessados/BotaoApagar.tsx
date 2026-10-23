"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Botao } from "@/ui/componentes/Botao";

import { apagarInteressadoAction } from "./acoes";
import styles from "./BotaoApagar.module.css";

type Textos = { apagar: string; confirmar: string; cancelar: string; apagando: string; aria: string; erro: string };

/** O "apagar" da lista de interessados (E57a): dois passos, para um toque sem querer não apagar a linha de alguém. */
export function BotaoApagar({ id, textos }: { id: number; textos: Textos }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState(false);

  async function apagar() {
    setApagando(true);
    setErro(false);
    try {
      const resultado = await apagarInteressadoAction(id);
      if (resultado.ok) router.refresh();
      else setErro(true);
    } catch {
      setErro(true);
    } finally {
      setApagando(false);
      setConfirmando(false);
    }
  }

  if (!confirmando) {
    return (
      <>
        <Botao variante="ghost" aria-label={textos.aria} onClick={() => setConfirmando(true)}>
          <Trash2 className={styles.icone} size={16} strokeWidth={1.5} aria-hidden="true" />
          {textos.apagar}
        </Botao>
        {erro ? <span role="alert" className={styles.erro}>{textos.erro}</span> : null}
      </>
    );
  }
  return (
    <span>
      <Botao variante="perigo" carregando={apagando} onClick={apagar}>
        {apagando ? textos.apagando : textos.confirmar}
      </Botao>{" "}
      <Botao variante="ghost" onClick={() => setConfirmando(false)}>
        {textos.cancelar}
      </Botao>
    </span>
  );
}

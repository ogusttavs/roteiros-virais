"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosAdmin } from "@/textos/admin";
import { textosRotinasAdmin } from "@/textos/admin-custos";
import { Botao } from "@/ui/componentes/Botao";

import { dispararJobAction } from "./acoes";
import styles from "./BotaoRodarJob.module.css";

const t = textosAdmin.jobs;
const r = textosRotinasAdmin.rotinas;

/** "Rodar de novo só um ramo": escolhe o ramo e dispara a mesma fila só para ele (custo que falta no admin, ordem 1). */
export function BotaoRodarRamo({ fila, ramos }: { fila: string; ramos: { id: number; nome: string }[] }) {
  const router = useRouter();
  const [ramoId, setRamoId] = useState<string>("");
  const [rodando, setRodando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(null);

  async function rodar() {
    if (!ramoId) return;
    setRodando(true);
    setMensagem(null);
    const resultado = await dispararJobAction(fila, { nichoId: Number(ramoId) });
    setMensagem(resultado.ok ? { tipo: "sucesso", texto: t.sucesso } : { tipo: "erro", texto: t.erroDisparar(resultado.mensagem) });
    setRodando(false);
    router.refresh();
  }

  return (
    <span className={styles.envoltorio} data-rodar-ramo={fila}>
      <select aria-label={r.escolhaORamo} value={ramoId} onChange={(e) => setRamoId(e.target.value)} disabled={rodando}>
        <option value="">{r.escolhaORamo}</option>
        {ramos.map((ramo) => (
          <option key={ramo.id} value={ramo.id}>
            {ramo.nome}
          </option>
        ))}
      </select>
      <Botao variante="secundario" tamanho="md" carregando={rodando} disabled={!ramoId} onClick={rodar}>
        {rodando ? t.disparando : r.rodarRamo}
      </Botao>
      {mensagem ? (
        <span className={mensagem.tipo === "erro" ? styles.erro : styles.sucesso} role="status">
          {mensagem.texto}
        </span>
      ) : null}
    </span>
  );
}

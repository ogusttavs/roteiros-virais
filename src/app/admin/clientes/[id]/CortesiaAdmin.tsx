"use client";

import { useState } from "react";

import { textosContaAdmin } from "@/textos/admin-contas";

import { definirCortesiaAction } from "./acoes";
import styles from "./SeletorPlanoAdmin.module.css";

const t = textosContaAdmin.ajustes;

type Props = { clienteId: number; cortesiaInicial: boolean };

/** E22 PR 1: o interruptor de cortesia ao lado do estado da assinatura, em `/admin/clientes/[id]`. Mesmo desenho do interruptor de plano (otimista, volta se falhar). */
export function CortesiaAdmin({ clienteId, cortesiaInicial }: Props) {
  const [cortesia, setCortesia] = useState(cortesiaInicial);
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState<"salvo" | "erro" | null>(null);

  async function mudar(nova: boolean) {
    const anterior = cortesia;
    setCortesia(nova);
    setSalvando(true);
    setStatus(null);
    try {
      await definirCortesiaAction(clienteId, nova);
      setStatus("salvo");
    } catch {
      setCortesia(anterior);
      setStatus("erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span className={styles.envoltorio}>
      <label className={styles.rotulo}>
        <input type="checkbox" aria-label={t.cortesia} checked={cortesia} disabled={salvando} onChange={(e) => mudar(e.target.checked)} />
        {t.cortesia}
      </label>
      {status === "salvo" ? <span className={styles.ok}>{t.cortesiaSalva}</span> : null}
      {status === "erro" ? (
        <span className={styles.erro} role="alert">
          {t.cortesiaErro}
        </span>
      ) : null}
    </span>
  );
}

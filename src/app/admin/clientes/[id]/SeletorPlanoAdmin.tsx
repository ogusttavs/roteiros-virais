"use client";

import { useState } from "react";

import type { PlanoMarca } from "@/db/schema";
import { textosAdmin } from "@/textos/admin";

import { definirPlanoAction } from "./acoes";
import styles from "./SeletorPlanoAdmin.module.css";

const t = textosAdmin.clienteDetalhe;

type Props = {
  clienteId: number;
  planoInicial: PlanoMarca;
};

/** V9b-0, item 1: o interruptor de plano, ao lado do nicho no cabeçalho de `/admin/clientes/[id]`. */
export function SeletorPlanoAdmin({ clienteId, planoInicial }: Props) {
  const [plano, setPlano] = useState(planoInicial);
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState<"salvo" | "erro" | null>(null);

  async function mudar(novoPlano: PlanoMarca) {
    const anterior = plano;
    setPlano(novoPlano);
    setSalvando(true);
    setStatus(null);
    try {
      await definirPlanoAction(clienteId, novoPlano);
      setStatus("salvo");
    } catch {
      setPlano(anterior);
      setStatus("erro");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <span className={styles.envoltorio}>
      <label className={styles.rotulo}>
        {t.campoPlano}
        <select
          className={styles.select}
          aria-label={t.campoPlano}
          value={plano}
          disabled={salvando}
          onChange={(e) => mudar(e.target.value as PlanoMarca)}
        >
          <option value="padrao">{t.planoPadrao}</option>
          <option value="sem_limite">{t.planoSemLimite}</option>
        </select>
      </label>
      {status === "salvo" ? <span className={styles.ok}>{t.planoSalvo}</span> : null}
      {status === "erro" ? (
        <span className={styles.erro} role="alert">
          {t.planoErro}
        </span>
      ) : null}
    </span>
  );
}

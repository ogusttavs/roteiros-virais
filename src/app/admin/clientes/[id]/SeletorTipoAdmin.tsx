"use client";

import { useState } from "react";

import type { TipoMarca } from "@/db/schema";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";

import { mudarTipoMarcaAction } from "./acoes";
import styles from "./SeletorPlanoAdmin.module.css";

const tClientes = textosAdmin.clientes;
const t = textosAdmin.clienteDetalhe;

type Props = {
  clienteId: number;
  tipoInicial: TipoMarca;
};

/**
 * P1, item 1: trocar o tipo de conteúdo em `/admin/clientes/[id]`. Ao
 * contrário do plano (`SeletorPlanoAdmin`), a troca apaga o briefing (as
 * doze perguntas mudam de sentido), então pede confirmação antes de gravar,
 * no mesmo padrão de "tirar o acesso" (`QuemTemAcessoAdmin`).
 */
export function SeletorTipoAdmin({ clienteId, tipoInicial }: Props) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [pendente, setPendente] = useState<TipoMarca | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [status, setStatus] = useState<"salvo" | "erro" | null>(null);

  async function confirmar() {
    if (!pendente) return;
    setSalvando(true);
    setStatus(null);
    const resultado = await mudarTipoMarcaAction(clienteId, pendente);
    setSalvando(false);
    if (!resultado.ok) {
      setStatus("erro");
      return;
    }
    setTipo(pendente);
    setPendente(null);
    setStatus("salvo");
  }

  if (pendente) {
    return (
      <span className={styles.envoltorio}>
        <span>{t.confirmarTrocarTipo}</span>
        <Botao type="button" variante="perigo" carregando={salvando} onClick={confirmar}>
          {t.trocarTipo}
        </Botao>
        <Botao type="button" variante="ghost" onClick={() => setPendente(null)} disabled={salvando}>
          {t.cancelar}
        </Botao>
      </span>
    );
  }

  return (
    <span className={styles.envoltorio}>
      <label className={styles.rotulo}>
        {t.campoTipoMarca}
        <select
          className={styles.select}
          aria-label={t.campoTipoMarca}
          value={tipo}
          onChange={(e) => setPendente(e.target.value as TipoMarca)}
        >
          <option value="negocio">{tClientes.tipoNegocio}</option>
          <option value="pessoa">{tClientes.tipoPessoa}</option>
        </select>
      </label>
      {status === "salvo" ? <span className={styles.ok}>{t.tipoSalvo}</span> : null}
      {status === "erro" ? (
        <span className={styles.erro} role="alert">
          {t.tipoErro}
        </span>
      ) : null}
    </span>
  );
}

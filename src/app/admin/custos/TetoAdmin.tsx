"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { lerNumeroBr } from "@/lib/numero-br";
import { textosCustosAdmin } from "@/textos/admin-custos";
import { Botao } from "@/ui/componentes/Botao";

import { trocarTetoAction } from "./acoes";
import styles from "./custos.module.css";

const t = textosCustosAdmin.teto;

/** "Trocar o teto" (E46 PR 3): abre o campo ali mesmo; o teto só avisa, nunca para nada. */
export function TetoAdmin({ tetoBrl }: { tetoBrl: number }) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(tetoBrl).replace(".", ","));
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    const numero = lerNumeroBr(valor);
    try {
      const r = await trocarTetoAction(numero);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setEditando(false);
      router.refresh();
    } catch {
      setErro(t.erro);
    } finally {
      setOcupado(false);
    }
  }

  if (!editando) {
    return (
      <Botao variante="ghost" tamanho="md" onClick={() => setEditando(true)}>
        {t.trocar}
      </Botao>
    );
  }
  return (
    <form className={styles.formTeto} onSubmit={salvar}>
      <label className={styles.rotuloCampo}>
        {t.campo}
        <input className={styles.entrada} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus />
      </label>
      {erro ? (
        <p className={styles.erroCampo} role="alert">
          {erro}
        </p>
      ) : null}
      <div className={styles.acoes}>
        <Botao type="submit" tamanho="md" carregando={ocupado}>
          {t.salvar}
        </Botao>
        <Botao type="button" variante="ghost" tamanho="md" disabled={ocupado} onClick={() => setEditando(false)}>
          {t.cancelar}
        </Botao>
      </div>
    </form>
  );
}

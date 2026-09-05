"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosTermos } from "@/textos/termos";
import { Botao } from "@/ui/componentes/Botao";

import { aceitarTermosAction } from "./aceite-acoes";
import styles from "./FolhaAceiteTermos.module.css";

const t = textosTermos.aceite;

/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisão 7 do
 * `PROXIMO.md`, `EntrarContaTela.dc.html`, quadro "texto-aceite"): o layout
 * `(completo)` mostra só isto, nada da rota pedida, enquanto
 * `clientes.aceitou_termos_em` for nulo. `router.refresh()` reexecuta o
 * layout no servidor depois do aceite, que então renderiza a rota de
 * verdade.
 */
export function FolhaAceiteTermos() {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aceitar() {
    setErro(null);
    setSalvando(true);
    try {
      await aceitarTermosAction();
      router.refresh();
    } catch {
      setErro(t.erro);
      setSalvando(false);
    }
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.backdrop} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={t.titulo} className={styles.folha}>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <ul className={styles.lista}>
          {t.itens.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        <Link href="/termos" className={styles.link}>
          {t.lerTermos}
        </Link>
        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}
        <Botao
          type="button"
          variante="primario"
          tamanho="lg"
          carregando={salvando}
          onClick={aceitar}
          className={styles.botao}
        >
          {t.aceitar}
        </Botao>
      </div>
    </div>
  );
}

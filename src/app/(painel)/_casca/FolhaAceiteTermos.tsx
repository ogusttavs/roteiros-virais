"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { textosTermos } from "@/textos/termos";
import { Botao } from "@/ui/componentes/Botao";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

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
 *
 * O aceite chama o servidor (V7, itens 4 e 8 do PROXIMO.md): sem rede o botão
 * fica desabilitado com o motivo escrito, e se a rede cai no meio a frase diz
 * que foi a rede e que o aceite ainda não foi guardado.
 */
export function FolhaAceiteTermos() {
  const router = useRouter();
  const { avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aceitar() {
    setErro(null);
    setSalvando(true);
    try {
      await aceitarTermosAction();
      avisarRedeOk();
      router.refresh();
    } catch (falha) {
      setErro(tratarFalha(falha, t.erro, t.erroSemRede));
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
          precisaDeRede
          onClick={aceitar}
          className={styles.botao}
        >
          {t.aceitar}
        </Botao>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";

import styles from "./FolhaSenhaGerada.module.css";

const t = textosAdmin.acessos;

type Props = {
  email: string;
  senha: string;
  onFechar: () => void;
};

/**
 * "Convite mandado" (V3, item 5, AdminCliente.dc.html): a mesma folha de
 * senha serve para "Convidar cliente" (marca nova) e "Dar acesso" (marca
 * existente), só o texto ao redor muda por quem chama. A senha aparece uma
 * vez só; copiar é a única forma de guardar, gerar outra depois exige "gerar
 * senha nova" na linha da pessoa.
 */
export function FolhaSenhaGerada({ email, senha, onFechar }: Props) {
  const [copiado, setCopiado] = useState<"senha" | "tudo" | null>(null);

  async function copiar(texto: string, qual: "senha" | "tudo") {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(qual);
    } catch {
      // Sem permissao de clipboard: a senha continua visivel na tela para copiar na mao.
    }
  }

  return (
    <div className={styles.backdrop}>
      <div role="dialog" aria-modal="true" aria-label={t.convenioTitulo} className={styles.folha}>
        <h2 className={styles.titulo}>{t.convenioTitulo}</h2>
        <p className={styles.texto}>{t.convitePara(email)}</p>

        <div className={styles.senhaGerada}>
          <span className={styles.rotulo}>{t.senhaInicial}</span>
          <span className={styles.valor}>{senha}</span>
          <div className={styles.acoes}>
            <Botao type="button" variante="secundario" onClick={() => copiar(senha, "senha")}>
              {copiado === "senha" ? t.copiado : t.copiarSenha}
            </Botao>
            <Botao type="button" variante="ghost" onClick={() => copiar(`${email} / ${senha}`, "tudo")}>
              {copiado === "tudo" ? t.copiado : t.copiarEmailESenha}
            </Botao>
          </div>
        </div>

        <p className={styles.aviso} role="status">
          {t.avisoSenhaUmaVez}
        </p>

        <Botao type="button" tamanho="lg" onClick={onFechar} className={styles.botaoFechar}>
          {t.copieiPodeFechar}
        </Botao>
      </div>
    </div>
  );
}

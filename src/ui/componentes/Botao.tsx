"use client";

import type { ButtonHTMLAttributes } from "react";

import { textosConexao } from "@/textos/conexao";
import { ID_FAIXA_SEM_CONEXAO, useConexao } from "@/ui/ConexaoContext";

import styles from "./Botao.module.css";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "ghost" | "perigo";
  tamanho?: "md" | "lg";
  carregando?: boolean;
  /**
   * A acao chama o servidor (V7, item 8 do PROXIMO.md): sem rede o botao fica
   * desabilitado com o motivo escrito ao lado, em vez de falhar ao toque.
   */
  precisaDeRede?: boolean;
};

export function Botao({
  variante = "primario",
  tamanho = "md",
  carregando = false,
  precisaDeRede = false,
  disabled,
  children,
  className,
  ...props
}: Props) {
  const { semConexao } = useConexao();
  const semRede = precisaDeRede && semConexao;
  const classes = [styles.botao, styles[variante], styles[tamanho], className]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        className={classes}
        disabled={semRede || (disabled ?? carregando)}
        aria-busy={carregando || undefined}
        aria-describedby={semRede ? ID_FAIXA_SEM_CONEXAO : undefined}
        {...props}
      >
        <span className={carregando ? styles.rotuloEscondido : undefined}>{children}</span>
        {carregando ? <span className={styles.spinner} aria-hidden="true" /> : null}
      </button>
      {semRede ? <span className={styles.motivo}>{textosConexao.precisaDeConexao}</span> : null}
    </>
  );
}

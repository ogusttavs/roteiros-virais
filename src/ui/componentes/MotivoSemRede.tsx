"use client";

import { textosConexao } from "@/textos/conexao";
import { useConexao } from "@/ui/ConexaoContext";

import styles from "./MotivoSemRede.module.css";

/**
 * O motivo escrito ao lado de uma acao que precisa do servidor e esta
 * desabilitada por falta de rede (V7, item 8 do PROXIMO.md): "Precisa de
 * conexão." Fica invisivel (nem existe no DOM) com rede. Para `<button>` cru
 * com estilo proprio; o `Botao` da biblioteca ja faz isto sozinho com
 * `precisaDeRede`.
 */
export function MotivoSemRede({ className }: { className?: string }) {
  const { semConexao } = useConexao();
  if (!semConexao) return null;
  return <span className={[styles.motivo, className].filter(Boolean).join(" ")}>{textosConexao.precisaDeConexao}</span>;
}

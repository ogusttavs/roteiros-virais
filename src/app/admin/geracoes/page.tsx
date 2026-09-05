import { List } from "lucide-react";
import Link from "next/link";

import { listarGeracoesRecentes } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import styles from "./page.module.css";

const t = textosAdmin.geracoes;

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

function formatarCusto(valor: number): string {
  return `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

function formatarAvaliacao(
  avaliacao: "gostei" | "nao_gostei" | "outro_angulo" | null,
  motivo: string | null,
): string {
  if (!avaliacao) return t.semAvaliacao;
  const rotulo = avaliacao === "gostei" ? "gostei" : avaliacao === "nao_gostei" ? "não gostei" : "pediu outro ângulo";
  return motivo ? `${rotulo}: ${motivo}` : rotulo;
}

/**
 * Últimas 50 gerações de IA (etapa 12, decisão 8 do `PROXIMO.md`, brief
 * 6.10; aba que a etapa D deixou de fora). Só leitura.
 */
export default async function AdminGeracoes() {
  const geracoes = await listarGeracoesRecentes();

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(geracoes.length)}</p>
        </div>
      </div>

      {geracoes.length === 0 ? (
        <EstadoVazio icone={<List size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaData}</th>
                <th>{t.colunaTarefa}</th>
                <th>{t.colunaModelo}</th>
                <th>{t.colunaCusto}</th>
                <th>{t.colunaPrompt}</th>
                <th>{t.colunaAvaliacao}</th>
              </tr>
            </thead>
            <tbody>
              {geracoes.map((geracao) => (
                <tr key={geracao.id}>
                  <td className={styles.mono}>
                    <Link href={`/admin/geracoes/${geracao.id}`}>{formatarData(geracao.criadoEm)}</Link>
                  </td>
                  <td>{geracao.tarefa}</td>
                  <td className={styles.mono}>{geracao.modelo}</td>
                  <td className={styles.mono}>{formatarCusto(geracao.custoUsd)}</td>
                  <td className={styles.mono}>{geracao.versaoPrompt}</td>
                  <td className={geracao.avaliacao ? undefined : styles.semAvaliacao}>
                    {formatarAvaliacao(geracao.avaliacao, geracao.motivoAvaliacao)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

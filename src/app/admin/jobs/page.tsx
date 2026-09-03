import { List } from "lucide-react";
import Link from "next/link";

import { FILAS, type NomeFila } from "@/jobs/fila";
import { listarExecucoesRecentes } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { BotaoRodarJob } from "../_jobs/BotaoRodarJob";

import styles from "./page.module.css";

const t = textosAdmin.jobs;
const NOMES_DE_JOB = Object.values(FILAS);

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(data);
}

function formatarDuracao(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ehNomeDeJob(valor: string | undefined): valor is NomeFila {
  return valor !== undefined && (NOMES_DE_JOB as string[]).includes(valor);
}

export default async function AdminJobs({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  const filtro = ehNomeDeJob(job) ? job : undefined;
  const execucoes = await listarExecucoesRecentes(filtro, 50);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(execucoes.length)}</p>
        </div>
        <div className={styles.acoes}>
          {NOMES_DE_JOB.map((nome) => (
            <BotaoRodarJob key={nome} nome={nome} />
          ))}
        </div>
      </div>

      <nav className={[chipStyles.grupo, styles.filtro].join(" ")} aria-label={t.colunaJob}>
        <Link href="/admin/jobs" className={[chipStyles.chip, !filtro ? chipStyles.ativo : ""].filter(Boolean).join(" ")}>
          {t.filtroTodos}
        </Link>
        {NOMES_DE_JOB.map((nome) => (
          <Link
            key={nome}
            href={`/admin/jobs?job=${nome}`}
            className={[chipStyles.chip, filtro === nome ? chipStyles.ativo : ""].filter(Boolean).join(" ")}
          >
            {nome}
          </Link>
        ))}
      </nav>

      {execucoes.length === 0 ? (
        <EstadoVazio icone={<List size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaJob}</th>
                <th>{t.colunaInicio}</th>
                <th>{t.colunaDuracao}</th>
                <th>{t.colunaEstado}</th>
                <th>{t.colunaResumo}</th>
              </tr>
            </thead>
            <tbody>
              {execucoes.map((execucao) => (
                <tr key={execucao.id}>
                  <td className={styles.mono}>{execucao.nome}</td>
                  <td className={styles.mono}>{formatarData(execucao.iniciadoEm)}</td>
                  <td className={styles.mono}>{formatarDuracao(execucao.duracaoMs)}</td>
                  <td>
                    <span
                      className={[
                        styles.ponto,
                        execucao.status === "ok"
                          ? styles.pontoPositivo
                          : execucao.status === "erro"
                            ? styles.pontoErro
                            : styles.pontoAtencao,
                      ].join(" ")}
                      aria-hidden="true"
                    />
                    {execucao.status === "ok" ? t.estadoOk : execucao.status === "erro" ? t.estadoErro : t.estadoRodando}
                  </td>
                  <td className={styles.resumo}>
                    {execucao.erro ?? (execucao.resumo ? JSON.stringify(execucao.resumo) : "-")}
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

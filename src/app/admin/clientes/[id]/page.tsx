import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { clienteDetalheAdmin } from "@/servicos/admin-coleta";
import { roteirosDoCliente } from "@/servicos/roteiro";
import { textosAdmin } from "@/textos/admin";
import { textosHistorico } from "@/textos/historico";

import styles from "./page.module.css";

const t = textosAdmin.clienteDetalhe;
const LIMIAR_ATENCAO = 5;

function formatarNota(nota: number | null): string {
  if (nota === null) return textosAdmin.clientes.semNota;
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

/**
 * `/admin/clientes/[id]` (etapa 12, decisão 9 do `PROXIMO.md`): briefing,
 * roteiros e saúde da conta de um cliente. Tela simples, tabela permitida.
 * Só leitura.
 */
export default async function AdminClienteDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cliente = await clienteDetalheAdmin(Number(id));
  if (!cliente) notFound();

  const roteiros = await roteirosDoCliente(cliente.id, 50);

  return (
    <div className={styles.pagina}>
      <div>
        <Link href="/admin/clientes" className={styles.voltar}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
        </Link>
        <h1>{cliente.nome}</h1>
        <p className={styles.subtitulo}>
          {cliente.email} · {cliente.nichoNome ?? textosAdmin.clientes.semNicho}
        </p>
      </div>

      <section className={styles.secao}>
        <h2>{t.briefingTitulo}</h2>
        {cliente.briefing ? (
          <div className={styles.linhaBriefing}>
            <span
              className={[styles.selo, cliente.briefing.completo ? styles.seloOk : styles.seloAtencao].join(" ")}
            >
              {cliente.briefing.completo ? t.briefingCompleto : t.briefingIncompleto}
            </span>
            <span className={styles.mono}>
              {t.notaGeral}: {formatarNota(cliente.briefing.notaGeral)}
            </span>
          </div>
        ) : (
          <p className={styles.semDado}>{t.semBriefing}</p>
        )}
        {cliente.briefing?.resumo ? <p className={styles.resumo}>{cliente.briefing.resumo}</p> : null}
      </section>

      <section className={styles.secao}>
        <h2>{t.saudeTitulo}</h2>
        <p
          className={
            cliente.diasSemGravar !== null && cliente.diasSemGravar >= LIMIAR_ATENCAO
              ? styles.textoAtencao
              : styles.mono
          }
        >
          {cliente.diasSemGravar === null
            ? textosAdmin.clientes.semRoteiro
            : cliente.diasSemGravar >= LIMIAR_ATENCAO
              ? textosAdmin.clientes.diasAtencao(cliente.diasSemGravar)
              : `${cliente.diasSemGravar} dias sem gravar`}
        </p>
      </section>

      <section className={styles.secao}>
        <h2>{t.roteirosTitulo}</h2>
        {roteiros.length === 0 ? (
          <p className={styles.semDado}>{t.vazioRoteiros}</p>
        ) : (
          <div className={styles.tabelaEnvoltorio}>
            <table className={styles.tabela}>
              <thead>
                <tr>
                  <th>{t.colunaData}</th>
                  <th>{t.colunaTema}</th>
                  <th>{t.colunaStatus}</th>
                </tr>
              </thead>
              <tbody>
                {roteiros.map((roteiro) => (
                  <tr key={roteiro.id}>
                    <td className={styles.mono}>{formatarData(roteiro.data)}</td>
                    <td>{roteiro.tema}</td>
                    <td>{textosHistorico.status[roteiro.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

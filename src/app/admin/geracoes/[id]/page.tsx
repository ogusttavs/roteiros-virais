import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { geracaoPorId } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";

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
 * Entrada e saída de uma geração de IA (etapa 12, decisão 8 do
 * `PROXIMO.md`, `AdminTela.dc.html`, quadro "geracao-aberta"): dado bruto
 * (jsonb) em texto legível, já que o formato interno muda por tarefa
 * (roteiro, tema, nota do briefing...). Só leitura.
 */
export default async function AdminGeracaoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const geracao = await geracaoPorId(Number(id));
  if (!geracao) notFound();

  return (
    <div className={styles.pagina}>
      <div>
        <Link href="/admin/geracoes" className={styles.voltar}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
        </Link>
        <p className={styles.cabecalho}>
          {`geração g-${geracao.id} · ${geracao.tarefa} · ${formatarData(geracao.criadoEm)} · ${formatarCusto(geracao.custoUsd)} · prompt ${geracao.versaoPrompt}`}
        </p>
        <p className={geracao.avaliacao ? styles.avaliacao : styles.semAvaliacao}>
          {formatarAvaliacao(geracao.avaliacao, geracao.motivoAvaliacao)}
        </p>
      </div>

      <div className={styles.grade}>
        <section className={styles.secao}>
          <h2>{t.entradaTitulo}</h2>
          <pre className={styles.bloco}>{JSON.stringify(geracao.entradas, null, 2)}</pre>
        </section>
        <section className={styles.secao}>
          <h2>{t.saidaTitulo}</h2>
          <pre className={styles.bloco}>{geracao.saida ? JSON.stringify(geracao.saida, null, 2) : t.semSaida}</pre>
        </section>
      </div>

      <section className={styles.secao}>
        <h2>{t.evidenciasTitulo}</h2>
        <p className={styles.mono}>
          {geracao.evidencias.length > 0 ? geracao.evidencias.map((id) => `#${id}`).join(", ") : t.semEvidencia}
        </p>
      </section>

      <p className={styles.tokens}>
        {`tokens: ${geracao.tokensEntrada} entrada, ${geracao.tokensSaida} saída, ${geracao.tokensCache} cache`}
      </p>
    </div>
  );
}

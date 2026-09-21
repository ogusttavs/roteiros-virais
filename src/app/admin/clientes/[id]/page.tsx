import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { rotuloDoMotivo } from "@/config/motivos-reprovacao";
import { idDaRotaOuNulo } from "@/lib/id-rota";
import { exigirAdmin } from "@/lib/sessao";
import { clienteDetalheAdmin } from "@/servicos/admin-coleta";
import { contarReprovacoes, regrasDoCliente } from "@/servicos/aprendizado";
import { membrosDaMarca, NOME_SEM_NOME_AINDA } from "@/servicos/clientes";
import { roteirosDoCliente } from "@/servicos/roteiro";
import { textosAdmin } from "@/textos/admin";
import { textosHistorico } from "@/textos/historico";

import styles from "./page.module.css";
import { QuemTemAcessoAdmin } from "./QuemTemAcessoAdmin";

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
  await exigirAdmin();

  const { id } = await params;
  const clienteId = idDaRotaOuNulo(id);
  if (clienteId === null) notFound();

  const cliente = await clienteDetalheAdmin(clienteId);
  if (!cliente) notFound();

  const roteiros = await roteirosDoCliente(cliente.id, 50);
  const regras = await regrasDoCliente(cliente.id);
  const totalReprovacoes = await contarReprovacoes(cliente.id);
  const regrasAtivas = regras.filter((regra) => regra.ativa).length;
  const membrosBrutos = await membrosDaMarca(cliente.id);
  // Server Component: NOME_SEM_NOME_AINDA mora num arquivo que importa next/headers,
  // que so pode ser importado aqui (o client component recebe so o booleano ja calculado).
  const membros = membrosBrutos.map((membro) => ({ ...membro, semNome: membro.nome === NOME_SEM_NOME_AINDA }));

  return (
    <div className={styles.pagina}>
      <div>
        <Link href="/admin/clientes" className={styles.voltar}>
          <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" /> {t.voltar}
        </Link>
        <h1>{cliente.nome}</h1>
        <p className={styles.subtitulo}>
          {cliente.nichoNome ?? textosAdmin.clientes.semNicho} · {textosAdmin.acessos.quantos(membros.length)}
        </p>
      </div>

      <QuemTemAcessoAdmin clienteId={cliente.id} nomeMarca={cliente.nome} membros={membros} />

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

      <section className={styles.secao} aria-label={t.aprendizadoTitulo}>
        <div className={styles.cabecalhoAprendizado}>
          <h2>{t.aprendizadoTitulo}</h2>
          {regras.length > 0 ? (
            <span className={styles.quantos}>{t.aprendizadoQuantos(totalReprovacoes, regrasAtivas)}</span>
          ) : null}
        </div>
        {regras.length === 0 ? (
          <p className={styles.semDado}>{t.aprendizadoVazio}</p>
        ) : (
          <>
            <div className={styles.regras}>
              {regras.map((regra) => (
                <div
                  key={regra.id}
                  className={[styles.regra, !regra.ativa ? styles.regraDesativada : ""].filter(Boolean).join(" ")}
                >
                  <span className={styles.oque}>{regra.regra}</span>
                  <span className={[styles.etiqueta, regra.ativa ? styles.etiquetaAtiva : ""].filter(Boolean).join(" ")}>
                    {regra.ativa ? t.aprendizadoEtiquetaAtiva : t.aprendizadoEtiquetaDesativada}
                  </span>
                  <span className={styles.deOnde}>
                    {regra.ativa
                      ? t.aprendizadoDeOnde(
                          regra.contagem,
                          regra.ultimaEm,
                          regra.motivoOrigem ? rotuloDoMotivo(regra.motivoOrigem) : null,
                        )
                      : t.aprendizadoDesativadaEm(regra.desativadaEm ?? regra.ultimaEm)}
                  </span>
                </div>
              ))}
            </div>
            <p className={styles.rodape}>{t.aprendizadoRodape}</p>
          </>
        )}
      </section>
    </div>
  );
}

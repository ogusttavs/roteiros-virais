"use client";

import { List, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { NichoComContagem } from "@/servicos/admin-coleta";
import type { PedidoNaLista } from "@/servicos/pedidos-de-ramo";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { ModalNovoNicho } from "./ModalNovoNicho";
import styles from "./page.module.css";
import { PedidosDeRamo } from "./PedidosDeRamo";

const t = textosAdmin.nichos;

function formatarData(data: Date | null): string {
  if (!data) return t.nuncaLeu;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}

export function ListaNichos({ nichos, pedidos }: { nichos: NichoComContagem[]; pedidos: PedidoNaLista[] }) {
  const [modalAberto, setModalAberto] = useState(false);
  /** O pedido de ramo para o qual o modal está aberto ("criar ramo"); nulo é o "novo nicho" de sempre. */
  const [pedidoDoModal, setPedidoDoModal] = useState<PedidoNaLista | null>(null);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(nichos.length)}</p>
        </div>
        <div className={styles.acoes}>
          <Botao
            onClick={() => {
              setPedidoDoModal(null);
              setModalAberto(true);
            }}
          >
            {t.novoNicho}
          </Botao>
        </div>
      </div>

      {pedidos.length > 0 ? (
        <PedidosDeRamo
          pedidos={pedidos}
          aoCriarRamo={(pedido) => {
            setPedidoDoModal(pedido);
            setModalAberto(true);
          }}
        />
      ) : null}

      {nichos.length === 0 ? (
        <EstadoVazio icone={<List size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaNome}</th>
                <th>{t.colunaVideos}</th>
                <th>{t.colunaContas}</th>
                <th>{t.colunaUltimaLeitura}</th>
                <th>{t.colunaEstado}</th>
              </tr>
            </thead>
            <tbody>
              {nichos.map((nicho) => {
                const totalVideos =
                  nicho.videosPorPlataforma.youtube +
                  nicho.videosPorPlataforma.tiktok +
                  nicho.videosPorPlataforma.instagram;
                return (
                  <tr key={nicho.id}>
                    <td>
                      <Link href={`/admin/nichos/${nicho.slug}`}>{nicho.nome}</Link>
                    </td>
                    <td className={styles.mono}>{totalVideos.toLocaleString("pt-BR")}</td>
                    <td className={styles.mono}>{nicho.contasVigiadas}</td>
                    <td className={styles.mono}>
                      {formatarData(nicho.ultimaLeitura)}
                      {/* E55 PR 2c: o ramo que ganhou tema do momento hoje diz qual, na mesma célula (uma coluna a mais estourava a tabela a 1280). */}
                      {nicho.assuntosDoMomento.length > 0 ? (
                        <span className={styles.linhaMomento} data-do-momento>
                          <TrendingUp size={14} strokeWidth={1.75} aria-hidden="true" />
                          {t.doMomento(nicho.assuntosDoMomento)}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className={[styles.ponto, nicho.ativo ? styles.pontoPositivo : styles.pontoErro].join(" ")}
                        aria-hidden="true"
                      />
                      {nicho.ativo ? t.ativo : t.inativo}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ModalNovoNicho
        // Um modal por pedido: o texto do pedido é o ponto de partida do formulário, e outro pedido (ou o "novo nicho" de sempre) começa do zero.
        key={pedidoDoModal?.id ?? "novo"}
        aberto={modalAberto}
        onFechar={() => setModalAberto(false)}
        pedido={pedidoDoModal ? { id: pedidoDoModal.id, texto: pedidoDoModal.texto, marcaNome: pedidoDoModal.marca.nome } : undefined}
      />
    </div>
  );
}

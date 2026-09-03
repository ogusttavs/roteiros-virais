"use client";

import { Users } from "lucide-react";
import { useMemo, useState } from "react";

import type { ClienteAdmin } from "@/servicos/admin-coleta";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { ModalConvidarCliente } from "./ModalConvidarCliente";
import styles from "./page.module.css";

const t = textosAdmin.clientes;
const LIMIAR_ATENCAO = 5;

function formatarNota(nota: number | null): string {
  if (nota === null) return t.semNota;
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatarData(data: Date | null): string {
  if (!data) return "-";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(data);
}

type Props = {
  clientes: ClienteAdmin[];
  nichos: { id: number; nome: string }[];
};

export function TabelaClientes({ clientes, nichos }: Props) {
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return clientes;
    return clientes.filter((cliente) => cliente.nome.toLowerCase().includes(termo));
  }, [busca, clientes]);

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalhoLista}>
        <div>
          <h1>{t.titulo}</h1>
          <p className={styles.subtitulo}>{t.subtitulo(clientes.length)}</p>
        </div>
        <div className={styles.acoes}>
          <Campo
            rotulo={t.buscar}
            rotuloOculto
            type="search"
            placeholder={t.buscar}
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            className={styles.buscaCampo}
          />
          <Botao onClick={() => setModalAberto(true)}>{t.convidar}</Botao>
        </div>
      </div>

      {clientes.length === 0 ? (
        <EstadoVazio icone={<Users size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : filtrados.length === 0 ? (
        <p className={styles.semResultado}>{t.semResultado}</p>
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>{t.colunaNegocio}</th>
                <th>{t.colunaNicho}</th>
                <th>{t.colunaNota}</th>
                <th>{t.colunaUltimoRoteiro}</th>
                <th>{t.colunaDiasSemGravar}</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((cliente) => (
                <tr key={cliente.id}>
                  <td>{cliente.nome}</td>
                  <td>{cliente.nichoNome ?? t.semNicho}</td>
                  <td className={styles.mono}>{formatarNota(cliente.notaBriefing)}</td>
                  <td className={styles.mono}>{formatarData(cliente.ultimoRoteiro)}</td>
                  <td
                    className={[
                      styles.mono,
                      cliente.diasSemGravar !== null && cliente.diasSemGravar >= LIMIAR_ATENCAO
                        ? styles.textoAtencao
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {cliente.diasSemGravar === null
                      ? t.semRoteiro
                      : cliente.diasSemGravar >= LIMIAR_ATENCAO
                        ? t.diasAtencao(cliente.diasSemGravar)
                        : cliente.diasSemGravar}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModalConvidarCliente nichos={nichos} aberto={modalAberto} onFechar={() => setModalAberto(false)} />
    </div>
  );
}

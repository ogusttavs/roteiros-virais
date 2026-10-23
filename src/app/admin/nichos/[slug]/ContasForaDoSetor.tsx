"use client";

import { UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ContaMarcadaFora } from "@/servicos/contas-fora-do-setor";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

import { conferirContasAgoraAction, tirarContaDoSetorAction, voltarContaParaOSetorAction } from "../acoes";

import styles from "./page.module.css";

const t = textosAdmin.nichoDetalhe.contasForaDoSetor;

function formatarData(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(data);
}

type Props = { nichoId: number; slug: string; contas: ContaMarcadaFora[] };

/**
 * A faxina das contas fora do setor, no admin do ramo (22/10/2026): as contas que saíram do ramo por falarem de outro assunto, com o motivo; "voltar para o setor" desfaz (e a rotina
 * não marca de novo); "conferir as contas agora" enfileira a conferência só deste ramo. Só o admin chega aqui (a página exige a sessão de admin, e cada ação confere de novo).
 */
export function ContasForaDoSetor({ nichoId, slug, contas }: Props) {
  const router = useRouter();
  const [voltandoId, setVoltandoId] = useState<number | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: "erro" | "sucesso"; texto: string } | null>(null);

  async function voltar(contaId: number) {
    setVoltandoId(contaId);
    setMensagem(null);
    const resultado = await voltarContaParaOSetorAction(contaId, nichoId, slug);
    setVoltandoId(null);
    if (!resultado.ok) setMensagem({ tipo: "erro", texto: t.erroAcao });
    router.refresh();
  }

  async function conferirAgora() {
    setConferindo(true);
    setMensagem(null);
    const resultado = await conferirContasAgoraAction(nichoId);
    setConferindo(false);
    if (!resultado.ok) setMensagem({ tipo: "erro", texto: t.erroConferir(resultado.mensagem ?? "") });
    else setMensagem({ tipo: resultado.duplicado ? "erro" : "sucesso", texto: resultado.duplicado ? t.duplicadoConferir : t.sucessoConferir });
    router.refresh();
  }

  return (
    <section className={styles.secao} aria-labelledby="t-contas-fora-do-setor" data-contas-fora-do-setor>
      <div className={styles.tituloComContagem}>
        <h2 id="t-contas-fora-do-setor">{t.titulo}</h2>
        <span className={styles.contagem}>{contas.length}</span>
      </div>
      <p className={styles.contagem}>{t.ajuda}</p>
      {contas.length === 0 ? (
        <EstadoVazio icone={<UserX size={24} strokeWidth={1.5} aria-hidden="true" />} frase={t.vazio} />
      ) : (
        <div className={styles.tabelaEnvoltorio}>
          <table className={styles.tabela} aria-labelledby="t-contas-fora-do-setor">
            <thead>
              <tr>
                <th>{textosAdmin.nichoDetalhe.colunaPlataforma}</th>
                <th>{textosAdmin.nichoDetalhe.colunaConta}</th>
                <th>{t.colunaMotivo}</th>
                <th>{t.colunaQuem}</th>
                <th>{t.colunaQuando}</th>
                <th>{t.colunaAcao}</th>
              </tr>
            </thead>
            <tbody>
              {contas.map((conta) => (
                <tr key={conta.contaId} data-conta-fora-do-setor={conta.handle}>
                  <td>{conta.plataforma}</td>
                  <td>{conta.handle}</td>
                  <td>{conta.motivo}</td>
                  <td>{conta.origem === "manual" ? t.aMao : t.porRotina}</td>
                  <td className={styles.mono}>{formatarData(conta.marcadaEm)}</td>
                  <td>
                    <Botao variante="secundario" carregando={voltandoId === conta.contaId} precisaDeRede onClick={() => voltar(conta.contaId)}>
                      {voltandoId === conta.contaId ? t.voltando : t.voltar}
                    </Botao>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.contagem}>{t.conferirAjuda}</p>
      <div>
        <Botao variante="secundario" carregando={conferindo} precisaDeRede onClick={conferirAgora}>
          {conferindo ? t.conferindo : t.conferirAgora}
        </Botao>
      </div>
      {mensagem ? (
        <p className={mensagem.tipo === "erro" ? styles.aviso : styles.contagem} role="status">
          {mensagem.texto}
        </p>
      ) : null}
    </section>
  );
}

/** O "tirar do setor" à mão, ao lado de cada conta da lista de vigilância (a conta sai do ramo sem ser apagada). */
export function BotaoTirarDoSetor({ contaId, nichoId, slug, handle }: { contaId: number; nichoId: number; slug: string; handle: string }) {
  const router = useRouter();
  const [tirando, setTirando] = useState(false);
  const [erro, setErro] = useState(false);

  async function tirar() {
    setTirando(true);
    setErro(false);
    const resultado = await tirarContaDoSetorAction(contaId, nichoId, slug);
    setTirando(false);
    if (!resultado.ok) setErro(true);
    router.refresh();
  }

  return (
    <>
      <Botao variante="secundario" carregando={tirando} precisaDeRede aria-label={`${t.tirar}: ${handle}`} onClick={tirar}>
        {tirando ? t.tirando : t.tirar}
      </Botao>
      {erro ? (
        <span className={styles.aviso} role="status">
          {t.erroAcao}
        </span>
      ) : null}
    </>
  );
}

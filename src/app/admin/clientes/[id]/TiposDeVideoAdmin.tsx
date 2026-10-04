"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FORMATOS_DO_CATALOGO } from "@/config/formatos";
import { textosTipos } from "@/textos/tipos";
import { Botao } from "@/ui/componentes/Botao";
import { ChaveLiga } from "@/ui/componentes/ChaveLiga";
import { Folha } from "@/ui/componentes/Folha";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { definirFormatoDaMarcaAction, voltarFormatoAoDoClienteAction } from "./acoes";
import styles from "./TiposDeVideoAdmin.module.css";

/** O que a página manda por chave (datas já em texto, para atravessar o servidor para o navegador). */
export type TipoDaMarcaParaAdmin = {
  chave: string;
  ligada: boolean;
  quem: "padrao" | "cliente" | "admin";
  respostaDoCliente: boolean | null;
  /** "4 de outubro" (a decisão que vale hoje), ou nulo para o padrão. */
  decididoEmTexto: string | null;
  /** "3 de outubro" (quando o cliente respondeu esta chave), ou nulo. */
  respostaDoClienteEmTexto: string | null;
};

/**
 * A linha "Tipos de vídeo, 8 ligados de 13, 1 ajustado por você" da página da marca e a folha com as treze (passo 17 do Opus, `AdminCliente.dc.html`): cada tipo diz quem
 * decidiu ("Padrão"; "Escolhido pelo cliente", com a data; "Ajustado por você", com a data e o que o cliente tinha) e tem a chave. A troca do admin grava `quem = admin` e vale
 * por cima da resposta do cliente; "Voltar ao que o cliente escolheu" apaga a dele.
 */
export function TiposDeVideoAdmin({ clienteId, nomeMarca, iniciais }: { clienteId: number; nomeMarca: string; iniciais: TipoDaMarcaParaAdmin[] }) {
  const router = useRouter();
  const [tipos, setTipos] = useState(iniciais);
  // O que o servidor mandou vale de novo depois de cada `router.refresh()`, mas só quando nenhuma troca está a caminho (senão o refresh de uma apagaria a outra).
  const emVoo = useRef(0);
  useEffect(() => {
    if (emVoo.current === 0) setTipos(iniciais);
  }, [iniciais]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState(false);
  const { fechar } = useFolhaNoHistorico(aberta, () => setAberta(false));

  const ligados = tipos.filter((t) => t.ligada).length;
  const ajustados = tipos.filter((t) => t.quem === "admin").length;
  const hoje = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(new Date());

  async function trocar(chave: string, ligada: boolean) {
    setErro(null);
    // Só a chave que falhou volta, e para o que ela era NESTE clique: outra chave trocada no meio do caminho não é apagada.
    const antes = tipos.find((t) => t.chave === chave)!;
    setTipos((atual) => atual.map((t) => (t.chave === chave ? { ...t, ligada, quem: "admin", decididoEmTexto: hoje } : t)));
    emVoo.current += 1;
    const resultado = await definirFormatoDaMarcaAction(clienteId, chave, ligada).catch(() => ({ ok: false as const, erro: textosTipos.erro }));
    emVoo.current -= 1;
    if (!resultado.ok) {
      setTipos((atual) => atual.map((t) => (t.chave === chave ? antes : t)));
      setErro(resultado.erro);
      return;
    }
    router.refresh();
  }

  async function voltar(chave: string) {
    setErro(null);
    const antes = tipos.find((t) => t.chave === chave)!;
    const padrao = FORMATOS_DO_CATALOGO.find((f) => f.chave === chave)?.ligadaPorPadrao ?? false;
    setTipos((atual) =>
      atual.map((t) =>
        t.chave === chave
          ? t.respostaDoCliente !== null
            ? { ...t, ligada: t.respostaDoCliente, quem: "cliente", decididoEmTexto: t.respostaDoClienteEmTexto }
            : { ...t, ligada: padrao, quem: "padrao", decididoEmTexto: null }
          : t,
      ),
    );
    emVoo.current += 1;
    const resultado = await voltarFormatoAoDoClienteAction(clienteId, chave).catch(() => ({ ok: false as const, erro: textosTipos.erro }));
    emVoo.current -= 1;
    if (!resultado.ok) {
      setTipos((atual) => atual.map((t) => (t.chave === chave ? antes : t)));
      setErro(resultado.erro);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className={styles.linha}>
        <span className={styles.titulo}>{textosTipos.admin.titulo}</span>
        <span className={styles.valor}>
          {textosTipos.admin.resumo(ligados, FORMATOS_DO_CATALOGO.length)}
          {ajustados > 0 ? <span className={styles.ajuste}>{textosTipos.admin.ajustados(ajustados)}</span> : null}
        </span>
        <Botao variante="ghost" tamanho="md" aria-haspopup="dialog" onClick={() => setAberta(true)}>
          {textosTipos.admin.verEAjustar}
        </Botao>
      </div>
      <Folha
        titulo={textosTipos.admin.tituloDaFolha(nomeMarca)}
        aberto={aberta}
        aoFechar={fechar}
        largo
        rodape={
          <Botao variante="primario" tamanho="lg" onClick={fechar}>
            {textosTipos.admin.pronto}
          </Botao>
        }
      >
        <p className={styles.explica}>
          {textosTipos.admin.explica} {textosTipos.admin.resumo(ligados, FORMATOS_DO_CATALOGO.length)}.
        </p>
        <ul className={styles.lista} aria-label={textosTipos.rotuloLista}>
          {FORMATOS_DO_CATALOGO.map((formato) => {
            const t = tipos.find((x) => x.chave === formato.chave)!;
            const id = `admin-tipo-${formato.chave}`;
            const rotulo = t.quem === "admin" ? textosTipos.admin.ajustadoPorVoce : t.quem === "cliente" ? textosTipos.admin.escolhidoPeloCliente : textosTipos.admin.padrao;
            const quando =
              t.quem === "admin"
                ? `em ${t.decididoEmTexto ?? ""}${t.respostaDoCliente !== null ? `; ${t.respostaDoCliente ? textosTipos.admin.clienteTinhaLigado : textosTipos.admin.clienteTinhaDesligado}` : ""}`
                : t.quem === "cliente"
                  ? `no briefing, em ${t.decididoEmTexto ?? ""}`
                  : "";
            return (
              <li
                key={formato.chave}
                className={[styles.tipo, t.quem === "admin" ? styles.ajustado : t.quem === "padrao" ? styles.doPadrao : ""].filter(Boolean).join(" ")}
                data-tipo={formato.chave}
              >
                <span className={styles.texto}>
                  <span className={styles.nome} id={id}>
                    {formato.nome}
                  </span>
                  <span className={styles.frase}>{formato.frase}</span>
                </span>
                <span className={styles.quem}>
                  <span className={styles.rotuloQuem}>{rotulo}</span>
                  {quando ? <span className={styles.quando}>{quando}</span> : null}
                  {t.quem === "admin" ? (
                    <button type="button" className={styles.voltar} onClick={() => voltar(formato.chave)}>
                      {textosTipos.admin.voltarAoDoCliente}
                    </button>
                  ) : null}
                </span>
                <ChaveLiga ligada={t.ligada} rotuladaPor={id} aoTrocar={(nova) => trocar(formato.chave, nova)} />
              </li>
            );
          })}
        </ul>
        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}
      </Folha>
    </>
  );
}

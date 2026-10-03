"use client";

import { Check, CircleAlert, Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { fraseDaFonteNaoLida } from "@/lib/frase-fonte-contexto";
import type { ItemDaSecao, SecaoContextoMarca } from "@/servicos/contexto-marca";
import { textosBriefing } from "@/textos/briefing";
import { Botao } from "@/ui/componentes/Botao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

// O erro em linha do briefing (ícone e cor de erro), o mesmo das respostas e do cartão do aprendizado.
import perguntaStyles from "../../_briefing/PerguntaCampo.module.css";

import {
  confirmarItemContextoAction,
  corrigirItemContextoAction,
  desfazerTirarItemContextoAction,
  tirarItemContextoAction,
} from "./acoes";
import styles from "./ContextoMarcaCard.module.css";

const t = textosBriefing.contextoDaMarca;

type Props = { secao: SecaoContextoMarca };

/** O item na tela: igual ao do servidor, mais o `recusado` local (tirado, com "Desfazer" até a página recarregar). */
type ItemLocal = Omit<ItemDaSecao, "estado"> & {
  estado: ItemDaSecao["estado"] | "recusado";
  /** O estado de antes de tirar, para o "Desfazer" devolver o que era. */
  anterior?: ItemDaSecao["estado"];
};

/**
 * "O que a IA tirou das suas redes e do seu site" (E38 PR 2, desenho do Opus, `Briefing.dc.html`,
 * estado `contextoDaMarca`): o que a IA leu do site e das redes da pessoa, separado do que ela
 * respondeu, e que ela confirma ("Está certo"), corrige no próprio lugar ou tira. Só o que ela
 * confirma ou corrige chega aos roteiros (`perfilDoCliente`). Otimista com volta, como o
 * `AprendizadoCard`: a linha muda na hora e desfaz se a ação falhar, com a frase embaixo dela.
 *
 * Montado com as peças existentes onde o desenho não cobre (regra 11): os estados sem fonte, lendo e
 * "não deu", o "Tirar" com "Desfazer" inline, "Corrigido por você", e o microfone no campo de
 * correção (regra A1: todo campo de texto livre que a IA lê aceita fala). Registrado para o Opus.
 */
export function ContextoMarcaCard({ secao }: Props) {
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [itens, setItens] = useState<ItemLocal[]>(secao.itens);
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null);
  /** Um Set de ids, não um id só (a lição do V7 no `AprendizadoCard`). */
  const [idsPendentes, setIdsPendentes] = useState<ReadonlySet<number>>(() => new Set());
  const [erros, setErros] = useState<Record<number, string>>({});
  const [, iniciarTransicao] = useTransition();

  function marcarPendente(id: number, pendente: boolean) {
    setIdsPendentes((atual) => {
      const proximo = new Set(atual);
      if (pendente) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  function definirErro(id: number, frase: string | null) {
    setErros((atual) => {
      const proximo = { ...atual };
      if (frase === null) delete proximo[id];
      else proximo[id] = frase;
      return proximo;
    });
  }

  function trocar(id: number, mudar: (item: ItemLocal) => ItemLocal) {
    setItens((atual) => atual.map((item) => (item.id === id ? mudar(item) : item)));
  }

  /** Muda a linha na hora, chama o servidor, e devolve a linha ao que era (com a frase) se a ação falhar. */
  function agir(
    id: number,
    otimista: (item: ItemLocal) => ItemLocal,
    acao: () => Promise<void>,
    frases: { erro: string; semConexao: string },
  ) {
    const original = itens.find((item) => item.id === id);
    if (!original) return;
    trocar(id, otimista);
    definirErro(id, null);
    marcarPendente(id, true);
    iniciarTransicao(async () => {
      try {
        await acao();
        avisarRedeOk();
      } catch (falha) {
        trocar(id, () => original);
        definirErro(id, tratarFalha(falha, frases.erro, frases.semConexao));
      } finally {
        marcarPendente(id, false);
      }
    });
  }

  function confirmar(id: number) {
    agir(
      id,
      (item) => ({ ...item, estado: "confirmado", novidade: null }),
      () => confirmarItemContextoAction(id),
      { erro: t.erroConfirmar, semConexao: t.semConexaoConfirmar },
    );
  }

  function tirar(id: number) {
    if (editando?.id === id) setEditando(null);
    agir(
      id,
      (item) => ({ ...item, anterior: item.estado === "recusado" ? item.anterior : item.estado, estado: "recusado", novidade: null }),
      () => tirarItemContextoAction(id),
      { erro: t.erroTirar, semConexao: t.semConexaoTirar },
    );
  }

  function desfazer(id: number) {
    agir(
      id,
      (item) => ({ ...item, estado: item.anterior ?? "para_confirmar", anterior: undefined }),
      () => desfazerTirarItemContextoAction(id),
      { erro: t.erroDesfazer, semConexao: t.semConexaoDesfazer },
    );
  }

  function salvarCorrecao() {
    if (!editando) return;
    const { id } = editando;
    const texto = editando.texto.trim();
    if (texto === "") {
      definirErro(id, t.textoObrigatorio);
      return;
    }
    definirErro(id, null);
    marcarPendente(id, true);
    iniciarTransicao(async () => {
      try {
        await corrigirItemContextoAction(id, texto);
        trocar(id, (item) => ({ ...item, estado: "corrigido", texto, novidade: null }));
        setEditando(null);
        avisarRedeOk();
      } catch (falha) {
        // O que a pessoa escreveu continua no campo: nada se perde.
        definirErro(id, tratarFalha(falha, t.erroCorrigir, t.semConexaoCorrigir));
      } finally {
        marcarPendente(id, false);
      }
    });
  }

  const fontesLidas = secao.fontes.filter((f) => f.lida && f.tipo !== "tiktok").map((f) => f.tipo as "site" | "instagram" | "youtube");
  const frasesDasFontesNaoLidas = secao.fontes.map(fraseDaFonteNaoLida).filter((frase): frase is string => frase !== null);
  const bloqueadoPelaRede = semConexao;

  return (
    <section
      id="contexto-marca"
      className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")}
      aria-label={t.titulo}
      data-passo="contextoDaMarca"
    >
      <div>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        {secao.estado === "ok" && itens.length > 0 ? <p className={styles.subtitulo}>{t.abertura}</p> : null}
        {secao.estado === "ok" && secao.ultimaLeituraOkEm && fontesLidas.length > 0 ? (
          <p className={styles.lidoEm}>{t.lidoEm(secao.ultimaLeituraOkEm, fontesLidas, secao.proximaLeituraEm)}</p>
        ) : null}
      </div>

      {secao.estado === "sem_fonte" ? (
        <div className={styles.corpoEstado}>
          <p className={styles.vazio}>{t.semFonte}</p>
          <Link href="/conta" className={styles.link}>
            {t.irParaConta}
          </Link>
        </div>
      ) : null}

      {secao.estado === "lendo" ? <p className={styles.vazio}>{t.lendo}</p> : null}

      {secao.estado === "nao_leu" ? <p className={styles.vazio}>{t.naoLeu}</p> : null}

      {secao.estado === "ok" && itens.length === 0 ? <p className={styles.vazio}>{t.nadaClaro}</p> : null}

      {secao.estado === "ok" && itens.length > 0 ? (
        <ul className={styles.itens}>
          {itens.map((item) => {
            const pendente = idsPendentes.has(item.id);
            const edicao = editando?.id === item.id ? editando : null;
            const tirado = item.estado === "recusado";
            return (
              <li key={item.id} className={styles.item} data-estado={item.estado}>
                {!tirado && item.novidade ? (
                  <span className={styles.marcaNovidade}>
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                    {item.novidade === "alem_do_briefing" ? t.novidadeAlemDoBriefing : t.novidade}
                  </span>
                ) : null}
                <span className={styles.deOndeVeio}>{t.origem[item.origem]}</span>

                {edicao ? (
                  <>
                    <CampoComFala
                      rotulo={t.campoCorrigir}
                      rotuloOculto
                      ajuda={t.campoCorrigirAjuda}
                      value={edicao.texto}
                      onChange={(texto) => setEditando({ id: item.id, texto })}
                      nomeArquivo="contexto-marca.webm"
                      maxLength={500}
                      disabled={pendente}
                    />
                    <div className={styles.acoesItem}>
                      <Botao type="button" onClick={salvarCorrecao} carregando={pendente} disabled={pendente || bloqueadoPelaRede}>
                        {t.salvar}
                      </Botao>
                      <Botao
                        type="button"
                        variante="ghost"
                        onClick={() => {
                          setEditando(null);
                          definirErro(item.id, null);
                        }}
                        disabled={pendente}
                      >
                        {t.cancelar}
                      </Botao>
                    </div>
                  </>
                ) : tirado ? (
                  <>
                    <p className={[styles.oQue, styles.oQueTirado].join(" ")}>{item.texto}</p>
                    <div className={styles.acoesItem}>
                      <span className={styles.tiradoAviso}>{t.tirado}</span>
                      <Botao type="button" variante="ghost" onClick={() => desfazer(item.id)} disabled={pendente || bloqueadoPelaRede}>
                        {t.desfazer}
                      </Botao>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.oQue}>{item.texto}</p>
                    <div className={styles.acoesItem}>
                      {item.estado === "para_confirmar" ? (
                        <Botao type="button" variante="secundario" onClick={() => confirmar(item.id)} disabled={pendente || bloqueadoPelaRede}>
                          {t.estaCerto}
                        </Botao>
                      ) : (
                        <span className={styles.confirmado}>
                          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                          {item.estado === "corrigido" ? t.corrigido : t.confirmado}
                        </span>
                      )}
                      <Botao
                        type="button"
                        variante="ghost"
                        onClick={() => {
                          definirErro(item.id, null);
                          setEditando({ id: item.id, texto: item.texto });
                        }}
                        disabled={pendente || bloqueadoPelaRede}
                      >
                        {t.corrigir}
                      </Botao>
                      <Botao type="button" variante="ghost" onClick={() => tirar(item.id)} disabled={pendente || bloqueadoPelaRede}>
                        {t.tirar}
                      </Botao>
                    </div>
                  </>
                )}

                {/* Sem conexão os botões ficam desabilitados: o motivo escrito, uma vez por linha. */}
                <MotivoSemRede className={styles.lidoEm} />
                {erros[item.id] ? (
                  <span role="alert">
                    <span className={perguntaStyles.erroInline}>
                      <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                      {erros[item.id]}
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {frasesDasFontesNaoLidas.length > 0 && secao.estado !== "sem_fonte" && secao.estado !== "lendo" ? (
        <ul className={styles.fontesNaoLidas}>
          {frasesDasFontesNaoLidas.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      ) : null}

      {secao.tiktokGuardado ? <p className={styles.lidoEm}>{t.tiktokGuardado}</p> : null}
    </section>
  );
}
